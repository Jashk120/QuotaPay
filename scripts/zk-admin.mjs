#!/usr/bin/env node
/**
 * Authorized-set admin for the ZK paymaster.
 *
 * The tree is a sparse Poseidon Merkle tree. Leaves are public commitments:
 *   leaf = Poseidon(secret, paymaster, chainId)
 *
 * The employee generates `secret` and sends only `leaf` to the admin. The admin
 * never sees the secret. `paths` emits the public Merkle path each employee
 * needs to combine with their own secret.
 *
 * Offline commands (no RPC):
 *   node scripts/zk-admin.mjs show
 *   node scripts/zk-admin.mjs add <leaf>
 *   node scripts/zk-admin.mjs remove --index 2
 *   node scripts/zk-admin.mjs remove <leaf>
 *   node scripts/zk-admin.mjs paths
 *
 * On-chain commands (need devnet RPC + deployer key):
 *   node scripts/zk-admin.mjs add <leaf> --onchain
 *   node scripts/zk-admin.mjs remove --index 2 --onchain
 *   node scripts/zk-admin.mjs set-root
 *   node scripts/zk-admin.mjs epoch 7
 *   node scripts/zk-admin.mjs deposit 0.05
 *   node scripts/zk-admin.mjs stake 0.012 86400
 *
 * State file: deployments/zk-leaves.json (public; contains no secrets).
 */
import fs from "node:fs";
import { encodeFunctionData, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { zkPaymasterAbi } from "../lib/abis.ts";
import { rootAndPath, zeroHashes } from "../lib/zk/tree.mjs";

const CHAIN_ID = 1337;
const DEFAULT_FILE = "deployments/zk-leaves.json";
const DEFAULT_DEPLOYMENT = "deployments/zk-1337.json";
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";

const [command, ...rest] = process.argv.slice(2);

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const { flags, pos } = parseArgs(rest);
const file = flags.file ?? DEFAULT_FILE;
const deployment = readJson(flags.deployment ?? DEFAULT_DEPLOYMENT, {});
const state = readJson(file, {
  chainId: deployment.chainId ?? CHAIN_ID,
  paymaster: deployment.paymaster ?? "",
  epoch: deployment.epoch ?? "0",
  leaves: deployment.demo?.leaves?.map(String) ?? [],
});
state.leaves = (state.leaves ?? []).map((v) => BigInt(v).toString());
state.paymaster = flags.paymaster ?? state.paymaster ?? deployment.paymaster ?? "";
state.epoch = flags.epoch ?? state.epoch ?? "0";

const account = (() => {
  const key = process.env.DEPLOYER_KEY ?? readJson(STATE_PATH)?.participantKey;
  return key ? privateKeyToAccount(key) : null;
})();
const rpcUrl =
  process.env.DEVNET_RPC ??
  deployment.gateway ??
  "https://altmempool.forshtat.com";

async function rpc(method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  return json.result;
}

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`transaction ${hash} not mined in ${timeoutMs}ms`);
}

async function sendLegacy({ to, value = 0n, data = "0x" }) {
  if (!account) throw new Error("no DEPLOYER_KEY / workshop participantKey");
  const nonce = Number(
    await rpc("eth_getTransactionCount", [account.address, "pending"]),
  );
  let gasPrice = BigInt(await rpc("eth_gasPrice"));
  if (gasPrice === 0n) gasPrice = 1_000_000_000n;
  const estimate = await rpc("eth_estimateGas", [
    { from: account.address, to, data, value: toHex(value) },
  ]);
  const gas = (BigInt(estimate) * 12n) / 10n;
  const raw = await account.signTransaction({
    chainId: Number(state.chainId ?? CHAIN_ID),
    nonce,
    to,
    value,
    data,
    gas,
    gasPrice,
    type: "legacy",
  });
  const hash = await rpc("eth_sendRawTransaction", [raw]);
  const receipt = await waitMined(hash);
  if (receipt.status !== "0x1") {
    throw new Error(`transaction ${hash} reverted (status ${receipt.status})`);
  }
  return { hash, receipt };
}

async function rootOf(leaves) {
  if (leaves.length === 0) {
    const zeros = await zeroHashes();
    return zeros[zeros.length - 1];
  }
  return (await rootAndPath(leaves.map(BigInt), 0)).root;
}

function save() {
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        chainId: Number(state.chainId ?? CHAIN_ID),
        paymaster: state.paymaster,
        epoch: String(state.epoch ?? "0"),
        leaves: state.leaves.map(String),
      },
      null,
      2,
    ) + "\n",
  );
}

async function onchainSetRoot(root) {
  if (!state.paymaster) throw new Error("no paymaster; pass --paymaster");
  const data = encodeFunctionData({
    abi: zkPaymasterAbi,
    functionName: "setRoot",
    args: [root],
  });
  const { hash } = await sendLegacy({ to: state.paymaster, data });
  console.log(`setRoot(${root}) -> ${hash}`);
}

async function show() {
  const root = await rootOf(state.leaves);
  console.log(`file:      ${file}`);
  console.log(`chainId:   ${state.chainId}`);
  console.log(`paymaster: ${state.paymaster || "(not set)"}`);
  console.log(`epoch:     ${state.epoch}`);
  console.log(`root:      ${root}`);
  state.leaves.forEach((leaf, index) => {
    if (BigInt(leaf) !== 0n) console.log(`  [${index}] ${leaf}`);
  });
}

async function add(leafArg) {
  if (!leafArg) throw new Error("usage: add <leaf> [--onchain]");
  const leaf = BigInt(leafArg);
  if (leaf === 0n) throw new Error("leaf must be non-zero");
  if (state.leaves.some((v) => BigInt(v) === leaf)) {
    throw new Error("leaf already exists");
  }
  let index = state.leaves.findIndex((v) => BigInt(v) === 0n);
  if (index < 0) {
    index = state.leaves.length;
    state.leaves.push(leaf.toString());
  } else {
    state.leaves[index] = leaf.toString();
  }
  const root = await rootOf(state.leaves);
  save();
  console.log(`added leaf at index ${index}`);
  console.log(`root: ${root}`);
  if (flags.onchain) await onchainSetRoot(root);
}

async function remove() {
  let index = flags.index !== undefined ? Number(flags.index) : -1;
  if (index < 0 && pos[0]) {
    index = state.leaves.findIndex((v) => BigInt(v) === BigInt(pos[0]));
  }
  if (index < 0 || index >= state.leaves.length) {
    throw new Error("usage: remove --index <i> | remove <leaf>");
  }
  state.leaves[index] = "0";
  const root = await rootOf(state.leaves);
  save();
  console.log(`removed leaf at index ${index} (slot zeroed; indices stay stable)`);
  console.log(`root: ${root}`);
  if (flags.onchain) await onchainSetRoot(root);
}

async function paths() {
  const out = [];
  for (let index = 0; index < state.leaves.length; index++) {
    if (BigInt(state.leaves[index]) === 0n) continue;
    const { root, pathElements, pathIndices } = await rootAndPath(
      state.leaves.map(BigInt),
      index,
    );
    out.push({
      index,
      leaf: state.leaves[index].toString(),
      root: root.toString(),
      paymaster: state.paymaster,
      epoch: String(state.epoch ?? "0"),
      chainId: Number(state.chainId ?? CHAIN_ID),
      pathElements: pathElements.map((v) => v.toString()),
      pathIndices,
    });
  }
  console.log(JSON.stringify(out, null, 2));
}

async function setRoot() {
  const root = await rootOf(state.leaves);
  await onchainSetRoot(root);
}

async function setEpoch() {
  const value = flags.value ?? pos[0];
  if (value === undefined) throw new Error("usage: epoch <value>");
  const data = encodeFunctionData({
    abi: zkPaymasterAbi,
    functionName: "setEpoch",
    args: [BigInt(value)],
  });
  const { hash } = await sendLegacy({ to: state.paymaster, data });
  state.epoch = String(value);
  save();
  console.log(`setEpoch(${value}) -> ${hash}`);
}

async function deposit() {
  const amount = parseEther(flags.amount ?? pos[0] ?? "");
  const data = encodeFunctionData({
    abi: zkPaymasterAbi,
    functionName: "deposit",
  });
  const { hash } = await sendLegacy({ to: state.paymaster, data, value: amount });
  console.log(`deposit(${amount} wei) -> ${hash}`);
}

async function stake() {
  const amount = parseEther(flags.amount ?? pos[0] ?? "");
  const delay = Number(flags.delay ?? pos[1] ?? 86_400);
  const data = encodeFunctionData({
    abi: zkPaymasterAbi,
    functionName: "stake",
    args: [delay],
  });
  const { hash } = await sendLegacy({ to: state.paymaster, data, value: amount });
  console.log(`stake(${amount} wei, ${delay}s) -> ${hash}`);
}

async function main() {
  switch (command) {
    case "show":
      return show();
    case "add":
      return add(pos[0]);
    case "remove":
      return remove();
    case "paths":
      return paths();
    case "set-root":
      return setRoot();
    case "epoch":
      return setEpoch();
    case "deposit":
      return deposit();
    case "stake":
      return stake();
    default:
      console.log(
        [
          "usage: node scripts/zk-admin.mjs <command>",
          "",
          "  show",
          "  add <leaf> [--onchain]",
          "  remove --index <i> | remove <leaf> [--onchain]",
          "  paths",
          "  set-root",
          "  epoch <value>",
          "  deposit <eth>",
          "  stake <eth> <delaySeconds>",
          "",
          "global flags: --file <path> --paymaster <addr> --epoch <n>",
        ].join("\n"),
      );
  }
}

await main();
