#!/usr/bin/env node
/**
 * Deploy CompanyFactory + a demo company to the ethrex devnet, stake the
 * paymaster, and enroll a demo beneficiary.
 *
 * Key source (in order):
 *   DEPLOYER_KEY env
 *   WORKSHOP_STATE (default C:/projects/poolframes/workshop/.workshop-state.json)
 *
 * Writes:
 *   deployments/1337.json   public deployment record (safe to commit)
 *   .env.local              app config + demo beneficiary key (gitignored)
 */
import fs from "node:fs";
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
const RPC = process.env.DEVNET_RPC ?? "https://altmempool.forshtat.com";
const MEMPOOL_RPC =
  process.env.MEMPOOL_RPC ??
  (RPC.endsWith("/rpc") ? RPC : `${RPC}/rpc`);
const REGISTRY =
  process.env.STAKING_REGISTRY ?? "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f";
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const STAKE_WEI = parseEther("0.012");
const FUND_WEI = parseEther("0.05");
const MAX_SPONSOR_COST = parseEther("0.002");

function loadKey() {
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY;
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(
      `No DEPLOYER_KEY and no workshop state at ${STATE_PATH}`,
    );
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

async function main() {
  const account = privateKeyToAccount(loadKey());
  const artifacts = compileAll();

  console.log(`deployer: ${account.address}`);
  console.log(`rpc:      ${RPC}`);

  const balance = BigInt(await rpc("eth_getBalance", [account.address, "latest"]));
  console.log(`balance:  ${Number(balance) / 1e18} ETH`);
  if (balance < parseEther("0.1")) {
    throw new Error("deployer needs at least 0.1 ETH for deployment + stake");
  }

  // 1. Factory (or resume an already-broadcast deployment)
  let factory;
  const resumeFactory = process.env.RESUME_FACTORY;
  if (resumeFactory) {
    console.log(`\n[1/5] waiting for factory ${resumeFactory}...`);
    factory = resumeFactory;
    let code = "0x";
    for (let i = 0; i < 120; i++) {
      code = await rpc("eth_getCode", [factory, "latest"]);
      if (code !== "0x") break;
      await sleep(5000);
    }
    if (code === "0x") {
      throw new Error(
        `factory ${factory} still has no code; the devnet may be stalled`,
      );
    }
    console.log(`      factory ready: ${factory}`);
  } else {
    console.log("\n[1/5] deploying CompanyFactory...");
    const factoryData = encodeDeployData({
      abi: artifacts.CompanyFactory.abi,
      bytecode: artifacts.CompanyFactory.bytecode,
      args: ["0x0000000000000000000000000000000000000000", REGISTRY],
    });
    const factoryTx = await sendLegacy(account, { to: null, data: factoryData });
    factory = factoryTx.receipt.contractAddress;
    if (!factory) throw new Error("factory deploy produced no address");
    console.log(`      factory: ${factory} (${factoryTx.hash})`);
  }

  // 2. Demo company
  console.log("[2/5] creating demo company 'acme'???");
  const companyId = keccak256(stringToHex("acme"));
  const companyConfig = {
    companyId,
    admin: account.address,
    treasury: account.address,
    globalCreditLimit: 500n,
    companyPeriodLength: 2_592_000, // 30 days
    creditPerTx: 1n,
    maxSponsorCost: MAX_SPONSOR_COST,
    withdrawalDelay: 86_400, // 1 day
  };
  const createData = encodeFunctionData({
    abi: artifacts.CompanyFactory.abi,
    functionName: "createCompany",
    args: [companyConfig],
  });
  const createTx = await sendLegacy(account, {
    to: factory,
    data: createData,
    value: FUND_WEI,
  });
  const createdEvents = parseEventLogs({
    abi: artifacts.CompanyFactory.abi,
    eventName: "CompanyCreated",
    logs: createTx.receipt.logs,
  });
  const paymaster = createdEvents[0]?.args?.paymaster;
  if (!paymaster) throw new Error("CompanyCreated event not found");
  console.log(`      paymaster: ${paymaster} (${createTx.hash})`);

  // 3. Stake the instance (ERC-8421)
  console.log("[3/5] staking the paymaster???");
  const stakeData = encodeFunctionData({
    abi: artifacts.CompanyPaymaster.abi,
    functionName: "stake",
    args: [86_400],
  });
  const stakeTx = await sendLegacy(account, {
    to: paymaster,
    data: stakeData,
    value: STAKE_WEI,
  });
  console.log(`      stake tx: ${stakeTx.hash}`);

  // 4. Enroll a demo beneficiary
  console.log("[4/5] enrolling demo beneficiary???");
  const beneficiaryKey = process.env.BENEFICIARY_KEY ?? generatePrivateKey();
  const beneficiary = privateKeyToAccount(beneficiaryKey).address;
  const enrollData = encodeFunctionData({
    abi: artifacts.CompanyPaymaster.abi,
    functionName: "enroll",
    args: [
      keccak256(stringToHex("alice")),
      beneficiary,
      0n,
      2_592_000,
      100n,
      keccak256(stringToHex("engineering")),
    ],
  });
  const enrollTx = await sendLegacy(account, {
    to: paymaster,
    data: enrollData,
  });
  console.log(`      beneficiary: ${beneficiary} (${enrollTx.hash})`);

  // 5. Verify
  console.log("[5/5] verifying deployment???");
  const [factoryCode, paymasterCode] = await Promise.all([
    rpc("eth_getCode", [factory, "latest"]),
    rpc("eth_getCode", [paymaster, "latest"]),
  ]);
  if (factoryCode === "0x" || paymasterCode === "0x") {
    throw new Error("deployment verification failed: missing code");
  }
  console.log(`      factory code:   ${(factoryCode.length - 2) / 2} bytes`);
  console.log(`      paymaster code: ${(paymasterCode.length - 2) / 2} bytes`);

  const deployments = {
    chainId: CHAIN_ID,
    rpc: MEMPOOL_RPC,
    gateway: RPC,
    registry: REGISTRY,
    factory,
    paymaster,
    companyId: "acme",
    companyIdBytes32: companyId,
    admin: account.address,
    treasury: account.address,
    beneficiary,
    beneficiaryId: "alice",
    stakeWei: STAKE_WEI.toString(),
    fundedWei: FUND_WEI.toString(),
    maxSponsorCostWei: MAX_SPONSOR_COST.toString(),
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    "deployments/1337.json",
    JSON.stringify(deployments, null, 2),
  );

  const env = [
    "# generated by scripts/deploy.mjs",
    `NEXT_PUBLIC_CHAIN_ID=${CHAIN_ID}`,
    `NEXT_PUBLIC_RPC_URL=${MEMPOOL_RPC}`,
    `NEXT_PUBLIC_GATEWAY_URL=${RPC}`,
    `NEXT_PUBLIC_FACTORY_ADDRESS=${factory}`,
    `NEXT_PUBLIC_DEFAULT_PAYMASTER=${paymaster}`,
    `NEXT_PUBLIC_STAKING_REGISTRY=${REGISTRY}`,
    "NEXT_PUBLIC_EXPLORER_URL=https://explorer.altmempool.wtf",
    "NEXT_PUBLIC_ENABLE_SUBMIT=true",
    `DEMO_BENEFICIARY_KEY=${beneficiaryKey}`,
    "",
  ].join("\n");
  fs.writeFileSync(".env.local", env);

  console.log("\nDeployed:");
  console.log(`  factory:   ${factory}`);
  console.log(`  paymaster: ${paymaster}`);
  console.log(`  admin:     ${account.address}`);
  console.log(`  beneficiary: ${beneficiary}`);
  console.log("\nWrote deployments/1337.json and .env.local");
  console.log("Demo beneficiary key is in .env.local (gitignored).");
}

await main();


