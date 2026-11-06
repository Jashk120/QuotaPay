"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Boxes,
  Coins,
  Plus,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Users,
  Vote,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActivityFeed } from "@/components/dao/activity-feed";
import { AdminSignatureDialog, type SignatureRequest } from "@/components/dao/admin-signature-dialog";
import { AgentChat } from "@/components/dao/agent-chat";
import { AssetsPanel } from "@/components/dao/assets-panel";
import { MembersPanel } from "@/components/dao/members-panel";
import { PolicyTable } from "@/components/dao/policy-table";
import { ProposalsPanel } from "@/components/dao/proposals-panel";
import { TierBadge } from "@/components/dao/tier-badge";
import { TreasuryPanel } from "@/components/dao/treasury-panel";
import type { VoteChoice } from "@/components/dao/private-vote-panel";
import { parsePrompt } from "@/lib/dao/agent.mjs";
import { money, percent } from "@/lib/dao/format";
import { fakeTxHash, shortHash, withHashes } from "@/lib/dao/hash";
import { useDaoState } from "@/lib/dao/use-dao";
import type {
  ActionType,
  ChatItem,
  DaoState,
  Plan,
  Proposal,
} from "@/lib/dao/types";
import { cn } from "@/lib/utils";

type Tab = "members" | "treasury" | "proposals" | "assets" | "activity" | "policy";

const ACTION_CODES: Record<ActionType, number> = {
  summarize: 0,
  add_members: 1, // DaoCore.ACTION_ADD_MEMBERS
  pay: 5, // DaoCore.ACTION_SPEND (not admin-signed today)
  acquire_asset: 7, // DaoCore.ACTION_ACQUIRE_ASSET
  remove_member: 2, // DaoCore.ACTION_REMOVE_MEMBER
  change_role: 3, // DaoCore.ACTION_SET_ROLE
  dispose_asset: 4, // DaoCore.ACTION_DISPOSE_ASSET
  propose: 6, // DaoCore.ACTION_EXECUTE_PROPOSAL
  update_policy: 0,
  pause: 0,
  vote: 0,
};

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "members", label: "Members", icon: Users },
  { id: "treasury", label: "Treasury", icon: Coins },
  { id: "proposals", label: "Proposals", icon: Vote },
  { id: "assets", label: "Assets", icon: Boxes },
  { id: "activity", label: "Activity", icon: ScrollText },
  { id: "policy", label: "Policy", icon: ShieldCheck },
];

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function DaoConsolePage() {
  const { state, update, reset } = useDaoState();
  const [tab, setTab] = useState<Tab>("members");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [signing, setSigning] = useState<{
    plan: Plan;
    request: SignatureRequest;
  } | null>(null);

  const activeMembers = state.members.filter((member) => member.active);

  function sendPrompt(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    const reply = parsePrompt(prompt, state);
    const userItem: ChatItem = {
      id: rid("msg"),
      role: "user",
      text: prompt,
      at: Date.now(),
    };

    if (reply.kind === "refusal") {
      setItems((previous) => [
        ...previous,
        userItem,
        { id: rid("msg"), role: "agent", refusal: reply, at: Date.now() },
      ]);
      return;
    }

    const plan = withHashes(prompt, reply.plan);
    setPlans((previous) => ({ ...previous, [plan.id]: plan }));
    setItems((previous) => [
      ...previous,
      userItem,
      { id: rid("msg"), role: "agent", planId: plan.id, at: Date.now() },
    ]);

    if (plan.authorization === "vote") {
      setTab("proposals");
    } else if (plan.action === "remove_member" || plan.action === "add_members") {
      setTab("members");
    } else if (plan.action === "pay") {
      setTab("treasury");
    } else if (plan.action === "acquire_asset" || plan.action === "dispose_asset") {
      setTab("assets");
    } else if (plan.action === "update_policy" || plan.action === "pause") {
      setTab("policy");
    }
  }

  function requestSignature(plan: Plan) {
    const request: SignatureRequest = {
      title: plan.title,
      actionType: ACTION_CODES[plan.action],
      paramsHash: (plan.planHash || `0x${"00".repeat(32)}`) as `0x${string}`,
      nonce: Date.now(),
      expiry: Date.now() + 60 * 60 * 1000,
      daoCore: state.config.coreAddress,
    };
    setPlans((previous) =>
      previous[plan.id]
        ? {
            ...previous,
            [plan.id]: { ...previous[plan.id], status: "awaiting_admin" },
          }
        : previous,
    );
    setSigning({ plan, request });
  }

  async function runPlan(plan: Plan, authorizer: string) {
    setBusyPlanId(plan.id);
    await sleep(700);
    const txHash = fakeTxHash(plan.planHash || plan.id);
    update((draft) => applyPlan(draft, plan, authorizer, txHash));
    setPlans((previous) =>
      previous[plan.id]
        ? {
            ...previous,
            [plan.id]: { ...previous[plan.id], status: "executed", txHash },
          }
        : previous,
    );
    setBusyPlanId(null);
  }

  function executePlan(plan: Plan) {
    if (plan.authorization === "vote") {
      openProposal(plan);
      return;
    }
    if (plan.authorization === "admin" || plan.authorization === "admin-only") {
      requestSignature(plan);
      return;
    }
    void runPlan(plan, "agent");
  }

  function openProposal(plan: Plan) {
    if (plan.proposalId) {
      setTab("proposals");
      return;
    }
    const proposalId = rid("P").toUpperCase();
    const nextPlan: Plan = {
      ...plan,
      status: "awaiting_vote",
      proposalId,
    };
    const proposal: Proposal = {
      id: proposalId,
      title: plan.title,
      action: plan.action,
      tier: 3,
      amount:
        typeof plan.params.amount === "number" ? plan.params.amount : undefined,
      yes: 0,
      no: 0,
      abstain: 0,
      quorum: 3,
      endsAt: Date.UTC(2027, 0, 1),
      status: "open",
      createdAt: Date.now(),
      promptHash: plan.promptHash,
      planHash: plan.planHash,
      plan: nextPlan,
    };
    update((draft) => {
      draft.proposals.unshift(proposal);
    });
    setPlans((previous) => ({ ...previous, [plan.id]: nextPlan }));
    setTab("proposals");
  }

  function executeProposal(proposal: Proposal) {
    const txHash = fakeTxHash(proposal.planHash);
    update((draft) => {
      const row = draft.proposals.find((item) => item.id === proposal.id);
      if (row) row.status = "executed";
      applyPlan(draft, proposal.plan, "member vote", txHash);
    });
  }

  function onVoted(proposal: Proposal, choice: VoteChoice) {
    const txHash = fakeTxHash(`${proposal.planHash}:${choice}`);
    update((draft) => {
      const row = draft.proposals.find((item) => item.id === proposal.id);
      if (!row) return;
      row[choice] += 1;
      if (row.yes >= row.quorum) row.status = "passed";
      draft.events.unshift({
        id: rid("e"),
        at: Date.now(),
        action: "vote",
        tier: 3,
        title: `Private vote on ${row.id}`,
        authorizers: ["member (private)"],
        promptHash: row.promptHash,
        planHash: row.planHash,
        txHash,
        simulated: true,
      });
    });
  }

  function simulateVotes(proposal: Proposal) {
    const txHash = fakeTxHash(`${proposal.planHash}:simulated`);
    update((draft) => {
      const row = draft.proposals.find((item) => item.id === proposal.id);
      if (!row) return;
      row.yes += 3;
      if (row.yes >= row.quorum) row.status = "passed";
      draft.events.unshift({
        id: rid("e"),
        at: Date.now(),
        action: "vote",
        tier: 3,
        title: `3 simulated member votes on ${row.id}`,
        authorizers: ["demo helper"],
        promptHash: row.promptHash,
        planHash: row.planHash,
        txHash,
        simulated: true,
      });
    });
  }

  function handleReset() {
    if (typeof window !== "undefined" && !window.confirm("Reset the local demo DAO?")) {
      return;
    }
    reset();
    setItems([]);
    setPlans({});
    setTab("members");
  }

  const usage = percent(state.capUsage.periodSpent, state.config.perPeriodCap);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">DAO operator</Badge>
            <Badge variant="warning">UI-only demo</Badge>
            <TierBadge tier={1} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {state.config.name} · operator console
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Prompt the agent in plain language. It builds a typed plan, shows the
            resolved people and the tier, and waits for the right authorization
            before executing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dao/new">
              <Plus className="h-4 w-4" /> New DAO
            </Link>
          </Button>
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" /> Reset demo
          </Button>
        </div>
      </div>

      <Alert variant="info" title="What is real in this build">
        The plan cards, tier checks and audit trail mirror the on-chain design,
        but execution, proving and the intent parser are local simulations. Admin
        signatures are real EIP-712 typed data when a wallet is connected.
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary
          label="Treasury"
          value={`${money(state.config.treasuryUsdc)} USDC`}
          hint="DAO-owned"
        />
        <Summary
          label="Active members"
          value={String(activeMembers.length)}
          hint={`${state.members.length - activeMembers.length} removed`}
        />
        <Summary
          label="Period spend"
          value={`${money(state.capUsage.periodSpent)} / ${money(state.config.perPeriodCap)}`}
          hint={`${usage}% of cap`}
        />
        <Summary
          label="Agent"
          value={state.config.agentPaused ? "paused" : "active"}
          hint={shortHash(state.config.agentAddress, 8, 4)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <AgentChat
          items={items}
          plans={plans}
          busyPlanId={busyPlanId}
          onSend={sendPrompt}
          onExecute={executePlan}
          onRequestSignature={requestSignature}
          onOpenProposal={openProposal}
          onDismiss={(plan) => {
            setPlans((previous) => {
              if (!previous[plan.id]) return previous;
              const next = { ...previous };
              delete next[plan.id];
              return next;
            });
          }}
        />

        <div className="space-y-4">
          <div className="flex gap-1 overflow-x-auto rounded-lg border border-border/60 bg-secondary/30 p-1">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-pressed={tab === item.id}
                  data-testid={`dao-tab-${item.id}`}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    tab === item.id
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {tab === "members" ? (
            <MembersPanel state={state} update={update} onPrompt={sendPrompt} />
          ) : tab === "treasury" ? (
            <TreasuryPanel state={state} onPrompt={sendPrompt} />
          ) : tab === "proposals" ? (
            <ProposalsPanel
              state={state}
              onVoted={onVoted}
              onSimulateVotes={simulateVotes}
              onExecuteProposal={executeProposal}
              onPrompt={sendPrompt}
            />
          ) : tab === "assets" ? (
            <AssetsPanel state={state} onPrompt={sendPrompt} />
          ) : tab === "activity" ? (
            <ActivityFeed state={state} />
          ) : (
            <PolicyTable state={state} />
          )}
        </div>
      </div>

      <AdminSignatureDialog
        request={signing?.request ?? null}
        onClose={() => setSigning(null)}
        onSigned={(result) => {
          const current = signing;
          setSigning(null);
          if (!current) return;
          setPlans((previous) =>
            previous[current.plan.id]
              ? {
                  ...previous,
                  [current.plan.id]: {
                    ...previous[current.plan.id],
                    status: "draft",
                  },
                }
              : previous,
          );
          void runPlan(
            current.plan,
            result.simulated
              ? "admin (simulated)"
              : `admin ${shortHash(result.signer, 6, 4)}`,
          );
        }}
      />
    </div>
  );
}

function applyPlan(
  draft: DaoState,
  plan: Plan,
  authorizer: string,
  txHash: `0x${string}`,
) {
  switch (plan.action) {
    case "add_members": {
      const names = Array.isArray(plan.params.names)
        ? (plan.params.names as string[])
        : [];
      let added = 0;
      names.forEach((name, index) => {
        const exists = draft.members.some(
          (member) =>
            member.active && member.name.toLowerCase() === name.toLowerCase(),
        );
        if (exists) return;
        draft.members.push({
          id: rid(`m-${index}`),
          name,
          wallet: `0x${fakeTxHash(`${name}:wallet`).slice(2, 42)}`,
          leaf: fakeTxHash(`${name}:leaf`),
          role: "member",
          joinedAt: Date.now(),
          active: true,
        });
        added += 1;
      });
      draft.capUsage.membersAdded += added;
      break;
    }
    case "remove_member": {
      const id = String(plan.params.memberId || "");
      const name = String(plan.params.name || "");
      const member = draft.members.find(
        (row) => row.id === id || row.name.toLowerCase() === name.toLowerCase(),
      );
      if (member) member.active = false;
      break;
    }
    case "pay": {
      draft.capUsage.periodSpent += Number(plan.params.amount) || 0;
      break;
    }
    case "acquire_asset": {
      const asset = draft.assets.find(
        (row) => row.id === String(plan.params.assetId),
      );
      if (asset) asset.held = true;
      draft.capUsage.periodSpent += Number(plan.params.price) || 0;
      break;
    }
    case "dispose_asset": {
      const asset = draft.assets.find(
        (row) => row.id === String(plan.params.assetId),
      );
      if (asset) asset.held = false;
      break;
    }
    case "change_role": {
      const member = draft.members.find(
        (row) => row.name === String(plan.params.member),
      );
      const newRole = String(plan.params.newRole || "member");
      if (member && (newRole === "member" || newRole === "contributor")) {
        member.role = newRole;
      }
      break;
    }
    case "pause": {
      draft.config.agentPaused = plan.params.mode !== "resume";
      break;
    }
    case "update_policy": {
      const change = String(plan.params.change || "");
      if (change.includes("2500")) {
        draft.config.perPeriodCap = 2500;
      }
      const assetId = String(plan.params.assetId || "");
      const asset = draft.assets.find(
        (row) =>
          row.id === assetId ||
          (change.toLowerCase().includes(row.name.toLowerCase()) &&
            /allowlist/i.test(change)),
      );
      if (asset && /allowlist/i.test(change)) asset.allowlisted = true;
      break;
    }
    default:
      break;
  }

  if (plan.action === "summarize") return;

  draft.events.unshift({
    id: rid("e"),
    at: Date.now(),
    action: plan.action,
    tier: plan.tier,
    title: plan.title,
    authorizers: [authorizer],
    promptHash: plan.promptHash,
    planHash: plan.planHash,
    txHash,
    simulated: true,
  });
}

function Summary({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-lg font-semibold tracking-tight">{value}</div>
        <div className="truncate text-xs text-muted-foreground" title={hint}>
          {hint}
        </div>
      </CardContent>
    </Card>
  );
}
