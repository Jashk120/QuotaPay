import { NextResponse } from "next/server";
import { detectInjection, parsePrompt } from "@/lib/dao/agent.mjs";
import {
  buildLlmSystemPrompt,
  parseLlmActionJson,
  resolveProvider,
  type LlmAction,
} from "@/lib/dao/llm";
import type { AgentReply, DaoState } from "@/lib/dao/types";

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
      return typeof a.price === "number"
        ? `buy ${a.asset} for $${a.price}`
        : `buy ${a.asset}`;
    case "dispose_asset":
      return `dispose ${a.asset}`;
    case "propose":
      return `draft proposal: ${a.draft || fallback}`;
    case "update_policy":
      return `update policy: ${a.change}`;
    case "pause":
      return a.mode === "resume" ? "resume the agent" : "pause the agent";
    case "summarize":
      return fallback;
  }
}

/** Stable per-process session id for OpenCode Go routing/prompt-cache. */
let cachedSession: string | null = null;
function stableSessionId(): string {
  if (!cachedSession) {
    cachedSession = `ses_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }
  return cachedSession;
}

async function callChatCompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  provider: string,
): Promise<string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  // OpenCode Go requires a stable session id for routing/prompt-cache reuse.
  if (provider === "opencode-go") {
    headers["x-opencode-session"] =
      process.env.OPENCODE_GO_SESSION || stableSessionId();
  }
  // OpenRouter attribution (optional, harmless elsewhere).
  if (provider === "openrouter") {
    const site = process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
    headers["HTTP-Referer"] = site;
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "QuotaPay DAO operator";
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 300,
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
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return content;
}

export async function POST(req: Request) {
  let body: { prompt?: unknown; state?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const state = body.state as DaoState | undefined;
  if (!prompt.trim() || !state || typeof state !== "object") {
    return NextResponse.json({ error: "prompt and state required" }, { status: 400 });
  }

  // Fast path: obvious injection never reaches the model.
  if (detectInjection(prompt)) {
    const reply = parsePrompt(prompt, state) as AgentReply;
    return NextResponse.json({ reply, source: "local" });
  }

  const cfg = resolveProvider(process.env);
  if (!cfg) {
    const reply = parsePrompt(prompt, state) as AgentReply;
    return NextResponse.json({ reply, source: "local" });
  }

  try {
    const content = await callChatCompletions(
      cfg.baseUrl,
      cfg.apiKey,
      cfg.model,
      buildLlmSystemPrompt(state),
      prompt.slice(0, 2000),
      cfg.provider,
    );
    const action = parseLlmActionJson(content);
    if (!action) throw new Error("LLM output failed validation");
    // Authoritative step: rebuild the plan from state, not from model text.
    const reply = parsePrompt(canonicalPrompt(action, prompt), state) as AgentReply;
    // Keep the user's original wording on the plan for audit.
    if (reply.kind === "plan") reply.plan.prompt = prompt;
    else reply.prompt = prompt;
    return NextResponse.json({
      reply,
      source: `llm:${cfg.provider}:${cfg.model}`,
    });
  } catch (e) {
    // Model down / bad output / timeout: deterministic engine is the fallback.
    const reply = parsePrompt(prompt, state) as AgentReply;
    return NextResponse.json({
      reply,
      source: "local",
      llmError: e instanceof Error ? e.message : "llm failed",
    });
  }
}
