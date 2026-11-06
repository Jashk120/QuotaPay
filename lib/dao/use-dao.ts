"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { config } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import { readChainSnapshot, snapshotToDaoState } from "./chain";
import { emptyDaoState } from "./empty";
import type { DaoState } from "./types";

export type DaoSource = "chain" | "unconfigured";

/**
 * The operator console has exactly one source of truth: the chain.
 *
 * Pass a `coreAddress` to read a specific DAO (the registry entry for
 * `/dao/<id>/chat`); without it the hook uses `NEXT_PUBLIC_DAO_CORE`. Every
 * member, cap, proposal, asset, balance, policy rule and execution event is
 * read from that contract on each refresh. There is no seed, no localStorage
 * DAO and no simulated execution.
 */
export function useDaoState(options?: {
  coreAddress?: string;
  name?: string;
}) {
  // An explicitly supplied core (even "") wins over the env default, so a
  // /dao/<unknown> route can show "not found" instead of silently reading the
  // env-configured DAO.
  const core =
    options?.coreAddress !== undefined
      ? options.coreAddress
      : config.daoCoreAddress;
  const nameOverride =
    options?.name ??
    (options?.coreAddress !== undefined ? undefined : config.daoName);
  const chainMode = Boolean(core);
  const [state, setState] = useState<DaoState>(() =>
    emptyDaoState(chainMode ? core : ""),
  );
  const [ready, setReady] = useState(!chainMode);
  const [source, setSource] = useState<DaoSource>(
    chainMode ? "chain" : "unconfigured",
  );
  const [chainError, setChainError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!chainMode || !core) {
      setReady(true);
      return;
    }
    setRefreshing(true);
    try {
      const snapshot = await readChainSnapshot(
        publicClient,
        core as Address,
      );
      const next = snapshotToDaoState(snapshot, nameOverride);
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
  }, [chainMode, core, nameOverride]);

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
