// T08 — Entrypoint gate on frame-context functions.
//
// Invariant: charge() runs only as ENTRY_POINT (0xaa); the pay-frame
// fallback must never approve outside a properly charged transaction.
// What this test CAN show on a vanilla EVM: the msg.sender gate fires
// before any frame-context opcode, with the exact reason, on both
// contracts. What it CANNOT show (documents the coverage wall): the
// post-gate logic — txparam reads, cap arithmetic, chargedHash binding,
// approve() — executes custom EIP-8141 opcodes that revert on any
// standard EVM, so those paths require the ethrex devnet + 0xaa context
// and are listed as uncovered in the report.
// Why existing coverage misses it: demos only call charge() via a real
// frame; no negative entrypoint probe exists.
import test from "node:test";
import assert from "node:assert/strict";
import { compileAll } from "./helpers/compile.mjs";
import { newChain, deploy, expectRevert, id } from "./helpers/chain.mjs";

test("T08 charge() rejects non-entrypoint callers; fallback needs frame context", async () => {
  const artifacts = compileAll();
  const chain = await newChain();
  const [owner, admin, caller] = chain.signers;
  const registry = await deploy(artifacts, "MockRegistry", owner);

  const qpv = await deploy(
    artifacts, "QuotaPayPreVerify", owner,
    [await owner.getAddress(), await registry.getAddress(), 100n, 500n, 1n]
  );
  await expectRevert(() => qpv.connect(caller).charge.staticCall(), "not entrypoint");

  const pm = await deploy(
    artifacts, "CompanyPaymaster", admin,
    [await registry.getAddress(), { companyId: id(8), admin: await admin.getAddress(), treasury: await owner.getAddress(),
       globalCreditLimit: 1000n, companyPeriodLength: 86400, creditPerTx: 10n,
       maxSponsorCost: 100n, withdrawalDelay: 0 }],
    0n
  );
  await expectRevert(() => pm.connect(caller).charge.staticCall(), "not entrypoint");

  // The pay-frame fallback's first action is a TXPARAM read, which has no
  // meaning outside a frame transaction: it MUST revert on a vanilla EVM.
  // If it ever stopped reverting here, the test wall — and the trust
  // assumption behind it — would need revisiting.
  let fallbackReverted = false;
  try {
    await caller.sendTransaction({ to: await qpv.getAddress(), value: 0n });
  } catch {
    fallbackReverted = true;
  }
  assert.equal(fallbackReverted, true, "fallback outside frame context must revert");
});
