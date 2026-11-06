import { detectInjection, parsePrompt } from "@/lib/dao/agent.mjs";
import { buildFrameCatalogPrompt, buildFramePlan, validateFramePlan } from "@/lib/dao/frames.mjs";
import { buildLlmSystemPrompt, parseLlmActionJson, resolveProvider, type LlmAction } from "@/lib/dao/llm";
import type { AgentReply, DaoState, Plan } from "@/lib/dao/types";

/** Stable per-process session id for OpenCode Go routing/prompt-cache. */
let cachedSession: string | null = null;
function stableSessionId(): string {
  if (!cachedSession) {
    cachedSession = `ses_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }
  return cachedSession;
}

/** Map a validated LLM action back through the deterministic policy engine so
 * tiers, caps, allowlists and refusals stay single-sourced in agent.mjs. */
function canonicalPrompt(a: LlmAction, fallback: string): string {
  switch (a.action) {
    case "add_members":
      return `invite ${a.names.join(", ")}`;
    case "remove_member":
      return `remove ${a.name}`;
    case "change_role":
      return `change ${a.member} role to ${a.newRole}`;
    case "pay":
      return `pay $${a.amount}${a.note ? ` ${a.note}` : ""}`;
    case "acquire_asset":
      return typeof a.price === "number" ? `buy ${a.asset} for $${a.price}` : `buy ${a.asset}`;
    case "dispose_asset":
      return `dispose ${a.asset}`;
    case "propose":
      return `draft proposal: ${a.draft || fallback}`;
    case "update_policy":
      return `update policy: ${a.change}`;
    case "pause":
      return a.mode === "resume" ? "resume the agent" : "pause the agent";
    case "frame":
    case "summarize":
      return fallback;
  }
}

/** Turn an LLM-selected EIP-8141 pattern into a plan the worker can execute.
 *  The frame skeleton is built by code (never by the model) and validated
 *  against the EIP's static constraints before it is shown. */
export function buildFrameActionPlan(
  action: Extract<LlmAction, { action: "frame" }>,
  state: DaoState,
  prompt: string,
): Plan {
  const built = buildFramePlan(action.pattern, {
    sender: state.config.agentAddress,
    paymaster: state.config.agentAddress,
    calls: action.calls,
    value: action.value ? BigInt(action.value) : undefined,
  });
  const check = validateFramePlan(built);
  const policyPattern = action.pattern === "policy_agent" || action.pattern === "sponsored_call";
  const adminPattern = ["value_transfer", "channel_expiry", "multisig"].includes(action.pattern);
  return {
    id: `frame-${Math.random().toString(36).slice(2, 10)}`,
    action: "frame",
    tier: adminPattern ? 2 : 1,
    title: `Frame transaction: ${action.pattern}`,
    summary: `${built.frames.length}-frame EIP-8141 transaction (${built.pattern}).`,
    resolved: built.frames.map((f, i) => ({
      kind: "config" as const,
      label: `#${i} ${f.modeName}`,
      meta: `flags=${f.flags} to=${f.to ?? "new contract"} gas=${f.executionGas}/${f.stateGas} · ${f.purpose}`,
    })),
    params: {
      pattern: built.pattern,
      frames: String(built.frames.length),
      calls: action.calls ?? 1,
    },
    checks: [
      {
        label: "Static constraints",
        ok: check.ok,
        detail: check.ok ? "EIP-8141 valid" : check.errors.join("; "),
      },
      { label: "Frame count", ok: built.frames.length <= 64, detail: `${built.frames.length}/64` },
      { label: "Payer set", ok: true, detail: "a frame approves payment" },
    ],
    authorization: adminPattern ? "admin" : policyPattern ? "agent" : "agent",
    prompt,
    promptHash: "",
    planHash: "",
    warnings: built.notes,
    status: "draft",
  };
}

async function callChatCompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  provider: string,
  maxTokens = 600,
): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (provider === "opencode-go") {
    headers["x-opencode-session"] = process.env.OPENCODE_GO_SESSION || stableSessionId();
  }
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "QuotaPay DAO operator";
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return content;
}

/** One authoritative intent run: injection check -> LLM extraction ->
 *  deterministic policy engine. Shared by /api/dao/agent and /api/dao/intents
 *  so the queued and inline paths can never diverge. */
export async function runAgentIntent(
  prompt: string,
  state: DaoState,
): Promise<{ reply: AgentReply; source: string; llmError?: string }> {
  if (detectInjection(prompt)) {
    return { reply: parsePrompt(prompt, state) as AgentReply, source: "local" };
  }

  const cfg = resolveProvider(process.env);
  if (!cfg) {
    return { reply: parsePrompt(prompt, state) as AgentReply, source: "local" };
  }

  try {
    let content: string;
    try {
      content = await callChatCompletions(
        cfg.baseUrl,
        cfg.apiKey,
        cfg.model,
        `${buildLlmSystemPrompt(state)}\n\n${buildFrameCatalogPrompt()}`,
        prompt.slice(0, 2000),
        cfg.provider,
      );
    } catch (first) {
      // Reasoning models can spend the whole budget on thinking and return an
      // empty message. One retry with more room, then fall back to local.
      if (!String((first as Error)?.message ?? "").includes("no content")) throw first;
      content = await callChatCompletions(
        cfg.baseUrl,
        cfg.apiKey,
        cfg.model,
        `${buildLlmSystemPrompt(state)}\n\n${buildFrameCatalogPrompt()}`,
        prompt.slice(0, 2000),
        cfg.provider,
        1200,
      );
    }
    const action = parseLlmActionJson(content);
    if (!action) throw new Error("LLM output failed validation");

    if (action.action === "frame") {
      return {
        reply: { kind: "plan", plan: buildFrameActionPlan(action, state, prompt) },
        source: `llm:${cfg.provider}:${cfg.model}`,
      };
    }

    const reply = parsePrompt(canonicalPrompt(action, prompt), state) as AgentReply;
    if (reply.kind === "plan") reply.plan.prompt = prompt;
    else reply.prompt = prompt;
    return { reply, source: `llm:${cfg.provider}:${cfg.model}` };
  } catch (e) {
    return {
      reply: parsePrompt(prompt, state) as AgentReply,
      source: "local",
      llmError: e instanceof Error ? e.message : "llm failed",
    };
  }
}
