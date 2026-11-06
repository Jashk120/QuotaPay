#!/usr/bin/env node
/**
 * Publish the browser prover assets and a devnet demo credential.
 *
 *   node scripts/zk-publish.mjs
 *
 * Copies:
 *   build/zk/Membership_js/Membership.wasm  -> public/zk/Membership.wasm
 *   build/zk/Membership_final.zkey          -> public/zk/Membership_final.zkey
 *   build/zk/verification_key.json          -> public/zk/verification_key.json
 *
 * Writes public/zk/demo-credential.json from .env.local. That file contains the
 * devnet demo secret and is gitignored. It is for the local demo only.
 */
import fs from "node:fs";
import path from "node:path";
import { leafHash, rootAndPath } from "../lib/zk/tree.mjs";

function loadEnv() {
  const env = {};
  if (!fs.existsSync(".env.local")) return env;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

const env = loadEnv();
const SRC = path.resolve("build/zk");
const OUT = path.resolve("public/zk");

const assets = [
  ["Membership_js/Membership.wasm", "Membership.wasm"],
  ["Membership_final.zkey", "Membership_final.zkey"],
  ["verification_key.json", "verification_key.json"],
];

for (const [from, to] of assets) {
  const src = path.join(SRC, from);
  if (!fs.existsSync(src)) {
    throw new Error(`${src} missing; run node scripts/zk-setup.mjs and node scripts/zk-proof.mjs`);
  }
}
fs.mkdirSync(OUT, { recursive: true });
for (const [from, to] of assets) {
  fs.copyFileSync(path.join(SRC, from), path.join(OUT, to));
  console.log(`copied ${to}`);
}

const secret = env.DEMO_ZK_SECRET;
const leavesState = fs.existsSync("deployments/zk-leaves.json")
  ? JSON.parse(fs.readFileSync("deployments/zk-leaves.json", "utf8"))
  : null;
const leavesJson =
  env.DEMO_ZK_LEAVES ??
  (leavesState?.leaves ? JSON.stringify(leavesState.leaves) : undefined);
const paymaster = env.NEXT_PUBLIC_ZK_PAYMASTER ?? leavesState?.paymaster;
const epoch = env.NEXT_PUBLIC_ZK_EPOCH ?? leavesState?.epoch ?? "0";
const chainId = Number(
  env.NEXT_PUBLIC_CHAIN_ID ?? leavesState?.chainId ?? "1337",
);
if (secret && leavesJson && paymaster) {
  const leaves = JSON.parse(leavesJson).map(BigInt);
  const demoLeaf = await leafHash({
    secret: BigInt(secret),
    paymaster: BigInt(paymaster),
    chainId,
  });
  const index = leaves.findIndex((v) => v === demoLeaf);
  if (index < 0) {
    throw new Error(
      "DEMO_ZK_SECRET is not in deployments/zk-leaves.json; add its leaf or pick the right secret",
    );
  }
  const { root, pathElements, pathIndices } = await rootAndPath(leaves, index);
  if (env.NEXT_PUBLIC_ZK_ROOT && BigInt(env.NEXT_PUBLIC_ZK_ROOT) !== root) {
    console.warn(
      `warning: published root ${root} differs from NEXT_PUBLIC_ZK_ROOT ${env.NEXT_PUBLIC_ZK_ROOT}`,
    );
  }
  const credential = {
    _warning:
      "devnet demo secret. Do not publish this file on a value-bearing network.",
    secret,
    index,
    pathElements: pathElements.map((v) => v.toString()),
    pathIndices,
    root: root.toString(),
    epoch,
    paymaster,
    chainId,
  };
  fs.writeFileSync(
    path.join(OUT, "demo-credential.json"),
    JSON.stringify(credential, null, 2) + "\n",
  );
  console.log("wrote demo-credential.json (devnet demo only)");
} else {
  console.log("no DEMO_ZK_SECRET / DEMO_ZK_LEAVES / ZK paymaster; skipped demo credential");
}

console.log(`\nserving ${OUT} at ${env.NEXT_PUBLIC_ZK_ASSETS_BASE ?? "/zk"}`);
