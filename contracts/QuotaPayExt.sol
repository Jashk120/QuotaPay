// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HegotaSupport, Devnet, Scope, TxParam} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";

interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}

interface IExposureController {
    function exposure(address user) external view returns (uint256);
}

/// Staked paymaster that reads BOTH its own credit mapping and a separate policy
/// contract's exposure mapping during the pay frame.
contract QuotaPayExt is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    address public immutable owner;
    address public immutable registry;
    address public immutable controller;

    mapping(address => uint256) public credit;

    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address owner_, address registry_, address controller_) payable {
        owner = owner_;
        registry = registry_;
        controller = controller_;
    }

    function stake(uint32 unstakeDelaySec) external payable {
        IStakingRegistry(registry).addStake{value: msg.value}(unstakeDelaySec);
    }

    function setCredit(address user, uint256 value) external onlyOwner {
        credit[user] = value;
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero address");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(to, amount);
    }

    /// Top up the gas tank with explicit calldata (never shadows the pay frame).
    function deposit() external payable {}

    fallback() external payable {
        address user = address(uint160(txparam(TxParam.SENDER)));
        require(credit[user] >= 1, "no credit");                       // own storage
        require(IExposureController(controller).exposure(user) == 0, "exposed"); // third-party storage
        approve(Scope.PAYMENT);
    }
}
