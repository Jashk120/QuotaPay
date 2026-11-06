// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DaoConfig} from "../libraries/DaoTypes.sol";
import {DaoCore} from "../DaoCore.sol";

/// Deploys one `DaoCore`.
///
/// Kept separate from `DaoFactory` so no single contract carries the creation
/// code of every child. `DaoFactory` still orchestrates the whole DAO in one
/// transaction; this contract is deployed once per chain.
contract DaoCoreFactory {
    event DaoCoreDeployed(address indexed daoCore);

    function deploy(DaoConfig calldata cfg) external returns (address) {
        DaoCore core = new DaoCore(cfg);
        emit DaoCoreDeployed(address(core));
        return address(core);
    }
}
