import type { Hex } from "viem";
import type { BlindToken } from "./blindToken";

const KEY = "quotapay.blind-token.v1";

type Serialized = {
  token: {
    sessionKey: string;
    paymaster: string;
    chainId: string;
    epoch: string;
    maxCost: string;
    serial: Hex;
    signature: Hex;
  };
  createdAt: number;
};

export function saveBlindToken(token: BlindToken) {
  if (typeof window === "undefined") return;
  const stored: Serialized = {
    token: {
      sessionKey: token.sessionKey,
      paymaster: token.paymaster,
      chainId: String(token.chainId),
      epoch: String(token.epoch),
      maxCost: token.maxCost.toString(),
      serial: token.serial,
      signature: token.signature,
    },
    createdAt: Date.now(),
  };
  window.localStorage.setItem(KEY, JSON.stringify(stored));
}

export function loadBlindToken(): BlindToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const { token } = JSON.parse(raw) as Serialized;
    return {
      sessionKey: token.sessionKey as `0x${string}`,
      paymaster: token.paymaster as `0x${string}`,
      chainId: BigInt(token.chainId),
      epoch: BigInt(token.epoch),
      maxCost: BigInt(token.maxCost),
      serial: token.serial,
      signature: token.signature,
    };
  } catch {
    return null;
  }
}

export function findBlindToken(
  sessionKey: string,
  paymaster: string,
): BlindToken | null {
  const token = loadBlindToken();
  if (!token) return null;
  if (token.sessionKey.toLowerCase() !== sessionKey.toLowerCase()) return null;
  if (token.paymaster.toLowerCase() !== paymaster.toLowerCase()) return null;
  return token;
}

export function clearBlindToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(KEY);
  }
}
