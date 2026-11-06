"use client";

import { Coins, Gauge, Send, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { money, percent, utcDateTime } from "@/lib/dao/format";
import { shortHash } from "@/lib/dao/hash";
import { TierBadge } from "@/components/dao/tier-badge";
import type { DaoState } from "@/lib/dao/types";

export function TreasuryPanel({
  state,
  onPrompt,
}: {
  state: DaoState;
  onPrompt: (text: string) => void;
}) {
  const used = state.capUsage.periodSpent;
  const cap = state.config.perPeriodCap;
  const usage = percent(used, cap);
  const payouts = state.events.filter((event) => event.action === "pay");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          icon={<Wallet className="h-4 w-4" />}
          label="Treasury"
          value={`${money(state.config.treasuryUsdc)} USDC`}
          hint="gas budget tracked separately"
        />
        <Stat
          icon={<Gauge className="h-4 w-4" />}
          label="Per-transaction cap"
          value={money(state.config.perTxCap)}
          hint="above this becomes tier 3"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-primary" /> Period spend
          </CardTitle>
          <CardDescription>
            Cumulative caps are re-checked inside DaoCore, not just in VERIFY.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <span className="text-2xl font-semibold tracking-tight">
              {money(used)}
            </span>
            <span className="text-xs text-muted-foreground">of {money(cap)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-300 transition-all"
              style={{ width: `${usage}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{usage}% of the period cap used</span>
            <Badge variant="outline">
              headroom {money(Math.max(0, cap - used))}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Try a payout</CardTitle>
          <CardDescription>
            A small payout executes at tier 1. One above a cap flips the same
            plan to a governance proposal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onPrompt("Pay October contributors $150")}>
            <Send className="h-3.5 w-3.5" /> Pay $150
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPrompt("$800 spend for the design team")}
          >
            <Send className="h-3.5 w-3.5" /> Spend $800
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPrompt("Pay contributors $50")}
          >
            Pay $50
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent payouts</CardTitle>
          <CardDescription>From the DaoCore audit events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {payouts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              No payouts yet.
            </div>
          ) : (
            payouts.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{event.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {utcDateTime(event.at)} · {event.authorizers.join(", ")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TierBadge tier={event.tier} />
                  <span
                    className="font-mono text-[10px] text-muted-foreground"
                    title={event.txHash}
                  >
                    {shortHash(event.txHash, 8, 4)}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="text-primary">{icon}</span>
          {label}
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
