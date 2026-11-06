"use client";

import { useCallback, useEffect, useState } from "react";
import { Address, Hex, Secp256k1 } from "ox";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

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

/**
 * The beneficiary's embedded EIP-8141 wallet. No external wallet (MetaMask,
 * WalletConnect, …) can sign an EIP-8141 frame transaction yet, so we hold a
 * local session key in the browser and use it as the transaction sender.
 */
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

/**
 * Multi-wallet connection for the company admin (MetaMask, WalletConnect,
 * Coinbase, Rainbow, …) backed by wagmi + RainbowKit. `connect` opens the
 * RainbowKit modal. On-chain writes are performed with wagmi's
 * `useWriteContract` in the pages.
 */
export function useConnectedWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  const connect = useCallback(() => {
    openConnectModal?.();
  }, [openConnectModal]);

  return {
    address: address ?? null,
    chainId: chainId ?? null,
    isConnected,
    connect,
    disconnect,
  };
}
