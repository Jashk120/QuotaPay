// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./interfaces/IDaoModules.sol";
import {
    BalanceDelta,
    BalanceDeltaLibrary,
    Currency,
    IDaoTreasury,
    IUnlockCallback,
    IV4PoolManager,
    PoolId,
    PoolIdLibrary,
    PoolKey,
    SwapParams,
    V4TickMath
} from "./interfaces/IV4PoolManager.sol";

/// One per DAO. Executes a single exact-in v4 swap through `PoolManager`.
///
/// The module is deliberately narrow (UNISWAP-V4.md §5):
///   - the caller must be the DAO or its agent account;
///   - pools are allowlisted by recomputed `PoolId`, so the caller cannot
///     smuggle in a different pool or a malicious hook;
///   - `deadline` and `minAmountOut` are mandatory;
///   - the output recipient is the immutable DAO, never a caller-supplied
///     address;
///   - no standing balances and no standing allowances. Input tokens are held
///     only for the duration of one atomic batch.
///
/// Tier 1 is `DaoCore.spend(tokenIn, module, amountIn)` followed by
/// `module.swap(req)` in the same frame batch, so the caps are debited by
/// `spend` and the module never owns the funds between frames.
///
/// Tier 3 is a proposal that targets `module.swapAboveCap(req)`: the module
/// pulls the input from the treasury through `DaoCore.pullForSwap`, swaps, and
/// records `ACTION_SWAP` through `DaoCore.recordSwap`. No cap is debited; the
/// vote is the authorization.
contract DaoSwapModule is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    struct SwapRequest {
        PoolKey key;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint64 deadline;
    }

    IV4PoolManager public immutable poolManager;
    address public immutable dao;
    address public immutable agentAccount;

    mapping(PoolId => bool) public poolAllowed;

    event Swapped(
        PoolId indexed poolId,
        address indexed caller,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event SwapPoolSet(PoolId indexed poolId, bool allowed);

    modifier onlyDao() {
        require(msg.sender == dao, "not dao");
        _;
    }

    constructor(address poolManager_, address dao_, address agentAccount_) {
        require(poolManager_ != address(0), "poolManager=0");
        require(dao_ != address(0), "dao=0");
        require(agentAccount_ != address(0), "agent=0");
        poolManager = IV4PoolManager(poolManager_);
        dao = dao_;
        agentAccount = agentAccount_;
    }

    /// DaoCore forwards native input before calling `swap`; the module only
    /// holds it for the duration of the unlock.
    receive() external payable {}

    /// Allowlist or remove a pool. Governance reaches this through a proposal
    /// that targets the module (DaoCore allows the target and selector).
    function setPool(PoolKey calldata key, bool allowed) external onlyDao {
        require(
            Currency.unwrap(key.currency0) != Currency.unwrap(key.currency1),
            "same currency"
        );
        require(
            Currency.unwrap(key.currency0) < Currency.unwrap(key.currency1),
            "unsorted key"
        );
        PoolId poolId = key.toId();
        poolAllowed[poolId] = allowed;
        emit SwapPoolSet(poolId, allowed);
    }

    /// Tier 1: exact-in swap funded by a preceding `DaoCore.spend`. If the
    /// swap reverts, the whole frame batch reverts, including the spend.
    function swap(SwapRequest calldata req) external returns (uint256 amountOut) {
        require(msg.sender == dao || msg.sender == agentAccount, "not authorized");
        return _swap(req, false);
    }

    /// Tier 3: exact-in swap above the input-token cap. Reached only through a
    /// proposal that targets this module, so `msg.sender` is the DAO.
    function swapAboveCap(SwapRequest calldata req)
        external
        onlyDao
        returns (uint256 amountOut)
    {
        return _swap(req, true);
    }

    /// Called by the singleton inside `unlock`. `msg.sender` is the only guard:
    /// the callback must never be reachable outside a `PoolManager` unlock.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not manager");
        SwapRequest memory req = abi.decode(data, (SwapRequest));

        Currency input = req.zeroForOne ? req.key.currency0 : req.key.currency1;
        Currency output = req.zeroForOne ? req.key.currency1 : req.key.currency0;

        uint160 limit = req.zeroForOne
            ? V4TickMath.MIN_SQRT_PRICE + 1
            : V4TickMath.MAX_SQRT_PRICE - 1;

        BalanceDelta delta = poolManager.swap(
            req.key,
            SwapParams({
                zeroForOne: req.zeroForOne,
                amountSpecified: -int256(uint256(req.amountIn)),
                sqrtPriceLimitX96: limit
            }),
            ""
        );

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();
        uint256 amountIn = uint256(uint128(req.zeroForOne ? -delta0 : -delta1));
        uint256 amountOut = uint256(uint128(req.zeroForOne ? delta1 : delta0));
        require(amountIn > 0 && amountOut > 0, "empty swap");
        require(amountIn <= req.amountIn, "delta too large");

        _settle(input, amountIn);
        _refund(input, uint256(req.amountIn) - amountIn);
        poolManager.take(output, dao, amountOut);

        return abi.encode(amountIn, amountOut);
    }

    function _swap(SwapRequest memory req, bool aboveCap)
        private
        returns (uint256 amountOut)
    {
        require(block.timestamp <= req.deadline, "expired");
        PoolId poolId = req.key.toId();
        require(poolAllowed[poolId], "pool not allowed");
        require(req.amountIn > 0 && req.minAmountOut > 0, "amount=0");

        Currency input = req.zeroForOne ? req.key.currency0 : req.key.currency1;
        Currency output = req.zeroForOne ? req.key.currency1 : req.key.currency0;
        if (aboveCap) {
            IDaoTreasury(dao).pullForSwap(Currency.unwrap(input), req.amountIn);
        }
        require(_balanceOf(input) >= req.amountIn, "insufficient input");

        uint256 amountIn;
        (amountIn, amountOut) = abi.decode(
            poolManager.unlock(abi.encode(req)),
            (uint256, uint256)
        );
        require(amountOut >= req.minAmountOut, "slippage");

        if (aboveCap) {
            IDaoTreasury(dao).recordSwap(PoolId.unwrap(poolId), amountIn, amountOut);
        }
        emit Swapped(
            poolId,
            msg.sender,
            Currency.unwrap(input),
            Currency.unwrap(output),
            amountIn,
            amountOut
        );
    }

    function _settle(Currency currency, uint256 amount) private {
        if (Currency.unwrap(currency) == address(0)) {
            // PoolManager has no `receive()`: native ETH enters through payable
            // `settle`, not a plain transfer.
            poolManager.settle{value: amount}();
        } else {
            // `sync` records the pre-transfer balance so only our transfer is
            // credited to the pool.
            poolManager.sync(currency);
            require(
                IERC20(Currency.unwrap(currency)).transfer(
                    address(poolManager),
                    amount
                ),
                "transfer failed"
            );
            poolManager.settle();
        }
    }

    /// A price limit can stop the swap before the full input is consumed. The
    /// surplus goes back to the treasury instead of staying in the module.
    function _refund(Currency currency, uint256 amount) private {
        if (amount == 0) return;
        if (Currency.unwrap(currency) == address(0)) {
            (bool ok, ) = dao.call{value: amount}("");
            require(ok, "refund failed");
        } else {
            require(
                IERC20(Currency.unwrap(currency)).transfer(dao, amount),
                "refund failed"
            );
        }
    }

    function _balanceOf(Currency currency) private view returns (uint256) {
        address token = Currency.unwrap(currency);
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }
}
