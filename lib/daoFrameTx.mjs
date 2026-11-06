// EIP-8141 frame builders for the DAO agent.
//
// Two layouts, matching dao-operator-agent-spec.md §7:
//
//   agent action: VERIFY(AgentAccount) -> DEFAULT(paymaster.charge)
//                 -> VERIFY(paymaster) -> SENDER(call 1) -> SENDER(call 2) ...
//
//   private vote: VERIFY(fresh EOA) -> DEFAULT(paymaster.charge)
//                 -> VERIFY(paymaster) -> SENDER(DaoCore.castVote)
//
// The agent action is signed by the agent EOA but `tx.sender` is the
// AgentAccount. The private vote is sent by a fresh session key, which is also
// the signature signer and the proof's session binding.
import { encodeFunctionData } from "viem";
import {
  CHARGE_CALLDATA,
  serializeSponsoredTransfer,
  signSponsoredTransfer,
} from "./devnetFrameTx.ts";
import { daoCoreAbi, daoVotePaymasterAbi } from "./daoAbis.mjs";

export { daoCoreAbi, daoVotePaymasterAbi };

const ZERO = "0x";

function signatureEntry(signer) {
  return { scheme: 1, signer, msg: ZERO, signature: ZERO };
}

function baseTx({ chainId, nonce, sender, frames, signer, fees }) {
  const maxFeePerGas = fees?.maxFeePerGas ?? 2_000_000_000n;
  const maxPriorityFeePerGas =
    fees?.maxPriorityFeePerGas ?? maxFeePerGas;
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error("maxPriorityFeePerGas exceeds maxFeePerGas");
  }
  return {
    chainId: BigInt(chainId),
    nonceKeys: [0n],
    nonceSeq: BigInt(nonce),
    sender,
    frames,
    signatures: [signatureEntry(signer)],
    maxPriorityFeePerGas,
    maxFeePerGas,
    maxFeePerBlobGas: 0n,
    blobVersionedHashes: [],
    recentRootReferences: [],
  };
}

/**
 * Build the tier-1/tier-2 agent transaction.
 *
 * @param {object} input
 * @param {number|bigint} input.chainId
 * @param {bigint} input.nonce
 * @param {`0x${string}`} input.agentAccount contract account (`tx.sender`)
 * @param {`0x${string}`} input.agentSigner EOA that signs the transaction
 * @param {`0x${string}`} input.paymaster
 * @param {`0x${string}`} input.chargeData calldata for the DEFAULT charge frame
 * @param {Array<{to:`0x${string}`, data:`0x${string}`, value?:bigint, executionGas?:bigint, stateGas?:bigint}>} input.calls
 * @param {boolean} [input.atomicBatch=true] set ATOMIC_BATCH on every SENDER
 *   call except the last (a single call is not a batch)
 */
export function buildAgentActionFrameTx({
  chainId,
  nonce,
  agentAccount,
  agentSigner,
  paymaster,
  chargeData = CHARGE_CALLDATA,
  calls,
  // The gas paymaster's charge() is cheap; the ZK vote builder below reserves
  // 330k for the Groth16 verifier instead.
  chargeExecutionGas = 100_000n,
  chargeStateGas = 300_000n,
  atomicBatch = true,
  fees,
}) {
  if (!calls || calls.length === 0) throw new Error("agent action needs at least one call");

  const frames = [
    {
      mode: 1, // VERIFY
      flags: 2, // approve EXECUTION
      to: agentAccount,
      executionGas: 50_000n,
      stateGas: 0n,
      value: 0n,
      data: ZERO,
    },
    {
      mode: 0, // DEFAULT
      flags: 0,
      to: paymaster,
      executionGas: chargeExecutionGas,
      stateGas: chargeStateGas,
      value: 0n,
      data: chargeData,
    },
    {
      mode: 1, // VERIFY
      flags: 1, // approve PAYMENT
      to: paymaster,
      executionGas: 12_000n,
      stateGas: 0n,
      value: 0n,
      data: ZERO,
    },
    ...calls.map((call, index) => ({
      mode: 2, // SENDER
      // Every frame in the batch except the last carries ATOMIC_BATCH. A
      // single call is not a batch, and a flag on the last frame is invalid.
      flags: atomicBatch && index < calls.length - 1 ? 4 : 0,
      to: call.to,
      executionGas: call.executionGas ?? 150_000n,
      stateGas: call.stateGas ?? 300_000n,
      value: call.value ?? 0n,
      data: call.data,
    })),
  ];

  return baseTx({
    chainId,
    nonce,
    sender: agentAccount,
    frames,
    signer: agentSigner,
    fees,
  });
}

/**
 * Build the private-vote transaction. `sessionKey` is a fresh EOA with no
 * funds; the paymaster sponsors gas.
 */
export function buildPrivateVoteFrameTx({
  chainId,
  nonce,
  sessionKey,
  votePaymaster,
  chargeData,
  daoCore,
  castVoteData,
  fees,
}) {
  if (!castVoteData) throw new Error("private vote needs castVote data");
  if (!chargeData) throw new Error("private vote needs charge data");

  const frames = [
    {
      mode: 1, // VERIFY
      flags: 2, // approve EXECUTION
      executionGas: 15_000n,
      stateGas: 0n,
      value: 0n,
      data: ZERO,
    },
    {
      mode: 0, // DEFAULT: verify proof, burn nullifier
      flags: 0,
      to: votePaymaster,
      executionGas: 330_000n,
      stateGas: 300_000n,
      value: 0n,
      data: chargeData,
    },
    {
      mode: 1, // VERIFY
      flags: 1, // approve PAYMENT
      to: votePaymaster,
      executionGas: 12_000n,
      stateGas: 0n,
      value: 0n,
      data: ZERO,
    },
    {
      mode: 2, // SENDER
      flags: 0,
      to: daoCore,
      executionGas: 120_000n,
      stateGas: 250_000n,
      value: 0n,
      data: castVoteData,
    },
  ];

  return baseTx({
    chainId,
    nonce,
    sender: sessionKey,
    frames,
    signer: sessionKey,
    fees,
  });
}

export function encodeDaoVoteCharge({
  proof,
  proposalId,
  voteNullifier,
  sessionNullifier,
  support,
}) {
  if (typeof support !== "boolean") {
    throw new TypeError("charge support must be a boolean");
  }
  return encodeFunctionData({
    abi: daoVotePaymasterAbi,
    functionName: "charge",
    args: [
      proof.a,
      proof.b,
      proof.c,
      BigInt(proposalId),
      BigInt(voteNullifier),
      BigInt(sessionNullifier),
      support,
    ],
  });
}

export function encodeDaoCastVote({ proposalId, support, voteNullifier }) {
  if (typeof support !== "boolean") {
    throw new TypeError("castVote support must be a boolean");
  }
  return encodeFunctionData({
    abi: daoCoreAbi,
    functionName: "castVote",
    args: [BigInt(proposalId), support, BigInt(voteNullifier)],
  });
}

export function signFrameTx(tx, privateKey) {
  return signSponsoredTransfer(tx, privateKey);
}

export function serializeFrameTx(tx) {
  return serializeSponsoredTransfer(tx);
}
