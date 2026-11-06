# ZK membership paymaster

This is the in-progress ZK path for QuotaPay. It replaces the blind-RSA
credential with a **Groth16 membership proof**, while keeping the existing
blind-token paymaster in place as a fallback until the UI is switched over.

## What the proof says

> “I know a secret whose leaf is in the Poseidon Merkle tree with this root,
> for this paymaster and chain, and my nullifier for this epoch is fresh.”

The paymaster learns only:

- `tx.sender` — a rotating session key;
- the per-epoch identity nullifier `Poseidon(secret, epoch)`;
- the session binding value `Poseidon(secret, epoch, sessionKey)`;
- the public statement: `root`, `epoch`, `paymaster`, `chainId`, `sessionKey`.

It never learns which leaf the sender owns. The transaction’s normal secp256k1
signature covers the frame data that contains the proof, so the proof is bound
to the transaction without also committing to `SIG_HASH` (which would be
circular).

Public inputs, in order:

```text
[root, epoch, paymaster, chainId, sessionKey, identityNullifier, sessionNullifier]
```

`identityNullifier` is the value the contract burns. `sessionNullifier` is only
a binding value: Groth16 binds only public inputs that appear in a constraint,
so without it a proof could be replayed under a different `tx.sender`.

## Files

| Path | What it is |
|---|---|
| `circuits/Membership.circom` | Poseidon membership + nullifier circuit, depth 20 |
| `contracts/zk/Groth16Verifier.sol` | snarkjs-generated BN254 verifier |
| `contracts/ZkPaymaster.sol` | EIP-8141 paymaster: verify proof, burn nullifier, approve payment |
| `lib/zk/tree.mjs` | Sparse Poseidon Merkle tree + witness helper |
| `scripts/zk-setup.mjs` | Compile circuit, devnet ptau/zkey, export verifier |
| `scripts/zk-proof.mjs` | Build a witness, prove, verify |
| `scripts/zk-bench.mjs` | Deploy verifier on ganache, measure `verifyProof` gas |
| `scripts/deploy-zk.mjs` | Deploy verifier + paymaster, build demo root, stake, fund |
| `scripts/zk-sponsor.mjs` | Prove + build/sign/submit the sponsored frame tx |
| `scripts/zk-publish.mjs` | Copy wasm/zkey to `public/zk`, write the demo credential |
| `scripts/zk-admin.mjs` | Add/remove leaf commitments, emit paths, update root/epoch |
| `lib/zk/client.ts` | Browser witness/nullifier/prover helpers (`poseidon-lite` + `snarkjs`) |
| `app/pay/page.tsx` | `/pay` page with the ZK panel (blind-token path still available) |
| `components/zk-credential-form.tsx` | Paste/load credential JSON, show bound nullifiers |
| `components/zk-payment-panel.tsx` | Prove → build → sign → submit, with live root/epoch checks |
| `test/t12-zk-verifier.test.mjs` | Fixture proof verifies; tampering fails; gas guard |
| `test/t13-zk-paymaster.test.mjs` | Config, custody, entrypoint gates |
| `test/t14-zk-client.test.mjs` | Browser witness/nullifier matches the circuit proof |

## Gas: why the staked cap is 500k

The old `1_000_000` was a placeholder. The measured numbers on this tree:

| Measurement | Gas |
|---|---|
| `verifyProof` estimate (7 public inputs) | **258,663** |
| `verifyProof` actual `gasUsed` (ganache) | **255,928** |
| Groth16 pairing component (4 pairs, EIP-1108) | 181,000 |
| Public-input MSM (7 × `ecMul` + `ecAdd`) | ~43,000 |
| Verifier calldata/assembly overhead | ~30,000 |
| **Charge frame on-chain (ethrex, block `0x41e`)** | **291,546 exec / 293,504 state** |

The declared validation prefix for the ZK path:

```text
15,000  VERIFY(EXECUTION) on session key
330,000 ZK charge frame (declared limit; verifier ~256k + margin)
12,000  VERIFY(PAYMENT)
 2,800  secp256k1 signature
-------
359,800  declared prefix
```

`MAX_VERIFY_GAS_STAKED = 500_000` leaves ~140k (39%) headroom. The old 1M was
~2.8× the measured need. The sidecar patch now uses 500k with this rationale.

**On-chain Groth16 verification is now proven.** Via the local sidecar relay
(500k staked cap + full precompile list), a ZK sponsored tx mined on the
public chain: `0x0ccb70cc…` in block `0x41e`, payer = `ZkPaymaster`, receipt
verified on the public RPC. The on-chain charge frame used 291,546 execution
gas (vs 255,928 on ganache). A replay with the same credential is refused
before proving (`identity nullifier is already spent`).

**The stock public mempool still blocks it — twice.** Probed 2026-11-06, both
`altmempool.forshtat.com/rpc` and `altmempoolgateway.forshtat.com/rpc`:

1. Gas: `prefix gas budget exceeded: 617800 > 100000 (MAX_VERIFY_GAS)` — the
   100k staked cap is still enforced. The limit was **not** removed.
2. Precompiles: even if the cap were lifted, the paymaster is rejected with
   `payer accesses un-deployed contract address 0x06` (`ecAdd`; `ecMul`
   `0x07` and pairing `0x08` would follow). The public allowlist does not
   include the BN254 precompiles.

Both are host-side config: raise the staked cap to the measured 500k and add
`0x06`/`0x07`/`0x08` to the precompile allowlist. Until then the working path
is the local sidecar relay, which lands on the same public chain.

**snarkjs verifiers need a patch for validation.** The generated code forwards
precompile gas with `sub(gas(), 2000)`, but `GAS` is a banned opcode in the
validation prefix (the charge frame runs as the payer), so the stock output is
rejected with `payer uses banned opcode: GAS`. `scripts/zk-setup.mjs` patches
the three `staticcall`s to fixed EIP-1108 costs (30k for `ecMul`/`ecAdd`,
200k for the 4-pair check). Consumption is unchanged — precompiles charge
fixed costs, not the forwarded amount. T12 re-verifies the patched bytecode
(258,663 estimate, still under the 315k guard).

**Stock 100k cannot fit an on-chain Groth16 verifier.** The pairing check alone
is 181k. A 100k deployment would need off-chain verification with a bonded
relayer/attestation, or a protocol-native verifier precompile — neither is
“actual ZK on-chain.”

Reproduce:

```powershell
npm run zk:proof     # generate build/zk/proof.json + public.json
npm run zk:bench     # deploy verifier on ganache, print estimate/gasUsed
npm test             # T12 asserts the fixture verifies and gas < 315k
```

## Browser flow (`/pay`)

```powershell
npm run zk:setup      # circuit + devnet zkey + verifier
npm run zk:deploy     # verifier + ZkPaymaster, root, stake, fund
npm run zk:publish    # wasm/zkey -> public/zk + demo credential
npm run dev
```

Open `/pay`. The page:

1. shows the session key that will be bound into the proof;
2. loads a credential JSON (or the committed demo credential) into
   localStorage;
3. computes `identityNullifier` / `sessionNullifier` with `poseidon-lite` in
   the tab;
4. generates the Groth16 proof in the tab with `snarkjs` (wasm + zkey from
   `public/zk`);
5. checks the proof's public signals against the credential, builds the
   4-frame tx with a 330k charge-frame budget, signs with the session key, and
   submits.

`public/zk/` is tracked: it contains a 2.2 MB wasm, a 5.4 MB zkey, a
verification key, and the demo credential. Regenerate it with `zk:setup` +
`zk:publish` after changing the circuit or key. The CLI equivalent is
`npm run zk:sponsor`.

Browser check: `npx playwright test e2e/zk.spec.ts` loads the fixture
credential, generates the proof in Chromium, and builds the 4-frame tx. It
skips unless `npm run zk:publish` has been run.

## Authorized-set admin

`deployments/zk-leaves.json` is the canonical, public list of leaf
commitments. It contains no secrets:

```json
{ "chainId": 1337, "paymaster": "0x…", "epoch": "0", "leaves": ["…"] }
```

The employee generates `secret` and sends only
`leaf = Poseidon(secret, paymaster, chainId)` to the admin. The admin runs:

```powershell
npm run zk:admin -- show
npm run zk:admin -- add <leaf>              # offline; writes the file
npm run zk:admin -- add <leaf> --onchain    # also calls setRoot(root)
npm run zk:admin -- remove --index 2        # zeroes the slot, keeps indices
npm run zk:admin -- remove --index 2 --onchain
npm run zk:admin -- paths                   # public Merkle paths per leaf
npm run zk:admin -- epoch 1
npm run zk:admin -- deposit 0.05
npm run zk:admin -- stake 0.012 86400
```

`paths` prints:

```json
[{
  "index": 0,
  "leaf": "…",
  "root": "…",
  "paymaster": "0x…",
  "epoch": "0",
  "chainId": 1337,
  "pathElements": ["…"],
  "pathIndices": [0]
}]
```

Send that path to the employee; they add only their own `secret` and paste the
result into the `/pay` credential form. Removal sets the slot to `0` instead of splicing, so
other employees' indices and paths stay stable until the next root update.
Changing the root invalidates every outstanding path; redistribute after each
`add`/`remove`.

## Why this validation is safe for a public mempool

The objection, stated plainly: mempool nodes and builders simulate the
validation prefix for free, so a big verify frame looks like unpaid work and a
DoS vector. The answer has four parts: what validation actually costs, the
griefing math, why builders still get paid, and why this needs no per-contract
whitelist.

### 1. Gas is not the node's cost; deterministic CPU is

EVM gas prices *consensus execution*. A mempool node simulating admission pays
only CPU, and for this verifier the CPU is almost entirely inside native
precompiles (`ecAdd`/`ecMul`/`ecPairing`), not the EVM interpreter. Measured:

- on-chain charge frame: **291,546 execution gas**, single-digit milliseconds;
- ~181k of that is the 4-pair check, ~43k the public-input MSM, the rest
  calldata decode and journaling.

Frequency is bounded: once per admission, re-simulation only when a dependency
changes, plus the builder's own candidate simulation. Results are keyed by tx
hash, so an invalid proof simulates exactly once per node, then drops.
Bandwidth per spam attempt is 581 bytes; storage per pending tx is one entry
under the existing per-sender pending cap.

### 2. The griefing math, and what caps should meter

Getting simulated requires a well-formed tx with a **valid secp256k1
signature** — invalid signatures drop before any EVM runs — plus bandwidth and
one sender pending slot (one pending tx per sender). The node's cost per spam
attempt is one deterministic simulation (~ms), with **no amplification**: our
validation reads only tx fields, the sender, the paymaster's own storage, and
precompiles. No shared mutable slot can be flipped to invalidate thousands of
pending txs at once. The only cross-tx dependencies are the admin-controlled
`root`/`epoch` (human timescales, transparent on-chain events) and a
credential's own nullifier spend (self-inflicted).

The honest version of the "10M gas" question: 10M gas of *arbitrary
state-touching EVM* should indeed stay capped — that is what caps are for.
But gas is the wrong meter for precompile-dominated verification. 10M gas of
pairings is still milliseconds of CPU; the real risks are (a) CPU per
admission, (b) state-dependency blast radius, (c) bandwidth. Our class passes
all three with room: ~300k deterministic CPU, zero shared mutable reads, 581
bytes. Demanding it fit 100k prices out all pairing-based privacy — the same
literature the EIP reviewers cite (RAILGUN one-note spend 212k, withdrawal
236k) — while buying no DoS protection, because a 100k frame of pathological
EVM (memory expansion, cold reads) costs a node more CPU than our 300k of
precompiles.

### 3. Builders are paid; invalid work is evicted, not repeated

Admission simulation is the only unpaid work, and it is ms-scale. Everything
after `APPROVE(PAYMENT)` is covered: the payer escrows `max_cost` and builders
collect fees from included txs exactly as today. An invalid proof reverts the
`VERIFY` frame, so the tx is invalid, never included, the sponsor is never
charged, and the builder wastes nothing beyond the one admission simulation.
Prefixes that never approve are evicted rather than re-run forever (the
producer re-execution bound in the EIP-8141 mempool discussion). FOCIL
inclusion lists treat ours as an ordinary frame tx — no special handling.

### 4. No whitelist: this fits the general expansive-tier ruleset

The prefix shape — `[VERIFY(EXECUTION)` on sender, `DEFAULT` pre_verify on
paymaster, `VERIFY(PAYMENT)`, `SENDER]` — is the ERC-8421 pre_verify pattern.
Any node running the opt-in expansive ruleset admits this *class*. No
code-hash exemption is requested (unlike the canonical-pool proposals) and no
per-contract allowlist: `0x06`/`0x07`/`0x08` are protocol precompiles,
permissionless by construction. Trace compliance of the current build:

- staked payer (0.012 ETH ≥ 0.01 minimum), declared prefix ~346k ≤ 500k cap;
- reads: tx fields + sender + paymaster's **own** storage (root, epoch,
  nullifiers) — the staked-entity own-storage case, no third-party mutable
  reads;
- writes: own slots only, inside the pre_verify frame (its purpose);
- external calls: one `STATICCALL` to a deployed, non-delegated verifier whose
  trace reads no storage and — post-patch — uses no banned opcodes (`GAS`
  forwarding replaced with fixed EIP-1108 costs). Caveat: the **paymaster** is
  not GAS-free; its `txparam` helper calls and external verifier call still
  compile to `GAS` (5 opcodes in `ZkPaymaster`, 6 in `DaoVotePaymaster`). A
  ruleset that bans `GAS` anywhere in the prefix will reject the charge frame
  until those helpers are rewritten;
- one disclosed judgment call: a `BALANCE` read enforcing the withdrawal
  reserve, stricter than the protocol's own `APPROVE` solvency check. If a
  ruleset bans `BALANCE` even for staked payers, that line drops out and
  `APPROVE` still reverts on insufficient escrow.

Reproduce the cap evidence: `node scripts/probe-cap.mjs --rpc <url>
--paymaster <addr> --execution 600000` prints the enforced cap in the
rejection. As of 2026-11-06 both public endpoints still answer
`prefix gas budget exceeded: 617800 > 100000 (MAX_VERIFY_GAS)` and block
`0x06` — the limit removal has not landed where it can be observed. The
working public-mempool option today is the local ERC-8421 relay (500k +
precompiles), which lands on the same public chain (mined `0x0ccb70cc…`,
block `0x41e`).

### CROPS assessment

- **Censorship resistance.** Permissionless submission over standard EIP-8141
  RPC; no bundler/relayer monopoly; no per-contract gate — any ERC-8421 node
  admits the class. Disclosed caveat: *eligibility* (the authorized set) is
  admin-gated at the application layer. That is a sponsor choosing who spends
  its own money, with rotation/removal transparent on-chain
  (`RootSet`/`EpochSet`), not protocol censorship of anyone else's users.
- **Openness.** Circuit, contracts, scripts, and sidecar patch are in-repo and
  MIT — except the snarkjs-generated verifier (GPL-3.0, disclosed here). No
  proprietary prover, no hosted dependency required to use it.
- **Privacy.** The point of the design: membership proven, identity hidden;
  rotating session keys; per-epoch nullifiers unlinkable across epochs;
  optional anon-rpc transport. Residual disclosure — recipient and amount stay
  public — is stated, not hidden.
- **Security.** Groth16 soundness; the devnet ceremony is single-contribution
  (production needs a real MPC or universal setup — stated); the circuit is
  unaudited (stated). No fund-loss path: an invalid proof makes an invalid tx,
  which is never included, so the sponsor is never charged. Replay is
  impossible (nullifier burn + `chargedTx[sigHash]` binding); front-running a
  proof cannot redirect funds (session-key binding burns the attacker's
  chance along with the nullifier — first inclusion wins, and only the session
  key holder can sign that tx).

## Nullifier model

One sponsored transaction per credential per epoch:

```text
nullifier = Poseidon(secret, epoch)
```

`charge()` reverts if `usedNullifier[nullifier]` is set. Incrementing `epoch`
(admin-only) invalidates all outstanding proofs. The circuit binds the leaf to
`paymaster` and `chainId`, so a root shared across instances/chains does not
grant cross-instance access.

## Trust model

- **Admin:** maintains the authorized-set root on-chain (`setRoot`). The tree
  itself is computed off-chain from the authorized leaves; the admin can reset
  the root and rotate the epoch. The admin is trusted for eligibility.
- **Issuer/employee:** in production the employee generates the secret and
  sends only `leaf = Poseidon(secret, paymaster, chainId)` to the admin; the
  admin never sees the secret. The demo deploy script generates both for
  convenience and writes the secret to `.env.local` — never do that in
  production.
- **Trusted setup:** the devnet setup is a single local contribution with fixed
  entropy (`scripts/zk-setup.mjs`). Do not use it for value-bearing
  deployments. A production deployment needs a real multi-party ceremony or a
  universal-setup proof system.
- **Not full payment privacy:** the recipient and value remain public in the
  `SENDER` frame. This milestone hides *which authorized member* is paying, not
  *what* they are paying. Hiding recipient/amount needs a shielded pool.

## Limitations / next steps

- The `/pay` page carries the browser prover + submit panel alongside the
  blind-token path. The CLI path is `npm run zk:deploy` then `npm run zk:sponsor`.
- One payment per epoch. Multiple payments need a sequential counter or a
  different credential design.
- `TXPARAM.MAX_COST` is an ethrex extension (`0x06`). `charge()` now fails
  closed (`maxCost=0`) if the extension returns zero, so a chain without it
  cannot silently bypass the sponsor cap. A chain-specific build can compute
  the bound from frame gas limits and `MAX_FEE` instead.
- Paymaster gas tanks are topped up with a value-bearing empty call. Do not add
  `receive()` to either paymaster: the entrypoint's value-free empty call is the
  pay frame and must keep reaching the fallback.
- The verifier call is external, so the paymaster pays a cold `CALL` (~2.6k)
  on top of the verifier gas (~256k Membership, ~272k DAO). This is included
  in the 330k frame budget.
- The verifier is GAS-free after the patch, but both paymasters still emit
  `GAS` in their own helper/external calls (see the trace caveat above). This
  is the remaining gap for a strict validation ruleset.
- `ZkPaymaster` is not audited. EIP-8141/ERC-8421 are drafts and the devnet
  differs from the EIP text.
- The snarkjs-generated verifier carries `GPL-3.0`; check license compatibility
  before distributing a combined work. The rest of this repo is MIT.
