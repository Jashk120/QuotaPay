import {
  concat,
  keccak256,
  numberToHex,
  toFunctionSelector,
  toRlp,
  type Address,
  type Hex,
} from "viem";
import { Secp256k1 } from "ox";

/**
 * The ethrex `eip8141-tracer` wire format (the devnet behind
 * altmempool.forshtat.com). It differs from the current EIP-8141 draft used by
 * `ox`'s TxEnvelopeEip8141: 9 payload fields, top-level nonce keys and
 * recent-root references, and a `v || r || s` signature packing.
 *
 * Sources mirrored from @forshtat/hegota-support's `tx/codec.js` and the
 * `ethrex-eip8141-tracer` profile. Verified by scripts/codec-check.mjs.
 */

export const TX_TYPE: Hex = "0x06";
export const CHARGE_CALLDATA: Hex = toFunctionSelector("charge()");
export const SCHEME_SECP256K1 = 1;

export type DevnetFrame = {
  mode: number;
  flags: number;
  to?: Address;
  executionGas: bigint;
  stateGas: bigint;
  value: bigint;
  data: Hex;
};

export type DevnetSignature = {
  scheme: number;
  signer: Address;
  msg: Hex;
  signature: Hex;
};

export type RecentRootReference = {
  sourceId: Hex;
  slot: bigint;
  root: Hex;
};

export type DevnetTx = {
  chainId: bigint;
  nonceKeys: bigint[];
  nonceSeq: bigint;
  sender: Address;
  frames: DevnetFrame[];
  signatures: DevnetSignature[];
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  maxFeePerBlobGas: bigint;
  blobVersionedHashes: Hex[];
  recentRootReferences: RecentRootReference[];
};

/** RLP integer: zero is empty bytes, otherwise minimal big-endian bytes. */
function int(n: bigint): Hex {
  if (n < 0n) throw new Error(`Cannot encode a negative integer: ${n}`);
  if (n === 0n) return "0x";
  const h = numberToHex(n);
  return (h.length % 2 ? `0x0${h.slice(2)}` : h) as Hex;
}

function encodeFrame(f: DevnetFrame) {
  return [
    int(BigInt(f.mode)),
    int(BigInt(f.flags)),
    f.to ?? "0x",
    [int(f.executionGas), int(f.stateGas)],
    int(f.value),
    f.data,
  ] as const;
}

function encodeSignature(s: DevnetSignature) {
  return [int(BigInt(s.scheme)), s.signer, s.msg, s.signature] as const;
}

function encodeRoot(r: RecentRootReference) {
  return [r.sourceId, int(r.slot), r.root] as const;
}

function payload(tx: DevnetTx) {
  return [
    int(tx.chainId),
    tx.nonceKeys.map(int),
    int(tx.nonceSeq),
    tx.sender,
    tx.frames.map(encodeFrame),
    tx.signatures.map(encodeSignature),
    [int(tx.maxPriorityFeePerGas), int(tx.maxFeePerGas), int(tx.maxFeePerBlobGas)],
    tx.blobVersionedHashes,
    tx.recentRootReferences.map(encodeRoot),
  ] as const;
}

/** Canonical wire bytes: `0x06 || rlp(payload)`. */
export function serializeSponsoredTransfer(tx: DevnetTx): Hex {
  return concat([TX_TYPE, toRlp(payload(tx))]);
}

/** The digest a signature entry with an empty `msg` signs. */
export function signPayload(tx: DevnetTx): Hex {
  const elided: DevnetTx = {
    ...tx,
    signatures: tx.signatures.map((s) =>
      s.msg === "0x" ? { ...s, signature: "0x" } : s,
    ),
  };
  return keccak256(serializeSponsoredTransfer(elided));
}

/** keccak256 of the wire bytes. */
export function sponsoredTransferHash(tx: DevnetTx): Hex {
  return keccak256(serializeSponsoredTransfer(tx));
}

export type SponsoredTransferInput = {
  sender: Address;
  paymaster: Address;
  to: Address;
  value: bigint;
  nonce: bigint;
  chainId: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  data?: Hex;
  /** Calldata for the DEFAULT/pre_verify frame. Defaults to CompanyPaymaster charge(). */
  chargeData?: Hex;
  /** Execution budget for the DEFAULT/pre_verify frame. Default 70k. */
  chargeExecutionGas?: bigint;
  /** State budget for the DEFAULT/pre_verify frame. Default 300k. */
  chargeStateGas?: bigint;
};

/**
 * [VERIFY(approveExecution) on sender]
 * [DEFAULT(charge) on paymaster]
 * [VERIFY(approvePayment) on paymaster]
 * [SENDER(action) to recipient]
 *
 * The validation prefix is 20k + 55k + 22k + 2.8k ??? 99.8k, which fits the
 * stock devnet's 100k cap.
 */
export function buildSponsoredTransfer(
  input: SponsoredTransferInput,
): DevnetTx {
  return {
    chainId: BigInt(input.chainId),
    nonceKeys: [0n],
    nonceSeq: BigInt(input.nonce),
    sender: input.sender,
    frames: [
      {
        mode: 1, // VERIFY
        flags: 2, // approve execution
        executionGas: 15_000n,
        stateGas: 0n,
        value: 0n,
        data: "0x",
      },
      {
        mode: 0, // DEFAULT (pre_verify)
        flags: 0,
        to: input.paymaster,
        executionGas: input.chargeExecutionGas ?? 70_000n,
        stateGas: input.chargeStateGas ?? 300_000n,
        value: 0n,
        data: input.chargeData ?? CHARGE_CALLDATA,
      },
      {
        mode: 1, // VERIFY
        flags: 1, // approve payment
        to: input.paymaster,
        executionGas: 12_000n,
        stateGas: 0n,
        value: 0n,
        data: "0x",
      },
      {
        mode: 2, // SENDER
        flags: 0,
        to: input.to,
        executionGas: 50_000n,
        stateGas: 200_000n,
        value: input.value,
        data: input.data ?? "0x",
      },
    ],
    signatures: [
      {
        scheme: SCHEME_SECP256K1,
        signer: input.sender,
        msg: "0x",
        signature: "0x",
      },
    ],
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    maxFeePerGas: input.maxFeePerGas,
    maxFeePerBlobGas: 0n,
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
}

/** Sign the devnet sign payload and store `v || r || s` (v is 0 or 1). */
export function signSponsoredTransfer(tx: DevnetTx, privateKey: Hex): DevnetTx {
  const signature = Secp256k1.sign({
    payload: signPayload(tx),
    privateKey,
  });
  const packed = concat([
    numberToHex(signature.yParity, { size: 1 }),
    signature.r,
    signature.s,
  ]);
  return {
    ...tx,
    signatures: tx.signatures.map((s, i) =>
      i === 0 ? { ...s, signature: packed } : s,
    ),
  };
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = (await response.json()) as {
    result?: T;
    error?: { message?: string; code?: number; data?: unknown };
  };
  if (json.error) {
    throw new Error(
      json.error.message ?? `RPC error ${JSON.stringify(json.error)}`,
    );
  }
  return json.result as T;
}

/** Canonical submission: `eth_sendRawTransaction` with the 0x06 wire bytes. */
export async function sendRawSponsoredTransfer(
  rpcUrl: string,
  tx: DevnetTx,
  fetchImpl?: typeof fetch,
): Promise<Hex> {
  return rpc<Hex>(
    rpcUrl,
    "eth_sendRawTransaction",
    [serializeSponsoredTransfer(tx)],
    fetchImpl,
  );
}

/** Structured alt-mempool submission, matching @forshtat/hegota-support's `toWire`. */
export function toDevnetRpc(tx: DevnetTx) {
  const hex = (n: bigint) => `0x${n.toString(16)}` as Hex;
  return {
    chainId: hex(tx.chainId),
    nonceKeys: tx.nonceKeys.map(hex),
    nonceSeq: hex(tx.nonceSeq),
    sender: tx.sender,
    frames: tx.frames.map((f) => ({
      mode: f.mode,
      flags: f.flags,
      target: f.to ?? null,
      limits: { execution: hex(f.executionGas), state: hex(f.stateGas) },
      value: hex(f.value),
      data: f.data,
    })),
    signatures: tx.signatures.map((s) => ({
      scheme: s.scheme,
      signer: s.signer,
      msg: s.msg,
      signature: s.signature,
    })),
    fees: {
      maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas),
      maxFeePerGas: hex(tx.maxFeePerGas),
      maxFeePerBlobGas: hex(tx.maxFeePerBlobGas),
    },
    blobVersionedHashes: tx.blobVersionedHashes,
    recentRootReferences: tx.recentRootReferences.map((r) => ({
      sourceId: r.sourceId,
      slot: hex(r.slot),
      root: r.root,
    })),
  };
}

export async function sendFrameSponsoredTransfer(
  rpcUrl: string,
  tx: DevnetTx,
  fetchImpl?: typeof fetch,
): Promise<Hex> {
  return rpc<Hex>(
    rpcUrl,
    "eth_sendFrameTransaction",
    [toDevnetRpc(tx)],
    fetchImpl,
  );
}


