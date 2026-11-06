"use client";

import { useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { useSendTransaction, useSignMessage } from "wagmi";
import {
  Boxes,
  Coins,
  Plus,
  RefreshCw,
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
import { isDaoChainConfigured } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import { parsePrompt } from "@/lib/dao/agent.mjs";
import { daoCoreAbi } from "@/lib/daoAbis.mjs";
import { money, percent } from "@/lib/dao/format";
import { fakeTxHash, shortHash, withHashes } from "@/lib/dao/hash";
import { patchLabels } from "@/lib/dao/labels";
import { executeMessage } from "@/lib/dao/executeAuth";
import {
  encodeCall,
  preparePlan,
  type AdminAuth,
  type PreparedCall,
} from "@/lib/dao/planTx";
import { useDaoState } from "@/lib/dao/use-dao";
import { useConnectedWallet } from "@/lib/wallet";
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
  frame: 0, // EIP-8141 frame plan; action type is carried in the plan params
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
  const { state, update, reset, ready, source, chainError, refreshing, refresh } =
    useDaoState();
  const { sendTransactionAsync } = useSendTransaction();
  const { signMessageAsync } = useSignMessage();
  const { address: walletAddress } = useConnectedWallet();
  const [tab, setTab] = useState<Tab>("members");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [llmSource, setLlmSource] = useState<string | null>(null);
  const [chainMessage, setChainMessage] = useState<string | null>(null);
  const [signing, setSigning] = useState<{
    plan: Plan;
    request: SignatureRequest;
    call: PreparedCall | null;
  } | null>(null);

  const activeMembers = state.members.filter((member) => member.active);

  async function sendPrompt(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    // Cloud path: enqueue to Neon via /api/dao/intents (persists even if the
    // tab closes; the VPS worker completes it). The API also returns an
    // inline reply so the UI stays instant with no worker running.
    // Falls back to the local deterministic parser offline.
    let reply;
    let intentId: string | null = null;
    try {
      const res = await fetch("/api/dao/intents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, state }),
      });
      if (!res.ok) throw new Error(`intents API ${res.status}`);
      const json = (await res.json()) as {
        id: string | null;
        reply: ReturnType<typeof parsePrompt>;
        source?: string;
      };
      reply = json.reply;
      intentId = json.id;
      setLlmSource(json.source ?? null);
    } catch {
      try {
        const res = await fetch("/api/dao/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt, state }),
        });
        if (!res.ok) throw new Error(`agent API ${res.status}`);
        const json = (await res.json()) as {
          reply: ReturnType<typeof parsePrompt>;
          source?: string;
        };
        reply = json.reply;
        setLlmSource(json.source ?? null);
      } catch {
        reply = parsePrompt(prompt, state);
        setLlmSource("local");
      }
    }
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

    // If a worker is running on the VPS it will mark the intent done even
    // after this tab closes. Poll briefly to reflect its verdict in the badge.
    if (intentId) {
      const id = intentId;
      void (async () => {
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const r = await fetch(`/api/dao/intents/${id}`);
            if (!r.ok) return;
            const j = (await r.json()) as {
              intent?: { status?: string; source?: string } | null;
            };
            if (j.intent?.status === "done" || j.intent?.status === "failed") {
              if (j.intent.source) setLlmSource(j.intent.source);
              return;
            }
          } catch {
            return;
          }
        }
      })();
    }
  }

  async function requestSignature(plan: Plan, call?: PreparedCall) {
    let prepared = call ?? null;
    if (!prepared && isDaoChainConfigured) {
      const result = await preparePlan(plan, state);
      if (!result.ok) {
        setChainMessage(result.reason);
        return;
      }
      prepared = result.call;
    }
    if (prepared?.direct) {
      await submitCall(plan, prepared);
      return;
    }
    let nonce = Date.now();
    if (isDaoChainConfigured) {
      try {
        const chainNonce = await publicClient.readContract({
          address: state.config.coreAddress as Address,
          abi: daoCoreAbi,
          functionName: "adminNonce",
        });
        nonce = Number(chainNonce);
      } catch {
        nonce = Date.now();
      }
    }
    const request: SignatureRequest = {
      title: plan.title,
      actionType: call?.actionType ?? ACTION_CODES[plan.action],
      paramsHash: (call?.paramsHash ??
        plan.planHash ??
        `0x${"00".repeat(32)}`) as `0x${string}`,
      nonce,
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
    setSigning({ plan, request, call: prepared });
  }

  /** Submit the prepared DaoCore call through the agent (server-side key). */
  async function submitCall(plan: Plan, call: PreparedCall, auth?: AdminAuth) {
    setBusyPlanId(plan.id);
    setChainMessage(null);
    try {
      const data = encodeCall(call, auth);
      let hash: string;
      if (call.direct) {
        // pauseAgent is onlyAdmin: the connected admin wallet sends it itself.
        hash = await sendTransactionAsync({ to: call.to, data });
      } else {
        const nonce = String(Date.now());
        const signature = await signMessageAsync({
          message: executeMessage(call.to, data, nonce),
        });
        const res = await fetch("/api/dao/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: call.to,
            data,
            actionType: call.actionType,
            promptHash: plan.promptHash,
            planHash: plan.planHash,
            nonce,
            signature,
            address: walletAddress,
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          hash?: string;
          error?: string;
        };
        if (!res.ok || !json.ok || !json.hash) {
          throw new Error(json.error ?? `execute failed (${res.status})`);
        }
        hash = json.hash;
      }
      if (call.secrets?.length) {
        patchLabels((draft) => {
          for (const entry of call.secrets ?? []) {
            draft.members[entry.leaf.toLowerCase()] = {
              name: entry.name,
              secret: entry.secret,
            };
          }
        });
      }
      setPlans((previous) =>
        previous[plan.id]
          ? {
              ...previous,
              [plan.id]: {
                ...previous[plan.id],
                status: "executed",
                txHash: hash,
              },
            }
          : previous,
      );
      setChainMessage(`Submitted ${hash}`);
      await refresh();
    } catch (cause) {
      setChainMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyPlanId(null);
    }
  }

  async function executeOnChain(plan: Plan) {
    if (plan.authorization === "vote") {
      setChainMessage(
        "Governance actions need a concrete on-chain proposal target; the console does not encode arbitrary proposal calldata yet.",
      );
      return;
    }
    const prepared = await preparePlan(plan, state);
    if (!prepared.ok) {
      setChainMessage(prepared.reason);
      return;
    }
    if (prepared.call.needsAdmin) {
      await requestSignature(plan, prepared.call);
      return;
    }
    await submitCall(plan, prepared.call);
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
    if (isDaoChainConfigured) {
      void executeOnChain(plan);
      return;
    }
    if (plan.authorization === "vote") {
      openProposal(plan);
      return;
    }
    if (plan.authorization === "admin") {
      void requestSignature(plan);
      return;
    }
    if (plan.authorization === "admin-only") {
      // Emergency pause is a direct admin call; DaoCore.pauseAgent takes no
      // AdminAuth, so there is nothing to sign.
      void runPlan(plan, "admin");
      return;
    }
    void runPlan(plan, "agent");
  }

  function openProposal(plan: Plan) {
    if (isDaoChainConfigured) {
      setChainMessage(
        "Governance actions need a concrete on-chain proposal target; the console does not encode arbitrary proposal calldata yet.",
      );
      return;
    }
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
    if (isDaoChainConfigured) {
      setChainMessage(
        "Proposals execute through DaoCore.executeProposal once the vote closes; the console does not submit that call yet.",
      );
      return;
    }
    const txHash = fakeTxHash(proposal.planHash);
    update((draft) => {
      const row = draft.proposals.find((item) => item.id === proposal.id);
      if (row) row.status = "executed";
      applyPlan(draft, proposal.plan, "member vote", txHash);
    });
  }

  function onVoted(proposal: Proposal, choice: VoteChoice) {
    if (isDaoChainConfigured) {
      setChainMessage(
        "Votes are cast on-chain through the ZK vote paymaster; this button is demo-only.",
      );
      return;
    }
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
    if (isDaoChainConfigured) {
      setChainMessage(
        "Simulated votes are disabled while the console is reading a real DAO.",
      );
      return;
    }
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
    if (isDaoChainConfigured) {
      void refresh();
      return;
    }
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
            {ready ? (
              <Badge
                variant={source === "chain" ? "success" : "warning"}
                title={
                  source === "chain"
                    ? "State read from DaoCore; writes go through the agent"
                    : "localStorage simulation — set NEXT_PUBLIC_DAO_CORE to use the chain"
                }
              >
                {source === "chain" ? "on-chain" : "local simulation"}
              </Badge>
            ) : (
              <Badge variant="outline">connecting…</Badge>
            )}
            <Badge variant="success">cloud worker</Badge>
            <Badge variant="outline" title="Intent parser in use">
              {llmSource?.startsWith("llm:") ? llmSource : "parser: local"}
            </Badge>
            {refreshing ? (
              <Badge variant="outline">syncing…</Badge>
            ) : null}
            {process.env.NEXT_PUBLIC_AGENT_TEST_MODE === "true" ? (
              <Badge variant="warning" title="No wallet signature required">
                test mode: no auth
              </Badge>
            ) : null}
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
            <Link href="/new">
              <Plus className="h-4 w-4" /> New DAO
            </Link>
          </Button>
          {isDaoChainConfigured ? (
            <Button
              variant="outline"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" /> Reset demo
            </Button>
          )}
        </div>
      </div>

      <Alert variant="info" title="What is real in this build">
        {source === "chain" ? (
          <>
            The console reads this DAO directly from{" "}
            <span className="font-mono">
              {shortHash(state.config.coreAddress, 10, 6)}
            </span>
            . Executing a plan posts prepared calldata to{" "}
            <span className="font-mono">/api/dao/execute</span>, which builds and
            signs an EIP-8141 frame transaction with the agent key — the agent,
            not your wallet, is <span className="font-mono">tx.sender</span>.
            Names and invites are local labels; membership, caps, votes and
            balances come from the chain.
          </>
        ) : (
          <>
            No <span className="font-mono">NEXT_PUBLIC_DAO_CORE</span> is
            configured, so this is the localStorage simulation. Intents are
            queued in Neon and completed by the VPS worker; tier gates and caps
            mirror DaoCore/AgentAccount, but execution is simulated. Set the DAO
            address to read and write the real contract.
          </>
        )}
      </Alert>

      {chainError ? (
        <Alert variant="warning" title="Chain read warning">
          {chainError}
        </Alert>
      ) : null}

      {chainMessage ? (
        <Alert
          variant={chainMessage.startsWith("Submitted") ? "info" : "warning"}
          title={chainMessage.startsWith("Submitted") ? "Transaction sent" : "Execution note"}
        >
          {chainMessage}
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Treasury" value={`${money(state.config.treasuryUsdc)} USDC`} />
        <Summary label="Members" value={`${activeMembers.length} active`} />
        <Summary
          label="Agent"
          value={state.config.agentPaused ? "Paused" : "Active"}
          tone={state.config.agentPaused ? "warning" : "success"}
        />
        <Summary label="Period spend" value={`${usage}% of cap`} progress={usage} />
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
          if (current.call && isDaoChainConfigured && !result.simulated) {
            const auth: AdminAuth = {
              nonce: BigInt(current.request.nonce),
              expiry: BigInt(current.request.expiry),
              signature: result.signature,
            };
            void submitCall(current.plan, current.call, auth);
            return;
          }
          if (current.call && isDaoChainConfigured && result.simulated) {
            setChainMessage(
              "A simulated signature cannot authorize an on-chain call; connect the admin wallet and sign.",
            );
            return;
          }
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
  tone,
  progress,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
  progress?: number;
}) {
  return (
    <Card className="bg-gradient-to-br from-white to-[hsl(46_60%_97%)]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          {tone ? (
            <span
              className={
                tone === "success"
                  ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                  : "h-1.5 w-1.5 rounded-full bg-amber-500"
              }
            />
          ) : null}
          {label}
        </div>
        <div className="mt-1.5 text-lg font-semibold tracking-tight">
          {value}
        </div>
        {typeof progress === "number" ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[hsl(45_96%_55%)] to-[hsl(36_92%_52%)]"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
