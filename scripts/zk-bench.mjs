#!/usr/bin/env node
/**
 * Measure the on-chain Groth16 verifier gas on a local EVM (ganache).
 *
 * This is the concrete input to the validation-budget decision: the verifier
 * cost is a property of the proof system and the number of public inputs, not
 * of the circuit size. Run scripts/zk-proof.mjs first to produce proof.json and
 * public.json.
 */
import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import ganache from "ganache";
import { ethers } from "ethers";

const OUT = path.resolve("build/zk");
const sourcePath = path.resolve("contracts/zk/Groth16Verifier.sol");

function compileVerifier() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const input = {
    language: "Solidity",
    sources: { "Groth16Verifier.sol": { content: source } },
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) {
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  }
  const artifact = output.contracts["Groth16Verifier.sol"]["Groth16Verifier"];
  return {
    abi: artifact.abi,
    bytecode: "0x" + artifact.evm.bytecode.object,
  };
}

function loadProof() {
  const proof = JSON.parse(fs.readFileSync(path.join(OUT, "proof.json"), "utf8"));
  const publicInputs = JSON.parse(
    fs.readFileSync(path.join(OUT, "public.json"), "utf8"),
  );
  // snarkjs' Solidity calldata convention swaps the two B coordinates.
  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];
  const input = publicInputs.map((v) => BigInt(v));
  return { a, b, c, input };
}

async function main() {
  const artifact = compileVerifier();
  const gp = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337 },
    wallet: { totalAccounts: 3 },
  });
  const provider = new ethers.BrowserProvider(gp);
  const signer = await provider.getSigner(0);
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer,
  );
  const verifier = await factory.deploy();
  const deployReceipt = await verifier.deploymentTransaction().wait();
  console.log(`verifier: ${await verifier.getAddress()}`);
  console.log(`deploy gas: ${deployReceipt.gasUsed}`);

  const { a, b, c, input } = loadProof();
  const ok = await verifier.verifyProof.staticCall(a, b, c, input);
  console.log(`verifyProof (static): ${ok}`);
  if (!ok) throw new Error("valid proof did not verify");

  const estimate = await verifier.verifyProof.estimateGas(a, b, c, input);
  console.log(`verifyProof estimateGas: ${estimate}`);

  const tx = await verifier.verifyProof.send(a, b, c, input);
  const receipt = await tx.wait();
  console.log(`verifyProof gasUsed: ${receipt.gasUsed}`);

  const tampered = [...input];
  tampered[tampered.length - 1] = tampered[tampered.length - 1] + 1n;
  const bad = await verifier.verifyProof.staticCall(a, b, c, tampered);
  console.log(`tampered proof verifies: ${bad}`);

  // Prefix arithmetic for the budget decision.
  const prefixBase =
    15_000n + // VERIFY(EXECUTION)
    12_000n + // VERIFY(PAYMENT)
    2_800n; // secp256k1 signature
  const zkFrame = receipt.gasUsed + 60_000n; // verifier + nullifier/state logic + margin
  console.log(`\nzk charge frame (declared, estimate): ${zkFrame}`);
  console.log(`validation prefix (declared): ${prefixBase + zkFrame}`);
  console.log(
    `measured verifier share of a 500k cap: ${(Number(receipt.gasUsed) / 5000).toFixed(1)}%`,
  );
}

await main();
