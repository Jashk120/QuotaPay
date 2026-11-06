import { NextResponse } from "next/server";
import { runAgentIntent } from "@/lib/dao/agentService";
import type { DaoState } from "@/lib/dao/types";

/** POST /api/dao/agent { prompt, state } -> { reply, source }
 *  Thin wrapper over the shared intent service. */
export async function POST(req: Request) {
  let body: { prompt?: unknown; state?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const state = body.state as DaoState | undefined;
  if (!prompt || !state || typeof state !== "object") {
    return NextResponse.json({ error: "prompt and state required" }, { status: 400 });
  }

  const result = await runAgentIntent(prompt, state);
  return NextResponse.json(result);
}
