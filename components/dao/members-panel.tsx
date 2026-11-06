"use client";

import { ShieldCheck, UserMinus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DaoState } from "@/lib/dao/types";

/**
 * Members are read from `DaoCore.leafCommitment` / `memberRole`. There is no
 * local invite list: a membership change is an `addMembers` / `removeMember`
 * transaction, not a row in the browser.
 */
export function MembersPanel({
  state,
  onPrompt,
}: {
  state: DaoState;
  onPrompt: (text: string) => void;
}) {
  const active = state.members.filter((member) => member.active);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" /> Members
          </CardTitle>
          <CardDescription>
            {active.length} active · read from DaoCore
          </CardDescription>
        </div>
        <Badge variant="outline">on-chain</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {state.members.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
            No members on-chain yet.
          </div>
        ) : (
          state.members.map((member) => (
            <div
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-3 py-2.5 shadow-[0_1px_2px_hsl(40_30%_20%/0.03)]"
              data-testid="dao-member-row"
              data-active={member.active}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{member.name}</span>
                  <Badge
                    variant={
                      member.role === "admin"
                        ? "default"
                        : member.role === "contributor"
                          ? "secondary"
                          : "outline"
                    }
                    className="text-[10px]"
                  >
                    {member.role}
                  </Badge>
                  {!member.active ? (
                    <Badge variant="destructive" className="text-[10px]">
                      removed
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {member.leaf}
                </div>
              </div>
              {member.active && member.role !== "admin" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onPrompt(`Remove member ${member.index ?? 0}`)}
                  title="Ask the agent to remove this member"
                >
                  <UserMinus className="h-3.5 w-3.5" /> Remove
                </Button>
              ) : member.role === "admin" ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3" /> admin
                </span>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
