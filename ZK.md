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
| `app/zk/page.tsx` | Parallel `/zk` payment page (blind-token `/pay` untouched) |
| `components/zk-credential-form.tsx` | Paste/load credential JSON, show bound nullifiers |
| `components/zk-payment-panel.tsx` | Prove → build → sign → submit, with live root/epoch checks |
| `test/t12-zk-verifier.test.mjs` | Fixture proof verifies; tampering fails; gas guard |
| `test/t13-zk-paymaster.test.mjs` | Config, custody, entrypoint gates |
| `test/t14-zk-client.test.mjs` | Browser witness/nullifier matches the circuit proof |

## Gas: why the staked cap is 500k

The old `1_000_000` was a placeholder. The measured numbers on this tree:

| Measurement | Gas |
|---|---|
| `verifyProof` estimate (7 public inputs) | **258,738** |
| `verifyProof` actual `gasUsed` | **255,928** |
| Groth16 pairing component (4 pairs, EIP-1108) | 181,000 |
| Public-input MSM (7 × `ecMul` + `ecAdd`) | ~43,000 |
| Verifier calldata/assembly overhead | ~30,000 |

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

**Stock 100k cannot fit an on-chain Groth16 verifier.** The pairing check alone
is 181k. A 100k deployment would need off-chain verification with a bonded
relayer/attestation, or a protocol-native verifier precompile — neither is
“actual ZK on-chain.”

Reproduce:

```powershell
npm run zk:proof     # generate build/zk/proof.json + public.json
npm run zk:bench     # deploy verifier on ganache, print estimate/gasUsed
npm test             # T12 asserts the fixture verifies and gas < 305k
```

## Browser flow (`/zk`)

```powershell
npm run zk:setup      # circuit + devnet zkey + verifier
npm run zk:deploy     # verifier + ZkPaymaster, root, stake, fund
npm run zk:publish    # wasm/zkey -> public/zk + demo credential
npm run dev
```

Open `/zk`. The page:

1. shows the session key that will be bound into the proof;
2. loads a credential JSON (or the gitignored demo credential) into
   localStorage;
3. computes `identityNullifier` / `sessionNullifier` with `poseidon-lite` in
   the tab;
4. generates the Groth16 proof in the tab with `snarkjs` (wasm + zkey from
   `public/zk`);
5. checks the proof's public signals against the credential, builds the
   4-frame tx with a 330k charge-frame budget, signs with the session key, and
   submits.

`public/zk/` is gitignored: it contains a 2.2 MB wasm, a 5.4 MB zkey, and the
demo secret. A fresh clone must run `zk:setup` + `zk:publish` before `/zk` can
prove. The CLI equivalent is `npm run zk:sponsor`.

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
[{ "index": 0, "leaf": "…", "root": "…", "pathElements": ["…"], "pathIndices": [0] }]
```

Send that path to the employee; they combine it with their own secret in the
`/zk` credential form. Removal sets the slot to `0` instead of splicing, so
other employees' indices and paths stay stable until the next root update.
Changing the root invalidates every outstanding path; redistribute after each
`add`/`remove`.

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

- The parallel `/zk` page is wired (browser prover + submit). `/pay` still uses
  the blind-token `charge(Token)` path until the ZK flow is validated on the
  devnet. The CLI path is `npm run zk:deploy` then `npm run zk:sponsor`.
- One payment per epoch. Multiple payments need a sequential counter or a
  different credential design.
- `TXPARAM.MAX_COST` is an ethrex extension (`0x06`). On a chain without it,
  `charge()` must compute the bound from frame gas limits and `MAX_FEE`
  instead; otherwise the `maxSponsorCost` check is bypassed.
- The verifier call is external, so the paymaster pays a cold `CALL` (~2.6k)
  on top of the 249k verifier gas. This is included in the 330k frame budget.
- `ZkPaymaster` is not audited. EIP-8141/ERC-8421 are drafts and the devnet
  differs from the EIP text.
- The snarkjs-generated verifier carries `GPL-3.0`; check license compatibility
  before distributing a combined work. The rest of this repo is MIT.
