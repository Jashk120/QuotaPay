// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";

interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}

/// Per-user + global quota, charged in a pre_verify (DEFAULT) frame before the
/// pay frame approves. The charge is bound to the transaction via SIG_HASH so
/// the pay frame can prove it happened for this transaction.
///
/// Hardening (vs. the original probe):
/// - `charge()` now requires the sender to be an eligible (credited) user, so an
///   arbitrary frame author can no longer burn the shared `totalSpent` counter.
/// - `charge()` is idempotent per transaction: the same SIG_HASH cannot be
///   charged twice even if it appears in more than one frame.
/// - Caps and `txFee` are owner-mutable and the counters are resettable, so a
///   reached cap is recoverable instead of a permanent brick.
/// - ETH top-ups are accepted and the unspent gas tank is recoverable by the
///   owner.
contract QuotaPayPreVerify is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    address public immutable owner;
    address public immutable registry;

    mapping(address => uint256) public credit;
    mapping(address => uint256) public spent;
    mapping(address => bytes32) public chargedHash;

    uint256 public userCap;
    uint256 public totalSpent;
    uint256 public globalCap;
    uint256 public txFee;

    event CreditSet(address indexed user, uint256 value);
    event CapsSet(uint256 userCap, uint256 globalCap);
    event TxFeeSet(uint256 txFee);
    event SpentReset(address indexed user, uint256 previous);
    event TotalSpentReset(uint256 previous);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        address owner_,
        address registry_,
        uint256 userCap_,
        uint256 globalCap_,
        uint256 txFee_
    ) payable {
        owner = owner_;
        registry = registry_;
        userCap = userCap_;
        globalCap = globalCap_;
        txFee = txFee_;
    }

    function stake(uint32 unstakeDelaySec) external payable {
        IStakingRegistry(registry).addStake{value: msg.value}(unstakeDelaySec);
    }

    function setCredit(address user, uint256 value) external onlyOwner {
        credit[user] = value;
        emit CreditSet(user, value);
    }

    /// Owner may retune the budgets; reaching a cap is no longer terminal.
    function setCaps(uint256 userCap_, uint256 globalCap_) external onlyOwner {
        require(globalCap_ >= totalSpent, "global below spent");
        userCap = userCap_;
        globalCap = globalCap_;
        emit CapsSet(userCap_, globalCap_);
    }

    function setTxFee(uint256 txFee_) external onlyOwner {
        txFee = txFee_;
        emit TxFeeSet(txFee_);
    }

    /// Clear one user's consumed quota (e.g. after topping up their allowance).
    function resetSpent(address user) external onlyOwner {
        emit SpentReset(user, spent[user]);
        spent[user] = 0;
    }

    /// Clear the shared counter. Call `resetSpent` per user as well if needed.
    function resetTotalSpent() external onlyOwner {
        emit TotalSpentReset(totalSpent);
        totalSpent = 0;
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(to, amount);
    }

    /// Top up the paymaster's gas tank. Explicit calldata, so it never shadows
    /// the empty-calldata pay frame handled by `fallback()` (a `receive()` would).
    function deposit() external payable {}

    /// Runs in a DEFAULT frame before the pay frame. Writes the charge.
    function charge() external {
        require(msg.sender == address(0xaa), "not entrypoint");
        address user = address(uint160(txparam(TxParam.SENDER)));

        // Only eligible users may consume quota. Without this, an arbitrary frame
        // author could target charge() from a transaction this paymaster never
        // pays for and burn the shared global counter (griefing DoS).
        require(credit[user] >= 1, "no credit");

        // One charge per transaction: chargedHash is bound to SIG_HASH, which is
        // stable for a given transaction across all of its frames.
        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(chargedHash[user] != sigHash, "already charged");

        require(spent[user] + txFee <= userCap, "user cap");
        require(totalSpent + txFee <= globalCap, "global cap");

        spent[user] += txFee;
        totalSpent += txFee;
        chargedHash[user] = sigHash;
    }

    /// Runs in the pay frame. Only approves if this transaction charged.
    fallback() external payable {
        address user = address(uint160(txparam(TxParam.SENDER)));
        require(credit[user] >= 1, "no credit");
        require(chargedHash[user] == bytes32(txparam(TxParam.SIG_HASH)), "not charged");
        approve(Scope.PAYMENT);
    }
}
