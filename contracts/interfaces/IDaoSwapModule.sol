// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PoolId, PoolKey} from "./IV4PoolManager.sol";

/// The subset of `DaoSwapModule` that `DaoCore` calls.
interface IDaoSwapModule {
    struct SwapRequest {
        PoolKey key;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint64 deadline;
    }

    function swap(SwapRequest calldata req) external returns (uint256 amountOut);

    function swapAboveCap(SwapRequest calldata req)
        external
        returns (uint256 amountOut);

    function setPool(PoolKey calldata key, bool allowed) external;

    function poolAllowed(PoolId id) external view returns (bool);
}
