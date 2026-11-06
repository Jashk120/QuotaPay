// T26 - Agent worker end-to-end (hits the remote VPS worker via Neon).
//
// 1. DAO bootstrap: a fresh DAO state flows through the worker.
// 2. Adding members: intent completes as blocked:admin (tier-2 gate).
// 3. Removing members: intent completes as blocked:admin with member resolved.
// 4. New frames for requirements: spend + acquireAsset sender frames built,
//    signed and serialized as one atomic frame tx.
// 5. ZK-or-not: the vote path requires a Groth16 proof (fixture encodes);
//    agent paths carry no proof (4-byte charge selector), and the worker has
//    no vote-casting skill.
//
// Remote parts need DATABASE_URL (root .env or env) and the VPS worker
// polling. Without it they skip; frame/ZK assertions always run.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { runLoop } from "../worker/loop.mjs";
import { SKILLS } from "../worker/skills/registry.mjs";
import {
  buildAgentActionFrameTx,
  daoCoreAbi,
  daoVotePaymasterAbi,
  encodeDaoVoteCharge,
  serializeFrameTx,
  signFrameTx,
  toSolidityProof,
} from "../lib/daoFrameTx.mjs";
import { CHARGE_CALLDATA } from "../lib/devnetFrameTx.ts";

if (!process.env.DATABASE_URL) {
  try {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no root .env — remote tests will skip */
  }
}

const HAS_DB = Boolean(process.env.DATABASE_URL);
if (!HAS_DB) {
  throw new Error("DATABASE_URL is required (root .env or env) — refusing to silently skip remote worker tests");
}
let sql = null;
if (HAS_DB) {
  ({ neon: sql } = await import("@neondatabase/serverless").then((m) => ({
    neon: m.neon(process.env.DATABASE_URL),
  })));
}

function baseState() {
  return {
    version: 1,
    config: {
      name: "Atlas Collective",
      daoId: "atlas",
      coreAddress: "0x9a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
      agentAddress: "0x7c1d2e3f405162738495a6b7c8d9e0f112345678",
      treasuryAddress: "0x5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081",
      adminAddress: "0x1111111111111111111111111111111111111111",
      treasuryUsdc: 5000,
      perTxCap: 200,
      perPeriodCap: 1000,
      addMemberRateLimit: 10,
      votingWindowHours: 48,
      createdAt: 0,
      agentPaused: false,
    },
    members: [
      {
        id: "m-arjun", name: "Arjun K.",
        wallet: "0x2222222222222222222222222222222222222222",
        leaf: "0xa1f0c2d3e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f40312233445566778899",
        role: "contributor", joinedAt: 0, active: true,
      },
      {
        id: "m-priya", name: "Priya S.",
        wallet: "0x3333333333333333333333333333333333333333",
        leaf: "0xb2e1d3c4f5a6b7988997a6b5c4d3e2f10b8a9c7d6e5f40312233445566778800",
        role: "contributor", joinedAt: 0, active: true,
      },
    ],
    invites: [],
    proposals: [],
    assets: [
      {
        id: "asset-invoice", name: "Invoice #INV-2291", kind: "NFT",
        priceUsdc: 800, capUsdc: 1000, allowlisted: true, held: false,
      },
    ],
    capUsage: { periodSpent: 350, membersAdded: 4 },
  };
}

function freshState() {
  const s = baseState();
  s.members = [
    {
      id: "m-admin", name: "You (admin)",
      wallet: "0x1111111111111111111111111111111111111111",
      leaf: "0x07162534435261708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7",
      role: "admin", joinedAt: 0, active: true,
    },
    {
      id: "m-priya", name: "Priya S.",
      wallet: "0x3333333333333333333333333333333333333333",
      leaf: "0xb2e1d3c4f5a6b7988997a6b5c4d3e2f10b8a9c7d6e5f40312233445566778800",
      role: "contributor", joinedAt: 0, active: true,
    },
  ];
  s.capUsage = { periodSpent: 0, membersAdded: 0 };
  return s;
}

async function enqueue(prompt, state) {
  const id = `t26-${Math.random().toString(36).slice(2, 10)}`;
  await sql`insert into agent_intents (id, prompt, state_snapshot, test_mode, status)
    values (${id}, ${prompt}, ${JSON.stringify(state)}, ${true}, ${"queued"})`;
  return id;
}

async function waitDone(id, timeoutMs = 45000) {
  const t0 = Date.now();
  for (;;) {
    const rows = await sql`select status, source, reply, error from agent_intents where id = ${id}`;
    if (rows[0] && (rows[0].status === "done" || rows[0].status === "failed")) return rows[0];
    if (Date.now() - t0 > timeoutMs) throw new Error(`intent ${id} not completed in time`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function cleanup(id) {
  await sql`delete from agent_events where intent_id = ${id}`;
  await sql`delete from agent_intents where id = ${id}`;
}

test("T26 agent worker e2e", async (t) => {
  await t.test("1. fresh DAO bootstraps through the remote worker", async () => {
    const id = await enqueue("Pay October contributors 150", freshState());
    try {
      const row = await waitDone(id);
      assert.equal(row.status, "done");
      assert.equal(row.source, "worker:react");
      const trace = row.reply.loop.trace.map((s) => `${s.phase}:${s.skill || s.action || s.note || ""}`);
      assert.deepEqual(trace, ["reason:pay", "gate:pay", "act:pay", "observe:state refreshed"]);
    } finally {
      await cleanup(id);
    }
  });

  await t.test("2. adding members completes as blocked:admin", async () => {
    const id = await enqueue("Invite Sofia and Ken", baseState());
    try {
      const row = await waitDone(id);
      assert.equal(row.status, "done");
      const { loop } = row.reply;
      assert.equal(loop.status, "blocked:admin");
      const gate = loop.trace.find((s) => s.phase === "gate");
      assert.equal(gate.skill, "add_members");
      assert.equal(gate.ok, true);
    } finally {
      await cleanup(id);
    }
  });

  await t.test("3. removing a member resolves and blocks on admin", async () => {
    const id = await enqueue("Remove Arjun", baseState());
    try {
      const row = await waitDone(id);
      assert.equal(row.status, "done");
      const { loop } = row.reply;
      assert.equal(loop.status, "blocked:admin");
      const gate = loop.trace.find((s) => s.phase === "gate");
      assert.equal(gate.skill, "remove_member");
      assert.match(gate.reason, /Arjun K\./);
    } finally {
      await cleanup(id);
    }
  });
});

test("T26 frames for requirements (local, always runs)", async (t) => {
  await t.test("4. spend + acquireAsset batch as one atomic frame tx", () => {
    const AGENT = "0x7c1d2e3f405162738495a6b7c8d9e0f112345678";
    const CORE = "0x9a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
    const spend = encodeFunctionData({
      abi: daoCoreAbi,
      functionName: "spend",
      args: [CORE, "0x3333333333333333333333333333333333333333", 150n, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`],
    });
    const acquire = encodeFunctionData({
      abi: daoCoreAbi,
      functionName: "acquireAsset",
      args: [`0x${"aa".repeat(32)}`, 800n],
    });
    const tx = buildAgentActionFrameTx({
      chainId: 1337,
      nonce: 1n,
      agentAccount: AGENT,
      agentSigner: "0x5555555555555555555555555555555555555555",
      paymaster: "0x6666666666666666666666666666666666666666",
      calls: [
        { to: CORE, data: spend },
        { to: CORE, data: acquire },
      ],
    });
    assert.deepEqual(tx.frames.map((f) => f.mode), [1, 0, 1, 2, 2]);
    assert.deepEqual(tx.frames.map((f) => f.flags), [2, 0, 1, 4, 0]);
    assert.equal(tx.sender, AGENT);
    const [sel] = [decodeFunctionData({ abi: daoCoreAbi, data: spend })];
    assert.equal(sel.functionName, "spend");
    const signed = signFrameTx(tx, `0x${"59".repeat(32)}`);
    assert.ok(serializeFrameTx(signed).startsWith("0x06"));
  });

  await t.test("5a. vote path IS ZK: fixture proof encodes into charge", () => {
    const proof = JSON.parse(fs.readFileSync("test/fixtures/zk-dao/proof.json", "utf8"));
    const chargeData = encodeDaoVoteCharge({
      proof,
      proposalId: 1n,
      voteNullifier: 42n,
      sessionNullifier: 43n,
      support: true,
    });
    const decoded = decodeFunctionData({ abi: daoVotePaymasterAbi, data: chargeData });
    assert.equal(decoded.functionName, "charge");
    assert.equal(decoded.args.length, 7);
    assert.throws(() => toSolidityProof({}), TypeError);
  });

  await t.test("5b. agent paths are NOT ZK: no proof in charge frame", () => {
    assert.equal(CHARGE_CALLDATA.length, 10);
    const tx = buildAgentActionFrameTx({
      chainId: 1337,
      nonce: 2n,
      agentAccount: "0x7c1d2e3f405162738495a6b7c8d9e0f112345678",
      agentSigner: "0x5555555555555555555555555555555555555555",
      paymaster: "0x6666666666666666666666666666666666666666",
      calls: [{ to: "0x9a1b2c3d4e5f60718293a4b5c6d7e8f901234567", data: "0x" }],
    });
    assert.equal(tx.frames[1].data, CHARGE_CALLDATA);
    assert.ok(!("cast_vote" in SKILLS) && !("vote" in SKILLS) , "worker has no vote-casting skill");
    return runLoop({ prompt: "vote yes on proposal 1" }, baseState()).then((o) => {
      assert.ok(!o.skill || !String(o.skill).includes("vote"), "loop must never vote");
    });
  });
});
