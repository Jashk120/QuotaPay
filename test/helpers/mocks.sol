// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal staking-registry stand-in: records forwarded stake.
contract MockRegistry {
    uint256 public totalStaked;
    uint32 public lastDelay;
    address public lastStaker;

    function addStake(uint32 unstakeDelaySec) external payable {
        totalStaked += msg.value;
        lastDelay = unstakeDelaySec;
        lastStaker = msg.sender;
    }
}

/// Treasury that rejects all ETH (griefing / lockup probe).
contract RevertingTreasury {
    receive() external payable {
        revert("nope");
    }
}
