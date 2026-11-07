# Uniswap v4 treasury swaps: design and devnet runbook

Status: design + runbook. The Phase 0 probe, `DaoSwapModule`, its factory, and
the `DaoCore`/`DaoFactory` wiring are implemented and covered by `t24` on
ganache; the probe also passes on the devnet (`TSTORE`/`TLOAD`, `MCOPY`). The
v4 infrastructure is predeployed on the devnet (not built from source) and the
WETH9/USDC pool is seeded with real liquidity (`deployments/v4-1337.json`).
Remaining: the direct swap smoke test, the agent frame swap, and the above-cap
proposal (Phases 4–6). `DAO.md` remains the source of truth for the existing
DAO contracts; this file is the plan for adding v4.

Target chain: the EIP-8141 / ethrex devnet (chain id 1337), with v4 deployed
from source. The Uniswap API is out of scope there: chain 1337 is not in its
supported-chain list, and a self-deployed PoolManager would not be indexed by
it anyway.

**Devnet verdict: self-deployed v4 is viable.** The Phase 0 probe passed on
2026-11-06 against `ethrex/v23.0.0-eip8141-tracer`: chain id 1337, `TSTORE`/
`TLOAD` and `MCOPY` all work (probe at `0xf6e14ada...e20535`), and the block gas
limit is 60,000,000. The chain is Prague-era (`blobGasUsed`,
`parentBeaconBlockRoot`, `requestsHash`), so EIP-1153 is present. `PoolManager`
is 24,009 bytes and fits the 24,576-byte limit. The remaining checks are the v4
build size and one swap inside a SENDER frame. If those pass, the deployment
phases are unblocked. If they fail, fall back to a simple constant-product mock
pool for the demo.

---

## 1. Decisions at a glance

| Topic | Decision |
|---|---|
| Swap path | Direct `PoolManager.unlock` through a new `DaoSwapModule`. Universal Router is optional and stays on the UI side. |
| Where the swap logic lives | `DaoSwapModule` (new contract), not `DaoCore`. `DaoCore` gets at most one small above-cap entry point. |
| Tier 1 (within cap) | `DaoCore.spend(tokenIn, module, amountIn)` + `module.swap(...)` in one atomic frame batch. |
| Tier 3 (above cap) | Proposal -> `DaoSwapModule.swapAboveCap(...)`, which pulls the input through `DaoCore.pullForSwap` and records `ACTION_SWAP` through `DaoCore.recordSwap`. |
| Caps | Reuse the per-token `tokenCaps` accounting. The tier-1 cap is denominated in the input token (USDC), so no oracle is needed on that path. |
| Pool selection | Pools are allowlisted by `PoolId`; the agent never supplies an arbitrary `PoolKey`. |
| Exact-in / exact-out | Exact-in at tier 1. Exact-out at tier 3 only; the input amount is unknown before execution. |
| Slippage | Mandatory `deadline` and `minAmountOut > 0`. A mock reference price may add a floor; pool spot is not a cap source. |
| Valuation | Keep `AssetModule.unitPrice` (mock) for asset caps. Use `StateView.getSlot0` for display and a sanity bound only. |
| Native ETH | `currency0 = address(0)`; the PoolManager holds native ETH. DaoCore already has `receive()`. |
| Hook (stretch) | Per-DAO permissioned RWA hook; allowlist the module address, not `tx.origin`. |
| v4 version | Predeployed replayed-mainnet builds on the devnet (see Phase 1). Do not build from source. |

---

## 2. Corrections to the working notes

These are the points where the earlier notes would send the implementation in
the wrong direction.

| Note | Verdict | What to do instead |
|---|---|---|
| "Swaps must go through the Universal Router." | No. The v4 swap guide says direct PoolManager interaction is "technically possible ... not recommended due to complexity", not forbidden. | Direct calls are a better fit for a contract treasury: no Permit2 allowance, no router in the trust path, and the output recipient is an immutable address. Keep the router for user-facing/UI swaps. |
| "Add a DaoCore function with typed inputs; the contract encodes the swap itself." | Does not fit as written. `DaoCore` is 21,443 bytes deployed; `DaoCoreFactory` (which embeds its creation code) is 23,645 bytes. EIP-170 is 24,576, so the factory has 931 bytes of headroom. | Put the swap mechanics in `DaoSwapModule`. Keep at most a small `swapAboveCap` in `DaoCore`. Measure `DaoCoreFactory` after every change. |
| "The output comes back to DaoCore, so there is no recipient to inject." | True for the router path: `TAKE_ALL` pays `msgSender()`, so the funds return to the caller. It is not true for the direct path: `poolManager.take(currency, to, amount)` takes an explicit recipient chosen by the caller. | Hard-code `dao` as the recipient in the module; never accept one from the agent. If using the router, confirm `msgSender()` is DaoCore. |
| "v4 supports native ETH without WETH." | True. `Currency.wrap(address(0))` is native; the PoolManager can hold and pay out ETH. | The module receives ETH from DaoCore (`receive()` required), then calls `poolManager.settle{value: amountIn}()`. The PoolManager has no `receive()`; ETH enters through payable `settle`, not a plain transfer. |
| "v4 has no built-in oracle like v3's." | True. v3's `observe`/tick accumulators have no v4-core equivalent. `StateView.getSlot0` is spot only. | Do not use spot for cap checks. Keep the mock price for caps; use spot for display and a bounded execution check. |
| "v4 needs transient storage (EIP-1153)." | True. `PoolManager` uses `TLOAD`/`TSTORE` for its lock, reserves and currency deltas. `exttload` is a PoolManager view function, not a separate opcode. | Probe `TSTORE` on chain 1337 before deploying anything (Phase 0). |
| "Hook permissions are encoded in the address." | True. The low 14 bits are the permission flags. A `beforeSwap`-only hook needs `1 << 7`. `HookMiner` finds a salt. | Use `BaseHook.getHookPermissions` and mine the address; do not hand-edit flags. |
| "Use the `msg.sender`-retrieval pattern for the hook." | Only for routers. A hook always sees `msg.sender == PoolManager`; the `sender` argument is whoever called `poolManager.swap`. With direct calls that is the module. | Allowlist the module address in the hook. The docs' `msgSender()` pattern is for a trusted router (e.g. Universal Router) and is unnecessary here. |
| "Deploy Permit2, PositionManager, StateView, UniversalRouter." | Not all are needed. The direct swap path needs PoolManager only; StateView is a cheap read helper. Permit2/PositionManager are for the router and LP NFTs. | Minimal set: PoolManager + StateView. Add the rest only if the UI uses the router or LP NFTs. Both PositionManager (23,877 B) and Universal Router 2.1.2 (24,380 B) are near the EIP-170 limit. |
| "The Uniswap API supports 17+ mainnets plus Ethereum, Base and Unichain Sepolia." | The current supported-chains page lists 21 mainnets and 3 testnets (Ethereum Sepolia, Base Sepolia, Unichain Sepolia). Ethereum and Base are mainnets, not testnets. | Chain 1337 is absent either way. Skip the API. Note that support for Universal Router 2.0/2.1.1 ended 2026-10-21; pin 2.1.2 if a router is used. |
| "The SDK's V4Planner encodes the batched actions." | True for the TypeScript SDK. A Solidity contract cannot call it. On-chain the encoding is `commands = 0x10`, `actions = 0x06 0x0c 0x0f`, plus three ABI-encoded params. | Encode manually in the module (direct path) or in the UI (router path). See Appendix A. |
| Notes only cover exact-in. | Exact-out is useful for "buy exactly N RWA". | Keep exact-out at tier 3: the input is unbounded until execution, so it cannot be safety-checked against a tier-1 cap. |

One more protocol detail the notes missed: **v4 rejects a zero
`sqrtPriceLimitX96`**. Unlike v3, there is no "0 means no limit". The module must
pass `TickMath.MIN_SQRT_PRICE + 1` for `zeroForOne` and
`TickMath.MAX_SQRT_PRICE - 1` otherwise.

---

## 3. Size budget

Measured from the local artifact cache on 2026-11-06. The `DaoCore` rows are
the post-slice numbers; the v4 rows are the canonical builds:

| Contract | Runtime | EIP-170 limit | Headroom |
|---|---:|---:|---:|
| `DaoCore` | 22,294 | 24,576 | 2,282 |
| `DaoCoreFactory` | 24,503 | 24,576 | **73** |
| v4 `PoolManager` | 24,009 | 24,576 | **567** |
| v4 `PositionManager` | 23,877 | 24,576 | 699 |
| Universal Router 2.1.2 | 24,380 | 24,576 | **196** |
| v4 `StateView` | 3,531 | — | — |
| `Permit2` | 9,152 | — | — |

The binding constraint is `DaoCoreFactory`, not `DaoCore`: the factory stores
the `DaoCore` creation code, so every byte added to `DaoCore` is a byte added to
the factory. The first slice used 1,082 bytes (the original design predicted
931), leaving 73 bytes. Treat that as zero: any further `DaoCore` change needs a
size reduction first. The swap module is **not** deployed by `DaoCoreFactory`;
it goes through `DaoSwapModuleFactory`, a fourth child factory.

The design already uses the fallback below: `DaoCore` keeps `pullForSwap` and
`recordSwap` (both module-only) instead of a large `swapAboveCap` wrapper, which
is what made the 73-byte result possible. Moving either check back into
`DaoCore` would exceed EIP-170.

---

## 4. Architecture

```
AgentAccount (tx.sender)
   |
   | SENDER frame 1: DaoCore.spend(USDC, module, amountIn)
   | SENDER frame 2: DaoSwapModule.swap(req)          [ATOMIC_BATCH on frame 1]
   v
DaoSwapModule ── unlock(callback) ──> PoolManager
   ^                                   │
   │        swap(key, exactIn)         │
   │        settle input               │
   └──────── take(output, dao) ────────┘

Governance path:
DaoCore.executeProposal -> DaoSwapModule.swapAboveCap(req)
   -> DaoCore.pullForSwap(input, amountIn) -> module
   -> module.swap(req) -> PoolManager
   -> output to DaoCore (module.take)
   -> DaoCore.recordSwap(poolId, amountIn, amountOut)  [ACTION_SWAP]
```

### 4.1 Contracts

| Contract | Owner | Responsibility |
|---|---|---|
| `DaoSwapModule` | one per DAO | Holds the v4 wiring, implements `IUnlockCallback`, enforces the pool allowlist, `deadline`, `minAmountOut`, and the caller check. Holds input tokens only for the duration of one atomic batch. |
| `DaoSwapModuleFactory` | chain (optional) | Deploys a module for a DAO with `(poolManager, dao, agentAccount)`. `DaoFactory` takes it as an optional fourth child factory; zero means no swap module on that chain. |
| `DaoCore` (delta) | per DAO | `swapModule` address, `initializeSwapModule`, `pullForSwap`, `recordSwap`, the `ACTION_SWAP` audit constant, and the module target/selector allowlist. The agent policy rule is installed by `DaoFactory` through `initializePolicy`. |
| `AgentAccount` | per DAO | Policy rule: `module.swap` is tier 1, so the frame-introspection check admits it. |
| `PoolManager` | chain | v4 singleton. Owns all pool state and flash accounting. |
| `StateView` | chain | Read-only `getSlot0` / `getLiquidity` for the UI and scripts. |

The module is per-DAO so its `dao` and `agentAccount` are immutable and the
permissioned hook can allowlist one stable address. A shared module would be
cheaper to deploy but would need a registry and would make the hook's allowlist
ambiguous.

### 4.2 Why the two-call tier-1 path

`DaoCore.spend` already enforces the per-tx/per-period cap, emits `Spent`, and
has a `nonReentrant` guard. Reusing it means the swap path does not duplicate
cap accounting and does not need an oracle: the cap is in USDC, the input token.

The frame builder already supports multiple `SENDER` calls with `ATOMIC_BATCH`
on all but the last, so the two-call path is atomic: if the swap reverts, the
spend reverts with it. The module is left holding tokens only inside that
batch.

The cost is one extra frame and one extra token transfer (DaoCore -> module).
That is cheaper and smaller than adding a full swap entrypoint to `DaoCore`.
The typed inputs are not lost: they are the `SwapRequest` fields, validated by
the module and audited through `DaoCore.spend` plus `ActionExecuted`.

---

## 5. `DaoSwapModule` specification

### 5.1 Interface

```solidity
interface IDaoSwapModule {
    struct SwapRequest {
        PoolKey key;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint64 deadline;
    }

    function swap(SwapRequest calldata req) external returns (uint256 amountOut);
    function swapAboveCap(SwapRequest calldata req)
        external
        returns (uint256 amountOut);
    function setPool(PoolKey calldata key, bool allowed) external;
    function poolAllowed(PoolId id) external view returns (bool);
}
```

`swap` is tier 1 (the DAO or its agent calls it after `DaoCore.spend`).
`swapAboveCap` is `msg.sender == dao` only and is the proposal target; it pulls
the input through `DaoCore.pullForSwap` and records the result through
`DaoCore.recordSwap`.

### 5.2 Checks

`swap` must check, in this order:

1. `msg.sender == dao || msg.sender == agentAccount`.
2. `block.timestamp <= req.deadline`.
3. `poolAllowed[key.toId()]`, recomputed from the supplied key. The agent cannot
   smuggle a different pool or a malicious hook.
4. `amountIn > 0` and `minAmountOut > 0`.
5. The module's input balance is at least `amountIn` (the spend landed).
6. After the swap, `amountOut >= minAmountOut`.

`setPool` is `msg.sender == dao` only. Governance reaches it through a proposal
that targets the module; `DaoCore.initializeSwapModule` allows the module target
and both the `setPool` and `swapAboveCap` selectors. `setPool` also rejects
unsorted keys and identical currencies before computing the `PoolId`.

### 5.3 Flow inside `unlockCallback`

```solidity
// illustrative, not compiled
function unlockCallback(bytes calldata data) external returns (bytes memory) {
    require(msg.sender == address(poolManager), "not manager");
    (SwapRequest memory req, Currency input) = abi.decode(data, (SwapRequest, Currency));

    uint160 limit = req.zeroForOne
        ? TickMath.MIN_SQRT_PRICE + 1
        : TickMath.MAX_SQRT_PRICE - 1;

    BalanceDelta delta = poolManager.swap(
        req.key,
        SwapParams({
            zeroForOne: req.zeroForOne,
            amountSpecified: -int256(uint256(req.amountIn)),
            sqrtPriceLimitX96: limit
        }),
        ""
    );

    int128 d0 = delta.amount0();
    int128 d1 = delta.amount1();
    Currency output = req.zeroForOne ? req.key.currency1 : req.key.currency0;
    uint256 amountIn = uint256(uint128(req.zeroForOne ? -d0 : -d1));
    uint256 amountOut = uint256(uint128(req.zeroForOne ? d1 : d0));

    if (Currency.unwrap(input) == address(0)) {
        poolManager.settle{value: amountIn}();
    } else {
        poolManager.sync(input);
        IERC20(Currency.unwrap(input)).transfer(address(poolManager), amountIn);
        poolManager.settle();
    }

    poolManager.take(output, dao, amountOut);
    return abi.encode(amountOut);
}
```

Notes:

- For native input, the PoolManager has no `receive()`; ETH must arrive as
  `msg.value` on `settle`. `sync` is only needed for ERC-20 reserves.
- For an ERC-20 input, `sync` records the PoolManager's pre-transfer balance, so
  only the module's transfer is credited.
- `amountIn` is read from the delta, not from the request. If the price limit
  stops the swap early, the module owes less and must refund the surplus to the
  treasury. Either set the limit to the extreme (demo) or implement the refund.
- `take` of native ETH calls `dao`, which has `receive()`.
- The callback must not be reachable outside `unlock`; the `msg.sender` check is
  the guard. The module should hold no tokens between calls and should declare
  `receive() external payable {}` so DaoCore can forward native input.

### 5.4 Events

```solidity
event Swapped(
    PoolId indexed poolId,
    address indexed caller,
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOut
);
event SwapPoolSet(PoolId indexed poolId, bool allowed);
```

The tier-1 path is audited by `DaoCore`'s `Spent` event plus the module's
`Swapped` event. The tier-3 path should additionally emit `DaoCore`'s existing
`ActionExecuted` with `ACTION_SWAP = 8`. Do not invent a second audit event
shape.

### 5.5 DaoCore delta

Minimum viable change (this is the implemented shape; the original
`swapAboveCap` wrapper did not fit the size budget):

```solidity
address public swapModule;

// Called once by DaoFactory, after the agent account exists.
function initializeSwapModule(address module) external onlyFactory {
    swapModule = module;
    proposalTargetAllowed[module] = true;
    assetSelectorAllowed[IDaoSwapModule.swapAboveCap.selector] = true;
    assetSelectorAllowed[IDaoSwapModule.setPool.selector] = true;
    emit SwapModuleInitialized(module);
}

// Called by the module inside swapAboveCap, which a proposal targets.
function pullForSwap(address token, uint256 amount) external {
    require(msg.sender == swapModule, "not swap module");
    _transfer(token, swapModule, amount);
}

function recordSwap(bytes32 poolId, uint256 amountIn, uint256 amountOut)
    external
{
    require(msg.sender == swapModule, "not swap module");
    emit ActionExecuted(
        keccak256(abi.encode(ACTION_SWAP, poolId, amountIn, amountOut)),
        TIER_GOVERNANCE,
        address(this),
        ACTION_SWAP,
        bytes32(0),
        bytes32(0)
    );
}
```

`DaoFactory` installs the tier-1 agent rule (`module.swap`) through the existing
`initializePolicy` path, so `DaoCore.initializeSwapModule` stays small. The
module's `swapAboveCap` is `onlyDao`; when `executeProposal` self-calls the
module, `msg.sender` is the DAO.

The size budget is the reason for this shape: `DaoCoreFactory` is 24,503 bytes
and cannot fit the original `swapAboveCap` wrapper (which cost ~950 bytes on its
own). Do not add `nonReentrant` to `pullForSwap` or `recordSwap`:
`executeProposal` already holds the guard.

### 5.6 Tier and cap mapping

| Action | Tier | Path |
|---|---|---|
| Swap within the input-token cap, allowlisted pool | 1 | `spend` + `module.swap` (atomic batch) |
| Swap above the cap | 3 | proposal -> `module.swapAboveCap` -> `DaoCore.pullForSwap` / `recordSwap` |
| Allowlist/remove a pool | 3 | proposal -> `module.setPool` |
| Rotate the module | 3 | not supported in this design; redeploy if needed |
| Pause the agent | admin | `DaoCore.pauseAgent` |

The per-token cap is debited by `spend`, not by the swap. This reuses the
existing period rollover and prevents the swap path from becoming a second,
inconsistent accounting system.

### 5.7 What the module deliberately does not do

- It does not hold a standing token balance.
- It does not approve Permit2 or the Universal Router.
- It does not accept a recipient from the caller.
- It does not read pool spot to value the trade.
- It does not support multi-hop. One pool per call; compose at the frame level
  if needed.

---

## 6. Gas top-up

Goal: sell USDC for native ETH and top up the paymaster tank.

1. Create or use a USDC/ETH pool with `currency0 = address(0)` and
   `currency1 = USDC`. Since `address(0)` sorts first, USDC -> ETH is
   `zeroForOne = false`.
2. Tier 1: `spend(USDC, module, amountIn)` + `module.swap(...)`. The output goes
   to DaoCore.
3. Then `spend(address(0), paymaster, minAmountOut)` to fund the tank. Spending
   `minAmountOut` (not the expected output) is deterministic: the swap
   guarantees at least that, and the surplus stays in the treasury. This needs a
   native-ETH entry in `tokenCaps` (`allowed = true`, `perTx >= minAmountOut`),
   configured by the factory or a tier-3 `setTokenCap`.

Required repo change: `DaoGasPaymaster` and `DaoVotePaymaster` currently have
`deposit()` but **no `receive()`**. A plain `spend`/`_transfer` of ETH to the
paymaster will revert. Either add

```solidity
receive() external payable { emit Deposited(msg.sender, msg.value); }
```

to both paymasters, or add a `fundPaymaster(address,uint256)` to DaoCore that
calls `deposit{value: amount}()`. The `receive()` change is smaller and makes
the existing `spend` path work unchanged.

Also check `DaoGasPaymaster.maxSponsorCost` and the frame builder's
`executionGas` / `stateGas` budgets. A swap is roughly 150-250k execution gas
before hooks; the builder's default `150_000n` is too low. Pass something like
`executionGas: 350_000n` and `stateGas: 400_000n` for the swap frame, and raise
the paymaster's cost cap if needed.

---

## 7. Valuation

There are three different prices in play and they should not be conflated:

| Price | Source | Use |
|---|---|---|
| Caps | `AssetModule.unitPrice` (mock, governance-set) | Per-asset acquisition caps and the `acquireAsset` path. Unchanged. |
| Execution floor | `minAmountOut` built by the agent, plus `maxSlippageBps` if a reference price is added | Sandwich protection. |
| Display / sanity | `StateView.getSlot0(poolId)` | UI and a "has the pool moved > X%" alert. Never a cap source. |

Do **not** wire `getSlot0` spot into cap checks. A bound does not make spot
manipulation safe; it only limits the loss. If a volatile input token is ever
allowed at tier 1, add a governance-set USD reference price (or a TWAP hook),
not pool spot. Label the demo oracle as a mock in the UI and in the audit feed.

`StateView` reads use the singleton's `extsload`/`exttload` helpers:
`getSlot0(poolId)` returns `(sqrtPriceX96, tick, protocolFee, lpFee)`;
`getLiquidity(poolId)` returns the active liquidity. The pool id is
`keccak256(abi.encode(poolKey))`.

---

## 8. Permissioned RWA hook (stretch)

Scope: a hook on the RWA/USDC pool that only lets the DAO treasury (through its
module) swap.

- Implement `beforeSwap` only. A `beforeSwap`-only hook needs the
  `BEFORE_SWAP_FLAG` (`1 << 7`) set in its address; use `HookMiner` with
  `BaseHook`'s permission struct.
- The hook sees `sender == address(module)` because the module calls
  `poolManager.swap`. Store `allowedSwapper = module` at deploy and
  `require(sender == allowedSwapper)`. This is simpler and safer than the
  `msgSender()` pattern, which only applies when a trusted router is in front.
- If the UI later swaps through the Universal Router, the hook sees the router
  as `sender`. Either add the router to an allowlist and call `msgSender()` on
  it, or give the pool two paths. Do not use `tx.origin`.
- Return `BaseHook.beforeSwap.selector` and
  `BeforeSwapDeltaLibrary.ZERO_DELTA`; do not set the delta-return flag unless
  the hook actually returns a delta.
- A hook can revert or charge fees; only allowlist hooks you deployed. A pool
  with a malicious hook is worse than a pool with no hook.

This is a demo feature. A real permissioned RWA pool needs legal/transfer
restrictions that a hook cannot provide on its own.

---

## 9. Devnet runbook

The runbook assumes the contract changes in §5 exist. Each phase has a gate; do
not start the next phase until the gate passes.

### Phase 0 - chain probe (do this first)

Self-hosted sidecar (2026-11-06): `https://sidecar.161.118.164.226.nip.io/rpc`
(`ghcr.io/jashk120/mempool-workshop-sidecar:latest`, `BUNDLING_MODE=manual`).
The stock `deploy/altmempool` compose serves only the bundler methods until
`--redirectRpc` is added to the sidecar command; without it every `eth_*` read
(`eth_estimateGas`, `eth_getBlockByNumber`, ...) returns `-32601 Method ... is
not supported`. The compose on the VPS has the flag. The VPS is arm64 while
the image is amd64-only, so the service runs under QEMU (`platform:
linux/amd64`); allow ~1 min for boot.

Frame probe through the self-hosted node returns the same negative result as
the public endpoint (`Frame transaction validation prefix does not match any
recognized shape`), so deploys must use `DAO_FRAME_ENFORCED=false`. The two
endpoints agree, which is the parity check for the relay.

Observed on 2026-11-06 against the devnet RPC:

| Field | Value |
|---|---|
| `eth_chainId` | `0x539` (1337) |
| `web3_clientVersion` | `ethrex/v23.0.0-eip8141-tracer-...` (the `/rpc` path is proxied through skandha) |
| Latest block | `blobGasUsed`, `excessBlobGas`, `parentBeaconBlockRoot` (Cancun) and `requestsHash` (Prague) are present |
| Block gas limit | `0x3938700` = 60,000,000 |
| Probe result | `tstore: true`, `mcopy: true`, `chainIdMatches: true` |

Probe run on 2026-11-06: deployed at
`0xf6e14adad3dbc1dd96bef3d7c6c5dfffa3e20535`, block 5101. The Cancun/Prague
header fields plus the direct probe confirm EIP-1153 (`TSTORE`/`TLOAD`) and
`MCOPY`. The contract-size and frame-tx checks still have to pass in Phases 1
and 5.

Probe the same way the repo already probes `FRAMEDATACOPY`:

| Check | Why |
|---|---|
| `eth_chainId` | Confirm 1337 and that the RPC is the devnet, not a fork. |
| `TSTORE`/`TLOAD` | v4 flash accounting fails without EIP-1153. |
| `MCOPY` + `PUSH0` | The v4 build targets Cancun; `viaIR` output uses these. |
| Contract size | PoolManager is 24,009 bytes; a chain with a lower limit or code instrumentation will reject it. |
| Block gas limit | A swap + settle + take must fit with the frame overhead. |
| Frame-tx support | The DAO path is a frame tx; test one plain swap and one swap inside a SENDER frame. |

Add `contracts/probe/TransientProbe.sol` next to `FrameReadProbe.sol`
(implemented):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract TransientProbe {
    function roundTrip(uint256 value) external returns (uint256 out) {
        assembly ("memory-safe") {
            tstore(0, value)
            out := tload(0)
        }
    }
}
```

The existing `compileAll()` helper hard-codes `evmVersion: "shanghai"` and
optimizer runs 200, so it will reject `tstore`. `scripts/v4-probe.mjs` (added
with this design) does the one-off cancun compile of the probe, deploys it, and
`eth_call`s both `roundTrip` (`TSTORE`/`TLOAD`) and `copy` (`MCOPY`). Any revert
or empty return means the chain is not ready; stop. Do not change the DAO
contracts' shanghai setting for this.

**Gate:** all six checks pass, and the probe result is recorded in the runbook
output (chain id, gas limit, code-size result, frame result).

### Phase 1 - pin and build v4 (done, no build needed)

The devnet already runs the real v4 infrastructure (replayed mainnet
deployments, `deployments/devnet.md` in the sidecar repo). Nothing is compiled
or deployed from source:

| Contract | Devnet address | Note |
|---|---|---|
| `PoolManager` | `0x6bF9Aa9c04fd001385742d61f6818C3236429848` | Real bytecode via the `UniswapV4DeployerCompetition` contract; 24,009 bytes |
| `PositionManager` | `0x5bF24B2CD6f4cc0057F4BeD53264d591620Af57B` | 23,877 bytes; `poolManager`/`permit2`/`WETH9` rewired to devnet addresses |
| `StateView` | `0xd89a052862AaA34f0B6cc7f3B6a9D080584a43FB` | 3,531 bytes |
| `V4Quoter` | `0xeEa49CC6419125E2f706bf7f95Cf34ac7e93087D` | 5,820 bytes |
| `UniversalRouter` | `0x5e2250a42608a5cc9f62e23ab24824ee25b5e2be` | Devnet-only address; v2/v3/bridge paths revert (no counterparties) |
| `Permit2` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Canonical mainnet address, 9,152 bytes |
| `WETH9` | `0x1b7d32025F7cA633943BbCC9Ec61a98ef66187b6` | Canonical; wrap devnet ETH |
| `USDC` (FiatTokenV2_2) | `0xEFe0D421fD473564c9C9b0cDCeB194cF476D6AF5` | **6 decimals**; bytecode identical to mainnet |

Verified 2026-11-07 through the self-hosted node (`eth_getCode` sizes match
the canonical builds). The only v4-adjacent build left is `DaoSwapModule`
itself: solc 0.8.28 with the repo's shanghai settings, importing only
v4 interfaces/types (never `PoolManager.sol`).

**Gate:** passed — sizes match, no deployment needed.

### Phase 2 - deploy the singleton (done, predeployed)

Nothing to deploy. The remaining deployable is `DaoSwapModuleFactory` (per-DAO
module), which is part of the DAO stack, not v4. `PoolManager.owner` is the
mainnet Uniswap governance address baked into the replayed bytecode — protocol
fees are ungovernable here, which is fine for the demo.

**Gate:** passed — `StateView.getSlot0`/`getLiquidity` answer on the pool below.

### Phase 3 - create and seed pools (done 2026-11-07)

Seeded with `scripts/v4-seed.mjs` (wrap WETH9, approve Permit2, then
`PositionManager.multicall([initializePool, modifyLiquidities])` with
`MINT_POSITION` + `SETTLE_PAIR`). Same parameters as the documented pool, so
the pool id matches it exactly:

| Field | Value |
|---|---|
| Pool | WETH9 / USDC, fee 3000, tick spacing 60, no hooks |
| Pool id | `0x784bd7879f8155eda79b7834d53c2f19ace60aed221fe33ef03ce660eff60648` |
| Init price | 1 WETH = 3000 USDC (`sqrtPriceX96 = 4339505179874779662909440`) |
| Range | ticks -202260..-190260 (~1 WETH + ~3000 USDC) |
| Position NFT | token id 13, deployer-owned |
| Liquidity | 89830317719081 |
| Seed tx | `0xcd9d13094f6a85f47bc8a87083f907d131ffc91411da0232b616be5641783b16` |

Full record: `deployments/v4-1337.json` (`canonical` section). The same file
keeps the earlier slice's evidence alongside: the vendored PoolManager +
StateView deployment, the mock-token demo pool with both-direction smoke swaps,
and the native-ETH/mock-USDC pool with its `TreasuryFundHelper`
(`scripts/seed-usdc-pool.mjs`). The canonical pool above is the real-asset path;
the mock pools remain usable for faucet-style tests. If the devnet ever resets,
re-running `scripts/v4-seed.mjs` recreates this pool (the id is deterministic
from the key + price).

Note the decimals: real USDC has **6** decimals, WETH 18 — every amount in
`SwapRequest` and every cap touching these tokens must use raw units, not
`parseEther`.

**Gate:** passed — `getSlot0` matches the init price and liquidity is
89830317719081 (see `deployments/v4-1337.json`).

### Phase 4 - direct swap smoke test

Test the pool before testing the module: call `PoolManager` directly from a
small seeder/test harness (or use a module test build with an open caller).
Do not add a permanent open-caller mode to the production module. Swap a small
exact-in amount and check:

- the output balance increases by at least `minAmountOut`;
- the PoolManager's token balances match the pool's reserves;
- `getSlot0` moves in the expected direction;
- a second swap in the opposite direction also succeeds.

Then repeat with `minAmountOut` set too high and confirm the whole call reverts
(no token movement, no delta left in the PoolManager).

**Gate:** both the positive and negative cases pass.

### Phase 5 - agent frame swap (tier 1)

Build one frame tx:

```
VERIFY(AgentAccount) -> DEFAULT(paymaster.charge) -> VERIFY(paymaster)
-> SENDER(DaoCore.spend)  [ATOMIC_BATCH]
-> SENDER(DaoSwapModule.swap)
```

The agent signs for the AgentAccount; `tx.sender` is the AgentAccount. Set the
swap frame's `executionGas` to ~350k and `stateGas` to ~400k (a cold v4 swap
writes several slots). Confirm:

- `tokenCaps[USDC].spent` increases by `amountIn`;
- the RWA balance of DaoCore increases;
- the `Spent` and `Swapped` events are present (`ACTION_SWAP` is emitted only
  on the tier-3 path, through `recordSwap`);
- replaying the same frame with the same nonce fails.

Then force the swap to fail (bad `minAmountOut`) and confirm the preceding
`spend` is rolled back and the cap is unchanged. That is the atomic-batch test.

**Gate:** the tier-1 path works and the rollback test passes.

### Phase 6 - above-cap proposal (tier 3)

1. Create a proposal targeting `DaoSwapModule.swapAboveCap` with a request
   above the per-tx cap.
2. Vote and execute after the deadline.
3. Confirm the input moved from the treasury to the module and the output came
   back to the treasury, with no cap debit (the above-cap path bypasses the cap,
   as `spendAboveCap` does).

**Gate:** the proposal executes and the balances reconcile.

### Phase 7 - gas top-up

1. Seed the USDC/ETH pool.
2. Run the tier-1 swap with `zeroForOne = false`.
3. Spend the ETH output to the paymaster (`minAmountOut` is the safe amount).
4. Confirm the paymaster's balance increases and `charge()` still succeeds on a
   later frame tx.

**Gate:** the paymaster's tank grows and a sponsored frame still runs.

### Phase 8 - record and review

Write `deployments/v4-1337.json` with:

- chain id, RPC, block number;
- source commits/tags for v4-core, v4-periphery, permit2, universal-router (if used);
- compiler version and settings, optimizer runs, `viaIR`, `bytecode_hash`;
- every deployed address and its runtime size;
- PoolManager owner;
- each `PoolKey`, pool id, initial price, fee/tick spacing/hook;
- the DAO address and swap module address;
- the cap configuration and the max trade size used in the smoke tests.

Run `node --test "test/*.test.mjs"` and the UI typecheck before calling the
integration done. The existing tests do not cover v4; add unit tests for the
module (allowlist, deadline, recipient, slippage, native/ERC-20 settlement).

Do not try to run v4 on the repo's ganache: ganache 7.9.2 rejects
`hardfork: "cancun"` with `Hardfork cancun not set as supported`. Use a
Cancun-capable node (anvil/hardhat) for a local PoolManager, or test against the
devnet. Keep the DAO unit tests on ganache.

---

## 10. Security checklist

- [ ] `PoolManager` is the canonical build; its owner is the DAO/timelock.
- [ ] Only allowlisted `PoolId`s are swappable; the id is recomputed from the
      supplied key.
- [ ] The module's recipient is immutable (`dao`); `minAmountOut` and `deadline`
      are mandatory.
- [ ] `unlockCallback` checks `msg.sender == poolManager`.
- [ ] The module holds no standing balance and grants no standing allowance.
- [ ] `swapAboveCap` has no `nonReentrant` (it runs inside `executeProposal`).
- [ ] Native input uses `settle{value}`; native output goes to a payable
      recipient (DaoCore has `receive()`).
- [ ] The hook allowlists a contract address, not `tx.origin`.
- [ ] Caps are debited by `spend`, and the tier-3 path is the only bypass.
- [ ] `DaoGasPaymaster`/`DaoVotePaymaster` can receive ETH (add `receive()` or
      fund through `deposit()`).
- [ ] The UI labels the price source as a mock and does not present spot as an
      oracle.
- [ ] v4-core is BUSL-1.1; review the license before any use beyond the demo.

---

## 11. Open questions

1. Per-DAO module (recommended) or one shared module with a registry? The hook
   and the caller check are simpler per-DAO; deployment cost is the trade-off.
2. Does the tier-1 path stay as `spend` + `swap`, or do we spend the 931 bytes
   on a `DaoCore.swapTreasury` wrapper? Measure `DaoCoreFactory` first.
3. Is the Universal Router needed for the demo UI, or is the direct module
   enough? Adding it brings Permit2 and two near-limit contracts.
4. Do we add a reference-price floor (`maxSlippageBps`) to the module, or rely
   on the agent's `minAmountOut` and off-chain simulation for the demo?
5. Is the RWA pool a real ERC-20, or a wrapper around the existing
   `AssetModule` mock? The two stories should not be conflated in the UI.

---

## Appendix A - Universal Router path (optional)

If the UI uses the router, use Universal Router 2.1.2 and Permit2. The on-chain
encoding is:

```solidity
bytes memory commands = abi.encodePacked(uint8(0x10)); // V4_SWAP
bytes memory actions = abi.encodePacked(
    uint8(0x06), // SWAP_EXACT_IN_SINGLE
    uint8(0x0c), // SETTLE_ALL
    uint8(0x0f)  // TAKE_ALL
);
bytes[] memory params = new bytes[](3);
params[0] = abi.encode(IV4Router.ExactInputSingleParams({
    poolKey: key,
    zeroForOne: true,
    amountIn: amountIn,
    amountOutMinimum: minAmountOut,
    hookData: ""
}));
params[1] = abi.encode(key.currency0, amountIn);    // SETTLE_ALL
params[2] = abi.encode(key.currency1, minAmountOut); // TAKE_ALL
bytes[] memory inputs = new bytes[](1);
inputs[0] = abi.encode(actions, params);
router.execute(commands, inputs, deadline);
```

The router pulls the input through Permit2, so the caller must approve Permit2
and Permit2 must approve the router. The output goes to the caller (`msgSender`),
which is DaoCore if DaoCore is the caller. Reset the Permit2 allowance after the
swap. This is exactly the path the v4 swap guide documents; it is not required
for the treasury path.

## Appendix B - commands

```powershell
# probe: chain id, gas limit, TSTORE/TLOAD and MCOPY (scripts/v4-probe.mjs)
node scripts/v4-probe.mjs --rpc $env:DEVNET_RPC

# build the pinned v4 sources with the v4-core settings
forge build --root vendor/v4-core

# deploy PoolManager, StateView, optional periphery, and the DAO stack
node scripts/deploy-v4.mjs

# create + seed a pool, then run one swap
node scripts/v4-seed.mjs
node scripts/v4-swap-smoke.mjs

# existing regression suite
node --test "test/*.test.mjs"
```

`deploy-v4.mjs`, `v4-seed.mjs` and `v4-swap-smoke.mjs` do not exist yet. They
should follow the patterns in `scripts/deploy-dao.mjs` (viem, raw JSON-RPC,
`compileAll` for the local contracts) and write `deployments/v4-1337.json`.

## Appendix C - sources

- v4 overview: https://developers.uniswap.org/docs/protocols/v4/overview
- Get started: https://developers.uniswap.org/docs/protocols/v4/guides/getting-started
- Swapping: https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping
- Routing: https://developers.uniswap.org/docs/protocols/v4/guides/swapping/routing
- Create pool: https://developers.uniswap.org/docs/protocols/v4/guides/create-pool
- Mint position: https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/mint-position
- Read pool state: https://developers.uniswap.org/docs/protocols/v4/guides/read-pool-state
- Deployments: https://developers.uniswap.org/docs/protocols/v4/deployments
- Hooks: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/getting-started
- `msg.sender` in hooks: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/accessing-msg.sender
- Hook deployment: https://developers.uniswap.org/docs/protocols/v4/guides/hooks/hook-deployment
- Hook security: https://developers.uniswap.org/docs/protocols/v4/security
- Universal Router commands: https://developers.uniswap.org/docs/protocols/universal-router/concepts/commands
- Permit2: https://developers.uniswap.org/docs/protocols/permit2/overview
- Uniswap API supported chains: https://developers.uniswap.org/docs/trading/swapping-api/supported-chains
- v4-core build settings: https://github.com/Uniswap/v4-core/blob/main/foundry.toml
