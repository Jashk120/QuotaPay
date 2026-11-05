// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Configuration used by `CompanyFactory.createCompany` when it deploys a
/// `CompanyPaymaster`. Kept in its own module so the factory and the paymaster
/// share one definition.
struct CompanyConfig {
    bytes32 companyId;
    address admin;
    address treasury;
    uint256 globalCreditLimit;
    uint32 companyPeriodLength;
    uint256 creditPerTx;
    uint256 maxSponsorCost;
    uint64 withdrawalDelay;
}
