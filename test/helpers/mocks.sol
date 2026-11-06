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
    function setRule(address, bytes4, bool, uint8) external {}

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

    function setConsumed(
        address dao,
        uint256 proposalId,
        uint256 nullifier,
        bool consumed
    ) external {
        voteConsumed[dao][proposalId][nullifier] = consumed;
    }
}
