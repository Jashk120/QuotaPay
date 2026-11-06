# QuotaPay

A company-scoped sponsorship system for EIP-8141 frame transactions, with a
privacy layer on top. A company deploys an isolated paymaster, authorizes
beneficiary wallets, and pays gas under per-beneficiary and global credit
limits. The default payment path uses **session-bound blind tokens**, and RPC
traffic is routed through **anon-rpc** by default.

The original 99.8k `pre_verify` hybrid (single paymaster, address-keyed quota)
is kept below as the historical proof log. Start here for the current system.

## 0. Current implementation (2026-11-06)

### 0.1 What is shipped

| Layer | Code | Status |
|---|---|---|
| Company onboarding | `contracts/CompanyFactory.sol`, `contracts/CompanyPaymaster.sol` | live-tested; 23 contract subtests green |
| Quota + solvency | per-beneficiary periods, company cap, `balance >= maxSponsorCost + pendingWithdrawals`, delayed withdrawal | green |
| Blind-token paymaster | `contracts/BlindTokenPaymaster.sol`, `lib/blindToken.ts` | T11 7/7; dev 1536-bit issuer |
| Devnet codec | `lib/devnetFrameTx.ts` (9-field envelope, `v‖r‖s`) | byte-identical to `@forshtat/hegota-support` (`npm run codec`) |
| UI | Next.js 16: `/`, `/company/new`, `/admin`, `/pay`, `/blind` | Playwright 1/1; `next build` 7 routes |
| Transport | `lib/anonRpc.tsx` | anon-rpc default, direct fallback, visible mode badge |
| Ops | `scripts/deploy.mjs`, `smoke.mjs`, `codec-check.mjs`, `compat-probe.mjs`, `cancel-pending.mjs` | shipped |

### 0.2 Privacy: what is default, what is not

- **Transport:** every read and frame-tx submission goes through anon-rpc's
  sandboxed fetch. The dev default specifier is the **passthrough** worker
  (sandboxed, **not anonymous**); set `NEXT_PUBLIC_ANON_RPC_SPECIFIER` to a real
  adopter network. If the worker/network is unavailable the app falls back to
  direct RPC and the header says so.
- **Payment:** `/pay` requires a session-bound blind token; issuance is inline
  (holder blinds → issuer signs the blind blob → holder unblinds). The
  paymaster sees a **rotating session key** and a **nullifier**, not the
  beneficiary. `/blind` is only a thin issuer page.
- **Trust boundaries:** the issuer still knows how many credentials it issued
  and to whom (unless blind/fixed-batch issuance is added); per-user fairness
  is issuer-trusted. The deposit/global cap bounds total over-issuance.
- **Not implemented:** full ZK (Merkle/accumulator membership, SNARK
  rate-limit, shielded pool). That needs the 1M alt-mempool validation budget
  and circuits. A Merkle proof hides *which* member, not the set size; anon-rpc
  hides the RPC provider, not on-chain data; public-mempool front-running still
  needs private orderflow.

### 0.3 Deployments and devnet status

**Original probe contracts (still live on chain 1337):** `QuotaPayExt`
`0xaafb5f5b…7aa990`, `QuotaPaymaster` `0x1c0a541f…d44280`, `QuotaPayPairing`
`0x791caf0d…93cec`, `ExposureController` `0xa7b335cf…ec649`,
`QuotaPayPreVerify` `0xd7b1b3e9…c070f` (+ caps test `0x2cd5ee71…d23dcd`),
`StakingRegistry` `0xd51c04d7…2d2f`.

**Company-scoped deployments (2026-11-06):**
- factory `0x81684be736ab04a64fd6bf89c68d3cc8af5814dc` → paymaster
  `0x9eaa4Dc89E2fc7Ec7cb3A6659D578dbfcE1E59Cb` (first build).
- factory `0xd49a008d9c87a4dc65864a7750662427cd3f45da` → paymaster
  `0x11Ec71B164e8391FcF7D56c463F210Ea718a7Aff` (transient-storage build;
  superseded — the devnet did not carry transient storage across frame
  simulation, so the pay frame reported “not charged”).

**The final persistent factory deploy was cancelled.** The pending tx
`0x0dd5f5d9…` (nonce 55, 30.9M gas, 16KB create) was replaced by a 21k
self-cancel `0x2c7e8bde…` after the devnet miner stalled. The expected factory
`0x6Ce6…` will **not** exist; deploy fresh.

**Devnet stall:** head `0x63ac6`, last block **2026-11-05 22:58:46 UTC**,
frozen across all endpoints; node/mempool alive (7 pending). The cause is
unproven; the oversized factory tx was a suspect and has been removed. When
blocks resume: `npm run deploy` (factory gas capped at 28M) then `npm run
smoke`. `.env.local` is in demo mode with no live factory/paymaster.

### 0.4 Tests and commands

```powershell
node --test test/t*.test.mjs   # T01–T11 contract suite
npm run test:e2e               # Playwright UI flow (demo mode)
npm run codec                  # devnet codec vs @forshtat/hegota-support
npm run compat                 # ox (current draft) vs devnet profile
npm run deploy                 # factory + demo company + stake + enroll
npm run smoke                  # real sponsored frame transaction
npm run cancel:pending         # replace a stuck pending tx
npm run dev                    # UI (demo mode via .env.local)
```

### 0.5 Current limitations

- EIP-8141 / ERC-8421 are drafts; the contracts are **not audited**.
- The stock sidecar caps validation at **100k**; the 1M staked budget is the
  local/alt-mempool target. The blind-token verifier uses a **1536-bit dev
  issuer key** to fit 100k; production should use 2048-bit RSA-FDH/PSS (or a
  SNARK) on the 1M budget.
- Per-user quota is **issuer-trusted** (the paymaster cannot map tokens to
  users); the deposit/global cap bounds over-issuance.
- On-chain redemption is pending the devnet recovery; the UI E2E runs in demo
  mode.
- The original sections 1–14 below describe the **pre-company** design; some
  addresses/claims (e.g. “`QuotaPayPreVerify` is the current contract”) are
  superseded by this section.

### 0.6 New file map

```
contracts/
  CompanyFactory.sol          company onboarding
  CompanyPaymaster.sol        isolated company paymaster
  BlindTokenPaymaster.sol     session-bound blind tokens
  libraries/CompanyTypes.sol
  interfaces/IStakingRegistry.sol
  QuotaPayPreVerify.sol       historical 99.8k hybrid
lib/
  devnetFrameTx.ts            ethrex 9-field codec
  blindToken.ts               blind RSA (dev issuer)
  anonRpc.tsx                 default anonymous transport
  frameTx.ts, contracts.ts, config.ts, wallet.ts, ...
app/                          Next.js UI (/company/new, /admin, /pay, /blind)
components/                   UI primitives + blind-token issuer
e2e/quotapay.spec.ts          Playwright flow
scripts/                      deploy, smoke, codec-check, compat-probe, cancel-pending
test/                         T01–T11 contract tests
```

---

## Historical proof log

> Sections 1–14 below are the original single-paymaster proof log, kept as
> evidence. They are not the current architecture; see section 0 above.

---

## 1. Status

The stock public sidecar and the locally patched sidecar are different
environments. Every claim below is labelled with where it was observed.

### Proven on the stock public sidecar (`https://altmempool.forshtat.com/rpc`)

- A staked paymaster may read its **own** storage during the `pay` frame.
  An unstaked entity reading foreign storage is rejected
  (`unstaked payer accessed …`). Canonical ethrex rejects both with
  `StorageReadNonSender`.
- A staked paymaster is admitted and mined (`0xb2aa2be4…`, block `0x62b68`).
- A staked paymaster may read a **third-party** contract
  (`ExposureController`): admitted and mined (`0x7585539a…`, block `0x62dbd`).
- The policy fires: `exposure = 1` → `"exposed"`, `credit = 0` →
  `"no credit"`, both at admission.
- Five different zero-ETH users through one paymaster are all pending
  simultaneously (10/10 in an earlier run with the own-storage paymaster).
- The stock sidecar enforces **100k** validation gas for staked and unstaked
  payers alike; 200k/600k/900k/1.5M/3M are all rejected.
- **`pre_verify` works.** A transaction with
  `[VERIFY(EXECUTION), DEFAULT(charge), VERIFY(PAYMENT), SENDER]` is admitted
  under a **99.8k** prefix (20k + 55k + 22k + 2.8k signature cost), mines, and
  the charge is written on-chain: `spent[user]` and `totalSpent` both
  increment (`0x5a6efb5b…`, block `0x63452`).
- The hybrid caps fire on-chain: a second transaction over the per-user cap is
  rejected `"user cap"`; a third user over the global cap is rejected
  `"global cap"`.

### Proven on the public chain, via the locally patched sidecar

- A staked payer gets **1M** validation gas (200k, 600k, 900k admitted and
  mined; 1.5M rejected at 1M).
- A local `pre_verify` run at a 150k charge budget also mines, with
  `spent = 1`, `totalSpent = 1` (`0x52f2fffc…`, block `0x6343e`).
- A BN254 pairing precompile call (`0x08`) in the pay frame is admitted at a
  90k pay-frame limit (`0x27b2e7ab…`, block `0x631c5`). At 50k the pairing
  itself reverts `"pairing"`; with the short-form `"0x08"` allowlist the
  node rejects `un-deployed contract address 0x08`.

### Superseded / not built

- **`QuotaPayExt` (`credit[user] >= 1`) is the old gate.** It never
  decrements. It is kept as the first-gate evidence; `QuotaPayPreVerify`
  supersedes it.
- **No unused-gas refund.** `charge()` takes a fixed fee, not `maxCost` with
  a post-frame refund.
- **Identity is resettable.** Credit is keyed by `tx.sender`; a fresh wallet
  is a fresh quota unless eligibility is bound to a credential.
- **Admission is not reservation.** The cap is enforced at inclusion, where
  the `charge()` write is atomic; the mempool may still over-admit.
- **Per-entity budgets are approximated.** One cap per prefix, keyed on the
  payer. This is not ERC-8421 `BUDGET-010` compliance.
- **Reputation accounting is prototype-grade.** The authors confirmed the
  replacement/eviction `seen`/`included` behavior is not intended.

---

## 2. The two mempools

| | Public / canonical | Local patched sidecar |
|---|---|---|
| Execution RPC | `https://altmempool.forshtat.com` | `http://localhost:14337` (proxied) |
| Mempool RPC | `https://altmempool.forshtat.com/rpc` | `http://localhost:14337/rpc` |
| Chain ID | 1337 (`0x539`) | 1337 (`0x539`) |
| Validation budget | 100k (even staked) | 100k unstaked / **1M staked payer** |
| Foreign storage read by staked payer | rejected | admitted |
| Precompile calls in validation | rejected (`un-deployed contract address`) | admitted if listed in `precompiles` |
| Explorer | `https://explorer.altmempool.wtf` | same chain |

The local sidecar is not a separate chain. It points `rpcEndpoint` and
`rpcEndpointSubmit` at the public ethrex and relays through
`ethrex_submitPrivilegedFrameTransaction` (unauthenticated on this throwaway
devnet). **Transactions admitted locally are mined on the public devnet and
appear on the public explorer.**

---

## 3. Keys and accounts

### Ours

| Role | Address | Key | Notes |
|---|---|---|---|
| Owner / deployer / local relayer | `0x348836a9b164f241945205B5a92f496BB8C3c1d8` | `0x6c8573b7b40785b8b5e2480dd5342e483f5b91cf157da09c5eee59aa40cd0d5d` | in `workshop/.workshop-state.json` (`participantKey`); funded from the devnet faucet; `relayers[0]` in the local sidecar config |
| Paymaster (current) | `0xaafb5f5ba8b2970f60284a55b6db64bf6a7aa990` | contract | `QuotaPayExt`, staked 0.012 ETH, unstake delay 86400s, `withdrawTime` 0 |
| Paymaster (first gate) | `0x1c0a541f2f963d2e8f81e902172efe3e6ad44280` | contract | `QuotaPaymaster`, own-storage only |
| Paymaster (pairing probe) | `0x791caf0d5206367bb356151485b5efdfe2493cec` | contract | `QuotaPayPairing`, staked 0.012 ETH; calls BN254 `0x08` in the pay frame |
| Policy controller | `0xa7b335cf4dfee4181805650953c1f1c219fec649` | contract | `ExposureController`, owner = participant |
| Test users | generated per run | ephemeral | 0 ETH; the paymaster pays |

### Not ours

| Role | Address | Notes |
|---|---|---|
| Public sidecar relayer | `0x5544596212F91984C986A919C8026DF0576816f9` | `skandha_config` on the public node |
| Staking registry | `0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f` | `NaiveStakingRegistry`, `minStake` 0.01 ETH |

> The participant key is a throwaway devnet key. Never reuse it on a real
> network.

---

## 4. Frame layout

A sponsored transaction is a self-contained frame transaction. The user
holds no ETH; the paymaster pays.

```
tx.sender   = user (a fresh EOA with 0 ETH)
signatures  = [ secp256k1, signer = user, msg = canonical sig hash ]
frames = [
  { mode: 1 VERIFY, flags: 2 EXECUTION, target: null,      data: 0x },
  { mode: 1 VERIFY, flags: 1 PAYMENT,   target: paymaster, data: 0x },
  { mode: 2 SENDER, flags: 0,           target: action,    data: <call> }
]
```

1. **Frame 0 — user verification.** Default code for the EOA validates the
   SECP256K1 signature and approves execution.
2. **Frame 1 — paymaster policy.** Executed as `ENTRY_POINT` (0xaa) via
   `STATICCALL`:
   ```solidity
   address user = address(uint160(txparam(TxParam.SENDER)));
   require(credit[user] >= 1, "no credit");                                  // own storage
   require(IExposureController(controller).exposure(user) == 0, "exposed");  // third-party
   // pairing variant only:
   assembly { ok := staticcall(gas(), 0x08, 0, 0, 0, 0) }
   require(ok, "pairing");
   approve(Scope.PAYMENT);
   ```
   `APPROVE(PAYMENT)` sets `payer = paymaster`, increments the sender nonce,
   and collects `max_cost` from the paymaster.
3. **Frame 2 — execution.** Runs as `tx.sender`: the sponsored action.

Budget: the validation prefix is frames 0+1. Public sidecar: `<= 100k`
including signature intrinsic (2,800). Local patch: a staked payer gets
`<= 1,000,000`.

Measured costs:

| Pay frame contents | Gas used |
|---|---|
| own + third-party read, no pairing | 19,886 (`0x4dae`) |
| own + third-party read + pairing `0x08` | fits 90k, reverts at 50k |

### 4.0 The `pre_verify` layout (the one that consumes the quota)

```
tx.sender = user
frames = [
  VERIFY(EXECUTION) on user,        20k
  DEFAULT(charge)   on paymaster,   55k  + state 300k
  VERIFY(PAYMENT)   on paymaster,   22k
  SENDER(action)                    50k  (body, not counted)
]
```

- The `DEFAULT` frame runs as a normal call (writable); its caller is
  `ENTRY_POINT` (`0xaa`).
- `charge()` reads `TXPARAM.SENDER`, applies the per-user and global caps,
  writes `spent[user]` and `totalSpent`, and stamps
  `chargedHash[user] = TXPARAM.SIG_HASH`.
- The pay frame approves only if `chargedHash[user]` equals this
  transaction's `SIG_HASH`.
- **State gas is required.** The first attempts used `state: 0` and died
  `Out Of Gas`; three cold SSTOREs need `state: 300_000`.
- Prefix total: 20k + 55k + 22k + 2.8k signature = **99.8k**, which fits the
  stock 100k cap.

### 4.1 What the quota actually enforces

| Model | Enforced at | Hard bound? | Write needed? |
|---|---|---|---|
| `credit[user] >= 1` (old gate, `QuotaPayExt`) | admission | **No** — one unit passes N pending txs | no |
| balance decremented in a `pre_verify` frame (`QuotaPayPreVerify`) | inclusion (atomic with the tx) | **yes** | yes |
| single-use voucher, nonce key = voucher nonce (proposed) | inclusion (EIP-8250 nonce manager) | yes, per issued voucher | no |

The shipped contract is the second row. The first row is kept only as
evidence of the initial gate.

### 4.2 How the quota is enforced

1. **`pre_verify` balance (built and proven).** `charge()` runs in a
   `DEFAULT` frame immediately before the pay frame. The cap check and the
   two increments are atomic with the transaction; two pending txs may both
   simulate, but the second fails at inclusion. Proven on the stock public
   sidecar.
2. **Voucher as nonce key (proposed, not built).** The sponsor issues
   single-use vouchers; the transaction uses the voucher's nonce as its
   EIP-8250 nonce key. Replay is rejected by the nonce manager, so no
   validation write is needed. A per-user epoch in the controller gives the
   sponsor a revocation switch. Not needed for the hybrid now that
   `pre_verify` works; kept as the no-write alternative.

---

## 5. Contracts

### `contracts/QuotaPayPreVerify.sol`

**The current contract.** Adds the accounting the others lack.

- `charge()` — runs in a `DEFAULT` frame before the pay frame. Requires
  `msg.sender == 0xaa`, reads the sender from `TXPARAM.SENDER`, checks
  `spent[user] + txFee <= userCap` and `totalSpent + txFee <= globalCap`,
  increments both, and stamps `chargedHash[user] = TXPARAM.SIG_HASH`.
- `fallback()` — the pay frame. Requires `credit[user] >= 1` **and**
  `chargedHash[user] == TXPARAM.SIG_HASH`, then approves payment.
- `stake(uint32)`, `setCredit(address,uint256)` — as above.

Deployments:

| Caps | Address |
|---|---|
| user 100, global 500, fee 1 | `0xd7b1b3e9a9a7930942f667d948ebf59cc4cc070f` |
| user 1, global 2, fee 1 (cap test) | `0x2cd5ee71e7bc0067c9f78c7800f4a04a17d23dcd` |

### `contracts/QuotaPayExt.sol`

The first gate. Kept as evidence; superseded by `QuotaPayPreVerify`.

- `stake(uint32)` — forwards `addStake{value}` to the registry, so the
  registry sees `msg.sender == paymaster`. The only way a contract can stake
  itself.
- `setCredit(address,uint256)` — owner-only; demo stand-in for prepaid credit.
- `fallback()` — reads `credit[user]` and `ExposureController.exposure(user)`,
  then `approve(PAYMENT)`.

### `contracts/ExposureController.sol`

- `exposure(address)` — public mapping read by the paymaster.
- `setExposure(address,uint256)` — owner-only; used to make the policy fire.

Deliberately separate from the paymaster: the point is a *third-party*
storage read, which canonical rejects.

### `contracts/QuotaPayPairing.sol`

Same policy plus a `staticcall` to `0x08` (BN254 pairing, empty input), the
shape a Groth16 verifier needs. Deployed at `0x791caf0d…` for the precompile
test.

### Compiling

From `C:\projects\QuotaPay`:

```powershell
npm.cmd exec --yes -- solc@0.8.28 `
  --base-path . `
  --include-path C:\projects\poolframes\workshop\node_modules `
  --bin --abi contracts/QuotaPayPreVerify.sol `
  contracts/QuotaPayExt.sol contracts/ExposureController.sol `
  contracts/QuotaPayPairing.sol contracts/QuotaPaymaster.sol `
  -o build
```

Artifacts land in `build\` as
`contracts_<File>_sol_<Contract>.{abi,bin}`. The workshop scripts still read
the artifacts under `workshop\build\`, which are unchanged.

---

## 6. The sidecar patch

Repo: `C:\projects\poolframes\sidecar` (fork of
`forshtat/mempool-workshop-sidecar`).

### 6.1 Rule change — 2 files

`packages/executor/src/services/UserOpValidation/utils/validationPrefix.ts`

```ts
export const MAX_VERIFY_GAS = BigInt(100_000);
export const MAX_VERIFY_GAS_STAKED = BigInt(1_000_000);

export function validateStructuralRules(
  tx, prefix, maxVerifyGas: bigint = MAX_VERIFY_GAS
) { ... if (totalVerifyGas > maxVerifyGas) ... }
```

`packages/executor/src/services/UserOpValidation/validators/frameTx.ts`

```ts
let maxVerifyGas = MAX_VERIFY_GAS;
const payerFrame = prefix.frames.find(f => f.frameIndex === prefix.payerFrameIndex);
if (payerFrame) {
  const payer = resolveRoleAddr("payer", payerFrame.frame, tx.sender);
  const deposit = await this.stakingRegistryService.getDepositInfo(payer);
  const stake = await this.reputationService.checkStake({ addr: payer, ...deposit });
  if (stake.code === 0) maxVerifyGas = MAX_VERIFY_GAS_STAKED;
}
const structural = validateStructuralRules(tx, prefix, maxVerifyGas);
```

### 6.2 Config change — precompiles

`sidecar/config.json` must list **full 20-byte addresses**. The check is
`addr.toLowerCase()` against the array, and `addr` is a full address from
the trace, so `"0x08"` never matches:

```json
"precompiles": [
  "0x0000000000000000000000000000000000000001",
  ...
  "0x0000000000000000000000000000000000000008",
  ...
  "0x0000000000000000000000000000000000000011"
]
```

### 6.3 Windows-only shim — not a rule change

`@farcaster/rocksdb` has no Windows prebuild, so the sidecar cannot start on
this machine. Two in-memory LevelDB shims replace it:

- `packages/db/src/memoryDb.ts` (wired in `rocksDb.ts`, exported from `index.ts`)
- `packages/node/src/network/peers/memoryLevel.ts` (wired in `datastore-rocks.ts`)

Not durable. On Linux, discard them and use the real rocksdb.

---

## 7. Running it

### Build

```powershell
cd C:\projects\poolframes\sidecar
bun.cmd install
bun.cmd run build
bun.cmd run --filter @skandha/db build
bun.cmd run --filter @skandha/node build
```

### Start

```powershell
bun.cmd --bun ./packages/cli/bin/skandha.js standalone `
  --configFile ./config.json `
  --dataDir ./data `
  --api.port 14337 `
  --redirectRpc
```

Expected: `HTTP server listening at http://0.0.0.0:14337/rpc`.

`config.json`:

```json
{
  "entryPoints": ["0x00000000000000000000000000000000000000aa"],
  "canonicalEntryPoint": "0x00000000000000000000000000000000000000aa",
  "standardMempoolId": "QmcFZKUX9qoo3StwVycJTAhwdiqbEjcwNvQVK246p3z1rk",
  "supportedMempools": [{
    "mempoolId": "QmcFZKUX9qoo3StwVycJTAhwdiqbEjcwNvQVK246p3z1rk",
    "entryPoint": "0x00000000000000000000000000000000000000aa"
  }],
  "relayers": ["0x6c8573b7b40785b8b5e2480dd5342e483f5b91cf157da09c5eee59aa40cd0d5d"],
  "rpcEndpoint": "https://altmempool.forshtat.com",
  "rpcEndpointSubmit": "https://altmempool.forshtat.com",
  "stakingRegistryAddress": "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f",
  "minStake": 10000000000000000,
  "minUnstakeDelay": 0,
  "minSignerBalance": 0.1,
  "bundleInterval": 3000,
  "maxSubmitAttempts": 10,
  "precompiles": ["0x0000000000000000000000000000000000000001", "... full addresses ..."]
}
```

### Submit

```ts
const hash = await rpc(
  "http://localhost:14337/rpc",
  "eth_sendFrameTransaction",
  [toWire(tx)]
);
```

Canonical comparison: `eth_sendRawTransaction` on
`https://altmempool.forshtat.com` with `encodeRawFrameTx(tx)`.

---

## 8. Demo flow

Scripts live in `C:\projects\poolframes\workshop\src\steps\`.

| Step | Script | Shows |
|---|---|---|
| 1 | `zz_stake_check.ts` | paymaster staked (0.012 ETH, 86400s, no withdrawal) |
| 2 | `zz_quota_gate.ts` | deploy + stake + canonical reject + alt admit |
| 3 | `zz_external_read.ts` | own + third-party read; canonical reject, alt admit |
| 4 | `zz_external_policy.ts` | `exposure=1` → `"exposed"`; `credit=0` → `"no credit"` |
| 5 | `zz_external_concurrent.ts` | 5 users, one paymaster, all pending |
| 6 | `zz_budget_probe.ts` | public devnet: 200k/600k/1.5M/3M rejected at 100k |
| 7 | `zz_budget_probe_docs.ts` | same, on the literal documented endpoints |
| 8 | `zz_local_sidecar.ts` | local patch: 200k/600k/900k admitted and mined; 1.5M rejected at 1M |
| 9 | `zz_pairing_probe.ts` | pairing paymaster: canonical reject, public reject, local reject at 50k (gas) |
| 10 | `zz_pairing_gas.ts` | pairing at 90k: local admits and mines |
| 11 | `zz_preverify_probe.ts` | deploy + stake + first `pre_verify` attempt (state gas lesson) |
| 12 | `zz_preverify_run.ts` | local `pre_verify`: charge mines, `spent = 1`, `totalSpent = 1` |
| 13 | `zz_preverify_public.ts` | **stock public sidecar** admits the 99.8k `pre_verify` tx |
| 14 | `zz_preverify_caps.ts` | hybrid caps: `"user cap"` and `"global cap"` fire on-chain |

Run:

```powershell
cd C:\projects\poolframes\workshop
npm.cmd exec -- tsx src/steps/zz_local_sidecar.ts
```

### 60-second version

1. `getDepositInfo(0xaafb…)` → 0.012 ETH staked.
2. Same tx to `https://altmempool.forshtat.com` → `StorageReadNonSender`.
3. Same tx to `http://localhost:14337/rpc` → accepted, `OnChain`, public receipt.
4. `exposure[user] = 1` → rejected `"exposed"`.
5. Five users at once → five pending.
6. Pairing variant at 90k → admitted; at 50k → `"pairing"`; short-form
   precompile allowlist → `un-deployed contract address 0x08`.
7. `pre_verify` charge (99.8k, stock sidecar) → mined; `spent = 1`,
   `totalSpent` increments.
8. Second tx for the same user → `"user cap"`; third user over the global
   cap → `"global cap"`.

---

## 9. Proof matrix

| Claim | Environment | How proven | Result |
|---|---|---|---|
| Canonical rejects a custom paymaster reading its own storage | canonical ethrex | live submit + `ethrex_simulateFrameTransaction` | `StorageReadNonSender` |
| Staked own-storage read is admitted | stock public sidecar | live submit, mined | `0xb2aa2be4…`, block `0x62b68` |
| Staked third-party read is admitted | stock public sidecar | live submit, mined | `0x7585539a…`, block `0x62dbd` |
| The external read is live, not optimized away | stock public sidecar | `exposure=1` | revert `"exposed"` (`0x…6578706f736564`) |
| Own-storage policy is live | stock public sidecar | `credit=0` | revert `"no credit"` (`0x…6e6f20637265646974`) |
| Shared paymaster does not serialize | stock public sidecar | 5 users, one paymaster | 5/5 accepted, 5/5 pending |
| 100k applies even to a staked payer | stock public sidecar | probe 200k/600k/900k/1.5M | all rejected at 100k |
| 1M applies to a staked payer | local patched sidecar | probe 200k/600k/900k, 1.5M | accepted / rejected at 1M |
| Local admissions land on the public chain | local patch → public chain | 3 receipts | blocks `0x630d3`, `0x630d8`, `0x630dc` |
| Pairing `0x08` works on the client | ethrex client | `eth_call` | returns `0x…01` |
| 50k pay frame cannot cover pairing | local patched sidecar | live submit | revert `"pairing"` |
| Short-form `"0x08"` allowlist does not match | local patched sidecar (old config) | live submit | `payer accesses un-deployed contract address 0x08` |
| Full-address allowlist admits the pairing | local patched sidecar | live submit at 90k | `0x27b2e7ab…`, block `0x631c5` |
| `pre_verify` shape is recognized | stock public sidecar | 99.8k tx accepted | `0x5a6efb5b…`, block `0x63452` |
| Charge is written on-chain | stock public sidecar | `spent` / `totalSpent` after mining | `spent = 1`, `totalSpent` 1 → 2 |
| Per-user cap fires | stock public sidecar | second tx for the same user | revert `"user cap"` |
| Global cap fires | stock public sidecar | third user against cap 2 | revert `"global cap"` |
| Unused-gas refund / identity binding / per-entity budgets | — | not implemented | unproven |

---

## 10. Evidence log

| What | Hash / block |
|---|---|
| Staked wallet admits foreign read | `0x971c9655815cefe496cec0db55445ff4dc605f1349b30a58a057d3cf26051aa8` |
| Own-storage paymaster | `0xb2aa2be495546276fd8738ba2a435fdd7426e7bf2d4a464194d2c1b02953326a`, block `0x62b68` |
| External read | `0x7585539a38effeb0b9986107535fc5d8e28ccd723e2d8ad131eba6a72ee7910d`, block `0x62dbd` |
| Local 200k | `0x2781af6e47e96cb266d1a6ae2b17ef6c664baeee2aabcccc3563b660a3846da0`, block `0x630d3` |
| Local 600k | `0x59dd41a9e0363c18c1f019efbc5699eb90b725517c9dbe1dfff4599e4c5bf5dd`, block `0x630d8` |
| Local 900k | `0xf0ce3cc6633906e3fd5023fc7bb68c2562b834306d92f30e84337b46429ebcf2`, block `0x630dc` |
| Local 1.5M | rejected: `1532800 exceeds MAX_VERIFY_GAS 1000000` |
| Pairing at 50k | rejected: revert `"pairing"` (`0x08c379a0…70616972696e67`) |
| Pairing, short-form `"0x08"` allowlist | rejected: `payer accesses un-deployed contract address 0x08 with opcode STATICCALL` |
| Pairing at 90k, full-address allowlist | `0x27b2e7abc7a5a33b5c7f77b268cefa8a460248a37ef278c90bb509cf483c88ae`, block `0x631c5` |
| `pre_verify` charge, local | `0x52f2fffc201a97d0cc3c0da28a429f1a49d78e606946e7043ff59692be650525`, block `0x6343e` |
| `pre_verify` charge, stock public sidecar | `0x5a6efb5b4557470001195da2dce5dd302d1815677544bf43bdd3d756a6cdc7fd`, block `0x63452` |
| Cap test, A tx1 (spends 1) | `0x7bb1cfe51d0dce386117a8b007d0ebf0164e1f58d76c49cb0b7b3f17511679c8` |
| Cap test, A tx2 | rejected `"user cap"` (`0x…7573657220636170`) |
| Cap test, B tx1 (total 2) | `0xf3571763ee3e9721245e10b3a21b5cc92187f61c41b23a4185da04b7dccac7e2` |
| Cap test, C tx1 | rejected `"global cap"` (`0x…676c6f62616c20636170`) |

---

## 11. Limitations and next steps

1. **The quota is consumed — by `QuotaPayPreVerify`.** The old `QuotaPayExt`
   (`credit >= 1`) is a gate and remains in the repo only as evidence.
   `QuotaPayPreVerify.charge()` runs in a `pre_verify` frame, increments
   `spent[user]` and `totalSpent`, and the pay frame refuses to approve
   without the matching `chargedHash`. Proven on the stock public sidecar.
2. **Admission is not reservation.** No mempool reserves capacity for a
   pending tx, and none can. The enforcement point is **inclusion**, where
   `charge()` is atomic with the transaction. A mempool may over-admit; the
   chain rejects the excess. Do not claim a hard limit at admission.
3. **Identity is resettable.** `spent` is keyed by `tx.sender`; a fresh
   wallet is a fresh quota. Eligibility has to be a sponsor-issued
   credential (allowlist, signed voucher, or a nullifier design), not the
   address.
4. **Public and patched are different environments.** The core hybrid fits
   the stock 100k (99.8k) and was proven there. The 1M and the pairing
   admission are local-patch results. Do not say the public sidecar supports
   1M.
5. **No unused-gas refund.** `charge()` takes a fixed `txFee`; a real
   implementation would charge `MAX_COST` and refund in a post frame.
6. **Some evidence is prototype-grade.** Replacement/eviction reputation
   accounting is unreliable per the authors, and the 1M cap is a local
   approximation, not `BUDGET-010` per-entity compliance.
7. **Precompile config gotcha.** Use full 20-byte addresses; short forms
   silently never match. Worth reporting upstream.
8. **Durability.** The Windows DB shim is in-memory; restarting the sidecar
   loses the mempool.

### Claims to avoid

- "QuotaPay enforces a budget" — say **`QuotaPayPreVerify`** enforces it;
  the old `QuotaPayExt` does not.
- "The mempool guarantees the limit." It does not; inclusion does.
- "Staked entities get 1M on the public devnet." They do not; 1M is local.
- "This is ERC-8421-compliant." The budget rule is approximated and the
  reputation behavior is known-unreliable.
- "Credit is per user." It is per address, which is not the same thing.
- "The global cap is enforced before admission." It is enforced at
  inclusion.

---

## 12. Complete change set

### 12.1 Tracked-file diff

The verbatim diff of every tracked change is in
`C:\projects\poolframes\sidecar-changes.diff` (6 files, `git diff` output).
Abridged:

```diff
diff --git a/bun.lock b/bun.lock
@@
   "lockfileVersion": 1,
+  "configVersion": 0,

diff --git a/packages/db/src/index.ts b/packages/db/src/index.ts
@@
 export * from "./rocksDb.js";
 export * from "./localDb.js";
+export * from "./memoryDb.js";
 export * from "./schema.js";

diff --git a/packages/db/src/rocksDb.ts b/packages/db/src/rocksDb.ts
@@
-import rocks from "@farcaster/rocksdb";
+// Local-test shim: @farcaster/rocksdb has no Windows prebuild.
+import rocks, { MemoryDb } from "./memoryDb.js";
@@
-  private db: rocks;
+  private db: MemoryDb;

diff --git a/packages/executor/.../utils/validationPrefix.ts
@@
 export const MAX_VERIFY_GAS = BigInt(100_000);
+
+export const MAX_VERIFY_GAS_STAKED = BigInt(1_000_000);
@@
-export function validateStructuralRules(tx, prefix): StructuralRulesResult {
+export function validateStructuralRules(
+  tx,
+  prefix,
+  maxVerifyGas: bigint = MAX_VERIFY_GAS
+): StructuralRulesResult {
@@
-  if (totalVerifyGas > MAX_VERIFY_GAS) {
+  if (totalVerifyGas > maxVerifyGas) {
     return {
       valid: false,
-      reason: `... exceeds MAX_VERIFY_GAS ${MAX_VERIFY_GAS}`,
+      reason: `... exceeds MAX_VERIFY_GAS ${maxVerifyGas}`,
     };
   }

diff --git a/packages/executor/.../validators/frameTx.ts
@@
 import {
+  MAX_VERIFY_GAS,
+  MAX_VERIFY_GAS_STAKED,
   recognizeValidationPrefix,
   validateStructuralRules,
   ValidationPrefixMatch,
 } from "../utils/validationPrefix.js";
@@
-    const structural = validateStructuralRules(tx, prefix);
+    let maxVerifyGas = MAX_VERIFY_GAS;
+    const payerFrame = prefix.frames.find(
+      (f) => f.frameIndex === prefix.payerFrameIndex
+    );
+    if (payerFrame) {
+      const payer = resolveRoleAddr("payer", payerFrame.frame, tx.sender);
+      const deposit = await this.stakingRegistryService.getDepositInfo(payer);
+      const stake = await this.reputationService.checkStake({
+        addr: payer,
+        stake: deposit.stake,
+        unstakeDelaySec: deposit.unstakeDelaySec,
+        withdrawTime: deposit.withdrawTime,
+      });
+      if (stake.code === 0) {
+        maxVerifyGas = MAX_VERIFY_GAS_STAKED;
+      }
+    }
+
+    const structural = validateStructuralRules(tx, prefix, maxVerifyGas);

diff --git a/packages/node/.../datastore-rocks.ts
@@
-import rocks from "@farcaster/rocksdb";
+import { MemoryDb, createMemoryDb } from "./memoryLevel.js";
@@
-  db: rocks;
+  db: MemoryDb;
@@
-  constructor(path: string | rocks, opts: AbstractOpenOptions = {}) {
+  constructor(path: string | MemoryDb, opts: AbstractOpenOptions = {}) {
@@
-    this.db = typeof path === "string" ? rocks(path) : path;
+    this.db = typeof path === "string" ? createMemoryDb(path) : path;
@@
-            return resolve(value as Uint8Array);
+            return resolve(value as unknown as Uint8Array);
@@
-    const iterator = this.db.iterator(iteratorOpts);
+    const iterator = this.db.iterator(iteratorOpts) as any;
```

### 12.2 New files

`packages/db/src/memoryDb.ts` — a Map-backed drop-in for the subset
`RocksDbController` uses (`get`, `put`, `del`, `getMany`, `open`, `close`,
`batch`, `iterator`).

`packages/node/src/network/peers/memoryLevel.ts` — the same shim for the P2P
`LevelDatastore`.

### 12.3 Config (not tracked)

`sidecar/config.json` — local node config, including the full-address
`precompiles` array. `.gitignore`d.

### 12.4 Contract files (project, not sidecar)

All project contracts live in `C:\projects\QuotaPay\contracts\`:

- `contracts/QuotaPayPreVerify.sol` (current)
- `contracts/QuotaPayExt.sol` (first gate, superseded)
- `contracts/QuotaPaymaster.sol` (first paymaster, own-storage gate)
- `contracts/ExposureController.sol`
- `contracts/QuotaPayPairing.sol`

---

## 13. Verification commands

```powershell
# 1. Sidecar is up and on the right chain
curl -s -X POST http://localhost:14337/rpc `
  -H 'content-type: application/json' `
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# -> {"result":"0x539"}

# 2. Paymaster is staked
#    (workshop/src/steps/zz_stake_check.ts)
npm.cmd exec -- tsx src/steps/zz_stake_check.ts

# 3. Budget matrix (public vs local)
npm.cmd exec -- tsx src/steps/zz_budget_probe_docs.ts
npm.cmd exec -- tsx src/steps/zz_local_sidecar.ts

# 4. Policy reverts
npm.cmd exec -- tsx src/steps/zz_external_policy.ts

# 5. Pairing
npm.cmd exec -- tsx src/steps/zz_pairing_probe.ts
npm.cmd exec -- tsx src/steps/zz_pairing_gas.ts

# 6. pre_verify: charge, then caps
npm.cmd exec -- tsx src/steps/zz_preverify_run.ts
npm.cmd exec -- tsx src/steps/zz_preverify_public.ts
npm.cmd exec -- tsx src/steps/zz_preverify_caps.ts
```

---

## 14. File map

```
C:\projects\QuotaPay\
├── QuotaPay.md                      this document
├── build\                           compiled artifacts
└── contracts\                       Solidity sources
    ├── QuotaPayPreVerify.sol        current: per-user + global charge
    ├── QuotaPayExt.sol              first gate (superseded)
    ├── QuotaPaymaster.sol           first paymaster (own-storage gate)
    ├── QuotaPayPairing.sol          pairing precompile probe
    └── ExposureController.sol       third-party policy contract

C:\projects\poolframes\
├── sidecar-changes.diff             verbatim sidecar patch
├── sidecar\                         patched sidecar
│   ├── config.json                  local node config (gitignored)
│   ├── packages\db\src\memoryDb.ts  Windows shim
│   └── packages\node\src\network\peers\memoryLevel.ts  Windows shim
└── workshop\                        tx construction + tests
    ├── .workshop-state.json         participant key, deployed addresses
    ├── contracts\src\               workshop tutorial contracts only
    ├── build\preverify\             pre_verify artifact
    ├── build\ext\                   QuotaPayExt artifact
    ├── build\pairing\               pairing artifact
    └── src\steps\                   zz_* demo scripts
```
