import fs from "node:fs";
if (!process.env.DATABASE_URL) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

const state = {
  version: 1,
  config: {
    name: "Atlas",
    agentAddress: "0x7c1d2e3f405162738495a6b7c8d9e0f112345678",
    perTxCap: 200,
    perPeriodCap: 1000,
    addMemberRateLimit: 10,
    agentPaused: false,
  },
  members: [],
  assets: [],
  capUsage: { periodSpent: 0, membersAdded: 0 },
  proposals: [],
  events: [],
  invites: [],
  policy: [],
};

const plan = {
  id: "frame-smoke",
  action: "frame",
  tier: 1,
  title: "Frame transaction: sponsored_call",
  summary: "4-frame EIP-8141 transaction",
  resolved: [],
  params: { pattern: "sponsored_call", frames: "4", calls: 1 },
  checks: [],
  authorization: "agent",
  prompt: "build a sponsored frame transaction",
  promptHash: "0x" + "11".repeat(32),
  planHash: "0x" + "22".repeat(32),
  warnings: [],
  status: "draft",
};

const id = "intent-frame1";
await sql`delete from agent_events where intent_id = ${id}`;
await sql`delete from agent_intents where id = ${id}`;
await sql`
  insert into agent_intents (id, prompt, state_snapshot, test_mode, status, reply, source)
  values (${id}, ${"build a sponsored frame transaction"}, ${JSON.stringify(state)}, ${true}, ${"queued"}, ${JSON.stringify({ kind: "plan", plan })}, ${"llm:smoke"})
`;
console.log("queued frame intent");
await new Promise((r) => setTimeout(r, 12000));
const rows = await sql`select status, source, reply from agent_intents where id = ${id}`;
console.log(JSON.stringify(rows[0]?.status), JSON.stringify(rows[0]?.source));
const loop = rows[0]?.reply?.loop;
console.log("loop status:", loop?.status, "skill:", loop?.skill, "steps:", loop?.steps?.length);
console.log("trace:", loop?.trace?.map((s) => `${s.phase}:${s.skill ?? s.action ?? s.note ?? ""}`).join(" -> "));
const ev = await sql`select action, tier, simulated from agent_events where intent_id = ${id}`;
console.log("event:", JSON.stringify(ev[0]));
await sql`delete from agent_events where intent_id = ${id}`;
await sql`delete from agent_intents where id = ${id}`;
