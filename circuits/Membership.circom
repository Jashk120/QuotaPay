pragma circom 2.0.0;

// Membership proof for the QuotaPay ZK paymaster.
//
// Public statement:
//   "I know a secret whose leaf is in the tree with this root, for this
//    paymaster and chain. My per-epoch identity nullifier is fresh, and my
//    session nullifier binds this proof to this session key."
//
// Public inputs, in order:
//   root, epoch, paymaster, chainId, sessionKey,
//   identityNullifier, sessionNullifier
//
// Private inputs: secret, Merkle path.
//
// Two nullifiers are deliberate:
//   - identityNullifier = Poseidon(secret, epoch) is the one the contract
//     burns. It enforces one sponsored transaction per credential per epoch.
//   - sessionNullifier = Poseidon(secret, epoch, sessionKey) is a public
//     binding value. Groth16 only binds public inputs that participate in a
//     constraint; this hash is what forces the proof to be for TXPARAM.SENDER.
//     It is not stored on-chain and does not permit a second payment.
//
// The transaction signature covers the frame data containing this proof, so
// the proof is bound to the actual transaction without committing to SIG_HASH
// (which would be circular).

include "poseidon.circom";
include "mux1.circom";

template Membership(depth) {
    // Private witness.
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Public statement.
    signal input root;
    signal input epoch;
    signal input paymaster;
    signal input chainId;
    signal input sessionKey;
    signal input identityNullifier;
    signal input sessionNullifier;

    // Leaf = Poseidon(secret, paymaster, chainId). Binding the leaf to the
    // paymaster and chain prevents cross-instance / cross-chain reuse even if
    // two instances happen to share a root.
    component leafHash = Poseidon(3);
    leafHash.inputs[0] <== secret;
    leafHash.inputs[1] <== paymaster;
    leafHash.inputs[2] <== chainId;

    // Per-epoch double-spend nullifier.
    component identityHash = Poseidon(2);
    identityHash.inputs[0] <== secret;
    identityHash.inputs[1] <== epoch;
    identityNullifier === identityHash.out;

    // Session binding. The contract passes TXPARAM.SENDER as sessionKey, so a
    // proof generated for another sender cannot be replayed.
    component sessionHash = Poseidon(3);
    sessionHash.inputs[0] <== secret;
    sessionHash.inputs[1] <== epoch;
    sessionHash.inputs[2] <== sessionKey;
    sessionNullifier === sessionHash.out;

    signal node[depth + 1];
    node[0] <== leafHash.out;

    component muxLeft[depth];
    component muxRight[depth];
    component pathHash[depth];

    for (var i = 0; i < depth; i++) {
        // pathIndices[i] is a bit: 0 = current node is the left child,
        // 1 = current node is the right child.
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
        epoch,
        paymaster,
        chainId,
        sessionKey,
        identityNullifier,
        sessionNullifier
    ]
} = Membership(20);
