// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AgentAccount} from "../AgentAccount.sol";

/// Deploys one `AgentAccount`. Separate from `DaoFactory` so the factory stays
/// under the EIP-170 code-size limit.
contract AgentAccountFactory {
    event AgentAccountDeployed(address indexed agentAccount);

    function deploy(
        address admin,
        address agentSigner,
        bool frameEnforced
    ) external returns (address) {
        AgentAccount account = new AgentAccount(
            admin,
            agentSigner,
            frameEnforced,
            msg.sender
        );
        emit AgentAccountDeployed(address(account));
        return address(account);
    }
}
