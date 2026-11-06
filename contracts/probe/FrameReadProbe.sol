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
/// frame with a known target and selector. The probe performs exactly the reads
/// `AgentAccount` needs, so a client that rejects them cannot be mistaken for a
/// client that only rejects optional diagnostics. On success it reverts with
/// `ProbeResult`; otherwise the client's own error is the result.
contract FrameReadProbe is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    error ProbeResult(
        uint256 frameCount,
        uint256 currentFrame,
        uint256 senderMode,
        address senderTarget,
        bytes4 senderSelector
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

        revert ProbeResult(
            frameCount,
            currentFrame,
            senderMode,
            senderTarget,
            senderSelector
        );
    }
}
