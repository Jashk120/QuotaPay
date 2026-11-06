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
};

/**
 * The DAO list comes from the factory's own `DaoCreated` logs — no local
 * registry. A production deployment would index these with a subgraph or a
 * log indexer; on the devnet, reading from block 0 is fine.
 */
export async function listOnchainDaos(
  client: PublicClient,
): Promise<OnchainDao[]> {
  if (!config.daoFactoryAddress) return [];
  const logs = await client.getLogs({
    address: config.daoFactoryAddress,
    event: DAO_CREATED,
    fromBlock: 0n,
  });
  return logs
    .map((log) => ({
      id: log.args.daoCore as string,
      address: log.args.daoCore as Address,
      daoId: log.args.daoId as Hex,
      admin: log.args.admin as Address,
      agentAccount: log.args.agentAccount as Address,
      funding: (log.args.funding as bigint | undefined) ?? 0n,
      block: log.blockNumber ?? 0n,
      txHash: log.transactionHash as Hex,
    }))
    .reverse();
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
