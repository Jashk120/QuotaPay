import type { Hex } from "viem";
import {
  buildSponsoredTransfer,
  sendFrameSponsoredTransfer,
  sendRawSponsoredTransfer,
  serializeSponsoredTransfer,
  signSponsoredTransfer,
  sponsoredTransferHash,
  type DevnetTx,
  type SponsoredTransferInput,
} from "./devnetFrameTx";

export type SignedEnvelope = DevnetTx;
export type { SponsoredTransferInput, DevnetTx };

export {
  buildSponsoredTransfer,
  sendFrameSponsoredTransfer,
  sendRawSponsoredTransfer,
  serializeSponsoredTransfer,
  signSponsoredTransfer,
  sponsoredTransferHash,
};

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

export async function getReceipt(
  rpcUrl: string,
  hash: Hex,
  fetchImpl?: typeof fetch,
) {
  return rpc<{
    status?: string;
    blockNumber?: string;
    payer?: string;
    frameReceipts?: unknown[];
  } | null>(rpcUrl, "eth_getTransactionReceipt", [hash], fetchImpl);
}

export function explorerTxUrl(base: string, hash: string) {
  return `${base.replace(/\/$/, "")}/tx/${hash}`;
}
