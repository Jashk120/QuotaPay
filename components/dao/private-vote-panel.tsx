"use client";

import { useState } from "react";
import { bytesToHex } from "viem";
import { Check, Loader2, Lock, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { shortHash } from "@/lib/dao/hash";
import type { Proposal } from "@/lib/dao/types";

export type VoteChoice = "yes" | "no" | "abstain";

const STAGES = [
  { id: "proving", label: "Generate proof" },
  { id: "submitting", label: "Submit to paymaster" },
  { id: "done", label: "Nullifier written" },
] as const;

export function PrivateVotePanel({
  proposal,
  onVoted,
  onClose,
}: {
  proposal: Proposal;
  onVoted: (choice: VoteChoice) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"idle" | "proving" | "submitting" | "done">(
    "idle",
  );
  const [choice, setChoice] = useState<VoteChoice | null>(null);
  const [nullifier] = useState(() => bytesToHex(crypto.getRandomValues(new Uint8Array(16))));

  async function vote(next: VoteChoice) {
    setChoice(next);
    setStage("proving");
    await new Promise((resolve) => setTimeout(resolve, 700));
    setStage("submitting");
    await new Promise((resolve) => setTimeout(resolve, 800));
    onVoted(next);
    setStage("done");
  }

  const stageIndex = STAGES.findIndex((item) => item.id === stage);

  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 text-primary" /> Private vote · {proposal.id}
          </div>
          <Badge variant="outline">scope = {proposal.id}</Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          One vote per member per proposal. The proof is bound to a session key,
          gas is sponsored, and the nullifier prevents a second vote.
        </p>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["yes", "For"],
              ["no", "Against"],
              ["abstain", "Abstain"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={value === "yes" ? "default" : "outline"}
              disabled={stage === "proving" || stage === "submitting" || stage === "done"}
              onClick={() => void vote(value)}
              data-testid={`dao-vote-${value}`}
            >
              {label}
            </Button>
          ))}
        </div>

        {stage !== "idle" ? (
          <div className="space-y-1.5">
            {STAGES.map((item, index) => {
              const done = stageIndex > index;
              const active = stageIndex === index;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border border-border" />
                  )}
                  {item.label}
                </div>
              );
            })}
            <div className="flex items-center gap-2 pt-1 font-mono text-[10px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              nullifier {shortHash(nullifier, 10, 6)}
            </div>
          </div>
        ) : null}

        {stage === "done" ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
            <span>
              Vote recorded for <strong>{choice}</strong> (simulated proof).
            </span>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-3.5 w-3.5" /> Close
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
