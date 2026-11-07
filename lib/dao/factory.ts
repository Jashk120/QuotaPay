import {
  hexToString,
  parseAbiItem,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { config } from "@/lib/config";

export const DAO_CREATED = parseAbiItem(
  "event DaoCreated(bytes32 indexed daoId, address indexed daoCore, address indexed agentAccount, address assetModule, address admin, uint256 funding)",
);

export type OnchainDao = {
  /** The DaoCore address, also used as the /dao/<id>/chat URL id. */
  id: string;
  address: Address;
  daoId: Hex;
  admin: Address;
  agentAccount: Address;
  funding: bigint;
  block: bigint;
  txHash: Hex;
  /** Factory that emitted DaoCreated (absent for the env fallback). */
  factory?: Address;
};

/**
 * The DAO list comes from factory `DaoCreated` logs — no local registry.
 *
 * Reads every factory in `config.daoFactories`, so DAOs created by an earlier
 * factory deployment do not disappear after a redeploy. A production
 * deployment would replace this with a subgraph or an on-chain registry.
 */
export async function listOnchainDaos(
  client: PublicClient,
  factories: readonly string[] = config.daoFactories,
): Promise<OnchainDao[]> {
  if (!factories.length) return [];
  const logSets = await Promise.all(
    factories.map(async (factory) => {
      try {
        return await client.getLogs({
          address: factory as Address,
          event: DAO_CREATED,
          fromBlock: 0n,
        });
      } catch {
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  return logSets
    .flat()
    .map((log) => ({
      id: log.args.daoCore as string,
      address: log.args.daoCore as Address,
      daoId: log.args.daoId as Hex,
      admin: log.args.admin as Address,
      agentAccount: log.args.agentAccount as Address,
      funding: (log.args.funding as bigint | undefined) ?? 0n,
      block: log.blockNumber ?? 0n,
      txHash: log.transactionHash as Hex,
      factory: log.address as Address,
    }))
    .sort((a, b) => (a.block < b.block ? 1 : a.block > b.block ? -1 : 0))
    .filter((row) => {
      const key = row.address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * `/new` writes the DAO name into the `daoId` bytes32 (padded), so the name is
 * recoverable from the factory log without a separate name contract. Older
 * DAOs used a hash; those fall back to the short address.
 */
export function daoNameFromId(daoId: string): string | null {
  try {
    const text = hexToString(daoId as Hex).replace(/\0/g, "").trim();
    if (!text || text.length > 48) return null;
    if (!/^[\x20-\x7E]+$/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/** Encode a name into a bytes32 `daoId`. */
export function daoIdFromName(name: string): Hex {
  const hex = stringToHex(name.slice(0, 31));
  return `${hex}${"0".repeat(Math.max(0, 66 - hex.length))}` as Hex;
}
