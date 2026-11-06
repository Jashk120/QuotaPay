#!/usr/bin/env node
/**
 * Create and seed one v4 pool, deploy a DAO swap module, and run a real swap.
 *
 *   node scripts/v4-seed.mjs
 *
 * Requires deployments/v4-1337.json (run scripts/deploy-v4.mjs first) and the
 * v4 build artifacts in build/v4.
 *
 * Env: DEVNET_RPC, DEPLOYER_KEY / WORKSHOP_STATE.
 */
import fs from "node:fs";
import path from "node:path";
import {
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileAll } from "../test/helpers/compile.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RPC = arg(
  "rpc",
  process.env.DEVNET_RPC ?? "https://sidecar.161.118.164.226.nip.io/rpc",
);
const CHAIN_ID = Number(arg("chain-id", process.env.V4_CHAIN_ID ?? "1337"));
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const V4_DIR = path.resolve("build/v4");
const RECORD = path.resolve("deployments/v4-1337.json");
const ZERO = "0x0000000000000000000000000000000000000000";
const Q96 = 2n ** 96n;
const FEE = 3000;
const TICK_SPACING = 60;
const MINT = 10n ** 24n;
const LIQUIDITY = 10n ** 21n;
const SWAP_IN = 10n ** 15n;

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

function sortTokens(a, b) {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const core = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  const poolManager = core.poolManager;
  if (!poolManager) throw new Error("deployments/v4-1337.json has no poolManager");

  const seederArtifact = loadV4("V4PoolSeeder");
  const stateViewArtifact = loadV4("StateView");
  const stateView = core.stateView;
  const artifacts = compileAll();

  console.log(`deployer: ${account.address}`);
  console.log(`rpc:      ${RPC}`);
  console.log(`manager:  ${poolManager}`);
  console.log(`state:    ${stateView}`);

  console.log("\n[1/6] demo tokens");
  const tokenA = await deploy(account, {
    ...artifacts.MockERC20,
    name: "MockERC20",
  }, ["V4A", "V4A"]);
  const tokenB = await deploy(account, {
    ...artifacts.MockERC20,
    name: "MockERC20",
  }, ["V4B", "V4B"]);
  const [token0, token1] = sortTokens(tokenA, tokenB);
  const key = {
    currency0: token0,
    currency1: token1,
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
  console.log(`      token0: ${token0}`);
  console.log(`      token1: ${token1}`);
  console.log(`      poolId: ${poolId}`);

  console.log("[2/6] seeder");
  const seeder = await deploy(account, seederArtifact, [poolManager]);

  console.log("[3/6] initialize + seed pool");
  await send(account, seederArtifact, seeder, "initialize", [key, Q96]);
  const tokenArtifact = { ...artifacts.MockERC20, name: "MockERC20" };
  for (const token of [token0, token1]) {
    await send(account, tokenArtifact, token, "mint", [seeder, MINT]);
  }
  await send(account, seederArtifact, seeder, "addLiquidity", [
    key,
    -887220,
    887220,
    LIQUIDITY,
  ]);
  for (const token of [token0, token1]) {
    await send(account, seederArtifact, seeder, "sweep", [token, account.address]);
  }
  const slot0 = await read(stateViewArtifact, stateView, "getSlot0", [poolId]);
  const liquidity = await read(stateViewArtifact, stateView, "getLiquidity", [poolId]);
  console.log(`      sqrtPriceX96: ${slot0[0]}`);
  console.log(`      tick:         ${slot0[1]}`);
  console.log(`      liquidity:    ${liquidity}`);

  console.log("[4/6] DAO swap module");
  const module = await deploy(account, {
    ...artifacts.DaoSwapModule,
    name: "DaoSwapModule",
  }, [poolManager, account.address, account.address]);
  await send(account, artifacts.DaoSwapModule, module, "setPool", [key, true]);

  console.log("[5/6] swap");
  await send(account, tokenArtifact, token0, "mint", [account.address, SWAP_IN]);
  await send(account, tokenArtifact, token0, "transfer", [module, SWAP_IN]);
  const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
  const deadline = BigInt(latest.timestamp) + 3600n;
  const request = {
    key,
    zeroForOne: true,
    amountIn: SWAP_IN,
    minAmountOut: 1n,
    deadline,
  };
  const swapTx = await send(
    account,
    artifacts.DaoSwapModule,
    module,
    "swap",
    [request],
  );
  const swapped = parseEventLogs({
    abi: artifacts.DaoSwapModule.abi,
    eventName: "Swapped",
    logs: swapTx.receipt.logs,
  })[0];
  const amountOut = swapped?.args?.amountOut ?? 0n;
  const outBalance = await read(
    tokenArtifact,
    key.currency1,
    "balanceOf",
    [account.address],
  );
  console.log(`      swap tx:   ${swapTx.hash}`);
  console.log(`      amountOut: ${amountOut}`);
  console.log(`      balance:   ${outBalance}`);
  if (amountOut === 0n && outBalance === 0n) {
    throw new Error("swap produced no output");
  }

  console.log("[6/6] record");
  core.demoPool = {
    token0,
    token1,
    key,
    poolId,
    sqrtPriceX96: String(Q96),
    tick: String(slot0[1]),
    liquidity: String(liquidity),
    seeder,
    seederRuntimeSize: seederArtifact.runtimeSize,
    swapModule: module,
    swap: {
      zeroForOne: true,
      amountIn: String(SWAP_IN),
      minAmountOut: "1",
      amountOut: String(amountOut),
      txHash: swapTx.hash,
    },
  };
  fs.writeFileSync(RECORD, JSON.stringify(core, null, 2) + "\n");
  console.log(`wrote ${RECORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
