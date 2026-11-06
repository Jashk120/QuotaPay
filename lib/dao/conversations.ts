import { db, isDbConfigured } from "./db";

export type DaoConversation = {
  id: string;
  dao: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type DaoMessage = {
  id: string;
  conversationId: string;
  role: "user" | "agent";
  payload: Record<string, unknown>;
  createdAt: string;
};

type ConvRow = {
  id: string;
  dao: string;
  title: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type MsgRow = {
  id: string;
  conversation_id: string;
  role: string;
  payload: Record<string, unknown>;
  created_at: string | Date;
};

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toConversation(row: ConvRow): DaoConversation {
  return {
    id: row.id,
    dao: row.dao,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toMessage(row: MsgRow): DaoMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as DaoMessage["role"],
    payload: row.payload ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function createConversation(
  dao: string,
  title = "New chat",
): Promise<DaoConversation | null> {
  if (!isDbConfigured()) return null;
  const id = rid("chat");
  const sql = db();
  await sql`
    insert into dao_conversations (id, dao, title)
    values (${id}, ${dao.toLowerCase()}, ${title})
  `;
  return {
    id,
    dao: dao.toLowerCase(),
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listConversations(
  dao: string,
): Promise<DaoConversation[]> {
  if (!isDbConfigured()) return [];
  const sql = db();
  const rows = (await sql`
    select * from dao_conversations
    where dao = ${dao.toLowerCase()}
    order by updated_at desc
    limit 50
  `) as ConvRow[];
  return rows.map(toConversation);
}

export async function getConversation(
  id: string,
): Promise<DaoConversation | null> {
  if (!isDbConfigured()) return null;
  const sql = db();
  const rows = (await sql`
    select * from dao_conversations where id = ${id} limit 1
  `) as ConvRow[];
  return rows[0] ? toConversation(rows[0]) : null;
}

export async function listMessages(
  conversationId: string,
): Promise<DaoMessage[]> {
  if (!isDbConfigured()) return [];
  const sql = db();
  const rows = (await sql`
    select * from dao_messages
    where conversation_id = ${conversationId}
    order by created_at asc
    limit 500
  `) as MsgRow[];
  return rows.map(toMessage);
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "agent",
  payload: Record<string, unknown>,
): Promise<DaoMessage | null> {
  if (!isDbConfigured()) return null;
  const id = rid("msg");
  const sql = db();
  await sql`
    insert into dao_messages (id, conversation_id, role, payload)
    values (${id}, ${conversationId}, ${role}, ${JSON.stringify(payload)})
  `;
  if (role === "user" && typeof payload.text === "string") {
    const title = payload.text.trim().slice(0, 60) || "New chat";
    await sql`
      update dao_conversations
      set updated_at = now(),
          title = case when title = 'New chat' then ${title} else title end
      where id = ${conversationId}
    `;
  } else {
    await sql`
      update dao_conversations set updated_at = now() where id = ${conversationId}
    `;
  }
  return {
    id,
    conversationId,
    role,
    payload,
    createdAt: new Date().toISOString(),
  };
}

export async function deleteConversation(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  const sql = db();
  await sql`delete from dao_conversations where id = ${id}`;
}
