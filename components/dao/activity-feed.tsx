"use client";

import {
  Activity,
  Boxes,
  FileText,
  Layers,
  PauseCircle,
  Send,
  ShieldCheck,
  ShoppingCart,
  UserMinus,
  UserPlus,
  Vote,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TierBadge } from "@/components/dao/tier-badge";
import { utcDateTime } from "@/lib/dao/format";
import { shortHash } from "@/lib/dao/hash";
import type { ActionType, DaoState } from "@/lib/dao/types";

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

export function ActivityFeed({ state }: { state: DaoState }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" /> Audit log
        </CardTitle>
        <CardDescription>
          Every executed action records the tier, authorizers, promptHash,
          planHash and transaction hash.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {state.events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
            Nothing executed yet.
          </div>
        ) : (
          state.events.map((event) => {
            const Icon = ICONS[event.action] ?? Activity;
            return (
              <div
                key={event.id}
                className="flex gap-3 border-b border-border/40 py-2.5 last:border-0"
                data-testid="dao-activity-row"
              >
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{event.title}</span>
                    <TierBadge tier={event.tier} />
                    {event.simulated ? (
                      <Badge variant="outline" className="text-[10px]">
                        simulated
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{utcDateTime(event.at)}</span>
                    <span>by {event.authorizers.join(", ")}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                    <span title={event.txHash}>
                      tx {shortHash(event.txHash, 10, 6)}
                    </span>
                    <span title={event.promptHash}>
                      prompt {shortHash(event.promptHash, 8, 4)}
                    </span>
                    <span title={event.planHash}>
                      plan {shortHash(event.planHash, 8, 4)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
