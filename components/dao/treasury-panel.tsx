"use client";

import { Coins, Gauge, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { money, percent, utcDateTime } from "@/lib/dao/format";
import { TierBadge } from "@/components/dao/tier-badge";
import type { DaoState } from "@/lib/dao/types";

export function TreasuryPanel({ state }: { state: DaoState }) {
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
          hint="DAO-owned funds"
        />
        <Stat
          icon={<Gauge className="h-4 w-4" />}
          label="Per-transaction cap"
          value={`${money(state.config.perTxCap)} USDC`}
          hint="above this becomes a vote"
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
              {usage}%
            </span>
            <span className="text-xs text-muted-foreground">of the period cap</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[hsl(45_96%_55%)] to-[hsl(36_92%_52%)] shadow-[0_0_12px_hsl(42_90%_50%/0.5)] transition-all"
              style={{ width: `${usage}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Re-checked inside DaoCore</span>
            <Badge variant="outline">
              {cap > used ? "headroom available" : "cap reached"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payouts</CardTitle>
          <CardDescription>
            A payout needs an on-chain recipient. Ask the agent: “pay 10 USDC to
            0x…”. An amount above the per-tx cap becomes a governance proposal.
          </CardDescription>
        </CardHeader>
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
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-white px-3 py-2 shadow-[0_1px_2px_hsl(40_30%_20%/0.03)]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{event.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {utcDateTime(event.at)}
                  </div>
                </div>
                <TierBadge tier={event.tier} />
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
