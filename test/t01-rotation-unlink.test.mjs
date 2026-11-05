// T01 — Enrollment unlink hygiene (CompanyPaymaster._enroll).
//
// Invariant under test: enrolling beneficiary B with a NEW wallet W2
// (rotation) must unlink the previous wallet W1; reassigning a wallet W
// from B1 to B2 must not orphan an active B1 with no wallet.
// Failure exposed: _enroll only ADDS mappings, never clears them.
//   prong A: after rotation, W1 stays authorized -> a leaked/compromised
//     old key keeps spending the shared allowance.
//   prong B: after reassignment, B1 stays active with no wallet -> orphaned
//     allowance entry that nobody can use or (via beneficiary revoke) finds.
// Why existing coverage misses it: devnet demo scripts enroll each wallet
// once and never rotate/reassign, so stale mappings are never observed.
import test from "node:test";
import assert from "node:assert/strict";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, id } from "./helpers/chain.mjs";

test("T01 rotation must revoke the previous wallet; reassignment must not orphan", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, w1, w2, w3] = chain.signers;
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
});
