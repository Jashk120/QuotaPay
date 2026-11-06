#!/usr/bin/env node
/**
 * Build a membership witness, generate a Groth16 proof with snarkjs, and
 * verify it. This is the off-chain half of the ZK paymaster.
 *
 * Usage:
 *   node scripts/zk-proof.mjs [--index 0] [--secret 0x...] [--out build/zk]
 *
 * The circuit must already be compiled and the Groth16 zkey present. Run
 * scripts/zk-setup.mjs first on a clean tree.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { membershipWitness, leafHash } from "../lib/zk/tree.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const OUT = path.resolve(arg("out", "build/zk"));
const INDEX = Number(arg("index", "0"));
const PAYMASTER = BigInt(
  arg("paymaster", "0x9eaa4dc89e2fc7ec7cb3a6659d578dbfce1e59cb"),
);
const CHAIN_ID = BigInt(arg("chain-id", "1337"));
const EPOCH = BigInt(arg("epoch", "0"));
const SESSION_KEY = BigInt(
  arg("session-key", "0x348836a9b164f241945205b5a92f496bb8c3c1d8"),
);
const SECRET = BigInt(
  arg("secret", "0x1111111111111111111111111111111111111111111111111111111111111111"),
);

const demoSecrets = [
  SECRET,
  BigInt("0x2222222222222222222222222222222222222222222222222222222222222222"),
  BigInt("0x3333333333333333333333333333333333333333333333333333333333333333"),
];
const leaves = [];
for (const secret of demoSecrets) {
  leaves.push(await leafHash({ secret, paymaster: PAYMASTER, chainId: CHAIN_ID }));
}

const witness = await membershipWitness({
  secret: SECRET,
  paymaster: PAYMASTER,
  chainId: CHAIN_ID,
  epoch: EPOCH,
  sessionKey: SESSION_KEY,
  leaves,
  index: INDEX,
});

fs.mkdirSync(OUT, { recursive: true });
const inputPath = path.join(OUT, "input.json");
const proofPath = path.join(OUT, "proof.json");
const publicPath = path.join(OUT, "public.json");
const wasmPath = path.join(OUT, "Membership_js", "Membership.wasm");
const zkeyPath = path.join(OUT, "Membership_final.zkey");
fs.writeFileSync(inputPath, JSON.stringify(witness.input, null, 2) + "\n");

const snarkjsCli = path.resolve("node_modules/snarkjs/build/cli.cjs");
const run = (argv) =>
  execFileSync(process.execPath, [snarkjsCli, ...argv], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

console.log(`leaf:              ${witness.leaf}`);
console.log(`root:              ${witness.root}`);
console.log(`identityNullifier: ${witness.identityNullifier}`);
console.log(`sessionNullifier:  ${witness.sessionNullifier}`);
console.log(`index:             ${INDEX}`);

run([
  "groth16",
  "fullprove",
  inputPath,
  wasmPath,
  zkeyPath,
  proofPath,
  publicPath,
]);

run(["groth16", "verify", path.join(OUT, "verification_key.json"), publicPath, proofPath]);

console.log(`\nproof:  ${proofPath}`);
console.log(`public: ${publicPath}`);
console.log("public inputs:", JSON.parse(fs.readFileSync(publicPath, "utf8")));
