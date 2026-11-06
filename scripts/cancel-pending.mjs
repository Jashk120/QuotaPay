#!/usr/bin/env node
/**
 * Replace a stuck pending transaction with a 21k-gas self-cancel at the same
 * nonce. Works even while the miner is stalled: the replacement sits in the
 * pool and wins when blocks resume.
 */
import fs from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.DEVNET_RPC ?? "https://altmempool.forshtat.com";
const STATE =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const PENDING =
  process.env.PENDING_TX ??
  "0x0dd5f5d903c9e179fae8aefd4eadfe83f4269bd86010ef9659e3b6d1a5085245";

const account = privateKeyToAccount(
  process.env.DEPLOYER_KEY ?? JSON.parse(fs.readFileSync(STATE, "utf8")).participantKey,
);

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const pending = await rpc("eth_getTransactionByHash", [PENDING]);
if (!pending) {
  console.log("pending tx is already gone from the pool");
  process.exit(0);
}

const nonce = Number(BigInt(pending.nonce));
const oldGasPrice = BigInt(pending.gasPrice);
// At least 2x the old price so the node accepts the replacement.
const gasPrice = oldGasPrice * 2n + 1_000_000_000n;
const gas = 21_000n;

const raw = await account.signTransaction({
  chainId: 1337,
  nonce,
  to: account.address,
  value: 0n,
  data: "0x",
  gas,
  gasPrice,
  type: "legacy",
});

const hash = await rpc("eth_sendRawTransaction", [raw]);
console.log(`cancel submitted: ${hash}`);
console.log(`  nonce=${nonce} gas=21000 gasPrice=${gasPrice} to=self`);

const replacement = await rpc("eth_getTransactionByHash", [hash]);
console.log(
  `  in pool: ${replacement ? "yes" : "no"} (nonce ${replacement ? Number(BigInt(replacement.nonce)) : "?"})`,
);
const old = await rpc("eth_getTransactionByHash", [PENDING]);
console.log(`  old factory tx: ${old ? "still present" : "evicted"}`);
const pendingCount = await rpc("eth_getTransactionCount", [account.address, "pending"]);
console.log(`  account pending nonce: ${Number(BigInt(pendingCount))}`);
