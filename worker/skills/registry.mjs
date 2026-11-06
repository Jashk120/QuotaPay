/**
 * Skill registry for the cloud agent worker.
 *
 * A skill is the only thing the model may invoke: JSON args in, a gated
 * execution out. No raw calldata, no shell, no free-form transactions.
 * Every skill re-checks tier/caps/allowlist against DaoState (mirroring
 * lib/dao/agent.mjs + DaoCore), so a compromised model can only do what the
 * on-chain policy already allows. Real frame-tx submission lands behind
 * EXECUTE_ONCHAIN=true; until then execute() simulates and labels it so.
 */
import {
  FRAME_PATTERNS,
  buildFramePlan,
  validateFramePlan,
} from "../../lib/dao/frames.mjs";

const FRAME_PATTERN_NAMES = FRAME_PATTERNS.map((p) => p.pattern);

function findMember(state, name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    state.members.find(
      (m) =>
        m.active &&
        (m.name.toLowerCase() === needle ||
          m.name.toLowerCase().includes(needle) ||
          m.name.toLowerCase().split(/\s+/)[0] === needle),
    ) || null
  );
}

function findAsset(state, text) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9#\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  let best = null;
  let bestScore = 0;
  for (const a of state.assets) {
    const hay = `${a.name} ${a.kind}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += 1;
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

function contributors(state) {
  const rows = state.members.filter((m) => m.active && m.role === "contributor");
  return rows.length > 0
    ? rows
    : state.members.filter((m) => m.active && m.role === "member");
}

export const SKILLS = {
  add_members: {
    tier: 2,
    reads: ["members", "config.capUsage"],
    writes: ["members", "invites"],
    authorize(args, state) {
      const names = Array.isArray(args.names) ? args.names : [];
      if (names.length === 0) return { ok: false, reason: "no names" };
      const total = state.capUsage.membersAdded + names.length;
      return {
        ok: total <= state.config.addMemberRateLimit,
        reason: `${total} of ${state.config.addMemberRateLimit} additions this period`,
        adminSignature: true,
      };
    },
  },
  remove_member: {
    tier: 2,
    reads: ["members"],
    writes: ["members"],
    authorize(args, state) {
      const m = findMember(state, args.name);
      if (!m) return { ok: false, reason: `no active member matches "${args.name}"` };
      return { ok: true, reason: `resolved ${m.name}`, member: m, adminSignature: true };
    },
  },
  change_role: {
    tier: 2,
    reads: ["members"],
    writes: ["members"],
    authorize(args, state) {
      const m = findMember(state, args.member);
      if (!m) return { ok: false, reason: "member not resolved" };
      return { ok: true, reason: `${m.name} -> ${args.newRole}`, member: m, adminSignature: true };
    },
  },
  pay: {
    tier: 1,
    reads: ["members", "config", "capUsage"],
    writes: ["capUsage.periodSpent", "events"],
    authorize(args, state) {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "bad amount" };
      const to = contributors(state);
      if (to.length === 0) return { ok: false, reason: "no contributors" };
      const withinTx = amount <= state.config.perTxCap;
      const withinPeriod = state.capUsage.periodSpent + amount <= state.config.perPeriodCap;
      if (withinTx && withinPeriod)
        return { ok: true, reason: `$${amount} within caps`, tier: 1, recipients: to };
      return { ok: false, reason: "exceeds tier-1 cap, needs member vote", tier: 3, escalate: true };
    },
  },
  acquire_asset: {
    tier: 1,
    reads: ["assets"],
    writes: ["assets", "capUsage.periodSpent"],
    authorize(args, state) {
      const a = findAsset(state, args.asset);
      if (!a) return { ok: false, reason: "asset not in registry" };
      const price = Number(args.price ?? a.priceUsdc);
      if (!a.allowlisted || price > a.capUsdc)
        return { ok: false, reason: "not allowlisted or above cap, needs vote", tier: 3, escalate: true };
      return { ok: true, reason: `${a.name} within cap`, tier: 1, asset: a, price };
    },
  },
  dispose_asset: {
    tier: 2,
    reads: ["assets"],
    writes: ["assets"],
    authorize(args, state) {
      const a = findAsset(state, args.asset) || state.assets.find((r) => r.held);
      if (!a) return { ok: false, reason: "asset not resolved" };
      return { ok: true, reason: `dispose ${a.name}`, asset: a, adminSignature: true };
    },
  },
  propose: {
    tier: 3,
    reads: [],
    writes: ["proposals"],
    authorize() {
      return { ok: true, reason: "governance path", needsVote: true };
    },
  },
  update_policy: {
    tier: 3,
    reads: [],
    writes: ["policy"],
    authorize() {
      return { ok: true, reason: "governance path: vote required", needsVote: true };
    },
  },
  pause: {
    tier: 2,
    reads: ["config"],
    writes: ["config.agentPaused"],
    authorize() {
      return { ok: true, reason: "admin-only safety valve", adminOnly: true };
    },
  },
  frame: {
    tier: 1,
    reads: ["config", "members", "assets"],
    writes: ["events"],
    authorize(args, state) {
      const pattern = String(args.pattern || "");
      if (!FRAME_PATTERN_NAMES.includes(pattern)) {
        return { ok: false, reason: `unknown frame pattern "${pattern}"` };
      }
      const plan = buildFramePlan(pattern, {
        sender: state.config.agentAddress,
        paymaster: state.config.agentAddress,
        calls: Number(args.calls) || 1,
        value: args.value ? BigInt(String(args.value)) : undefined,
      });
      const check = validateFramePlan(plan);
      if (!check.ok) {
        return { ok: false, reason: `EIP-8141 violation: ${check.errors.join("; ")}` };
      }
      // Value-moving patterns stay behind the admin tier; the agent can only
      // build the sponsored/policy shapes alone.
      const adminPatterns = new Set(["value_transfer", "channel_expiry", "multisig"]);
      return {
        ok: true,
        reason: `${plan.frames.length}-frame ${pattern} valid`,
        tier: adminPatterns.has(pattern) ? 2 : 1,
        adminSignature: adminPatterns.has(pattern),
        frames: plan.frames.length,
        plan,
      };
    },
  },
};

/** Simulated execution. Real path builds frame txs via lib/daoFrameTx.mjs
 *  (TS side) once EXECUTE_ONCHAIN=true. */
export function executeSkill(name, args, gate, ctx = {}) {
  const simulated = ctx.executeOnchain !== true;
  return {
    skill: name,
    ok: gate.ok,
    tier: SKILLS[name]?.tier,
    simulated,
    detail: gate.ok
      ? `${name} authorized (${gate.reason})${simulated ? " [simulated]" : ""}`
      : `${name} refused (${gate.reason})`,
    steps: stepsFor(name, args, gate),
  };
}

function stepsFor(name, args, gate) {
  if (!gate.ok) return [];
  switch (name) {
    case "frame":
      return [
        `build ${gate.frames}-frame EIP-8141 transaction (${args.pattern})`,
        "validate static constraints",
        "sign with the agent key",
        "submit via eth_sendFrameTransaction",
      ];
    case "acquire_asset":
      return ["approve exact cost", `buy ${gate.asset?.name}`, "record holding", "reset approval to 0"];
    case "pay":
      return [`batch payout to ${(gate.recipients ?? []).length} contributors`];
    case "add_members":
      return [`create ${(args.names ?? []).length} invites`, "batch addMembers on acceptance"];
    default:
      return [`${name} committed`];
  }
}
