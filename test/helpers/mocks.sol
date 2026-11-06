// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "interfaces/IDaoModules.sol";
import {
    BalanceDelta,
    Currency,
    IUnlockCallback,
    PoolId,
    PoolKey,
    SwapParams
} from "interfaces/IV4PoolManager.sol";

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

/// Minimal ERC-20 used by the DAO treasury/asset tests.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        require(to != address(0), "to=0");
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "to=0");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// Contract stand-in for `AgentAccount` in `DaoCore` unit tests.
///
/// `DaoCore` only compares `msg.sender` with `agentAccount`, so a tiny forwarder
/// is enough to exercise the agent-only paths without impersonating a contract.
contract MockAgent {
    struct Rule {
        bool allowed;
        uint8 tier;
    }

    mapping(address => mapping(bytes4 => Rule)) public rules;

    function execute(address target, bytes calldata data)
        external
        payable
        returns (bytes memory)
    {
        (bool ok, bytes memory result) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
        return result;
    }

    // AgentAccount surface used by DaoCore.initializePolicy / governance calls.
    function setRule(address target, bytes4 selector, bool allowed, uint8 tier)
        external
    {
        rules[target][selector] = Rule(allowed, tier);
    }

    function setAgentSigner(address) external {}

    function setAdmin(address) external {}

    function setFrameEnforced(bool) external {}

    function pause(bool) external {}

    function agentSigner() external view returns (address) {
        return address(this);
    }

    function paused() external view returns (bool) {
        return false;
    }
}

/// Paymaster stand-in for `DaoCore.castVote` unit tests. The real paymaster is
/// covered by the ZK test; this one lets the governance tests run on ganache.
contract MockVotePaymaster {
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public voteConsumed;
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public voteChoice;

    function setConsumed(
        address dao,
        uint256 proposalId,
        uint256 nullifier,
        bool consumed
    ) external {
        voteConsumed[dao][proposalId][nullifier] = consumed;
    }

    function setChoice(
        address dao,
        uint256 proposalId,
        uint256 nullifier,
        bool support
    ) external {
        voteChoice[dao][proposalId][nullifier] = support;
    }
}

/// Minimal `DaoCore` view stand-in for `DaoGasPaymaster`'s deploy-time cache.
/// The real paymaster reads `agentAccount()` once in the constructor so the
/// validation prefix does not perform a non-sender storage read.
contract MockDaoAgentView {
    address public agentAccount;

    constructor(address agent_) {
        agentAccount = agent_;
    }
}

/// Minimal `DaoCore` view stand-in for `DaoVotePaymaster.charge` deadline tests.
contract MockDaoVoteSource {
    bytes32 public root;
    uint64 public deadline;

    function set(bytes32 root_, uint64 deadline_) external {
        root = root_;
        deadline = deadline_;
    }

    function proposalSnapshotRoot(uint256) external view returns (bytes32) {
        return root;
    }

    function proposalDeadline(uint256) external view returns (uint64) {
        return deadline;
    }
}

/// Minimal v4 `PoolManager` stand-in for `DaoSwapModule` unit tests.
///
/// It reproduces the parts the module relies on: the unlock/callback cycle,
/// a configured `BalanceDelta`, `sync`/`settle` crediting and `take` paying the
/// recipient. It does not implement pricing or liquidity; the test sets the
/// delta it wants the pool to return.
contract MockPoolManager {
    bool private locked;
    BalanceDelta private nextDelta;

    PoolId public lastPoolId;
    bool public lastZeroForOne;
    int256 public lastAmountSpecified;
    uint256 public lastSqrtPriceLimitX96;
    address public lastTaker;
    address public lastTakeToken;
    uint256 public lastTakeAmount;
    uint256 public totalNativeSettled;
    mapping(address => uint256) public tokenSettled;

    address private syncedToken;
    mapping(address => uint256) private syncedBalance;

    receive() external payable {}

    function setNextDelta(int128 amount0, int128 amount1) external {
        nextDelta = BalanceDelta.wrap(
            (int256(amount0) << 128) |
                int256(uint256(uint128(uint256(int256(amount1)))))
        );
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        require(!locked, "locked");
        locked = true;
        bytes memory result = IUnlockCallback(msg.sender).unlockCallback(data);
        locked = false;
        return result;
    }

    function swap(
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) external returns (BalanceDelta) {
        require(locked, "not locked");
        lastPoolId = PoolId.wrap(keccak256(abi.encode(key)));
        lastZeroForOne = params.zeroForOne;
        lastAmountSpecified = params.amountSpecified;
        lastSqrtPriceLimitX96 = uint256(params.sqrtPriceLimitX96);
        return nextDelta;
    }

    function sync(Currency currency) external {
        require(locked, "not locked");
        syncedToken = Currency.unwrap(currency);
        syncedBalance[syncedToken] = IERC20(syncedToken).balanceOf(address(this));
    }

    function settle() external payable returns (uint256 paid) {
        require(locked, "not locked");
        paid = msg.value;
        if (paid > 0) totalNativeSettled += paid;
        if (syncedToken != address(0)) {
            uint256 balance = IERC20(syncedToken).balanceOf(address(this));
            uint256 diff = balance > syncedBalance[syncedToken]
                ? balance - syncedBalance[syncedToken]
                : 0;
            tokenSettled[syncedToken] += diff;
            paid += diff;
            syncedToken = address(0);
        }
    }

    function take(Currency currency, address to, uint256 amount) external {
        require(locked, "not locked");
        address token = Currency.unwrap(currency);
        lastTaker = to;
        lastTakeToken = token;
        lastTakeAmount = amount;
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "take failed");
        } else {
            require(IERC20(token).transfer(to, amount), "take failed");
        }
    }
}

