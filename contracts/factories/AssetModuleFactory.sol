// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssetModule} from "../AssetModule.sol";

/// Deploys one `AssetModule`. Separate from `DaoFactory` so the factory stays
/// under the EIP-170 code-size limit.
contract AssetModuleFactory {
    event AssetModuleDeployed(address indexed assetModule);

    function deploy(address dao) external returns (address) {
        AssetModule module = new AssetModule(dao);
        emit AssetModuleDeployed(address(module));
        return address(module);
    }
}
