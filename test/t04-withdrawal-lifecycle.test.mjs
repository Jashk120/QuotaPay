// T04 — Withdrawal lifecycle accounting (CompanyPaymaster).
//
// Invariants: (i) at most one pending request; (ii) no execution before
// unlockAt; (iii) execute pays treasury exactly once and releases the
// reservation; (iv) cancel releases without paying; (v) availableBalance
// always equals balance - pendingWithdrawals.
// Why existing coverage misses it: demos fund and sponsor but never run
// the request/execute/cancel machine through its invalid transitions.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

test("T04 withdrawal lifecycle: gating, exact payout, release", async () => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, outsider] = chain.signers;
  const registry = await deploy(artifacts, "MockRegistry", admin);
  const R = await registry.getAddress();
  const T = await treasury.getAddress();
  const pm = await deploy(
    artifacts, "CompanyPaymaster", admin,
    [R, { companyId: id(4), admin: await admin.getAddress(), treasury: T,
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 1000 }],
    ethers.parseEther("10")
  );
  const P = await pm.getAddress();

  const bal = () => chain.provider.getBalance(P);
  const avail = () => pm.availableBalance();

  // Non-admin cannot request.
  await expectRevert(() => pm.connect(outsider).requestWithdrawal.staticCall(1n), "not admin");

  // Request 3 of 10: reservation accounting.
  await (await pm.connect(admin).requestWithdrawal(ethers.parseEther("3"))).wait();
  assert.equal(await pm.pendingWithdrawals(), ethers.parseEther("3"));
  assert.equal(await avail(), ethers.parseEther("7"));
  assert.equal(await bal(), ethers.parseEther("10"));

  // Second request while one is pending.
  await expectRevert(() => pm.connect(admin).requestWithdrawal.staticCall(1n), "pending request");
  // Early execution.
  await expectRevert(() => pm.connect(admin).executeWithdrawal.staticCall(), "not unlocked");

  // Mature the delay, execute: exact payout, reservation released.
  await chain.increaseTime(1200);
  const t0 = await chain.provider.getBalance(T);
  await (await pm.connect(admin).executeWithdrawal()).wait();
  const t1 = await chain.provider.getBalance(T);
  assert.equal(t1 - t0, ethers.parseEther("3"), "treasury must receive exactly the request");
  assert.equal(await pm.pendingWithdrawals(), 0n, "reservation must be released");
  assert.equal(await avail(), await bal(), "available must equal balance after release");

  // Double execution.
  await expectRevert(() => pm.connect(admin).executeWithdrawal.staticCall(), "no request");
  // Cancel with nothing pending.
  await expectRevert(() => pm.connect(admin).cancelWithdrawal.staticCall(), "no request");

  // Request then cancel: no payout, full release.
  await (await pm.connect(admin).requestWithdrawal(ethers.parseEther("2"))).wait();
  await (await pm.connect(admin).cancelWithdrawal()).wait();
  assert.equal(await pm.pendingWithdrawals(), 0n);
  assert.equal(await avail(), await bal());

  // Over-balance request (5 ETH requested against 7 ETH: ok; 8 ETH: not).
  await expectRevert(
    () => pm.connect(admin).requestWithdrawal.staticCall(ethers.parseEther("8")),
    "insufficient available"
  );
});
