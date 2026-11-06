pragma circom 2.0.0;

// Private vote proof for the DAO operator agent.
//
// Public statement:
//   "I know a secret whose commitment is in the membership tree with this
//    snapshot root, for this DAO and chain. My per-proposal nullifier is fresh,
//    and this session key is bound to the proof."
//
// Public inputs, in order:
//   root, proposalId, dao, chainId, sessionKey,
//   voteNullifier, sessionNullifier
//
// Private inputs: secret, Merkle path.
//
// The leaf binds the secret to the DAO and chain, so a commitment from one DAO
// or chain cannot be replayed in another. `voteNullifier` is burned once per
// (secret, proposal), which gives one vote per member per proposal without
// revealing which member. `sessionNullifier` binds the proof to TXPARAM.SENDER
// and is not stored on-chain.

include "poseidon.circom";
include "mux1.circom";

template DaoVote(depth) {
    // Private witness.
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Public statement.
    signal input root;
    signal input proposalId;
    signal input dao;
    signal input chainId;
    signal input sessionKey;
    signal input voteNullifier;
    signal input sessionNullifier;

    // Leaf = Poseidon(secret, dao, chainId).
    component leafHash = Poseidon(3);
    leafHash.inputs[0] <== secret;
    leafHash.inputs[1] <== dao;
    leafHash.inputs[2] <== chainId;

    // Per-proposal double-vote nullifier.
    component voteHash = Poseidon(2);
    voteHash.inputs[0] <== secret;
    voteHash.inputs[1] <== proposalId;
    voteNullifier === voteHash.out;

    // Session binding: the contract passes TXPARAM.SENDER as sessionKey.
    component sessionHash = Poseidon(3);
    sessionHash.inputs[0] <== secret;
    sessionHash.inputs[1] <== proposalId;
    sessionHash.inputs[2] <== sessionKey;
    sessionNullifier === sessionHash.out;

    signal node[depth + 1];
    node[0] <== leafHash.out;

    component muxLeft[depth];
    component muxRight[depth];
    component pathHash[depth];

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        muxLeft[i] = Mux1();
        muxLeft[i].s <== pathIndices[i];
        muxLeft[i].c[0] <== node[i];
        muxLeft[i].c[1] <== pathElements[i];

        muxRight[i] = Mux1();
        muxRight[i].s <== pathIndices[i];
        muxRight[i].c[0] <== pathElements[i];
        muxRight[i].c[1] <== node[i];

        pathHash[i] = Poseidon(2);
        pathHash[i].inputs[0] <== muxLeft[i].out;
        pathHash[i].inputs[1] <== muxRight[i].out;
        node[i + 1] <== pathHash[i].out;
    }

    root === node[depth];
}

component main {
    public [
        root,
        proposalId,
        dao,
        chainId,
        sessionKey,
        voteNullifier,
        sessionNullifier
    ]
} = DaoVote(20);
