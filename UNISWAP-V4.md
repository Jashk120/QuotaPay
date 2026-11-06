# Uniswap v4 treasury swaps: design and devnet runbook

Status: design + runbook. Nothing in this document is implemented or audited.
`DAO.md` remains the source of truth for the existing DAO contracts; this file is
the plan for adding v4.

Target chain: the EIP-8141 / ethrex devnet (chain id 1337), with v4 deployed
from source. The Uniswap API is out of scope there: chain 1337 is not in its
supported-chain list, and a self-deployed PoolManager would not be indexed by
it anyway.

---

## 1. Decisions at a glance

| Topic | Decision |
|---|---|
| Swap path | Direct `PoolManager.unlock` through a new `DaoSwapModule`. Universal Router is optional and stays on the UI side. |
| Where the swap logic lives | `DaoSwapModule` (new contract), not `DaoCore`. `DaoCore` gets at most one small above-cap entry point. |
| Tier 1 (within cap) | `DaoCore.spend(tokenIn, module, amountIn)` + `module.swap(...)` in one atomic frame batch. |
| Tier 3 (above cap) | Proposal -> `DaoCore.swapAboveCap(...)` (self-call), which forwards the input and calls the module. |
| Caps | Reuse the per-token `tokenCaps` accounting. The tier-1 cap is denominated in the input token (USDC), so no oracle is needed on that path. |
| Pool selection | Pools are allowlisted by `PoolId`; the agent never supplies an arbitrary `PoolKey`. |
| Exact-in / exact-out | Exact-in at tier 1. Exact-out at tier 3 only; the input amount is unknown before execution. |
| Slippage | Mandatory `deadline` and `minAmountOut > 0`. A mock reference price may add a floor; pool spot is not a cap source. |
| Valuation | Keep `AssetModule.unitPrice` (mock) for asset caps. Use `StateView.getSlot0` for display and a sanity bound only. |
| Native ETH | `currency0 = address(0)`; the PoolManager holds native ETH. DaoCore already has `receive()`. |
| Hook (stretch) | Per-DAO permissioned RWA hook; allowlist the module address, not `tx.origin`. |
| v4 version | Pin the source commit/tag and compile with the v4-core settings (below). Do not mix builds. |

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

Measured from the local artifact cache on 2026-11-06 (and from mainnet
`eth_getCode` for the Uniswap contracts):

| Contract | Runtime | EIP-170 limit | Headroom |
|---|---:|---:|---:|
| `DaoCore` | 21,443 | 24,576 | 3,133 |
| `DaoCoreFactory` | 23,645 | 24,576 | **931** |
| v4 `PoolManager` | 24,009 | 24,576 | **567** |
| v4 `PositionManager` | 23,877 | 24,576 | 699 |
| Universal Router 2.1.2 | 24,380 | 24,576 | **196** |
| v4 `StateView` | 3,531 | — | — |
| `Permit2` | 9,152 | — | — |

The binding constraint is `DaoCoreFactory`, not `DaoCore`: the factory stores
the `DaoCore` creation code, so every byte added to `DaoCore` is a byte added to
the factory. The swap module must **not** be deployed by `DaoCoreFactory`; it
can go through a fourth child factory (matching the existing pattern) or
directly through `DaoFactory`, which is only 3,343 bytes and has room. A child
factory keeps the orchestrator small and keeps the deployment shape uniform.

If `DaoCore` cannot stay under the limit, the fallback is to drop
`swapAboveCap` and let the module be the proposal target; the module then needs
a way to pull from the treasury, which means a governance-only approval
function. That is a larger change than it sounds, so budget the 931 bytes
carefully.

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
DaoCore.executeProposal -> DaoCore.swapAboveCap(req)
   -> transfer input to module
   -> module.swap(req) -> PoolManager
   -> output to DaoCore
```

### 4.1 Contracts

| Contract | Owner | Responsibility |
|---|---|---|
| `DaoSwapModule` | one per DAO | Holds the v4 wiring, implements `IUnlockCallback`, enforces the pool allowlist, `deadline`, `minAmountOut`, and the caller check. Holds input tokens only for the duration of one atomic batch. |
| `DaoSwapModuleFactory` | chain (optional) | Deploys a module for a DAO with `(poolManager, dao, agentAccount)`. A child factory matches the existing pattern; `DaoFactory` could also deploy it directly. |
| `DaoCore` (delta) | per DAO | `swapModule` address, `initializeSwapModule`, `swapAboveCap`, the `ACTION_SWAP` audit constant, and the module policy rule. |
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
    function setPool(PoolKey calldata key, bool allowed) external;
    function poolAllowed(PoolId id) external view returns (bool);
}
```

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
that targets the module; `DaoCore.createProposal` must allow the module target
and the `setPool` selector.

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

Minimum viable change:

```solidity
address public swapModule;

function initializeSwapModule(address module) external onlyFactory {
    require(swapModule == address(0), "swap set");
    require(module != address(0), "module=0");
    require(agentAccount != address(0), "no agent");
    swapModule = module;
    proposalTargetAllowed[module] = true;
    assetSelectorAllowed[IDaoSwapModule.setPool.selector] = true;
    IAgentAccount(agentAccount).setRule(
        module,
        IDaoSwapModule.swap.selector,
        true,
        TIER_AGENT
    );
    emit SwapModuleInitialized(module);
}

// No nonReentrant: executeProposal already holds the guard.
function swapAboveCap(IDaoSwapModule.SwapRequest calldata req)
    external
    onlyGovernance
{
    require(swapModule != address(0), "no swap module");
    address tokenIn = Currency.unwrap(
        req.zeroForOne ? req.key.currency0 : req.key.currency1
    );
    _transfer(tokenIn, swapModule, req.amountIn);
    uint256 amountOut = IDaoSwapModule(swapModule).swap(req);
    emit ActionExecuted(
        // `PoolKey.toId()` comes from PoolIdLibrary's global using-for.
        keccak256(abi.encode(ACTION_SWAP, req.key.toId(), req.amountIn, amountOut)),
        TIER_GOVERNANCE,
        address(this),
        ACTION_SWAP,
        bytes32(0),
        bytes32(0)
    );
}
```

Add `governanceSelector[this.swapAboveCap.selector] = true` in the constructor.
Note that `acquireAssetAboveCap` has the same "no `nonReentrant`" comment for the
same reason.

If the factory size check fails, remove `swapAboveCap` and let a proposal target
the module directly. The module then needs a governance-only way to pull the
input from the treasury; that is the fallback, not the first choice.

### 5.6 Tier and cap mapping

| Action | Tier | Path |
|---|---|---|
| Swap within the input-token cap, allowlisted pool | 1 | `spend` + `module.swap` (atomic batch) |
| Swap above the cap | 3 | proposal -> `DaoCore.swapAboveCap` -> module |
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

Probe the same way the repo already probes `FRAMEDATACOPY`:

| Check | Why |
|---|---|
| `eth_chainId` | Confirm 1337 and that the RPC is the devnet, not a fork. |
| `TSTORE`/`TLOAD` | v4 flash accounting fails without EIP-1153. |
| `MCOPY` + `PUSH0` | The v4 build targets Cancun; `viaIR` output uses these. |
| Contract size | PoolManager is 24,009 bytes; a chain with a lower limit or code instrumentation will reject it. |
| Block gas limit | A swap + settle + take must fit with the frame overhead. |
| Frame-tx support | The DAO path is a frame tx; test one plain swap and one swap inside a SENDER frame. |

Add `contracts/probe/TransientProbe.sol` next to `FrameReadProbe.sol`:

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
optimizer runs 200, so it will reject `tstore`. Add a one-off probe compile
(either a second settings block in `test/helpers/compile.mjs` or a small
standalone script) with `evmVersion: "cancun"`, deploy it, and `eth_call`
`roundTrip(0x1234)`. Any revert or empty return means the chain is not ready;
stop. Do not change the DAO contracts' shanghai setting for this.

**Gate:** all six checks pass, and the probe result is recorded in the runbook
output (chain id, gas limit, code-size result, frame result).

### Phase 1 - pin and build v4

Do not use floating branches. Pick a commit/tag for each repo and record it in
`deployments/v4-1337.json`.

v4-core's own build settings (from its `foundry.toml`) are:

```toml
solc = "0.8.26"
evm_version = "cancun"
via_ir = true
optimizer_runs = 44444444
bytecode_hash = "none"
```

Compile with those settings. A solc-js build with different settings may exceed
EIP-170 or produce different gas. Foundry is the documented path; if it is not
available on the build machine, use solc-js 0.8.26 with the same settings and
compare the deployed runtime size to the canonical 24,009 bytes.

The v4 singleton and the DAO-side module are two builds:

- v4 core (`PoolManager`, `StateView`, periphery) with solc 0.8.26 and the
  settings above.
- `DaoSwapModule` with the repo's solc 0.8.28 and existing shanghai settings.
  It must import only v4 interfaces/types, not `PoolManager.sol` or other
  implementation files. v4-core mixes exact (`pragma solidity 0.8.26;`) and
  caret pragmas; a 0.8.28 compiler will reject an exact 0.8.26 file.
- Vendor the handful of v4 interfaces/types the module needs under a local path
  and add that path to `test/helpers/compile.mjs`'s `findImports`, or add a
  remapping. Do not vendor the whole v4-core tree into the DAO build.

**Gate:** `PoolManager` runtime bytecode length is 24,009 bytes (or the recorded
build's size, with the reason for the difference). If it is over 24,576, stop.

### Phase 2 - deploy the singleton

Deploy in this order:

1. `PoolManager(initialOwner)`. The current v4-core constructor takes the
   `ProtocolFees` owner; check the pinned tag, because older tags were no-arg.
2. `StateView(poolManager)`.
3. Optional: `Permit2`, `UniversalRouter 2.1.2`, `PositionManager`.
4. `DaoSwapModuleFactory(poolManager)`.
5. The DAO stack (`DaoFactory` with the new child factory wired).

Set `PoolManager` ownership to the DAO admin/timelock, not a throwaway EOA. The
owner controls protocol fees; leaving it with the deployer is an unnecessary
privilege.

**Gate:** `eth_getCode(poolManager).length` matches the build, `owner()` is the
expected address, and `StateView` reads an empty pool id without reverting.

### Phase 3 - create and seed pools

For each pool, record the full `PoolKey` (currencies sorted, fee, tick spacing,
hooks) and the pool id.

1. `initialize(key, sqrtPriceX96)`.
2. Add liquidity. Either:
   - deploy `PositionManager` and use `multicall([initializePool, modifyLiquidities])`
     with `MINT_POSITION` + `SETTLE_PAIR`, or
   - use a small direct seeder that calls `poolManager.unlock` and
     `modifyLiquidity`, then settles both currencies. The direct seeder avoids
     deploying two near-limit contracts and is the recommended demo path.

Initial price: `sqrtPriceX96 = sqrt(token1/token0) * 2^96`, using raw token
units. For a 1:1 pool of 6-decimal USDC and 18-decimal RWA, the raw price is
`1e12`, so `sqrtPriceX96 = 1e6 * 2^96`. Write the number down; do not recompute
it in three different places.

**Gate:** `StateView.getSlot0(poolId).sqrtPriceX96` matches the input and
`getLiquidity(poolId) > 0`.

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
- the `Swapped` and `ActionExecuted(ACTION_SWAP)` events are present;
- replaying the same frame with the same nonce fails.

Then force the swap to fail (bad `minAmountOut`) and confirm the preceding
`spend` is rolled back and the cap is unchanged. That is the atomic-batch test.

**Gate:** the tier-1 path works and the rollback test passes.

### Phase 6 - above-cap proposal (tier 3)

1. Create a proposal targeting `DaoCore.swapAboveCap` with a request above the
   per-tx cap.
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
# probe (script to add next to scripts/frame-read-probe.mjs)
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
