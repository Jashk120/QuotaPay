// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// EIP-712 authorization attached to a tier-2 action.
///
/// `nonce` prevents replay and `expiry` prevents stale approvals. The signature
/// is over `Action(daoCore, chainId, actionType, paramsHash, nonce, expiry)`,
/// and `DaoCore` recomputes `paramsHash` from the actual call arguments.
struct AdminAuth {
    uint256 nonce;
    uint256 expiry;
    bytes signature;
}

/// One entry in the AgentAccount policy table.
struct PolicyRule {
    address target;
    bytes4 selector;
    bool allowed;
    uint8 tier;
}

/// Per-token tier-1 spending limits. `periodLength` is in seconds.
struct TokenCapConfig {
    address token;
    uint256 perTx;
    uint256 perPeriod;
    uint64 periodLength;
}

/// Allowlisted treasury asset (mock RWA / NFT) and its tier-1 cap.
struct AssetConfig {
    bytes32 assetId;
    address token;
    uint256 unitPrice;
    uint256 cap;
}

/// Immutable DAO configuration. Mutable policy (caps, rules, admin) is changed
/// through tier-3 proposals after deployment.
struct DaoConfig {
    bytes32 daoId;
    address admin;
    address agentSigner;
    /// VERIFY inspects the SENDER frames when true (spec §4.1). Set false on a
    /// chain whose frame-introspection opcodes are not available (spec §7.3).
    bool frameEnforced;
    uint32 memberPeriodLength;
    uint16 addMemberLimit;
    uint64 votePeriod;
    uint16 quorumBps;
}
