# QuotaPay — Adversarial Test Report

10 tests, 13 distinct prongs. 7 pass on the original implementation; 3 fail,
exposing real defects. 10/10 mutants killed. 3/3 failing tests flip to pass
under minimal fixes. Suite committed as `69d8805`; this report and the
verdict-parsing fix to the runners follow in the same series.

Harness: `solc-js 0.8.28` (cancun, optimizer 200 runs) + in-process `ganache`
+ `ethers v6`, run with `node --test test/*.test.mjs`. No devnet, no private
keys, no network. Compile cache in `test/helpers/.artifacts-cache.json`
(hash-keyed; ignored by git).

## 1. Execution wall (read first)

`charge()` / `fallback()` execute EIP-8141 introspection opcodes
(`TXPARAM`, `APPROVE`, …) via `HegotaSupport` helpers. On any standard EVM
these are invalid opcodes, and `charge()` additionally requires
`msg.sender == 0xaa`. Consequence, verified empirically (T08):

- Reachable on a vanilla EVM: deployment, all admin/owner config, enrollment,
  EIP-712 `enrollSigned` (plain `ecrecover`), revocation, withdrawals,
  factory, views, `deposit`/`withdraw`/`stake` forwarding, and every
  `require` that fires *before* the first frame-context opcode.
- NOT reachable: cap arithmetic, quota increments, period rolls, solvency
  enforcement inside `charge()`, the `chargedHash` binding, and `approve()`.
  These need ethrex frame context + a `0xaa` caller and are listed under
  §6 as uncovered, not as tested.

A consequence for verdict honesty: `spent`/`totalSpent`/`companySpent` can
only grow via `charge()`, so any invariant over nonzero spend is
statically identified but not dynamically exercised here (noted per case).

## 2. Defects exposed (failing on the original implementation)

### D1 — Rotation does not revoke; reassignment orphans (T01, both prongs fail)
`CompanyPaymaster._enroll` only adds mappings, never clears them.
After rotating beneficiary B1 from W1 to W2, W1 stays authorized and keeps
spending the shared allowance — the key-compromise rotation scenario stays
compromised. Reassigning W3 from B1 to B2 leaves B1 active with no wallet.
Severity: medium-high. Fix-validated (F1): tracking `beneficiaryWallet` and
clearing stale links flips T01 to 3/3 pass.

### D2 — Authorized does not imply chargeable (T02, both prongs fail)
`enroll()` accepts `perPeriodLimit = 0` (or `< creditPerTx`) while
`isAuthorized` reports true, yet `charge()` on such a wallet must always
revert (`0 + creditPerTx <= limit` is false — decided by fully observable
state). Severity: medium (view/state mismatch; admin footgun, no theft).
Fix-validated (F2): enforcing `perPeriodLimit >= creditPerTx` in the
authorization read flips T02 to pass. Whether to enforce at enroll-time,
view-time, or both is a design decision.

### D3 — Configuration can silently brick the quota or void accounting (T06, 5/5 prongs fail)
No lower-bound validation: `setTxFee(0)` (accounting stays 0 while real ETH
is sponsored), `setCaps(0,0)`, zero-value construction, `setGlobalCreditLimit(0)`,
and value-less `createCompany` with `maxSponsorCost > 0` (company born
insolvent) all succeed. Severity: medium (trusted-owner error class, but
D3a silently decouples accounting from reality). Spec status: AMBIGUOUS —
fee-free operation may be intentional; if so the accounting divergence
needs documenting instead. Fix-validated (F3): `> 0` guards on fee/caps/
limits plus a factory funding check flip T06 to pass. No constructor-level
funding check is proposed for direct deployment (would break the legitimate
deploy-then-fund pattern) — enforcement belongs on the factory path.

## 3. The 10 selected tests

| # | Test | Invariant | Original | Kills |
|---|---|---|---|---|
| T01 | rotation unlink | re-enrollment clears stale wallet/beneficiary links | FAIL (D1) | fix F1 flips to pass |
| T02 | dead beneficiary | authorized ⇒ chargeable | FAIL (D2) | fix F2 flips to pass |
| T03 | signed enrollment | single-use, instance-bound, malleability-proof EIP-712 | pass | M2 (replay), M3 (high-s) |
| T04 | withdrawal lifecycle | one pending request, delay-gated, exact payout, release | pass | M4 (no release), M9 (no delay) |
| T05 | factory isolation | unique id, auth-gated creation, independent balance/limits | pass | M5 (dup), M6 (open create) |
| T06 | config liveness | config preserves chargeability / accounting integrity | FAIL (D3) | fix F3 flips to pass |
| T07 | access gates | owner/admin-only mutation, zero-address rejection | pass | M1 (gate removed) |
| T08 | entrypoint gate | `charge()` only via `0xaa`; fallback needs frame context | pass | M7 (gate removed → reason changes) |
| T09 | revocation | revoke ⇒ unauthorized; beneficiary-revoke dominates re-activation | pass | M8 (`walletActive` ignored) |
| T10 | custody | exact deposit/withdraw, zero/over-balance rejection, stake forwarding | pass | M10 (zero-address allowed) |

Why existing coverage misses all of these: the repo had no unit tests; the
devnet demo scripts only walk happy paths (single enrollments, sane limits,
funded companies, no invalid transitions, no negative cases).

## 4. Mutation results (all KILLED, corrected parsing)

M1 remove `onlyOwner` on `setCredit` → T07 fails. M2 drop
`usedEnrollment[digest] = true` → T03 replay prong fails. M3 drop high-s
rejection → T03 malleability prong fails. M4 drop `pendingWithdrawals -=`
on execute → T04 accounting fails. M5 drop `"company exists"` → T05 dup
prong fails. M6 drop creation authorization → T05 unauthorized prong fails.
M7 drop entrypoint `require` → T08 reason assertion fails (falls through to
the invalid-opcode revert). M8 ignore `walletActive` in `isAuthorized` →
T09 fails. M9 drop `"not unlocked"` → T04 early-execute prong fails. M10
drop `"zero address"` → T10 burn-to-zero prong fails (send succeeds).

Process note: the first batch run reported 10/10 KILLED under a broken
verdict regex (`/# pass 1/` never matches `node:test` output); the runners
were fixed to parse the `pass N` / `fail N` summary and the batch was
re-run. The numbers above are from the corrected run. Runners:
`scripts/mutate.mjs`, `scripts/fixvalidate.mjs`.

## 5. Statically identified but not dynamically covered

- `setCaps` checks `globalCap >= totalSpent` but nothing per-user: lowering
  `userCap` below an existing `spent[user]` bricks that user until
  `resetSpent`. Unexercisable here (`spent` unreachable without frame
  context); asymmetric with the global-side check.
- Ordering inconsistency: `CompanyPaymaster.charge` checks idempotency
  *after* quota/solvency, `QuotaPayPreVerify.charge` *before* — same
  duplicate transaction reverts with different reasons across contracts.
- Legacy `QuotaPaymaster.charge` increments `spent` with no cap check while
  the fallback gates on `spent < cap` *after* the increment — off-by-one
  boundary semantics; superseded contract, noted only.
- `resetSpent` / `resetTotalSpent` are independent: the
  `totalSpent == Σ spent` correspondence can be broken by partial resets,
  silently weakening the global cap. Unexercisable dynamically (counters
  stay 0 here).
- Single exit path: all CompanyPaymaster ETH leaves via `executeWithdrawal`
  to `treasury`; a treasury that starts reverting bricks withdrawals (no
  escape hatch). Fail-closed, so low severity, but availability-relevant.
- `stake()` is permissionless on `QuotaPayPreVerify` (anyone can stake, and
  chooses the unstake-delay parameter); `onlyAdmin` on `CompanyPaymaster`.
  Funds land keyed to the paymaster either way; the delay-parameter choice
  by a stranger is worth a conscious sign-off.

## 6. Uncovered invariants / trust assumptions (need ethrex + `0xaa`)

Charge-cap arithmetic, `chargedHash`↔`SIG_HASH` binding (assumes the
protocol binds sender + tx contents into `SIG_HASH`), `approve()` scoping,
period-roll timing, admission-vs-inclusion over-admission (documented
by-design in `QuotaPay.md`), mempool/DoS properties, cross-contract storage
reads, and timestamp edge behavior.

## 7. How to run

```
npm.cmd install
node --test test/t01-rotation-unlink.test.mjs ... (or all ten files)
node scripts/mutate.mjs all        # expect 10/10 KILLED, contracts restored
node scripts/fixvalidate.mjs all   # expect 3/3 PASS-WITH-FIX, contracts restored
```

Expected on the current implementation: T01, T02, T06 fail (defects D1–D3);
all others pass.
