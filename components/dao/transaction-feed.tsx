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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TierBadge } from "@/components/dao/tier-badge";
import { utcDateTime } from "@/lib/dao/format";
import { cn } from "@/lib/utils";
import type { ActionType, DaoEvent, DaoState } from "@/lib/dao/types";

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

/**
 * The right-hand execution stream of the operator console. Every plan the
 * agent executes is appended here, newest first, and stays visible while the
 * conversation continues on the left.
 */
export function TransactionFeed({
  state,
  className,
}: {
  state: DaoState;
  className?: string;
}) {
  const events = state.events;

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 p-4">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-600" />
            </span>
            Live executions
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Every action the agent runs lands here.
          </p>
        </div>
        <Badge variant="outline">{events.length} total</Badge>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
        {events.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 p-6 text-center">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing executed yet. Ask the agent to pay, invite or buy something.
            </p>
          </div>
        ) : (
          <ol className="space-y-1">
            {events.map((event, index) => (
              <TransactionRow
                key={event.id}
                event={event}
                latest={index === 0}
              />
            ))}
          </ol>
        )}
      </CardContent>

      <CardFooter className="justify-between border-t border-border/60 p-3 text-[10px] text-muted-foreground">
        <span>Simulated execution · local audit</span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" /> tier-checked
        </span>
      </CardFooter>
    </Card>
  );
}

function TransactionRow({
  event,
  latest,
}: {
  event: DaoEvent;
  latest: boolean;
}) {
  const Icon = ICONS[event.action] ?? Activity;

  return (
    <li className="relative flex gap-3 py-3">
      {!latest ? (
        <span
          className="absolute left-[18px] top-11 h-[calc(100%-1.5rem)] w-px bg-border/70"
          aria-hidden
        />
      ) : null}
      <div
        className={cn(
          "relative grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1",
          latest
            ? "bg-primary/15 ring-primary/35"
            : "bg-secondary ring-border/60",
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4",
            latest ? "text-yellow-700" : "text-muted-foreground",
          )}
        />
      </div>
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
          {event.simulated ? (
            <Badge variant="outline" className="text-[10px]">
              simulated
            </Badge>
          ) : null}
        </div>
      </div>
    </li>
  );
}
