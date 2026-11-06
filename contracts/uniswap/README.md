# Vendored Uniswap v4

These files are copied from upstream Uniswap repositories so the devnet
deployment is self-contained. Do not edit them; re-vendor instead.

| Source | Pin | Vendored here |
|---|---|---|
| [`Uniswap/v4-core`](https://github.com/Uniswap/v4-core) | tag `v4.0.0`, commit `e50237c43811bd9b526eff40f26772152a42daba` | full `src/` tree, minus `src/test/` |
| [`Uniswap/v4-periphery`](https://github.com/Uniswap/v4-periphery) | `1.0.4`, commit `c6e4754dab11bd38c6f08ac51c3c868569e93d64` | `src/lens/StateView.sol` + `src/base/ImmutableState.sol` + the two `IStateView`/`IImmutableState` interfaces |
| [`transmissions11/solmate`](https://github.com/transmissions11/solmate) | commit `4b47a19038b798b4a33d9749d25e570443520647` | `src/auth/Owned.sol` (the only external import in v4-core's non-test source) |

Only the direct `PoolManager` path is vendored. The Universal Router, Permit2,
PositionManager and the rest of v4-periphery are not needed for the DAO's
`DaoSwapModule` flow.

## Build

v4-core pins Solidity **0.8.26** exactly, so the DAO build (0.8.28/shanghai)
cannot compile it. The repo uses a separate npm alias:

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install --no-save --no-package-lock --legacy-peer-deps solc826@npm:solc@0.8.26
node scripts/v4-build.mjs
```

Canonical v4 settings:

```text
solc            0.8.26
evm_version     cancun
via_ir          true
optimizer_runs  44444444
bytecode_hash   none
```

Measured on this tree:

| Contract | Runtime | EIP-170 headroom |
|---|---:|---:|
| `PoolManager` | 24,009 | 567 |
| `StateView` | 3,531 | 21,045 |

## Deploy

```powershell
node scripts/deploy-v4.mjs
```

Defaults: `DEVNET_RPC` = the sidecar in `.env.local`
(`https://sidecar.161.118.164.226.nip.io/rpc`), chain 1337, deployer key from
`DEPLOYER_KEY` or the workshop state file. Set `POOL_MANAGER_OWNER` to the DAO
admin/timelock for anything beyond the demo.

The script writes `deployments/v4-1337.json`.

## Seed and smoke test

`V4PoolSeeder` is a small one-shot seeder (initialize + full-range liquidity)
that avoids deploying `PositionManager`/`Permit2` for the demo.

```powershell
node scripts/v4-seed.mjs        # tokens, pool, module, one swap
node scripts/v4-swap-smoke.mjs  # both directions + slippage/deadline reverts
```

Current sidecar deployment (chain 1337):

| Contract | Address |
|---|---|
| `PoolManager` | `0xd5eeb6c94f70436b8748148c517b7a07d033435b` |
| `StateView` | `0xd36bac46e06170d23476090e3eb17b5c0fa4f765` |
| `DaoSwapModuleFactory` | `0x8f4c325af50a3d4ca7bee14bfe3d7cd597707f95` |

The seed/smoke addresses, pool id and swap results are recorded under
`demoPool` / `smoke` in `deployments/v4-1337.json`.

## Licenses

- `v4-core` is **BUSL-1.1** (see `v4-core/licenses/`). Review before any use
  beyond the demo.
- `v4-periphery` `StateView`/`ImmutableState` files are MIT.
- `solmate` `Owned.sol` is **AGPL-3.0-only**.
