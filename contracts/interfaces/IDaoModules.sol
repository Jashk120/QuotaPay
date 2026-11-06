// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// The subset of `AgentAccount` that `DaoCore` and `DaoFactory` mutate.
interface IAgentAccount {
    function setRule(address target, bytes4 selector, bool allowed, uint8 tier) external;
    function setAgentSigner(address next) external;
    function setAdmin(address next) external;
    function setFrameEnforced(bool enforced) external;
    function pause(bool paused) external;
    function agentSigner() external view returns (address);
    function paused() external view returns (bool);
}

/// Treasury asset module (mock marketplace / RWA registry).
interface IAssetModule {
    function allowAsset(bytes32 assetId, address token, uint256 unitPrice, uint256 cap) external;
    function setAssetCap(bytes32 assetId, uint256 cap) external;
    function buy(bytes32 assetId, uint256 amount) external;
    function buyAboveCap(bytes32 assetId, uint256 amount) external;
    function dispose(bytes32 assetId, uint256 amount, address to) external;
    function assetInfo(bytes32 assetId)
        external
        view
        returns (address token, uint256 unitPrice, uint256 cap);
    function holdings(address owner, bytes32 assetId) external view returns (uint256);
}

/// Read-only hook `DaoCore` uses to accept a private vote exactly once.
interface IDaoVotePaymaster {
    function voteConsumed(address dao, uint256 proposalId, uint256 nullifier)
        external
        view
        returns (bool);

    function voteChoice(address dao, uint256 proposalId, uint256 nullifier)
        external
        view
        returns (bool);
}
