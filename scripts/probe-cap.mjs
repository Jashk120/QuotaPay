#!/usr/bin/env node
/**
 * Probe a sidecar's validation-prefix gas cap for a staked payer.
 *
 * Builds [VERIFY(EXECUTION) 15k, VERIFY(PAYMENT) <limit> on <paymaster>,
 * SENDER] and prints the rejection, which names the enforced cap:
 *
 *   node scripts/probe-cap.mjs --rpc https://altmempool.forshtat.com/rpc \
 *     --paymaster 0x0b65... --execution 600000
 *
 * Key: DEPLOYER_KEY, or the participant key in the workshop state file. The
 * probe is always rejected (that is the point); nothing is mined and the
 * sender needs no funds beyond a valid signature.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RPC = arg("rpc", "http://127.0.0.1:14337/rpc");
const PAYMASTER = arg("paymaster", "0x0b655ba500c01f0e2e8252f27c1c8013221461ee");
const EXECUTION = BigInt(arg("execution", "600000"));
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";

function loadKey() {
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY;
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(`no DEPLOYER_KEY and no workshop state at ${STATE_PATH}`);
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (!state.participantKey) throw new Error("state has no participantKey");
  return state.participantKey;
}

const require = createRequire(
  "C:/projects/poolframes/workshop/package.json",
);
const lib = require("@forshtat/hegota-support/tx");
const rpcLib = require("@forshtat/hegota-support/rpc");
const { profile } = require(
  "@forshtat/hegota-support/profiles/ethrex-eip8141-tracer",
);
const { privateKeyToAccount } = await import("viem/accounts");

const key = loadKey();
const account = privateKeyToAccount(key);

const tx = lib.newTx({
  chainId: 1337,
  sender: account.address,
  nonceSeq: 0n,
  fees: { maxFeePerGas: 2_000_000_000n },
  signatures: [lib.secp256k1Placeholder(profile, account.address)],
  frames: [
    lib.frame(profile, "VERIFY", { scope: "EXECUTION", target: null, execution: 15_000n }),
    lib.frame(profile, "VERIFY", { scope: "PAYMENT", target: PAYMASTER, execution: EXECUTION }),
    lib.frame(profile, "SENDER", {
      target: "0x000000000000000000000000000000000000dEaD",
      execution: 50_000n,
      state: 200_000n,
    }),
  ],
});

const signed = await lib.signTx(profile, tx, key);
const res = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_sendFrameTransaction",
    params: [rpcLib.toWire(signed)],
  }),
});
console.log(JSON.stringify(await res.json(), null, 2).slice(0, 400));
