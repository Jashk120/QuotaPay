#!/usr/bin/env node
/**
 * Deploy the DAO operator stack to the ethrex devnet.
 *
 * Deploys the three child factories + DaoFactory, a mock USDC treasury token,
 * one demo DAO, and (unless DAO_SKIP_VOTE_PAYMASTER=1) the DaoVote verifier and
 * paymaster. Writes deployments/dao-1337.json.
 *
 * Key source (in order): DEPLOYER_KEY, WORKSHOP_STATE (.workshop-state.json).
 *
 * Env:
 *   DEVNET_RPC                 default altmempool.forshtat.com
 *   STAKING_REGISTRY           default devnet registry
 *   DAO_FRAME_ENFORCED         "false" to use the spec §7.3 fallback
 *   DAO_SKIP_VOTE_PAYMASTER    "1" to skip the ZK vote paymaster
 *   AGENT_KEY                  agent signing key (generated when absent)
 */
import fs from "node:fs";
import {
  encodeDeployData,
  encodeFunctionData,
  parseEther,
  parseEventLogs,
  keccak256,
  stringToHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileAll } from "../test/helpers/compile.mjs";

const CHAIN_ID = 1337;
const addressZero = "0x0000000000000000000000000000000000000000";
const RPC = process.env.DEVNET_RPC ?? "https://altmempool.forshtat.com";
const REGISTRY =
  process.env.STAKING_REGISTRY ?? "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f";
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const FUND_WEI = parseEther("0.05");
const PAYMASTER_FUND_WEI = parseEther("0.05");
const MAX_SPONSOR_COST = parseEther("0.01");
const STAKE_WEI = parseEther(process.env.DAO_STAKE_ETH ?? "0.012");

function loadKey() {
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY;
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(`No DEPLOYER_KEY and no workshop state at ${STATE_PATH}`);
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (!state.participantKey) throw new Error("state has no participantKey");
  return state.participantKey;
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  return json.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await sleep(2000);
  }
  throw new Error(`transaction ${hash} not mined in ${timeoutMs}ms`);
}

async function sendLegacy(account, { to, value = 0n, data = "0x", gas }) {
  const nonce = Number(
    await rpc("eth_getTransactionCount", [account.address, "pending"]),
  );
  let gasPrice;
  try {
    gasPrice = BigInt(await rpc("eth_gasPrice"));
  } catch {
    gasPrice = 1_000_000_000n;
  }
  if (gasPrice === 0n) gasPrice = 1_000_000_000n;

  let gasToUse = gas;
  if (gasToUse === undefined) {
    const estimateParams = {
      from: account.address,
      data,
      value: `0x${value.toString(16)}`,
    };
    if (to) estimateParams.to = to;
    const estimate = await rpc("eth_estimateGas", [estimateParams]);
    gasToUse = (BigInt(estimate) * 12n) / 10n;
  }

  const raw = await account.signTransaction({
    chainId: CHAIN_ID,
    nonce,
    to,
    value,
    data,
    gas: gasToUse,
    gasPrice,
    type: "legacy",
  });
  const hash = await rpc("eth_sendRawTransaction", [raw]);
  const receipt = await waitMined(hash);
  if (receipt.status !== "0x1") {
    throw new Error(`transaction ${hash} reverted (status ${receipt.status})`);
  }
  return { hash, receipt };
}

async function deploy(account, artifacts, name, args = [], value = 0n) {
  const data = encodeDeployData({
    abi: artifacts[name].abi,
    bytecode: artifacts[name].bytecode,
    args,
  });
  const tx = await sendLegacy(account, { to: null, data, value });
  const address = tx.receipt.contractAddress;
  if (!address) throw new Error(`${name} deploy produced no address`);
  console.log(`      ${name}: ${address} (${tx.hash})`);
  return address;
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const artifacts = compileAll();

  console.log(`deployer: ${account.address}`);
  console.log(`rpc:      ${RPC}`);

  const balance = BigInt(await rpc("eth_getBalance", [account.address, "latest"]));
  console.log(`balance:  ${Number(balance) / 1e18} ETH`);
  if (balance < parseEther("0.2")) {
    throw new Error("deployer needs at least 0.2 ETH for factories + DAO + paymaster");
  }

  console.log("\n[1/7] child factories");
  const coreFactory = await deploy(account, artifacts, "DaoCoreFactory");
  const accountFactory = await deploy(account, artifacts, "AgentAccountFactory");
  const moduleFactory = await deploy(account, artifacts, "AssetModuleFactory");

  console.log("[2/7] orchestrator");
  const factory = await deploy(account, artifacts, "DaoFactory", [
    coreFactory,
    accountFactory,
    moduleFactory,
  ]);

  console.log("[3/7] demo treasury token");
  const usdc = await deploy(account, artifacts, "MockERC20", ["USDC", "USDC"]);

  console.log("[4/7] creating demo DAO");
  const agentKey = process.env.AGENT_KEY ?? generatePrivateKey();
  const agentSigner = privateKeyToAccount(agentKey).address;
  const daoId = keccak256(stringToHex("demo-dao"));
  const assetId = keccak256(stringToHex("invoice-nft"));
  const cfg = {
    daoId,
    admin: account.address,
    agentSigner,
    frameEnforced: process.env.DAO_FRAME_ENFORCED !== "false",
    memberPeriodLength: 2_592_000,
    addMemberLimit: 10,
    votePeriod: 86_400,
    quorumBps: 5_000,
  };
  const createData = encodeFunctionData({
    abi: artifacts.DaoFactory.abi,
    functionName: "createDao",
    args: [
      cfg,
      [],
      [
        {
          token: addressZero,
          perTx: parseEther("0.01"),
          perPeriod: parseEther("0.05"),
          periodLength: 86_400,
        },
        {
          token: usdc,
          perTx: parseEther("200"),
          perPeriod: parseEther("5000"),
          periodLength: 2_592_000,
        },
      ],
      [
        {
          assetId,
          token: usdc,
          unitPrice: parseEther("800"),
          cap: parseEther("1600"),
        },
      ],
    ],
  });
  const createTx = await sendLegacy(account, {
    to: factory,
    data: createData,
    value: FUND_WEI,
  });
  const created = parseEventLogs({
    abi: artifacts.DaoFactory.abi,
    eventName: "DaoCreated",
    logs: createTx.receipt.logs,
  })[0]?.args;
  if (!created) throw new Error("DaoCreated event not found");
  console.log(`      dao:     ${created.daoCore}`);
  console.log(`      account: ${created.agentAccount}`);
  console.log(`      module:  ${created.assetModule}`);

  const mintData = encodeFunctionData({
    abi: artifacts.MockERC20.abi,
    functionName: "mint",
    args: [created.daoCore, parseEther("10000")],
  });
  await sendLegacy(account, { to: usdc, data: mintData });

  console.log("[5/7] agent gas paymaster");
  const gasPaymaster = await deploy(
    account,
    artifacts,
    "DaoGasPaymaster",
    [
      account.address,
      account.address,
      REGISTRY,
      created.daoCore,
      MAX_SPONSOR_COST,
      86_400,
    ],
    PAYMASTER_FUND_WEI,
  );
  const gasStakeData = encodeFunctionData({
    abi: artifacts.DaoGasPaymaster.abi,
    functionName: "stake",
    args: [86_400],
  });
  await sendLegacy(account, {
    to: gasPaymaster,
    data: gasStakeData,
    value: STAKE_WEI,
  });

  let voteVerifier = null;
  let votePaymaster = null;
  if (process.env.DAO_SKIP_VOTE_PAYMASTER !== "1") {
    console.log("[6/7] ZK vote verifier + paymaster");
    voteVerifier = await deploy(account, artifacts, "DaoVoteVerifier");
    votePaymaster = await deploy(
      account,
      artifacts,
      "DaoVotePaymaster",
      [
        account.address,
        account.address,
        REGISTRY,
        voteVerifier,
        created.daoCore,
        MAX_SPONSOR_COST,
        86_400,
      ],
      PAYMASTER_FUND_WEI,
    );
    const voteStakeData = encodeFunctionData({
      abi: artifacts.DaoVotePaymaster.abi,
      functionName: "stake",
      args: [86_400],
    });
    await sendLegacy(account, {
      to: votePaymaster,
      data: voteStakeData,
      value: STAKE_WEI,
    });

    const setData = encodeFunctionData({
      abi: artifacts.DaoCore.abi,
      functionName: "setVotePaymaster",
      args: [votePaymaster],
    });
    await sendLegacy(account, { to: created.daoCore, data: setData });
  } else {
    console.log("[6/7] skipping vote paymaster");
  }
  console.log("[7/7] writing deployment record");

  const record = {
    chainId: CHAIN_ID,
    rpc: RPC,
    deployer: account.address,
    daoId,
    daoCore: created.daoCore,
    agentAccount: created.agentAccount,
    assetModule: created.assetModule,
    admin: account.address,
    agentSigner,
    factory,
    coreFactory,
    accountFactory,
    moduleFactory,
    usdc,
    assetId,
    fundWei: FUND_WEI.toString(),
    gasPaymaster,
    voteVerifier,
    votePaymaster,
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    "deployments/dao-1337.json",
    JSON.stringify(record, null, 2) + "\n",
  );
  console.log("\nwrote deployments/dao-1337.json");
  console.log(`agent key: ${agentKey}`);
  console.log("next: build the DAO frame txs with lib/daoFrameTx.mjs");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
