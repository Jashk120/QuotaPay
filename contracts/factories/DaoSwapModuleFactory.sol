// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DaoSwapModule} from "../DaoSwapModule.sol";

/// Deploys one `DaoSwapModule` per DAO.
///
/// The module carries the v4 wiring (`poolManager`) and the immutable DAO
/// address; the orchestrator performs the policy wiring through
/// `DaoCore.initializeSwapModule`. Separate from `DaoCoreFactory` so the
/// creation code of `DaoCore` does not grow toward the EIP-170 limit.
contract DaoSwapModuleFactory {
    event DaoSwapModuleDeployed(
        address indexed dao,
        address indexed module,
        address poolManager
    );

    address public immutable poolManager;

    constructor(address poolManager_) {
        require(poolManager_ != address(0), "poolManager=0");
        poolManager = poolManager_;
    }

    function deploy(address dao, address agentAccount) external returns (address) {
        DaoSwapModule module = new DaoSwapModule(poolManager, dao, agentAccount);
        emit DaoSwapModuleDeployed(dao, address(module), poolManager);
        return address(module);
    }
}
