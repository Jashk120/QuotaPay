import {
  formatUnits,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import type { OraclePrice } from "./types";

const chainlinkAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/**
 * Read a Chainlink USDC/USD aggregator. The value is display-only: caps and
 * asset prices stay denominated in the on-chain token amount, so a stale or
 * manipulated feed can never change what a transaction is allowed to do.
 */
export async function readChainlinkUsdcUsd(
  client: PublicClient,
  feed: Address,
): Promise<OraclePrice> {
  const [round, decimals] = await Promise.all([
    client.readContract({
      address: feed,
      abi: chainlinkAbi,
      functionName: "latestRoundData",
    }),
    client.readContract({
      address: feed,
      abi: chainlinkAbi,
      functionName: "decimals",
    }),
  ]);

  const answer = round[1];
  if (answer <= 0n) throw new Error("Chainlink answer is not positive");

  return {
    source: "chainlink",
    usdcUsd: Number(formatUnits(answer, Number(decimals))),
    updatedAt: Number(round[3]) * 1000,
    feed,
  };
}
