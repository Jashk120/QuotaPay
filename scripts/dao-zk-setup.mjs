#!/usr/bin/env node
/**
 * Reproducible ZK setup for the DAO private-vote circuit.
 *
 * Reuses build/zk/pot14_final.ptau when present, so the expensive phase-1
 * ceremony is shared with the existing Membership circuit. Produces:
 *
 *   build/zk-dao/DaoVote.r1cs / .wasm / .zkey / verification_key.json
 *   contracts/zk/DaoVoteVerifier.sol
 *
 * Devnet ceremony only: one local contribution with fixed entropy. A
 * production deployment needs a real multi-party ceremony.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const OUT = path.resolve("build/zk-dao");
const CIRCUIT = path.resolve("circuits/DaoVote.circom");
const CIRCOM = process.env.CIRCOM;
const SNARKJS = path.resolve("node_modules/snarkjs/build/cli.cjs");
const POWER = 14; // the Membership circuit already fits in 16,384 constraints

function run(cmd, argv, opts = {}) {
  console.log(`> ${cmd} ${argv.join(" ")}`);
  execFileSync(cmd, argv, { stdio: "inherit", ...opts });
}

function circom(...args) {
  const opts =
    args.length > 0 && typeof args[args.length - 1] === "object"
      ? args.pop()
      : {};
  if (CIRCOM) {
    run(CIRCOM, args, opts);
  } else {
    run(
      process.execPath,
      [path.resolve("node_modules/circom2/cli.js"), ...args],
      opts,
    );
  }
}

function snark(...argv) {
  run(process.execPath, [SNARKJS, ...argv]);
}

fs.mkdirSync(OUT, { recursive: true });
const WORK = path.join(OUT, "work");

const finalZkey = path.join(OUT, "DaoVote_final.zkey");
if (fs.existsSync(finalZkey) && !FORCE) {
  console.log(`using existing ${finalZkey} (pass --force to rebuild)`);
  process.exit(0);
}

for (const file of fs.readdirSync(OUT)) {
  if (file.endsWith(".ptau") || file.endsWith(".zkey")) {
    fs.rmSync(path.join(OUT, file), { force: true, recursive: true });
  }
}
fs.rmSync(WORK, { force: true, recursive: true });
fs.mkdirSync(WORK, { recursive: true });
fs.copyFileSync(CIRCUIT, path.join(WORK, "DaoVote.circom"));

// circom2's WASI path mapping ignores -o on this host: the artifacts land next
// to the input circuit. Compile a copy inside the work directory instead, so
// no generated files leak into circuits/.
circom(
  "DaoVote.circom",
  "--r1cs",
  "--wasm",
  "--sym",
  "-l",
  path.resolve("node_modules/circomlib/circuits"),
  "-o",
  ".",
  { cwd: WORK },
);
const r1cs = path.join(WORK, "DaoVote.r1cs");

const sharedPtau = path.resolve("build/zk/pot14_final.ptau");
let ptau = sharedPtau;
if (!fs.existsSync(ptau)) {
  const p0 = path.join(OUT, "pot14_0000.ptau");
  const p1 = path.join(OUT, "pot14_0001.ptau");
  const pf = path.join(OUT, "pot14_final.ptau");
  snark("powersoftau", "new", "bn128", String(POWER), p0, "-v");
  snark(
    "powersoftau",
    "contribute",
    p0,
    p1,
    "--name=quotapay-dao-devnet",
    "-e=quotapay-dao-zk-devnet",
    "-v",
  );
  snark("powersoftau", "prepare", "phase2", p1, pf, "-v");
  ptau = pf;
}

const z0 = path.join(OUT, "DaoVote_0000.zkey");
snark("groth16", "setup", r1cs, ptau, z0);
snark(
  "zkey",
  "contribute",
  z0,
  finalZkey,
  "--name=quotapay-dao-devnet",
  "-e=quotapay-dao-zk-devnet-zkey",
  "-v",
);
snark(
  "zkey",
  "export",
  "verificationkey",
  finalZkey,
  path.join(OUT, "verification_key.json"),
);

const verifierPath = path.resolve("contracts/zk/DaoVoteVerifier.sol");
snark("zkey", "export", "solidityverifier", finalZkey, verifierPath);

let source = fs.readFileSync(verifierPath, "utf8");
source = source.replaceAll("contract Groth16Verifier", "contract DaoVoteVerifier");
const patches = [
  [
    "success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)",
    "success := staticcall(30000, 7, mIn, 96, mIn, 64)",
  ],
  [
    "success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)",
    "success := staticcall(30000, 6, mIn, 128, pR, 64)",
  ],
  [
    "let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)",
    "let success := staticcall(200000, 8, _pPairing, 768, _pPairing, 0x20)",
  ],
];
for (const [from, to] of patches) {
  if (!source.includes(from)) {
    throw new Error(`verifier patch target missing: ${from}`);
  }
  source = source.replaceAll(from, to);
}
if (source.includes("sub(gas(), 2000)")) {
  throw new Error("unpatched sub(gas(), 2000) remains in the verifier");
}
fs.writeFileSync(verifierPath, source);
console.log("patched DaoVoteVerifier.sol: fixed precompile gas forwarding");

console.log(`\nwrote ${finalZkey}`);
console.log("wrote contracts/zk/DaoVoteVerifier.sol");
