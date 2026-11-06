// T15 — authorized-set tree invariants used by scripts/zk-admin.mjs.
//
// Adding/removing a leaf must change the root, and every emitted path must
// recompute that root. Removal zeroes a slot instead of splicing so other
// indices stay stable.
import test from "node:test";
import assert from "node:assert/strict";
import {
  leafHash,
  poseidonHash,
  rootAndPath,
} from "../lib/zk/tree.mjs";

const PAYMASTER = BigInt("0x9eaa4dc89e2fc7ec7cb3a6659d578dbfce1e59cb");
const CHAIN_ID = 1337n;

async function recomputeRoot(leaf, pathElements, pathIndices) {
  let node = leaf;
  for (let i = 0; i < pathElements.length; i++) {
    node =
      pathIndices[i] === 0
        ? await poseidonHash([node, pathElements[i]])
        : await poseidonHash([pathElements[i], node]);
  }
  return node;
}

test("T15 admin tree: add/remove keeps paths consistent", async (t) => {
  const leaves = [];
  for (const secret of [1n, 2n, 3n]) {
    leaves.push(await leafHash({ secret, paymaster: PAYMASTER, chainId: CHAIN_ID }));
  }

  await t.test("path for a non-zero index recomputes the root", async () => {
    const { root, pathElements, pathIndices } = await rootAndPath(leaves, 1);
    assert.equal(
      await recomputeRoot(leaves[1], pathElements, pathIndices),
      root,
    );
  });

  await t.test("removal zeroes the slot and keeps other indices stable", async () => {
    const before = await rootAndPath(leaves, 1);
    const next = [...leaves];
    next[0] = 0n;
    const after = await rootAndPath(next, 1);
    assert.notEqual(after.root, before.root, "root must change after removal");
    assert.equal(
      await recomputeRoot(next[1], after.pathElements, after.pathIndices),
      after.root,
    );
    assert.equal(next[1], leaves[1], "index 1 must not move");
  });

  await t.test("adding into a zero slot changes root and yields a valid path", async () => {
    const next = [...leaves];
    next[0] = 0n;
    const removed = await rootAndPath(next, 1);
    next[0] = await leafHash({
      secret: 4n,
      paymaster: PAYMASTER,
      chainId: CHAIN_ID,
    });
    const added = await rootAndPath(next, 0);
    assert.notEqual(added.root, removed.root, "root must change after add");
    assert.equal(
      await recomputeRoot(next[0], added.pathElements, added.pathIndices),
      added.root,
    );
  });
});
