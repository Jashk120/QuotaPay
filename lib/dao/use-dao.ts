"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { seedDao } from "./seed";
import {
  DAO_CHANNEL,
  DAO_STORAGE_KEY,
  broadcastDao,
  loadDao,
  saveDao,
} from "./store";
import type { DaoState } from "./types";

/**
 * One client-side source of truth for the demo DAO. Persisted to localStorage
 * (same approach as lib/demo-store.ts) and mirrored to other tabs over
 * BroadcastChannel so the operator console reacts to an invite tab.
 *
 * Only local commits save and broadcast. Remote loads never re-broadcast, which
 * keeps two tabs from ping-ponging state forever.
 */
export function useDaoState() {
  const [state, setState] = useState<DaoState>(() => seedDao());
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  const tabId = useRef(`tab-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
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
  }, []);

  const commit = useCallback((next: DaoState) => {
    stateRef.current = next;
    saveDao(next);
    broadcastDao(tabId.current);
    setState(next);
  }, []);

  const update = useCallback(
    (recipe: (draft: DaoState) => void) => {
      const draft = structuredClone(stateRef.current);
      recipe(draft);
      commit(draft);
    },
    [commit],
  );

  const replace = useCallback((next: DaoState) => commit(next), [commit]);

  const reset = useCallback(() => commit(seedDao()), [commit]);

  return { state, ready, update, replace, reset };
}
