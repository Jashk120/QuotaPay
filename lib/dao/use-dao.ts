"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { config, isDaoChainConfigured } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import { readChainSnapshot, snapshotToDaoState } from "./chain";
import { loadLabels, patchLabels } from "./labels";
import { seedDao } from "./seed";
import {
  DAO_CHANNEL,
  DAO_STORAGE_KEY,
  broadcastDao,
  loadDao,
  saveDao,
} from "./store";
import type { DaoState } from "./types";

export type DaoSource = "local" | "chain";

/**
 * One client-side source of truth for the operator console.
 *
 * Chain mode (NEXT_PUBLIC_DAO_CORE set): DaoCore is authoritative. The hook
 * hydrates from `readChainSnapshot` and polls; localStorage only holds the
 * presentation labels (names, invites) that the chain does not carry.
 *
 * Local mode: the previous demo behaviour, persisted to localStorage and
 * mirrored to other tabs over BroadcastChannel.
 */
export function useDaoState() {
  const chainMode = isDaoChainConfigured;
  const [state, setState] = useState<DaoState>(() => seedDao());
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<DaoSource>(chainMode ? "chain" : "local");
  const [chainError, setChainError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const stateRef = useRef(state);
  const tabId = useRef(`tab-${Math.random().toString(36).slice(2, 10)}`);

  const refresh = useCallback(async () => {
    if (!chainMode) return;
    setRefreshing(true);
    try {
      const snapshot = await readChainSnapshot(
        publicClient,
        config.daoCoreAddress as Address,
      );
      const next = snapshotToDaoState(snapshot, loadLabels());
      stateRef.current = next;
      setState(next);
      setSource("chain");
      setChainError(
        snapshot.warnings.length ? snapshot.warnings.join("; ") : null,
      );
    } catch (cause) {
      setChainError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
      setReady(true);
    }
  }, [chainMode]);

  useEffect(() => {
    if (chainMode) {
      // `refresh` owns `ready`: the console stays in a "connecting" state until
      // the first authoritative read lands, so seed data is never shown as
      // on-chain state.
      void refresh();
      const interval = window.setInterval(
        () => void refresh(),
        Math.max(3_000, config.daoRefreshMs),
      );
      return () => window.clearInterval(interval);
    }

    const loaded = loadDao();
    stateRef.current = loaded;
    setState(loaded);
    setReady(true);

    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(DAO_CHANNEL)
        : null;
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if (event.data?.source === tabId.current) return;
        const next = loadDao();
        stateRef.current = next;
        setState(next);
      };
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== DAO_STORAGE_KEY) return;
      const next = loadDao();
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener("storage", onStorage);

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [chainMode, refresh]);

  const commit = useCallback(
    (next: DaoState) => {
      stateRef.current = next;
      if (chainMode) {
        // Chain state is authoritative: only the label overlay is local, and
        // the next refresh replaces everything else with on-chain values.
        patchLabels((draft) => {
          draft.invites = next.invites;
          draft.daoName = next.config.name;
        });
        setState(next);
        void refresh();
        return;
      }
      saveDao(next);
      broadcastDao(tabId.current);
      setState(next);
    },
    [chainMode, refresh],
  );

  const update = useCallback(
    (recipe: (draft: DaoState) => void) => {
      const draft = structuredClone(stateRef.current);
      recipe(draft);
      commit(draft);
    },
    [commit],
  );

  const replace = useCallback((next: DaoState) => commit(next), [commit]);

  const reset = useCallback(() => {
    if (chainMode) {
      void refresh();
      return;
    }
    commit(seedDao());
  }, [chainMode, refresh, commit]);

  return {
    state,
    ready,
    source,
    chainError,
    refreshing,
    refresh,
    update,
    replace,
    reset,
  };
}
