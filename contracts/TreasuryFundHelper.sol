// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    BalanceDelta,
    BalanceDeltaLibrary,
    Currency,
    IUnlockCallback,
    IV4PoolManager,
    PoolId,
    PoolIdLibrary,
    PoolKey,
    SwapParams,
    V4TickMath
} from "./interfaces/IV4PoolManager.sol";

/// Permissionless one-shot treasury funding helper.
///
/// The caller pays native ETH; the helper swaps it through an allowlisted v4
/// pool and sends the output token straight to the DAO. The caller never holds
/// the output, and the DAO never has to approve anything. Anyone can donate to
/// any DAO through `fund`; the pool allowlist is the owner's only lever.
contract TreasuryFundHelper is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    IV4PoolManager public immutable poolManager;
    address public immutable owner;
    mapping(PoolId => bool) public poolAllowed;

    event Funded(
        address indexed dao,
        address indexed caller,
        uint256 amountIn,
        uint256 amountOut
    );
    event PoolSet(PoolId indexed poolId, bool allowed);

    constructor(address poolManager_) {
        require(poolManager_ != address(0), "pm=0");
        poolManager = IV4PoolManager(poolManager_);
        owner = msg.sender;
    }

    /// The owner allowlists the ETH/USDC pool. `currency0` must be native ETH.
    function setPool(PoolKey calldata key, bool allowed) external {
        require(msg.sender == owner, "not owner");
        require(Currency.unwrap(key.currency0) == address(0), "input must be ETH");
        require(
            Currency.unwrap(key.currency0) < Currency.unwrap(key.currency1),
            "unsorted key"
        );
        PoolId poolId = key.toId();
        poolAllowed[poolId] = allowed;
        emit PoolSet(poolId, allowed);
    }

    /// Swap `msg.value` ETH for the pool's output token and send it to `dao`.
    /// The output recipient is always the DAO, so this cannot route funds
    /// elsewhere. Any unspent ETH is refunded to the caller.
    function fund(
        PoolKey calldata key,
        address dao,
        uint128 minAmountOut,
        uint64 deadline
    ) external payable returns (uint256 amountOut) {
        require(dao != address(0), "dao=0");
        require(block.timestamp <= deadline, "expired");
        require(poolAllowed[key.toId()], "pool not allowed");
        require(msg.value > 0 && minAmountOut > 0, "amount=0");

        uint256 spent;
        (amountOut, spent) = abi.decode(
            poolManager.unlock(
                abi.encode(key, dao, uint128(msg.value), minAmountOut)
            ),
            (uint256, uint256)
        );

        if (msg.value > spent) {
            (bool ok, ) = msg.sender.call{value: msg.value - spent}("");
            require(ok, "refund failed");
        }
        emit Funded(dao, msg.sender, spent, amountOut);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not manager");
        (
            PoolKey memory key,
            address dao,
            uint128 amountIn,
            uint128 minAmountOut
        ) = abi.decode(data, (PoolKey, address, uint128, uint128));

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(uint256(amountIn)),
                sqrtPriceLimitX96: V4TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();
        uint256 spent = uint256(uint128(-delta0));
        uint256 amountOut = uint256(uint128(delta1));
        require(spent <= amountIn, "delta too large");
        require(amountOut >= minAmountOut, "slippage");

        poolManager.settle{value: spent}();
        poolManager.take(key.currency1, dao, amountOut);
        return abi.encode(amountOut, spent);
    }

    receive() external payable {}
}
