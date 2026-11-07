#!/usr/bin/env node
/**
 * Seed the canonical WETH9/USDC v4 pool on the devnet (UNISWAP-V4.md §9.3).
 *
 * Uses the predeployed infrastructure (PoolManager, PositionManager, Permit2,
 * WETH9, real FiatTokenV2_2 USDC) and the documented pool parameters:
 * fee 3000, tick spacing 60, 1 WETH = 3000 USDC, ticks -202260..-190260.
 *
 *   SEED_KEY=0x... node scripts/v4-seed.mjs --rpc https://sidecar.161.118.164.226.nip.io/rpc
 *
 * Key: SEED_KEY (a funded devnet key; the predeploy throwaway is fine).
 * Writes deployments/v4-1337.json on success.
 */
import fs from "node:fs";
import {
  encodeFunctionData,
  decodeEventLog,
  erc20Abi,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const RPC = arg("rpc", process.env.DEVNET_RPC ?? "https://altmempool.forshtat.com/rpc");
const CHAIN_ID = Number(arg("chain-id", "1337"));
const SEED_KEY = process.env.SEED_KEY;
if (!SEED_KEY) throw new Error("SEED_KEY is not set");

// Predeployed devnet infrastructure (deployments/devnet.md in the sidecar repo).
const POOL_MANAGER = "0x6bF9Aa9c04fd001385742d61f6818C3236429848";
const POSITION_MANAGER = "0x5bF24B2CD6f4cc0057F4BeD53264d591620Af57B";
const STATE_VIEW = "0xd89a052862AaA34f0B6cc7f3B6a9D080584a43FB";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const WETH9 = "0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6";
const USDC = "0xEFe0D421fD473564c9C9b0cDCeB194cF476D6AF5";
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

// Canonical pool: 1 WETH = 3000 USDC, fee 3000, tick spacing 60, no hooks.
const FEE = 3000;
const TICK_SPACING = 60;
const TICK_LOWER = -202260;
const TICK_UPPER = -190260;
const WETH_AMOUNT = 1_000_000_000_000_000_000n; // 1 WETH
const USDC_AMOUNT = 3_000_000_000n; // 3000 USDC (6 decimals)
const WETH_WRAP = 2_000_000_000_000_000_000n; // wrap 2 ETH, keep dust

const pmAbi = [
  {
    type: "function",
    name: "multicall",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "", type: "bytes[]" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "initializePool",
    inputs: [
      {
        name: "pool",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "tick", type: "int24" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "modifyLiquidities",
    inputs: [
      { name: "unlockData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
];
const permit2Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];
const wethAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
];

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitMined(hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await rpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await sleep(2000);
  }
  throw new Error(`transaction ${hash} not mined`);
}

async function sendLegacy(account, { to, data, value = 0n }) {
  const nonce = Number(await rpc("eth_getTransactionCount", [account.address, "pending"]));
  const gasPrice = 2_000_000_000n;
  const estimate = await rpc("eth_estimateGas", [{ from: account.address, to, data, value: `0x${value.toString(16)}` }]);
  const gas = (BigInt(estimate) * 12n) / 10n;
  const raw = await account.signTransaction({
    chainId: CHAIN_ID,
    nonce,
    to,
    data,
    value,
    gas,
    gasPrice,
    type: "legacy",
  });
  const hash = await rpc("eth_sendRawTransaction", [raw]);
  const receipt = await waitMined(hash);
  if (receipt.status !== "0x1") throw new Error(`tx ${hash} reverted`);
  return receipt;
}

function sqrtPriceX96AtTick(tick) {
  return Math.sqrt(Math.pow(1.0001, tick)) * 2 ** 96;
}

async function main() {
  const account = privateKeyToAccount(SEED_KEY);
  console.log(`seeder:  ${account.address}`);
  console.log(`rpc:     ${RPC}`);
  const out = { chainId: CHAIN_ID, rpc: RPC, seeder: account.address, txs: {} };

  // 1. Wrap ETH -> WETH9.
  console.log("[1/5] wrapping ETH -> WETH9");
  out.txs.wrap = (
    await sendLegacy(account, {
      to: WETH9,
      data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" }),
      value: WETH_WRAP,
    })
  ).transactionHash;

  // 2. Approve Permit2, then Permit2 -> PositionManager.
  console.log("[2/5] approvals (token -> Permit2 -> PositionManager)");
  const expiry = Math.floor(Date.now() / 1000) + 30 * 86_400;
  for (const [token, amount] of [
    [WETH9, WETH_WRAP],
    [USDC, 3_300_000_000n],
  ]) {
    await sendLegacy(account, {
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2, (1n << 256n) - 1n],
      }),
    });
    const r = await sendLegacy(account, {
      to: PERMIT2,
      data: encodeFunctionData({
        abi: permit2Abi,
        functionName: "approve",
        args: [token, POSITION_MANAGER, amount, expiry],
      }),
    });
    out.txs[`permit2-${token === WETH9 ? "weth" : "usdc"}`] = r.transactionHash;
  }

  // 3. Price + liquidity math (floats; 0.999 margin keeps us under the caps).
  const sqrtInit = BigInt(Math.floor(Math.sqrt(3000e6 / 1e18) * 2 ** 96));
  const sqrtA = sqrtPriceX96AtTick(TICK_LOWER);
  const sqrtB = sqrtPriceX96AtTick(TICK_UPPER);
  const Q96 = 2 ** 96;
  const l0 = (Number(WETH_AMOUNT) * sqrtA * sqrtB) / ((sqrtB - sqrtA) * Q96);
  const l1 = (Number(USDC_AMOUNT) * Q96) / (sqrtB - sqrtA);
  const liquidity = BigInt(Math.floor(Math.min(l0, l1) * 0.999));
  console.log(`      sqrtPriceX96=${sqrtInit} liquidity=${liquidity}`);

  // 4. multicall([initializePool, modifyLiquidities(MINT_POSITION + SETTLE_PAIR)]).
  console.log("[3/5] initializePool + mint position");
  const poolKey = [WETH9, USDC, FEE, TICK_SPACING, ADDRESS_ZERO];
  const actions = `0x${(0x02).toString(16).padStart(2, "0")}${(0x0d).toString(16).padStart(2, "0")}`;
  const mintParams = [
    encodeAbiParameters(
      parseAbiParameters(
        "(address,address,uint24,int24,address),int24,int24,uint256,uint256,uint256,address,bytes"
      ),
      [
        poolKey,
        TICK_LOWER,
        TICK_UPPER,
        liquidity,
        (WETH_AMOUNT * 105n) / 100n,
        (USDC_AMOUNT * 105n) / 100n,
        account.address,
        "0x",
      ]
    ),
    encodeAbiParameters(parseAbiParameters("address,address"), [WETH9, USDC]),
  ];
  const initData = encodeFunctionData({
    abi: pmAbi,
    functionName: "initializePool",
    args: [poolKey, sqrtInit],
  });
  const modifyData = encodeFunctionData({
    abi: pmAbi,
    functionName: "modifyLiquidities",
    args: [
      encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [actions, mintParams]),
      BigInt(Math.floor(Date.now() / 1000) + 3600),
    ],
  });
  const seedReceipt = await sendLegacy(account, {
    to: POSITION_MANAGER,
    data: encodeFunctionData({
      abi: pmAbi,
      functionName: "multicall",
      args: [[initData, modifyData]],
    }),
  });
  out.txs.seed = seedReceipt.transactionHash;

  // 5. Verify: pool id, slot0, liquidity, position NFT.
  const poolId = keccak256(
    encodeAbiParameters(parseAbiParameters("(address,address,uint24,int24,address)"), [poolKey])
  );
  let tokenId = null;
  for (const log of seedReceipt.logs) {
    try {
      if (
        log.address.toLowerCase() === POSITION_MANAGER.toLowerCase() &&
        log.topics[0] === keccak256("0x" + Buffer.from("Transfer(address,address,uint256)").toString("hex"))
      ) {
        tokenId = BigInt(log.topics[3]).toString();
      }
    } catch { /* not a Transfer */ }
  }
  const svAbi = [
    {
      type: "function",
      name: "getSlot0",
      inputs: [{ name: "poolId", type: "bytes32" }],
      outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint24" }, { type: "uint24" }],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "getLiquidity",
      inputs: [{ name: "poolId", type: "bytes32" }],
      outputs: [{ type: "uint128" }],
      stateMutability: "view",
    },
  ];
  const slot0 = await rpc("eth_call", [
    { to: STATE_VIEW, data: encodeFunctionData({ abi: svAbi, functionName: "getSlot0", args: [poolId] }) },
    "latest",
  ]);
  const liq = await rpc("eth_call", [
    { to: STATE_VIEW, data: encodeFunctionData({ abi: svAbi, functionName: "getLiquidity", args: [poolId] }) },
    "latest",
  ]);
  out.pool = {
    id: poolId,
    currency0: WETH9,
    currency1: USDC,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    hooks: ADDRESS_ZERO,
    sqrtPriceX96: sqrtInit.toString(),
    tickLower: TICK_LOWER,
    tickUpper: TICK_UPPER,
    slot0,
    liquidity: BigInt(liq).toString(),
    positionTokenId: tokenId,
  };
  console.log(`      poolId:   ${poolId}`);
  console.log(`      tokenId:  ${tokenId}`);
  console.log(`      liquidity:${BigInt(liq).toString()}`);

  fs.mkdirSync("deployments", { recursive: true });
  const path = "deployments/v4-1337.json";
  fs.writeFileSync(path, JSON.stringify({
    ...out,
    contracts: {
      poolManager: POOL_MANAGER,
      positionManager: POSITION_MANAGER,
      stateView: STATE_VIEW,
      permit2: PERMIT2,
      weth9: WETH9,
      usdc: USDC,
    },
  }, null, 2));
  console.log(`wrote ${path}`);
  if (BigInt(liq) === 0n) {
    console.error("FAIL: pool has no liquidity");
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
