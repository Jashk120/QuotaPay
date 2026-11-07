"use client";

import {
  Activity,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  FileText,
  Gauge,
  KeyRound,
  Layers,
  PauseCircle,
  Send,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  UserMinus,
  UserPlus,
  Vote,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TierBadge } from "@/components/dao/tier-badge";
import { config } from "@/lib/config";
import { money, utcDateTime } from "@/lib/dao/format";
import { cn } from "@/lib/utils";
import type {
  ActionType,
  DaoEvent,
  DaoState,
  DaoTransaction,
  DaoTransactionKind,
} from "@/lib/dao/types";

const ICONS: Record<ActionType, typeof Activity> = {
  add_members: UserPlus,
  pay: Send,
  acquire_asset: ShoppingCart,
  remove_member: UserMinus,
  change_role: ShieldCheck,
  dispose_asset: Boxes,
  propose: FileText,
  update_policy: ShieldCheck,
  pause: PauseCircle,
  summarize: Activity,
  vote: Vote,
  frame: Layers,
};

const TX_ICONS: Record<DaoTransactionKind, typeof Activity> = {
  create: Sparkles,
  deposit: ArrowDownToLine,
  funding: Sparkles,
  transfer_in: ArrowDownLeft,
  transfer_out: ArrowUpRight,
  spend: Send,
  member_add: UserPlus,
  member_remove: UserMinus,
  role: ShieldCheck,
  proposal: FileText,
  vote: Vote,
  proposal_executed: CheckCircle2,
  asset_allowed: ShoppingCart,
  asset_cap: Gauge,
  acquired: ShoppingCart,
  disposed: Boxes,
  token_cap: Gauge,
  admin: ShieldCheck,
  agent_signer: KeyRound,
  vote_paymaster: Vote,
  pause: PauseCircle,
  swap: ArrowDownUp,
};

type FeedItem =
  | { kind: "event"; at: number; event: DaoEvent }
  | { kind: "tx"; at: number; tx: DaoTransaction };

/**
 * The right-hand chain stream of the operator console. It merges the agent's
 * `ActionExecuted` rows with every other log the DAO produced: treasury
 * transfers, Uniswap funding, member/role changes, proposals, votes, assets and
 * config changes. All values come from the chain; nothing is simulated.
 */
export function TransactionFeed({
  state,
  className,
}: {
  state: DaoState;
  className?: string;
}) {
  const items: FeedItem[] = [
    ...state.events.map((event) => ({
      kind: "event" as const,
      at: event.at,
      event,
    })),
    ...(state.transactions ?? []).map((tx) => ({
      kind: "tx" as const,
      at: tx.at,
      tx,
    })),
  ].sort((a, b) => b.at - a.at);

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 p-4">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-600" />
            </span>
            On-chain activity
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Agent actions, funding, transfers, members, proposals and votes.
          </p>
        </div>
        <Badge variant="outline">{items.length} events</Badge>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 p-6 text-center">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No on-chain activity yet. Fund the treasury, invite a member, or
              ask the agent to pay.
            </p>
          </div>
        ) : (
          <ol className="space-y-1">
            {items.map((item, index) =>
              item.kind === "event" ? (
                <EventRow
                  key={item.event.id}
                  event={item.event}
                  latest={index === 0}
                />
              ) : (
                <TxRow
                  key={item.tx.id}
                  tx={item.tx}
                  latest={index === 0}
                />
              ),
            )}
          </ol>
        )}
      </CardContent>

      <CardFooter className="justify-between border-t border-border/60 p-3 text-[10px] text-muted-foreground">
        <span>Read from chain logs</span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" /> chain-only
        </span>
      </CardFooter>
    </Card>
  );
}

function EventRow({ event, latest }: { event: DaoEvent; latest: boolean }) {
  const Icon = ICONS[event.action] ?? Activity;

  return (
    <li className="relative flex gap-3 py-3">
      <Rail latest={latest} />
      <IconBox latest={latest}>
        <Icon
          className={cn(
            "h-4 w-4",
            latest ? "text-yellow-700" : "text-muted-foreground",
          )}
        />
      </IconBox>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-medium leading-snug">
            {event.title}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
            {utcDateTime(event.at)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TierBadge tier={event.tier} />
          <span className="text-[10px] text-muted-foreground">
            by {event.authorizers.join(", ")}
          </span>
          <TxLink hash={event.txHash} />
        </div>
      </div>
    </li>
  );
}

function TxRow({ tx, latest }: { tx: DaoTransaction; latest: boolean }) {
  const Icon = TX_ICONS[tx.kind] ?? Activity;
  const amount =
    tx.amount != null
      ? `${tx.direction === "out" ? "−" : tx.direction === "in" ? "+" : ""}${
          tx.unit === "ETH" ? tx.amount.toFixed(4) : money(tx.amount)
        } ${tx.unit ?? "USDC"}`
      : null;

  return (
    <li className="relative flex gap-3 py-3">
      <Rail latest={latest} />
      <IconBox latest={latest}>
        <Icon
          className={cn(
            "h-4 w-4",
            latest ? "text-yellow-700" : "text-muted-foreground",
          )}
        />
      </IconBox>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-medium leading-snug">
            {tx.title}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
            {utcDateTime(tx.at)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {amount ? (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                tx.direction === "out"
                  ? "bg-red-50 text-red-700"
                  : tx.direction === "in"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              {amount}
            </span>
          ) : null}
          {tx.detail ? (
            <span className="min-w-0 break-all text-[10px] text-muted-foreground">
              {tx.detail}
            </span>
          ) : null}
          <TxLink hash={tx.txHash} />
        </div>
      </div>
    </li>
  );
}

function Rail({ latest }: { latest: boolean }) {
  if (latest) return null;
  return (
    <span
      className="absolute left-[18px] top-11 h-[calc(100%-1.5rem)] w-px bg-border/70"
      aria-hidden
    />
  );
}

function IconBox({
  latest,
  children,
}: {
  latest: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1",
        latest
          ? "bg-primary/15 ring-primary/35"
          : "bg-secondary ring-border/60",
      )}
    >
      {children}
    </div>
  );
}

function TxLink({ hash }: { hash: string }) {
  if (!hash || hash === "0x") return null;
  const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return (
    <a
      href={`${config.explorerUrl}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      title={hash}
    >
      {short}
    </a>
  );
}
