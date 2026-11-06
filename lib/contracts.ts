import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { config } from "./config";
import { companyPaymasterAbi } from "./abis";

export const devnet = defineChain({
  id: config.chainId,
  name: "QuotaPay devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

/** Build a read client, optionally routed through anon-rpc's fetch. */
export function makePublicClient(fetchImpl?: typeof fetch) {
  return createPublicClient({
    chain: devnet,
    transport: http(
      config.rpcUrl,
      fetchImpl ? { fetchFn: fetchImpl } : undefined,
    ),
  });
}

export const publicClient = makePublicClient();

export function bytes32FromLabel(label: string): Hex {
  return keccak256(stringToHex(label.trim()));
}

type Eip1193 = {
  request: (args: {
    method: string;
    params?: unknown[] | object;
  }) => Promise<unknown>;
};

export function getInjected(): Eip1193 | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export function getWalletClient(account?: Address) {
  const injected = getInjected();
  if (!injected) throw new Error("No injected wallet found. Install MetaMask.");
  return createWalletClient({
    chain: devnet,
    transport: custom(injected),
    account,
  });
}

export type PaymasterSnapshot = {
  admin: Address;
  treasury: Address;
  companyId: Hex;
  creditPerTx: bigint;
  maxSponsorCost: bigint;
  globalCreditLimit: bigint;
  companySpent: bigint;
  pendingWithdrawals: bigint;
  availableBalance: bigint;
};

export async function readPaymaster(
  paymaster: Address,
  fetchImpl?: typeof fetch,
): Promise<PaymasterSnapshot> {
  const client = fetchImpl ? makePublicClient(fetchImpl) : publicClient;
  const base = { address: paymaster, abi: companyPaymasterAbi } as const;

  const [
    admin,
    treasury,
    companyId,
    creditPerTx,
    maxSponsorCost,
    globalCreditLimit,
    companySpent,
    pendingWithdrawals,
    availableBalance,
  ] = await Promise.all([
    client.readContract({ ...base, functionName: "admin" }),
    client.readContract({ ...base, functionName: "treasury" }),
    client.readContract({ ...base, functionName: "companyId" }),
    client.readContract({ ...base, functionName: "creditPerTx" }),
    client.readContract({ ...base, functionName: "maxSponsorCost" }),
    client.readContract({ ...base, functionName: "globalCreditLimit" }),
    client.readContract({ ...base, functionName: "companySpent" }),
    client.readContract({ ...base, functionName: "pendingWithdrawals" }),
    client.readContract({ ...base, functionName: "availableBalance" }),
  ]);

  return {
    admin,
    treasury,
    companyId,
    creditPerTx,
    maxSponsorCost,
    globalCreditLimit,
    companySpent,
    pendingWithdrawals,
    availableBalance,
  };
}

export async function isAuthorized(
  paymaster: Address,
  wallet: Address,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const client = fetchImpl ? makePublicClient(fetchImpl) : publicClient;
  return client.readContract({
    address: paymaster,
    abi: companyPaymasterAbi,
    functionName: "isAuthorized",
    args: [wallet],
  });
}

export async function readBeneficiary(
  paymaster: Address,
  beneficiaryId: Hex,
  fetchImpl?: typeof fetch,
) {
  const client = fetchImpl ? makePublicClient(fetchImpl) : publicClient;
  return client.readContract({
    address: paymaster,
    abi: companyPaymasterAbi,
    functionName: "beneficiaries",
    args: [beneficiaryId],
  });
}
