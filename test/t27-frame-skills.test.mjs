import test from "node:test";
import assert from "node:assert/strict";
import {
  EIP8141,
  FRAME_MODES,
  FRAME_PATTERNS,
  SIGNATURE_SCHEMES,
  buildFrameCatalogPrompt,
  buildFramePlan,
  validateFramePlan,
} from "../lib/dao/frames.mjs";
import { SKILLS } from "../worker/skills/registry.mjs";

const sender = "0x7c1d2e3f405162738495a6b7c8d9e0f112345678";
const state = {
  config: {
    name: "Atlas",
    agentAddress: sender,
    perTxCap: 200,
    perPeriodCap: 1000,
    addMemberRateLimit: 10,
    agentPaused: false,
  },
  members: [],
  assets: [],
  capUsage: { periodSpent: 0, membersAdded: 0 },
};

test("T27 EIP-8141 frame catalog", async (t) => {
  await t.test("spec constants match the EIP", () => {
    assert.equal(EIP8141.type, "0x06");
    assert.equal(EIP8141.entryPoint, "0x00000000000000000000000000000000000000aa");
    assert.equal(EIP8141.maxFrames, 64);
    assert.equal(EIP8141.intrinsicGas, 12000n);
    assert.equal(EIP8141.perFrameGas, 475n);
    assert.equal(EIP8141.maxVerifyGas, 100000n);
    assert.equal(EIP8141.maxVerifyStateGas, 500000n);
    assert.deepEqual(EIP8141.approve, { none: 0, payment: 1, execution: 2, both: 3 });
    assert.equal(EIP8141.atomicBatchFlag, 4);
  });

  await t.test("three modes, three signature schemes", () => {
    assert.deepEqual(FRAME_MODES.map((m) => m.mode), [0, 1, 2]);
    assert.deepEqual(FRAME_MODES.map((m) => m.name), ["DEFAULT", "VERIFY", "SENDER"]);
    assert.deepEqual(SIGNATURE_SCHEMES.map((s) => s.scheme), [0, 1, 2]);
    assert.deepEqual(SIGNATURE_SCHEMES.map((s) => s.gas), [100, 2800, 6700]);
  });

  await t.test("every pattern builds a valid plan", () => {
    for (const { pattern } of FRAME_PATTERNS) {
      const plan = buildFramePlan(pattern, { sender, calls: 2 });
      assert.ok(plan.frames.length > 0, `${pattern} has frames`);
      const check = validateFramePlan(plan);
      assert.equal(check.ok, true, `${pattern}: ${check.errors.join("; ")}`);
      assert.ok(plan.frames.some((f) => f.flags & EIP8141.approve.payment), `${pattern} sets payer`);
    }
  });

  await t.test("sponsored_call shape matches the devnet builder", () => {
    const plan = buildFramePlan("sponsored_call", { sender, paymaster: sender, calls: 1 });
    assert.deepEqual(plan.frames.map((f) => f.mode), [1, 0, 1, 2]);
    assert.deepEqual(plan.frames.map((f) => f.flags), [2, 0, 1, 0]);
  });

  await t.test("atomic batch flags only on non-last non-VERIFY frames", () => {
    const plan = buildFramePlan("atomic_batch", { sender, calls: 3 });
    const senderFrames = plan.frames.filter((f) => f.mode === 2);
    assert.deepEqual(senderFrames.map((f) => f.flags), [4, 4, 0]);
    assert.equal(validateFramePlan(plan).ok, true);
  });

  await t.test("validator rejects value on VERIFY and missing payer", () => {
    const bad = buildFramePlan("sponsored_call", { sender, calls: 1 });
    bad.frames[0].value = "1";
    assert.equal(validateFramePlan(bad).ok, false);
    const noPayer = { pattern: "x", frames: [bad.frames[0]], constraints: [], notes: [] };
    const res = validateFramePlan(noPayer);
    assert.ok(res.errors.some((e) => e.includes("approves payment")));
  });

  await t.test("expiry frame rules", () => {
    const plan = buildFramePlan("channel_expiry", { sender, calls: 1 });
    assert.equal(plan.frames[0].to, EIP8141.expiryVerifier);
    assert.equal(plan.frames[0].mode, 1);
    assert.equal(plan.frames[0].flags, 0);
    assert.equal(plan.frames[0].stateGas, "0");
  });

  await t.test("worker frame skill gates on the validator", () => {
    const ok = SKILLS.frame.authorize({ pattern: "sponsored_call", calls: 1 }, state);
    assert.equal(ok.ok, true);
    assert.equal(ok.tier, 1);
    const admin = SKILLS.frame.authorize({ pattern: "value_transfer", value: "1" }, state);
    assert.equal(admin.adminSignature, true);
    const bad = SKILLS.frame.authorize({ pattern: "not_a_pattern" }, state);
    assert.equal(bad.ok, false);
  });

  await t.test("LLM prompt carries patterns and rules", () => {
    const prompt = buildFrameCatalogPrompt();
    for (const p of FRAME_PATTERNS) assert.ok(prompt.includes(p.pattern), p.pattern);
    assert.ok(prompt.includes("64 frames"));
    assert.ok(prompt.includes("atomic batch"));
  });
});
