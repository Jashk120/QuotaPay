#!/usr/bin/env node
/**
 * Cloud agent worker (VPS process).
 *
 *   DATABASE_URL=... AGENT_TEST_MODE=true npm run agent:worker
 *
 * Loop: claim oldest `queued` intent -> run deterministic policy engine
 * (lib/dao/agent.mjs, same as the UI) -> mark done + append audit event.
 * Works with the browser closed: the Next.js API only enqueues, this process
 * completes. LLM extraction lives in the Next API route for now; the worker
 * recomputes authoritatively so a model can never escalate tier/caps.
 * Real on-chain submission lands behind EXECUTE_ONCHAIN=true (stubbed).
 */
import { neon } from "@neondatabase/serverless";
import { parsePrompt } from "../lib/dao/agent.mjs";

const url = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const EXECUTE = process.env.EXECUTE_ONCHAIN === "true";

function rid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function claim() {
  const rows = await sql`
    select id, prompt, state_snapshot from agent_intents
    where status = 'queued' order by created_at asc limit 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  const updated = await sql`
    update agent_intents set status = 'processing', updated_at = now()
    where id = ${row.id} and status = 'queued'
    returning id
  `;
  return updated.length === 0 ? null : row;
}

async function processOne(row) {
  let reply;
  try {
    reply = parsePrompt(row.prompt, row.state_snapshot);
  } catch (e) {
    await sql`
      update agent_intents set status = 'failed', error = ${String(e?.message ?? e).slice(0, 500)}, updated_at = now()
      where id = ${row.id}
    `;
    return;
  }
  const source = "worker:local";
  await sql`
    update agent_intents set status = 'done', reply = ${JSON.stringify(reply)}, source = ${source}, updated_at = now()
    where id = ${row.id}
  `;
  const plan = reply?.kind === "plan" ? reply.plan : null;
  await sql`
    insert into agent_events (id, intent_id, action, tier, title, authorizers, simulated)
    values (${rid("e")}, ${row.id}, ${plan?.action ?? "refusal"}, ${(plan?.tier ?? 0)}, ${(plan?.title ?? reply?.title ?? "refused").toString().slice(0, 200)}, ${JSON.stringify(plan ? ["worker"] : ["worker:refused"])}, ${!EXECUTE})
  `;
  console.log(`${EXECUTE ? "[execute:stub] " : ""}done ${row.id} -> ${plan ? `${plan.action} tier${plan.tier}` : "refusal"}`);
}

console.log(`agent worker polling every ${POLL_MS}ms (execute=${EXECUTE})`);
for (;;) {
  try {
    const row = await claim();
    if (row) await processOne(row);
    else await new Promise((r) => setTimeout(r, POLL_MS));
  } catch (e) {
    console.error("worker error", e?.message ?? e);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
