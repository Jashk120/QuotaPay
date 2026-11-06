import { NextResponse } from "next/server";
import {
  buildConfigSystemPrompt,
  coerceDaoConfig,
  parseDaoConfig,
  type DaoConfigDraft,
} from "@/lib/dao/config";
import { resolveProvider } from "@/lib/dao/llm";

/** POST /api/dao/config { prompt } -> DaoConfigDraft
 *  LLM extraction when a key is configured, deterministic regex otherwise. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const fallback = parseDaoConfig(prompt);
  const cfg = resolveProvider(process.env);
  if (!cfg) return NextResponse.json({ config: fallback, source: "local" });

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    };
    if (cfg.provider === "opencode-go") {
      headers["x-opencode-session"] = `ses_config_${Date.now().toString(36)}`;
    }
    if (cfg.provider === "openrouter") {
      headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
      headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "QuotaPay DAO operator";
    }
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildConfigSystemPrompt() },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let content = json.choices?.[0]?.message?.content ?? "";
    let start = content.indexOf("{");
    let end = content.lastIndexOf("}");
    if (start < 0 || end <= start) {
      // Reasoning models can spend the first budget on thinking and return an
      // empty message. Retry once with more room before falling back.
      const retry = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: 1400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildConfigSystemPrompt() },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (retry.ok) {
        const retryJson = (await retry.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        content = retryJson.choices?.[0]?.message?.content ?? "";
        start = content.indexOf("{");
        end = content.lastIndexOf("}");
      }
    }
    if (start < 0 || end <= start) throw new Error("no JSON");
    const model = coerceDaoConfig(JSON.parse(content.slice(start, end + 1)) as unknown);
    if (!model) throw new Error("invalid config");
    // Model values win where present; deterministic parse fills the gaps.
    const merged: DaoConfigDraft = {
      name: model.name ?? fallback.name,
      treasuryUsdc: model.treasuryUsdc ?? fallback.treasuryUsdc,
      perTxCap: model.perTxCap ?? fallback.perTxCap,
      perPeriodCap: Math.max(
        model.perPeriodCap ?? fallback.perPeriodCap,
        model.perTxCap ?? fallback.perTxCap,
      ),
      addMemberRateLimit:
        model.addMemberRateLimit ?? fallback.addMemberRateLimit,
      votingWindowHours:
        model.votingWindowHours ?? fallback.votingWindowHours,
    };
    return NextResponse.json({
      config: merged,
      source: `llm:${cfg.provider}:${cfg.model}`,
    });
  } catch (e) {
    return NextResponse.json({
      config: fallback,
      source: "local",
      llmError: e instanceof Error ? e.message : "llm failed",
    });
  }
}
