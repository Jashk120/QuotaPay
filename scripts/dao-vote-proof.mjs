#!/usr/bin/env node
/**
 * Build a DAO vote witness, generate a Groth16 proof and verify it.
 *
 * Usage:
 *   node scripts/dao-vote-proof.mjs [--out build/zk-dao] [--index 0]
 *     [--dao 0x..] [--chain-id 1337] [--proposal-id 7]
 *     [--session-key 0x..] [--paymaster 0x..] [--support true|false]
 *     [--secret 0x..]
 *
 * The fixture in test/fixtures/zk-dao is only overwritten when the inputs are
 * the committed defaults; pass --write-fixture to force it.
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
const PAYMASTER = BigInt(
  arg("paymaster", "0x000000000000000000000000000000000000dA0a"),
);
const SUPPORT = arg("support", "true") !== "false";
const SECRET = BigInt(
  arg("secret", "0x1111111111111111111111111111111111111111111111111111111111111111"),
);
const WRITE_FIXTURE = args.includes("--write-fixture");
const DEFAULT_FIXTURE_INPUTS =
  INDEX === 0 &&
  DAO === 0x000000000000000000000000000000000000da0an &&
  CHAIN_ID === 1337n &&
  PROPOSAL_ID === 7n &&
  SESSION_KEY === 0x348836a9b164f241945205b5a92f496bb8c3c1d8n &&
  PAYMASTER === 0x000000000000000000000000000000000000da0an &&
  SUPPORT === true &&
  SECRET ===
    0x1111111111111111111111111111111111111111111111111111111111111111n;

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
  paymaster: PAYMASTER,
  support: SUPPORT,
  leaves,
  index: INDEX,
});

if (leaves[INDEX] !== witness.leaf) {
  throw new Error(
    `leaf at index ${INDEX} does not match the witness secret; use --secret for that leaf`,
  );
}

fs.mkdirSync(OUT, { recursive: true });
const inputPath = path.join(OUT, "vote-input.json");
const proofPath = path.join(OUT, "vote-proof.json");
const publicPath = path.join(OUT, "vote-public.json");
const wasmPath = path.join(OUT, "work", "DaoVote_js", "DaoVote.wasm");
const zkeyPath = path.join(OUT, "DaoVote_final.zkey");
for (const [label, file] of [
  ["wasm", wasmPath],
  ["zkey", zkeyPath],
]) {
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${label} at ${file}; run "node scripts/dao-zk-setup.mjs --force" first`);
  }
}
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
console.log(`paymaster:        ${PAYMASTER}`);
console.log(`support:          ${SUPPORT}`);
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

// The DAO test suite reads these committed copies. Only replace them when the
// proof corresponds to the fixture inputs (or --write-fixture was passed).
if (WRITE_FIXTURE || DEFAULT_FIXTURE_INPUTS) {
  const fixtureDir = path.resolve("test/fixtures/zk-dao");
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.copyFileSync(proofPath, path.join(fixtureDir, "proof.json"));
  fs.copyFileSync(publicPath, path.join(fixtureDir, "public.json"));
  console.log(`copied proof.json and public.json to ${fixtureDir}`);
} else {
  console.log(
    "left test/fixtures/zk-dao untouched (non-default inputs; pass --write-fixture to replace)",
  );
}

console.log(`\nproof:  ${proofPath}`);
console.log(`public: ${publicPath}`);
console.log("public inputs:", JSON.parse(fs.readFileSync(publicPath, "utf8")));
