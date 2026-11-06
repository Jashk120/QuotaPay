# DAO Operator Agent: on-chain implementation

This document covers the contracts and ZK layer for `dao-operator-agent-spec.md`.
The UI and the off-chain agent service live in `lib/dao/` and are owned
separately.

## What is implemented

| Spec item | Code |
|---|---|
| Contract account with a VERIFY policy table | `contracts/AgentAccount.sol` |
| Members, roles, proposals, caps, audit | `contracts/DaoCore.sol` |
| One-transaction DAO creation | `contracts/DaoFactory.sol` + `contracts/factories/*` |
| Mock RWA/NFT custody and marketplace | `contracts/AssetModule.sol` |
| Agent-action gas sponsorship | `contracts/DaoGasPaymaster.sol` |
| Private votes, scope = proposal | `circuits/DaoVote.circom`, `contracts/DaoVotePaymaster.sol` |
| Generated Groth16 verifier | `contracts/zk/DaoVoteVerifier.sol` |
| §7.3 frame-introspection probe | `contracts/probe/FrameReadProbe.sol` |

## Tier mapping

| Action | Tier | Code path |
|---|---|---|
| Add members within the rate limit | 1 | `DaoCore.addMembers` |
| Add members above the rate limit | 2 | `DaoCore.addMembersAuthorized` + `AdminAuth` |
| Spend within per-tx/per-period caps | 1 | `DaoCore.spend` |
| Acquire an asset within its cap | 1 | `DaoCore.acquireAsset` |
| Remove a member | 2 | `DaoCore.removeMember` + `AdminAuth` |
| Change a role | 2 | `DaoCore.setRole` + `AdminAuth` |
| Dispose of an asset | 2 | `DaoCore.disposeAsset` + `AdminAuth` |
| Spend/acquire above caps, allowlist, caps, policy, agent key, admin, vote paymaster | 3 | proposal -> `DaoCore.executeProposal` |
| Emergency pause / revoke | admin | `AgentAccount.pause`, `DaoCore.pauseAgent` |

`AgentAccount` accepts:
- a SECP256K1 signature entry whose resolved signer equals `agentSigner`;
- only SENDER target/selector pairs present in its DAO-owned policy table
  (when `frameEnforced` is true);
- `EXECUTION` approval only. Payment is approved separately by the paymaster.

`DaoCore` re-checks every limit after execution, so a VERIFY bypass still hits
caps, rate limits, allowlists and admin signatures.

## Admin signature

EIP-712 domain: `name = "DaoCore"`, `version = "1"`, the chain id, and the
`DaoCore` address.

```text
Action {
  daoCore      address
  chainId      uint256
  actionType   uint8
  paramsHash   bytes32
  nonce        uint256
  expiry       uint256
}
```

`DaoCore` recomputes `paramsHash` from the actual arguments:

| Action | `actionType` | `paramsHash` |
|---|---|---|
| Add above limit | 1 | `keccak256(abi.encode(commitments, indices, newRoot))` |
| Remove member | 2 | `keccak256(abi.encode(index, newRoot))` |
| Set role | 3 | `keccak256(abi.encode(index, role))` |
| Dispose asset | 4 | `keccak256(abi.encode(assetId, amount, to))` |

The nonce is consumed on use and the expiry is checked before the signature.

## Gas

Two paymasters, two jobs:

| Path | Paymaster | Gate |
|---|---|---|
| Agent action (tier 1/2) | `DaoGasPaymaster.charge()` | `tx.sender == DaoCore.agentAccount()`, `maxCost <= maxSponsorCost`, solvent |
| Private vote | `DaoVotePaymaster.charge(proof, ...)` | Groth16 proof against the proposal snapshot, fresh nullifier, cost/solvency |

Both approve `PAYMENT` only after their charge frame succeeds. The agent's
`AgentAccount` still approves `EXECUTION` separately, so a sponsor bug cannot
skip the target/selector policy.

## Membership root

The Poseidon root is supplied by the agent after an off-chain tree update, as in
the existing `ZkPaymaster`. `leafCommitment` and `usedCommitment` make adds
unique and replay-safe; removal still requires an admin signature and updates
the root. Root history is kept in `knownRoot`, and every proposal stores the
snapshot root used for its vote.

This means the spec's residual risk applies: a compromised agent can add
members up to the rate limit (spec §11). It cannot remove a member, dispose of
an asset or change the policy without a tier-2/3 authorization.

## ZK vote flow

1. A proposal stores `snapshotRoot` and `snapshotMembers`.
2. The member's client builds a `DaoVote` witness:
   - leaf `Poseidon(secret, dao, chainId)`;
   - vote nullifier `Poseidon(secret, proposalId)`;
   - session nullifier `Poseidon(secret, proposalId, sessionKey)`.
3. `DaoVotePaymaster.charge` verifies the proof against
   `DaoCore.proposalSnapshotRoot(proposalId)`, burns the nullifier and writes
   `voteConsumed[dao][proposalId][nullifier]`.
4. `DaoCore.castVote(proposalId, support, nullifier)` checks `voteConsumed`,
   records its own nullifier and increments the tally.
5. After the deadline `DaoCore.executeProposal` checks quorum and majority,
   then executes the stored call.

A frame tx is atomic, so a failed `castVote` rolls the paymaster burn back.
The admin sets the first paymaster before any proposal; after that, rotating it
is a tier-3 proposal.

## Frame builders

`lib/daoFrameTx.mjs` builds both layouts from spec §7:

- `buildAgentActionFrameTx`:
  `VERIFY(AgentAccount)` -> `DEFAULT(paymaster.charge)` ->
  `VERIFY(paymaster)` -> one or more `SENDER` calls with `ATOMIC_BATCH` on the
  first call. `tx.sender` is the `AgentAccount`; the signature entry is the
  agent EOA.
- `buildPrivateVoteFrameTx`:
  `VERIFY(fresh EOA)` -> `DEFAULT(votePaymaster.charge)` ->
  `VERIFY(votePaymaster)` -> `SENDER(DaoCore.castVote)`. The fresh EOA is the
  sender and the signature signer, and the proof's session binding.

`encodeDaoVoteCharge` and `encodeDaoCastVote` build the two calldata payloads.
`signFrameTx` and `serializeFrameTx` wrap the existing devnet codec. The full
contract ABI surface (DAO, AgentAccount, AssetModule, factory, both paymasters)
is in `lib/daoAbis.mjs`.

## Commands

```powershell
# compile + unit tests (ganache)
node --test "test/*.test.mjs"

# rebuild the DAO circuit + verifier (devnet ceremony; reuses build/zk pot14)
node scripts/dao-zk-setup.mjs --force

# regenerate the committed vote proof fixture
node scripts/dao-vote-proof.mjs

# deploy the DAO stack to the ethrex devnet
node scripts/deploy-dao.mjs

# spec §7.3 probe (run before enabling frameEnforced on a new chain)
node scripts/frame-read-probe.mjs --rpc https://altmempool.forshtat.com/rpc
```

`DaoFactory` deploys `DaoCore`, `AgentAccount` and `AssetModule` through three
child factories in one transaction. The split keeps each contract under the
EIP-170 24 KB limit (the `DaoCoreFactory` runtime is the tightest one).

## Known limitations

- EIP-8141 / ERC-8421 are drafts; the contracts are not audited.
- The vote path needs the 500k staked validation budget (the Groth16 verifier is
  ~258k gas). The agent action path fits the public 100k budget.
- The Poseidon root is agent-supplied (see "Membership root").
- `promptHash`/`planHash` are recorded on spends, proposals and their execution.
  Membership and asset actions carry zero hashes; the off-chain feed can label
  them from the plan store, but the on-chain event is not complete for those
  actions yet.
- `frameEnforced` defaults to the deployment config. If the §7.3 probe shows
  that chain 1337 cannot read SENDER frames during VERIFY, deploy with
  `DAO_FRAME_ENFORCED=false`; `DaoCore` remains the enforcement point.
- The demo asset and price are mocks. No real RWA custody or oracle.
