// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {IStakingRegistry} from "./interfaces/IStakingRegistry.sol";

interface IDaoAgentView {
    function agentAccount() external view returns (address);
}

/// Sponsors tier-1/tier-2 agent transactions from a funded balance.
///
/// This is the gas half of spec §7.1. It approves payment only when:
///   - the transaction sender is the DAO's `AgentAccount`;
///   - the maximum transaction cost is inside `maxSponsorCost`;
///   - the paymaster is solvent for that cost plus pending withdrawals.
///
/// The agent still has to pass `AgentAccount`'s policy check; this contract only
/// decides who pays. Funding and withdrawals are admin-controlled.
contract DaoGasPaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    address public immutable dao;
    address public immutable registry;
    address public admin;
    address public treasury;

    uint256 public maxSponsorCost;
    uint256 public chargedCount;
    mapping(bytes32 => bool) public chargedTx;

    uint256 public pendingWithdrawals;
    uint64 public withdrawalDelay;
    uint256 public withdrawalAmount;
    uint64 public withdrawalUnlockAt;
    bool private _entered;

    event MaxSponsorCostSet(uint256 maxCost);
    event WithdrawalDelaySet(uint64 delay);
    event Charged(bytes32 indexed sigHash, address indexed agent, uint256 maxCost);
    event Deposited(address indexed from, uint256 amount);
    event WithdrawalRequested(uint256 amount, uint64 unlockAt);
    event WithdrawalExecuted(uint256 amount);
    event WithdrawalCancelled(uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier nonReentrant() {
        require(!_entered, "reentrant");
        _entered = true;
        _;
        _entered = false;
    }

    constructor(
        address admin_,
        address treasury_,
        address registry_,
        address dao_,
        uint256 maxSponsorCost_,
        uint64 withdrawalDelay_
    ) payable {
        require(admin_ != address(0), "admin=0");
        require(treasury_ != address(0), "treasury=0");
        require(registry_ != address(0), "registry=0");
        require(dao_ != address(0), "dao=0");
        require(maxSponsorCost_ > 0, "maxCost=0");
        admin = admin_;
        treasury = treasury_;
        registry = registry_;
        dao = dao_;
        maxSponsorCost = maxSponsorCost_;
        withdrawalDelay = withdrawalDelay_;
    }

    // ------------------------------------------------------------------ admin --

    function setMaxSponsorCost(uint256 maxCost_) external onlyAdmin {
        require(maxCost_ > 0, "maxCost=0");
        maxSponsorCost = maxCost_;
        emit MaxSponsorCostSet(maxCost_);
    }

    function setWithdrawalDelay(uint64 delay) external onlyAdmin {
        withdrawalDelay = delay;
        emit WithdrawalDelaySet(delay);
    }

    // ------------------------------------------------- funding / withdrawals --

    function deposit() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function stake(uint32 unstakeDelaySec) external payable onlyAdmin {
        IStakingRegistry(registry).addStake{value: msg.value}(unstakeDelaySec);
    }

    function requestWithdrawal(uint256 amount) external onlyAdmin {
        require(amount > 0, "amount=0");
        require(withdrawalAmount == 0, "pending request");
        require(address(this).balance >= pendingWithdrawals + amount, "insufficient");
        withdrawalAmount = amount;
        withdrawalUnlockAt = uint64(block.timestamp) + withdrawalDelay;
        pendingWithdrawals += amount;
        emit WithdrawalRequested(amount, withdrawalUnlockAt);
    }

    function executeWithdrawal() external onlyAdmin nonReentrant {
        uint256 amount = withdrawalAmount;
        require(amount > 0, "no request");
        require(block.timestamp >= withdrawalUnlockAt, "not unlocked");
        require(address(this).balance >= amount, "insufficient balance");
        withdrawalAmount = 0;
        withdrawalUnlockAt = 0;
        pendingWithdrawals -= amount;
        (bool ok, ) = treasury.call{value: amount}("");
        require(ok, "withdraw failed");
        emit WithdrawalExecuted(amount);
    }

    function cancelWithdrawal() external onlyAdmin {
        uint256 amount = withdrawalAmount;
        require(amount > 0, "no request");
        withdrawalAmount = 0;
        withdrawalUnlockAt = 0;
        pendingWithdrawals -= amount;
        emit WithdrawalCancelled(amount);
    }

    // ------------------------------------------------------- EIP-8141 frames --

    /// DEFAULT (pre_verify) frame.
    function charge() external {
        require(msg.sender == address(0xaa), "not entrypoint");
        address agent = IDaoAgentView(dao).agentAccount();
        require(
            address(uint160(txparam(TxParam.SENDER))) == agent,
            "not agent"
        );

        uint256 maxCost = txparam(TxParam.MAX_COST);
        // Fail closed on a chain without the ethrex MAX_COST extension.
        require(maxCost > 0, "maxCost=0");
        require(maxCost <= maxSponsorCost, "max cost");
        require(
            address(this).balance >= maxCost + pendingWithdrawals,
            "insolvent"
        );

        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(!chargedTx[sigHash], "already charged");
        chargedTx[sigHash] = true;
        chargedCount += 1;
        emit Charged(sigHash, agent, maxCost);
    }

    /// Empty calldata is overloaded:
    ///   - a value-bearing transfer is a treasury top-up (e.g. after a v4 swap);
    ///   - the entrypoint's pay frame is value-free and approves payment.
    /// Do not add `receive()`: it would swallow the pay frame.
    fallback() external payable {
        if (msg.value > 0 && msg.sender != address(0xaa)) {
            emit Deposited(msg.sender, msg.value);
            return;
        }
        require(msg.sender == address(0xaa), "not entrypoint");
        require(chargedTx[bytes32(txparam(TxParam.SIG_HASH))], "not charged");
        approve(Scope.PAYMENT);
    }
}
