// T12 — Groth16 membership verifier.
//
// Proves the on-chain verifier accepts the committed fixture proof, rejects
// tampering, and stays inside the measured validation budget. The fixture was
// produced by scripts/zk-proof.mjs from circuits/Membership.circom.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy } from "./helpers/chain.mjs";

function loadProof() {
  const proof = JSON.parse(
    fs.readFileSync("test/fixtures/zk/proof.json", "utf8"),
  );
  const publicInputs = JSON.parse(
    fs.readFileSync("test/fixtures/zk/public.json", "utf8"),
  );
  // snarkjs' Solidity calldata convention swaps the two B coordinates.
  return {
    proof,
    publicInputs,
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
    input: publicInputs.map((v) => BigInt(v)),
  };
}

async function verify(verifier, p) {
  try {
    return await verifier.verifyProof.staticCall(p.a, p.b, p.c, p.input);
  } catch {
    return false;
  }
}

test("T12 Groth16 membership verifier", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin] = chain.signers;
  const verifier = await deploy(artifacts, "Groth16Verifier", admin);
  const p = loadProof();

  assert.equal(p.publicInputs.length, 7, "circuit has 7 public inputs");

  await t.test("valid proof verifies", async () => {
    assert.equal(await verify(verifier, p), true, "fixture proof must verify");
  });

  await t.test("every public input is bound", async () => {
    for (let i = 0; i < p.input.length; i++) {
      const bad = { ...p, input: [...p.input] };
      bad.input[i] = bad.input[i] + 1n;
      assert.equal(
        await verify(verifier, bad),
        false,
        `changed public input ${i} must fail`,
      );
    }
  });

  await t.test("tampered proof is rejected", async () => {
    const bad = { ...p, a: [p.a[0], p.a[1]] };
    bad.a[0] = "0x" + (BigInt(bad.a[0]) + 1n).toString(16);
    assert.equal(await verify(verifier, bad), false, "changed A must fail");
  });

  await t.test("a well-formed but wrong A point is rejected", async () => {
    // Negating y keeps A on the curve; the pairing must still reject it. The
    // simple `x + 1` tamper above exercises the precompile's curve check
    // instead, so this covers the pairing equation itself.
    const q =
      21888242871839275222246405745257275088696311157297823662689037894645226208583n;
    const wrongA = [p.a[0], "0x" + ((q - BigInt(p.a[1])) % q).toString(16)];
    const bad = { ...p, a: wrongA };
    assert.equal(await verify(verifier, bad), false, "wrong A point must fail");
  });

  await t.test("unswapped B coordinates are rejected", async () => {
    const rawB = [
      [p.proof.pi_b[0][0], p.proof.pi_b[0][1]],
      [p.proof.pi_b[1][0], p.proof.pi_b[1][1]],
    ];
    const bad = { ...p, b: rawB };
    assert.equal(await verify(verifier, bad), false, "raw B order must fail");
  });

  await t.test("verifier stays inside the measured budget", async () => {
    const gas = await verifier.verifyProof.estimateGas(p.a, p.b, p.c, p.input);
    console.log(`      verifyProof estimateGas: ${gas}`);
    // Measured on this tree: 258,738. Keep a ~22% ceiling for compiler drift.
    assert.ok(gas < 315_000n, `verifier gas regressed: ${gas}`);
  });
});
