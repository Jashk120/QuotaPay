// T01 — Enrollment unlink hygiene (CompanyPaymaster._enroll).
//
// Invariant under test: enrolling beneficiary B with a NEW wallet W2
// (rotation) must unlink the previous wallet W1; reassigning a wallet W
// from B1 to B2 must not orphan an active B1 with no wallet; a stale
// forward entry must never kill another beneficiary's wallet; and
// re-enabling a rotated-out wallet flag must not restore authorization.
// Failure exposed: _enroll only ADDED mappings, never cleared them.
//   prong A: after rotation, W1 stays authorized -> a leaked/compromised
//     old key keeps spending the shared allowance.
//   prong B: after reassignment, B1 stays active with no wallet -> orphaned
//     allowance entry that nobody can use or (via beneficiary revoke) finds.
//   prong C: enroll(X,W1); enroll(Y,W1); enroll(X,W2) must leave Y's wallet
//     W1 alone — the stale beneficiaryWallet[X] entry pointed at W1.
//   prong D: setWalletActive(W,true) on a rotated-out wallet must not
//     re-authorize it (the flag alone is insufficient without re-enrollment).
// Why existing coverage misses it: devnet demo scripts enroll each wallet
// once and never rotate/reassign, so stale mappings are never observed.
import test from "node:test";
import assert from "node:assert/strict";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, id } from "./helpers/chain.mjs";

test("T01 rotation must revoke the previous wallet; reassignment must not orphan", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, w1, w2, w3, w4, w5, w6, w7, w8] = chain.signers;
  const registry = await deploy(artifacts, "MockRegistry", admin);
  const R = await registry.getAddress();
  const pm = await deploy(
    artifacts, "CompanyPaymaster", admin,
    [R, { companyId: id(1), admin: await admin.getAddress(), treasury: await treasury.getAddress(),
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 0 }],
    0n
  );

  const B1 = id(11), B2 = id(22);
  const W1 = await w1.getAddress(), W2 = await w2.getAddress(), W3 = await w3.getAddress();

  // Prong A: rotation B1: W1 -> W2.
  await (await pm.connect(admin).enroll(B1, W1, 0, 0, 100n, id(0))).wait();
  assert.equal(await pm.isAuthorized(W1), true, "precondition: W1 authorized");
  await (await pm.connect(admin).enroll(B1, W2, 0, 0, 100n, id(0))).wait();
  await t.test("prong A: old wallet loses authorization after rotation", async () => {
    assert.equal(await pm.isAuthorized(W2), true, "W2 must be authorized after rotation");
    assert.equal(
      await pm.isAuthorized(W1), false,
      "BUG (prong A): W1 still authorized after rotation to W2 — stale wallet keeps spending"
    );
  });

  // Prong B: reassign W3 from B1 to B2; B1 must not stay active-but-walletless.
  await (await pm.connect(admin).enroll(B1, W3, 0, 0, 100n, id(0))).wait();
  await (await pm.connect(admin).enroll(B2, W3, 0, 0, 100n, id(0))).wait();
  await t.test("prong B: reassignment must not orphan the prior beneficiary", async () => {
    const b1 = await pm.beneficiaries(B1);
    assert.equal(
      b1.active, false,
      "BUG (prong B): B1 still active after its only wallet moved to B2 — orphaned allowance"
    );
  });

  // Prong C: stale forward entry must not kill another beneficiary's wallet.
  // enroll(X,A); enroll(Y,A); enroll(X,B) must leave Y (on A) untouched.
  const X = id(103), Y = id(104);
  const A = await w4.getAddress(), B = await w5.getAddress();
  await (await pm.connect(admin).enroll(X, A, 0, 0, 100n, id(0))).wait();
  const moveTx = await (await pm.connect(admin).enroll(Y, A, 0, 0, 100n, id(0))).wait();
  const thirdTx = await (await pm.connect(admin).enroll(X, B, 0, 0, 100n, id(0))).wait();
  const eventNames = (rc) => rc.logs.map((l) => {
    try { return pm.interface.parseLog(l); } catch { return null; }
  }).filter(Boolean).map((p) => `${p.name}(${p.args.map(String).join(",")})`);
  await t.test("prong C: later rotation of X must not touch Y's wallet", async () => {
    assert.equal(await pm.isAuthorized(A), true, "Y's wallet A must stay authorized");
    assert.equal(await pm.walletBeneficiary(A), Y, "A must still map to Y");
    assert.equal(await pm.beneficiaryWallet(Y), A, "Y's forward entry must still point at A");
    assert.equal((await pm.beneficiaries(Y)).active, true, "Y must stay active");
    assert.equal(await pm.isAuthorized(B), true, "X's new wallet B must be authorized");
    assert.equal(await pm.beneficiaryWallet(X), B, "X's forward entry must point at B");
    const thirdEvents = eventNames(thirdTx).map((e) => e.toLowerCase());
    assert.equal(
      thirdEvents.some((e) => e.startsWith("walletrevoked(") && e.includes(A.slice(2).toLowerCase())),
      false,
      `BUG (prong C): enroll(X,B) deauthorized Y's wallet A — stale forward entry kill (events: ${thirdEvents})`
    );
  });
  await t.test("prong C2: wallet move auto-deactivation is observable", async () => {
    const moveEvents = eventNames(moveTx);
    assert.equal(
      moveEvents.some((e) => e.startsWith("BeneficiaryRevoked(")),
      true,
      `enroll(Y,A) must emit BeneficiaryRevoked(X) (events: ${moveEvents})`
    );
  });

  // Prong D: re-enabling a rotated-out wallet flag must not restore access.
  const X2 = id(105);
  const C = await w6.getAddress(), D = await w7.getAddress(), E = await w8.getAddress();
  await (await pm.connect(admin).enroll(X2, C, 0, 0, 100n, id(0))).wait();
  await (await pm.connect(admin).enroll(X2, D, 0, 0, 100n, id(0))).wait();
  assert.equal(await pm.isAuthorized(C), false, "precondition: rotated-out C is unauthorized");
  await (await pm.connect(admin).setWalletActive(C, true)).wait();
  await t.test("prong D: flag reactivation without re-enrollment restores nothing", async () => {
    assert.equal(await pm.walletActive(C), true, "flag itself is set...");
    assert.equal(
      await pm.isAuthorized(C), false,
      "BUG (prong D): reactivated-but-unmapped wallet reports authorized"
    );
  });
  // E is enrolled then deliberately revoked: a later X2 rotation must not touch it.
  await (await pm.connect(admin).enroll(X2, E, 0, 0, 100n, id(0))).wait();
  await (await pm.connect(admin).revokeWallet(E)).wait();
  await (await pm.connect(admin).enroll(X2, D, 0, 0, 100n, id(0))).wait();
  await t.test("prong D2: rotation skips a deliberately revoked wallet", async () => {
    assert.equal(await pm.walletActive(E), false, "E must stay revoked");
    assert.equal(await pm.walletBeneficiary(E), X2, "E's history entry is untouched");
  });
});
