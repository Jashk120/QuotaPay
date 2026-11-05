// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal ERC-8421 staking-registry surface used by a company paymaster.
interface IStakingRegistry {
    function addStake(uint32 unstakeDelaySec) external payable;
}
