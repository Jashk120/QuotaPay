// T20 - DAO private-vote circuit, verifier and paymaster.
//
// The fixture proof was produced by scripts/dao-vote-proof.mjs from
// circuits/DaoVote.circom. The frame path itself (TXPARAM/APPROVE) needs the
// devnet; on ganache we cover the verifier, the witness helpers, the paymaster
// configuration and the entrypoint gate that fires before the first opcode.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert } from "./helpers/chain.mjs";
import {
  daoLeafHash,
  daoVoteWitness,
  expectedDaoVoteSignals,
} from "../lib/zk/daoVote.mjs";

function loadProof() {
  const proof = JSON.parse(fs.readFileSync("test/fixtures/zk-dao/proof.json", "utf8"));
  const publicInputs = JSON.parse(
    fs.readFileSync("test/fixtures/zk-dao/public.json", "utf8"),
  );
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

const DAO = 0xda0an;
const CHAIN_ID = 1337n;
const PROPOSAL_ID = 7n;
const SESSION_KEY = "0x348836a9b164f241945205b5a92f496bb8c3c1d8";
const SECRETS = [
  0x1111111111111111111111111111111111111111111111111111111111111111n,
  0x2222222222222222222222222222222222222222222222222222222222222222n,
  0x3333333333333333333333333333333333333333333333333333333333333333n,
];

test("T20 DAO vote circuit, verifier and paymaster", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, outsider] = chain.signers;
  const adminAddr = await admin.getAddress();
  const treasuryAddr = await treasury.getAddress();
  const outsiderAddr = await outsider.getAddress();

  await t.test("client witness matches the committed proof", async () => {
    const leaves = [];
    for (const secret of SECRETS) {
      leaves.push(await daoLeafHash({ secret, dao: DAO, chainId: CHAIN_ID }));
    }
    const witness = await daoVoteWitness({
      secret: SECRETS[0],
      dao: DAO,
      chainId: CHAIN_ID,
      proposalId: PROPOSAL_ID,
      sessionKey: SESSION_KEY,
      leaves,
      index: 0,
    });
    const fixture = JSON.parse(
      fs.readFileSync("test/fixtures/zk-dao/public.json", "utf8"),
    );
    assert.deepEqual(expectedDaoVoteSignals(witness), fixture);
  });

  await t.test("per-proposal and per-dao values are distinct", async () => {
    const leavesA = [];
    const leavesB = [];
    for (const secret of SECRETS) {
      leavesA.push(await daoLeafHash({ secret, dao: DAO, chainId: CHAIN_ID }));
      leavesB.push(
        await daoLeafHash({ secret, dao: 0xbeefn, chainId: CHAIN_ID }),
      );
    }
    const proposal8 = await daoVoteWitness({
      secret: SECRETS[0],
      dao: DAO,
      chainId: CHAIN_ID,
      proposalId: 8n,
      sessionKey: SESSION_KEY,
      leaves: leavesA,
      index: 0,
    });
    const otherDao = await daoVoteWitness({
      secret: SECRETS[0],
      dao: 0xbeefn,
      chainId: CHAIN_ID,
      proposalId: PROPOSAL_ID,
      sessionKey: SESSION_KEY,
      leaves: leavesB,
      index: 0,
    });
    assert.notEqual(proposal8.voteNullifier, otherDao.voteNullifier);
    assert.notEqual(
      proposal8.input.sessionNullifier,
      otherDao.input.sessionNullifier
    );
    assert.notEqual(
      await daoLeafHash({ secret: SECRETS[0], dao: DAO, chainId: CHAIN_ID }),
      await daoLeafHash({ secret: SECRETS[0], dao: 0xbeefn, chainId: CHAIN_ID })
    );
  });

  await t.test("verifier accepts the proof and rejects tampering", async () => {
    const verifier = await deploy(artifacts, "DaoVoteVerifier", admin);
    const p = loadProof();
    assert.equal(p.publicInputs.length, 7);
    assert.equal(await verify(verifier, p), true, "fixture proof must verify");

    for (let i = 0; i < 7; i++) {
      const bad = { ...p, input: [...p.input] };
      bad.input[i] = bad.input[i] + 1n;
      assert.equal(await verify(verifier, bad), false, `input ${i} must bind`);
    }

    const gas = await verifier.verifyProof.estimateGas(p.a, p.b, p.c, p.input);
    console.log(`      DaoVote verifyProof estimateGas: ${gas}`);
    assert.ok(gas < 315_000n, `verifier gas regressed: ${gas}`);
  });

  await t.test("paymaster config, gates and custody", async () => {
    const registry = await deploy(artifacts, "MockRegistry", admin);
    const verifier = await deploy(artifacts, "DaoVoteVerifier", admin);
    const paymaster = await deploy(
      artifacts,
      "DaoVotePaymaster",
      admin,
      [
        adminAddr,
        treasuryAddr,
        await registry.getAddress(),
        await verifier.getAddress(),
        await treasury.getAddress(), // any DAO address; charge is gated first
        1000n,
        0,
      ],
      ethers.parseEther("5")
    );
    const paymasterAddr = await paymaster.getAddress();

    assert.equal(await paymaster.admin(), adminAddr);
    assert.equal(await paymaster.treasury(), treasuryAddr);
    assert.equal(await paymaster.dao(), treasuryAddr);
    assert.equal(await paymaster.maxSponsorCost(), 1000n);
    assert.equal(await paymaster.voteConsumed(treasuryAddr, 7n, 42n), false);

    const zero2 = ["0x0", "0x0"];
    const zero22 = [
      ["0x0", "0x0"],
      ["0x0", "0x0"],
    ];
    await expectRevert(
      () =>
        paymaster
          .connect(outsider)
          .charge.staticCall(zero2, zero22, zero2, 1n, 2n, 3n, false),
      "not entrypoint"
    );
    await expectRevert(
      () =>
        chain.provider.call({
          to: paymasterAddr,
          data: "0x",
          from: outsiderAddr,
        }),
      "not entrypoint"
    );

    await expectRevert(
      () => paymaster.connect(outsider).setMaxSponsorCost.staticCall(1n),
      "not admin"
    );
    await (await paymaster.connect(admin).setMaxSponsorCost(2000n)).wait();
    assert.equal(await paymaster.maxSponsorCost(), 2000n);

    await (await paymaster.connect(admin).deposit({ value: ethers.parseEther("1") })).wait();
    const before = await chain.nativeBalance(treasuryAddr);
    await (
      await paymaster.connect(admin).requestWithdrawal(ethers.parseEther("0.5"))
    ).wait();
    await (await paymaster.connect(admin).executeWithdrawal()).wait();
    assert.equal(
      await chain.nativeBalance(treasuryAddr),
      before + ethers.parseEther("0.5")
    );
  });

  await t.test("charge rejects a closed proposal before frame context", async () => {
    const registry = await deploy(artifacts, "MockRegistry", admin);
    const verifier = await deploy(artifacts, "DaoVoteVerifier", admin);
    const source = await deploy(artifacts, "MockDaoVoteSource", admin);
    await (await source.set(ethers.id("snapshot-root"), 0)).wait();

    const paymaster = await deploy(
      artifacts,
      "DaoVotePaymaster",
      admin,
      [
        adminAddr,
        treasuryAddr,
        await registry.getAddress(),
        await verifier.getAddress(),
        await source.getAddress(),
        1000n,
        0,
      ]
    );

    const zero2 = ["0x0", "0x0"];
    const zero22 = [
      ["0x0", "0x0"],
      ["0x0", "0x0"],
    ];
    const data = paymaster.interface.encodeFunctionData("charge", [
      zero2,
      zero22,
      zero2,
      7n,
      1n,
      2n,
      true,
    ]);

    const paymasterAddr = await paymaster.getAddress();
    await expectRevert(
      () =>
        chain.provider.call({
          to: paymasterAddr,
          data,
          from: "0x00000000000000000000000000000000000000aa",
        }),
      "voting closed"
    );
  });
});
