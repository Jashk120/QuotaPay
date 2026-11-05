// T09 — Revocation is observable and complete at the view layer.
//
// Invariant: revoking a wallet or its beneficiary makes isAuthorized
// false immediately; re-activating the wallet while the beneficiary stays
// revoked must NOT re-authorize (defense in depth: the two flags are ANDed).
// Note: charge() re-checks the same storage in frame context; the view is
// a proxy for that path, which itself needs the devnet (see T08/report).
// Why existing coverage misses it: demos revoke nothing; the policy demo
// only flips exposure on the OLD QuotaPayExt gate, never wallet/beneficiary
// revocation on CompanyPaymaster.
import test from "node:test";
import assert from "node:assert/strict";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

test("T09 revocation removes authorization; beneficiary-revoke dominates", async () => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [admin, treasury, w1, outsider] = chain.signers;
  const registry = await deploy(artifacts, "MockRegistry", admin);
  const pm = await deploy(
    artifacts, "CompanyPaymaster", admin,
    [await registry.getAddress(), { companyId: id(9), admin: await admin.getAddress(), treasury: await treasury.getAddress(),
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 0 }],
    0n
  );
  const W1 = await w1.getAddress(), OUT = await outsider.getAddress();
  const B = id(91);

  assert.equal(await pm.isAuthorized(OUT), false, "unknown wallet must be unauthorized");

  await (await pm.connect(admin).enroll(B, W1, 0, 0, 100n, id(0))).wait();
  assert.equal(await pm.isAuthorized(W1), true, "precondition");

  // Wallet-level revoke.
  await (await pm.connect(admin).revokeWallet(W1)).wait();
  assert.equal(await pm.isAuthorized(W1), false, "revoked wallet must be unauthorized");
  // Re-activate.
  await (await pm.connect(admin).setWalletActive(W1, true)).wait();
  assert.equal(await pm.isAuthorized(W1), true, "re-activated wallet must be authorized");

  // Beneficiary-level revoke dominates wallet re-activation.
  await (await pm.connect(admin).revokeBeneficiary(B)).wait();
  assert.equal(await pm.isAuthorized(W1), false, "revoked beneficiary must be unauthorized");
  await (await pm.connect(admin).setWalletActive(W1, true)).wait();
  assert.equal(
    await pm.isAuthorized(W1), false,
    "wallet re-activation under a revoked beneficiary must NOT re-authorize"
  );

  // Non-admin cannot flip wallet state.
  await expectRevert(() => pm.connect(outsider).setWalletActive.staticCall(W1, true), "not admin");
});
