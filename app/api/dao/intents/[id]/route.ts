import { NextResponse } from "next/server";
import { db, isDbConfigured } from "@/lib/dao/db";

/** GET /api/dao/intents/:id — poll worker status for one intent. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isDbConfigured()) return NextResponse.json({ intent: null });
  const { id } = await ctx.params;
  const sql = db();
  const rows = (await sql`
    select id, prompt, status, reply, source, error, created_at, updated_at
    from agent_intents where id = ${id} limit 1
  `) as Array<Record<string, unknown>>;
  return NextResponse.json({ intent: rows[0] ?? null });
}
