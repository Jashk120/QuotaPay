#!/usr/bin/env node
/**
 * Spec §7.3 probe: does chain 1337 let a VERIFY frame inspect a later SENDER
 * frame? Deploys FrameReadProbe, then sends one frame tx whose VERIFY frame
 * targets the probe and whose SENDER frame has a known target/selector.
 *
 * The transaction is expected to be rejected; the revert data is the result.
 *
 *   node scripts/frame-read-probe.mjs --rpc https://altmempool.forshtat.com/rpc
 *
 * Key: DEPLOYER_KEY, or the participant key in the workshop state file.
 */
import fs from "node:fs";
import { decodeErrorResult, encodeDeployData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileAll } from "../test/helpers/compile.mjs";
import {
  serializeSponsoredTransfer,
  signSponsoredTransfer,
} from "../lib/devnetFrameTx.ts";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RPC = arg("rpc", "https://altmempool.forshtat.com/rpc");
const CHAIN_ID = 1337;
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const SENDER_TARGET = arg("target", "0x000000000000000000000000000000000000dEaD");
const SENDER_DATA = arg("data", "0xdeadbeef");

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
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const json = await rpc("eth_getTransactionReceipt", [hash]);
    if (json.result) return json.result;
    await sleep(2000);
  }
  throw new Error(`transaction ${hash} not mined`);
}

async function sendLegacy(account, { data }) {
  const nonce = Number(
    (await rpc("eth_getTransactionCount", [account.address, "pending"])).result,
  );
  const gasPrice = BigInt((await rpc("eth_gasPrice")).result ?? "0x3b9aca00");
  const estimate = await rpc("eth_estimateGas", [
    { from: account.address, data },
  ]);
  const gas = (BigInt(estimate.result) * 12n) / 10n;
  const raw = await account.signTransaction({
    chainId: CHAIN_ID,
    nonce,
    data,
    gas,
    gasPrice,
    type: "legacy",
  });
  const sent = await rpc("eth_sendRawTransaction", [raw]);
  if (sent.error) throw new Error(sent.error.message);
  const receipt = await waitMined(sent.result);
  if (receipt.status !== "0x1") throw new Error("probe deploy reverted");
  return receipt.contractAddress;
}

async function main() {
  const key = loadKey();
  const account = privateKeyToAccount(key);
  const artifacts = compileAll();

  console.log(`probe deployer: ${account.address}`);
  console.log(`rpc:            ${RPC}`);

  const probe = await sendLegacy(account, {
    data: encodeDeployData({
      abi: artifacts.FrameReadProbe.abi,
      bytecode: artifacts.FrameReadProbe.bytecode,
      args: [],
    }),
  });
  console.log(`probe:          ${probe}`);

  const nonce = BigInt(
    (await rpc("eth_getTransactionCount", [account.address, "pending"])).result,
  );
  const tx = {
    chainId: BigInt(CHAIN_ID),
    nonceKeys: [0n],
    nonceSeq: nonce,
    sender: account.address,
    frames: [
      {
        mode: 1, // VERIFY
        flags: 2, // approve execution
        to: probe,
        executionGas: 200_000n,
        stateGas: 0n,
        value: 0n,
        data: "0x",
      },
      {
        mode: 2, // SENDER
        flags: 0,
        to: SENDER_TARGET,
        executionGas: 50_000n,
        stateGas: 200_000n,
        value: 0n,
        data: SENDER_DATA,
      },
    ],
    signatures: [
      { scheme: 1, signer: account.address, msg: "0x", signature: "0x" },
    ],
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 2_000_000_000n,
    maxFeePerBlobGas: 0n,
    blobVersionedHashes: [],
    recentRootReferences: [],
  };

  const raw = serializeSponsoredTransfer(signSponsoredTransfer(tx, key));
  const response = await rpc("eth_sendRawTransaction", [raw]);
  console.log("\nraw RPC response:");
  console.log(JSON.stringify(response, null, 2));

  const data =
    response.error?.data?.data ??
    response.error?.data?.result ??
    response.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      const decoded = decodeErrorResult({
        abi: artifacts.FrameReadProbe.abi,
        data,
      });
      console.log("\nprobe result:");
      console.log({
        frameCount: decoded.args[0].toString(),
        currentFrame: decoded.args[1].toString(),
        senderMode: decoded.args[2].toString(),
        senderTarget: decoded.args[3],
        senderSelector: decoded.args[4],
        senderDataLength: decoded.args[5].toString(),
        senderHead: decoded.args[6],
      });
      console.log(
        "\nIf senderMode=2, senderTarget and senderSelector match, VERIFY can read SENDER frames. " +
          "Otherwise AgentAccount must use the spec §7.3 signature-only fallback.",
      );
    } catch (error) {
      console.log(`\ncould not decode probe result: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
