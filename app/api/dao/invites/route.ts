import { NextResponse } from "next/server";
import {
  claimInvite,
  createInvite,
  getInvite,
  inviteMessage,
  listInvites,
  markInviteAdded,
} from "@/lib/dao/invites";

type Body = {
  action?: string;
  dao?: string;
  address?: string;
  label?: string;
  code?: string;
  message?: string;
  signature?: `0x${string}`;
  commitment?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    return NextResponse.json({ invite: await getInvite(code) });
  }
  const dao = url.searchParams.get("dao");
  if (!dao) {
    return NextResponse.json(
      { error: "dao or code is required" },
      { status: 400 },
    );
  }
  return NextResponse.json({ invites: await listInvites(dao) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (body.action === "create") {
    if (!body.dao || !body.address) {
      return NextResponse.json(
        { error: "dao and address are required" },
        { status: 400 },
      );
    }
    const invite = await createInvite({
      dao: body.dao,
      address: body.address,
      label: body.label,
    });
    if (!invite) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured" },
        { status: 503 },
      );
    }
    return NextResponse.json({
      invite,
      message: inviteMessage(invite.dao, invite.code),
    });
  }

  if (body.action === "claim") {
    if (!body.code || !body.message || !body.signature || !body.commitment) {
      return NextResponse.json(
        { error: "code, message, signature and commitment are required" },
        { status: 400 },
      );
    }
    const result = await claimInvite({
      code: body.code,
      message: body.message,
      signature: body.signature,
      commitment: body.commitment,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ invite: result.invite });
  }

  if (body.action === "added") {
    if (!body.code) {
      return NextResponse.json({ error: "code is required" }, { status: 400 });
    }
    await markInviteAdded(body.code);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
