// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {IStakingRegistry} from "./interfaces/IStakingRegistry.sol";

/// Deposit-backed, session-bound blind-token paymaster.
///
/// The company blind-signs a token payload (RSA). At redemption the paymaster:
///   1. verifies the blind signature with the modexp precompile,
///   2. binds the token to `tx.sender` (a rotating session key),
///   3. burns a persistent nullifier (single use, epoch-scoped),
///   4. checks ETH solvency and records the charge for the pay frame.
///
/// The paymaster never sees the beneficiary identity or wallet registry: only a
/// rotating session key, the token's public fields, and its nullifier.
contract BlindTokenPaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    struct Token {
        address sessionKey;
        address paymaster;
        uint256 chainId;
        uint256 epoch;
        uint256 maxCost;
        bytes32 serial;
        bytes signature; // RSA signature, length == issuer modulus
    }

    address public admin;
    address public immutable registry;

    bytes public issuerModulus;
    bytes public issuerExponent;
    uint256 public epoch;
    uint256 public maxSponsorCost;
    uint256 public redeemedCount;

    // Persistent nullifier set: survives the sidecar's frame simulation.
    mapping(bytes32 => bool) public usedNullifier;
    mapping(bytes32 => bool) public chargedTx;

    uint256 public pendingWithdrawals;
    uint64 public withdrawalDelay;
    uint256 public withdrawalAmount;
    uint64 public withdrawalUnlockAt;
    bool private _entered;

    event IssuerSet(bytes modulus, bytes exponent);
    event EpochSet(uint256 epoch);
    event MaxSponsorCostSet(uint256 maxCost);
    event TokenRedeemed(bytes32 indexed nullifier, address indexed sessionKey, uint256 maxCost);
    event Charged(bytes32 indexed sigHash, bytes32 indexed nullifier);
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
        address registry_,
        uint256 maxSponsorCost_,
        bytes memory modulus_,
        bytes memory exponent_
    ) payable {
        require(admin_ != address(0), "admin=0");
        require(registry_ != address(0), "registry=0");
        require(maxSponsorCost_ > 0, "maxCost=0");
        require(modulus_.length >= 32, "modulus short");
        require(exponent_.length > 0, "exp=0");
        admin = admin_;
        registry = registry_;
        maxSponsorCost = maxSponsorCost_;
        issuerModulus = modulus_;
        issuerExponent = exponent_;
    }

    // ------------------------------------------------------------------ admin --

    function setIssuer(bytes calldata modulus_, bytes calldata exponent_) external onlyAdmin {
        require(modulus_.length >= 32, "modulus short");
        require(exponent_.length > 0, "exp=0");
        issuerModulus = modulus_;
        issuerExponent = exponent_;
        emit IssuerSet(modulus_, exponent_);
    }

    function setEpoch(uint256 epoch_) external onlyAdmin {
        epoch = epoch_;
        emit EpochSet(epoch_);
    }

    function setMaxSponsorCost(uint256 maxCost_) external onlyAdmin {
        require(maxCost_ > 0, "maxCost=0");
        maxSponsorCost = maxCost_;
        emit MaxSponsorCostSet(maxCost_);
    }

    function setWithdrawalDelay(uint64 delay) external onlyAdmin {
        withdrawalDelay = delay;
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
        (bool ok, ) = msg.sender.call{value: amount}("");
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

    // ------------------------------------------------------------- token view --

    /// View helper for tests/UI and off-chain preflight: verifies the blind RSA
    /// signature over the token's public fields.
    function verifyToken(Token calldata token) external view returns (bool) {
        return _verifyToken(token);
    }

    // ------------------------------------------------------- EIP-8141 frames --

    /// `pre_verify` (DEFAULT) frame. The token is supplied in the frame data.
    function charge(Token calldata token) external {
        require(msg.sender == address(0xaa), "not entrypoint");
        address sender = address(uint160(txparam(TxParam.SENDER)));

        require(token.sessionKey == sender, "wrong session");
        require(token.paymaster == address(this), "wrong paymaster");
        require(token.chainId == block.chainid, "wrong chain");
        require(token.epoch == epoch, "wrong epoch");
        require(token.maxCost >= maxSponsorCost, "maxCost low");

        bytes32 nullifier = keccak256(abi.encode(token.serial, token.epoch));
        require(!usedNullifier[nullifier], "token used");
        require(_verifyToken(token), "bad token");
        require(address(this).balance >= maxSponsorCost + pendingWithdrawals, "insolvent");

        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(!chargedTx[sigHash], "already charged");

        usedNullifier[nullifier] = true;
        chargedTx[sigHash] = true;
        redeemedCount += 1;

        emit TokenRedeemed(nullifier, token.sessionKey, token.maxCost);
        emit Charged(sigHash, nullifier);
    }

    /// Pay frame (empty calldata): approve only after this tx's charge.
    fallback() external payable {
        require(msg.sender == address(0xaa), "not entrypoint");
        require(chargedTx[bytes32(txparam(TxParam.SIG_HASH))], "not charged");
        approve(Scope.PAYMENT);
    }

    // -------------------------------------------------------------- internal --

    function _verifyToken(Token calldata token) internal view returns (bool) {
        bytes32 messageHash = keccak256(
            abi.encode(
                token.sessionKey,
                token.paymaster,
                token.chainId,
                token.epoch,
                token.maxCost,
                token.serial
            )
        );
        return _rsaVerify(messageHash, token.signature, issuerModulus, issuerExponent);
    }

    /// Textbook RSA verification over a 32-byte message hash. Production should
    /// use RSA-FDH/PSS (full-domain hash) and a 2048-bit modulus; this shape is
    /// chosen to fit the stock 100k validation prefix.
    function _rsaVerify(
        bytes32 messageHash,
        bytes calldata signature,
        bytes memory modulus,
        bytes memory exponent
    ) internal view returns (bool) {
        if (signature.length != modulus.length || modulus.length < 32) return false;

        bytes memory input = abi.encodePacked(
            uint256(signature.length),
            uint256(exponent.length),
            uint256(modulus.length),
            signature,
            exponent,
            modulus
        );
        (bool ok, bytes memory output) = address(0x05).staticcall(input);
        if (!ok || output.length != modulus.length) return false;

        // The expected value is a 32-byte hash left-padded to the modulus size.
        uint256 words = (output.length - 32) / 32;
        for (uint256 i = 0; i < words; i++) {
            bytes32 word;
            assembly ("memory-safe") {
                word := mload(add(add(output, 0x20), mul(i, 32)))
            }
            if (word != bytes32(0)) return false;
        }
        bytes32 actual;
        assembly ("memory-safe") {
            actual := mload(add(add(output, 0x20), sub(mload(output), 32)))
        }
        return actual == messageHash;
    }
}
