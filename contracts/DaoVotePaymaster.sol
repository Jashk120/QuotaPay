// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {IStakingRegistry} from "./interfaces/IStakingRegistry.sol";

/// Groth16 verifier generated from circuits/DaoVote.circom.
interface IDaoVoteVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[7] calldata publicInputs
    ) external view returns (bool);
}

interface IDaoCoreVote {
    function proposalSnapshotRoot(uint256 proposalId) external view returns (bytes32);
}

/// Sponsors private DAO votes.
///
/// The paymaster verifies a membership proof against the proposal's snapshot
/// root, burns a per-proposal nullifier and records that this transaction was
/// charged. `DaoCore.castVote` then checks `voteConsumed` and records its own
/// nullifier, so a proof can back exactly one vote.
///
/// The paymaster never learns which member voted. It learns the proposal id,
/// the nullifier, the rotated session key and the public statement only.
contract DaoVotePaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    address public admin;
    address public treasury;
    address public immutable registry;
    address public immutable verifier;
    address public immutable dao;

    /// Maximum transaction cost this sponsor will cover, in wei.
    uint256 public maxSponsorCost;
    uint256 public redeemedCount;

    /// dao => proposalId => vote nullifier.
    mapping(address => mapping(uint256 => mapping(uint256 => bool)))
        public voteConsumed;
    mapping(bytes32 => bool) public chargedTx;

    uint256 public pendingWithdrawals;
    uint64 public withdrawalDelay;
    uint256 public withdrawalAmount;
    uint64 public withdrawalUnlockAt;
    bool private _entered;

    event MaxSponsorCostSet(uint256 maxCost);
    event WithdrawalDelaySet(uint64 delay);
    event Redeemed(
        uint256 indexed proposalId,
        uint256 indexed nullifier,
        address indexed sessionKey,
        uint256 maxCost
    );
    event Charged(bytes32 indexed sigHash, uint256 indexed nullifier);
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
        address verifier_,
        address dao_,
        uint256 maxSponsorCost_,
        uint64 withdrawalDelay_
    ) payable {
        require(admin_ != address(0), "admin=0");
        require(treasury_ != address(0), "treasury=0");
        require(registry_ != address(0), "registry=0");
        require(verifier_ != address(0), "verifier=0");
        require(dao_ != address(0), "dao=0");
        require(maxSponsorCost_ > 0, "maxCost=0");
        admin = admin_;
        treasury = treasury_;
        registry = registry_;
        verifier = verifier_;
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

    /// DEFAULT (pre_verify) frame. Public inputs, in circuit order:
    ///   [root, proposalId, dao, chainId, sessionKey,
    ///    voteNullifier, sessionNullifier]
    function charge(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 proposalId,
        uint256 voteNullifier,
        uint256 sessionNullifier
    ) external {
        require(msg.sender == address(0xaa), "not entrypoint");
        require(proposalId != 0, "proposalId=0");

        bytes32 root = IDaoCoreVote(dao).proposalSnapshotRoot(proposalId);
        require(root != bytes32(0), "unknown proposal");
        require(
            !voteConsumed[dao][proposalId][voteNullifier],
            "already voted"
        );

        address sessionKey = address(uint160(txparam(TxParam.SENDER)));
        uint256 maxCost = txparam(TxParam.MAX_COST);
        require(maxCost <= maxSponsorCost, "max cost");
        require(
            address(this).balance >= maxCost + pendingWithdrawals,
            "insolvent"
        );

        uint256[7] memory publicInputs = [
            uint256(root),
            proposalId,
            uint256(uint160(dao)),
            block.chainid,
            uint256(uint160(sessionKey)),
            voteNullifier,
            sessionNullifier
        ];
        require(
            IDaoVoteVerifier(verifier).verifyProof(a, b, c, publicInputs),
            "bad proof"
        );

        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(!chargedTx[sigHash], "already charged");

        voteConsumed[dao][proposalId][voteNullifier] = true;
        chargedTx[sigHash] = true;
        redeemedCount += 1;

        emit Redeemed(proposalId, voteNullifier, sessionKey, maxCost);
        emit Charged(sigHash, voteNullifier);
    }

    /// Pay frame (empty calldata): approve only after this tx's charge.
    fallback() external payable {
        require(msg.sender == address(0xaa), "not entrypoint");
        require(chargedTx[bytes32(txparam(TxParam.SIG_HASH))], "not charged");
        approve(Scope.PAYMENT);
    }
}
