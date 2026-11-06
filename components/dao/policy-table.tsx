"use client";

import { KeyRound, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TierBadge } from "@/components/dao/tier-badge";
import type { DaoState } from "@/lib/dao/types";

export function PolicyTable({ state }: { state: DaoState }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" /> Agent policy table
          </CardTitle>
          <CardDescription>
            VERIFY reads the SENDER frame target and selector, then checks this
            table. Read-only here; only DaoCore can change it after a vote.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3">Target</th>
                  <th className="pb-2 pr-3">Meaning</th>
                  <th className="pb-2">Tier</th>
                </tr>
              </thead>
              <tbody>
                {state.policy.map((row) => (
                  <tr
                    key={`${row.target}-${row.selector}`}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="py-2.5 pr-3">
                      <span className="rounded-md border border-border/70 bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">
                        {row.target}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {row.label}
                    </td>
                    <td className="py-2.5">
                      <TierBadge tier={row.tier} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-secondary/40 p-3 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Anything not in this table fails at validation, before payment
            approval. That rejection does not enter a block and charges no gas.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-yellow-200 bg-yellow-50/80 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-yellow-900">
            <ShieldCheck className="h-4 w-4" /> Enforced outside the model
          </div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-yellow-800">
            <li>Target and selector allowlist at VERIFY</li>
            <li>Per-transaction and per-period caps in DaoCore</li>
            <li>Admin signature for tier-2 actions</li>
            <li>Member vote for tier-3 actions</li>
          </ul>
        </div>
        <div className="rounded-xl border border-yellow-200 bg-yellow-50/90 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-yellow-900">
            <ShieldAlert className="h-4 w-4" /> A compromised agent can still…
          </div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-yellow-800">
            <li>Spend up to the tier-1 caps</li>
            <li>Add invited members up to the rate limit</li>
            <li>Acquire allowlisted assets up to their caps</li>
          </ul>
          <p className="mt-2 text-[11px] text-yellow-700">
            The loss is bounded, not zero. State that plainly.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What is real here</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-2">
            <span>Intent parser</span>
            <Badge variant="warning">LLM + local rules</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-2">
            <span>Execution and audit events</span>
            <Badge variant="success">on-chain</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-2">
            <span>ZK vote proof</span>
            <Badge variant="warning">staged, not proven</Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Admin signature</span>
            <Badge variant="outline">real EIP-712 when a wallet is connected</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
