"use client";

import { useState } from "react";
import {
  CheckCircle2,
  FileText,
  Lock,
  Play,
  Plus,
  Users,
  Vote,
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
import { PrivateVotePanel, type VoteChoice } from "@/components/dao/private-vote-panel";
import { utcDate } from "@/lib/dao/format";
import { shortHash } from "@/lib/dao/hash";
import type { DaoState, Proposal } from "@/lib/dao/types";

export function ProposalsPanel({
  state,
  onVoted,
  onSimulateVotes,
  onExecuteProposal,
  onPrompt,
}: {
  state: DaoState;
  onVoted: (proposal: Proposal, choice: VoteChoice) => void;
  onSimulateVotes: (proposal: Proposal) => void;
  onExecuteProposal: (proposal: Proposal) => void;
  onPrompt: (text: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Vote className="h-4 w-4 text-primary" /> Proposals
            </CardTitle>
            <CardDescription>
              Governance actions require a member vote, then the agent executes
              the result onchain.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPrompt("$800 spend for the design team")}
          >
            <Plus className="h-3.5 w-3.5" /> New from prompt
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.proposals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              No proposals. Ask the agent for a spend above the tier-1 cap.
            </div>
          ) : (
            state.proposals.map((proposal) => {
              const total = proposal.yes + proposal.no + proposal.abstain;
              const passed =
                proposal.status === "passed" ||
                proposal.status === "executed" ||
                proposal.yes >= proposal.quorum;
              return (
                <div
                  key={proposal.id}
                  className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-3"
                  data-testid="dao-proposal"
                  data-proposal-id={proposal.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {proposal.id}
                        </span>
                        <Badge
                          variant={
                            proposal.status === "executed"
                              ? "success"
                              : proposal.status === "open"
                                ? "warning"
                                : passed
                                  ? "default"
                                  : "destructive"
                          }
                          className="text-[10px]"
                        >
                          {proposal.status === "open" && passed
                            ? "quorum reached"
                            : proposal.status}
                        </Badge>
                        {proposal.amount ? (
                          <Badge variant="outline" className="text-[10px]">
                            ${proposal.amount.toLocaleString("en-US")}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-sm font-medium">{proposal.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        created {utcDate(proposal.createdAt)} · ends{" "}
                        {utcDate(proposal.endsAt)} · quorum {proposal.quorum}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {proposal.status === "open" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setSelected(
                                selected === proposal.id ? null : proposal.id,
                              )
                            }
                          >
                            <Lock className="h-3.5 w-3.5" /> Vote privately
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onSimulateVotes(proposal)}
                            title="Demo helper: add three member votes"
                          >
                            <Users className="h-3.5 w-3.5" /> +3 votes
                          </Button>
                        </>
                      ) : null}
                      {(proposal.status === "passed" || passed) &&
                      proposal.status !== "executed" ? (
                        <Button
                          size="sm"
                          onClick={() => onExecuteProposal(proposal)}
                          data-testid="dao-execute-proposal"
                        >
                          <Play className="h-3.5 w-3.5" /> Execute
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${total ? (proposal.yes / total) * 100 : 0}%`,
                        }}
                      />
                      <div
                        className="h-full bg-red-400/80"
                        style={{
                          width: `${total ? (proposal.no / total) * 100 : 0}%`,
                        }}
                      />
                      <div
                        className="h-full bg-muted-foreground/40"
                        style={{
                          width: `${total ? (proposal.abstain / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>
                        for {proposal.yes} · against {proposal.no} · abstain{" "}
                        {proposal.abstain}
                      </span>
                      <span>{total} vote{total === 1 ? "" : "s"} cast</span>
                    </div>
                  </div>

                  {proposal.status === "open" && selected === proposal.id ? (
                    <PrivateVotePanel
                      proposal={proposal}
                      onVoted={(choice) => onVoted(proposal, choice)}
                      onClose={() => setSelected(null)}
                    />
                  ) : null}

                  <details className="rounded-lg border border-border/50 bg-background/40 p-2.5">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                      <FileText className="h-3 w-3" /> Proposal payload
                    </summary>
                    <div className="mt-2 space-y-1 font-mono text-[10px] text-muted-foreground">
                      <div>action: {proposal.action}</div>
                      <div>planHash: {shortHash(proposal.planHash, 14, 8)}</div>
                      <div>promptHash: {shortHash(proposal.promptHash, 14, 8)}</div>
                      <pre className="overflow-x-auto pt-1">
                        {JSON.stringify(proposal.plan.params, null, 2)}
                      </pre>
                    </div>
                  </details>

                  {proposal.status === "executed" ? (
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Executed after the vote
                      (simulated).
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <Vote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            The vote path uses{" "}
            <span className="font-mono">scope = proposalId</span> and a
            nullifier, so a member cannot vote twice. With a small cohort the
            privacy claim is weak — say so during the demo.
          </p>
        </div>
      </div>
    </div>
  );
}
