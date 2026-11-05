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

## Pages

| Route | Who | What |
|---|---|---|
| `/` | everyone | Overview, flow, devnet status |
| `/company/new` | company admin | Register a company (deploys an isolated paymaster) |
| `/admin` | company admin | Authorize beneficiaries, set policy, fund/withdraw |
| `/pay` | beneficiary | Build, sign, and submit a sponsored frame tx |

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
