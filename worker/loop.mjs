/**
 * ReAct loop for the cloud agent worker.
 *
 *   intent -> reason (LLM extraction or deterministic parse) -> skill gate
 *   -> execute -> observe (state + receipt) -> next step | done | blocked.
 *
 * The loop never trusts the model: every step goes through the skill
 * registry gate (tier/caps/allowlist) and terminates on first refusal.
 * Multi-step plans (e.g. acquire_asset = approve/buy/record/reset) run as
 * bounded iterations (MAX_STEPS) with the trace recorded for audit.
 */
import { parsePrompt } from "../lib/dao/agent.mjs";
import { SKILLS, executeSkill } from "./skills/registry.mjs";

const MAX_STEPS = 5;

const ACTION_TO_SKILL = {
  add_members: "add_members",
  remove_member: "remove_member",
  change_role: "change_role",
  pay: "pay",
  acquire_asset: "acquire_asset",
  dispose_asset: "dispose_asset",
  propose: "propose",
  update_policy: "update_policy",
  pause: "pause",
  summarize: null,
  vote: null,
};

/** LLM extraction hook. V1: deterministic parse only (model lives in the Next
 *  API). V2: pass an extractor(prompt, state) -> { skill, args } here. */
export async function runLoop(intent, state, opts = {}) {
  const trace = [];
  const extractor = opts.extractor || null;
  let currentPrompt = intent.prompt;

  for (let step = 0; step < MAX_STEPS; step++) {
    // REASON: model extraction if provided, else authoritative parser.
    let skill;
    let args;
    if (extractor) {
      try {
        const out = await extractor(currentPrompt, state);
        skill = out?.skill;
        args = out?.args ?? {};
        trace.push({ phase: "reason", skill, args, source: "llm" });
      } catch (e) {
        trace.push({ phase: "reason", error: String(e?.message ?? e), source: "llm" });
      }
    }
    if (!skill) {
      const reply = parsePrompt(currentPrompt, state);
      if (reply.kind === "refusal") {
        trace.push({ phase: "reason", refusal: reply.title, reason: reply.reason });
        return { status: "refused", trace, reply };
      }
      const plan = reply.plan;
      trace.push({ phase: "reason", plan: plan.title, action: plan.action, tier: plan.tier });
      const mapped = ACTION_TO_SKILL[plan.action];
      if (!mapped) {
        return { status: "done", trace, reply, note: "read-only plan, no skill" };
      }
      skill = mapped;
      args = planToArgs(plan);
    }

    // GATE + ACT through the skill registry.
    const def = SKILLS[skill];
    if (!def) {
      trace.push({ phase: "gate", skill, ok: false, reason: "unknown skill" });
      return { status: "refused", trace };
    }
    const gate = def.authorize(args, state);
    trace.push({ phase: "gate", skill, ok: gate.ok, reason: gate.reason, tier: gate.tier ?? def.tier });
    if (!gate.ok && !gate.escalate && !gate.needsVote && !gate.adminSignature) {
      return { status: "refused", trace };
    }
    if (gate.escalate || gate.needsVote) {
      trace.push({ phase: "act", skill, escalated: "vote", reason: gate.reason });
      return { status: "blocked:vote", trace };
    }
    if (gate.adminSignature || gate.adminOnly) {
      trace.push({ phase: "act", skill, awaiting: "admin-signature", reason: gate.reason });
      return { status: "blocked:admin", trace };
    }
    const result = executeSkill(skill, args, gate, opts);
    trace.push({ phase: "act", ...result });

    // OBSERVE: simulated state patch so the next iteration reasons on fresh caps.
    state = observe(state, skill, args, gate);
    trace.push({ phase: "observe", note: "state refreshed" });
    return { status: "done", trace, skill, steps: result.steps };
  }
  return { status: "refused", trace, reason: "max steps exceeded" };
}

function planToArgs(plan) {
  const p = plan.params || {};
  switch (plan.action) {
    case "add_members":
      return { names: p.names };
    case "remove_member":
      return { name: p.name };
    case "change_role":
      return { member: p.member, newRole: p.newRole };
    case "pay":
      return { amount: p.amount, note: plan.title };
    case "acquire_asset":
      return { asset: p.asset ?? p.assetId, price: p.price };
    case "dispose_asset":
      return { asset: p.asset ?? p.assetId };
    case "propose":
      return { draft: p.draft ?? plan.title };
    case "update_policy":
      return { change: p.change };
    case "pause":
      return { mode: p.mode };
    default:
      return {};
  }
}

/** Shallow simulated patch: caps move so a second iteration would escalate. */
function observe(state, skill, args, gate) {
  const next = structuredClone(state);
  if (skill === "pay" && gate.ok) next.capUsage.periodSpent += Number(args.amount) || 0;
  if (skill === "acquire_asset" && gate.ok && gate.asset) {
    const a = next.assets.find((r) => r.id === gate.asset.id);
    if (a) a.held = true;
    next.capUsage.periodSpent += Number(args.price ?? gate.price ?? 0);
  }
  return next;
}
