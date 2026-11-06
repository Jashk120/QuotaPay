# QuotaPay — sponsored EIP-8141 payments

Company-scoped sponsorship UI + contracts. A company registers an isolated
paymaster, authorizes beneficiary wallets, and pays gas for EIP-8141 frame
transactions. Beneficiaries hold 0 ETH.

## Stack

- **Next.js 16** (app router) + **React 19** + **TypeScript**
- **Tailwind CSS 3** with shadcn-style primitives
- **ox** (`TxEnvelopeEip8141`) for building/signing/serializing frame txs
- **viem** for admin contract calls and reads
- Solidity contracts in `contracts/` (`CompanyFactory`, `CompanyPaymaster`, and
  the earlier probe contracts)

## Run

```powershell
npm install
copy .env.example .env.local   # then edit
npm run dev
```

Open http://localhost:3000.

## Deploy to the devnet

```powershell
npm run deploy
```

`deploy` compiles the contracts, deploys `CompanyFactory`, creates a demo
company (`acme`), stakes the paymaster as its own ERC-8421 entity, enrolls a
demo beneficiary, verifies the code, and writes `deployments/1337.json` plus
`.env.local`.

If a factory deployment was already broadcast but has not been mined (the public
devnet occasionally stalls), resume it instead of broadcasting a second one:

```powershell
$env:RESUME_FACTORY="0x<factory>"; npm run deploy
```

If the factory tx is stuck and the devnet is stalled, replace it with a cheap
21k-gas self-cancel before the miner restarts, then deploy fresh (do not reuse
the cancelled factory address):

```powershell
npm run cancel:pending
```

Then run the real end-to-end sponsored transaction:

```powershell
npm run smoke
```

`npm run codec` verifies that the app's devnet wire codec
(`lib/devnetFrameTx.ts`) is byte-identical to the proven
`@forshtat/hegota-support` codec (wire bytes, sign payload, RPC shape and the
`v || r || s` signature).

## Tests

```powershell
npm test        # 10 adversarial test files / 19 subtests
```

> The public devnet miner has been observed to stall for minutes. If `deploy`
> or `smoke` times out, check `eth_blockNumber`; the transaction stays in the
> mempool and the resume path above completes it when blocks resume.

## UI tests (Playwright)

```powershell
npx playwright install chromium   # once
npm run test:e2e                  # starts the app on :3100 in demo mode
```

The suite drives the real UI end to end: it generates a beneficiary session
key, registers a company with a paymaster, authorizes that session wallet,
adds and revokes a second user, builds/signs a four-frame sponsored payment,
and verifies the disabled-submission guard. It runs with
`NEXT_PUBLIC_DEMO_MODE=true`, so it never depends on the devnet.

## Pages

| Route | Who | What |
|---|---|---|
| `/` | everyone | Overview, flow, devnet status |
| `/company/new` | company admin | Register a company (deploys an isolated paymaster) |
| `/admin` | company admin | Authorize beneficiaries, set policy, fund/withdraw |
| `/pay` | beneficiary | Build, sign, and submit a sponsored frame tx (blind-token path) |
| `/zk` | beneficiary | ZK membership proof, then build/sign/submit a sponsored frame tx |

## Live vs demo mode

- **Demo mode** (default): no `NEXT_PUBLIC_FACTORY_ADDRESS`. Company and
  beneficiary records are stored in `localStorage`; the pay page can still
  build and sign a real Ox envelope.
- **Live mode**: set `NEXT_PUBLIC_FACTORY_ADDRESS` (and a reachable
  `NEXT_PUBLIC_RPC_URL`). Admin actions become on-chain transactions signed by
  the connected injected wallet. Set `NEXT_PUBLIC_ENABLE_SUBMIT=true` to
  broadcast sponsored transactions from `/pay`.

## Wallet model

- **Company admin**: MetaMask (or a Safe) — normal contract calls.
- **Beneficiary**: a session key held in the browser, or a smart account. The
  address must be enrolled by the company admin.
- **MetaMask cannot build or broadcast EIP-8141 frame transactions.** The pay
  page uses the session key to satisfy the EOA VERIFY frame and relays the
  signed envelope to an EIP-8141 RPC.

## Ox wire compatibility

`ox` follows the current EIP-8141 draft (7/8 payload items). The `ethrex`
tracer devnet used by the original workshop carries a 9-item envelope with a
top-level `recent_root_references` field and is pinned in
`@forshtat/hegota-support`. Run the probe before pointing the UI at a devnet:

```powershell
npm run compat
# optional: HEGOTA_SUPPORT_DIR=C:/path/to/hegota-support/dist
```

If the probe reports `NOT wire-compatible`, either adapt the Ox envelope to the
devnet profile or keep using the workshop codec for submission on that chain.

## Contracts

`CompanyFactory.createCompany(CompanyConfig)` deploys one `CompanyPaymaster`
per company. Each instance owns its balance, beneficiary registry (own
storage), per-period credit ledger, ETH solvency accounting, delayed withdrawal
queue, and ERC-8421 staking.

Build the contracts (artifacts land in `build/`, which is gitignored):

```powershell
npm.cmd exec --yes -- solc@0.8.28 --optimize --optimize-runs 200 `
  --base-path . `
  --include-path C:\projects\poolframes\workshop\node_modules `
  --bin --abi contracts/CompanyFactory.sol contracts/CompanyPaymaster.sol `
  contracts/QuotaPayPreVerify.sol contracts/QuotaPayExt.sol `
  contracts/ExposureController.sol contracts/QuotaPayPairing.sol `
  contracts/QuotaPaymaster.sol -o build
```

> EIP-8141 and ERC-8421 are drafts; the devnets differ. Not production audited.
