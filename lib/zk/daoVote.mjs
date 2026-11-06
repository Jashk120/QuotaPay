// Poseidon membership helpers for circuits/DaoVote.circom.
//
// The DAO leaf binds the secret to the DAO address and chain id. The vote
// nullifier binds it to a proposal, so one member can vote once per proposal
// while remaining unlinkable across proposals at the chain level.
import { poseidon2, poseidon3, poseidon4 } from "poseidon-lite";
import { DEPTH, rootAndPath } from "./tree.mjs";

export { DEPTH };

export async function daoLeafHash({ secret, dao, chainId }) {
  return poseidon3([BigInt(secret), BigInt(dao), BigInt(chainId)]);
}

export function voteNullifierHash({ secret, proposalId }) {
  return poseidon2([BigInt(secret), BigInt(proposalId)]);
}

export function sessionNullifierHash({
  secret,
  proposalId,
  sessionKey,
  paymaster,
}) {
  return poseidon4([
    BigInt(secret),
    BigInt(proposalId),
    BigInt(sessionKey),
    BigInt(paymaster),
  ]);
}

/**
 * Build the exact input object circuits/DaoVote.circom expects.
 *
 * @param {object} args
 * @param {bigint|string} args.secret
 * @param {bigint|string} args.dao
 * @param {bigint|string} args.chainId
 * @param {bigint|string} args.proposalId
 * @param {bigint|string} args.sessionKey
 * @param {bigint|string} args.paymaster vote paymaster address
 * @param {boolean} args.support ballot choice bound into the proof
 * @param {Array<bigint|string>} args.leaves leaf hashes in the DAO tree
 * @param {number} args.index leaf index of this member
 */
export async function daoVoteWitness({
  secret,
  dao,
  chainId,
  proposalId,
  sessionKey,
  paymaster,
  support,
  leaves,
  index,
  depth = DEPTH,
}) {
  const leaf = await daoLeafHash({ secret, dao, chainId });
  const { root, pathElements, pathIndices } = await rootAndPath(
    leaves,
    index,
    depth,
  );

  return {
    input: {
      secret: BigInt(secret).toString(),
      pathElements: pathElements.map((v) => v.toString()),
      pathIndices: pathIndices.map(String),
      root: root.toString(),
      proposalId: BigInt(proposalId).toString(),
      dao: BigInt(dao).toString(),
      chainId: BigInt(chainId).toString(),
      sessionKey: BigInt(sessionKey).toString(),
      paymaster: BigInt(paymaster).toString(),
      voteNullifier: voteNullifierHash({ secret, proposalId }).toString(),
      sessionNullifier: sessionNullifierHash({
        secret,
        proposalId,
        sessionKey,
        paymaster,
      }).toString(),
      support: support ? "1" : "0",
    },
    leaf,
    root,
    voteNullifier: voteNullifierHash({ secret, proposalId }),
    sessionNullifier: sessionNullifierHash({
      secret,
      proposalId,
      sessionKey,
      paymaster,
    }),
    support: Boolean(support),
  };
}

/** Public signals in the circuit's declaration order. */
export function expectedDaoVoteSignals(witness) {
  return [
    witness.input.root,
    witness.input.proposalId,
    witness.input.dao,
    witness.input.chainId,
    witness.input.sessionKey,
    witness.input.paymaster,
    witness.input.voteNullifier,
    witness.input.sessionNullifier,
    witness.input.support,
  ];
}
