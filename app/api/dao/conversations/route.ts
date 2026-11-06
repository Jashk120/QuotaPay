import { NextResponse } from "next/server";
import {
  createConversation,
  deleteConversation,
  listConversations,
} from "@/lib/dao/conversations";

export async function GET(request: Request) {
  const dao = new URL(request.url).searchParams.get("dao");
  if (!dao) {
    return NextResponse.json({ error: "dao is required" }, { status: 400 });
  }
  return NextResponse.json({ conversations: await listConversations(dao) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    dao?: string;
    title?: string;
  } | null;
  if (!body?.dao) {
    return NextResponse.json({ error: "dao is required" }, { status: 400 });
  }
  const conversation = await createConversation(body.dao, body.title);
  if (!conversation) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }
  return NextResponse.json({ conversation });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  await deleteConversation(id);
  return NextResponse.json({ ok: true });
}
