#!/usr/bin/env node
/** Create cloud-agent tables in Neon. Run: npm run agent:migrate */
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(url);
const schema = fs.readFileSync("db/agent-schema.sql", "utf8");
await sql(schema);
console.log("agent schema applied");
