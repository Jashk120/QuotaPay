#!/usr/bin/env node
/**
 * Build a DAO vote witness, generate a Groth16 proof and verify it.
 *
 * Usage:
 *   node scripts/dao-vote-proof.mjs [--out build/zk-dao] [--index 0]
 *
 * The circuit must already be compiled and the zkey present. Run
 * scripts/dao-zk-setup.mjs first.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { daoLeafHash, daoVoteWitness } from "../lib/zk/daoVote.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const OUT = path.resolve(arg("out", "build/zk-dao"));
const INDEX = Number(arg("index", "0"));
const DAO = BigInt(arg("dao", "0x000000000000000000000000000000000000dA0a"));
const CHAIN_ID = BigInt(arg("chain-id", "1337"));
const PROPOSAL_ID = BigInt(arg("proposal-id", "7"));
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
  leaves.push(await daoLeafHash({ secret, dao: DAO, chainId: CHAIN_ID }));
}

const witness = await daoVoteWitness({
  secret: SECRET,
  dao: DAO,
  chainId: CHAIN_ID,
  proposalId: PROPOSAL_ID,
  sessionKey: SESSION_KEY,
  leaves,
  index: INDEX,
});

fs.mkdirSync(OUT, { recursive: true });
const inputPath = path.join(OUT, "vote-input.json");
const proofPath = path.join(OUT, "vote-proof.json");
const publicPath = path.join(OUT, "vote-public.json");
const wasmPath = path.join(OUT, "work", "DaoVote_js", "DaoVote.wasm");
const zkeyPath = path.join(OUT, "DaoVote_final.zkey");
fs.writeFileSync(inputPath, JSON.stringify(witness.input, null, 2) + "\n");

const snarkjsCli = path.resolve("node_modules/snarkjs/build/cli.cjs");
const run = (argv) =>
  execFileSync(process.execPath, [snarkjsCli, ...argv], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

console.log(`leaf:             ${witness.leaf}`);
console.log(`root:             ${witness.root}`);
console.log(`voteNullifier:    ${witness.voteNullifier}`);
console.log(`sessionNullifier: ${witness.sessionNullifier}`);
console.log(`index:            ${INDEX}`);

run([
  "groth16",
  "fullprove",
  inputPath,
  wasmPath,
  zkeyPath,
  proofPath,
  publicPath,
]);
run([
  "groth16",
  "verify",
  path.join(OUT, "verification_key.json"),
  publicPath,
  proofPath,
]);

console.log(`\nproof:  ${proofPath}`);
console.log(`public: ${publicPath}`);
console.log("public inputs:", JSON.parse(fs.readFileSync(publicPath, "utf8")));
