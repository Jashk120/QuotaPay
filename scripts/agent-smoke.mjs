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
  config: {
    name: "T", perTxCap: 200, perPeriodCap: 1000, addMemberRateLimit: 10,
    agentPaused: false, agentAddress: "0x7c1d2e3f405162738495a6b7c8d9e0f112345678",
  },
  members: [], assets: [], capUsage: { periodSpent: 0, membersAdded: 0 },
};
await sql`insert into agent_intents (id, prompt, state_snapshot, test_mode, status) values (${"intent-smoke1"}, ${"Pay October contributors 150"}, ${JSON.stringify(state)}, ${true}, ${"queued"})`;
console.log("queued");
await new Promise((r) => setTimeout(r, 9000));
const rows = await sql`select status, source from agent_intents where id = ${"intent-smoke1"}`;
console.log(JSON.stringify(rows));
await sql`delete from agent_intents where id = ${"intent-smoke1"}`;
await sql`delete from agent_events where intent_id = ${"intent-smoke1"}`;
console.log("cleaned");
