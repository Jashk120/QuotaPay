// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {CompanyConfig} from "./libraries/CompanyTypes.sol";
import {IStakingRegistry} from "./interfaces/IStakingRegistry.sol";

/// One isolated sponsorship instance per company.
///
/// Two independent ledgers, never mixed:
/// - `creditPerTx` / `spentThisPeriod` / `companySpent` are business credit
///   units (not ETH).
/// - ETH solvency is `address(this).balance >= maxSponsorCost + pendingWithdrawals`.
///
/// Authorization and quota state live in this contract's own storage, so a
/// staked instance's validation reads are own-storage reads (canonical-safe).
/// The beneficiary registry is embedded here; there is no separate shared
/// registry read during validation.
contract CompanyPaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    struct Beneficiary {
        bool active;
        uint64 expiry;
        uint64 periodStart;
        uint32 periodLength;
        bytes32 groupId;
        uint256 perPeriodLimit;
        uint256 spentThisPeriod;
    }

    struct WithdrawalRequest {
        uint256 amount;
        uint64 unlockAt;
    }

    address public immutable factory;
    bytes32 public immutable companyId;
    address public immutable registry;

    address public admin;
    address public treasury;

    // Business-credit ledger.
    uint256 public creditPerTx;
    uint256 public globalCreditLimit;
    uint256 public companySpent;
    uint64 public companyPeriodStart;
    uint32 public companyPeriodLength;

    // ETH solvency.
    uint256 public maxSponsorCost;
    uint256 public pendingWithdrawals;
    uint64 public withdrawalDelay;
    WithdrawalRequest public withdrawalRequest;
    bool private _entered;

    // Beneficiary registry (own storage).
    mapping(bytes32 => Beneficiary) public beneficiaries;
    mapping(address => bytes32) public walletBeneficiary;
    mapping(address => bool) public walletActive;

    // Per-transaction charge binding.
    mapping(address => bytes32) public chargedHash;
    // Current wallet per beneficiary, so rotation revokes the previous key.
    mapping(bytes32 => address) public beneficiaryWallet;

    // EIP-712 replay protection.
    mapping(bytes32 => bool) public usedEnrollment;

    bytes32 public constant ENROLLMENT_TYPEHASH = keccak256(
        "Enrollment(bytes32 beneficiaryId,address wallet,uint64 expiry,uint32 periodLength,uint256 perPeriodLimit,bytes32 groupId,uint256 nonce)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    event AdminChanged(address indexed previous, address indexed next);
    event TreasuryChanged(address indexed previous, address indexed next);
    event BeneficiaryEnrolled(
        bytes32 indexed beneficiaryId,
        address indexed wallet,
        uint64 expiry,
        uint32 periodLength,
        uint256 perPeriodLimit,
        bytes32 groupId
    );
    event BeneficiaryRevoked(bytes32 indexed beneficiaryId);
    event WalletRevoked(address indexed wallet);
    event WalletActiveSet(address indexed wallet, bool active);
    event BeneficiaryLimitSet(bytes32 indexed beneficiaryId, uint256 limit);
    event BeneficiarySpentReset(bytes32 indexed beneficiaryId);
    event GlobalLimitSet(uint256 limit);
    event GlobalSpentReset();
    event CreditPerTxSet(uint256 credit);
    event MaxSponsorCostSet(uint256 maxCost);
    event WithdrawalDelaySet(uint64 delay);
    event Charged(bytes32 indexed beneficiaryId, address indexed wallet, uint256 credits);
    event Deposited(address indexed from, uint256 amount);
    event WithdrawalRequested(address indexed requester, uint256 amount, uint64 unlockAt);
    event WithdrawalExecuted(address indexed requester, uint256 amount);
    event WithdrawalCancelled(address indexed requester, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    /// Guards the one external value transfer (treasury payout).
    modifier nonReentrant() {
        require(!_entered, "reentrant");
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address registry_, CompanyConfig memory cfg) payable {
        require(cfg.companyId != bytes32(0), "companyId=0");
        require(registry_ != address(0), "registry=0");
        require(cfg.admin != address(0), "admin=0");
        require(cfg.treasury != address(0), "treasury=0");
        require(cfg.companyPeriodLength > 0, "period=0");
        require(cfg.maxSponsorCost > 0, "maxCost=0");
        require(cfg.creditPerTx > 0, "credit=0");
        require(cfg.globalCreditLimit > 0, "globalLimit=0");

        factory = msg.sender;
        companyId = cfg.companyId;
        registry = registry_;
        admin = cfg.admin;
        treasury = cfg.treasury;

        globalCreditLimit = cfg.globalCreditLimit;
        companyPeriodLength = cfg.companyPeriodLength;
        companyPeriodStart = uint64(block.timestamp);
        creditPerTx = cfg.creditPerTx;

        maxSponsorCost = cfg.maxSponsorCost;
        withdrawalDelay = cfg.withdrawalDelay;
    }

    // ------------------------------------------------------------------ admin --

    function setAdmin(address next) external onlyAdmin {
        require(next != address(0), "admin=0");
        emit AdminChanged(admin, next);
        admin = next;
    }

    function setTreasury(address next) external onlyAdmin {
        require(next != address(0), "treasury=0");
        emit TreasuryChanged(treasury, next);
        treasury = next;
    }

    function setCreditPerTx(uint256 credit) external onlyAdmin {
        require(credit > 0, "credit=0");
        creditPerTx = credit;
        emit CreditPerTxSet(credit);
    }

    function setMaxSponsorCost(uint256 maxCost) external onlyAdmin {
        require(maxCost > 0, "maxCost=0");
        maxSponsorCost = maxCost;
        emit MaxSponsorCostSet(maxCost);
    }

    function setWithdrawalDelay(uint64 delay) external onlyAdmin {
        withdrawalDelay = delay;
        emit WithdrawalDelaySet(delay);
    }

    function setGlobalCreditLimit(uint256 limit) external onlyAdmin {
        require(limit > 0, "limit=0");
        require(limit >= companySpent, "limit below spent");
        globalCreditLimit = limit;
        emit GlobalLimitSet(limit);
    }

    function setCompanyPeriod(uint32 periodLength) external onlyAdmin {
        require(periodLength > 0, "period=0");
        companyPeriodLength = periodLength;
    }

    function resetCompanySpent() external onlyAdmin {
        companySpent = 0;
        companyPeriodStart = uint64(block.timestamp);
        emit GlobalSpentReset();
    }

    // -------------------------------------------------------------- enrollment --

    function enroll(
        bytes32 beneficiaryId,
        address wallet,
        uint64 expiry,
        uint32 periodLength,
        uint256 perPeriodLimit,
        bytes32 groupId
    ) external onlyAdmin {
        _enroll(beneficiaryId, wallet, expiry, periodLength, perPeriodLimit, groupId);
    }

    /// Backend-signed enrollment. The company admin signs an EIP-712
    /// `Enrollment`; the wallet (or anyone) submits it on-chain.
    function enrollSigned(
        bytes32 beneficiaryId,
        address wallet,
        uint64 expiry,
        uint32 periodLength,
        uint256 perPeriodLimit,
        bytes32 groupId,
        uint256 nonce,
        bytes calldata signature
    ) external {
        bytes32 structHash = keccak256(
            abi.encode(
                ENROLLMENT_TYPEHASH,
                beneficiaryId,
                wallet,
                expiry,
                periodLength,
                perPeriodLimit,
                groupId,
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
        require(!usedEnrollment[digest], "enrollment used");
        require(_recoverSigner(digest, signature) == admin, "bad signature");
        usedEnrollment[digest] = true;
        _enroll(beneficiaryId, wallet, expiry, periodLength, perPeriodLimit, groupId);
    }

    function revokeBeneficiary(bytes32 beneficiaryId) external onlyAdmin {
        beneficiaries[beneficiaryId].active = false;
        emit BeneficiaryRevoked(beneficiaryId);
    }

    function revokeWallet(address wallet) external onlyAdmin {
        walletActive[wallet] = false;
        emit WalletRevoked(wallet);
    }

    function setWalletActive(address wallet, bool active) external onlyAdmin {
        walletActive[wallet] = active;
        emit WalletActiveSet(wallet, active);
    }

    function setBeneficiaryLimit(bytes32 beneficiaryId, uint256 limit) external onlyAdmin {
        Beneficiary storage b = beneficiaries[beneficiaryId];
        require(b.periodStart != 0, "unknown beneficiary");
        require(limit > 0, "limit=0");
        require(limit >= b.spentThisPeriod, "limit below spent");
        b.perPeriodLimit = limit;
        emit BeneficiaryLimitSet(beneficiaryId, limit);
    }

    function resetBeneficiarySpent(bytes32 beneficiaryId) external onlyAdmin {
        Beneficiary storage b = beneficiaries[beneficiaryId];
        require(b.periodStart != 0, "unknown beneficiary");
        b.spentThisPeriod = 0;
        b.periodStart = uint64(block.timestamp);
        emit BeneficiarySpentReset(beneficiaryId);
    }

    // ------------------------------------------------------------- views --

    /// Whether `wallet` may currently be sponsored. This mirrors `charge()`:
    /// it is false unless the wallet would actually pass the beneficiary limit,
    /// the company limit, and the ETH solvency check right now (including the
    /// lazily-applied period rollover).
    function isAuthorized(address wallet) external view returns (bool) {
        bytes32 beneficiaryId = walletBeneficiary[wallet];
        if (beneficiaryId == bytes32(0) || !walletActive[wallet]) return false;

        Beneficiary storage b = beneficiaries[beneficiaryId];
        if (!b.active) return false;
        if (b.expiry != 0 && block.timestamp > uint256(b.expiry)) return false;

        uint256 credits = creditPerTx;
        if (credits == 0) return false;

        uint256 spent = b.spentThisPeriod;
        uint256 periodLength = b.periodLength == 0 ? companyPeriodLength : b.periodLength;
        if (block.timestamp >= uint256(b.periodStart) + periodLength) spent = 0;
        if (spent + credits > b.perPeriodLimit) return false;

        uint256 spentCompany = companySpent;
        if (block.timestamp >= uint256(companyPeriodStart) + companyPeriodLength) {
            spentCompany = 0;
        }
        if (spentCompany + credits > globalCreditLimit) return false;

        // Solvency is deliberately not part of `isAuthorized`: it is a
        // funding concern reported by `availableBalance()`, not an
        // authorization/quota state. `charge()` still enforces it.
        return true;
    }

    /// ETH that can still back a new sponsorship without touching reserved
    /// withdrawal funds.
    function availableBalance() external view returns (uint256) {
        uint256 balance = address(this).balance;
        return balance > pendingWithdrawals ? balance - pendingWithdrawals : 0;
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
        require(withdrawalRequest.amount == 0, "pending request");
        require(address(this).balance >= pendingWithdrawals + amount, "insufficient available");
        uint64 unlockAt = uint64(block.timestamp) + withdrawalDelay;
        withdrawalRequest = WithdrawalRequest({amount: amount, unlockAt: unlockAt});
        pendingWithdrawals += amount;
        emit WithdrawalRequested(msg.sender, amount, unlockAt);
    }

    function executeWithdrawal() external onlyAdmin nonReentrant {
        WithdrawalRequest storage req = withdrawalRequest;
        require(req.amount > 0, "no request");
        require(block.timestamp >= req.unlockAt, "not unlocked");
        uint256 amount = req.amount;
        require(address(this).balance >= amount, "insufficient balance");
        req.amount = 0;
        req.unlockAt = 0;
        pendingWithdrawals -= amount;
        (bool ok, ) = treasury.call{value: amount}("");
        require(ok, "withdraw failed");
        emit WithdrawalExecuted(msg.sender, amount);
    }

    function cancelWithdrawal() external onlyAdmin {
        WithdrawalRequest storage req = withdrawalRequest;
        uint256 amount = req.amount;
        require(amount > 0, "no request");
        req.amount = 0;
        req.unlockAt = 0;
        pendingWithdrawals -= amount;
        emit WithdrawalCancelled(msg.sender, amount);
    }

    // ------------------------------------------------------- EIP-8141 frames --

    /// `pre_verify` (DEFAULT) frame: authorize the wallet, roll its period,
    /// check the credit ledgers and ETH solvency, then record the charge.
    function charge() external {
        require(msg.sender == address(0xaa), "not entrypoint");
        address wallet = address(uint160(txparam(TxParam.SENDER)));

        bytes32 beneficiaryId = walletBeneficiary[wallet];
        require(beneficiaryId != bytes32(0), "wallet not enrolled");
        require(walletActive[wallet], "wallet revoked");

        Beneficiary storage b = beneficiaries[beneficiaryId];
        require(b.active, "beneficiary revoked");
        require(b.expiry == 0 || block.timestamp <= uint256(b.expiry), "beneficiary expired");

        _rollBeneficiary(b);
        _rollCompany();

        // Idempotency first, matching QuotaPayPreVerify and giving a stable
        // revert reason for duplicate submissions.
        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(chargedHash[wallet] != sigHash, "already charged");

        uint256 credits = creditPerTx;
        require(b.spentThisPeriod + credits <= b.perPeriodLimit, "beneficiary limit");
        require(companySpent + credits <= globalCreditLimit, "company limit");
        require(address(this).balance >= maxSponsorCost + pendingWithdrawals, "insolvent");

        b.spentThisPeriod += credits;
        companySpent += credits;
        chargedHash[wallet] = sigHash;

        emit Charged(beneficiaryId, wallet, credits);
    }

    /// Pay frame (empty calldata): approve payment only after a matching charge.
    fallback() external payable {
        require(msg.sender == address(0xaa), "not entrypoint");
        address wallet = address(uint160(txparam(TxParam.SENDER)));
        require(chargedHash[wallet] == bytes32(txparam(TxParam.SIG_HASH)), "not charged");
        approve(Scope.PAYMENT);
    }

    // -------------------------------------------------------------- internal --

    function _enroll(
        bytes32 beneficiaryId,
        address wallet,
        uint64 expiry,
        uint32 periodLength,
        uint256 perPeriodLimit,
        bytes32 groupId
    ) internal {
        require(beneficiaryId != bytes32(0), "beneficiary=0");
        require(wallet != address(0), "wallet=0");

        // Key swap: the previous wallet of this beneficiary loses
        // authorization, and a wallet arriving from another beneficiary
        // deactivates that prior beneficiary instead of orphaning it.
        address prevWallet = beneficiaryWallet[beneficiaryId];
        if (prevWallet != address(0) && prevWallet != wallet) {
            walletActive[prevWallet] = false;
            walletBeneficiary[prevWallet] = bytes32(0);
        }
        bytes32 priorBeneficiary = walletBeneficiary[wallet];
        if (priorBeneficiary != bytes32(0) && priorBeneficiary != beneficiaryId) {
            beneficiaries[priorBeneficiary].active = false;
        }
        beneficiaryWallet[beneficiaryId] = wallet;

        Beneficiary storage b = beneficiaries[beneficiaryId];
        // Preserve an existing period/spend so rotating to a new wallet does not
        // reset the allowance for a stable beneficiary identity.
        if (b.periodStart == 0) {
            b.periodStart = uint64(block.timestamp);
        }
        b.active = true;
        b.expiry = expiry;
        b.periodLength = periodLength;
        b.perPeriodLimit = perPeriodLimit;
        b.groupId = groupId;

        walletBeneficiary[wallet] = beneficiaryId;
        walletActive[wallet] = true;

        emit BeneficiaryEnrolled(beneficiaryId, wallet, expiry, periodLength, perPeriodLimit, groupId);
    }

    function _rollBeneficiary(Beneficiary storage b) internal {
        uint256 periodLength = b.periodLength == 0 ? companyPeriodLength : b.periodLength;
        if (block.timestamp >= uint256(b.periodStart) + periodLength) {
            b.periodStart = uint64(block.timestamp);
            b.spentThisPeriod = 0;
        }
    }

    function _rollCompany() internal {
        if (block.timestamp >= uint256(companyPeriodStart) + companyPeriodLength) {
            companyPeriodStart = uint64(block.timestamp);
            companySpent = 0;
        }
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("QuotaPay"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        // Reject malleable (high-s) signatures.
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "bad s"
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "bad signature");
        return signer;
    }
}
