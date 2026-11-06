const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export const config = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1337),
  rpcUrl:
    process.env.NEXT_PUBLIC_RPC_URL ??
    "https://altmempool.forshtat.com/rpc",
  gatewayUrl:
    process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://altmempool.forshtat.com",
  factoryAddress: (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "") as
    | `0x${string}`
    | "",
  defaultPaymaster: (process.env.NEXT_PUBLIC_DEFAULT_PAYMASTER ?? "") as
    | `0x${string}`
    | "",
  zkPaymaster: (process.env.NEXT_PUBLIC_ZK_PAYMASTER ?? "") as
    | `0x${string}`
    | "",
  zkAssetsBase: process.env.NEXT_PUBLIC_ZK_ASSETS_BASE ?? "/zk",
  zkDefaultEpoch: process.env.NEXT_PUBLIC_ZK_EPOCH ?? "0",
  zkDefaultRoot: process.env.NEXT_PUBLIC_ZK_ROOT ?? "",
  stakingRegistry: (process.env.NEXT_PUBLIC_STAKING_REGISTRY ??
    "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f") as `0x${string}`,
  explorerUrl:
    process.env.NEXT_PUBLIC_EXPLORER_URL ??
    "https://explorer.altmempool.wtf",
  demoMode,
  submitEnabled:
    !demoMode && process.env.NEXT_PUBLIC_ENABLE_SUBMIT === "true",
  anonSpecifier:
    process.env.NEXT_PUBLIC_ANON_RPC_SPECIFIER ??
    "0x4fd77be300f31c5fe6ab266d35d27750a3478d27",
  anonBootstrapRpc:
    process.env.NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC ??
    "https://ethereum-rpc.publicnode.com",

  // ---- DAO operator (on-chain mode) -------------------------------------
  // Set NEXT_PUBLIC_DAO_CORE to the deployed DaoCore. The console reads every
  // member, cap, proposal, asset, balance and event from the chain. Without it
  // the console shows an empty "not configured" state — never local data.
  daoCoreAddress: (process.env.NEXT_PUBLIC_DAO_CORE ?? "") as
    | `0x${string}`
    | "",
  daoFactoryAddress: (process.env.NEXT_PUBLIC_DAO_FACTORY ?? "") as
    | `0x${string}`
    | "",
  daoGasPaymaster: (process.env.NEXT_PUBLIC_DAO_GAS_PAYMASTER ?? "") as
    | `0x${string}`
    | "",
  /** Optional Chainlink USDC/USD aggregator. Display only. */
  chainlinkUsdcUsd: (process.env.NEXT_PUBLIC_CHAINLINK_USDC_USD ?? "") as
    | `0x${string}`
    | "",
  /** Optional Uniswap v4 StateView + pool id. Display only. */
  daoStateView: (process.env.NEXT_PUBLIC_DAO_STATE_VIEW ?? "") as
    | `0x${string}`
    | "",
  daoPoolId: (process.env.NEXT_PUBLIC_DAO_POOL_ID ?? "") as `0x${string}` | "",
  daoName: process.env.NEXT_PUBLIC_DAO_NAME ?? "",
  usdcAddress: (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "") as
    | `0x${string}`
    | "",
  usdcDecimals: Number(process.env.NEXT_PUBLIC_USDC_DECIMALS ?? 6),
  daoRefreshMs: Number(process.env.NEXT_PUBLIC_DAO_REFRESH_MS ?? 15000),
};

/** True when a factory address is configured, i.e. admin actions can go on-chain. */
export const isLiveConfigured = !demoMode && Boolean(config.factoryAddress);

/**
 * True when a DaoCore address is configured. The DAO console then treats the
 * chain as the source of truth and executes plans through the agent.
 */
export const isDaoChainConfigured = Boolean(config.daoCoreAddress);

export const demoDefaults = {
  globalCreditLimit: 500n,
  creditPerTx: 1n,
  maxSponsorCost: 2_000_000_000_000_000n, // 0.002 ETH
  companyPeriodLength: 2_592_000, // 30 days
  withdrawalDelay: 86_400, // 1 day
  perPeriodLimit: 100n,
  beneficiaryPeriodLength: 2_592_000,
};
