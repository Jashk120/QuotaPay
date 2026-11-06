// T23 - DaoGasPaymaster configuration, custody and entrypoint gates.
//
// charge()/fallback() need EIP-8141 frame context (TXPARAM/APPROVE). On ganache
// we cover the constructor, admin controls, staking and the entrypoint gate
// that fires before the first frame opcode.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert } from "./helpers/chain.mjs";

test("T23 DaoGasPaymaster: config, custody and gates", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, outsider] = chain.signers;
  const adminAddr = await admin.getAddress();
  const treasuryAddr = await treasury.getAddress();
  const outsiderAddr = await outsider.getAddress();

  const registry = await deploy(artifacts, "MockRegistry", admin);
  // The paymaster caches DaoCore.agentAccount() at deploy time.
  const daoView = await deploy(artifacts, "MockDaoAgentView", admin, [
    await treasury.getAddress(),
  ]);
  const paymaster = await deploy(
    artifacts,
    "DaoGasPaymaster",
    admin,
    [
      adminAddr,
      treasuryAddr,
      await registry.getAddress(),
      await daoView.getAddress(),
      1000n,
      0,
    ],
    ethers.parseEther("5")
  );
  const paymasterAddr = await paymaster.getAddress();
  const daoAddr = await daoView.getAddress();

  await t.test("constructor state", async () => {
    assert.equal(await paymaster.admin(), adminAddr);
    assert.equal(await paymaster.treasury(), treasuryAddr);
    assert.equal(await paymaster.dao(), daoAddr);
    assert.equal(await paymaster.agentAccount(), treasuryAddr);
    assert.equal(await paymaster.maxSponsorCost(), 1000n);
    assert.equal(await paymaster.chargedCount(), 0n);
    assert.equal(await paymaster.chargedTx(ethers.ZeroHash), false);
    assert.equal(
      await chain.nativeBalance(paymasterAddr),
      ethers.parseEther("5")
    );
  });

  await t.test("plain ETH funding is accepted", async () => {
    const before = await chain.nativeBalance(paymasterAddr);
    await (
      await admin.sendTransaction({
        to: paymasterAddr,
        value: ethers.parseEther("0.25"),
      })
    ).wait();
    assert.equal(
      await chain.nativeBalance(paymasterAddr),
      before + ethers.parseEther("0.25"),
      "a value-bearing empty call must top up the tank"
    );
  });

  await t.test("charge is entrypoint-gated", async () => {
    await expectRevert(
      () => paymaster.connect(outsider).charge.staticCall(),
      "not entrypoint"
    );
  });

  await t.test("pay frame is entrypoint-gated", async () => {
    await expectRevert(
      () =>
        chain.provider.call({
          to: paymasterAddr,
          data: "0x",
          from: outsiderAddr,
        }),
      "not entrypoint"
    );
  });

  await t.test("admin gates and cost ceiling", async () => {
    await expectRevert(
      () => paymaster.connect(outsider).setMaxSponsorCost.staticCall(1n),
      "not admin"
    );
    await expectRevert(
      () => paymaster.connect(admin).setMaxSponsorCost.staticCall(0n),
      "maxCost=0"
    );
    await (await paymaster.connect(admin).setMaxSponsorCost(2000n)).wait();
    assert.equal(await paymaster.maxSponsorCost(), 2000n);
    await (await paymaster.connect(admin).setWithdrawalDelay(3600)).wait();
    assert.equal(await paymaster.withdrawalDelay(), 3600n);
  });

  await t.test("stake forwards to the registry", async () => {
    await (
      await paymaster.connect(admin).stake(86_400, {
        value: ethers.parseEther("0.01"),
      })
    ).wait();
    assert.equal(
      await registry.totalStaked(),
      ethers.parseEther("0.01")
    );
  });

  await t.test("deposit and delayed withdrawal lifecycle", async () => {
    await (
      await paymaster.connect(admin).deposit({ value: ethers.parseEther("1") })
    ).wait();
    await (
      await paymaster.connect(admin).requestWithdrawal(ethers.parseEther("0.5"))
    ).wait();
    await expectRevert(
      () => paymaster.connect(admin).executeWithdrawal.staticCall(),
      "not unlocked"
    );
    await chain.increaseTime(3601);
    const before = await chain.nativeBalance(treasuryAddr);
    await (await paymaster.connect(admin).executeWithdrawal()).wait();
    assert.equal(
      await chain.nativeBalance(treasuryAddr),
      before + ethers.parseEther("0.5")
    );
  });
});
