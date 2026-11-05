#!/usr/bin/env node
/**
 * Verify lib/devnetFrameTx.ts against the workshop's proven codec
 * (@forshtat/hegota-support). Same logical transaction, same private key.
 */
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHARGE_CALLDATA,
  buildSponsoredTransfer,
  serializeSponsoredTransfer,
  signPayload,
  signSponsoredTransfer,
  sponsoredTransferHash,
  toDevnetRpc,
} from "../lib/devnetFrameTx.ts";

const DIST =
  process.env.HEGOTA_SUPPORT_DIR ??
  "C:/projects/poolframes/workshop/node_modules/@forshtat/hegota-support/dist";

const CHAIN_ID = 1337;
const SENDER = "0x1111111111111111111111111111111111111111";
const PAYMASTER = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const VALUE = 1_000_000_000_000_000n;
const MAX_FEE = 2_000_000_000n;
const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

async function loadWorkshop() {
  const url = (f) => pathToFileURL(`${DIST}/${f}`).href;
  if (!existsSync(`${DIST}/tx/index.js`)) {
    throw new Error(`missing ${DIST}/tx/index.js`);
  }
  const tx = await import(url("tx/index.js"));
  const { profile } = await import(url("profiles/ethrex-eip8141-tracer.js"));
  const codec = await import(url("tx/codec.js"));
  const rpc = await import(url("rpc/index.js"));
  return {
    ...tx,
    profile,
    encodeTx: codec.encodeTx,
    sigHash: codec.sigHash,
    toWire: rpc.toWire,
  };
}

const myTx = buildSponsoredTransfer({
  sender: SENDER,
  paymaster: PAYMASTER,
  to: RECIPIENT,
  value: VALUE,
  nonce: 0n,
  chainId: CHAIN_ID,
  maxFeePerGas: MAX_FEE,
  maxPriorityFeePerGas: MAX_FEE,
});

const w = await loadWorkshop();
const wTx = w.newTx({
  chainId: CHAIN_ID,
  nonceSeq: 0n,
  sender: SENDER,
  nonceKeys: [0n],
  frames: [
    w.frame(w.profile, "VERIFY", { scope: "EXECUTION", execution: 15_000n }),
    w.frame(w.profile, "DEFAULT", {
      target: PAYMASTER,
      execution: 70_000n,
      state: 300_000n,
      data: CHARGE_CALLDATA,
    }),
    w.frame(w.profile, "VERIFY", {
      scope: "PAYMENT",
      target: PAYMASTER,
      execution: 12_000n,
    }),
    w.frame(w.profile, "SENDER", {
      target: RECIPIENT,
      execution: 50_000n,
      state: 200_000n,
      value: VALUE,
    }),
  ],
  signatures: [w.secp256k1Placeholder(w.profile, SENDER)],
  fees: { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: MAX_FEE },
});

const myRaw = serializeSponsoredTransfer(myTx);
const wRaw = w.encodeTx(w.profile, wTx);
const mySig = signPayload(myTx);
const wSig = w.sigHash(w.profile, wTx);

const mySigned = signSponsoredTransfer(myTx, PRIVATE_KEY);
const wSigned = await w.signTx(w.profile, wTx, PRIVATE_KEY);

console.log("charge calldata:", CHARGE_CALLDATA);
console.log("wire bytes match :", myRaw.toLowerCase() === wRaw.toLowerCase());
console.log("sign hash match  :", mySig.toLowerCase() === wSig.toLowerCase());
console.log(
  "rpc object match :",
  JSON.stringify(toDevnetRpc(mySigned)) === JSON.stringify(w.toWire(wSigned)),
);
console.log(
  "signature match  :",
  mySigned.signatures[0].signature.toLowerCase() ===
    wSigned.signatures[0].signature.toLowerCase(),
);
console.log("my wire  :", myRaw.slice(0, 80));
console.log("ref wire :", wRaw.slice(0, 80));
console.log("my sig   :", mySig);
console.log("ref sig  :", wSig);
console.log("tx hash  :", sponsoredTransferHash(mySigned));
console.log("signer   :", privateKeyToAccount(PRIVATE_KEY).address);

if (myRaw.toLowerCase() !== wRaw.toLowerCase() || mySig.toLowerCase() !== wSig.toLowerCase()) {
  console.error("\nCODEC MISMATCH");
  process.exitCode = 1;
} else {
  console.log("\nCODEC MATCH");
}


