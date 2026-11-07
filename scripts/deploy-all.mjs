#!/usr/bin/env node
/**
 * One script to rebuild the QuotaPay DAO stack from scratch.
 *
 * Deploys:
 *   DaoCoreFactory, AgentAccountFactory (wallet-enabled), AssetModuleFactory,
 *   optional DaoSwapModuleFactory, DaoFactory, MockERC20 (USDC), and the
 *   SharedDaoGasPaymaster. Optionally a demo DAO, the ZK vote verifier/paymaster,
 *   and the company sponsorship factory.
 *
 * Writes deployments/all-1337.json and updates .env.local with the new
 * addresses, so you never have to edit env by hand after a redeploy.
 *
 * Usage:
 *   npm run deploy:all
 *   npm run deploy:all -- --demo          # also create a demo DAO
 *   npm run deploy:all -- --demo --zk     # + vote verifier/paymaster
 *   npm run deploy:all -- --company       # + CompanyFactory (~0.05 ETH gas)
 *
 * Env:
 *   DEPLOYER_KEY              required unless WORKSHOP_STATE is readable
 *   WORKSHOP_STATE            default C:/projects/poolframes/workshop/.workshop-state.json
 *   DEVNET_RPC                default https://altmempool.forshtat.com
 *   STAKING_REGISTRY          default devnet registry
 *   DAO_AGENT_KEY             reused from .env.local if absent
 *   SHARED_PAYMASTER_FUND_ETH default 0.02
 *   SHARED_PAYMASTER_STAKE_ETH default 0.011 (> registry minimum 0.01)
 *   DAO_NAME / DAO_FUND_ETH   demo DAO name/funding
 *   MIN_DEPLOY_ETH            default 0.02 (0.15 with --demo)
 */
import fs from "node:fs";
import path from "node:path";
import {
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileAll } from "../test/helpers/compile.mjs";

const CHAIN_ID = 1337;
const addressZero = "0x0000000000000000000000000000000000000000";
const RPC_ROOT = (process.env.DEVNET_RPC ?? "https://altmempool.forshtat.com")
  .replace(/\/+$/, "")
  .replace(/\/rpc$/, "");
const REGISTRY =
  process.env.STAKING_REGISTRY ?? "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f";
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const ENV_PATH = path.resolve(".env.local");
const RECORD_PATH = path.resolve("deployments/all-1337.json");

const args = new Set(process.argv.slice(2));
const withDemo = args.has("--demo");
const withZk = args.has("--zk");
const withCompany = args.has("--company");
const force = args.has("--force");
const dryRun = args.has("--dry-run");

const PAYMASTER_FUND = parseEther(
  process.env.SHARED_PAYMASTER_FUND_ETH ?? "0.02",
);
const PAYMASTER_STAKE = parseEther(
  process.env.SHARED_PAYMASTER_STAKE_ETH ?? "0.011",
);
const MAX_SPONSOR_COST = parseEther(process.env.DAO_MAX_SPONSOR_ETH ?? "0.01");
const WITHDRAWAL_DELAY = 86_400;
const UNSTAKE_DELAY = 86_400;

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return new Map();
  const map = new Map();
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

function upsertEnv(entries) {
  const lines = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)
    : [];
  const pending = new Map(Object.entries(entries));
  const seen = new Set();
  const out = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !pending.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${pending.get(match[1])}`;
  });
  for (const [key, value] of pending) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_PATH, `${out.join("\n").replace(/\n+$/, "")}\n`);
}

function loadKey() {
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY;
  const env = readEnvFile();
  if (env.get("DEPLOYER_KEY")) return env.get("DEPLOYER_KEY");
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(
      `No DEPLOYER_KEY and no workshop state at ${STATE_PATH}`,
    );
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (!state.participantKey) throw new Error("workshop state has no participantKey");
  return state.participantKey;
}

async function rpc(method, params = []) {
  const res = await fetch(RPC_ROOT, {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await sleep(2_000);
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
    const estimateBig = BigInt(estimate);
    gasToUse = estimateBig + estimateBig / 20n;
    if (gasToUse > 59_000_000n) gasToUse = 59_000_000n;
    if (gasToUse < estimateBig) gasToUse = estimateBig;
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

async function deploy(account, artifacts, name, deployArgs = [], value = 0n, gas) {
  const data = encodeDeployData({
    abi: artifacts[name].abi,
    bytecode: artifacts[name].bytecode,
    args: deployArgs,
  });
  const tx = await sendLegacy(account, { to: null, data, value, gas });
  const address = tx.receipt.contractAddress;
  if (!address) throw new Error(`${name} deploy produced no address`);
  console.log(`      ${name.padEnd(24)} ${address}  (${tx.hash})`);
  return address;
}

function daoIdFromName(name) {
  const hex = stringToHex(name.slice(0, 31));
  return `${hex}${"0".repeat(Math.max(0, 66 - hex.length))}`;
}

async function main() {
  if (!fs.existsSync(ENV_PATH) && fs.existsSync(".env.example")) {
    fs.copyFileSync(".env.example", ENV_PATH);
    console.log("created .env.local from .env.example");
  }
  const artifacts = compileAll();
  const account = privateKeyToAccount(loadKey());
  const env = readEnvFile();

  const required = [
    "DaoCoreFactory",
    "AgentAccountFactory",
    "AssetModuleFactory",
    "DaoFactory",
    "MockERC20",
    "SharedDaoGasPaymaster",
  ];
  if (withZk) required.push("DaoVoteVerifier", "DaoVotePaymaster", "DaoCore");
  if (withCompany) required.push("CompanyFactory");
  const missing = required.filter((name) => !artifacts[name]);
  if (missing.length) {
    throw new Error(`compiled artifacts missing: ${missing.join(", ")}`);
  }

  // One server-held agent key signs for every DAO created by this factory.
  // Make sure it exists even when no demo DAO is deployed, because /new calls
  // /api/dao/agent-signer.
  const agentKey =
    process.env.DAO_AGENT_KEY ?? env.get("DAO_AGENT_KEY") ?? generatePrivateKey();
  const agentSigner = privateKeyToAccount(agentKey).address;

  console.log("QuotaPay full deploy");
  console.log(`  deployer: ${account.address}`);
  console.log(`  rpc:      ${RPC_ROOT}`);
  console.log(`  chain:    ${CHAIN_ID}`);
  console.log(
    `  options:  ${[
      withDemo ? "demo-dao" : null,
      withZk ? "zk-vote" : null,
      withCompany ? "company-factory" : null,
    ]
      .filter(Boolean)
      .join(", ") || "base stack"}`,
  );

  const balance = BigInt(
    await rpc("eth_getBalance", [account.address, "latest"]),
  );
  const balanceEth = Number(balance) / 1e18;
  let recommended =
    0.03 /* factory gas */ + Number(PAYMASTER_FUND + PAYMASTER_STAKE) / 1e18;
  if (withDemo) recommended += 0.13; // createDao gas + treasury funding
  if (withZk) recommended += 0.05; // verifier + vote paymaster + stake
  if (withCompany) recommended += 0.06; // CompanyFactory is large
  const minEth = force
    ? 0
    : Number(process.env.MIN_DEPLOY_ETH ?? recommended.toFixed(3));
  console.log(`  balance:  ${balanceEth.toFixed(6)} ETH`);
  if (balanceEth < minEth) {
    throw new Error(
      `deployer has ${balanceEth.toFixed(6)} ETH, need at least ${minEth}. ` +
        "Faucet the address or pass --force.",
    );
  }

  if (dryRun) {
    console.log("\nDry run: artifacts, key and balance are OK. Nothing was sent.");
    console.log(`  would deploy: ${required.join(", ")}`);
    console.log(`  env patch:    NEXT_PUBLIC_DAO_FACTORY, NEXT_PUBLIC_DAO_GAS_PAYMASTER, NEXT_PUBLIC_USDC_ADDRESS, DAO_GAS_PAYMASTER, DAO_RPC_URL`);
    return;
  }

  console.log("\n[1] DAO child factories");
  const coreFactory = await deploy(account, artifacts, "DaoCoreFactory");
  const accountFactory = await deploy(account, artifacts, "AgentAccountFactory");
  const moduleFactory = await deploy(account, artifacts, "AssetModuleFactory");

  let swapModuleFactory = process.env.DAO_SWAP_MODULE_FACTORY ?? addressZero;
  const poolManager = process.env.POOL_MANAGER ?? addressZero;
  if (swapModuleFactory === addressZero && poolManager !== addressZero) {
    console.log("      POOL_MANAGER set → deploying DaoSwapModuleFactory");
    swapModuleFactory = await deploy(
      account,
      artifacts,
      "DaoSwapModuleFactory",
      [poolManager],
    );
  }

  console.log("\n[2] DaoFactory");
  const factory = await deploy(account, artifacts, "DaoFactory", [
    coreFactory,
    accountFactory,
    moduleFactory,
    swapModuleFactory,
  ]);

  console.log("\n[3] treasury token (MockERC20 / USDC)");
  const usdc = await deploy(account, artifacts, "MockERC20", ["USDC", "USDC"]);

  console.log("\n[4] shared gas paymaster");
  const sharedGasPaymaster = await deploy(
    account,
    artifacts,
    "SharedDaoGasPaymaster",
    [
      account.address,
      account.address,
      REGISTRY,
      MAX_SPONSOR_COST,
      WITHDRAWAL_DELAY,
    ],
    PAYMASTER_FUND,
  );
  const stakeData = encodeFunctionData({
    abi: artifacts.SharedDaoGasPaymaster.abi,
    functionName: "stake",
    args: [UNSTAKE_DELAY],
  });
  await sendLegacy(account, {
    to: sharedGasPaymaster,
    data: stakeData,
    value: PAYMASTER_STAKE,
  });
  console.log(
    `      funded ${Number(PAYMASTER_FUND) / 1e18} ETH + staked ${Number(PAYMASTER_STAKE) / 1e18} ETH`,
  );

  let demo = null;
  if (withDemo) {
    console.log("\n[5] demo DAO");
    const name = process.env.DAO_NAME ?? "Demo DAO";
    const daoId = daoIdFromName(name);
    const fund = parseEther(process.env.DAO_FUND_ETH ?? "0.02");
    const createData = encodeFunctionData({
      abi: artifacts.DaoFactory.abi,
      functionName: "createDao",
      args: [
        {
          daoId,
          admin: account.address,
          agentSigner,
          frameEnforced: process.env.DAO_FRAME_ENFORCED !== "false",
          memberPeriodLength: 2_592_000,
          addMemberLimit: 10,
          votePeriod: 86_400,
          quorumBps: 5_000,
        },
        [],
        [
          {
            token: usdc,
            perTx: parseEther("200"),
            perPeriod: parseEther("5000"),
            periodLength: 2_592_000,
          },
        ],
        [],
      ],
    });
    const createTx = await sendLegacy(account, {
      to: factory,
      data: createData,
      value: fund,
    });
    const created = parseEventLogs({
      abi: artifacts.DaoFactory.abi,
      eventName: "DaoCreated",
      logs: createTx.receipt.logs,
    })[0]?.args;
    if (!created) throw new Error("DaoCreated event not found");
    console.log(`      ${name}: ${created.daoCore}`);
    console.log(`      agent:  ${created.agentAccount}`);

    // Give the demo treasury test USDC.
    const mintData = encodeFunctionData({
      abi: artifacts.MockERC20.abi,
      functionName: "mint",
      args: [created.daoCore, parseEther("10000")],
    });
    await sendLegacy(account, { to: usdc, data: mintData });

    // Let the shared paymaster sponsor this DAO's agent.
    const allowData = encodeFunctionData({
      abi: artifacts.SharedDaoGasPaymaster.abi,
      functionName: "allowAgent",
      args: [created.daoCore],
    });
    await sendLegacy(account, {
      to: sharedGasPaymaster,
      data: allowData,
    });
    console.log("      gas sponsorship enabled");

    demo = {
      name,
      daoId,
      daoCore: created.daoCore,
      agentAccount: created.agentAccount,
      assetModule: created.assetModule,
      agentSigner,
      agentKey,
      fundingWei: fund.toString(),
    };

    if (withZk) {
      console.log("\n[6] ZK vote verifier + paymaster");
      const voteVerifier = await deploy(account, artifacts, "DaoVoteVerifier");
      const votePaymaster = await deploy(
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
          WITHDRAWAL_DELAY,
        ],
        PAYMASTER_FUND,
      );
      const voteStake = encodeFunctionData({
        abi: artifacts.DaoVotePaymaster.abi,
        functionName: "stake",
        args: [UNSTAKE_DELAY],
      });
      await sendLegacy(account, {
        to: votePaymaster,
        data: voteStake,
        value: PAYMASTER_STAKE,
      });
      const setPaymaster = encodeFunctionData({
        abi: artifacts.DaoCore.abi,
        functionName: "setVotePaymaster",
        args: [votePaymaster],
      });
      await sendLegacy(account, {
        to: created.daoCore,
        data: setPaymaster,
      });
      demo.voteVerifier = voteVerifier;
      demo.votePaymaster = votePaymaster;
      console.log(`      vote paymaster: ${votePaymaster}`);
    }
  } else if (withZk) {
    console.log("\n[5] --zk ignored: the vote paymaster is bound to a DAO (pass --demo)");
  }

  let companyFactory = null;
  if (withCompany) {
    console.log("\n[6] company sponsorship factory");
    companyFactory = await deploy(
      account,
      artifacts,
      "CompanyFactory",
      [addressZero, REGISTRY],
      0n,
      28_000_000n,
    );
  }

  const envPatch = {
    NEXT_PUBLIC_DAO_FACTORY: factory,
    NEXT_PUBLIC_DAO_GAS_PAYMASTER: sharedGasPaymaster,
    NEXT_PUBLIC_USDC_ADDRESS: usdc,
    NEXT_PUBLIC_USDC_DECIMALS: "18",
    DAO_GAS_PAYMASTER: sharedGasPaymaster,
    DAO_RPC_URL: `${RPC_ROOT}/rpc`,
    DAO_CHAIN_ID: String(CHAIN_ID),
    DAO_AGENT_KEY: agentKey,
  };
  if (demo) {
    envPatch.NEXT_PUBLIC_DAO_CORE = demo.daoCore;
    envPatch.DAO_CORE = demo.daoCore;
    envPatch.NEXT_PUBLIC_DAO_NAME = demo.name;
  } else {
    // A fresh factory means old defaults point at orphaned contracts.
    envPatch.NEXT_PUBLIC_DAO_CORE = "";
    envPatch.DAO_CORE = "";
  }
  if (companyFactory) envPatch.NEXT_PUBLIC_FACTORY_ADDRESS = companyFactory;
  upsertEnv(envPatch);

  const record = {
    chainId: CHAIN_ID,
    rpc: RPC_ROOT,
    deployer: account.address,
    coreFactory,
    accountFactory,
    moduleFactory,
    swapModuleFactory,
    factory,
    usdc,
    sharedGasPaymaster,
    paymasterFundingWei: PAYMASTER_FUND.toString(),
    paymasterStakeWei: PAYMASTER_STAKE.toString(),
    companyFactory,
    demo,
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(RECORD_PATH), { recursive: true });
  fs.writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);

  console.log("\nDone.");
  console.log(`  record:   deployments/all-1337.json`);
  console.log(`  env:      .env.local updated`);
  console.log(`  factory:  ${factory}`);
  console.log(`  paymaster:${sharedGasPaymaster}`);
  console.log(`  usdc:     ${usdc}`);
  if (demo) {
    console.log(`  demo DAO: ${demo.daoCore}`);
    console.log(`  open:     /dao/${demo.daoCore}/chat`);
  } else {
    console.log("  next:     npm run dev, then create a DAO from /new");
  }
  console.log("  restart the dev server so the new NEXT_PUBLIC_* values load.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
