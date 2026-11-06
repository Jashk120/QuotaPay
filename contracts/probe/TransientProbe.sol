// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Phase 0 probe (UNISWAP-V4.md §9): the v4 singleton needs EIP-1153
/// (`TSTORE`/`TLOAD`) for flash accounting and Cancun opcodes (`MCOPY`,
/// `PUSH0`) for its build output.
///
/// This contract is compiled with `evmVersion: "cancun"` by
/// `scripts/v4-probe.mjs`; it is deliberately not part of the shanghai DAO
/// build, which must keep compiling for the existing ganache suite.
contract TransientProbe {
    function roundTrip(uint256 value) external returns (uint256 out) {
        assembly ("memory-safe") {
            tstore(0, value)
            out := tload(0)
        }
    }

    function copy(uint256 value) external pure returns (uint256 out) {
        assembly ("memory-safe") {
            mstore(0x00, value)
            mcopy(0x20, 0x00, 0x20)
            out := mload(0x20)
        }
    }
}
