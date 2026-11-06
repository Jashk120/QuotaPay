#!/usr/bin/env node
/**
 * Real-model smoke test. Loads keys from root .env into process.env only —
 * values are NEVER printed. Output shows provider host, model, status and
 * the parsed action JSON.
 *
 *   node scripts/llm-smoke.mjs "Pay October contributors $150"
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { resolveProvider, buildLlmSystemPrompt, parseLlmActionJson } =
  await import("../lib/dao/llm.ts");

const cfg = resolveProvider(process.env);
if (!cfg) {
  console.error("no LLM provider configured (need OPENCODE_GO_API_KEY etc.)");
  process.exit(1);
}
console.log(`provider=${cfg.provider} host=${new URL(cfg.baseUrl).host} model=${cfg.model}`);

const state = {
  config: {
    name: "Atlas", perTxCap: 200, perPeriodCap: 1000, addMemberRateLimit: 10,
    agentPaused: false, agentAddress: "0x7c1d2e3f405162738495a6b7c8d9e0f112345678",
  },
  members: [
    { name: "Arjun K.", role: "contributor", active: true, wallet: "0x2222222222222222222222222222222222222222" },
    { name: "Priya S.", role: "contributor", active: true, wallet: "0x3333333333333333333333333333333333333333" },
    { name: "Marco D.", role: "contributor", active: true, wallet: "0x4444444444444444444444444444444444444444" },
  ],
  assets: [],
  capUsage: { periodSpent: 350, membersAdded: 4 },
};

const t0 = Date.now();
const headers = { "content-type": "application/json", authorization: "Bearer " + cfg.apiKey };
if (cfg.provider === "opencode-go") headers["x-opencode-session"] = "ses_llmsmoke1";
const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: cfg.model,
    temperature: 0,
    max_tokens: 300,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildLlmSystemPrompt(state) },
      { role: "user", content: process.argv[2] || "Pay October contributors $150" },
    ],
  }),
});
console.log(`http=${res.status} ms=${Date.now() - t0}`);
const json = await res.json();
const content = json.choices?.[0]?.message?.content ?? "";
if (!content) console.log("full=" + JSON.stringify(json).slice(0, 1500));
else console.log("raw=" + String(content).slice(0, 300));
console.log("parsed=" + JSON.stringify(parseLlmActionJson(content)));
