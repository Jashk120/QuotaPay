import { verifyMessage } from "viem";
import { db, isDbConfigured } from "./db";

export type DaoInvite = {
  code: string;
  dao: string;
  address: string;
  label: string | null;
  commitment: string | null;
  status: "open" | "claimed" | "added";
  createdAt: string;
  claimedAt: string | null;
};

type Row = {
  code: string;
  dao: string;
  address: string;
  label: string | null;
  commitment: string | null;
  status: string;
  created_at: string | Date;
  claimed_at: string | Date | null;
};

function toInvite(row: Row): DaoInvite {
  return {
    code: row.code,
    dao: row.dao,
    address: row.address,
    label: row.label,
    commitment: row.commitment,
    status: row.status as DaoInvite["status"],
    createdAt: new Date(row.created_at).toISOString(),
    claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
  };
}

function newCode(): string {
  return `inv-${Math.random().toString(36).slice(2, 10)}`;
}

export { inviteMessage } from "./inviteMessage";

export async function createInvite(input: {
  dao: string;
  address: string;
  label?: string;
}): Promise<DaoInvite | null> {
  if (!isDbConfigured()) return null;
  const code = newCode();
  const sql = db();
  await sql`
    insert into dao_invites (code, dao, address, label)
    values (${code}, ${input.dao.toLowerCase()}, ${input.address.toLowerCase()}, ${input.label ?? null})
  `;
  return {
    code,
    dao: input.dao.toLowerCase(),
    address: input.address.toLowerCase(),
    label: input.label ?? null,
    commitment: null,
    status: "open",
    createdAt: new Date().toISOString(),
    claimedAt: null,
  };
}

export async function listInvites(dao: string): Promise<DaoInvite[]> {
  if (!isDbConfigured()) return [];
  const sql = db();
  const rows = (await sql`
    select * from dao_invites
    where dao = ${dao.toLowerCase()}
    order by created_at desc
    limit 100
  `) as Row[];
  return rows.map(toInvite);
}

export async function getInvite(code: string): Promise<DaoInvite | null> {
  if (!isDbConfigured()) return null;
  const sql = db();
  const rows = (await sql`
    select * from dao_invites where code = ${code} limit 1
  `) as Row[];
  return rows[0] ? toInvite(rows[0]) : null;
}

export async function claimInvite(input: {
  code: string;
  message: string;
  signature: `0x${string}`;
  commitment: string;
}): Promise<{ ok: true; invite: DaoInvite } | { ok: false; error: string }> {
  const invite = await getInvite(input.code);
  if (!invite) return { ok: false, error: "invite not found" };
  if (invite.status === "added") return { ok: false, error: "already added" };
  if (!/^\d+$/.test(input.commitment)) {
    return { ok: false, error: "commitment must be a decimal field element" };
  }
  const valid = await verifyMessage({
    address: invite.address as `0x${string}`,
    message: input.message,
    signature: input.signature,
  });
  if (!valid) {
    return { ok: false, error: "signature does not match the invited address" };
  }
  const sql = db();
  await sql`
    update dao_invites
    set commitment = ${input.commitment}, status = 'claimed', claimed_at = now()
    where code = ${input.code}
  `;
  const updated = await getInvite(input.code);
  return updated
    ? { ok: true, invite: updated }
    : { ok: false, error: "could not read the claimed invite" };
}

export async function markInviteAdded(code: string): Promise<void> {
  if (!isDbConfigured()) return;
  const sql = db();
  await sql`update dao_invites set status = 'added' where code = ${code}`;
}
