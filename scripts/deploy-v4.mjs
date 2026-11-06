#!/usr/bin/env node
/**
 * Deploy the vendored Uniswap v4 singleton and its read helper to the sidecar.
 *
 *   node scripts/v4-build.mjs          # build/v4/{PoolManager,StateView}.json
 *   node scripts/deploy-v4.mjs         # deploy to DEVNET_RPC
 *
 * Env:
 *   DEVNET_RPC              default: the self-hosted sidecar in .env.local
 *   DEPLOYER_KEY            or WORKSHOP_STATE (.workshop-state.json participantKey)
 *   POOL_MANAGER_OWNER      default: deployer (use the DAO admin/timelock in prod)
 *   V4_CHAIN_ID             default: 1337
 */
import fs from "node:fs";
import path from "node:path";
import {
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileAll } from "../test/helpers/compile.mjs";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RPC = arg(
  "rpc",
  process.env.DEVNET_RPC ??
    "https://sidecar.161.118.164.226.nip.io/rpc",
);
const CHAIN_ID = Number(arg("chain-id", process.env.V4_CHAIN_ID ?? "1337"));
const STATE_PATH =
  process.env.WORKSHOP_STATE ??
  "C:/projects/poolframes/workshop/.workshop-state.json";
const V4_DIR = path.resolve("build/v4");
const RECORD = path.resolve("deployments/v4-1337.json");

function loadKey() {
  if (process.env.DEPLOYER_KEY) return process.env.DEPLOYER_KEY;
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(`No DEPLOYER_KEY and no workshop state at ${STATE_PATH}`);
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (!state.participantKey) throw new Error("state has no participantKey");
  return state.participantKey;
}

function loadV4(name) {
  const file = path.join(V4_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`missing ${file}; run "node scripts/v4-build.mjs" first`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await sleep(2000);
  }
  throw new Error(`transaction ${hash} not mined in ${timeoutMs}ms`);
}

async function sendLegacy(account, { to = null, value = 0n, data = "0x" }) {
  const nonce = Number(
    await rpc("eth_getTransactionCount", [account.address, "pending"]),
  );
  let gasPrice;
  try {
    gasPrice = BigInt(await rpc("eth_gasPrice"));
  } catch {
    gasPrice = 1_000_000_000n;
  }
  if (gasPrice === 0n) gasPrice = 1_000_000_000n;

  const estimateParams = {
    from: account.address,
    data,
    value: `0x${value.toString(16)}`,
  };
  if (to) estimateParams.to = to;
  const estimate = await rpc("eth_estimateGas", [estimateParams]);
  const gas = (BigInt(estimate) * 12n) / 10n;

  const raw = await account.signTransaction({
    chainId: CHAIN_ID,
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

async function deploy(account, artifact, args = []) {
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const tx = await sendLegacy(account, { data });
  const address = tx.receipt.contractAddress;
  if (!address) throw new Error(`${artifact.name} deploy produced no address`);
  const runtime = await rpc("eth_getCode", [address, "latest"]);
  const runtimeSize = (runtime.length - 2) / 2;
  console.log(
    `      ${artifact.name}: ${address} (runtime ${runtimeSize} bytes, ${tx.hash})`,
  );
  return { address, runtimeSize, txHash: tx.hash };
}

async function readAddress(artifact, address, functionName) {
  const data = encodeFunctionData({ abi: artifact.abi, functionName });
  const raw = await rpc("eth_call", [{ to: address, data }, "latest"]);
  return decodeFunctionResult({ abi: artifact.abi, functionName, data: raw });
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const poolManagerArtifact = loadV4("PoolManager");
  const stateViewArtifact = loadV4("StateView");

  console.log(`deployer: ${account.address}`);
  console.log(`rpc:      ${RPC}`);

  const chainId = Number(await rpc("eth_chainId"));
  if (chainId !== CHAIN_ID) {
    throw new Error(`chain id ${chainId} != ${CHAIN_ID}`);
  }
  const balance = BigInt(await rpc("eth_getBalance", [account.address, "latest"]));
  console.log(`balance:  ${Number(balance) / 1e18} ETH`);
  if (balance === 0n) {
    throw new Error("deployer has no ETH on the sidecar chain");
  }

  const owner = process.env.POOL_MANAGER_OWNER ?? account.address;
  console.log("\n[1/3] PoolManager");
  const poolManager = await deploy(account, poolManagerArtifact, [owner]);
  const deployedOwner = await readAddress(
    poolManagerArtifact,
    poolManager.address,
    "owner",
  );
  if (deployedOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`PoolManager owner ${deployedOwner} != ${owner}`);
  }

  console.log("[2/3] StateView");
  const stateView = await deploy(account, stateViewArtifact, [
    poolManager.address,
  ]);
  const viewManager = await readAddress(
    stateViewArtifact,
    stateView.address,
    "poolManager",
  );
  if (viewManager.toLowerCase() !== poolManager.address.toLowerCase()) {
    throw new Error(`StateView.poolManager ${viewManager} mismatch`);
  }

  console.log("[3/3] DaoSwapModuleFactory");
  const daoArtifacts = compileAll();
  const factory = await deploy(account, {
    ...daoArtifacts.DaoSwapModuleFactory,
    name: "DaoSwapModuleFactory",
  }, [poolManager.address]);

  const build = JSON.parse(fs.readFileSync(path.join(V4_DIR, "sizes.json"), "utf8"));
  const record = {
    chainId: CHAIN_ID,
    rpc: RPC,
    blockNumber: Number(await rpc("eth_blockNumber")),
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    source: {
      v4Core: "Uniswap/v4-core v4.0.0 (e50237c43811bd9b526eff40f26772152a42daba)",
      v4Periphery:
        "Uniswap/v4-periphery 1.0.4 (c6e4754dab11bd38c6f08ac51c3c868569e93d64)",
      solmate: "transmissions11/solmate (4b47a19038b798b4a33d9749d25e570443520647)",
    },
    build: {
      solc: build.solc,
      evmVersion: build.settings.evmVersion,
      viaIR: build.settings.viaIR,
      optimizerRuns: build.settings.optimizer.runs,
      bytecodeHash: build.settings.metadata.bytecodeHash,
    },
    contracts: {
      PoolManager: {
        address: poolManager.address,
        runtimeSize: poolManager.runtimeSize,
        owner,
      },
      StateView: {
        address: stateView.address,
        runtimeSize: stateView.runtimeSize,
      },
      DaoSwapModuleFactory: {
        address: factory.address,
        runtimeSize: factory.runtimeSize,
      },
    },
    poolManager: poolManager.address,
    stateView: stateView.address,
    daoSwapModuleFactory: factory.address,
    note: "No pools are seeded yet; run scripts/v4-seed.mjs after deploying a seeder.",
  };

  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nwrote ${RECORD}`);
  console.log(JSON.stringify(record.contracts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
