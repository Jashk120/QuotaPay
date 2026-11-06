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
| Add members within the rate limit | 2 | `DaoCore.addMembers` + `AdminAuth` (root co-sign) |
| Add members above the rate limit | 2 | `DaoCore.addMembersAuthorized` + `AdminAuth` |
| Spend within per-tx/per-period caps | 1 | `DaoCore.spend` |
| Acquire an asset within its cap | 1 | `DaoCore.acquireAsset` |
| Remove a member | 2 | `DaoCore.removeMember` + `AdminAuth` |
| Change a role | 2 | `DaoCore.setRole` + `AdminAuth` |
| Dispose of an asset | 2 | `DaoCore.disposeAsset` + `AdminAuth` |
| Execute a passed proposal | 1 | `DaoCore.executeProposal` after the deadline (agent policy allows it; anyone may submit) |
| Spend/acquire above caps, allowlist, caps, policy, agent key, admin, vote paymaster | 3 | proposal -> `DaoCore.executeProposal` |
| Emergency pause / revoke | admin | `AgentAccount.pause`, `DaoCore.pauseAgent` |

`AgentAccount` accepts:
- a SECP256K1 signature entry with an empty `msg` (so the protocol checks it
  against the canonical transaction hash) whose resolved signer equals
  `agentSigner`;
- only SENDER target/selector pairs present in its DAO-owned policy table
  (when `frameEnforced` is true **and** the chain's client admits SENDER-frame
  reads during validation — not yet demonstrated on the live devnet, which
  deploys with `DAO_FRAME_ENFORCED=false`);
- `EXECUTION` approval only. Payment is approved separately by the paymaster.

`DaoCore` and `AssetModule` re-check every limit after execution, so a VERIFY
bypass still hits caps, rate limits, allowlists and admin signatures.
Out-of-policy targets, selectors and values are invalid at validation when
`frameEnforced` is true; state-dependent caps revert at execution.

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
unique and replay-safe; both adds and removal require an admin EIP-712
signature over the exact commitments, indices and new root. Root history is
kept in `knownRoot`, and every proposal stores the snapshot root used for its
vote.

**The root is still not verified on-chain.** The contract checks commitment
uniqueness, the add rate limit and the admin signature, but it cannot verify
that a supplied root contains only the listed commitments. The admin co-sign
closes the unilateral-agent path: a compromised agent cannot substitute a root
it controls without the admin signing that exact root. A compromised admin can
still do so, which is why production should replace this with an onchain
Poseidon incremental tree (or a proof that the new root is the correct update
from the old one). That logic belongs in a separate membership module so
`DaoCoreFactory` stays under the EIP-170 size limit. The admin can also pause
the agent when a `MembershipRootUpdated` event looks wrong.

With the admin co-sign, a compromised agent cannot add a member or change the
root on its own; it can only prepare the batch and ask the admin to sign it. It
also cannot remove a member, dispose of an asset or change the policy without a
tier-2/3 authorization. The remaining root risk is a compromised admin.

## ZK vote flow

1. A proposal stores `snapshotRoot` and `snapshotMembers`.
2. The member's client builds a `DaoVote` witness:
   - leaf `Poseidon(secret, dao, chainId)`;
   - vote nullifier `Poseidon(secret, proposalId)`;
   - session nullifier `Poseidon(secret, proposalId, sessionKey, paymaster)`.
   The public statement is
   `[root, proposalId, dao, chainId, sessionKey, paymaster, voteNullifier,
   sessionNullifier, support]`; the circuit constrains `support` to a boolean,
   so the ballot choice is bound by the proof rather than only by the enclosing
   transaction signature.
3. `DaoVotePaymaster.charge` verifies the proof against
   `DaoCore.proposalSnapshotRoot(proposalId)`, rejects a closed proposal,
   burns the nullifier, records the signed choice and writes
   `voteConsumed[dao][proposalId][nullifier]`.
4. `DaoCore.castVote(proposalId, support, nullifier)` checks `voteConsumed`,
   requires `support` to equal the choice recorded by `charge`, records its own
   nullifier and increments the tally.
5. After the deadline `DaoCore.executeProposal` checks quorum and majority,
   then executes the stored call.

Frames are not atomic by default. `charge` and `castVote` are separate frames
in one transaction: if `castVote` reverts, the burned nullifier is not rolled
back. The choice cannot be stolen, though, because `charge` stores it and
`castVote` refuses a different value.

## Frame builders

`lib/daoFrameTx.mjs` builds both layouts from spec §7:

- `buildAgentActionFrameTx`:
  `VERIFY(AgentAccount)` -> `DEFAULT(paymaster.charge)` ->
  `VERIFY(paymaster)` -> one or more `SENDER` calls with `ATOMIC_BATCH` on
  every call except the last (a single call is not a batch). `tx.sender` is the
  `AgentAccount`; the signature entry is the agent EOA.
- `buildPrivateVoteFrameTx`:
  `VERIFY(fresh EOA)` -> `DEFAULT(votePaymaster.charge)` ->
  `VERIFY(votePaymaster)` -> `SENDER(DaoCore.castVote)`. The fresh EOA is the
  sender and the signature signer, and the proof's session binding.

`DaoVotePaymaster.charge` verifies the proof and the charged transaction, but
it does not inspect the SENDER frames. A member can therefore spend their
per-proposal sponsorship on an unrelated transaction: a bounded gas-drain
issue, not vote replay. The proof now binds both the DAO and the paymaster
address (via the session nullifier) and the ballot choice, so a rotated or
second paymaster rejects old proofs and a relayer cannot flip `support`.

`encodeDaoVoteCharge` and `encodeDaoCastVote` build the two calldata payloads.
`signFrameTx` and `serializeFrameTx` wrap the existing devnet codec. The ABI
surface used by the off-chain agent and the frame builders (DAO, AgentAccount,
AssetModule, factory, both paymasters) is in `lib/daoAbis.mjs`; the contracts
remain the source of truth.

## Commands

```powershell
# compile + unit tests (ganache)
node --test "test/*.test.mjs"

# one-time shared phase-1 ceremony (reused by the DAO circuit)
node scripts/zk-setup.mjs

# rebuild the DAO circuit + verifier (devnet ceremony; requires the shared pot14)
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
  ~272k gas with the 9 public inputs). The agent-action builder currently
  declares ~165k of validation
  gas, so it also needs the staked/patched relay; it is not under the stock
  public 100k cap.
- The Poseidon root is agent-supplied and not verified against the commitment
  journal (see "Membership root"). The admin co-sign prevents a unilateral
  agent from substituting it; a compromised admin is still trusted.
- `promptHash`/`planHash` are recorded on spends, proposals and their execution.
  Membership and asset actions carry zero hashes; the off-chain feed can label
  them from the plan store, but the on-chain event is not complete for those
  actions yet.
- `frameEnforced` is set by the deployment config; changing it later is a
  tier-3 proposal because it is part of the validation policy. If the §7.3
  probe shows that chain 1337 cannot read SENDER frames during VERIFY, deploy
  with `DAO_FRAME_ENFORCED=false`; `DaoCore` remains the enforcement point.
- The demo asset and price are mocks. No real RWA custody or oracle.
- Without `NEXT_PUBLIC_DAO_CORE` the UI is a local simulation. With it set, the
  console reads `DaoCore` and submits real agent frame transactions. The join
  page's invite commitment is still not the Poseidon leaf the vote circuit
  expects.
- Governance is not encoded by the console yet. Tier-1 (spend, acquire) and
  tier-2 (add/remove member, set role, dispose) actions execute on-chain;
  tier-3 proposals are displayed but not created or executed from the UI.

## On-chain console mode

Set `NEXT_PUBLIC_DAO_CORE` to a deployed `DaoCore` and the operator console
switches from localStorage to the chain:

- **Reads.** `lib/dao/chain.ts` reads members, roles, caps, proposals, assets,
  balances, policy rules and `ActionExecuted` logs. `localStorage` keeps only
  presentation labels (member names, asset kinds, proposal titles, invites) in
  `dao.operator.labels.v1`; deleting it changes what the DAO is called, never
  what it can do.
- **Writes.** `lib/dao/planTx.ts` maps a plan to the exact `DaoCore` call and
  recomputes `paramsHash` with the contract's own `abi.encode` shape, so the
  admin signs the call that will run. `POST /api/dao/execute` builds and signs
  an EIP-8141 frame transaction with `DAO_AGENT_KEY`; the agent account is
  `tx.sender`, never the browser wallet.
- **Pause.** `DaoCore.pauseAgent` is `onlyAdmin`, so it is sent directly by
  the connected admin wallet rather than through the agent account.
- **Env.** `DAO_AGENT_KEY` must equal `AgentAccount.agentSigner()`;
  `NEXT_PUBLIC_DAO_GAS_PAYMASTER` sponsors the frame; `DAO_CORE`,
  `DAO_RPC_URL` and `DAO_CHAIN_ID` optionally override the public values.
