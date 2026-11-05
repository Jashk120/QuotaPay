import { encodeFunctionData } from "viem";
import { Address, Hex, Secp256k1, TxEnvelopeEip8141 } from "ox";
import { companyPaymasterAbi } from "./abis";

/** calldata for `CompanyPaymaster.charge()` */
export const CHARGE_CALLDATA = encodeFunctionData({
  abi: companyPaymasterAbi,
  functionName: "charge",
});

export type SponsoredTransferInput = {
  sender: Address.Address;
  paymaster: Address.Address;
  to: Address.Address;
  value: bigint;
  nonce: bigint;
  chainId: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export type SignedEnvelope = TxEnvelopeEip8141.TxEnvelopeEip8141;

/**
 * Builds the QuotaPay `pre_verify` layout:
 *
 * [VERIFY(approveExecution) on sender]
 * [DEFAULT(charge) on paymaster]
 * [VERIFY(approvePayment) on paymaster]
 * [SENDER(value transfer) to recipient]
 *
 * Amounts are deliberately generous: `charge()` does several cold SLOADs/SSTOREs
 * and the sponsored action may create the recipient account.
 */
export function buildSponsoredTransfer(
  input: SponsoredTransferInput,
): SignedEnvelope {
  return TxEnvelopeEip8141.from({
    chainId: input.chainId,
    sender: input.sender,
    nonce: input.nonce,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    frames: [
      {
        mode: "verify",
        flags: "approveExecution",
        executionGas: 30_000n,
      },
      {
        mode: "default",
        to: input.paymaster,
        data: CHARGE_CALLDATA,
        executionGas: 150_000n,
        stateGas: 300_000n,
      },
      {
        mode: "verify",
        flags: "approvePayment",
        to: input.paymaster,
        executionGas: 50_000n,
      },
      {
        mode: "sender",
        to: input.to,
        value: input.value,
        executionGas: 50_000n,
        stateGas: 200_000n,
      },
    ],
    signatures: [{ scheme: "secp256k1" }],
  });
}

export function signSponsoredTransfer(
  envelope: SignedEnvelope,
  privateKey: Hex.Hex,
): SignedEnvelope {
  const payload = TxEnvelopeEip8141.getSignPayload(envelope);
  const signature = Secp256k1.sign({ payload, privateKey });
  return TxEnvelopeEip8141.from({
    ...envelope,
    signatures: [{ scheme: "secp256k1", signature }],
  });
}

export function serializeSponsoredTransfer(envelope: SignedEnvelope): Hex.Hex {
  return TxEnvelopeEip8141.serialize(envelope);
}

export function sponsoredTransferHash(envelope: SignedEnvelope): Hex.Hex {
  return TxEnvelopeEip8141.hash(envelope);
}

export function envelopeToRpc(envelope: SignedEnvelope) {
  return TxEnvelopeEip8141.toRpc(envelope);
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(url, {
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

/** Canonical raw transaction submission (`0x06 || rlp(...)`). */
export async function sendRawSponsoredTransfer(
  rpcUrl: string,
  envelope: SignedEnvelope,
): Promise<Hex.Hex> {
  return rpc<Hex.Hex>(rpcUrl, "eth_sendRawTransaction", [
    serializeSponsoredTransfer(envelope),
  ]);
}

/** Alt-mempool JSON-RPC submission with the structured envelope. */
export async function sendFrameSponsoredTransfer(
  rpcUrl: string,
  envelope: SignedEnvelope,
): Promise<Hex.Hex> {
  return rpc<Hex.Hex>(rpcUrl, "eth_sendFrameTransaction", [
    envelopeToRpc(envelope),
  ]);
}

export async function getReceipt(rpcUrl: string, hash: Hex.Hex) {
  return rpc<{
    status?: string;
    blockNumber?: string;
    payer?: string;
    frameReceipts?: unknown[];
  } | null>(rpcUrl, "eth_getTransactionReceipt", [hash]);
}

export function explorerTxUrl(base: string, hash: string) {
  return `${base.replace(/\/$/, "")}/tx/${hash}`;
}
