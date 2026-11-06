"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { bytesToHex, keccak256 } from "viem";
import { ArrowRight, Check, Fingerprint, KeyRound, Link2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { shortHash } from "@/lib/dao/hash";
import { useDaoState } from "@/lib/dao/use-dao";

export default function JoinDaoPage() {
  const params = useParams<{ code: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const { state, ready, update } = useDaoState();
  const [secret, setSecret] = useState<`0x${string}` | null>(null);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);

  const invite = state.invites.find(
    (row) => row.code.toLowerCase() === code.toLowerCase(),
  );

  useEffect(() => {
    setSecret(bytesToHex(crypto.getRandomValues(new Uint8Array(32))));
  }, []);

  useEffect(() => {
    if (invite?.label) setName(invite.label);
  }, [invite?.label]);

  const commitment = secret ? keccak256(secret) : null;

  function join() {
    if (!invite || invite.status !== "open" || !commitment) return;
    const memberName = name.trim() || invite.label;
    update((draft) => {
      const row = draft.invites.find((item) => item.code === invite.code);
      if (!row || row.status !== "open") return;
      row.status = "claimed";
      row.commitment = commitment;
      row.claimedBy = memberName;
      draft.members.push({
        id: `m-${Math.random().toString(36).slice(2, 8)}`,
        name: memberName,
        wallet: `0x${commitment.slice(2, 42)}`,
        leaf: commitment,
        role: "member",
        joinedAt: Date.now(),
        active: true,
      });
      draft.events.unshift({
        id: `e-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        action: "add_members",
        tier: 1,
        title: `${memberName} joined via invite ${row.code}`,
        authorizers: ["agent"],
        promptHash: "0x" + "44".repeat(32),
        planHash: "0x" + "55".repeat(32),
        txHash: "0x" + "66".repeat(32),
        simulated: true,
      });
    });
    setJoined(true);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Invite</Badge>
          <Badge variant="secondary" className="font-mono">
            {code || "—"}
          </Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Join {state.config.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your browser generates a secret and a commitment. Only the commitment
          goes onchain; the secret stays in this tab.
        </p>
      </div>

      {!ready ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Looking up the invite…
          </CardContent>
        </Card>
      ) : joined ? (
        <Card className="border-primary/30" data-testid="dao-join-success">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="h-4 w-4 text-primary" /> You&apos;re in
            </CardTitle>
            <CardDescription>
              The operator console sees your commitment as pending; adding all
              accepted commitments is one batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 rounded-lg border border-border/70 bg-background/50 p-3">
              <Row label="Member" value={name || invite?.label || "—"} />
              <Row
                label="Commitment"
                value={shortHash(commitment ?? "", 14, 8)}
                mono
              />
              <Row label="Invite" value={code} mono />
            </div>
            <Button asChild className="w-full">
              <Link href="/">
                Open the operator console <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : !invite ? (
        <div className="space-y-3">
          <Alert variant="warning" title="Invite not found">
            This invite code is not in this browser&apos;s local state. In the
            real flow it comes from the off-chain registry.
          </Alert>
          <Button asChild variant="outline">
            <Link href="/join/ATLAS-1">
              <Link2 className="h-4 w-4" /> Open the demo invite
            </Link>
          </Button>
        </div>
      ) : invite.status === "claimed" ? (
        <Alert variant="warning" title="Invite already claimed">
          This code was bound to {invite.claimedBy ?? "a commitment"} on first
          use. Invite replay is rejected.
        </Alert>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Fingerprint className="h-4 w-4 text-primary" /> Accept invite
            </CardTitle>
            <CardDescription>
              The commitment is single-use and bound to this invite code.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Display name" htmlFor="join-name">
              <Input
                id="join-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <div className="space-y-2 rounded-lg border border-border/70 bg-background/50 p-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5 text-primary" /> Secret generated
                in this tab
              </div>
              <div className="break-all font-mono text-[10px] text-muted-foreground">
                {secret ? shortHash(secret, 18, 12) : "generating…"}
              </div>
              <div className="flex items-center gap-2 border-t border-border/40 pt-2 text-muted-foreground">
                <Fingerprint className="h-3.5 w-3.5 text-primary" /> Commitment
              </div>
              <div className="break-all font-mono text-[10px] text-foreground/80">
                {commitment ? shortHash(commitment, 18, 12) : "—"}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={join}
              disabled={!secret || !commitment || !name.trim()}
              data-testid="dao-join"
            >
              <Check className="h-4 w-4" /> Submit commitment
            </Button>

            <p className="text-[11px] text-muted-foreground">
              UI-only demo: this writes the member and the claimed invite to
              localStorage. The Merkle update is simulated.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`max-w-[70%] truncate text-right ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
