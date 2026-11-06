// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    HegotaSupport,
    Devnet,
    TxParam,
    FrameParam
} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";

/// Spec §7.3 probe: can a VERIFY frame read a later SENDER frame?
///
/// `scripts/frame-read-probe.mjs` runs this in a VERIFY frame against a SENDER
/// frame with a known target and selector. The revert data reports exactly what
/// the client returned, or the error names the first unsupported opcode.
contract FrameReadProbe is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    error ProbeResult(
        uint256 frameCount,
        uint256 currentFrame,
        uint256 senderMode,
        address senderTarget,
        bytes4 senderSelector,
        uint256 senderDataLength,
        bytes senderHead
    );

    fallback() external {
        uint256 frameCount = txparam(TxParam.FRAME_COUNT);
        uint256 currentFrame = txparam(TxParam.CURRENT_FRAME_INDEX);
        uint256 senderIndex = frameCount - 1;

        uint256 senderMode = frameparam(senderIndex, FrameParam.MODE);
        address senderTarget = address(
            uint160(frameparam(senderIndex, FrameParam.RESOLVED_TARGET))
        );
        bytes4 senderSelector = bytes4(framedataload(0, senderIndex));
        uint256 senderDataLength = frameparam(senderIndex, FrameParam.DATA_LENGTH);
        bytes memory senderHead = framedatacopy(
            0,
            senderDataLength < 64 ? senderDataLength : 64,
            senderIndex
        );

        revert ProbeResult(
            frameCount,
            currentFrame,
            senderMode,
            senderTarget,
            senderSelector,
            senderDataLength,
            senderHead
        );
    }
}
