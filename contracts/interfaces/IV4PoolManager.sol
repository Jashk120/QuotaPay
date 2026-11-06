// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal, ABI-compatible subset of the Uniswap v4 types the DAO build needs.
///
/// The real v4-core sources are compiled separately with solc 0.8.26 and the
/// cancun settings (see UNISWAP-V4.md §9, Phase 1). `DaoSwapModule` must not
/// link against `PoolManager.sol` or any other implementation file, so this
/// file vendors only the types and the four singleton entry points used by the
/// direct swap path. Keep it in sync with the pinned v4-core tag.

type Currency is address;

type PoolId is bytes32;

/// Packed as `(amount0 << 128) | amount1`, identical to v4-core.
type BalanceDelta is int256;

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

library PoolIdLibrary {
    /// `keccak256(abi.encode(key))`, matching v4-core's `PoolIdLibrary`.
    function toId(PoolKey memory key) internal pure returns (PoolId) {
        return PoolId.wrap(keccak256(abi.encode(key)));
    }
}

library BalanceDeltaLibrary {
    function amount0(BalanceDelta delta) internal pure returns (int128) {
        return int128(int256(BalanceDelta.unwrap(delta)) >> 128);
    }

    function amount1(BalanceDelta delta) internal pure returns (int128) {
        return int128(int256(BalanceDelta.unwrap(delta)));
    }
}

/// v4 `TickMath` bounds. v4 rejects a zero `sqrtPriceLimitX96`, so callers use
/// `MIN_SQRT_PRICE + 1` / `MAX_SQRT_PRICE - 1` for "no limit".
library V4TickMath {
    uint160 internal constant MIN_SQRT_PRICE = 4295128739;
    uint160 internal constant MAX_SQRT_PRICE =
        1461446703485210103287273052203988822378723970342;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

interface IV4PoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);

    function swap(
        PoolKey memory key,
        SwapParams memory params,
        bytes calldata hookData
    ) external returns (BalanceDelta);

    function sync(Currency currency) external;

    function settle() external payable returns (uint256);

    function take(Currency currency, address to, uint256 amount) external;
}

/// The treasury surface `DaoSwapModule` needs for the tier-3 path. `DaoCore`
/// implements `pullForSwap` and `recordSwap` and only allows its swap module.
interface IDaoTreasury {
    function pullForSwap(address token, uint256 amount) external;

    function recordSwap(
        bytes32 poolId,
        uint256 amountIn,
        uint256 amountOut
    ) external;
}
