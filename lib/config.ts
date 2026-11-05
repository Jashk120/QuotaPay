export const config = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1337),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:14337/rpc",
  gatewayUrl:
    process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://altmempool.forshtat.com",
  factoryAddress: (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "") as
    | `0x${string}`
    | "",
  stakingRegistry: (process.env.NEXT_PUBLIC_STAKING_REGISTRY ??
    "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f") as `0x${string}`,
  explorerUrl:
    process.env.NEXT_PUBLIC_EXPLORER_URL ??
    "https://explorer.altmempool.wtf",
  submitEnabled: process.env.NEXT_PUBLIC_ENABLE_SUBMIT === "true",
};

/** True when a factory address is configured, i.e. admin actions can go on-chain. */
export const isLiveConfigured = Boolean(config.factoryAddress);

export const demoDefaults = {
  globalCreditLimit: 500n,
  creditPerTx: 1n,
  maxSponsorCost: 2_000_000_000_000_000n, // 0.002 ETH
  companyPeriodLength: 2_592_000, // 30 days
  withdrawalDelay: 86_400, // 1 day
  perPeriodLimit: 100n,
  beneficiaryPeriodLength: 2_592_000,
};
