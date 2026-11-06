import { NextResponse } from "next/server";
import { parsePrompt } from "@/lib/dao/agent.mjs";
import { db, isDbConfigured } from "@/lib/dao/db";
import { isTestMode, verifyIntentAuth } from "@/lib/dao/intents";
import { withHashes } from "@/lib/dao/hash";
import type { DaoState } from "@/lib/dao/types";

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** POST /api/dao/intents { prompt, state, address?, signature?, nonce? }
 *  Persists the intent for the VPS worker. In test mode (AGENT_TEST_MODE=true)
 *  no signature is required and the reply is computed inline so the UI works
 *  with no worker running. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    prompt?: unknown;
    state?: unknown;
    address?: unknown;
    signature?: unknown;
    nonce?: unknown;
  } | null;
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  const prompt = body.prompt.trim().slice(0, 2000);
  const state = body.state as DaoState;
  const address = typeof body.address === "string" ? body.address : undefined;
  const signature = typeof body.signature === "string" ? body.signature : undefined;
  const nonce =
    typeof body.nonce === "string" && body.nonce ? body.nonce : rid("n");

  const auth = await verifyIntentAuth({ prompt, nonce, address, signature });
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });

  const testMode = isTestMode();
  const reply = withHashes(prompt, (parsePrompt(prompt, state) as { kind: "plan"; plan: { id: string } } as never) as never) as never;

  // No DB (local dev): behave like the old inline parser.
  if (!isDbConfigured()) {
    return NextResponse.json({ id: null, reply, source: "local", testMode });
  }

  const id = rid("intent");
  const sql = db();
  await sql`
    insert into agent_intents (id, prompt, state_snapshot, address, signature, nonce, test_mode, status, reply, source)
    values (${id}, ${prompt}, ${JSON.stringify(state ?? {})}, ${address ?? null}, ${signature ?? null}, ${nonce}, ${testMode}, ${"queued"}, ${JSON.stringify(reply ?? {})}, ${"local:inline"})
  `;
  return NextResponse.json({ id, reply, source: "local:inline", testMode });
}

/** GET /api/dao/intents?limit=20 — recent intents for the activity view. */
export async function GET(req: Request) {
  if (!isDbConfigured()) return NextResponse.json({ intents: [] });
  const limit = Math.min(
    50,
    Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 20)),
  );
  const sql = db();
  const rows = (await sql`
    select id, prompt, address, test_mode, status, reply, source, error, created_at, updated_at
    from agent_intents order by created_at desc limit ${limit}
  `) as Array<Record<string, unknown>>;
  return NextResponse.json({ intents: rows });
}
