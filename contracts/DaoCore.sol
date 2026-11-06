// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    AdminAuth,
    AssetConfig,
    DaoConfig,
    PolicyRule,
    TokenCapConfig
} from "./libraries/DaoTypes.sol";
import {
    IAgentAccount,
    IAssetModule,
    IDaoVotePaymaster,
    IERC20
} from "./interfaces/IDaoModules.sol";

/// The DAO: member commitments, roles, proposals, treasury, caps and audit.
///
/// Tier model (spec §6):
///   - tier 1: the agent alone, bounded by `addMemberLimit` and per-token caps;
///   - tier 2: the agent plus an admin EIP-712 `AdminAuth`;
///   - tier 3: a member vote, executed after the voting window.
///
/// `AgentAccount` enforces the target/selector policy at validation when the
/// chain supports frame introspection. `DaoCore` re-enforces every limit here,
/// so an out-of-policy call that reaches execution still fails (spec §4.2).
///
/// Membership root note: the Poseidon root is supplied by the agent after an
/// off-chain tree update. `leafCommitment` and `usedCommitment` make adds
/// unique and replay-safe, and removal always requires an admin signature.
/// The spec's residual risk applies: a compromised agent can still add members
/// up to the rate limit (spec §11). Root history is kept for audit and for the
/// vote paymaster's snapshot lookup.
contract DaoCore {
    struct TokenCap {
        bool allowed;
        uint256 perTx;
        uint256 perPeriod;
        uint64 periodLength;
        uint64 periodStart;
        uint256 spent;
    }

    struct Proposal {
        address target;
        bytes data;
        bytes32 paramsHash;
        bytes32 snapshotRoot;
        uint256 snapshotMembers;
        uint64 deadline;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bytes32 promptHash;
        bytes32 planHash;
    }

    uint8 public constant TIER_AGENT = 1;
    uint8 public constant TIER_ADMIN = 2;
    uint8 public constant TIER_GOVERNANCE = 3;

    uint8 public constant ACTION_ADD_MEMBERS = 1;
    uint8 public constant ACTION_REMOVE_MEMBER = 2;
    uint8 public constant ACTION_SET_ROLE = 3;
    uint8 public constant ACTION_DISPOSE_ASSET = 4;
    uint8 public constant ACTION_SPEND = 5;
    uint8 public constant ACTION_EXECUTE_PROPOSAL = 6;
    uint8 public constant ACTION_ACQUIRE_ASSET = 7;

    uint8 public constant ROLE_MEMBER = 0;
    uint8 public constant ROLE_CONTRIBUTOR = 1;
    uint8 public constant ROLE_MANAGER = 2;

    uint256 public constant TREE_CAPACITY = 1 << 20;

    bytes32 public constant ACTION_TYPEHASH = keccak256(
        "Action(address daoCore,uint256 chainId,uint8 actionType,bytes32 paramsHash,uint256 nonce,uint256 expiry)"
    );
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant DOMAIN_NAME_HASH = keccak256("DaoCore");
    bytes32 public constant DOMAIN_VERSION_HASH = keccak256("1");

    bytes32 public immutable daoId;
    address public immutable factory;

    address public admin;
    address public agentAccount;
    address public assetModule;
    address public votePaymaster;

    bytes32 public membershipRoot;
    bytes32 public journalRoot;
    mapping(bytes32 => bool) public knownRoot;
    mapping(uint256 => uint256) public leafCommitment;
    mapping(uint256 => bool) public usedCommitment;
    mapping(uint256 => uint8) public memberRole;
    uint256 public memberCount;
    uint256 public adminNonce;
    uint256 public proposalCount;

    uint32 public memberPeriodLength;
    uint16 public addMemberLimit;
    uint64 public votePeriod;
    uint16 public quorumBps;
    uint64 public memberPeriodStart;
    uint32 public memberAddsThisPeriod;

    mapping(address => TokenCap) public tokenCaps;
    mapping(uint256 => Proposal) internal _proposals;
    mapping(uint256 => mapping(uint256 => bool)) public voteNullifierUsed;
    mapping(address => bool) public proposalTargetAllowed;
    mapping(bytes4 => bool) public governanceSelector;
    mapping(bytes4 => bool) public assetSelectorAllowed;

    bool private _entered;

    event DaoInitialized(bytes32 indexed daoId, address indexed admin);
    event AgentInitialized(address indexed agentAccount);
    event AssetModuleInitialized(address indexed assetModule);
    event VotePaymasterSet(address indexed paymaster);
    event AdminSet(address indexed previous, address indexed next);
    event MembershipRootUpdated(
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        uint256 added,
        uint256 removed
    );
    event MemberAdded(uint256 indexed index, uint256 commitment);
    event MemberRemoved(uint256 indexed index, uint256 commitment);
    event RoleSet(uint256 indexed index, uint8 role);
    event TokenCapSet(
        address indexed token,
        bool allowed,
        uint256 perTx,
        uint256 perPeriod,
        uint64 periodLength
    );
    event Spent(
        address indexed token,
        address indexed to,
        uint256 amount,
        uint256 spentThisPeriod
    );
    event AssetApproval(
        address indexed token,
        address indexed spender,
        uint256 amount
    );
    event ActionExecuted(
        bytes32 indexed actionHash,
        uint8 tier,
        address indexed authorizer,
        uint8 actionType,
        bytes32 promptHash,
        bytes32 planHash
    );
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed target,
        bytes4 selector,
        bytes32 paramsHash,
        bytes32 snapshotRoot,
        uint64 deadline
    );
    event VoteCast(uint256 indexed proposalId, bool support, uint256 voteNullifier);
    event ProposalExecuted(uint256 indexed proposalId, bytes32 actionHash);
    event AgentPaused(bool paused);
    event Deposited(address indexed from, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == factory, "not factory");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlyAgent() {
        require(agentAccount != address(0) && msg.sender == agentAccount, "not agent");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == address(this), "not governance");
        _;
    }

    modifier nonReentrant() {
        require(!_entered, "reentrant");
        _entered = true;
        _;
        _entered = false;
    }

    constructor(DaoConfig memory cfg) {
        require(cfg.daoId != bytes32(0), "daoId=0");
        require(cfg.admin != address(0), "admin=0");
        require(cfg.agentSigner != address(0), "signer=0");
        require(cfg.memberPeriodLength > 0, "period=0");
        require(cfg.addMemberLimit > 0, "limit=0");
        require(cfg.votePeriod > 0, "votePeriod=0");
        require(cfg.quorumBps > 0 && cfg.quorumBps <= 10_000, "quorum");

        daoId = cfg.daoId;
        factory = msg.sender;
        admin = cfg.admin;
        memberPeriodLength = cfg.memberPeriodLength;
        addMemberLimit = cfg.addMemberLimit;
        votePeriod = cfg.votePeriod;
        quorumBps = cfg.quorumBps;
        memberPeriodStart = uint64(block.timestamp);

        // Only these selectors may be executed through a tier-3 proposal.
        governanceSelector[this.setTokenCap.selector] = true;
        governanceSelector[this.setMemberPolicy.selector] = true;
        governanceSelector[this.setPolicy.selector] = true;
        governanceSelector[this.setAgentSigner.selector] = true;
        governanceSelector[this.setAdmin.selector] = true;
        governanceSelector[this.spendAboveCap.selector] = true;
        governanceSelector[this.acquireAssetAboveCap.selector] = true;

        emit DaoInitialized(cfg.daoId, cfg.admin);
    }

    // ----------------------------------------------------------- bootstrap --

    function initializeAgent(address agentAccount_) external onlyFactory {
        require(agentAccount == address(0), "agent set");
        require(agentAccount_ != address(0), "agent=0");
        agentAccount = agentAccount_;
        proposalTargetAllowed[address(this)] = true;
        emit AgentInitialized(agentAccount_);
    }

    function initializeAssetModule(address assetModule_) external onlyFactory {
        require(assetModule == address(0), "asset set");
        require(assetModule_ != address(0), "asset=0");
        assetModule = assetModule_;
        proposalTargetAllowed[assetModule_] = true;
        assetSelectorAllowed[IAssetModule.allowAsset.selector] = true;
        assetSelectorAllowed[IAssetModule.setAssetCap.selector] = true;
        emit AssetModuleInitialized(assetModule_);
    }

    /// Apply the deployment policy table to `AgentAccount`. The factory calls
    /// this once; later changes go through a tier-3 proposal.
    function initializePolicy(PolicyRule[] calldata rules) external onlyFactory {
        require(agentAccount != address(0), "no agent");
        for (uint256 i = 0; i < rules.length; i++) {
            PolicyRule calldata rule = rules[i];
            IAgentAccount(agentAccount).setRule(
                rule.target,
                rule.selector,
                rule.allowed,
                rule.tier
            );
        }
    }

    function configureTokenCaps(TokenCapConfig[] calldata caps) external onlyFactory {
        for (uint256 i = 0; i < caps.length; i++) {
            TokenCapConfig calldata cap = caps[i];
            _setTokenCap(
                cap.token,
                true,
                cap.perTx,
                cap.perPeriod,
                cap.periodLength
            );
        }
    }

    function initializeAssets(AssetConfig[] calldata entries) external onlyFactory {
        require(assetModule != address(0), "no asset module");
        for (uint256 i = 0; i < entries.length; i++) {
            AssetConfig calldata entry = entries[i];
            IAssetModule(assetModule).allowAsset(
                entry.assetId,
                entry.token,
                entry.unitPrice,
                entry.cap
            );
        }
    }

    /// One-time bootstrap. After the first proposal, the paymaster can only be
    /// changed by a vote.
    function setVotePaymaster(address paymaster) external onlyAdmin {
        require(proposalCount == 0, "proposals exist");
        votePaymaster = paymaster;
        emit VotePaymasterSet(paymaster);
    }

    /// Emergency valve. The admin can stop the agent without a proposal.
    function pauseAgent(bool paused) external onlyAdmin {
        IAgentAccount(agentAccount).pause(paused);
        emit AgentPaused(paused);
    }

    // ---------------------------------------------------------- membership --

    /// Tier 1: add invited members within the per-period rate limit.
    function addMembers(
        uint256[] calldata commitments,
        uint256[] calldata indices,
        bytes32 newRoot
    ) external onlyAgent {
        require(commitments.length > 0, "empty batch");
        require(commitments.length == indices.length, "length");
        _rollMemberPeriod();
        require(
            uint256(memberAddsThisPeriod) + commitments.length <= addMemberLimit,
            "rate limit"
        );
        _addMembers(commitments, indices, newRoot, TIER_AGENT);
    }

    /// Tier 2: add above the rate limit, authorized by the admin.
    function addMembersAuthorized(
        uint256[] calldata commitments,
        uint256[] calldata indices,
        bytes32 newRoot,
        AdminAuth calldata auth
    ) external onlyAgent {
        require(commitments.length > 0, "empty batch");
        require(commitments.length == indices.length, "length");
        bytes32 paramsHash = keccak256(abi.encode(commitments, indices, newRoot));
        _verifyAdminAuth(ACTION_ADD_MEMBERS, paramsHash, auth);
        _rollMemberPeriod();
        _addMembers(commitments, indices, newRoot, TIER_ADMIN);
    }

    function _addMembers(
        uint256[] calldata commitments,
        uint256[] calldata indices,
        bytes32 newRoot,
        uint8 tier
    ) private {
        require(newRoot != bytes32(0), "root=0");
        require(newRoot != membershipRoot, "root unchanged");
        bytes32 oldRoot = membershipRoot;

        for (uint256 i = 0; i < commitments.length; i++) {
            uint256 index = indices[i];
            uint256 commitment = commitments[i];
            require(index < TREE_CAPACITY, "index");
            require(commitment != 0, "commitment=0");
            require(!usedCommitment[commitment], "commitment used");
            require(leafCommitment[index] == 0, "slot used");

            usedCommitment[commitment] = true;
            leafCommitment[index] = commitment;
            memberCount += 1;
            memberAddsThisPeriod += 1;
            journalRoot = keccak256(abi.encode(journalRoot, commitment, index));
            emit MemberAdded(index, commitment);
        }

        membershipRoot = newRoot;
        knownRoot[newRoot] = true;
        if (oldRoot != bytes32(0)) knownRoot[oldRoot] = true;
        emit MembershipRootUpdated(oldRoot, newRoot, commitments.length, 0);
        emit ActionExecuted(
            keccak256(abi.encode(ACTION_ADD_MEMBERS, commitments, indices, newRoot)),
            tier,
            tier == TIER_ADMIN ? admin : msg.sender,
            ACTION_ADD_MEMBERS,
            bytes32(0),
            bytes32(0)
        );
    }

    /// Tier 2: remove a member. The admin signs the exact leaf and new root.
    function removeMember(
        uint256 index,
        bytes32 newRoot,
        AdminAuth calldata auth
    ) external onlyAgent {
        uint256 commitment = leafCommitment[index];
        require(commitment != 0, "no member");
        bytes32 paramsHash = keccak256(abi.encode(index, newRoot));
        _verifyAdminAuth(ACTION_REMOVE_MEMBER, paramsHash, auth);

        leafCommitment[index] = 0;
        memberCount -= 1;
        _setMembershipRoot(newRoot, 0, 1);
        emit MemberRemoved(index, commitment);
        emit ActionExecuted(
            keccak256(abi.encode(ACTION_REMOVE_MEMBER, paramsHash)),
            TIER_ADMIN,
            admin,
            ACTION_REMOVE_MEMBER,
            bytes32(0),
            bytes32(0)
        );
    }

    /// Tier 2: change a non-admin role.
    function setRole(
        uint256 index,
        uint8 role,
        AdminAuth calldata auth
    ) external onlyAgent {
        require(leafCommitment[index] != 0, "no member");
        require(role <= ROLE_MANAGER, "role");
        bytes32 paramsHash = keccak256(abi.encode(index, role));
        _verifyAdminAuth(ACTION_SET_ROLE, paramsHash, auth);

        memberRole[index] = role;
        emit RoleSet(index, role);
        emit ActionExecuted(
            keccak256(abi.encode(ACTION_SET_ROLE, paramsHash)),
            TIER_ADMIN,
            admin,
            ACTION_SET_ROLE,
            bytes32(0),
            bytes32(0)
        );
    }

    function _setMembershipRoot(
        bytes32 newRoot,
        uint256 added,
        uint256 removed
    ) private {
        require(newRoot != bytes32(0), "root=0");
        require(newRoot != membershipRoot, "root unchanged");
        bytes32 oldRoot = membershipRoot;
        membershipRoot = newRoot;
        knownRoot[newRoot] = true;
        knownRoot[oldRoot] = true;
        emit MembershipRootUpdated(oldRoot, newRoot, added, removed);
    }

    // -------------------------------------------------------------- treasury --

    /// Tier 1: spend within the per-transaction and per-period caps.
    function spend(
        address token,
        address to,
        uint256 amount,
        bytes32 promptHash,
        bytes32 planHash
    ) external onlyAgent nonReentrant {
        require(to != address(0), "to=0");
        TokenCap storage cap = tokenCaps[token];
        require(cap.allowed, "token not allowed");
        require(amount > 0 && amount <= cap.perTx, "per-tx cap");

        _rollTokenPeriod(cap);
        require(cap.spent + amount <= cap.perPeriod, "period cap");
        cap.spent += amount;

        _transfer(token, to, amount);

        emit Spent(token, to, amount, cap.spent);
        emit ActionExecuted(
            keccak256(abi.encode(ACTION_SPEND, token, to, amount)),
            TIER_AGENT,
            msg.sender,
            ACTION_SPEND,
            promptHash,
            planHash
        );
    }

    /// Tier 3: spend above the tier-1 cap, reached through a proposal.
    function spendAboveCap(
        address token,
        address to,
        uint256 amount,
        bytes32 promptHash,
        bytes32 planHash
    ) external onlyGovernance nonReentrant {
        require(to != address(0), "to=0");
        require(tokenCaps[token].allowed, "token not allowed");
        _transfer(token, to, amount);
        emit ActionExecuted(
            keccak256(abi.encode(ACTION_SPEND, token, to, amount)),
            TIER_GOVERNANCE,
            address(this),
            ACTION_SPEND,
            promptHash,
            planHash
        );
    }

    function approveAsset(
        address token,
        address spender,
        uint256 amount
    ) external onlyAgent {
        require(tokenCaps[token].allowed, "token not allowed");
        require(
            IERC20(token).approve(spender, amount),
            "approve failed"
        );
        emit AssetApproval(token, spender, amount);
    }

    /// Tier 1: acquire an allowlisted asset within its cap. One SENDER call,
    /// and the approval is always reset to zero (spec §9).
    function acquireAsset(bytes32 assetId, uint256 amount)
        external
        onlyAgent
        nonReentrant
    {
        _acquire(assetId, amount, false);
    }

    /// Tier 3: acquire above the asset cap, reached through a proposal.
    function acquireAssetAboveCap(bytes32 assetId, uint256 amount)
        external
        onlyGovernance
        nonReentrant
    {
        _acquire(assetId, amount, true);
    }

    function _acquire(bytes32 assetId, uint256 amount, bool aboveCap) private {
        require(assetModule != address(0), "no asset module");
        (address token, uint256 unitPrice, ) = IAssetModule(assetModule).assetInfo(assetId);
        require(token != address(0), "unknown asset");
        uint256 cost = amount * unitPrice;
        require(cost > 0, "cost=0");

        require(IERC20(token).approve(assetModule, cost), "approve failed");
        if (aboveCap) {
            IAssetModule(assetModule).buyAboveCap(assetId, amount);
        } else {
            IAssetModule(assetModule).buy(assetId, amount);
        }
        require(IERC20(token).approve(assetModule, 0), "reset failed");

        emit ActionExecuted(
            keccak256(abi.encode(ACTION_ACQUIRE_ASSET, assetId, amount)),
            aboveCap ? TIER_GOVERNANCE : TIER_AGENT,
            msg.sender,
            ACTION_ACQUIRE_ASSET,
            bytes32(0),
            bytes32(0)
        );
    }

    /// Tier 2: dispose of an asset after the admin signs the exact action.
    function disposeAsset(
        bytes32 assetId,
        uint256 amount,
        address to,
        AdminAuth calldata auth
    ) external onlyAgent nonReentrant {
        bytes32 paramsHash = keccak256(abi.encode(assetId, amount, to));
        _verifyAdminAuth(ACTION_DISPOSE_ASSET, paramsHash, auth);
        IAssetModule(assetModule).dispose(assetId, amount, to);
        emit ActionExecuted(
            keccak256(abi.encode(ACTION_DISPOSE_ASSET, paramsHash)),
            TIER_ADMIN,
            admin,
            ACTION_DISPOSE_ASSET,
            bytes32(0),
            bytes32(0)
        );
    }

    // -------------------------------------------------------------- proposals --

    /// Tier 3: open a proposal with a snapshot of the current membership root.
    function createProposal(
        address target,
        bytes calldata data,
        uint64 deadline,
        bytes32 promptHash,
        bytes32 planHash
    ) external onlyAgent returns (uint256 proposalId) {
        require(proposalTargetAllowed[target], "target not allowed");
        bytes4 selector = _selector(data);
        if (target == address(this)) {
            require(governanceSelector[selector], "selector not allowed");
        } else {
            require(assetSelectorAllowed[selector], "asset selector");
        }
        require(membershipRoot != bytes32(0), "no members");
        require(memberCount > 0, "no members");

        uint64 votingDeadline = deadline == 0
            ? uint64(block.timestamp) + votePeriod
            : deadline;
        require(votingDeadline > block.timestamp, "deadline");

        proposalId = ++proposalCount;
        Proposal storage proposal = _proposals[proposalId];
        proposal.target = target;
        proposal.data = data;
        proposal.paramsHash = keccak256(data);
        proposal.snapshotRoot = membershipRoot;
        proposal.snapshotMembers = memberCount;
        proposal.deadline = votingDeadline;
        proposal.promptHash = promptHash;
        proposal.planHash = planHash;

        emit ProposalCreated(
            proposalId,
            target,
            selector,
            proposal.paramsHash,
            membershipRoot,
            votingDeadline
        );
    }

    /// Private vote. The paymaster has already checked the membership proof
    /// against `proposalSnapshotRoot(proposalId)` and burned `voteNullifier`.
    /// This function only prevents a second use of the same nullifier.
    function castVote(
        uint256 proposalId,
        bool support,
        uint256 voteNullifier
    ) external {
        Proposal storage proposal = _proposals[proposalId];
        require(proposal.deadline != 0, "unknown proposal");
        require(block.timestamp < proposal.deadline, "voting closed");
        require(votePaymaster != address(0), "no paymaster");
        require(
            IDaoVotePaymaster(votePaymaster).voteConsumed(
                address(this),
                proposalId,
                voteNullifier
            ),
            "no proof"
        );
        require(!voteNullifierUsed[proposalId][voteNullifier], "voted");
        voteNullifierUsed[proposalId][voteNullifier] = true;

        if (support) {
            proposal.forVotes += 1;
        } else {
            proposal.againstVotes += 1;
        }
        emit VoteCast(proposalId, support, voteNullifier);
    }

    /// Execute a passed proposal. `DaoCore` checks the vote result onchain;
    /// the target then enforces its own access control.
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = _proposals[proposalId];
        require(proposal.deadline != 0, "unknown proposal");
        require(!proposal.executed, "executed");
        require(block.timestamp >= proposal.deadline, "voting open");

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        uint256 quorum = (proposal.snapshotMembers * quorumBps + 9_999) / 10_000;
        require(totalVotes >= quorum, "quorum");
        require(proposal.forVotes > proposal.againstVotes, "rejected");

        proposal.executed = true;
        (bool ok, ) = proposal.target.call(proposal.data);
        require(ok, "execution failed");

        bytes32 actionHash = keccak256(
            abi.encode(ACTION_EXECUTE_PROPOSAL, proposalId, proposal.paramsHash)
        );
        emit ProposalExecuted(proposalId, actionHash);
        emit ActionExecuted(
            actionHash,
            TIER_GOVERNANCE,
            address(this),
            ACTION_EXECUTE_PROPOSAL,
            proposal.promptHash,
            proposal.planHash
        );
    }

    function proposalSnapshotRoot(uint256 proposalId) external view returns (bytes32) {
        return _proposals[proposalId].snapshotRoot;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    // -------------------------------------------------------- governance only --

    function setTokenCap(
        address token,
        bool allowed,
        uint256 perTx,
        uint256 perPeriod,
        uint64 periodLength
    ) external onlyGovernance {
        _setTokenCap(token, allowed, perTx, perPeriod, periodLength);
    }

    function setMemberPolicy(
        uint32 periodLength,
        uint16 limit,
        uint64 votePeriod_,
        uint16 quorumBps_
    ) external onlyGovernance {
        require(periodLength > 0, "period=0");
        require(limit > 0, "limit=0");
        require(votePeriod_ > 0, "votePeriod=0");
        require(quorumBps_ > 0 && quorumBps_ <= 10_000, "quorum");
        memberPeriodLength = periodLength;
        addMemberLimit = limit;
        votePeriod = votePeriod_;
        quorumBps = quorumBps_;
        memberPeriodStart = uint64(block.timestamp);
        memberAddsThisPeriod = 0;
    }

    function setPolicy(PolicyRule[] calldata rules) external onlyGovernance {
        for (uint256 i = 0; i < rules.length; i++) {
            PolicyRule calldata rule = rules[i];
            IAgentAccount(agentAccount).setRule(
                rule.target,
                rule.selector,
                rule.allowed,
                rule.tier
            );
        }
    }

    function setAgentSigner(address next) external onlyGovernance {
        IAgentAccount(agentAccount).setAgentSigner(next);
    }

    function setAdmin(address next) external onlyGovernance {
        require(next != address(0), "admin=0");
        address previous = admin;
        admin = next;
        IAgentAccount(agentAccount).setAdmin(next);
        emit AdminSet(previous, next);
    }

    function setFrameEnforced(bool enforced) external onlyAdmin {
        IAgentAccount(agentAccount).setFrameEnforced(enforced);
    }

    // --------------------------------------------------------------- funding --

    function deposit() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // --------------------------------------------------------------- internal --

    function _setTokenCap(
        address token,
        bool allowed,
        uint256 perTx,
        uint256 perPeriod,
        uint64 periodLength
    ) private {
        require(periodLength > 0, "period=0");
        if (allowed) {
            require(perTx > 0, "perTx=0");
            require(perPeriod >= perTx, "period cap");
        }
        TokenCap storage cap = tokenCaps[token];
        cap.allowed = allowed;
        cap.perTx = perTx;
        cap.perPeriod = perPeriod;
        cap.periodLength = periodLength;
        if (cap.periodStart == 0) {
            cap.periodStart = uint64(block.timestamp);
        }
        emit TokenCapSet(token, allowed, perTx, perPeriod, periodLength);
    }

    function _rollMemberPeriod() private {
        if (block.timestamp >= uint256(memberPeriodStart) + memberPeriodLength) {
            memberPeriodStart = uint64(block.timestamp);
            memberAddsThisPeriod = 0;
        }
    }

    function _rollTokenPeriod(TokenCap storage cap) private {
        if (cap.periodStart == 0) {
            cap.periodStart = uint64(block.timestamp);
            return;
        }
        if (block.timestamp >= uint256(cap.periodStart) + cap.periodLength) {
            cap.periodStart = uint64(block.timestamp);
            cap.spent = 0;
        }
    }

    function _transfer(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "native transfer failed");
        } else {
            require(IERC20(token).transfer(to, amount), "token transfer failed");
        }
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly {
            selector := calldataload(data.offset)
        }
    }

    // ------------------------------------------------------------- EIP-712 --

    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    DOMAIN_NAME_HASH,
                    DOMAIN_VERSION_HASH,
                    block.chainid,
                    address(this)
                )
            );
    }

    function actionDigest(
        uint8 actionType,
        bytes32 paramsHash,
        uint256 nonce,
        uint256 expiry
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                address(this),
                block.chainid,
                actionType,
                paramsHash,
                nonce,
                expiry
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _verifyAdminAuth(
        uint8 actionType,
        bytes32 paramsHash,
        AdminAuth calldata auth
    ) private {
        require(auth.expiry >= block.timestamp, "expired");
        require(auth.nonce == adminNonce, "nonce");
        bytes32 digest = actionDigest(
            actionType,
            paramsHash,
            auth.nonce,
            auth.expiry
        );
        require(_recover(digest, auth.signature) == admin, "bad signature");
        adminNonce += 1;
    }

    function _recover(
        bytes32 digest,
        bytes calldata signature
    ) private pure returns (address) {
        require(signature.length == 65, "sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        if (v < 27) v += 27;
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "bad sig");
        return signer;
    }
}
