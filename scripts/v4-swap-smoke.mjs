#!/usr/bin/env node
/**
 * Exercise the deployed v4 pool through DaoSwapModule:
 *   - token0 -> token1
 *   - token1 -> token0
 *   - slippage rejection
 *   - deadline rejection
 *
 *   node scripts/v4-swap-smoke.mjs
 *
 * Requires deployments/v4-1337.json with a `demoPool` (run scripts/v4-seed.mjs).
 */
import fs from "node:fs";
import path from "node:path";
import {
  decodeFunctionResult,
  encodeFunctionData,
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
const RECORD = path.resolve("deployments/v4-1337.json");
const V4_DIR = path.resolve("build/v4");
const AMOUNT_IN = 10n ** 15n;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await sleep(2000);
  }
  throw new Error(`transaction ${hash} not mined`);
}

async function sendLegacy(account, { to, data = "0x", value = 0n }) {
  const nonce = Number(
    await rpc("eth_getTransactionCount", [account.address, "pending"]),
  );
  let gasPrice = BigInt(await rpc("eth_gasPrice"));
  if (gasPrice === 0n) gasPrice = 1_000_000_000n;
  const estimate = await rpc("eth_estimateGas", [
    { from: account.address, to, data, value: `0x${value.toString(16)}` },
  ]);
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
    throw new Error(`transaction ${hash} reverted`);
  }
  return { hash, receipt };
}

async function call(account, to, data) {
  return rpc("eth_call", [{ from: account.address, to, data }, "latest"]);
}

async function read(artifact, address, functionName, args = []) {
  const data = encodeFunctionData({ abi: artifact.abi, functionName, args });
  const raw = await rpc("eth_call", [{ to: address, data }, "latest"]);
  return decodeFunctionResult({ abi: artifact.abi, functionName, data: raw });
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const record = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  const pool = record.demoPool;
  if (!pool) throw new Error("no demoPool in deployments/v4-1337.json; run v4-seed.mjs");

  const artifacts = compileAll();
  const moduleAbi = artifacts.DaoSwapModule.abi;
  const tokenAbi = artifacts.MockERC20.abi;
  const stateView = JSON.parse(
    fs.readFileSync(path.join(V4_DIR, "StateView.json"), "utf8"),
  );

  const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
  const deadline = BigInt(latest.timestamp) + 3600n;
  const results = {
    ranAt: new Date().toISOString(),
    swaps: [],
  };

  const runSwap = async (zeroForOne, amountIn, minAmountOut, deadlineValue) => {
    const input = zeroForOne ? pool.token0 : pool.token1;
    await sendLegacy(account, {
      to: input,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "mint",
        args: [pool.swapModule, amountIn],
      }),
    });
    const request = {
      key: pool.key,
      zeroForOne,
      amountIn,
      minAmountOut,
      deadline: deadlineValue,
    };
    const data = encodeFunctionData({
      abi: moduleAbi,
      functionName: "swap",
      args: [request],
    });
    return { data, request };
  };

  for (const zeroForOne of [true, false]) {
    const { data } = await runSwap(zeroForOne, AMOUNT_IN, 1n, deadline);
    const tx = await sendLegacy(account, { to: pool.swapModule, data });
    const event = parseEventLogs({
      abi: moduleAbi,
      eventName: "Swapped",
      logs: tx.receipt.logs,
    })[0];
    if (!event) throw new Error("Swapped event missing");
    const amountOut = event.args.amountOut;
    if (amountOut === 0n) throw new Error("zero swap output");
    results.swaps.push({
      zeroForOne,
      amountIn: String(AMOUNT_IN),
      amountOut: String(amountOut),
      txHash: tx.hash,
    });
    console.log(
      `${zeroForOne ? "token0->token1" : "token1->token0"}: ${amountOut} out (${tx.hash})`,
    );
  }

  // Slippage: ask for an impossible output. The module must revert.
  const slippage = await runSwap(true, AMOUNT_IN, 10n ** 30n, deadline);
  try {
    await call(account, pool.swapModule, slippage.data);
    throw new Error("slippage case did not revert");
  } catch (error) {
    const message = String(error.message);
    if (!message.includes("slippage")) {
      throw new Error(`expected slippage revert, got: ${message}`);
    }
    results.slippage = "reverted: slippage";
    console.log("slippage: reverted as expected");
  }

  // Deadline: zero is already in the past.
  const expired = await runSwap(true, AMOUNT_IN, 1n, 0n);
  try {
    await call(account, pool.swapModule, expired.data);
    throw new Error("expired case did not revert");
  } catch (error) {
    const message = String(error.message);
    if (!message.includes("expired")) {
      throw new Error(`expected expired revert, got: ${message}`);
    }
    results.expired = "reverted: expired";
    console.log("deadline: reverted as expected");
  }

  results.slot0After = (
    await read(stateView, record.stateView, "getSlot0", [pool.poolId])
  ).map(String);
  results.liquidityAfter = String(
    await read(stateView, record.stateView, "getLiquidity", [pool.poolId]),
  );
  record.smoke = results;
  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
  console.log(`wrote ${RECORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
