#!/usr/bin/env node
/**
 * End-to-end smoke test against the deployed CompanyPaymaster:
 * build -> sign -> submit a real sponsored EIP-8141 frame transaction.
 *
 * Reads .env.local (demo beneficiary key, RPC) and deployments/1337.json.
 */
import fs from "node:fs";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  keccak256,
  parseGwei,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { companyPaymasterAbi } from "../lib/abis.ts";
import {
  buildSponsoredTransfer,
  sendFrameSponsoredTransfer,
  serializeSponsoredTransfer,
  signSponsoredTransfer,
  sponsoredTransferHash,
} from "../lib/devnetFrameTx.ts";

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
const deployment = JSON.parse(fs.readFileSync("deployments/1337.json", "utf8"));
const rpcUrl = env.NEXT_PUBLIC_RPC_URL ?? deployment.rpc;
const key = (env.DEMO_BENEFICIARY_KEY ?? "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  throw new Error("DEMO_BENEFICIARY_KEY missing/invalid in .env.local");
}

const account = privateKeyToAccount(key);
const paymaster = deployment.paymaster;
const beneficiaryId = keccak256(stringToHex("alice"));
const recipient = "0x000000000000000000000000000000000000dEaD";
const value = 100_000_000_000_000n; // 0.0001 ETH
const maxFee = parseGwei("2");

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
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

async function balance(address) {
  return BigInt(await rpc("eth_getBalance", [address, "latest"]));
}

async function read(functionName, args = []) {
  const data = encodeFunctionData({
    abi: companyPaymasterAbi,
    functionName,
    args,
  });
  const result = await rpc("eth_call", [{ to: paymaster, data }, "latest"]);
  return decodeFunctionResult({
    abi: companyPaymasterAbi,
    functionName,
    data: result,
  });
}

function fmt(v) {
  return `${formatEther(v)} ETH`;
}

async function main() {
  console.log(`beneficiary: ${account.address}`);
  console.log(`paymaster:   ${paymaster}`);
  console.log(`rpc:         ${rpcUrl}`);

  const authorized = await read("isAuthorized", [account.address]);
  console.log(`isAuthorized: ${authorized}`);
  if (!authorized) {
    throw new Error("beneficiary is not authorized on this paymaster");
  }

  const before = {
    beneficiary: await balance(account.address),
    paymaster: await balance(paymaster),
    recipient: await balance(recipient),
    companySpent: await read("companySpent"),
    available: await read("availableBalance"),
  };
  console.log(`\nbefore: paymaster ${fmt(before.paymaster)}, available ${fmt(before.available)}, companySpent ${before.companySpent}`);

  const tx = buildSponsoredTransfer({
    sender: account.address,
    paymaster,
    to: recipient,
    value,
    nonce: 0n,
    chainId: 1337,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: maxFee,
  });
  const signed = signSponsoredTransfer(tx, key);
  const raw = serializeSponsoredTransfer(signed);
  console.log(`wire bytes: ${(raw.length - 2) / 2}`);
  console.log(`tx hash:    ${sponsoredTransferHash(signed)}`);

  const hash = await sendFrameSponsoredTransfer(rpcUrl, signed);
  console.log(`submitted:  ${hash}`);

  let receipt = null;
  for (let i = 0; i < 60; i++) {
    receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) break;
    await sleep(2000);
  }
  if (!receipt) {
    console.log("still pending after 2 minutes");
    process.exitCode = 1;
    return;
  }
  console.log(`\nstatus: ${receipt.status}  block: ${receipt.blockNumber}`);
  if (receipt.payer) console.log(`payer:  ${receipt.payer}`);
  if (receipt.frameReceipts) {
    console.log(`frames: ${receipt.frameReceipts.length}`);
    for (const [i, f] of receipt.frameReceipts.entries()) {
      console.log(`  #${i}: status=${f.status} gasUsed=${f.gasUsed} stateGasUsed=${f.stateGasUsed}`);
    }
  }

  const after = {
    beneficiary: await balance(account.address),
    paymaster: await balance(paymaster),
    recipient: await balance(recipient),
    companySpent: await read("companySpent"),
    available: await read("availableBalance"),
    beneficiaryRecord: await read("beneficiaries", [beneficiaryId]),
  };
  console.log(`\nafter:  paymaster ${fmt(after.paymaster)}, available ${fmt(after.available)}, companySpent ${after.companySpent}`);
  console.log(`recipient delta: ${fmt(after.recipient - before.recipient)}`);
  console.log(`paymaster delta: ${fmt(after.paymaster - before.paymaster)}`);
  console.log(`beneficiary spentThisPeriod: ${after.beneficiaryRecord[6]}`);

  const ok =
    receipt.status === "0x1" &&
    after.recipient - before.recipient === value &&
    after.companySpent === before.companySpent + 1n &&
    after.beneficiary === before.beneficiary;
  console.log(ok ? "\nE2E PASS" : "\nE2E FAIL");
  if (!ok) process.exitCode = 1;
}

await main();
