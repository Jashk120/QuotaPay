export type Tier = 0 | 1 | 2 | 3;

export type Authorization = "none" | "agent" | "admin" | "vote" | "admin-only";

export type ActionType =
  | "add_members"
  | "pay"
  | "acquire_asset"
  | "remove_member"
  | "change_role"
  | "dispose_asset"
  | "propose"
  | "update_policy"
  | "pause"
  | "summarize"
  | "vote"
  | "frame";

export type PlanStatus =
  | "draft"
  | "awaiting_admin"
  | "awaiting_vote"
  | "executed"
  | "rejected";

export type PlanCheck = {
  label: string;
  ok: boolean;
  detail: string;
};

export type ResolvedEntity = {
  kind: "member" | "token" | "asset" | "config";
  label: string;
  meta?: string;
  address?: string;
};

export type Plan = {
  id: string;
  action: ActionType;
  tier: Tier;
  title: string;
  summary: string;
  resolved: ResolvedEntity[];
  params: Record<string, string | number | string[]>;
  checks: PlanCheck[];
  authorization: Authorization;
  prompt: string;
  promptHash: string;
  planHash: string;
  warnings: string[];
  status: PlanStatus;
  /** Four-step atomic batch, shown for asset acquisitions. */
  batchSteps?: string[];
  proposalId?: string;
  txHash?: string;
};

export type Refusal = {
  kind: "refusal";
  title: string;
  reason: string;
  layers: string[];
  prompt: string;
};

export type AgentReply =
  | { kind: "plan"; plan: Plan }
  | Refusal;

export type DaoConfig = {
  name: string;
  daoId: string;
  coreAddress: string;
  agentAddress: string;
  treasuryAddress: string;
  adminAddress: string;
  treasuryUsdc: number;
  perTxCap: number;
  perPeriodCap: number;
  addMemberRateLimit: number;
  votingWindowHours: number;
  createdAt: number;
  agentPaused: boolean;
};

export type MemberRole = "member" | "contributor" | "admin";

export type Member = {
  id: string;
  name: string;
  wallet: string;
  leaf: string;
  role: MemberRole;
  joinedAt: number;
  active: boolean;
};

export type Invite = {
  code: string;
  label: string;
  issuedAt: number;
  status: "open" | "claimed";
  commitment?: string;
  claimedBy?: string;
};

export type Proposal = {
  id: string;
  title: string;
  action: ActionType;
  tier: 3;
  amount?: number;
  yes: number;
  no: number;
  abstain: number;
  quorum: number;
  endsAt: number;
  status: "open" | "passed" | "rejected" | "executed";
  createdAt: number;
  promptHash: string;
  planHash: string;
  plan: Plan;
};

export type DaoAsset = {
  id: string;
  name: string;
  kind: "RWA" | "NFT" | "Token";
  priceUsdc: number;
  capUsdc: number;
  allowlisted: boolean;
  held: boolean;
};

export type DaoEvent = {
  id: string;
  at: number;
  action: ActionType;
  tier: Tier;
  title: string;
  authorizers: string[];
  promptHash: string;
  planHash: string;
  txHash: string;
  simulated: boolean;
};

export type PolicyRow = {
  target: string;
  selector: string;
  label: string;
  tier: Tier;
};

export type DaoState = {
  version: 1;
  config: DaoConfig;
  members: Member[];
  invites: Invite[];
  proposals: Proposal[];
  assets: DaoAsset[];
  events: DaoEvent[];
  policy: PolicyRow[];
  capUsage: {
    periodSpent: number;
    membersAdded: number;
  };
};

export type ChatItem = {
  id: string;
  role: "user" | "agent";
  text?: string;
  planId?: string;
  refusal?: Refusal;
  at: number;
};
