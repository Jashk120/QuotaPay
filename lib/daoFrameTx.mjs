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
import { encodeFunctionData, parseAbi } from "viem";
import {
  serializeSponsoredTransfer,
  signSponsoredTransfer,
} from "./devnetFrameTx.ts";

export const daoCoreAbi = parseAbi([
  "function createProposal(address target, bytes data, uint64 deadline, bytes32 promptHash, bytes32 planHash) returns (uint256)",
  "function castVote(uint256 proposalId, bool support, uint256 voteNullifier)",
  "function executeProposal(uint256 proposalId)",
  "function spend(address token, address to, uint256 amount, bytes32 promptHash, bytes32 planHash)",
  "function addMembers(uint256[] commitments, uint256[] indices, bytes32 newRoot)",
  "function acquireAsset(bytes32 assetId, uint256 amount)",
  "function disposeAsset(bytes32 assetId, uint256 amount, address to, (uint256 nonce, uint256 expiry, bytes signature) auth)",
]);

export const daoVotePaymasterAbi = parseAbi([
  "function charge(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256 proposalId, uint256 voteNullifier, uint256 sessionNullifier)",
  "function voteConsumed(address dao, uint256 proposalId, uint256 nullifier) view returns (bool)",
]);

const ZERO = "0x";

function signatureEntry(signer) {
  return { scheme: 1, signer, msg: ZERO, signature: ZERO };
}

function baseTx({ chainId, nonce, sender, frames, signer, fees }) {
  return {
    chainId: BigInt(chainId),
    nonceKeys: [0n],
    nonceSeq: BigInt(nonce),
    sender,
    frames,
    signatures: [signatureEntry(signer)],
    maxPriorityFeePerGas: fees?.maxPriorityFeePerGas ?? 2_000_000_000n,
    maxFeePerGas: fees?.maxFeePerGas ?? 2_000_000_000n,
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
 * @param {boolean} [input.atomicBatch=true] set ATOMIC_BATCH on the first SENDER frame
 */
export function buildAgentActionFrameTx({
  chainId,
  nonce,
  agentAccount,
  agentSigner,
  paymaster,
  chargeData,
  calls,
  chargeExecutionGas = 330_000n,
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
      flags: index === 0 && atomicBatch ? 4 : 0, // ATOMIC_BATCH
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
}) {
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
    ],
  });
}

export function encodeDaoCastVote({ proposalId, support, voteNullifier }) {
  return encodeFunctionData({
    abi: daoCoreAbi,
    functionName: "castVote",
    args: [BigInt(proposalId), Boolean(support), BigInt(voteNullifier)],
  });
}

export function signFrameTx(tx, privateKey) {
  return signSponsoredTransfer(tx, privateKey);
}

export function serializeFrameTx(tx) {
  return serializeSponsoredTransfer(tx);
}
