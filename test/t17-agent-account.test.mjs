// T17 - AgentAccount policy table and emergency controls.
//
// The VERIFY path needs EIP-8141 frame context (TXPARAM/FRAMEPARAM/APPROVE) and
// runs only on the devnet. On ganache we cover the storage and access-control
// surface: policy mutation is DAO-only, pause is admin-only, and signer/admin
// rotation is one-way through the DAO.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert } from "./helpers/chain.mjs";

const SELECTOR = "0x12345678";

test("T17 AgentAccount: policy, pause and rotation", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [deployer, admin, agentSigner, nextSigner, attacker] = chain.signers;
  const adminAddr = await admin.getAddress();
  const signerAddr = await agentSigner.getAddress();
  const nextSignerAddr = await nextSigner.getAddress();
  const deployerAddr = await deployer.getAddress();
  const attackerAddr = await attacker.getAddress();

  const account = await deploy(artifacts, "AgentAccount", deployer, [
    adminAddr,
    signerAddr,
    true,
    deployerAddr,
  ]);
  const accountAddr = await account.getAddress();
  await (await account.initializeDao(deployerAddr)).wait();

  await t.test("constructor and one-time wiring", async () => {
    assert.equal(await account.dao(), deployerAddr);
    assert.equal(await account.admin(), adminAddr);
    assert.equal(await account.agentSigner(), signerAddr);
    assert.equal(await account.frameEnforced(), true);
    assert.equal(await account.paused(), false);
    assert.equal(
      (await account.ENTRY_POINT()).toLowerCase(),
      "0x00000000000000000000000000000000000000aa"
    );

    await expectRevert(
      () => account.connect(attacker).initializeDao.staticCall(attackerAddr),
      "not factory"
    );
  });

  await t.test("policy defaults closed and is DAO-only", async () => {
    const rule = await account.rules(deployerAddr, SELECTOR);
    assert.equal(rule.allowed, false);

    await expectRevert(
      () =>
        account
          .connect(attacker)
          .setRule.staticCall(deployerAddr, SELECTOR, true, 1),
      "not dao"
    );

    await (await account.setRule(deployerAddr, SELECTOR, true, 1)).wait();
    const updated = await account.rules(deployerAddr, SELECTOR);
    assert.equal(updated.allowed, true);
    assert.equal(updated.tier, 1n);

    await expectRevert(
      () => account.setRule.staticCall(deployerAddr, SELECTOR, true, 3),
      "tier"
    );
  });

  await t.test("batch rule update and clearing", async () => {
    const other = "0xabcdef01";
    await (
      await account.setRules([
        { target: deployerAddr, selector: other, allowed: true, tier: 2 },
        { target: deployerAddr, selector: SELECTOR, allowed: false, tier: 0 },
      ])
    ).wait();
    assert.equal((await account.rules(deployerAddr, other)).tier, 2n);
    assert.equal((await account.rules(deployerAddr, SELECTOR)).allowed, false);
  });

  await t.test("pause is admin-only and does not need the agent", async () => {
    await expectRevert(
      () => account.connect(attacker).pause.staticCall(true),
      "not admin"
    );
    await (await account.connect(admin).pause(true)).wait();
    assert.equal(await account.paused(), true);
    await (await account.connect(admin).pause(false)).wait();
    assert.equal(await account.paused(), false);
  });

  await t.test("signer and admin rotation are DAO-only", async () => {
    await expectRevert(
      () => account.connect(attacker).setAgentSigner.staticCall(nextSignerAddr),
      "not dao"
    );
    await (await account.setAgentSigner(nextSignerAddr)).wait();
    assert.equal(await account.agentSigner(), nextSignerAddr);

    await expectRevert(
      () => account.connect(attacker).setAdmin.staticCall(attackerAddr),
      "not dao"
    );
    await (await account.setAdmin(nextSignerAddr)).wait();
    assert.equal(await account.admin(), nextSignerAddr);
    await expectRevert(
      () => account.connect(admin).pause.staticCall(true),
      "not admin"
    );
    await (await account.connect(nextSigner).pause(true)).wait();
    assert.equal(await account.paused(), true);
  });

  await t.test("frame enforcement can be switched for the §7.3 fallback", async () => {
    await (await account.setFrameEnforced(false)).wait();
    assert.equal(await account.frameEnforced(), false);
  });
});
