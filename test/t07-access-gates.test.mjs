// T07 — Owner/admin gates on all privileged functions.
//
// Invariant: state-changing admin functions are callable only by the
// owner (QuotaPayPreVerify) / admin (CompanyPaymaster); destructive
// zero-address updates are rejected.
// Why existing coverage misses it: demos act only as the owner, so a
// missing gate would never fire.
import test from "node:test";
import assert from "node:assert/strict";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

test("T07 privileged functions reject non-owners and zero addresses", async () => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [owner, admin, outsider] = chain.signers;
  const O = await owner.getAddress();
  const registry = await deploy(artifacts, "MockRegistry", owner);
  const R = await registry.getAddress();

  const qpv = await deploy(artifacts, "QuotaPayPreVerify", owner, [O, R, 100n, 500n, 1n]);
  const W = await outsider.getAddress();
  await expectRevert(() => qpv.connect(outsider).setCredit.staticCall(W, 1n), "not owner");
  await expectRevert(() => qpv.connect(outsider).setCaps.staticCall(1n, 1n), "not owner");
  await expectRevert(() => qpv.connect(outsider).setTxFee.staticCall(2n), "not owner");
  await expectRevert(() => qpv.connect(outsider).resetSpent.staticCall(W), "not owner");
  await expectRevert(() => qpv.connect(outsider).resetTotalSpent.staticCall(), "not owner");
  await expectRevert(() => qpv.connect(outsider).withdraw.staticCall(W, 1n), "not owner");
  await expectRevert(() => qpv.connect(owner).withdraw.staticCall("0x0000000000000000000000000000000000000000", 1n), "zero address");

  const pm = await deploy(
    artifacts, "CompanyPaymaster", admin,
    [R, { companyId: id(7), admin: await admin.getAddress(), treasury: O,
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 0 }],
    0n
  );
  await expectRevert(() => pm.connect(outsider).enroll.staticCall(id(71), W, 0, 0, 1n, id(0)), "not admin");
  await expectRevert(() => pm.connect(outsider).revokeWallet.staticCall(W), "not admin");
  await expectRevert(() => pm.connect(outsider).revokeBeneficiary.staticCall(id(71)), "not admin");
  await expectRevert(() => pm.connect(outsider).setBeneficiaryLimit.staticCall(id(71), 1n), "not admin");
  await expectRevert(() => pm.connect(outsider).setGlobalCreditLimit.staticCall(1n), "not admin");
  await expectRevert(() => pm.connect(outsider).setCreditPerTx.staticCall(1n), "not admin");
  await expectRevert(() => pm.connect(outsider).setMaxSponsorCost.staticCall(1n), "not admin");
  await expectRevert(() => pm.connect(outsider).requestWithdrawal.staticCall(1n), "not admin");
  await expectRevert(() => pm.connect(admin).setAdmin.staticCall("0x0000000000000000000000000000000000000000"), "admin=0");
  await expectRevert(() => pm.connect(admin).setTreasury.staticCall("0x0000000000000000000000000000000000000000"), "treasury=0");
  await expectRevert(() => pm.connect(admin).setCreditPerTx.staticCall(0n), "credit=0");
  await expectRevert(() => pm.connect(admin).setMaxSponsorCost.staticCall(0n), "maxCost=0");
});
