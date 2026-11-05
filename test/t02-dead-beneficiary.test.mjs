// T02 — "Authorized" must imply "chargeable" (CompanyPaymaster enrollment).
//
// Invariant under test: isAuthorized(wallet)==true must imply the wallet
// can actually be charged (per-period headroom >= creditPerTx).
// Failure exposed: enroll() accepts perPeriodLimit=0 (or < creditPerTx)
// while creditPerTx>0, so the view reports authorized for a beneficiary
// whose every charge() must revert with "beneficiary limit".
// (charge() itself needs frame context, but the state it reads —
// spentThisPeriod=0, perPeriodLimit, creditPerTx — is fully observable here
// and already decides the outcome: 0 + creditPerTx <= limit is false.)
// Why existing coverage misses it: demos enroll with sane limits only.
import test from "node:test";
import assert from "node:assert/strict";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, id } from "./helpers/chain.mjs";

test("T02 enrollment with zero/below-cost limit must not report authorized", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, w1, w2] = chain.signers;
  const registry = await deploy(artifacts, "MockRegistry", admin);
  const R = await registry.getAddress();
  const pm = await deploy(
    artifacts, "CompanyPaymaster", admin,
    [R, { companyId: id(2), admin: await admin.getAddress(), treasury: await treasury.getAddress(),
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 0 }],
    0n
  );
  const W1 = await w1.getAddress(), W2 = await w2.getAddress();

  // Prong A: zero limit.
  await (await pm.connect(admin).enroll(id(31), W1, 0, 0, 0n, id(0))).wait();
  const b = await pm.beneficiaries(id(31));
  assert.equal(b.spentThisPeriod, 0n, "precondition: nothing spent yet");
  // 0 + creditPerTx(10) <= 0 is false, so charge() can never succeed.
  await t.test("prong A: zero-limit wallet must not report authorized", async () => {
    assert.equal(
      await pm.isAuthorized(W1), false,
      "BUG (prong A): zero-limit wallet reports authorized but can never be charged"
    );
  });

  // Prong B: limit below one charge.
  await (await pm.connect(admin).enroll(id(32), W2, 0, 0, 5n, id(0))).wait();
  await t.test("prong B: below-cost limit must not report authorized", async () => {
    assert.equal(
      await pm.isAuthorized(W2), false,
      "BUG (prong B): limit(5) < creditPerTx(10) wallet reports authorized but can never be charged"
    );
  });
});
