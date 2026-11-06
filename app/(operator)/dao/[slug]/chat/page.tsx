"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { encodeFunctionData, isAddress, type Address } from "viem";
import {
  useAccount,
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import {
  Boxes,
  Coins,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  Vote,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AdminSignatureDialog, type SignatureRequest } from "@/components/dao/admin-signature-dialog";
import { AgentChat } from "@/components/dao/agent-chat";
import { AssetsPanel } from "@/components/dao/assets-panel";
import { MembersPanel } from "@/components/dao/members-panel";
import { PolicyTable } from "@/components/dao/policy-table";
import { ProposalsPanel } from "@/components/dao/proposals-panel";
import { TierBadge } from "@/components/dao/tier-badge";
import { TransactionFeed } from "@/components/dao/transaction-feed";
import { TreasuryPanel } from "@/components/dao/treasury-panel";
import { config } from "@/lib/config";
import { devnet, publicClient } from "@/lib/contracts";
import { parsePrompt } from "@/lib/dao/agent.mjs";
import { daoCoreAbi, sharedDaoGasPaymasterAbi } from "@/lib/daoAbis.mjs";
import { money, percent } from "@/lib/dao/format";
import { shortHash, withHashes } from "@/lib/dao/hash";
import { executeMessage } from "@/lib/dao/executeAuth";
import {
  encodeCall,
  preparePlan,
  type AdminAuth,
  type PreparedCall,
} from "@/lib/dao/planTx";
import { useDaoState } from "@/lib/dao/use-dao";
import { daoSlug } from "@/lib/dao/slug";
import { resolveMember } from "@/lib/dao/ens";
import { useConnectedWallet } from "@/lib/wallet";
import type {
  ActionType,
  ChatItem,
  DaoConversation,
  DaoMessage,
  Plan,
  Refusal,
} from "@/lib/dao/types";
import { cn } from "@/lib/utils";

type Tab = "members" | "treasury" | "proposals" | "assets" | "policy";

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
  { id: "policy", label: "Policy", icon: ShieldCheck },
];

function rid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function DaoConsolePage() {
  const params = useParams<{ slug: string }>();
  const param = typeof params.slug === "string" ? params.slug : "";
  const envCore = config.daoCoreAddress;
  const envId = envCore
    ? daoSlug(
        config.daoName || `DAO ${envCore.slice(0, 6)}…${envCore.slice(-4)}`,
      )
    : null;
  const core = isAddress(param) ? param : envId === param ? envCore : null;

  const isChainDao = Boolean(core);
  const { state, ready, source, chainError, refreshing, refresh } = useDaoState({
    coreAddress: core ?? "",
    name:
      core && envCore && core.toLowerCase() === envCore.toLowerCase()
        ? config.daoName
        : undefined,
  });
  const { sendTransactionAsync } = useSendTransaction();
  const { signMessageAsync } = useSignMessage();
  const { address: walletAddress } = useConnectedWallet();
  const { chainId: activeChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
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

  const slug = param;
  const activeMembers = state.members.filter((member) => member.active);
  const isAdmin =
    Boolean(walletAddress) &&
    Boolean(state.config.adminAddress) &&
    walletAddress!.toLowerCase() === state.config.adminAddress.toLowerCase();

  const [sponsorship, setSponsorship] = useState<
    "unknown" | "allowed" | "missing"
  >("unknown");

  const [conversations, setConversations] = useState<DaoConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversationLoading, setConversationLoading] = useState(false);

  useEffect(() => {
    if (!state.config.coreAddress) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/dao/conversations?dao=${state.config.coreAddress}`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        conversations?: DaoConversation[];
      };
      let rows = json.conversations ?? [];
      if (rows.length === 0) {
        const created = await fetch("/api/dao/conversations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dao: state.config.coreAddress }),
        });
        if (created.ok) {
          const createdJson = (await created.json()) as {
            conversation?: DaoConversation;
          };
          if (createdJson.conversation) rows = [createdJson.conversation];
        }
      }
      if (cancelled) return;
      setConversations(rows);
      setActiveConversationId((current) => current ?? rows[0]?.id ?? null);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state.config.coreAddress]);

  useEffect(() => {
    if (!activeConversationId) {
      setItems([]);
      setPlans({});
      return;
    }
    let cancelled = false;
    setConversationLoading(true);
    fetch(`/api/dao/conversations/${activeConversationId}/messages`)
      .then((res) => res.json())
      .then((json: { messages?: DaoMessage[] }) => {
        if (cancelled) return;
        const nextItems: ChatItem[] = [];
        const nextPlans: Record<string, Plan> = {};
        for (const message of json.messages ?? []) {
          const at = new Date(message.createdAt).getTime();
          if (message.role === "user") {
            nextItems.push({
              id: message.id,
              role: "user",
              text: String(message.payload.text ?? ""),
              at,
            });
          } else if (message.payload.plan) {
            const plan = message.payload.plan as Plan;
            nextPlans[plan.id] = plan;
            nextItems.push({
              id: message.id,
              role: "agent",
              planId: plan.id,
              at,
            });
          } else if (message.payload.refusal) {
            nextItems.push({
              id: message.id,
              role: "agent",
              refusal: message.payload.refusal as Refusal,
              at,
            });
          }
        }
        setItems(nextItems);
        setPlans(nextPlans);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConversationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  async function persistMessage(
    role: "user" | "agent",
    payload: Record<string, unknown>,
  ) {
    if (!activeConversationId) return;
    await fetch(`/api/dao/conversations/${activeConversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, payload }),
    }).catch(() => {});
  }

  async function newChat() {
    if (!state.config.coreAddress) return;
    const res = await fetch("/api/dao/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dao: state.config.coreAddress }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { conversation?: DaoConversation };
    if (!json.conversation) return;
    setConversations((previous) => [json.conversation!, ...previous]);
    setActiveConversationId(json.conversation.id);
    setItems([]);
    setPlans({});
    setTab("members");
  }

  useEffect(() => {
    let cancelled = false;
    const paymaster = config.daoGasPaymaster;
    const agent = state.config.agentAddress;
    if (!paymaster || !agent || !isAddress(agent)) {
      setSponsorship("unknown");
      return;
    }
    publicClient
      .readContract({
        address: paymaster,
        abi: sharedDaoGasPaymasterAbi,
        functionName: "allowedAgents",
        args: [agent],
      })
      .then((ok) => {
        if (!cancelled) setSponsorship(ok ? "allowed" : "missing");
      })
      .catch(() => {
        if (!cancelled) setSponsorship("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [state.config.agentAddress, refreshing]);

  async function enableSponsorship() {
    if (!config.daoGasPaymaster || !core) return;
    if (!(await ensureChain())) return;
    try {
      const data = encodeFunctionData({
        abi: sharedDaoGasPaymasterAbi,
        functionName: "allowAgent",
        args: [core],
      });
      const hash = await sendTransactionAsync({
        to: config.daoGasPaymaster,
        data,
      });
      setChainMessage(`Gas sponsorship enabled: ${hash}`);
      await refresh();
    } catch (cause) {
      setChainMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

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
      void persistMessage("user", { text: prompt });
      void persistMessage("agent", { refusal: reply });
      return;
    }

    const plan = withHashes(prompt, reply.plan);
    setPlans((previous) => ({ ...previous, [plan.id]: plan }));
    setItems((previous) => [
      ...previous,
      userItem,
      { id: rid("msg"), role: "agent", planId: plan.id, at: Date.now() },
    ]);
    void persistMessage("user", { text: prompt });
    void persistMessage("agent", { plan });
    if (activeConversationId) {
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === activeConversationId &&
          conversation.title === "New chat"
            ? { ...conversation, title: prompt.slice(0, 60) }
            : conversation,
        ),
      );
    }

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

  async function ensureChain(): Promise<boolean> {
    if (!isChainDao) {
      setChainMessage("This DAO is not configured on-chain.");
      return false;
    }
    if (activeChainId === config.chainId) return true;
    try {
      await switchChainAsync({ chainId: config.chainId });
      return true;
    } catch (cause) {
      const code = (cause as { code?: number })?.code;
      if (code === 4902 && walletClient) {
        try {
          await walletClient.addChain({ chain: devnet });
          await switchChainAsync({ chainId: config.chainId });
          return true;
        } catch (addCause) {
          setChainMessage(
            `Could not add chain ${config.chainId}: ${
              addCause instanceof Error ? addCause.message : String(addCause)
            }`,
          );
          return false;
        }
      }
      setChainMessage(
        `Switch MetaMask to chain ${config.chainId} (QuotaPay devnet) before signing. ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return false;
    }
  }

  async function requestSignature(plan: Plan, call?: PreparedCall) {
    if (plan.action === "add_members" && !plan.params.commitments) {
      await executeOnChain(plan);
      return;
    }
    if (
      walletAddress &&
      state.config.adminAddress &&
      walletAddress.toLowerCase() !== state.config.adminAddress.toLowerCase()
    ) {
      setChainMessage(
        `This action needs the DAO admin wallet ${shortHash(state.config.adminAddress, 8, 6)}. You are connected as ${shortHash(walletAddress, 8, 6)}.`,
      );
      return;
    }
    if (!(await ensureChain())) return;
    let prepared = call ?? null;
    if (!prepared && isChainDao) {
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
    if (isChainDao) {
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
    if (
      walletAddress &&
      state.config.adminAddress &&
      walletAddress.toLowerCase() !== state.config.adminAddress.toLowerCase()
    ) {
      setChainMessage(
        `This action needs the DAO admin wallet ${shortHash(state.config.adminAddress, 8, 6)}. You are connected as ${shortHash(walletAddress, 8, 6)}.`,
      );
      return;
    }
    if (!(await ensureChain())) return;
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
      if (typeof plan.params.inviteCode === "string") {
        await fetch("/api/dao/invites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "added",
            code: plan.params.inviteCode,
          }),
        }).catch(() => {});
      }
      setChainMessage(`Submitted ${hash}`);
      await refresh();
    } catch (cause) {
      setChainMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyPlanId(null);
    }
  }

  async function createInvites(plan: Plan) {
    const members = Array.isArray(plan.params.members)
      ? (plan.params.members as unknown as {
          label: string;
          address?: string | null;
          ens?: string | null;
        }[])
      : [];
    if (!members.length) {
      setChainMessage("No members to invite.");
      return;
    }
    const links: string[] = [];
    for (const member of members) {
      const address =
        member.address ??
        (member.ens ? await resolveMember(member.ens) : null);
      if (!address) {
        setChainMessage(
          `Could not resolve ${member.label}. Use a 0x address or a resolvable ENS name.`,
        );
        return;
      }
      const res = await fetch("/api/dao/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          dao: state.config.coreAddress,
          address,
          label: member.label,
        }),
      });
      const json = (await res.json()) as {
        invite?: { code: string };
        error?: string;
      };
      if (!res.ok || !json.invite) {
        setChainMessage(json.error ?? "Could not create the invite.");
        return;
      }
      links.push(`${window.location.origin}/join/${json.invite.code}`);
    }
    setChainMessage(`Invites created: ${links.join(" · ")}`);
  }

  function addMemberFromInvite(
    commitment: string,
    label: string,
    code: string,
  ) {
    const used = new Set(
      state.members
        .map((member) => member.index)
        .filter((index): index is number => typeof index === "number"),
    );
    let nextIndex = 0;
    while (used.has(nextIndex)) nextIndex += 1;
    const plan: Plan = {
      id: rid("invite"),
      action: "add_members",
      tier: 2,
      title: `Add ${label}`,
      summary: `Add the claimed commitment for ${label}.`,
      resolved: [{ kind: "member", label }],
      params: {
        commitments: [commitment],
        indices: [String(nextIndex)],
        names: [label],
        inviteCode: code,
      },
      checks: [],
      authorization: "admin",
      prompt: `add member ${label}`,
      promptHash: "",
      planHash: "",
      warnings: [],
      status: "draft",
    };
    void requestSignature(plan);
  }

  async function executeOnChain(plan: Plan) {
    if (plan.action === "add_members" && !plan.params.commitments) {
      await createInvites(plan);
      return;
    }
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

  function executePlan(plan: Plan) {
    if (plan.authorization === "vote") {
      setChainMessage(
        "Governance actions need a concrete on-chain proposal target; the console does not encode arbitrary proposal calldata yet.",
      );
      return;
    }
    void executeOnChain(plan);
  }

  const usage = percent(state.capUsage.periodSpent, state.config.perPeriodCap);

  if (core === null) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4 p-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">DAO not found</h1>
          <p className="text-sm text-muted-foreground">
            This URL is not a DaoCore address.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/daos">All DAOs</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/new">Create a DAO</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isChainDao) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4 p-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">DAO not found</h1>
          <p className="text-sm text-muted-foreground">
            This URL does not point at a deployed DaoCore. Pick a DAO from the
            list or create a new one.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/daos">All DAOs</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/new">Create DAO</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!ready) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading DAO…
        </CardContent>
      </Card>
    );
  }

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
                    : "This DAO has no on-chain state"
                }
              >
                {source === "chain" ? "on-chain" : "not configured"}
              </Badge>
            ) : (
              <Badge variant="outline">connecting…</Badge>
            )}
            <Badge variant="success">cloud worker</Badge>
            {state.config.adminAddress ? (
              <Badge
                variant="outline"
                title={`DAO admin: ${state.config.adminAddress}`}
              >
                admin {shortHash(state.config.adminAddress, 6, 4)}
              </Badge>
            ) : null}
            {sponsorship === "allowed" ? (
              <Badge
                variant="success"
                title="The shared gas paymaster sponsors this DAO's agent"
              >
                gas sponsored
              </Badge>
            ) : null}
            {walletAddress &&
            state.config.adminAddress &&
            walletAddress.toLowerCase() !==
              state.config.adminAddress.toLowerCase() ? (
              <Badge
                variant="warning"
                title="Only the DAO admin can authorize executions from this console"
              >
                wallet is not admin
              </Badge>
            ) : null}
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
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={refreshing || !isChainDao}
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
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
            Membership, caps, votes, assets and balances all come from the chain.
          </>
        ) : (
          <>
            This URL points at a DaoCore but the chain read has not succeeded
            yet. Check the RPC, then press Refresh. There is no local or
            simulated state.
          </>
        )}
      </Alert>

      {state.config.adminAddress ? (
        walletAddress ? (
          isAdmin ? (
            <Alert variant="success" title="You are the DAO admin">
              This wallet can authorize tier-2 actions for {state.config.name}.
            </Alert>
          ) : (
            <Alert
              variant="warning"
              title="This DAO does not belong to your wallet"
            >
              The admin is{" "}
              <span className="font-mono">{state.config.adminAddress}</span>.
              You are connected as{" "}
              <span className="font-mono">{walletAddress}</span>. You can read
              everything, but only the admin can authorize executions.{" "}
              <Link href="/new" className="underline">
                Create your own DAO
              </Link>{" "}
              to execute actions.
            </Alert>
          )
        ) : (
          <Alert variant="info" title="Read-only until the admin connects">
            The DAO admin is{" "}
            <span className="font-mono">{state.config.adminAddress}</span>.
            Connect that wallet to execute. Any other wallet can only read.
          </Alert>
        )
      ) : null}

      {isAdmin && sponsorship === "missing" ? (
        <Alert
          variant="warning"
          title="Gas sponsorship is not enabled for this DAO"
        >
          <div className="space-y-2">
            <p>
              The shared gas paymaster does not allow this DAO&apos;s agent yet.
              Enable it once so the agent can submit sponsored frame
              transactions.
            </p>
            <Button size="sm" onClick={() => void enableSponsorship()}>
              Enable gas sponsorship
            </Button>
          </div>
        </Alert>
      ) : null}

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
        <Summary
          label="Treasury"
          value={`${money(state.config.treasuryUsdc)} USDC`}
          hint={
            state.oracle
              ? `$${state.oracle.usdcUsd.toFixed(2)}/USDC · ${state.oracle.source}`
              : undefined
          }
        />
        <Summary label="Members" value={`${activeMembers.length} active`} />
        <Summary
          label="Agent"
          value={state.config.agentPaused ? "Paused" : "Active"}
          tone={state.config.agentPaused ? "warning" : "success"}
        />
        <Summary label="Period spend" value={`${usage}% of cap`} progress={usage} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-white/70 p-2">
            <select
              value={activeConversationId ?? ""}
              onChange={(event) => setActiveConversationId(event.target.value)}
              disabled={conversationLoading}
              className="h-9 flex-1 rounded-md border border-input bg-white px-2 text-sm"
              aria-label="Conversation"
            >
              {conversations.length === 0 ? (
                <option value="">
                  {conversationLoading ? "Loading…" : "No chats"}
                </option>
              ) : null}
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => void newChat()}>
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </div>
          <AgentChat
            items={items}
            plans={plans}
            busyPlanId={busyPlanId}
            onSend={sendPrompt}
            onExecute={executePlan}
            onRequestSignature={requestSignature}
            canExecute={isAdmin}
            adminAddress={state.config.adminAddress}
            onOpenProposal={() =>
              setChainMessage(
                "Governance actions need a concrete on-chain proposal target; the console does not encode arbitrary proposal calldata yet.",
              )
            }
            onDismiss={(plan) => {
              setPlans((previous) => {
                if (!previous[plan.id]) return previous;
                const next = { ...previous };
                delete next[plan.id];
                return next;
              });
            }}
          />
        </div>

        <TransactionFeed
          state={state}
          className="h-[calc(100vh-13rem)] min-h-[560px]"
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">DAO controls</h2>
            <p className="text-sm text-muted-foreground">
              Members, caps, governance and policy.
            </p>
          </div>
        </div>
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
                    ? "bg-white text-foreground shadow-sm ring-1 ring-border/60"
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
          <MembersPanel
            state={state}
            onPrompt={sendPrompt}
            onAddMember={addMemberFromInvite}
          />
        ) : tab === "treasury" ? (
          <TreasuryPanel state={state} onFunded={() => void refresh()} />
        ) : tab === "proposals" ? (
          <ProposalsPanel
            state={state}
            onVoted={() =>
              setChainMessage(
                "Votes are cast on-chain through the ZK vote paymaster; this panel does not submit them yet.",
              )
            }
            onSimulateVotes={() =>
              setChainMessage(
                "Simulated votes are not available; this console is chain-only.",
              )
            }
            onExecuteProposal={() =>
              setChainMessage(
                "Proposals execute through DaoCore.executeProposal once the vote closes; the console does not submit that call yet.",
              )
            }
            onPrompt={sendPrompt}
          />
        ) : tab === "assets" ? (
          <AssetsPanel state={state} onPrompt={sendPrompt} />
        ) : (
          <PolicyTable state={state} />
        )}
      </section>

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
          if (current.call && isChainDao && !result.simulated) {
            const auth: AdminAuth = {
              nonce: BigInt(current.request.nonce),
              expiry: BigInt(current.request.expiry),
              signature: result.signature,
            };
            void submitCall(current.plan, current.call, auth);
            return;
          }
          if (current.call && isChainDao && result.simulated) {
            setChainMessage(
              "A simulated signature cannot authorize an on-chain call; connect the admin wallet and sign.",
            );
            return;
          }
          setChainMessage(
            "This plan has no on-chain call to submit. Nothing was executed.",
          );
        }}
      />
    </div>
  );
}



function Summary({
  label,
  value,
  tone,
  progress,
  hint,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
  progress?: number;
  hint?: string;
}) {
  return (
    <Card className="bg-gradient-to-br from-white to-[hsl(46_60%_97%)]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          {tone ? (
            <span
              className={
                tone === "success"
                  ? "h-1.5 w-1.5 rounded-full bg-yellow-500"
                  : "h-1.5 w-1.5 rounded-full bg-gray-400"
              }
            />
          ) : null}
          {label}
        </div>
        <div className="mt-1.5 text-lg font-semibold tracking-tight">
          {value}
        </div>
        {hint ? (
          <div
            className="mt-0.5 truncate text-[10px] text-muted-foreground"
            title={hint}
          >
            {hint}
          </div>
        ) : null}
        {typeof progress === "number" ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[hsl(48_96%_58%)] to-[hsl(45_92%_48%)]"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
