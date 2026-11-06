// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AssetConfig, DaoConfig, PolicyRule, TokenCapConfig} from "./libraries/DaoTypes.sol";
import {DaoCore} from "./DaoCore.sol";
import {AgentAccount} from "./AgentAccount.sol";
import {AssetModule} from "./AssetModule.sol";

interface IDaoCoreFactory {
    function deploy(DaoConfig calldata cfg) external returns (address);
}

interface IAgentAccountFactory {
    function deploy(address admin, address agentSigner, bool frameEnforced)
        external
        returns (address);
}

interface IAssetModuleFactory {
    function deploy(address dao) external returns (address);
}

/// Deploys one DAO and its agent account in a single transaction (spec §8.1).
///
/// The three child contracts come from dedicated factories so the orchestrator
/// stays under the EIP-170 code-size limit. The orchestrator performs the
/// one-time wiring: `DaoCore.initializeAgent`,
/// `AgentAccount.initializeDao`, the initial policy table, the asset allowlist
/// and the token caps. After that, policy changes are tier-3 proposals.
contract DaoFactory {
    struct DaoRecord {
        address daoCore;
        address agentAccount;
        address assetModule;
        address admin;
    }

    address public immutable coreFactory;
    address public immutable accountFactory;
    address public immutable moduleFactory;

    mapping(bytes32 => DaoRecord) public daos;
    mapping(address => bytes32) public daoIdOf;
    bool private _entered;

    modifier nonReentrant() {
        require(!_entered, "reentrant");
        _entered = true;
        _;
        _entered = false;
    }

    event DaoCreated(
        bytes32 indexed daoId,
        address indexed daoCore,
        address indexed agentAccount,
        address assetModule,
        address admin,
        uint256 funding
    );

    constructor(
        address coreFactory_,
        address accountFactory_,
        address moduleFactory_
    ) {
        require(coreFactory_ != address(0), "coreFactory=0");
        require(accountFactory_ != address(0), "accountFactory=0");
        require(moduleFactory_ != address(0), "moduleFactory=0");
        coreFactory = coreFactory_;
        accountFactory = accountFactory_;
        moduleFactory = moduleFactory_;
    }

    function createDao(
        DaoConfig calldata cfg,
        PolicyRule[] calldata rules,
        TokenCapConfig[] calldata tokenCaps,
        AssetConfig[] calldata assets
    ) external payable nonReentrant returns (address daoCore, address agentAccount) {
        require(cfg.daoId != bytes32(0), "daoId=0");
        require(daos[cfg.daoId].daoCore == address(0), "dao exists");

        DaoRecord memory record = _deploy(cfg, rules, tokenCaps, assets);

        daos[cfg.daoId] = record;
        daoIdOf[record.daoCore] = cfg.daoId;

        emit DaoCreated(
            cfg.daoId,
            record.daoCore,
            record.agentAccount,
            record.assetModule,
            record.admin,
            msg.value
        );
        return (record.daoCore, record.agentAccount);
    }

    function _deploy(
        DaoConfig calldata cfg,
        PolicyRule[] calldata rules,
        TokenCapConfig[] calldata tokenCaps,
        AssetConfig[] calldata assets
    ) private returns (DaoRecord memory record) {
        address payable core = payable(IDaoCoreFactory(coreFactory).deploy(cfg));
        address module = IAssetModuleFactory(moduleFactory).deploy(core);
        address payable account = payable(
            IAgentAccountFactory(accountFactory).deploy(
                cfg.admin,
                cfg.agentSigner,
                cfg.frameEnforced
            )
        );

        AgentAccount(account).initializeDao(core);
        DaoCore(core).initializeAgent(account);
        DaoCore(core).initializePolicy(rules);
        DaoCore(core).initializeAssetModule(module);
        DaoCore(core).initializeAssets(assets);
        DaoCore(core).configureTokenCaps(tokenCaps);

        if (msg.value > 0) {
            DaoCore(core).deposit{value: msg.value}();
        }

        record = DaoRecord({
            daoCore: core,
            agentAccount: account,
            assetModule: module,
            admin: cfg.admin
        });
    }
}
