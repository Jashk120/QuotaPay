import { createPublicClient, http, isAddress } from "viem";
import { normalize } from "viem/ens";
import { mainnet } from "viem/chains";
import { config } from "@/lib/config";

/**
 * ENS lives on mainnet, not on the QuotaPay devnet. Resolve names through a
 * mainnet RPC; the resulting address is used as the member's public identity.
 */
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(config.anonBootstrapRpc),
});

/** Accept a 0x address or an ENS name and return the address. */
export async function resolveMember(
  input: string,
): Promise<`0x${string}` | null> {
  const value = input.trim();
  if (!value) return null;
  if (isAddress(value)) return value;
  if (!value.includes(".")) return null;
  try {
    return await mainnetClient.getEnsAddress({ name: normalize(value) });
  } catch {
    return null;
  }
}

/** True when the token looks like an address or an ENS name. */
export function looksLikeMember(value: string): boolean {
  return isAddress(value.trim()) || value.trim().includes(".");
}
