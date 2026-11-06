"use client";

import {
  AlertTriangle,
  Check,
  CircleSlash,
  FileCode2,
  Loader2,
  Play,
  ShieldCheck,
  Vote,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TierBadge } from "@/components/dao/tier-badge";
import { shortHash } from "@/lib/dao/hash";
import type { Plan } from "@/lib/dao/types";

export function PlanCard({
  plan,
  busy,
  onExecute,
  onRequestSignature,
  onOpenProposal,
  onDismiss,
}: {
  plan: Plan;
  busy: boolean;
  onExecute: (plan: Plan) => void;
  onRequestSignature: (plan: Plan) => void;
  onOpenProposal: (plan: Plan) => void;
  onDismiss: (plan: Plan) => void;
}) {
  const blocking =
    plan.authorization === "agent"
      ? plan.checks.filter((check) => !check.ok)
      : [];
  const needsNoTx = plan.action === "summarize" || plan.action === "propose";

  return (
    <Card
      className="overflow-hidden border-border/80 bg-card/90"
      data-testid="dao-plan"
      data-plan-action={plan.action}
      data-plan-tier={plan.tier}
    >
      <CardHeader className="space-y-3 border-b border-border/60 bg-secondary/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tier={plan.tier} authorization={plan.authorization} />
              {plan.status === "executed" ? (
                <Badge variant="success">executed</Badge>
              ) : plan.status === "awaiting_vote" ? (
                <Badge variant="warning">awaiting vote</Badge>
              ) : plan.status === "awaiting_admin" ? (
                <Badge variant="warning">awaiting admin</Badge>
              ) : plan.status === "rejected" ? (
                <Badge variant="destructive">rejected</Badge>
              ) : (
                <Badge variant="outline">draft</Badge>
              )}
            </div>
            <CardTitle className="text-base">{plan.title}</CardTitle>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            {plan.id}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{plan.summary}</p>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {plan.resolved.length > 0 ? (
          <div className="space-y-2">
            <SectionLabel>Resolved</SectionLabel>
            <div className="space-y-1.5">
              {plan.resolved.map((entity, index) => (
                <div
                  key={`${entity.label}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{entity.label}</div>
                    {entity.meta ? (
                      <div className="text-xs text-muted-foreground">
                        {entity.meta}
                      </div>
                    ) : null}
                  </div>
                  {entity.address ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {shortHash(entity.address, 6, 4)}
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      {entity.kind}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {plan.checks.length > 0 ? (
          <div className="space-y-2">
            <SectionLabel>Pre-checks</SectionLabel>
            <div className="space-y-1">
              {plan.checks.map((check) => (
                <div
                  key={check.label}
                  className="flex items-start gap-2 text-xs"
                  title={check.detail}
                >
                  {check.ok ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : (
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className="w-40 shrink-0 text-muted-foreground">
                    {check.label}
                  </span>
                  <span className="min-w-0 text-foreground/80">
                    {check.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {plan.batchSteps ? (
          <div className="space-y-2">
            <SectionLabel>Atomic batch</SectionLabel>
            <ol className="space-y-1">
              {plan.batchSteps.map((step, index) => (
                <li
                  key={step}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border/70 font-mono text-[10px]">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {plan.warnings.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
            {plan.warnings.map((warning) => (
              <div
                key={warning}
                className="flex items-start gap-2 text-xs text-amber-100"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {warning}
              </div>
            ))}
          </div>
        ) : null}

        {plan.status === "executed" && plan.txHash ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> Executed (simulated)
            </span>
            <span className="font-mono" title={plan.txHash}>
              {shortHash(plan.txHash, 10, 6)}
            </span>
          </div>
        ) : null}

        {blocking.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-100">
            <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Blocked by {blocking.length} failed pre-check
            {blocking.length === 1 ? "" : "s"}. The agent will not submit this.
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {plan.status === "executed" ? null : needsNoTx ? (
            <Button size="sm" variant="secondary" onClick={() => onDismiss(plan)}>
              Dismiss
            </Button>
          ) : plan.authorization === "vote" ? (
            <Button size="sm" onClick={() => onOpenProposal(plan)}>
              <Vote className="h-4 w-4" />
              {plan.status === "awaiting_vote" ? "View proposal" : "Open proposal"}
            </Button>
          ) : plan.authorization === "admin" ||
            plan.authorization === "admin-only" ? (
            <Button size="sm" onClick={() => onRequestSignature(plan)}>
              <ShieldCheck className="h-4 w-4" /> Request admin signature
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onExecute(plan)}
              disabled={busy || blocking.length > 0}
              data-testid="dao-execute"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Approve &amp; execute
            </Button>
          )}
          {plan.status !== "executed" && !needsNoTx ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDismiss(plan)}
              disabled={busy}
            >
              Cancel
            </Button>
          ) : null}
        </div>

        <details className="rounded-lg border border-border/60 bg-background/40 p-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <FileCode2 className="h-3.5 w-3.5" /> Typed action
          </summary>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(
              {
                action: plan.action,
                tier: plan.tier,
                authorization: plan.authorization,
                params: plan.params,
                promptHash: plan.promptHash,
                planHash: plan.planHash,
              },
              null,
              2,
            )}
          </pre>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Hashes are reported by the agent and are informational, not verified.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  );
}
