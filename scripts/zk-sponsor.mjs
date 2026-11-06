#!/usr/bin/env node
/**
 * Build a ZK membership proof, encode ZkPaymaster.charge(...), sign a sponsored
 * EIP-8141 frame transaction with a 0-ETH session key, and submit it.
 *
 * Prerequisites:
 *   node scripts/zk-setup.mjs      # compiles circuit + verifier, builds zkey
 *   node scripts/deploy-zk.mjs     # deploys verifier + paymaster, sets root
 *
 * Reads deployments/zk-1337.json (demo secret/leaves/session key) and .env.local
 * for the RPC. In production the secret and Merkle path come from the
 * employee's own client and the company's path API, not from a deployment file.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  decodeFunctionResult,
  encodeFunctionData,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { zkPaymasterAbi } from "../lib/abis.ts";
import {
  buildSponsoredTransfer,
  sendFrameSponsoredTransfer,
  serializeSponsoredTransfer,
  signSponsoredTransfer,
  sponsoredTransferHash,
} from "../lib/devnetFrameTx.ts";
import { membershipWitness } from "../lib/zk/tree.mjs";

function loadEnv() {
  const env = {};
  if (!fs.existsSync(".env.local")) return env;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

const env = loadEnv();
if (!fs.existsSync("deployments/zk-1337.json")) {
  throw new Error("deployments/zk-1337.json missing; run node scripts/deploy-zk.mjs");
}
const deployment = JSON.parse(fs.readFileSync("deployments/zk-1337.json", "utf8"));
const rpcUrl = env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const paymaster = deployment.paymaster;
const chainId = Number(deployment.chainId);
const root = BigInt(deployment.root);
const epoch = BigInt(deployment.epoch);
if (!env.DEMO_ZK_SECRET || !env.DEMO_ZK_SESSION_KEY) {
  throw new Error(
    "DEMO_ZK_SECRET / DEMO_ZK_SESSION_KEY missing from .env.local; rerun node scripts/deploy-zk.mjs",
  );
}
const secret = BigInt(env.DEMO_ZK_SECRET);
const leaves = deployment.demo.leaves.map(BigInt);
const sessionKey = env.DEMO_ZK_SESSION_KEY;
const session = privateKeyToAccount(sessionKey);
const to = process.env.ZK_TO ?? "0x000000000000000000000000000000000000dEaD";
const value = BigInt(process.env.ZK_VALUE ?? "0");
const maxFee = parseGwei(process.env.ZK_MAX_FEE_GWEI ?? "2");

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result;
}

async function read(functionName, args = []) {
  const data = encodeFunctionData({ abi: zkPaymasterAbi, functionName, args });
  const result = await rpc("eth_call", [{ to: paymaster, data }, "latest"]);
  return decodeFunctionResult({ abi: zkPaymasterAbi, functionName, data: result });
}

async function main() {
  console.log(`paymaster: ${paymaster}`);
  console.log(`session:   ${session.address}`);
  console.log(`rpc:       ${rpcUrl}`);

  if (value > 0n) {
    const bal = BigInt(await rpc("eth_getBalance", [session.address, "latest"]));
    if (bal < value) {
      throw new Error(
        `frame value is debited from tx.sender (EIP-8141), but ${session.address} has ${bal} wei; the sponsor pays gas, not the transfer value`,
      );
    }
  }

  const witness = await membershipWitness({
    secret,
    paymaster: BigInt(paymaster),
    chainId,
    epoch,
    sessionKey: BigInt(session.address),
    leaves,
    index: 0,
  });
  if (BigInt(witness.root) !== root) {
    throw new Error(
      `tree root mismatch: witness ${witness.root} vs deployed ${root}; regenerate the root or the path`,
    );
  }
  const used = await read("usedNullifier", [
    BigInt(witness.identityNullifier),
  ]);
  if (used) {
    throw new Error(
      "this credential's nullifier is already spent in the current epoch; rotate the epoch or issue a new credential",
    );
  }

  const out = path.resolve("build/zk");
  const inputPath = path.join(out, "sponsor-input.json");
  const proofPath = path.join(out, "sponsor-proof.json");
  const publicPath = path.join(out, "sponsor-public.json");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(inputPath, JSON.stringify(witness.input, null, 2) + "\n");

  const snarkjsCli = path.resolve("node_modules/snarkjs/build/cli.cjs");
  const snark = (...argv) =>
    execFileSync(process.execPath, [snarkjsCli, ...argv], { stdio: "inherit" });
  snark(
    "groth16",
    "fullprove",
    inputPath,
    path.join(out, "Membership_js", "Membership.wasm"),
    path.join(out, "Membership_final.zkey"),
    proofPath,
    publicPath,
  );
  snark(
    "groth16",
    "verify",
    path.join(out, "verification_key.json"),
    publicPath,
    proofPath,
  );

  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  const publicInputs = JSON.parse(fs.readFileSync(publicPath, "utf8"));
  console.log("public inputs:", publicInputs);

  // snarkjs' Solidity convention swaps the two B coordinates.
  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];

  const chargeData = encodeFunctionData({
    abi: zkPaymasterAbi,
    functionName: "charge",
    args: [
      a,
      b,
      c,
      BigInt(witness.identityNullifier),
      BigInt(witness.sessionNullifier),
    ],
  });

  const nonce = BigInt(
    await rpc("eth_getTransactionCount", [session.address, "pending"]),
  );
  const tx = buildSponsoredTransfer({
    sender: session.address,
    paymaster,
    to,
    value,
    nonce,
    chainId,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: maxFee,
    chargeData,
    // Measured verifier: ~249k. 330k leaves room for calldata decode, the
    // nullifier writes (state gas is separate), and future verifier drift.
    chargeExecutionGas: 330_000n,
    chargeStateGas: 300_000n,
  });
  const signed = signSponsoredTransfer(tx, sessionKey);
  const raw = serializeSponsoredTransfer(signed);
  console.log(`\nwire bytes: ${(raw.length - 2) / 2}`);
  console.log(`tx hash:    ${sponsoredTransferHash(signed)}`);

  const hash = await sendFrameSponsoredTransfer(rpcUrl, signed);
  console.log(`submitted:  ${hash}`);

  let receipt = null;
  for (let i = 0; i < 60; i++) {
    receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!receipt) {
    console.log("still pending after 2 minutes");
    process.exitCode = 1;
    return;
  }
  console.log(`\nstatus: ${receipt.status}  block: ${receipt.blockNumber}`);
  if (receipt.payer) console.log(`payer:  ${receipt.payer}`);
  if (receipt.frameReceipts) {
    for (const [i, f] of receipt.frameReceipts.entries()) {
      console.log(
        `  #${i}: status=${f.status} gasUsed=${f.gasUsed} stateGasUsed=${f.stateGasUsed}`,
      );
    }
  }
  const nowUsed = await read("usedNullifier", [
    BigInt(witness.identityNullifier),
  ]);
  console.log(`identity nullifier spent: ${nowUsed}`);
}

await main();
