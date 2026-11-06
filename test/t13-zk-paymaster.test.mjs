// T13 — ZkPaymaster configuration, custody, and entrypoint gates.
//
// The proof-verifying charge() path needs ethrex frame context (TXPARAM,
// APPROVE, msg.sender == 0xaa). On a vanilla EVM we can still cover deployment,
// admin/storage, custody, and the entrypoint gate, which fires before the first
// frame-context opcode.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert } from "./helpers/chain.mjs";

test("T13 ZkPaymaster config, custody, and gates", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, outsider] = chain.signers;

  const registry = await deploy(artifacts, "MockRegistry", admin);
  const verifier = await deploy(artifacts, "Groth16Verifier", admin);
  const pm = await deploy(
    artifacts,
    "ZkPaymaster",
    admin,
    [
      await admin.getAddress(),
      await treasury.getAddress(),
      await registry.getAddress(),
      await verifier.getAddress(),
      100n,
      12345n,
    ],
    ethers.parseEther("5"),
  );
  const pmAddress = await pm.getAddress();

  await t.test("constructor state", async () => {
    assert.equal(await pm.admin(), await admin.getAddress());
    assert.equal(await pm.treasury(), await treasury.getAddress());
    assert.equal(await pm.registry(), await registry.getAddress());
    assert.equal(await pm.verifier(), await verifier.getAddress());
    assert.equal(await pm.maxSponsorCost(), 100n);
    assert.equal(await pm.root(), 12345n);
    assert.equal(await pm.epoch(), 0n);
    assert.equal(await pm.redeemedCount(), 0n);
  });

  const zero2 = ["0x0", "0x0"];
  const zero22 = [
    ["0x0", "0x0"],
    ["0x0", "0x0"],
  ];

  await t.test("plain ETH funding is accepted", async () => {
    const before = await chain.nativeBalance(pmAddress);
    await (
      await admin.sendTransaction({
        to: pmAddress,
        value: ethers.parseEther("0.25"),
      })
    ).wait();
    assert.equal(
      await chain.nativeBalance(pmAddress),
      before + ethers.parseEther("0.25"),
      "a value-bearing empty call must top up the tank"
    );
  });

  await t.test("charge is entrypoint-gated", async () => {
    await expectRevert(
      () =>
        pm
          .connect(outsider)
          .charge.staticCall(zero2, zero22, zero2, 1n, 2n),
      "not entrypoint",
    );
  });

  await t.test("pay frame is entrypoint-gated", async () => {
    const outsiderAddress = await outsider.getAddress();
    await expectRevert(
      () =>
        chain.provider.call({
          to: pmAddress,
          data: "0x",
          from: outsiderAddress,
        }),
      "not entrypoint",
    );
  });

  await t.test("admin gates", async () => {
    await expectRevert(
      () => pm.connect(outsider).setRoot.staticCall(1n),
      "not admin",
    );
    await expectRevert(
      () => pm.connect(admin).setRoot.staticCall(0n),
      "root=0",
    );
    await expectRevert(
      () => pm.connect(admin).setMaxSponsorCost.staticCall(0n),
      "maxCost=0",
    );

    await (await pm.connect(admin).setRoot(999n)).wait();
    assert.equal(await pm.root(), 999n);
    await (await pm.connect(admin).setEpoch(7n)).wait();
    assert.equal(await pm.epoch(), 7n);
    await (await pm.connect(admin).setMaxSponsorCost(200n)).wait();
    assert.equal(await pm.maxSponsorCost(), 200n);
  });

  await t.test("deposit / delayed withdrawal lifecycle", async () => {
    const before = await chain.nativeBalance(pmAddress);
    await (
      await pm.connect(admin).deposit({ value: ethers.parseEther("1") })
    ).wait();
    assert.equal(
      await chain.nativeBalance(pmAddress),
      before + ethers.parseEther("1"),
    );

    const treasuryBefore = await chain.nativeBalance(
      await treasury.getAddress(),
    );
    await (
      await pm.connect(admin).requestWithdrawal(ethers.parseEther("0.5"))
    ).wait();
    await (await pm.connect(admin).executeWithdrawal()).wait();
    assert.equal(
      await chain.nativeBalance(await treasury.getAddress()),
      treasuryBefore + ethers.parseEther("0.5"),
    );
  });
});
