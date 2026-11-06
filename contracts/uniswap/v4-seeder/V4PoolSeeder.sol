// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IERC20Minimal} from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

/// Minimal one-shot pool seeder for the devnet demo.
///
/// The production path uses `PositionManager`/`Permit2`; this avoids deploying
/// two near-limit periphery contracts just to create one demo pool. It only
/// initializes a pool and adds one full-range position, then lets the owner
/// sweep the unused token balance.
contract V4PoolSeeder is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public immutable owner;

    struct AddParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
    }

    error NotOwner();
    error NotManager();
    error TransferFailed();

    constructor(IPoolManager poolManager_) {
        require(address(poolManager_) != address(0), "pm=0");
        poolManager = poolManager_;
        owner = msg.sender;
    }

    function initialize(PoolKey calldata key, uint160 sqrtPriceX96)
        external
        returns (int24 tick)
    {
        if (msg.sender != owner) revert NotOwner();
        return poolManager.initialize(key, sqrtPriceX96);
    }

    function addLiquidity(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external returns (BalanceDelta delta) {
        if (msg.sender != owner) revert NotOwner();
        bytes memory result = poolManager.unlock(
            abi.encode(AddParams(key, tickLower, tickUpper, liquidityDelta))
        );
        delta = abi.decode(result, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data)
        external
        returns (bytes memory)
    {
        if (msg.sender != address(poolManager)) revert NotManager();
        AddParams memory p = abi.decode(data, (AddParams));
        (BalanceDelta delta, ) = poolManager.modifyLiquidity(
            p.key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                liquidityDelta: p.liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );
        _settle(p.key.currency0, delta.amount0());
        _settle(p.key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function sweep(Currency currency, address to) external {
        if (msg.sender != owner) revert NotOwner();
        if (Currency.unwrap(currency) == address(0)) {
            (bool ok, ) = to.call{value: address(this).balance}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20Minimal token = IERC20Minimal(Currency.unwrap(currency));
            if (!token.transfer(to, token.balanceOf(address(this)))) {
                revert TransferFailed();
            }
        }
    }

    function _settle(Currency currency, int128 delta) private {
        if (delta >= 0) return;
        uint256 amount = uint256(uint128(-delta));
        if (Currency.unwrap(currency) == address(0)) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            if (
                !IERC20Minimal(Currency.unwrap(currency)).transfer(
                    address(poolManager),
                    amount
                )
            ) revert TransferFailed();
            poolManager.settle();
        }
    }

    receive() external payable {}
}
