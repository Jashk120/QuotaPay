"use client";

import { useCallback, useEffect, useState } from "react";
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
 */
export function useDaoState() {
  const [state, setState] = useState<DaoState>(() => seedDao());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(loadDao());
    setReady(true);

    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(DAO_CHANNEL)
        : null;
    if (channel) {
      channel.onmessage = () => setState(loadDao());
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === DAO_STORAGE_KEY) setState(loadDao());
    };
    window.addEventListener("storage", onStorage);

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveDao(state);
    broadcastDao();
  }, [state, ready]);

  const update = useCallback((recipe: (draft: DaoState) => void) => {
    setState((previous) => {
      const draft = structuredClone(previous);
      recipe(draft);
      return draft;
    });
  }, []);

  const replace = useCallback((next: DaoState) => {
    setState(next);
  }, []);

  const reset = useCallback(() => {
    setState(seedDao());
  }, []);

  return { state, ready, update, replace, reset };
}
