// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Separate policy contract. Not an entity of any frame transaction: it is neither
/// the sender, the payer, nor a factory. A staked payer reading this is a
/// third-party storage read.
contract ExposureController {
    address public immutable owner;
    mapping(address => uint256) public exposure;

    constructor(address owner_) {
        owner = owner_;
    }

    function setExposure(address user, uint256 value) external {
        require(msg.sender == owner, "not owner");
        exposure[user] = value;
    }
}
