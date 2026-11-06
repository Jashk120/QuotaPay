"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Link2,
  Loader2,
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
import { resolveMember } from "@/lib/dao/ens";
import type { DaoState } from "@/lib/dao/types";

type Invite = {
  code: string;
  address: string;
  label: string | null;
  commitment: string | null;
  status: "open" | "claimed" | "added";
};

/**
 * Members are read from `DaoCore`. Adding one is a two-step flow:
 *   1. the admin invites a 0x address or ENS name;
 *   2. the member signs a message to derive their secret, and the admin adds
 *      the resulting commitment on-chain.
 */
export function MembersPanel({
  state,
  onPrompt,
  onAddMember,
}: {
  state: DaoState;
  onPrompt: (text: string) => void;
  onAddMember?: (commitment: string, label: string, code: string) => void;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const active = state.members.filter((member) => member.active);

  async function loadInvites() {
    try {
      const res = await fetch(
        `/api/dao/invites?dao=${state.config.coreAddress}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as { invites?: Invite[] };
      setInvites(json.invites ?? []);
    } catch {
      /* offline: keep the current list */
    }
  }

  useEffect(() => {
    void loadInvites();
    const interval = window.setInterval(() => void loadInvites(), 5000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config.coreAddress]);

  async function createInvite() {
    const input = value.trim();
    if (!input) return;
    setBusy(true);
    setMessage(null);
    try {
      const address = await resolveMember(input);
      if (!address) {
        setMessage("Enter a 0x address or a resolvable ENS name.");
        return;
      }
      const res = await fetch("/api/dao/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          dao: state.config.coreAddress,
          address,
          label: input,
        }),
      });
      const json = (await res.json()) as {
        invite?: { code: string };
        error?: string;
      };
      if (!res.ok || !json.invite) {
        setMessage(json.error ?? "Could not create the invite.");
        return;
      }
      setMessage(`${window.location.origin}/join/${json.invite.code}`);
      setValue("");
      await loadInvites();
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
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
                    onClick={() =>
                      onPrompt(`Remove member ${member.index ?? 0}`)
                    }
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-primary" /> Invites
          </CardTitle>
          <CardDescription>
            Add a 0x address or ENS name. The member signs once to derive their
            secret; then you add the commitment on-chain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createInvite();
                }
              }}
              placeholder="0x… or alice.eth"
              aria-label="Member address or ENS name"
              className="flex-1"
            />
            <Button
              onClick={() => void createInvite()}
              disabled={busy || !value.trim()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Create invite
            </Button>
          </div>

          {message ? (
            <div className="break-all rounded-lg border border-border/70 bg-white px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {message}
            </div>
          ) : null}

          {invites.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              No invites yet. Add an address or ENS name above.
            </div>
          ) : (
            invites.map((invite) => {
              const url = `${window.location.origin}/join/${invite.code}`;
              return (
                <div
                  key={invite.code}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">
                        {invite.label ?? invite.address}
                      </span>
                      <Badge
                        variant={
                          invite.status === "open"
                            ? "warning"
                            : invite.status === "claimed"
                              ? "default"
                              : "success"
                        }
                        className="text-[10px]"
                      >
                        {invite.status}
                      </Badge>
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {invite.address}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {invite.status === "open" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copy(url)}
                      >
                        {copied === url ? (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copied === url ? "Copied" : "Copy link"}
                      </Button>
                    ) : invite.status === "claimed" &&
                      invite.commitment &&
                      onAddMember ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          onAddMember(
                            invite.commitment!,
                            invite.label ?? invite.address,
                            invite.code,
                          )
                        }
                      >
                        <Link2 className="h-3.5 w-3.5" /> Add member
                      </Button>
                    ) : (
                      <Badge variant="success" className="text-[10px]">
                        added
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
