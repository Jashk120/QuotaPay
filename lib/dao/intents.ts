import { verifyMessage } from "viem";

/** Test mode = no wallet signature required. Toggled from .env. */
export function isTestMode(): boolean {
  return (
    process.env.AGENT_TEST_MODE === "true" ||
    process.env.AGENT_TEST_MODE === "1"
  );
}

export function intentMessage(prompt: string, nonce: string): string {
  return `QuotaPay DAO intent:\n${prompt}\nnonce:${nonce}`;
}

/** Verify EIP-191 signature over intentMessage, or bypass in test mode. */
export async function verifyIntentAuth(opts: {
  prompt: string;
  nonce: string;
  address?: string;
  signature?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (isTestMode()) return { ok: true };
  const { prompt, nonce, address, signature } = opts;
  if (!address || !signature) return { ok: false, reason: "signature required" };
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { ok: false, reason: "bad address" };
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message: intentMessage(prompt, nonce),
      signature: signature as `0x${string}`,
    });
    return valid ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch {
    return { ok: false, reason: "verify failed" };
  }
}
