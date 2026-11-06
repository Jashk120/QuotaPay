"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Link2,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { shortHash } from "@/lib/dao/hash";
import { utcDate } from "@/lib/dao/format";
import type { DaoState } from "@/lib/dao/types";

export function MembersPanel({
  state,
  update,
  onPrompt,
}: {
  state: DaoState;
  update: (recipe: (draft: DaoState) => void) => void;
  onPrompt: (text: string) => void;
}) {
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const active = state.members.filter((member) => member.active);
  const openInvites = state.invites.filter((invite) => invite.status === "open");

  function createInvite() {
    const label = name.trim();
    if (!label) return;
    const prefix = state.config.daoId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "DAO";
    const code = `${prefix}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    update((draft) => {
      draft.invites.unshift({
        code,
        label,
        issuedAt: Date.now(),
        status: "open",
      });
    });
    setName("");
  }

  async function copyInvite(code: string) {
    const url = `${window.location.origin}/dao/join/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" /> Members
            </CardTitle>
            <CardDescription>
              {active.length} active · {state.members.length - active.length}{" "}
              removed · {openInvites.length} open invite
              {openInvites.length === 1 ? "" : "s"}
            </CardDescription>
          </div>
          <Badge variant="outline">rate limit · {state.capUsage.membersAdded}/{state.config.addMemberRateLimit}</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.members.map((member) => (
            <div
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5"
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
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                  <span title={member.wallet}>
                    {shortHash(member.wallet, 8, 6)}
                  </span>
                  <span title={member.leaf}>
                    leaf {shortHash(member.leaf, 8, 6)}
                  </span>
                  <span className="font-sans">joined {utcDate(member.joinedAt)}</span>
                </div>
              </div>
              {member.active && member.role !== "admin" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onPrompt(`Remove ${member.name}`)}
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
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-primary" /> Invites
          </CardTitle>
          <CardDescription>
            Each code binds to one commitment on first use. The agent adds all
            accepted commitments in one batch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createInvite();
                }
              }}
              placeholder="Invitee name, e.g. Sofia M."
              aria-label="Invitee name"
              className="flex-1"
            />
            <Button onClick={createInvite} disabled={!name.trim()}>
              <UserPlus className="h-4 w-4" /> Create invite
            </Button>
          </div>

          {state.invites.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              No invites yet. Create one, then open its link in a second tab.
            </div>
          ) : (
            <div className="space-y-2">
              {state.invites.map((invite) => (
                <div
                  key={invite.code}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{invite.label}</span>
                      <Badge
                        variant={invite.status === "open" ? "warning" : "success"}
                        className="text-[10px]"
                      >
                        {invite.status}
                      </Badge>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {invite.code}
                      {invite.claimedBy ? ` · claimed by ${invite.claimedBy}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/dao/join/${invite.code}`}>
                        <Link2 className="h-3.5 w-3.5" /> Open
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyInvite(invite.code)}
                    >
                      {copied === invite.code ? (
                        <Check className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied === invite.code ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
