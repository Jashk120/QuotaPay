import { NextResponse } from "next/server";
import { appendMessage, listMessages } from "@/lib/dao/conversations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return NextResponse.json({ messages: await listMessages(id) });
}

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    role?: string;
    payload?: unknown;
  } | null;
  if (
    !body ||
    (body.role !== "user" && body.role !== "agent") ||
    !body.payload ||
    typeof body.payload !== "object"
  ) {
    return NextResponse.json(
      { error: "role and payload are required" },
      { status: 400 },
    );
  }
  const message = await appendMessage(
    id,
    body.role,
    body.payload as Record<string, unknown>,
  );
  if (!message) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ message });
}
