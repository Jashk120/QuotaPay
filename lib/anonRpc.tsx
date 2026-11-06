"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnonRpcWorker } from "@anon-rpc/browser-harness";
import { config } from "./config";
import { directFetch, setRpcFetch } from "./rpcTransport";

/**
 * anon-rpc is the default RPC transport. Every read and every frame-tx
 * submission goes through the sandboxed worker; if the worker cannot start
 * (offline devnet, unsupported browser, no mixnet) we fall back to direct RPC
 * and surface that state instead of failing silently.
 *
 * The default specifier is the passthrough worker (no anonymity); set
 * NEXT_PUBLIC_ANON_RPC_SPECIFIER to a real adopter network for privacy.
 */

export type AnonRpcMode = "starting" | "anonymous" | "passthrough" | "direct";

type AnonRpcState = {
  fetch: typeof fetch;
  mode: AnonRpcMode;
  error: string | null;
};

const PASSTHROUGH = "0x4fd77be300f31c5fe6ab266d35d27750a3478d27";

const AnonRpcContext = createContext<AnonRpcState>({
  fetch: directFetch,
  mode: "starting",
  error: null,
});

async function bootstrapRequest(
  method: string,
  params?: unknown[] | object,
) {
  const response = await fetch(config.anonBootstrapRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: params ?? [],
    }),
  });
  const json = (await response.json()) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }
  return json.result;
}

export function AnonRpcProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnonRpcState>({
    fetch: directFetch,
    mode: "starting",
    error: null,
  });
  const workerRef = useRef<AnonRpcWorker | null>(null);

  useEffect(() => {
    let cancelled = false;
    const specifier = (config.anonSpecifier ||
      PASSTHROUGH) as `0x${string}`;
    const isPassthrough =
      specifier.toLowerCase() === PASSTHROUGH.toLowerCase();

    // Don't hold the UI hostage if the anonymity network is unreachable.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setState({
          fetch: directFetch,
          mode: "direct",
          error: "anon-rpc timed out; using direct RPC",
        });
      }
    }, 15_000);

    (async () => {
      try {
        const worker = new AnonRpcWorker({
          address: specifier,
          preExisting: {
            rpcProvider: {
              request: ({
                method,
                params,
              }: {
                method: string;
                params?: unknown[] | object;
              }) => bootstrapRequest(method, params),
            },
          },
        });
        workerRef.current = worker;
        await worker.ready;
        clearTimeout(timeout);
        if (cancelled) return;
        setState({
          fetch: ((input, init) =>
            worker.fetch(input as string, init)) as typeof fetch,
          mode: isPassthrough ? "passthrough" : "anonymous",
          error: isPassthrough
            ? "passthrough worker: this config does not anonymize; set a real anon-rpc specifier"
            : null,
        });
      } catch (error) {
        clearTimeout(timeout);
        if (!cancelled) {
          setState({
            fetch: directFetch,
            mode: "direct",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      workerRef.current?.close?.();
    };
  }, []);

  const value = useMemo(() => state, [state]);

  // Every module-level transport (viem publicClient, wagmi) reads through
  // `rpcFetch`, so install the worker fetch here as soon as it is ready.
  useEffect(() => {
    setRpcFetch(state.fetch);
  }, [state.fetch]);

  useEffect(() => () => setRpcFetch(directFetch), []);

  return (
    <AnonRpcContext.Provider value={value}>
      {children}
    </AnonRpcContext.Provider>
  );
}

export function useAnonRpc() {
  return useContext(AnonRpcContext);
}
