#!/usr/bin/env node
/**
 * Phase 0 probe (UNISWAP-V4.md §9): is the target chain ready for a v4
 * `PoolManager`?
 *
 * Checks the read-only chain facts (`eth_chainId`, block gas limit) and then
 * deploys `TransientProbe` — compiled with solc 0.8.28, `evmVersion: "cancun"`
 * — to exercise `TSTORE`/`TLOAD` and `MCOPY`. The DAO's own build stays on
 * shanghai; this is a one-off compile so a Cancun-capable chain is required.
 *
 *   node scripts/v4-probe.mjs --rpc https://altmempool.forshtat.com/rpc
 *
 * Key: DEPLOYER_KEY, or the participant key in the workshop state file.
 */
import fs from "node:fs";
import solc from "solc";
import { encodeDeployData, encodeFunctionData, decodeFunctionResult } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RPC = arg("rpc", process.env.DEVNET_RPC ?? "https://altmempool.forshtat.com/rpc");
const CHAIN_ID = Number(arg("chain-id", "1337"));
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";

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
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
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
  throw new Error(`transaction ${hash} not mined`);
}

function compileProbe() {
  const source = fs.readFileSync(
    "contracts/probe/TransientProbe.sol",
    "utf8",
  );
  const input = {
    language: "Solidity",
    sources: { "TransientProbe.sol": { content: source } },
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (output.errors ?? []).filter((e) => e.severity === "error");
  if (fatal.length > 0) {
    throw new Error(
      "solc errors:\n" + fatal.map((e) => e.formattedMessage).join("\n"),
    );
  }
  const contract = output.contracts["TransientProbe.sol"].TransientProbe;
  return {
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  };
}

async function sendDeploy(account, data) {
  const nonce = Number(await rpc("eth_getTransactionCount", [account.address, "pending"]));
  const gasPrice = BigInt((await rpc("eth_gasPrice")) ?? "0x3b9aca00");
  const estimate = await rpc("eth_estimateGas", [
    { from: account.address, data },
  ]);
  const gas = (BigInt(estimate) * 12n) / 10n;
  const raw = await account.signTransaction({
    chainId: CHAIN_ID,
    nonce,
    data,
    gas,
    gasPrice,
    type: "legacy",
  });
  const hash = await rpc("eth_sendRawTransaction", [raw]);
  const receipt = await waitMined(hash);
  if (receipt.status !== "0x1") throw new Error("probe deploy reverted");
  return receipt.contractAddress;
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const result = {
    chainId: Number(await rpc("eth_chainId")),
    rpc: RPC,
    deployer: account.address,
  };

  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  result.blockNumber = Number(block.number);
  result.blockGasLimit = Number(block.gasLimit);

  const probeArtifact = compileProbe();
  result.probe = await sendDeploy(
    account,
    encodeDeployData({
      abi: probeArtifact.abi,
      bytecode: probeArtifact.bytecode,
      args: [],
    }),
  );

  const call = async (functionName, value) => {
    const data = encodeFunctionData({
      abi: probeArtifact.abi,
      functionName,
      args: [value],
    });
    const raw = await rpc("eth_call", [{ to: result.probe, data }, "latest"]);
    return decodeFunctionResult({
      abi: probeArtifact.abi,
      functionName,
      data: raw,
    });
  };

  const selfDestruct = 0xdeadbeefn;
  try {
    result.tstore = (await call("roundTrip", selfDestruct)) === selfDestruct;
  } catch (error) {
    result.tstore = false;
    result.tstoreError = error.message;
  }
  try {
    result.mcopy = (await call("copy", selfDestruct)) === selfDestruct;
  } catch (error) {
    result.mcopy = false;
    result.mcopyError = error.message;
  }
  result.chainIdMatches = result.chainId === CHAIN_ID;

  console.log(JSON.stringify(result, null, 2));

  const ok = result.chainIdMatches && result.tstore && result.mcopy;
  if (!ok) {
    console.error(
      "\nFAIL: chain is not ready for v4. Do not deploy a PoolManager.",
    );
    process.exitCode = 2;
    return;
  }
  console.log(
    "\nPASS: chain id, gas limit, TSTORE/TLOAD and MCOPY are usable.\n" +
      "Next: pin and build v4-core (Phase 1), then record the PoolManager size.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
