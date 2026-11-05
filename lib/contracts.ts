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

export const publicClient = createPublicClient({
  chain: devnet,
  transport: http(config.rpcUrl),
});

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
): Promise<PaymasterSnapshot> {
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
    publicClient.readContract({ ...base, functionName: "admin" }),
    publicClient.readContract({ ...base, functionName: "treasury" }),
    publicClient.readContract({ ...base, functionName: "companyId" }),
    publicClient.readContract({ ...base, functionName: "creditPerTx" }),
    publicClient.readContract({ ...base, functionName: "maxSponsorCost" }),
    publicClient.readContract({ ...base, functionName: "globalCreditLimit" }),
    publicClient.readContract({ ...base, functionName: "companySpent" }),
    publicClient.readContract({ ...base, functionName: "pendingWithdrawals" }),
    publicClient.readContract({ ...base, functionName: "availableBalance" }),
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
): Promise<boolean> {
  return publicClient.readContract({
    address: paymaster,
    abi: companyPaymasterAbi,
    functionName: "isAuthorized",
    args: [wallet],
  });
}

export async function readBeneficiary(
  paymaster: Address,
  beneficiaryId: Hex,
) {
  return publicClient.readContract({
    address: paymaster,
    abi: companyPaymasterAbi,
    functionName: "beneficiaries",
    args: [beneficiaryId],
  });
}
