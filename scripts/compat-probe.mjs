#!/usr/bin/env node
/**
 * EIP-8141 wire-compatibility probe.
 *
 * Builds the same logical QuotaPay frame transaction twice:
 *   - with `ox` (current EIP-8141 draft envelope)
 *   - with the workshop's `@forshtat/hegota-support` profile (ethrex tracer devnet)
 *
 * and compares the serialized bytes, sign payload, and payload field count.
 *
 * The two encodings are intentionally different today: the tracer profile
 * carries 9 payload items (top-level nonce keys + recent-root references),
 * while ox follows the current 7/8-field draft. This script makes that explicit
 * before anyone points the UI at a devnet.
 *
 * Usage:
 *   npm run compat
 *   HEGOTA_SUPPORT_DIR=C:/path/to/hegota-support/dist npm run compat
 */

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fromRlp } from "viem";
import { TxEnvelopeEip8141 } from "ox";

const DIST =
  process.env.HEGOTA_SUPPORT_DIR ??
  "C:/projects/poolframes/workshop/node_modules/@forshtat/hegota-support/dist";

const CHAIN_ID = 1337;
const SENDER = "0x1111111111111111111111111111111111111111";
const PAYMASTER = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const CHARGE_DATA = "0x12345678";
const VALUE = 1_000_000_000_000_000n;
const MAX_FEE = 2_000_000_000n;

function line(char = "─") {
  return char.repeat(64);
}

function fieldCount(raw) {
  try {
    const items = fromRlp(`0x${raw.slice(4)}`, "hex");
    return Array.isArray(items) ? items.length : -1;
  } catch (error) {
    return `decode error: ${error instanceof Error ? error.message : error}`;
  }
}

function short(hex, n = 48) {
  return hex.length > n ? `${hex.slice(0, n)}…` : hex;
}

async function loadWorkshop() {
  const require = (file) => {
    const path = `${DIST}/${file}`;
    return pathToFileURL(path).href;
  };
  if (!existsSync(`${DIST}/tx/index.js`)) {
    throw new Error(`missing ${DIST}/tx/index.js`);
  }
  const tx = await import(require("tx/index.js"));
  const { profile } = await import(
    require("profiles/ethrex-eip8141-tracer.js")
  );
  const codec = await import(require("tx/codec.js"));
  const rpc = await import(require("rpc/index.js"));
  return {
    ...tx,
    profile,
    encodeTx: codec.encodeTx,
    sigHash: codec.sigHash,
    toWire: rpc.toWire,
  };
}

function buildOx() {
  const envelope = TxEnvelopeEip8141.from({
    chainId: CHAIN_ID,
    sender: SENDER,
    nonce: 0n,
    maxFeePerGas: MAX_FEE,
    maxPriorityFeePerGas: MAX_FEE,
    frames: [
      { mode: "verify", flags: "approveExecution", executionGas: 30_000n },
      {
        mode: "default",
        to: PAYMASTER,
        data: CHARGE_DATA,
        executionGas: 150_000n,
        stateGas: 300_000n,
      },
      {
        mode: "verify",
        flags: "approvePayment",
        to: PAYMASTER,
        executionGas: 50_000n,
      },
      {
        mode: "sender",
        to: RECIPIENT,
        value: VALUE,
        executionGas: 50_000n,
        stateGas: 200_000n,
      },
    ],
    signatures: [{ scheme: "secp256k1" }],
  });

  return {
    raw: TxEnvelopeEip8141.serialize(envelope),
    signPayload: TxEnvelopeEip8141.getSignPayload(envelope),
    rpc: TxEnvelopeEip8141.toRpc(envelope),
  };
}

function buildWorkshop(w) {
  const tx = w.newTx({
    chainId: CHAIN_ID,
    nonceSeq: 0n,
    sender: SENDER,
    nonceKeys: [0n],
    frames: [
      w.frame(w.profile, "VERIFY", { scope: "EXECUTION", execution: 30_000n }),
      w.frame(w.profile, "DEFAULT", {
        target: PAYMASTER,
        execution: 150_000n,
        state: 300_000n,
        data: CHARGE_DATA,
      }),
      w.frame(w.profile, "VERIFY", {
        scope: "PAYMENT",
        target: PAYMASTER,
        execution: 50_000n,
      }),
      w.frame(w.profile, "SENDER", {
        target: RECIPIENT,
        execution: 50_000n,
        state: 200_000n,
        value: VALUE,
      }),
    ],
    signatures: [w.secp256k1Placeholder(w.profile, SENDER)],
    fees: {
      maxFeePerGas: MAX_FEE,
      maxPriorityFeePerGas: MAX_FEE,
    },
  });

  return {
    raw: w.encodeTx(w.profile, tx),
    signPayload: w.sigHash(w.profile, tx),
    rpc: w.toWire(tx),
  };
}

async function main() {
  console.log(line("═"));
  console.log("EIP-8141 wire compatibility probe");
  console.log(line("═"));
  console.log(`chainId:  ${CHAIN_ID}`);
  console.log(`sender:   ${SENDER}`);
  console.log(`paymaster:${PAYMASTER}`);
  console.log(`dist:     ${DIST}`);
  console.log();

  const ox = buildOx();

  let workshop;
  try {
    workshop = buildWorkshop(await loadWorkshop());
  } catch (error) {
    console.error("Could not load the workshop profile.");
    console.error(error instanceof Error ? error.message : error);
    console.error(
      "\nSet HEGOTA_SUPPORT_DIR to the @forshtat/hegota-support dist directory.",
    );
    process.exitCode = 2;
    return;
  }

  const oxFields = fieldCount(ox.raw);
  const wsFields = fieldCount(workshop.raw);
  const bytesMatch = ox.raw.toLowerCase() === workshop.raw.toLowerCase();
  const hashMatch =
    ox.signPayload.toLowerCase() === workshop.signPayload.toLowerCase();

  console.log("Ox (current draft)");
  console.log(`  payload fields : ${oxFields}`);
  console.log(`  serialized     : ${short(ox.raw)}`);
  console.log(`  sign payload   : ${short(ox.signPayload)}`);
  console.log(`  rpc keys       : ${Object.keys(ox.rpc).join(", ")}`);
  console.log();
  console.log("Workshop profile (ethrex-eip8141-tracer)");
  console.log(`  payload fields : ${wsFields}`);
  console.log(`  serialized     : ${short(workshop.raw)}`);
  console.log(`  sign payload   : ${short(workshop.signPayload)}`);
  console.log(`  rpc keys       : ${Object.keys(workshop.rpc).join(", ")}`);
  console.log();

  console.log(line());
  console.log(`serialized bytes match : ${bytesMatch ? "YES" : "NO"}`);
  console.log(`sign payload match     : ${hashMatch ? "YES" : "NO"}`);
  console.log(`field counts           : ox=${oxFields}, workshop=${wsFields}`);
  console.log(line());

  if (bytesMatch && hashMatch) {
    console.log("Verdict: compatible. Ox can submit to this devnet.");
  } else {
    console.log("Verdict: NOT wire-compatible.");
    console.log(
      "Ox follows the current EIP-8141 draft (7/8 payload items). The tracer",
    );
    console.log(
      "profile expects 9 items and a top-level recent-root list. To use Ox",
    );
    console.log(
      "against this devnet, add the devnet's envelope profile (or keep using",
    );
    console.log("@forshtat/hegota-support for submission on that chain).");
  }
}

await main();
