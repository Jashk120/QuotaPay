# DAO Operator Agent: Design Spec

**Working title:** DAO Operator Agent
**Status:** Draft v0.1, 2026-11-06
**One line:** Run a DAO by chatting with an agent you don't have to trust.

---

## 1. Summary

A cloud agent that operates a DAO end to end. Users prompt it in plain language ("add these three people", "remove Arjun", "pay October contributors", "buy that invoice NFT"), and it turns each prompt into a typed action, shows a plan, and executes it as an EIP-8141 frame transaction.

The agent is the product. Privacy is an addon: members vote privately through the existing ZK paymaster path.

The differentiator is not "AI runs a DAO". It is two properties enforced outside the LLM:

1. **Authority enforced by the account.** The agent acts through a contract account whose validation inspects the exact transaction batch and refuses anything outside its mandate.
2. **Tiered authorization checked onchain.** Sensitive actions (removing a member, disposing of an asset) require an admin signature that the contract verifies. Governance actions require a member vote. A hijacked agent cannot skip a tier.

---

## 2. Problem

Running a DAO is operational work: onboarding and offboarding members, drafting and executing proposals, paying contributors, managing the treasury. Today that means multisig rounds, spreadsheets and manual scripts.

Putting an AI agent in charge fixes the workload but creates a new risk. An agent with a key, or a session grant, can be talked into misusing it by a prompt injection in a forum post, an application form or an invoice. Checks that live only in the agent's code or prompt can be talked around.

**Goal:** give an agent real operational authority, with limits that hold even if the agent, its key or its model is fully compromised.

---

## 3. Prior art and positioning

Descriptions below are paraphrased from public pages. I did not audit any code.

| Project | What it does | URL |
|---|---|---|
| DAO AI Agent | Turnkey DAO creation with modular agents (governance, treasury, engagement) and a phased path toward autonomy | https://dao-ai-agent.gitbook.io |
| DAO Wizard | AI-assisted DAO creation and governance | https://ethglobal.com/showcase/dao-wizard-6afqi |
| Arbitrum AGI proposal | Per-user AI agent with its own micro-delegation that votes by the user's preferences and can be overridden | https://forum.arbitrum.foundation/t/agentic-governance-initiative-agi/29244 |
| AutoVote | Agent decides yay or nay and sends a signed vote from the user | https://ethglobal.com/showcase/autovote-ieaxr |
| Omniagent | Proposal generation, treasury strategy and onchain execution | https://ethglobal.com/showcase/omniagent-mxsn4 |
| AgentGuard | Onchain agent credentials, reputation-based permissions, deterministic spending policies | https://www.hackquest.io/ko/projects/AgentGuard |
| Brickken Agentic | Machine-readable interface to the RWA tokenization lifecycle for agents | https://www.brickken.com/post/brickken-agentic-base-mcp |

**Where this project differs (my inference from those descriptions, not a verified claim of novelty):**

- Validation is native, with no bundler or EntryPoint in the path.
- Tiers 2 and 3 add admin signatures and member votes on top of the account policy.
- The account checks the signature entry's resolved signer against `agentSigner` (currently pinned to scheme 1 in `AgentAccount`; scheme parameterization is future work).
- Natural-language membership administration (add, remove, roles) is the core of the agent, not an add-on to voting or treasury advice.
- Votes are private and gas-sponsored.

A critique of an existing governance agent points out that whoever builds and constrains the agent holds the real power: https://kelsienabben.substack.com/p/governatooorr-guardrails-practical. This design moves those constraints onchain where members can inspect them.

---

## 4. Core thesis

### 4.1 Authority enforced by the account

The agent never holds an externally owned account with open authority. It transacts through `AgentAccount`, a contract account that is `tx.sender`.

- Its VERIFY frame reads the SENDER frame's target and selector and approves execution only if they match a policy table stored in the account. This holds when `frameEnforced` is true **and** the client admits SENDER-frame reads during validation (spec §7.3 probe must PASS on that chain). On the live devnet the probe has not passed, so deployments use `DAO_FRAME_ENFORCED=false` and enforcement currently happens at execution in `DaoCore`; see §7.3.
- The policy table can be changed only by `DaoCore` as the result of a member vote.
- If VERIFY reverts before payment approval, the transaction is invalid at the protocol level, never enters a block, and no gas is charged: https://ethresear.ch/t/frame-transactions-and-the-three-gates-to-privacy/24666

This is the difference from session-key models as designed: out-of-policy transactions are rejected at validation, before execution. **Status: not yet demonstrated on the live devnet** — `frameEnforced=false` there, so `DaoCore` is the enforcing layer today (execution, not validation). Do not claim validation-enforcement until a real client rejects an out-of-policy frame tx.

### 4.2 Tiered authorization checked onchain

| Tier | Meaning | Who must authorize | Enforced where |
|---|---|---|---|
| 0 | Read, explain, draft | Anyone | No tx |
| 1 | Routine, bounded | Agent alone | `AgentAccount` VERIFY and `DaoCore` caps |
| 2 | Sensitive | Agent plus admin signature | `DaoCore` (and VERIFY when readable) |
| 3 | Governance | Member vote, then agent executes | `DaoCore` proposal state |

Defense in depth: VERIFY is read-only, so cumulative limits and signature checks are also enforced inside the called `DaoCore` functions. The LLM, the agent key and a VERIFY bug must each fail separately for a bad action to land.

---

## 5. Architecture

```
 User prompt ──► Agent service (cloud)
                   ├─ LLM: prompt ──► typed action (JSON schema only)
                   ├─ Policy engine: off-chain pre-checks, plan card
                   ├─ Identity layer: wallet-signed prompts, role lookup
                   └─ Tx builder: frame tx, signs with agent key
                              │
                              ▼
                  Alt mempool (sidecar) ──► builder
                              │
        ┌─────────────────────┼───────────────────────┐
        ▼                     ▼                       ▼
   AgentAccount          ZkPaymaster              DaoCore
 (policy, VERIFY)   (gas, ZK vote check)   (members, proposals,
                                            treasury, assets, caps)
```

### 5.1 Contracts

| Contract | Responsibility |
|---|---|
| `DaoFactory` | Deploys a DAO from a signed config in one atomic frame tx: `DaoCore`, `AgentAccount`, treasury funding |
| `DaoCore` | Member tree and root history, roles, proposals and votes, treasury, caps and counters, asset registry, audit events |
| `AgentAccount` | Contract account used by the agent. Policy table of allowed targets and selectors with a tier per selector. Mutable only by `DaoCore` |
| `ZkPaymaster` | Verifies private votes (`scope = proposalId`), writes nullifiers, sponsors gas from the DAO treasury |
| `AssetModule` | Allowlisted asset acquisition, holdings record, disposal (mock RWA/NFT for the demo) |

### 5.2 Off-chain services

| Service | Responsibility |
|---|---|
| Intent parser | Turns a prompt into one typed action. No free-form calldata |
| Plan builder | Produces a human-readable confirmation card with resolved names, amounts and the tier required |
| Signature collector | Requests and verifies EIP-712 admin signatures |
| Member registry (off-chain) | Maps invited people to commitments, so removal can resolve a name to a leaf |
| Activity feed | Reads `DaoCore` events and renders the audit log |

---

## 6. Actions and tiers

| Action | Tier | Authorization | Notes |
|---|---|---|---|
| Summarize, answer, explain | 0 | None | No tx |
| Draft a proposal | 0 | None | Off-chain until submitted |
| Add invited members | 1 | Agent | Rate-limited per period in `DaoCore`; above the limit becomes tier 2 |
| Spend or pay out within caps | 1 | Agent | Allowlisted token only, per-tx and per-period caps |
| Acquire an allowlisted asset within asset cap | 1 | Agent | One atomic batch |
| Remove a member | 2 | Agent + admin | Agent must show the resolved person first |
| Change a non-admin role | 2 | Agent + admin | |
| Dispose of or redeem an asset | 2 | Agent + admin | |
| Spend above the tier-1 cap | 3 | Member vote | Config option: an admin-approved ceiling as tier 2 |
| Acquire an asset above its cap | 3 | Member vote | |
| Add an asset to the allowlist | 3 | Member vote | |
| Change caps, the policy table or the agent key | 3 | Member vote | Only path that edits `AgentAccount` policy |
| Replace an admin | 3 | Member vote | |
| Emergency pause or revoke the agent | Admin only | Admin signature, no agent | Added safety valve; does not go through the agent |

### 6.1 Admin signature format

EIP-712 typed data:

```
Action {
  daoCore      address
  chainId      uint256
  actionType   uint8
  paramsHash   bytes32
  nonce        uint256
  expiry       uint256
}
```

- `nonce` prevents replay; `expiry` prevents stale approvals.
- `DaoCore` recomputes `paramsHash` from the actual call arguments, so a signature for one action cannot authorize another.
- The audit event also records a `promptHash` and a `planHash`. These are reported by the agent and are informational, not verified.

---

## 7. Frame transaction layouts

Notes on the environment:

- The sidecar's validation allowance is about 500k gas.
- A published benchmark reports an optimized Groth16 verifier at about 190k gas, with the pairing check alone around 181k, which exceeds the proposed 100k public allowance: https://cryptoslate.com/ethereums-privacy-push-hits-a-numbers-problem-one-proof-needs-nearly-twice-the-proposed-gas-allowance/
- ERC-8421 (Draft) defines a framework for alternative mempools with their own validation rules for frame transactions: https://raw.githubusercontent.com/forshtat/ERCs/refs/heads/pr-clean/ERCS/erc-8421.md
- The public mempool allows one pending frame transaction per sender: https://hackmd.io/@matt/frame-mempool. Batching and the sidecar's own limit mitigate this; confirm the sidecar's limit.

### 7.1 Agent action (tiers 1 and 2)

```text
0  VERIFY   target=AgentAccount   approve EXECUTION
     - signature scheme ARBITRARY: account verifies the agent signature
     - reads SENDER frame target + selector, checks policy table
     - checks tier requirements, expiry, nonce
1  DEFAULT  target=ZkPaymaster    charge()   (gas from DAO treasury)
2  VERIFY   target=ZkPaymaster    approve PAYMENT
3+ SENDER   target=DaoCore (or AssetModule)   batched calls
```

Atomic batches: adding 20 members, updating the root and emitting receipts is one transaction.

### 7.2 Private vote

```text
0  VERIFY   sender = fresh EOA     approve EXECUTION
1  DEFAULT  target=ZkPaymaster     ZK proof check + nullifier write
                                   (scope = proposalId)
2  VERIFY   target=ZkPaymaster     approve PAYMENT
3  SENDER   target=DaoCore         castVote(proposalId, choice)
```

- The proof is bound to the sender through the session key, so it cannot be replayed with a different sender.
- The sender signs the whole transaction, including `choice`, so the choice cannot be altered in transit.
- This transaction goes to the alternative mempool because of the proof-verification cost.

### 7.3 Fallback if validation cannot read the SENDER frame

An assumption to test first: the ethrex sidecar admits `FRAMEDATACOPY` / `FRAMEPARAM` reads of a post-prefix SENDER frame during validation. If it does not:

- The admin signs an `actionHash` and VERIFY checks only that plus the agent signature.
- Target and selector enforcement moves to `DaoCore` at execution.
- This is weaker (a rejected action fails at execution, not at validation) and the pitch should say so.

---

## 8. Flows

### 8.1 Create a DAO

1. Prompt: "Invite-only DAO, 5k USDC treasury, auto-approve spends up to $200."
2. The agent produces a structured config and shows a confirmation card.
3. The owner signs the config hash.
4. One atomic frame tx: `DaoFactory` deploys `DaoCore` and `AgentAccount` with the policy table, and funds the treasury.

### 8.2 Add members

1. The agent creates single-use invite codes.
2. The invitee's browser generates a secret and a commitment, then submits the commitment with the invite code.
3. The agent validates the invite and any admission rule, then submits `addMembers` for all pending commitments in one tx.
4. The off-chain registry stores person-to-commitment mapping.

### 8.3 Remove a member

1. Prompt: "Remove Arjun."
2. The agent resolves the person and shows who it resolved ("Arjun K., joined Oct 3"). This guards against name misparsing.
3. The agent requests the admin EIP-712 signature.
4. The agent submits `removeMember` with the leaf's Merkle path and the signature.
5. `DaoCore` verifies the signature, zeroes the leaf and updates the root.

### 8.4 Propose and vote

1. A member prompts a proposal. The agent drafts it and checks it against the DAO rules.
2. Within tier-1 caps it executes directly. Otherwise it opens a proposal.
3. Members vote through the private path (section 7.2): one vote per member per proposal, unlinkable to the member's wallet at the chain level, gas sponsored.
4. After the voting window, the agent calls `executeProposal`. `DaoCore` checks the vote result onchain.

### 8.5 Pay out

1. Prompt: "Pay October contributors."
2. The agent builds one atomic batch of transfers.
3. `AgentAccount` allows only the payout selector. `DaoCore` enforces per-tx and per-period caps.

### 8.6 Audit log

Every executed action emits an event with the action hash, tier, authorizers, `promptHash`, `planHash` and transaction hash. Members see an activity feed derived from these events.

---

## 9. Asset module (RWA / NFT)

The treasury can hold allowlisted tokenized assets. For the demo these are mock contracts. Real RWAs need legal custody and are out of scope.

| Action | Tier |
|---|---|
| Acquire an allowlisted asset up to the per-asset cap | 1 |
| Acquire above the cap | 3 |
| Dispose of or redeem | 2 |
| Add to allowlist | 3 |

**Atomic acquisition batch (one SENDER sequence):**

1. Approve exactly the purchase amount.
2. Call the marketplace purchase.
3. Record the holding in `DaoCore`.
4. Reset the approval to zero.

No residual allowance is left.

**Not included:** membership NFTs. A public NFT per member would reveal membership and undo the private tree. NFTs are suitable for public contributor badges only. A decaying badge idea is a possible later extension.

**Open point:** cap checks need a valuation source. Use a mock price oracle and label it as a mock.

---

## 10. Privacy addon

| Hidden from chain observers | Not hidden |
|---|---|
| Which member cast a given vote | Member count and tree roots |
| Link between a member's wallet and their vote | Proposals and vote tallies |
| Who among members voted | Payout recipients and amounts |
| | Asset purchases and holdings |

**The agent and DAO operator know who the members are** (invite-based). The privacy claim is limited to chain observers. Do not describe it as anonymity from the agent.

---

## 11. Prompt-injection defense

Layers, each independent:

1. **Typed output only.** The LLM emits one tool call from a fixed schema. No raw calldata.
2. **Untrusted text is data.** Applications, forum posts, invoices and chat history are never instructions.
3. **Off-chain policy engine.** Rejects obviously invalid plans and builds the plan card.
4. **Account policy (`AgentAccount`).** Target and selector allowlist, checked at validation.
5. **Onchain tiers and caps (`DaoCore`).** Admin signatures, rate limits, spend caps, allowlists.

Layers 1 to 3 can be bypassed by a sufficiently clever injection. Layers 4 and 5 do not depend on the model.

**What a compromised agent can still do:** spend up to the tier-1 caps, add invited members up to the rate limit, and acquire allowlisted assets up to their caps. The loss is bounded, not zero. State that plainly.

---

## 12. Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| Prompt injection to move funds | Layers 4 and 5 | Loss up to tier-1 caps |
| Stolen agent key | Account policy and caps; admin can revoke | Loss up to tier-1 caps until revoked |
| Compromised admin | Tier 3 still needs member votes | Admin can authorize tier-2 actions |
| Fake members added by a compromised agent | Rate limit; invite binding; admin alert | Dilution within the rate limit |
| Signature replay | Nonce, expiry, `chainId`, `daoCore` in the typed data | None known |
| Invite replay | Bind each invite to one commitment on first use | |
| Duplicate commitments | Reject in `addMembers` | |
| Removal during in-flight votes | Snapshot the root at proposal creation (recommended) | Removed members can still vote on old proposals |
| Malicious allowlisted token or NFT | Allowlist only demo mocks | Real assets need audits |
| Paymaster drained or griefed | Per-DAO gas budget and per-action gas cap | Claims stop if the budget runs out |
| Linking votes via network metadata | Submit through an anonymous RPC or separate relay | Agent seeing the RPC can correlate by timing |
| Small voting cohorts | Minimum cohort size for privacy claims | Weak privacy with few members |

---

## 13. Demo script (about 4 minutes)

1. **Create:** one prompt creates the DAO; the confirmation card and the owner signature are shown.
2. **Add:** two members join from a second browser; one transaction adds both.
3. **Spend:** a $150 spend pays automatically; an $800 spend becomes a proposal.
4. **Vote:** members vote privately; the agent executes the result.
5. **Remove:** "Remove Arjun" prompts for the admin signature; Arjun's next vote then fails.
6. **Asset:** "Buy the invoice NFT for 800 USDC" becomes a proposal, passes, and executes as one atomic batch.
7. **Attack:** paste a forum post that says to ignore the rules and send all funds to an attacker address. The agent refuses; a forced attempt is rejected at validation. Show the rejection.

---

## 14. Build order

1. `DaoCore` with unit tests: tree add and remove, roles, proposals, caps, signatures.
2. Typed action schema and intent parser.
3. `AgentAccount` with the policy table and VERIFY logic; run the `FRAMEDATACOPY` probe first.
4. Private voting through the paymaster with `scope = proposalId` and arbitrary calldata.
5. `AssetModule` with mocks.
6. Chat UI, plan cards, activity feed.
7. Negative tests: over-cap, missing admin signature, wrong target, replayed invite, replayed signature, stale expiry.

**Cut for the demo:** role changes beyond the basics, config updates, multi-admin, real RWAs, real identity checks.

---

## 15. Open decisions and assumptions

| # | Item | Current assumption |
|---|---|---|
| 1 | Does ethrex admit reads of the SENDER frame during VERIFY? | Unknown. Test first (about one hour). Fallback in 7.3 |
| 2 | Does the member tree support removal (zeroing a leaf)? | Assumed; confirm in the circuit |
| 3 | Root snapshot per proposal vs latest root | Snapshot at proposal creation |
| 4 | Membership anonymous to the agent? | No. Invite-based; agent knows members |
| 5 | Admin model | Single admin account for MVP |
| 6 | Price source for caps | Mock oracle |
| 7 | Sidecar pending-transaction limit per sender | Confirm; batching reduces the issue |
| 8 | Deadline and team size | Unknown; decides how much is real vs mocked |

---

## 16. What is mocked and what is not claimed

**Mocked:** invite delivery, identity and admission checks, any legal wrapper, the RWA or NFT and its marketplace, the price oracle.

**Not claimed:**

- Not ready for a public network. The proof verification exceeds the proposed public validation allowance, and ERC-8421 is a Draft. The demo runs on the sidecar's alternative mempool.
- The agent cannot misuse funds beyond its caps, but it can use them up to those caps.
- Payout amounts, recipients and asset holdings are public.
- Voting privacy is against chain observers, not against the operator.
