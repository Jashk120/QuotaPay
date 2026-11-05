"use client";

import { useCallback, useEffect, useState } from "react";
import { Address, Hex, Secp256k1 } from "ox";

const SESSION_STORAGE_KEY = "quotapay.session-key.v1";

export type SessionKey = {
  privateKey: Hex.Hex;
  address: Address.Address;
};

function derive(privateKey: Hex.Hex): SessionKey {
  const publicKey = Secp256k1.getPublicKey({ privateKey });
  return { privateKey, address: Address.fromPublicKey(publicKey) };
}

export function createSessionKey(): SessionKey {
  return derive(Secp256k1.randomPrivateKey());
}

export function loadSessionKey(): SessionKey | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) return null;
  try {
    return derive(stored as Hex.Hex);
  } catch {
    return null;
  }
}

export function getOrCreateSessionKey(): SessionKey {
  const existing = loadSessionKey();
  if (existing) return existing;
  const created = createSessionKey();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_STORAGE_KEY, created.privateKey);
  }
  return created;
}

export function clearSessionKey() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function useSessionKey() {
  const [session, setSession] = useState<SessionKey | null>(null);

  useEffect(() => {
    setSession(getOrCreateSessionKey());
  }, []);

  const reset = useCallback(() => {
    const next = createSessionKey();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_STORAGE_KEY, next.privateKey);
    }
    setSession(next);
  }, []);

  return { session, reset };
}

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

export function injectedProvider(): Eip1193 | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum;
}

export function useMetaMask() {
  const [address, setAddress] = useState<Address.Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const eth = injectedProvider();
    if (!eth) return;
    try {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      setAddress((accounts[0] as Address.Address) ?? null);
      setChainId(Number(cid));
    } catch {
      // ignore passive refresh failures
    }
  }, []);

  useEffect(() => {
    void refresh();
    const eth = injectedProvider();
    if (!eth) return;
    // Some providers expose events; guard for the minimal EIP-1193 shape.
    const onAccounts = () => void refresh();
    (eth as unknown as { on?: (e: string, cb: () => void) => void }).on?.(
      "accountsChanged",
      onAccounts,
    );
    return () => {
      (eth as unknown as { removeListener?: (e: string, cb: () => void) => void }).removeListener?.(
        "accountsChanged",
        onAccounts,
      );
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    setError(null);
    const eth = injectedProvider();
    if (!eth) {
      setError("No injected wallet found. Install MetaMask.");
      return null;
    }
    try {
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      const first = (accounts[0] as Address.Address) ?? null;
      setAddress(first);
      setChainId(Number(cid));
      return first;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  return { address, chainId, error, connect, refresh };
}
