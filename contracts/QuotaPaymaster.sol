// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";

interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}

/// Minimal gate contract: a paymaster that reads its OWN storage during the pay
/// frame. If a staked paymaster entity is granted own-storage access, this is
/// admitted by the standard alt mempool and rejected by the canonical one.
///
/// This is the legacy/admission probe (superseded by QuotaPayPreVerify for real
/// enforcement). `charge()` is provided so `spent` can actually be incremented
/// in a pre_verify-style flow instead of being a dead mapping; existing
/// pay-frame-only probes still work because `spent` only grows when `charge()`
/// is called.
contract QuotaPaymaster is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    address public immutable owner;
    address public immutable registry;

    mapping(address => uint256) public spent;
    mapping(address => bytes32) public chargedHash;
    uint256 public cap;

    event CapSet(uint256 cap);
    event SpentSet(address indexed user, uint256 value);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address owner_, address registry_, uint256 cap_) payable {
        owner = owner_;
        registry = registry_;
        cap = cap_;
    }

    /// The paymaster stakes itself: the registry keys stake off msg.sender, and here that is this contract.
    function stake(uint32 unstakeDelaySec) external payable {
        IStakingRegistry(registry).addStake{value: msg.value}(unstakeDelaySec);
    }

    function setCap(uint256 cap_) external onlyOwner {
        cap = cap_;
        emit CapSet(cap_);
    }

    function setSpent(address user, uint256 value) external onlyOwner {
        spent[user] = value;
        emit SpentSet(user, value);
    }

    /// Charges one unit of the sender's quota in a pre_verify (DEFAULT) frame.
    function charge() external {
        require(msg.sender == address(0xaa), "not entrypoint");
        address user = address(uint160(txparam(TxParam.SENDER)));

        bytes32 sigHash = bytes32(txparam(TxParam.SIG_HASH));
        require(chargedHash[user] != sigHash, "already charged");

        spent[user] += 1;
        chargedHash[user] = sigHash;
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(to, amount);
    }

    /// Top up the gas tank with explicit calldata (never shadows the pay frame).
    function deposit() external payable {}

    /// VERIFY/pay frame lands here. `txparam(SENDER)` is the user being sponsored.
    fallback() external payable {
        address user = address(uint160(txparam(TxParam.SENDER)));
        require(spent[user] < cap, "quota");
        approve(Scope.PAYMENT);
    }
}
