// Poseidon Merkle tree helpers for the ZK membership circuit.
//
// The tree is sparse: missing leaves are 0, and empty subtrees collapse to the
// precomputed zero hash at that level. This lets the admin maintain a tree of
// 2^DEPTH leaves without materialising it.
import { buildPoseidon } from "circomlibjs";

export const DEPTH = 20;

let poseidonPromise;

export function getPoseidon() {
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  return poseidonPromise;
}

export async function poseidonHash(inputs) {
  const poseidon = await getPoseidon();
  return BigInt(poseidon.F.toString(poseidon(inputs)));
}

export async function zeroHashes(depth = DEPTH) {
  const zeros = [0n];
  for (let i = 1; i <= depth; i++) {
    zeros.push(await poseidonHash([zeros[i - 1], zeros[i - 1]]));
  }
  return zeros;
}

/** Leaf = Poseidon(secret, paymaster, chainId), matching Membership.circom. */
export async function leafHash({ secret, paymaster, chainId }) {
  return poseidonHash([BigInt(secret), BigInt(paymaster), BigInt(chainId)]);
}

/** Per-epoch double-spend nullifier = Poseidon(secret, epoch). */
export async function nullifierHash({ secret, epoch }) {
  return poseidonHash([BigInt(secret), BigInt(epoch)]);
}

/** Session-binding value = Poseidon(secret, epoch, sessionKey). */
export async function sessionNullifierHash({ secret, epoch, sessionKey }) {
  return poseidonHash([BigInt(secret), BigInt(epoch), BigInt(sessionKey)]);
}

/**
 * Build the Merkle path for `index` in a sparse tree.
 *
 * @param {bigint[]} leaves leaf values; index 0..leaves.length-1
 * @param {number} index leaf index
 * @param {number} depth tree depth
 * @returns {Promise<{root: bigint, pathElements: bigint[], pathIndices: number[]}>}
 */
export async function rootAndPath(leaves, index, depth = DEPTH) {
  if (index < 0 || index >= 2 ** depth) throw new Error("index out of range");
  const zeros = await zeroHashes(depth);
  const memo = new Map();

  async function subtreeRoot(level, nodeIndex) {
    const key = `${level}:${nodeIndex}`;
    if (memo.has(key)) return memo.get(key);
    let value;
    if (level === 0) {
      value = nodeIndex < leaves.length ? BigInt(leaves[nodeIndex]) : 0n;
    } else {
      const left = await subtreeRoot(level - 1, nodeIndex * 2);
      const right = await subtreeRoot(level - 1, nodeIndex * 2 + 1);
      value = left === 0n && right === 0n
        ? zeros[level]
        : await poseidonHash([left, right]);
    }
    memo.set(key, value);
    return value;
  }

  const pathElements = [];
  const pathIndices = [];
  for (let level = 0; level < depth; level++) {
    const sibling = (index >> level) ^ 1;
    pathElements.push(await subtreeRoot(level, sibling));
    pathIndices.push((index >> level) & 1);
  }
  const root = await subtreeRoot(depth, 0);
  return { root, pathElements, pathIndices };
}

/** Convenience: derive leaf + path + nullifier for one credential. */
export async function membershipWitness({
  secret,
  paymaster,
  chainId,
  epoch,
  sessionKey,
  leaves,
  index,
  depth = DEPTH,
}) {
  const leaf = await leafHash({ secret, paymaster, chainId });
  const { root, pathElements, pathIndices } = await rootAndPath(
    leaves,
    index,
    depth,
  );
  const identityNullifier = await nullifierHash({ secret, epoch });
  const sessionNullifier = await sessionNullifierHash({
    secret,
    epoch,
    sessionKey,
  });
  return {
    input: {
      secret: BigInt(secret).toString(),
      pathElements: pathElements.map((v) => v.toString()),
      pathIndices: pathIndices.map(String),
      root: root.toString(),
      epoch: BigInt(epoch).toString(),
      paymaster: BigInt(paymaster).toString(),
      chainId: BigInt(chainId).toString(),
      sessionKey: BigInt(sessionKey).toString(),
      identityNullifier: identityNullifier.toString(),
      sessionNullifier: sessionNullifier.toString(),
    },
    leaf,
    root,
    identityNullifier,
    sessionNullifier,
    // Backwards-compatible alias: the value the contract burns.
    nullifier: identityNullifier,
  };
}
