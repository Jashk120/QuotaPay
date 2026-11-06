import { NextResponse } from "next/server";
import { Address, Secp256k1 } from "ox";
import type { Hex } from "viem";

/**
 * The public address of the server-held agent key. `DaoFactory.createDao` needs
 * it when a new DAO is deployed, and it is safe to expose: it is the address the
 * AgentAccount will check signatures against, not the key itself.
 */
export async function GET() {
  const key = process.env.DAO_AGENT_KEY as Hex | undefined;
  if (!key) {
    return NextResponse.json(
      { error: "DAO_AGENT_KEY is not configured" },
      { status: 503 },
    );
  }
  try {
    const address = Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: key }),
    );
    return NextResponse.json({ address });
  } catch {
    return NextResponse.json(
      { error: "DAO_AGENT_KEY is invalid" },
      { status: 500 },
    );
  }
}
