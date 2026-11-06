#!/usr/bin/env node
/**
 * Deploy the Groth16 verifier + ZkPaymaster to the ethrex devnet, build a
 * one-leaf demo authorized set, set the root, stake, and fund.
 *
 * Writes:
 *   deployments/zk-1337.json   public deployment record + demo tree
 *   .env.local                 NEXT_PUBLIC_ZK_* + demo secret (gitignored)
 *
 * The app's existing /pay path is untouched; use scripts/zk-sponsor.mjs for the
 * CLI flow until the UI is switched over.
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import {
  encodeDeployData,
  encodeFunctionData,
  parseEther,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileAll } from "../test/helpers/compile.mjs";
import { leafHash, rootAndPath } from "../lib/zk/tree.mjs";

const CHAIN_ID = 1337;
const RPC = process.env.DEVNET_RPC ?? "https://altmempool.forshtat.com";
const MEMPOOL_RPC =
  process.env.MEMPOOL_RPC ?? (RPC.endsWith("/rpc") ? RPC : `${RPC}/rpc`);
const REGISTRY =
  process.env.STAKING_REGISTRY ?? "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f";
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const STAKE_WEI = parseEther("0.012");
const FUND_WEI = parseEther("0.05");
const MAX_SPONSOR_COST = parseEther("0.01");

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
      value: toHex(value),
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

async function deployContract(account, artifacts, name, args = [], value = 0n) {
  const data = encodeDeployData({
    abi: artifacts[name].abi,
    bytecode: artifacts[name].bytecode,
    args,
  });
  const { hash, receipt } = await sendLegacy(account, { to: null, data, value });
  const address = receipt.contractAddress;
  if (!address) throw new Error(`${name} deploy produced no address`);
  console.log(`      ${name}: ${address} (${hash})`);
  return address;
}

async function callContract(account, artifacts, name, address, functionName, args = [], value = 0n) {
  const data = encodeFunctionData({
    abi: artifacts[name].abi,
    functionName,
    args,
  });
  return sendLegacy(account, { to: address, data, value });
}

function upsertEnv(file, entries) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter(Boolean);
  const keys = new Set(Object.keys(entries));
  const kept = lines.filter((line) => {
    if (line.startsWith("#") || !line.includes("=")) return true;
    return !keys.has(line.slice(0, line.indexOf("=")));
  });
  for (const [key, value] of Object.entries(entries)) kept.push(`${key}=${value}`);
  fs.writeFileSync(file, kept.join("\n") + "\n");
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const artifacts = compileAll();

  console.log(`deployer: ${account.address}`);
  console.log(`rpc:      ${RPC}`);

  const balance = BigInt(await rpc("eth_getBalance", [account.address, "latest"]));
  console.log(`balance:  ${Number(balance) / 1e18} ETH`);
  if (balance < parseEther("0.15")) {
    throw new Error("deployer needs at least 0.15 ETH for verifier + paymaster + stake");
  }

  console.log("\n[1/5] deploying Groth16 verifier...");
  const verifier = await deployContract(account, artifacts, "Groth16Verifier");

  console.log("[2/5] deploying ZkPaymaster (placeholder root)...");
  const paymaster = await deployContract(
    account,
    artifacts,
    "ZkPaymaster",
    [account.address, account.address, REGISTRY, verifier, MAX_SPONSOR_COST, 1n],
    FUND_WEI,
  );

  console.log("[3/5] building demo authorized set + root...");
  // Demo credential. In production the employee generates this and sends only
  // the leaf to the admin; the admin never sees the secret.
  const secret = BigInt("0x" + randomBytes(31).toString("hex")) || 1n;
  const leaf = await leafHash({
    secret,
    paymaster: BigInt(paymaster),
    chainId: CHAIN_ID,
  });
  const leaves = [leaf];
  const { root } = await rootAndPath(leaves, 0);
  await callContract(account, artifacts, "ZkPaymaster", paymaster, "setRoot", [root]);
  console.log(`      root: ${root}`);

  console.log("[4/5] staking the paymaster...");
  const stakeData = encodeFunctionData({
    abi: artifacts.ZkPaymaster.abi,
    functionName: "stake",
    args: [86_400],
  });
  const stakeTx = await sendLegacy(account, {
    to: paymaster,
    data: stakeData,
    value: STAKE_WEI,
  });
  console.log(`      stake tx: ${stakeTx.hash}`);

  console.log("[5/5] writing records...");
  const sessionKey = generatePrivateKey();
  const sessionAddress = privateKeyToAccount(sessionKey).address;
  const deployment = {
    chainId: CHAIN_ID,
    rpc: MEMPOOL_RPC,
    gateway: RPC,
    registry: REGISTRY,
    verifier,
    paymaster,
    root: root.toString(),
    epoch: "0",
    admin: account.address,
    treasury: account.address,
    maxSponsorCostWei: MAX_SPONSOR_COST.toString(),
    fundedWei: FUND_WEI.toString(),
    stakeWei: STAKE_WEI.toString(),
    // Public demo tree only. The secret and session private key go to
    // .env.local (gitignored), never to this record.
    demo: {
      leaves: leaves.map((v) => v.toString()),
      sessionAddress,
    },
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    "deployments/zk-1337.json",
    JSON.stringify(deployment, null, 2) + "\n",
  );

  upsertEnv(".env.local", {
    NEXT_PUBLIC_ZK_PAYMASTER: paymaster,
    NEXT_PUBLIC_ZK_VERIFIER: verifier,
    NEXT_PUBLIC_ZK_ROOT: root.toString(),
    NEXT_PUBLIC_ZK_EPOCH: "0",
    DEMO_ZK_SECRET: secret.toString(),
    DEMO_ZK_LEAVES: JSON.stringify(leaves.map((v) => v.toString())),
    DEMO_ZK_SESSION_KEY: sessionKey,
  });

  console.log("\nDeployed:");
  console.log(`  verifier:  ${verifier}`);
  console.log(`  paymaster: ${paymaster}`);
  console.log(`  root:      ${root}`);
  console.log(`  session:   ${sessionAddress} (0 ETH; the paymaster pays gas)`);
  console.log("\nWrote deployments/zk-1337.json and .env.local");
  console.log("Next: node scripts/zk-sponsor.mjs");
}

await main();
