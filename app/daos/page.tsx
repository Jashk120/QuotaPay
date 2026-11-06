"use client";

import Link from "next/link";
import { ArrowRight, Bot, Coins, Loader2, Plus, Users, Vote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/lib/dao/format";
import { daoSlug } from "@/lib/dao/slug";
import { useDaoState } from "@/lib/dao/use-dao";

export default function DaosPage() {
  const { state, ready, source } = useDaoState();

  const slug = daoSlug(state.config.name);
  const activeMembers = state.members.filter((member) => member.active);
  const openProposals = state.proposals.filter(
    (proposal) => proposal.status === "open",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Badge variant="outline">Workspace</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            DAOs
          </h1>
        </div>
        <Button asChild size="lg">
          <Link href="/new">
            <Plus className="h-4 w-4" /> Create DAO
          </Link>
        </Button>
      </div>

      {!ready ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      ) : source !== "chain" ? (
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No DAO is configured. Set{" "}
              <span className="font-mono">NEXT_PUBLIC_DAO_CORE</span> to a
              deployed DaoCore, or create one.
            </p>
            <Button asChild>
              <Link href="/new">
                <Plus className="h-4 w-4" /> Create DAO
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          <Link
            href={`/dao/${slug}/chat`}
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
                        {state.config.name}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        /dao/{slug}
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant={state.config.agentPaused ? "warning" : "success"}
                    className="shrink-0"
                  >
                    {state.config.agentPaused ? "paused" : "active"}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Mini
                    icon={<Coins className="h-3 w-3" />}
                    value={money(state.config.treasuryUsdc)}
                    label="USDC"
                  />
                  <Mini
                    icon={<Users className="h-3 w-3" />}
                    value={String(activeMembers.length)}
                    label="members"
                  />
                  <Mini
                    icon={<Vote className="h-3 w-3" />}
                    value={String(openProposals.length)}
                    label="votes"
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
                  Describe it in one prompt, review the config and deploy with an
                  owner signature.
                </p>
              </div>
            </div>
          </Link>
        </div>
      )}
    </div>
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
