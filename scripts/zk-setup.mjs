#!/usr/bin/env node
/**
 * Reproducible ZK setup for the devnet.
 *
 * Requires a native circom 2.2.x binary. Point CIRCOM at it, or put `circom` on
 * PATH:
 *
 *   $env:CIRCOM = "C:\path\to\circom.exe"
 *   node scripts/zk-setup.mjs --force
 *
 * Produces:
 *   build/zk/Membership.r1cs / .wasm / .zkey / verification_key.json
 *   contracts/zk/Groth16Verifier.sol
 *
 * This is a DEVNET ceremony: one local contribution, fixed entropy. Do not use
 * it for value-bearing deployments. A production deployment needs a real
 * multi-party ceremony (or a universal-setup proof system).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const OUT = path.resolve("build/zk");
const CIRCUIT = path.resolve("circuits/Membership.circom");
const CIRCOM = process.env.CIRCOM || "circom";
const SNARKJS = path.resolve("node_modules/snarkjs/build/cli.cjs");
const POWER = 14; // 16,384 constraints; circuit currently needs ~11.5k

function run(cmd, argv, opts = {}) {
  console.log(`> ${cmd} ${argv.join(" ")}`);
  execFileSync(cmd, argv, { stdio: "inherit", ...opts });
}

function snark(...argv) {
  run(process.execPath, [SNARKJS, ...argv]);
}

fs.mkdirSync(OUT, { recursive: true });

const finalZkey = path.join(OUT, "Membership_final.zkey");
if (fs.existsSync(finalZkey) && !FORCE) {
  console.log(`using existing ${finalZkey} (pass --force to rebuild)`);
  process.exit(0);
}

for (const file of fs.readdirSync(OUT)) {
  if (file.endsWith(".ptau") || file.endsWith(".zkey") || file === "Membership.r1cs" || file === "Membership.sym") {
    fs.rmSync(path.join(OUT, file), { force: true, recursive: true });
  }
}
fs.rmSync(path.join(OUT, "Membership_js"), { force: true, recursive: true });

run(CIRCOM, [
  CIRCUIT,
  "--r1cs",
  "--wasm",
  "--sym",
  "-l",
  path.resolve("node_modules/circomlib/circuits"),
  "-o",
  OUT,
]);

const p0 = path.join(OUT, "pot14_0000.ptau");
const p1 = path.join(OUT, "pot14_0001.ptau");
const pf = path.join(OUT, "pot14_final.ptau");
const z0 = path.join(OUT, "Membership_0000.zkey");

snark("powersoftau", "new", "bn128", String(POWER), p0, "-v");
snark(
  "powersoftau",
  "contribute",
  p0,
  p1,
  "--name=quotapay-devnet",
  "-e=quotapay-zk-devnet",
  "-v",
);
snark("powersoftau", "prepare", "phase2", p1, pf, "-v");
snark("groth16", "setup", path.join(OUT, "Membership.r1cs"), pf, z0);
snark(
  "zkey",
  "contribute",
  z0,
  finalZkey,
  "--name=quotapay-devnet",
  "-e=quotapay-zk-devnet-zkey",
  "-v",
);
snark("zkey", "export", "verificationkey", finalZkey, path.join(OUT, "verification_key.json"));
snark(
  "zkey",
  "export",
  "solidityverifier",
  finalZkey,
  path.resolve("contracts/zk/Groth16Verifier.sol"),
);

// snarkjs forwards precompile gas with sub(gas(), 2000), but GAS is banned in
// the EIP-8141 validation prefix (the charge frame runs as the payer). Patch
// the three staticcalls to forward fixed EIP-1108 costs instead. Consumption
// is unchanged: precompiles charge fixed costs, not the forwarded amount.
{
  const verifierPath = path.resolve("contracts/zk/Groth16Verifier.sol");
  let source = fs.readFileSync(verifierPath, "utf8");
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
  console.log("patched Groth16Verifier.sol: fixed precompile gas forwarding");
}

console.log(`\nwrote ${finalZkey}`);
console.log("wrote contracts/zk/Groth16Verifier.sol");
console.log("next: node scripts/zk-proof.mjs && node scripts/zk-bench.mjs");
