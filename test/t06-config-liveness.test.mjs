// T06 — Configuration must preserve charge liveness.
//
// Invariant under test: owner/admin configuration cannot silently make
// future charges impossible or the quota vacuous — a zero txFee means
// sponsorships consume real ETH while accounting stays at 0; zero caps
// (or an unfunded birth with maxSponsorCost>0) make every charge revert.
// Failure exposed: NO lower-bound validation on txFee / caps / funding:
// setTxFee(0), setCaps(0,0), deployment with (0,0,0), setGlobalCreditLimit(0)
// and value-less creation all succeed.
// Spec status: AMBIGUOUS — the spec never states fee>0 or caps>0. If zero
// configs are intentional (e.g. fee-free mode), the invariant should be
// restated and the accounting divergence documented instead.
// Why existing coverage misses it: demos always use fee=1, caps>0.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, id } from "./helpers/chain.mjs";

test("T06 zero fee / zero caps / unfunded birth must be rejected", async (t) => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [owner, treasury, admin] = chain.signers;
  const registry = await deploy(artifacts, "MockRegistry", owner);

  // QuotaPayPreVerify prongs.
  const qpv = await deploy(
    artifacts, "QuotaPayPreVerify", owner,
    [await owner.getAddress(), await registry.getAddress(), 100n, 500n, 1n]
  );
  let reverted = false;
  try { await (await qpv.connect(owner).setTxFee(0n)).wait(); } catch { reverted = true; }
  await t.test("prong A: zero txFee must be rejected", async () => {
    assert.equal(reverted, true, "BUG: setTxFee(0) accepted — quota accounting stays 0 forever");
  });

  reverted = false;
  try { await (await qpv.connect(owner).setCaps(0n, 0n)).wait(); } catch { reverted = true; }
  await t.test("prong B: zero caps must be rejected", async () => {
    assert.equal(reverted, true, "BUG: setCaps(0,0) accepted — every future charge must revert");
  });

  let deployReverted = false;
  try {
    await deploy(artifacts, "QuotaPayPreVerify", owner,
      [await owner.getAddress(), await registry.getAddress(), 0n, 0n, 0n]);
  } catch { deployReverted = true; }
  await t.test("prong C: zero-fee/zero-cap deployment must be rejected", async () => {
    assert.equal(deployReverted, true, "BUG: zero-fee/zero-cap deployment accepted");
  });

  // Prong D: the sanctioned creation path (factory) must not birth an
  // insolvent company. (Direct deployment followed by deposit() is a
  // legitimate funding pattern, so no constructor-level fix is proposed
  // there — see report.)
  const factory = await deploy(
    artifacts, "CompanyFactory", admin,
    [ethers.ZeroAddress, await registry.getAddress()]
  );
  const A = await admin.getAddress();
  let birthReverted = false;
  try {
    await factory.connect(admin).createCompany({
      companyId: id(61), admin: A, treasury: await treasury.getAddress(),
      globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
      maxSponsorCost: ethers.parseEther("1"), withdrawalDelay: 0,
    });
  } catch { birthReverted = true; }
  await t.test("prong D: factory must not birth an insolvent company", async () => {
    assert.equal(
      birthReverted, true,
      "BUG: createCompany with 0 value and maxSponsorCost=1 ETH accepted — company born insolvent"
    );
  });

  // Company ledger prong: same invariant family.
  const pm = await deploy(
    artifacts, "CompanyPaymaster", admin,
    [await registry.getAddress(), { companyId: id(6), admin: A, treasury: await treasury.getAddress(),
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 0 }],
    0n
  );
  reverted = false;
  try { await (await pm.connect(admin).setGlobalCreditLimit(0n)).wait(); } catch { reverted = true; }
  await t.test("prong E: zero global credit limit must be rejected", async () => {
    assert.equal(reverted, true, "BUG: setGlobalCreditLimit(0) accepted — company ledger bricked");
  });
});
