// T22 - DAO frame layouts (spec §7.1 and §7.2).
import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildAgentActionFrameTx,
  buildPrivateVoteFrameTx,
  daoCoreAbi,
  daoVotePaymasterAbi,
  encodeDaoCastVote,
  encodeDaoVoteCharge,
  serializeFrameTx,
  signFrameTx,
  toSolidityProof,
} from "../lib/daoFrameTx.mjs";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const signer = privateKeyToAccount(KEY).address;
const AGENT_ACCOUNT = "0x1111111111111111111111111111111111111111";
const PAYMASTER = "0x2222222222222222222222222222222222222222";
const DAO_CORE = "0x3333333333333333333333333333333333333333";
const ASSET_MODULE = "0x4444444444444444444444444444444444444444";

test("T22 DAO frame layouts", async (t) => {
  await t.test("agent action: VERIFY -> charge -> pay -> SENDER batch", () => {
    const tx = buildAgentActionFrameTx({
      chainId: 1337,
      nonce: 9n,
      agentAccount: AGENT_ACCOUNT,
      agentSigner: signer,
      paymaster: PAYMASTER,
      chargeData: "0xdeadbeef",
      calls: [
        { to: DAO_CORE, data: "0xaaaa0001", executionGas: 200_000n },
        { to: DAO_CORE, data: "0xbbbb0002" },
      ],
    });

    assert.equal(tx.sender, AGENT_ACCOUNT);
    assert.equal(tx.frames.length, 5);
    assert.deepEqual(tx.frames.map((f) => f.mode), [1, 0, 1, 2, 2]);
    assert.deepEqual(tx.frames.map((f) => f.flags), [2, 0, 1, 4, 0]);
    assert.equal(tx.frames[0].to, AGENT_ACCOUNT);
    assert.equal(tx.frames[1].to, PAYMASTER);
    assert.equal(tx.frames[1].data, "0xdeadbeef");
    assert.equal(tx.frames[2].to, PAYMASTER);
    assert.equal(tx.frames[3].to, DAO_CORE);
    assert.equal(tx.frames[4].to, DAO_CORE);
    assert.equal(tx.frames[3].executionGas, 200_000n);
    assert.equal(tx.signatures[0].scheme, 1);
    assert.equal(tx.signatures[0].signer, signer);
  });

  await t.test("enforced VERIFY declares 100k for the policy scan", () => {
    const plain = buildAgentActionFrameTx({
      chainId: 1337,
      nonce: 9n,
      agentAccount: AGENT_ACCOUNT,
      agentSigner: signer,
      paymaster: PAYMASTER,
      chargeData: "0xdeadbeef",
      calls: [{ to: DAO_CORE, data: "0xaaaa0001" }],
    });
    assert.equal(plain.frames[0].executionGas, 20_000n);
    const enforced = buildAgentActionFrameTx({
      chainId: 1337,
      nonce: 9n,
      agentAccount: AGENT_ACCOUNT,
      agentSigner: signer,
      paymaster: PAYMASTER,
      chargeData: "0xdeadbeef",
      frameEnforced: true,
      calls: [{ to: DAO_CORE, data: "0xaaaa0001" }],
    });
    assert.equal(enforced.frames[0].executionGas, 100_000n);
    // Enforced prefix: 100k + 60k + 12k + ~2.8k signature, inside the 500k cap.
    const prefix =
      enforced.frames[0].executionGas +
      enforced.frames[1].executionGas +
      enforced.frames[2].executionGas +
      2_800n;
    assert.ok(prefix < 500_000n, `prefix ${prefix} exceeds the sidecar budget`);
  });

  await t.test("self-funded agent action drops the paymaster frames", () => {
    const tx = buildAgentActionFrameTx({
      chainId: 1337,
      nonce: 10n,
      agentAccount: AGENT_ACCOUNT,
      agentSigner: signer,
      selfFunded: true,
      calls: [
        { to: DAO_CORE, data: "0xaaaa0001" },
        { to: DAO_CORE, data: "0xbbbb0002" },
      ],
    });

    assert.equal(tx.sender, AGENT_ACCOUNT);
    assert.equal(tx.frames.length, 3);
    assert.deepEqual(tx.frames.map((frame) => frame.mode), [1, 2, 2]);
    assert.deepEqual(tx.frames.map((frame) => frame.flags), [2, 4, 0]);
    assert.ok(
      tx.frames.every((frame) => frame.to !== PAYMASTER),
      "no frame may target a paymaster in self-funded mode",
    );
  });

  await t.test("agent action signs and serializes as a frame tx", () => {
    const tx = buildAgentActionFrameTx({
      chainId: 1337,
      nonce: 1n,
      agentAccount: AGENT_ACCOUNT,
      agentSigner: signer,
      paymaster: PAYMASTER,
      chargeData: "0x",
      calls: [{ to: DAO_CORE, data: "0x" }],
    });
    const signed = signFrameTx(tx, KEY);
    assert.deepEqual(tx.frames.map((f) => f.flags), [2, 0, 1, 0]);
    assert.equal(signed.signatures[0].signature.length, 132);
    assert.ok(serializeFrameTx(signed).startsWith("0x06"));
  });

  await t.test("private vote: fresh sender -> proof charge -> castVote", () => {
    // snarkjs `proof.json` form. The encoder must reverse each G2 limb pair
    // for the Solidity verifier.
    const proof = {
      pi_a: ["1", "2", "1"],
      pi_b: [
        ["3", "4"],
        ["5", "6"],
        ["1", "0"],
      ],
      pi_c: ["7", "8", "1"],
    };
    const chargeData = encodeDaoVoteCharge({
      proof,
      proposalId: 7n,
      voteNullifier: 42n,
      sessionNullifier: 43n,
      support: true,
    });
    const castVoteData = encodeDaoCastVote({
      proposalId: 7n,
      support: true,
      voteNullifier: 42n,
    });

    const tx = buildPrivateVoteFrameTx({
      chainId: 1337,
      nonce: 0n,
      sessionKey: signer,
      votePaymaster: PAYMASTER,
      chargeData,
      daoCore: DAO_CORE,
      castVoteData,
    });

    assert.equal(tx.sender, signer);
    assert.equal(tx.frames.length, 4);
    assert.deepEqual(tx.frames.map((f) => f.mode), [1, 0, 1, 2]);
    assert.deepEqual(tx.frames.map((f) => f.flags), [2, 0, 1, 0]);
    assert.equal(tx.frames[0].to, undefined);
    assert.equal(tx.frames[1].to, PAYMASTER);
    assert.equal(tx.frames[3].to, DAO_CORE);

    const charge = decodeFunctionData({
      abi: daoVotePaymasterAbi,
      data: chargeData,
    });
    assert.equal(charge.functionName, "charge");
    assert.deepEqual(charge.args[0].map(String), ["1", "2"]);
    assert.deepEqual(
      charge.args[1].map((row) => row.map(String)),
      [
        ["4", "3"],
        ["6", "5"],
      ],
    );
    assert.deepEqual(charge.args[2].map(String), ["7", "8"]);
    assert.equal(charge.args[3], 7n);
    assert.equal(charge.args[4], 42n);
    assert.equal(charge.args[5], 43n);
    assert.equal(charge.args[6], true);

    const vote = decodeFunctionData({ abi: daoCoreAbi, data: castVoteData });
    assert.equal(vote.functionName, "castVote");
    assert.equal(vote.args[0], 7n);
    assert.equal(vote.args[1], true);
    assert.equal(vote.args[2], 42n);

    const signed = signFrameTx(tx, KEY);
    assert.equal(signed.signatures[0].signature.length, 132);
    assert.ok(serializeFrameTx(signed).startsWith("0x06"));
  });

  await t.test("a proof already in Solidity order passes through", () => {
    const proof = {
      a: ["1", "2"],
      b: [
        ["3", "4"],
        ["5", "6"],
      ],
      c: ["7", "8"],
    };
    assert.deepEqual(toSolidityProof(proof), proof);
  });

  await t.test("agent action requires at least one call", () => {
    assert.throws(
      () =>
        buildAgentActionFrameTx({
          chainId: 1337,
          nonce: 0n,
          agentAccount: AGENT_ACCOUNT,
          agentSigner: signer,
          paymaster: PAYMASTER,
          chargeData: "0x",
          calls: [],
        }),
      /at least one call/
    );
  });
});
