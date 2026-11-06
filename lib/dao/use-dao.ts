"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { config, isDaoChainConfigured } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import { readChainSnapshot, snapshotToDaoState } from "./chain";
import { emptyDaoState } from "./empty";
import type { DaoState } from "./types";

export type DaoSource = "chain" | "unconfigured";

/**
 * The operator console has exactly one source of truth: the chain.
 *
 * `NEXT_PUBLIC_DAO_CORE` names the DaoCore. Every member, cap, proposal, asset,
 * balance, policy rule and execution event is read from that contract (and its
 * AgentAccount/AssetModule) on each refresh. There is no seed, no localStorage
 * DAO and no simulated execution: if the address is missing or the read fails,
 * the console shows an empty state and an error instead of invented data.
 */
export function useDaoState() {
  const chainMode = isDaoChainConfigured;
  const [state, setState] = useState<DaoState>(() =>
    emptyDaoState(chainMode ? config.daoCoreAddress : ""),
  );
  const [ready, setReady] = useState(!chainMode);
  const [source, setSource] = useState<DaoSource>(
    chainMode ? "chain" : "unconfigured",
  );
  const [chainError, setChainError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!chainMode) {
      setReady(true);
      return;
    }
    setRefreshing(true);
    try {
      const snapshot = await readChainSnapshot(
        publicClient,
        config.daoCoreAddress as Address,
      );
      const next = snapshotToDaoState(snapshot);
      setState(next);
      setSource("chain");
      setChainError(
        snapshot.warnings.length ? snapshot.warnings.join("; ") : null,
      );
    } catch (cause) {
      setChainError(cause instanceof Error ? cause.message : String(cause));
      setSource("unconfigured");
    } finally {
      setRefreshing(false);
      setReady(true);
    }
  }, [chainMode]);

  useEffect(() => {
    if (!chainMode) {
      setReady(true);
      return;
    }
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      Math.max(3_000, config.daoRefreshMs),
    );
    return () => window.clearInterval(interval);
  }, [chainMode, refresh]);

  return { state, ready, source, chainError, refreshing, refresh };
}
