#!/usr/bin/env node
/**
 * Seed a native-ETH / USDC v4 pool and deploy the treasury funding helper.
 *
 *   node scripts/seed-usdc-pool.mjs
 *
 * This makes the "swap ETH -> USDC" path real: the admin's wallet can call
 * `TreasuryFundHelper.fund(...)` with ETH, the helper swaps through the pool,
 * and the USDC lands in the DAO. The pool's USDC is minted test liquidity; the
 * ETH side is the deployer's. It is a swap, not a faucet.
 *
 * Requires deployments/v4-1337.json (PoolManager + seeder) and
 * deployments/dao-1337.json (USDC). Env: DEPLOYER_KEY or WORKSHOP_STATE.
 */
import fs from "node:fs";
import path from "node:path";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileAll } from "../test/helpers/compile.mjs";

const RPC =
  process.env.DEVNET_RPC ?? "https://sidecar.161.118.164.226.nip.io/rpc";
const CHAIN_ID = Number(process.env.V4_CHAIN_ID ?? "1337");
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const V4_DIR = path.resolve("build/v4");
const V4_RECORD = path.resolve("deployments/v4-1337.json");
const DAO_RECORD = path.resolve("deployments/dao-1337.json");
const ZERO = "0x0000000000000000000000000000000000000000";
const FEE = 3000;
const TICK_SPACING = 60;
const PRICE = 5000n; // USDC per ETH (both tokens are 18 decimals)
const LIQUIDITY = 60n * 10n ** 18n;
const SEED_ETH = 860_000_000_000_000_000n; // 0.86 ETH
const SEED_USDC = 10_000n * 10n ** 18n;

function loadKey() {
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY;
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(`No DEPLOYER_KEY and no workshop state at ${STATE_PATH}`);
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (!state.participantKey) throw new Error("state has no participantKey");
  return state.participantKey;
}

function loadV4(name) {
  return JSON.parse(fs.readFileSync(path.join(V4_DIR, `${name}.json`), "utf8"));
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await sleep(2000);
  }
  throw new Error(`transaction ${hash} not mined in ${timeoutMs}ms`);
}

async function sendLegacy(account, { to = null, value = 0n, data = "0x" }) {
  const nonce = Number(
    await rpc("eth_getTransactionCount", [account.address, "pending"]),
  );
  let gasPrice = BigInt(await rpc("eth_gasPrice"));
  if (gasPrice === 0n) gasPrice = 1_000_000_000n;
  const estimateParams = {
    from: account.address,
    data,
    value: `0x${value.toString(16)}`,
  };
  if (to) estimateParams.to = to;
  const estimate = await rpc("eth_estimateGas", [estimateParams]);
  const gas = (BigInt(estimate) * 12n) / 10n;
  const raw = await account.signTransaction({
    chainId: CHAIN_ID,
    nonce,
    to,
    value,
    data,
    gas,
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

async function deploy(account, artifact, args = [], value = 0n) {
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const tx = await sendLegacy(account, { data, value });
  const address = tx.receipt.contractAddress;
  if (!address) throw new Error(`${artifact.name ?? "contract"} deploy failed`);
  console.log(`      ${artifact.name ?? "contract"}: ${address}`);
  return address;
}

async function read(artifact, address, functionName, args = []) {
  const data = encodeFunctionData({ abi: artifact.abi, functionName, args });
  const raw = await rpc("eth_call", [{ to: address, data }, "latest"]);
  return decodeFunctionResult({ abi: artifact.abi, functionName, data: raw });
}

async function send(account, artifact, address, functionName, args = []) {
  const data = encodeFunctionData({ abi: artifact.abi, functionName, args });
  return sendLegacy(account, { to: address, data });
}

function bigintSqrt(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const v4 = JSON.parse(fs.readFileSync(V4_RECORD, "utf8"));
  const dao = JSON.parse(fs.readFileSync(DAO_RECORD, "utf8"));
  const poolManager = v4.poolManager;
  const stateView = v4.stateView;
  const seeder = v4.seeder ?? v4.demoPool?.seeder;
  if (!poolManager) throw new Error("deployments/v4-1337.json has no poolManager");
  if (!stateView) throw new Error("deployments/v4-1337.json has no stateView");
  if (!seeder) throw new Error("deployments/v4-1337.json has no seeder");
  if (!dao.usdc) throw new Error("deployments/dao-1337.json has no usdc");

  const artifacts = compileAll();
  const seederArtifact = loadV4("V4PoolSeeder");
  const stateViewArtifact = loadV4("StateView");
  const tokenArtifact = { ...artifacts.MockERC20, name: "MockERC20" };

  const key = {
    currency0: ZERO,
    currency1: dao.usdc,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    hooks: ZERO,
  };
  const poolId = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [key],
    ),
  );
  const sqrtPriceX96 = bigintSqrt(PRICE * 2n ** 192n);

  console.log(`deployer:    ${account.address}`);
  console.log(`rpc:         ${RPC}`);
  console.log(`manager:     ${poolManager}`);
  console.log(`usdc:        ${dao.usdc}`);
  console.log(`seeder:      ${seeder}`);
  console.log(`poolId:      ${poolId}`);
  console.log(`sqrtPrice:   ${sqrtPriceX96}`);

  console.log("\n[1/5] initialize pool");
  const slot0 = await read(stateViewArtifact, stateView, "getSlot0", [poolId]);
  if (slot0[0] === 0n) {
    await send(account, seederArtifact, seeder, "initialize", [key, sqrtPriceX96]);
    console.log("      initialized");
  } else {
    console.log(`      already initialized (sqrtPriceX96=${slot0[0]})`);
  }

  console.log("[2/5] fund seeder");
  await send(account, tokenArtifact, dao.usdc, "mint", [seeder, SEED_USDC]);
  await sendLegacy(account, { to: seeder, value: SEED_ETH });
  console.log(`      minted ${SEED_USDC} USDC, sent ${SEED_ETH} wei`);

  console.log("[3/5] add liquidity");
  await send(account, seederArtifact, seeder, "addLiquidity", [
    key,
    -887220,
    887220,
    LIQUIDITY,
  ]);
  await send(account, seederArtifact, seeder, "sweep", [dao.usdc, account.address]);
  await send(account, seederArtifact, seeder, "sweep", [ZERO, account.address]);
  const liquidity = await read(stateViewArtifact, stateView, "getLiquidity", [poolId]);
  console.log(`      liquidity: ${liquidity}`);

  console.log("[4/5] deploy treasury fund helper");
  const helper = await deploy(
    account,
    { ...artifacts.TreasuryFundHelper, name: "TreasuryFundHelper" },
    [poolManager],
  );
  await send(account, artifacts.TreasuryFundHelper, helper, "setPool", [key, true]);
  console.log(`      helper:    ${helper}`);

  console.log("[5/5] record");
  const after = await read(stateViewArtifact, stateView, "getSlot0", [poolId]);
  v4.usdcPool = {
    key,
    poolId,
    sqrtPriceX96: String(after[0]),
    tick: String(after[1]),
    liquidity: String(liquidity),
    priceUsdcPerEth: String(PRICE),
  };
  v4.treasuryFundHelper = helper;
  fs.writeFileSync(V4_RECORD, JSON.stringify(v4, null, 2) + "\n");

  console.log("\nAdd these to .env.local:");
  console.log(`NEXT_PUBLIC_TREASURY_FUND_HELPER=${helper}`);
  console.log(`NEXT_PUBLIC_USDC_POOL_FEE=${FEE}`);
  console.log(`NEXT_PUBLIC_USDC_POOL_TICK_SPACING=${TICK_SPACING}`);
  console.log(`NEXT_PUBLIC_USDC_POOL_HOOKS=${ZERO}`);
  console.log("\nThe admin can now fund a DAO with ETH via the Treasury panel.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
