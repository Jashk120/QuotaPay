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
        { to: ASSET_MODULE, data: "0xbbbb0002" },
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
    assert.equal(tx.frames[4].to, ASSET_MODULE);
    assert.equal(tx.frames[3].executionGas, 200_000n);
    assert.equal(tx.signatures[0].scheme, 1);
    assert.equal(tx.signatures[0].signer, signer);
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
    assert.equal(signed.signatures[0].signature.length, 132);
    assert.ok(serializeFrameTx(signed).startsWith("0x06"));
  });

  await t.test("private vote: fresh sender -> proof charge -> castVote", () => {
    const proof = {
      a: ["1", "2"],
      b: [
        ["3", "4"],
        ["5", "6"],
      ],
      c: ["7", "8"],
    };
    const chargeData = encodeDaoVoteCharge({
      proof,
      proposalId: 7n,
      voteNullifier: 42n,
      sessionNullifier: 43n,
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
    assert.equal(charge.args[3], 7n);
    assert.equal(charge.args[4], 42n);
    assert.equal(charge.args[5], 43n);

    const vote = decodeFunctionData({ abi: daoCoreAbi, data: castVoteData });
    assert.equal(vote.functionName, "castVote");
    assert.equal(vote.args[0], 7n);
    assert.equal(vote.args[1], true);
    assert.equal(vote.args[2], 42n);

    const signed = signFrameTx(tx, KEY);
    assert.equal(signed.signatures[0].signature.length, 132);
    assert.ok(serializeFrameTx(signed).startsWith("0x06"));
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
