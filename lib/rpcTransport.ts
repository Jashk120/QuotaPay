/**
 * The single RPC fetch used by every viem/wagmi transport in the app.
 *
 * `anon-rpc` lives in a React provider, while viem/wagmi clients are
 * module-level singletons. The provider installs its sandboxed worker fetch
 * here once it is ready; until then — and if the worker cannot start — the
 * transport falls back to a direct fetch so the UI still works.
 *
 * This file intentionally has no React import so `lib/contracts.ts` and
 * `lib/wagmi.ts` can both use it.
 */

export const directFetch: typeof fetch = (input, init) => fetch(input, init);

let activeFetch: typeof fetch = directFetch;

/** Installed by `AnonRpcProvider` when the worker is ready (or on fallback). */
export function setRpcFetch(fetchImpl: typeof fetch) {
  activeFetch = fetchImpl;
}

export function getRpcFetch() {
  return activeFetch;
}

/**
 * Stable function identity: transports capture this once, and every call is
 * delegated to whichever fetch the provider has installed.
 */
export const rpcFetch: typeof fetch = (input, init) =>
  activeFetch(input, init);
