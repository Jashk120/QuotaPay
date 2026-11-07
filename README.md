# QuotaPay — DAO operator agent

Run a DAO by chatting with it. Prompts become typed plans, plans become on-chain
transactions, and the contracts — not the model — bound what can happen.

> **One line:** an AI agent with real on-chain authority, where the worst case
> is bounded by the account, not the model.

---

## What it is

A DAO is operational work: onboarding members, paying contributors, buying
assets, drafting and executing proposals, managing a treasury. The obvious fix
is an AI agent that does it from plain language. The obvious problem is that an
agent with a key can be talked into misusing it — a malicious forum post, an
invoice, or a pasted "member request" can inject instructions the agent obeys.

QuotaPay gives the agent real on-chain authority, but moves the guardrails into
the contracts:

1. **Authority enforced by the account.** The agent acts through a contract
   account (`AgentAccount`) that is itself `tx.sender`. Its validation inspects
   the transaction batch and reverts anything outside its policy table
   (`out of policy` at validation).
2. **Tiered authorization checked on-chain.** Small spends and allowlisted buys
   need only the agent (tier 1). Membership changes and disposals need an admin
   EIP-712 signature the contract verifies (tier 2). Over-cap actions and policy
   changes need a member vote (tier 3). A compromised agent can't skip a tier.

A fully compromised agent — leaked key, hijacked model, successful prompt
injection — still can't spend past its caps, add uninvited members, or call
anything its mandate doesn't allow. Prompt-injection specimens are kept and
tested; what fails is turning one into theft.

## How it works

- **Contracts** (`contracts/`, Solidity 0.8.28): `DaoCore` (treasury, caps, member
  tree, three tiers), `AgentAccount` (validation + policy), `DaoFactory` +
  child factories, `AssetModule`, `SharedDaoGasPaymaster`, `DaoSwapModule`,
  `TreasuryFundHelper`, `MockERC20`.
- **Frame transactions** (EIP-8141): agent executions are
  `VERIFY(AgentAccount) → DEFAULT(paymaster.charge) → VERIFY(paymaster) →
  SENDER(DaoCore.*)`, built by `lib/daoFrameTx.mjs` and submitted via
  `eth_sendFrameTransaction`. Deploys, funding and admin writes are ordinary
  wallet transactions.
- **Agent pipeline**: `lib/dao/agent.mjs` (deterministic parser + refusals),
  `lib/dao/llm.ts` (live LLM extraction), `lib/dao/planTx.ts` (plan → exact
  calldata with recomputed `paramsHash`), `app/api/dao/execute` (admin-signature
  check, frame build/sign/submit), `worker/` (headless VPS worker on a Neon
  intent queue).
- **ZK privacy** (`circuits/`): `Membership` and `DaoVote` Groth16 proofs over
  Poseidon commitments — it hides *who*, never *what*. See `ZK.md`.
- **Uniswap v4**: treasury swaps through each DAO's module, ETH→USDC donations
  through the helper, against a predeployed devnet pool. See `UNISWAP-V4.md`.

## Getting started

```powershell
npm install
copy .env.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000.

The console needs, at minimum:

| Var | What | When |
|---|---|---|
| `NEXT_PUBLIC_DAO_FACTORY` | the `DaoFactory` address | required to list/create DAOs |
| `NEXT_PUBLIC_USDC_ADDRESS` | the treasury token | required for balances/caps |
| `NEXT_PUBLIC_DAO_GAS_PAYMASTER` | the shared gas paymaster | required for agent execution |
| `DAO_AGENT_KEY` | server-held agent signer key | required for `/api/dao/execute` |
| `DATABASE_URL` | Neon Postgres | chat history, invites, intent queue |
| `OPENCODE_GO_API_KEY` or `OPENROUTER_API_KEY` | LLM | live parsing (else deterministic fallback) |

`NEXT_PUBLIC_*` values are baked in at build time. On Vercel, set them in the
dashboard and redeploy — Vercel never reads `.env.local`.

## Rebuild the DAO stack

One command deploys every DAO contract and rewrites `.env.local`:

```powershell
npm run deploy:all             # base stack
npm run deploy:all -- --fresh  # reset the factory discovery list (scrap old stack)
npm run deploy:all -- --demo   # + a demo DAO
npm run deploy:all -- --demo --zk   # + vote verifier/paymaster
npm run deploy:all -- --dry-run     # compile + balance preflight only
```

Restart `npm run dev` afterwards so the new `NEXT_PUBLIC_*` addresses load.

## Tests

```powershell
npm test          # contract + agent + frame-layout suites (162 tests)
npm run typecheck
npm run build
```

## Repo layout

```
contracts/          Solidity: DaoCore, AgentAccount, factories, paymasters, swap
lib/dao/            parser, LLM, plan→calldata, chain reads, frame builder
app/                Next.js app router (console, API routes)
components/dao/     chat, members, treasury, feed, policy, proposals panels
worker/             headless agent worker (Docker, VPS)
circuits/           Membership + DaoVote Groth16 circuits
scripts/            deploy, seed, probe, smoke utilities
test/               node:test suites
```

## Documentation

| File | What it covers |
|---|---|
| `dao-operator-agent-spec.md` | full design: problem, prior art, tiers, threats, flows |
| `DAO.md` | operator runbook: authorization, admin signatures, known limitations |
| `ZK.md` | circuits, the 500k validation budget, privacy scope |
| `UNISWAP-V4.md` | v4 swap design and devnet runbook |
| `.env.example` | every configuration knob, commented |

## Status

Working devnet demo on chain 1337 (self-hosted sidecar, ~500k validation budget
+ BN254 precompiles). Contracts are **not audited**; EIP-8141 and ERC-8421 are
drafts. Residual risk is stated plainly: within its mandate an agent can still
misuse funds up to its caps, and vote choices are public even when voters are
not.
