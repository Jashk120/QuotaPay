"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { ArrowRight, Bot, Coins, Loader2, Plus, Users, Vote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/lib/dao/format";
import { config } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import {
  daoNameFromId,
  listOnchainDaos,
  type OnchainDao,
} from "@/lib/dao/factory";
import { readChainSummary, type ChainDaoSummary } from "@/lib/dao/chain";
import { useConnectedWallet } from "@/lib/wallet";
import { cn } from "@/lib/utils";

type Tab = "mine" | "all";

export default function DaosPage() {
  const { address, connect } = useConnectedWallet();
  const [tab, setTab] = useState<Tab>("mine");
  const [daos, setDaos] = useState<OnchainDao[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, ChainDaoSummary>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOnchainDaos(publicClient)
      .then((rows) => {
        if (cancelled) return;
        const envCore = config.daoCoreAddress;
        if (
          envCore &&
          !rows.some(
            (row) => row.address.toLowerCase() === envCore.toLowerCase(),
          )
        ) {
          rows.unshift({
            id: envCore,
            address: envCore,
            daoId: "0x",
            admin: envCore,
            agentAccount: envCore,
            funding: 0n,
            block: 0n,
            txHash: "0x",
          });
        }
        setDaos(rows);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setDaos([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!daos?.length) return;
    let cancelled = false;
    void Promise.all(
      daos.map(async (entry) => {
        try {
          const summary = await readChainSummary(publicClient, entry.address);
          return [entry.address, summary] as const;
        } catch {
          return [entry.address, null] as const;
        }
      }),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, ChainDaoSummary> = {};
      for (const [address, summary] of rows) {
        if (summary) next[address] = summary;
      }
      setSummaries(next);
    });
    return () => {
      cancelled = true;
    };
  }, [daos]);

  const adminOf = (entry: OnchainDao) =>
    (summaries[entry.address]?.admin ?? entry.admin).toLowerCase();
  const myDaos = (daos ?? []).filter(
    (entry) => Boolean(address) && adminOf(entry) === address!.toLowerCase(),
  );
  const visible = tab === "mine" ? myDaos : (daos ?? []);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Badge variant="outline">Workspace</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {tab === "mine" ? "Your DAOs" : "All DAOs"}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            A wallet can run any number of DAOs. This list defaults to the ones
            your connected wallet administers.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/new">
            <Plus className="h-4 w-4" /> Create DAO
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1">
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")}>
            My DAOs{address ? ` (${myDaos.length})` : ""}
          </TabButton>
          <TabButton active={tab === "all"} onClick={() => setTab("all")}>
            All DAOs ({daos?.length ?? 0})
          </TabButton>
        </div>
        {!address ? (
          <Button size="sm" variant="outline" onClick={connect}>
            Connect wallet
          </Button>
        ) : null}
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Could not read the factory: {error}
          </CardContent>
        </Card>
      ) : null}

      {tab === "mine" && !address ? (
        <EmptyState
          title="Connect to see your DAOs"
          body="Your wallet is the DAO admin. Connect it to list the DAOs you can operate, or browse everything on the devnet."
          onConnect={connect}
          onBrowseAll={() => setTab("all")}
        />
      ) : daos === null ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      ) : daos.length === 0 ? (
        <EmptyState
          title="No DAOs yet"
          body="No DAO is registered on this factory yet. Create one to get started."
          showCreate
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No DAOs for this wallet"
          body="This wallet does not administer any DAO on this factory yet."
          showCreate
          onBrowseAll={() => setTab("all")}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {visible.map((entry) => (
            <DaoCard
              key={entry.id}
              entry={entry}
              summary={summaries[entry.address]}
            />
          ))}
          <CreateCard />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-white text-foreground shadow-sm ring-1 ring-border/60"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({
  title,
  body,
  showCreate,
  onConnect,
  onBrowseAll,
}: {
  title: string;
  body: string;
  showCreate?: boolean;
  onConnect?: () => void;
  onBrowseAll?: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{body}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {onConnect ? (
            <Button onClick={onConnect}>Connect wallet</Button>
          ) : null}
          {showCreate ? (
            <Button asChild>
              <Link href="/new">
                <Plus className="h-4 w-4" /> Create DAO
              </Link>
            </Button>
          ) : null}
          {onBrowseAll ? (
            <Button variant="outline" onClick={onBrowseAll}>
              Browse all DAOs
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DaoCard({
  entry,
  summary,
}: {
  entry: OnchainDao;
  summary?: ChainDaoSummary;
}) {
  const isEnv =
    Boolean(config.daoCoreAddress) &&
    entry.address.toLowerCase() === config.daoCoreAddress.toLowerCase();
  const name =
    (isEnv ? config.daoName : "") ||
    daoNameFromId(entry.daoId) ||
    `DAO ${entry.address.slice(0, 6)}…${entry.address.slice(-4)}`;
  const balance = summary
    ? money(Number(formatUnits(summary.balance, summary.decimals)))
    : "—";

  return (
    <Link
      href={`/dao/${entry.address}/chat`}
      className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="relative h-full overflow-hidden bg-gradient-to-br from-primary/[0.12] via-white to-[hsl(48_70%_97%)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_2px_4px_hsl(40_30%_20%/0.06),0_22px_50px_-26px_hsl(40_40%_30%/0.35)]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />
        <CardContent className="relative space-y-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-b from-[hsl(48_96%_68%)] to-[hsl(45_92%_55%)] ring-1 ring-[hsl(45_80%_60%/0.5)]">
                <Bot className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold tracking-tight">
                  {name}
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {entry.address.slice(0, 10)}…{entry.address.slice(-6)}
                </div>
              </div>
            </div>
            <Badge
              variant={
                summary?.agentPaused ? "warning" : summary ? "success" : "outline"
              }
              className="shrink-0"
            >
              {summary ? (summary.agentPaused ? "paused" : "active") : "loading"}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Mini
              icon={<Coins className="h-3 w-3" />}
              value={balance}
              label="USDC"
            />
            <Mini
              icon={<Users className="h-3 w-3" />}
              value={summary ? String(summary.memberCount) : "—"}
              label="members"
            />
            <Mini
              icon={<Vote className="h-3 w-3" />}
              value={summary ? String(summary.proposalCount) : "—"}
              label="proposals"
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
            <Badge variant="outline" className="text-[10px]">
              on-chain
            </Badge>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-yellow-800">
              Open <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CreateCard() {
  return (
    <Link
      href="/new"
      className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-white/40 p-6 text-center transition-colors group-hover:border-primary/50 group-hover:bg-primary/[0.05]">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-secondary ring-1 ring-border/60 transition-colors group-hover:bg-primary/15 group-hover:ring-primary/30">
          <Plus className="h-5 w-5 text-muted-foreground group-hover:text-yellow-800" />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">Create a DAO</div>
          <p className="max-w-[22rem] text-xs text-muted-foreground">
            Describe it in one prompt, review the config and deploy with an owner
            signature.
          </p>
        </div>
      </div>
    </Link>
  );
}

function Mini({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-white/70 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="text-yellow-700">{icon}</span>
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
