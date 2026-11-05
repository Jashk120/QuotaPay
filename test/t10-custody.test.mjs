// T10 — Paymaster custody: deposit, withdraw, stake forwarding.
//
// Invariants: (i) deposit() credits the gas tank; (ii) withdraw() pays the
// exact amount, rejects zero-address and over-balance, and is owner-only;
// (iii) stake() forwards msg.value to the staking registry with the
// caller's delay (anyone may top up stake: msg.sender at the registry is
// the paymaster itself by construction).
// Why existing coverage misses it: demos stake via live registry and never
// probe withdraw() failure modes or forwarding amounts.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

test("T10 custody: deposit/withdraw exactness and stake forwarding", async () => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [owner, payee, outsider] = chain.signers;
  const O = await owner.getAddress(), P = await payee.getAddress();
  const registry = await deploy(artifacts, "MockRegistry", owner);
  const R = await registry.getAddress();

  const qpv = await deploy(artifacts, "QuotaPayPreVerify", owner, [O, R, 100n, 500n, 1n]);
  const Q = await qpv.getAddress();

  // (i) deposit credits the tank.
  await (await qpv.connect(owner).deposit({ value: ethers.parseEther("2") })).wait();
  assert.equal(await chain.nativeBalance(Q), ethers.parseEther("2"));

  // Non-owner withdraw.
  await expectRevert(() => qpv.connect(outsider).withdraw.staticCall(P, 1n), "not owner");
  // Zero address.
  await expectRevert(
    () => qpv.connect(owner).withdraw.staticCall("0x0000000000000000000000000000000000000000", 1n),
    "zero address"
  );
  // Over balance: CALL fails, surfaces as "withdraw failed" (documents the
  // less-precise error string for an amount violation).
  await expectRevert(() => qpv.connect(owner).withdraw.staticCall(P, ethers.parseEther("3")), "withdraw failed");

  // (ii) exact payout.
  const p0 = await chain.nativeBalance(P);
  await (await qpv.connect(owner).withdraw(P, ethers.parseEther("2"))).wait();
  assert.equal(await chain.nativeBalance(P), p0 + ethers.parseEther("2"));
  assert.equal(await chain.nativeBalance(Q), 0n);

  // (iii) stake forwarding: value + delay reach the registry, staker is the paymaster.
  await (await qpv.connect(outsider).stake(86400, { value: ethers.parseEther("0.5") })).wait();
  assert.equal(await registry.totalStaked(), ethers.parseEther("0.5"));
  assert.equal(await registry.lastDelay(), 86400n);
  assert.equal(await registry.lastStaker(), Q, "registry must see the paymaster as staker");
});
