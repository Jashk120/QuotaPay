// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CompanyPaymaster} from "./CompanyPaymaster.sol";
import {CompanyConfig} from "./libraries/CompanyTypes.sol";

/// Deploys one isolated `CompanyPaymaster` per company.
///
/// Each instance owns its own balance, beneficiary registry, limits and admin,
/// so one company's spending cannot consume another's budget. `governance` (when
/// non-zero) may create an instance on behalf of an admin; otherwise a company
/// is self-service and the creator must be the admin.
contract CompanyFactory {
    struct Company {
        address paymaster;
        address admin;
        address treasury;
    }

    address public immutable governance;
    address public immutable registry;

    mapping(bytes32 => Company) public companies;
    mapping(address => bytes32) public companyOf;

    event CompanyCreated(
        bytes32 indexed companyId,
        address indexed admin,
        address indexed paymaster,
        address treasury
    );

    constructor(address governance_, address registry_) {
        governance = governance_;
        registry = registry_;
    }

    function createCompany(CompanyConfig calldata cfg) external payable returns (address paymaster) {
        require(cfg.companyId != bytes32(0), "companyId=0");
        require(
            cfg.admin == msg.sender || (governance != address(0) && msg.sender == governance),
            "not authorized"
        );
        require(companies[cfg.companyId].paymaster == address(0), "company exists");
        require(cfg.admin != address(0), "admin=0");
        require(cfg.treasury != address(0), "treasury=0");
        // A company must arrive with at least one sponsorship's worth of ETH,
        // otherwise it is born insolvent and every charge() reverts.
        require(msg.value >= cfg.maxSponsorCost, "insufficient funding");

        paymaster = address(new CompanyPaymaster{value: msg.value}(registry, cfg));

        companies[cfg.companyId] = Company({
            paymaster: paymaster,
            admin: cfg.admin,
            treasury: cfg.treasury
        });
        companyOf[paymaster] = cfg.companyId;

        emit CompanyCreated(cfg.companyId, cfg.admin, paymaster, cfg.treasury);
    }
}
