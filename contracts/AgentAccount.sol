// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    HegotaSupport,
    Devnet,
    Scope,
    TxParam,
    FrameParam,
    FrameMode,
    SigParam
} from "@forshtat/hegota-support/contracts/HegotaSupport.sol";
import {PolicyRule} from "./libraries/DaoTypes.sol";

/// The account an agent transacts through (spec §4.1).
///
/// `AgentAccount` is `tx.sender`. Its VERIFY frame does two things:
///
///   1. Pins the transaction signature to `agentSigner`. The signature is a
///      normal SECP256K1 signature entry (scheme 1), so the protocol verifies
///      it and the account only checks the resolved signer. Keeping the
///      signature out of the VERIFY frame data avoids the circular dependency
///      of signing a payload that contains the signature.
///   2. When `frameEnforced` is true, scans the post-prefix SENDER frames and
///      rejects any target/selector pair missing from the policy table.
///
/// The policy table is mutable only by `DaoCore` (tier-3 proposals). The admin
/// can pause the account directly, without the agent, as the emergency valve.
contract AgentAccount is HegotaSupport(Devnet.ERC8421_WORKSHOP) {
    address public constant ENTRY_POINT = address(0xaa);

    struct Rule {
        bool allowed;
        uint8 tier;
    }

    address public immutable factory;
    address public dao;
    address public admin;
    address public agentSigner;
    bool public frameEnforced;
    bool public paused;

    mapping(address => mapping(bytes4 => Rule)) public rules;

    event DaoSet(address indexed dao);
    event AdminSet(address indexed previous, address indexed next);
    event AgentSignerSet(address indexed previous, address indexed next);
    event RuleSet(address indexed target, bytes4 indexed selector, bool allowed, uint8 tier);
    event FrameEnforcedSet(bool enforced);
    event PausedSet(bool paused);

    modifier onlyFactory() {
        require(msg.sender == factory, "not factory");
        _;
    }

    modifier onlyDao() {
        require(msg.sender == dao, "not dao");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    constructor(address admin_, address agentSigner_, bool frameEnforced_) {
        require(admin_ != address(0), "admin=0");
        require(agentSigner_ != address(0), "signer=0");
        factory = msg.sender;
        admin = admin_;
        agentSigner = agentSigner_;
        frameEnforced = frameEnforced_;
    }

    /// One-time wiring by the factory. `dao` is the only address allowed to
    /// mutate the policy table.
    function initializeDao(address dao_) external onlyFactory {
        require(dao == address(0), "dao set");
        require(dao_ != address(0), "dao=0");
        dao = dao_;
        emit DaoSet(dao_);
    }

    // ------------------------------------------------------------- policy --

    function setRule(address target, bytes4 selector, bool allowed, uint8 tier) external onlyDao {
        require(tier <= 2, "tier");
        rules[target][selector] = Rule({allowed: allowed, tier: tier});
        emit RuleSet(target, selector, allowed, tier);
    }

    function setRules(PolicyRule[] calldata entries) external onlyDao {
        for (uint256 i = 0; i < entries.length; i++) {
            PolicyRule calldata entry = entries[i];
            require(entry.tier <= 2, "tier");
            rules[entry.target][entry.selector] = Rule({
                allowed: entry.allowed,
                tier: entry.tier
            });
            emit RuleSet(entry.target, entry.selector, entry.allowed, entry.tier);
        }
    }

    function setAgentSigner(address next) external onlyDao {
        require(next != address(0), "signer=0");
        address previous = agentSigner;
        agentSigner = next;
        emit AgentSignerSet(previous, next);
    }

    function setAdmin(address next) external onlyDao {
        require(next != address(0), "admin=0");
        address previous = admin;
        admin = next;
        emit AdminSet(previous, next);
    }

    function setFrameEnforced(bool enforced) external onlyDao {
        frameEnforced = enforced;
        emit FrameEnforcedSet(enforced);
    }

    /// Emergency pause. The admin calls this directly, without the agent.
    function pause(bool paused_) external onlyAdmin {
        paused = paused_;
        emit PausedSet(paused_);
    }

    // -------------------------------------------------------- EIP-8141 frame --

    /// VERIFY frame. Empty calldata must reach this function, so there is no
    /// `receive()`: a `receive()` would swallow the VERIFY call.
    fallback() external payable {
        require(msg.sender == ENTRY_POINT, "not entrypoint");
        require(!paused, "paused");
        require(dao != address(0), "not initialized");
        require(address(uint160(txparam(TxParam.SENDER))) == address(this), "not sender");

        require(sigparam(0, SigParam.SCHEME) == 1, "scheme");
        require(
            address(uint160(sigparam(0, SigParam.RESOLVED_SIGNER))) == agentSigner,
            "agent signer"
        );

        if (frameEnforced) {
            uint256 frameCount = txparam(TxParam.FRAME_COUNT);
            bool sawSender;
            for (uint256 i = 0; i < frameCount; i++) {
                if (frameparam(i, FrameParam.MODE) != uint256(FrameMode.SENDER)) {
                    continue;
                }
                sawSender = true;
                address target = address(uint160(frameparam(i, FrameParam.RESOLVED_TARGET)));
                bytes4 selector = bytes4(framedataload(0, i));
                require(rules[target][selector].allowed, "out of policy");
            }
            require(sawSender, "no sender frame");
        }

        approve(Scope.EXECUTION);
    }
}
