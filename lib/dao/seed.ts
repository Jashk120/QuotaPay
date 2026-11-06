import type {
  DaoAsset,
  DaoConfig,
  DaoEvent,
  DaoState,
  Member,
  PolicyRow,
  Proposal,
} from "./types";

const DAY = 86_400_000;

const CORE = "0x9a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const AGENT = "0x7c1d2e3f405162738495a6b7c8d9e0f112345678";
const TREASURY = "0x5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081";
const ADMIN = "0x1111111111111111111111111111111111111111";

const POLICY: PolicyRow[] = [
  {
    target: "DaoCore",
    selector: "addMembers(bytes32[])",
    label: "Add invited members",
    tier: 1,
  },
  {
    target: "DaoCore",
    selector: "pay(address[],uint256)",
    label: "Payout within caps",
    tier: 1,
  },
  {
    target: "AssetModule",
    selector: "acquire(bytes32,uint256)",
    label: "Acquire allowlisted asset",
    tier: 1,
  },
  {
    target: "DaoCore",
    selector: "removeMember(bytes32,bytes32[])",
    label: "Remove a member",
    tier: 2,
  },
  {
    target: "DaoCore",
    selector: "setRole(bytes32,uint8)",
    label: "Change a non-admin role",
    tier: 2,
  },
  {
    target: "AssetModule",
    selector: "dispose(bytes32)",
    label: "Dispose of an asset",
    tier: 2,
  },
  {
    target: "DaoCore",
    selector: "executeProposal(bytes32)",
    label: "Execute a passed proposal",
    tier: 3,
  },
  {
    target: "AgentAccount",
    selector: "setPolicy(bytes32,uint8)",
    label: "Edit the agent mandate",
    tier: 3,
  },
  {
    target: "*",
    selector: "*",
    label: "Anything else",
    tier: 3,
  },
];

const MEMBERS: Member[] = [
  {
    id: "m-arjun",
    name: "Arjun K.",
    wallet: "0x2222222222222222222222222222222222222222",
    leaf: "0xa1f0c2d3e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f40312233445566778899",
    role: "contributor",
    joinedAt: Date.UTC(2026, 9, 3),
    active: true,
  },
  {
    id: "m-priya",
    name: "Priya S.",
    wallet: "0x3333333333333333333333333333333333333333",
    leaf: "0xb2e1d3c4f5a6b7988997a6b5c4d3e2f10b8a9c7d6e5f40312233445566778800",
    role: "contributor",
    joinedAt: Date.UTC(2026, 8, 18),
    active: true,
  },
  {
    id: "m-marco",
    name: "Marco D.",
    wallet: "0x4444444444444444444444444444444444444444",
    leaf: "0xc3d2e1f0a9b8c7d6e5f40312233445566778899aab0c1d2e3f40516273849506",
    role: "contributor",
    joinedAt: Date.UTC(2026, 7, 9),
    active: true,
  },
  {
    id: "m-tomas",
    name: "Tomás R.",
    wallet: "0x5555555555555555555555555555555555555555",
    leaf: "0xd4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a1908f7e6d5c4b3a29180706",
    role: "contributor",
    joinedAt: Date.UTC(2026, 9, 12),
    active: true,
  },
  {
    id: "m-lena",
    name: "Lena W.",
    wallet: "0x6666666666666666666666666666666666666666",
    leaf: "0xe5d4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a1908f7e6d5c4b3a291807",
    role: "member",
    joinedAt: Date.UTC(2026, 6, 21),
    active: true,
  },
  {
    id: "m-nadia",
    name: "Nadia H.",
    wallet: "0x7777777777777777777777777777777777777777",
    leaf: "0xf6e5d4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a1908f7e6d5c4b3a2910",
    role: "member",
    joinedAt: Date.UTC(2026, 5, 30),
    active: true,
  },
  {
    id: "m-admin",
    name: "Ava (admin)",
    wallet: ADMIN,
    leaf: "0x07162534435261708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7",
    role: "admin",
    joinedAt: Date.UTC(2026, 5, 1),
    active: true,
  },
];

const ASSETS: DaoAsset[] = [
  {
    id: "asset-invoice-2291",
    name: "Invoice #INV-2291",
    kind: "NFT",
    priceUsdc: 800,
    capUsdc: 1000,
    allowlisted: true,
    held: false,
  },
  {
    id: "asset-tbill-3m",
    name: "T-Bill 3M",
    kind: "RWA",
    priceUsdc: 500,
    capUsdc: 2000,
    allowlisted: true,
    held: true,
  },
  {
    id: "asset-solar-bond",
    name: "Solar Bond 2030",
    kind: "RWA",
    priceUsdc: 1200,
    capUsdc: 1500,
    allowlisted: false,
    held: false,
  },
];

function planShell(
  action: Proposal["action"],
  title: string,
  params: Record<string, string | number | string[]>,
  promptHash: string,
  planHash: string,
) {
  return {
    id: `seed-${planHash.slice(2, 10)}`,
    action,
    tier: 3 as const,
    title,
    summary: title,
    resolved: [],
    params,
    checks: [],
    authorization: "vote" as const,
    prompt: title,
    promptHash,
    planHash,
    warnings: [],
    status: "awaiting_vote" as const,
  };
}

const PROPOSALS: Proposal[] = [
  {
    id: "P-024",
    title: "Acquire Invoice #INV-2291",
    action: "acquire_asset",
    tier: 3,
    amount: 800,
    yes: 4,
    no: 1,
    abstain: 0,
    quorum: 3,
    endsAt: Date.UTC(2026, 10, 9),
    status: "passed",
    createdAt: Date.UTC(2026, 10, 2),
    promptHash: "0x3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829",
    planHash: "0x4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a",
    plan: planShell(
      "acquire_asset",
      "Acquire Invoice #INV-2291",
      {
        assetId: "asset-invoice-2291",
        asset: "Invoice #INV-2291",
        price: 800,
        token: "USDC",
      },
      "0x3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829",
      "0x4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a",
    ),
  },
  {
    id: "P-023",
    title: "Pay October contributors",
    action: "pay",
    tier: 3,
    amount: 350,
    yes: 5,
    no: 0,
    abstain: 1,
    quorum: 3,
    endsAt: Date.UTC(2026, 9, 30),
    status: "executed",
    createdAt: Date.UTC(2026, 9, 26),
    promptHash: "0x5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b",
    planHash: "0x6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c",
    plan: planShell(
      "pay",
      "Pay October contributors",
      { amount: 350, token: "USDC", recipients: ["Priya S.", "Marco D.", "Tomás R."] },
      "0x5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b",
      "0x6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c",
    ),
  },
  {
    id: "P-022",
    title: "Raise the period cap to $2,500",
    action: "update_policy",
    tier: 3,
    yes: 1,
    no: 0,
    abstain: 0,
    quorum: 3,
    endsAt: Date.UTC(2027, 0, 1),
    status: "open",
    createdAt: Date.UTC(2026, 10, 4),
    promptHash: "0x7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d",
    planHash: "0x8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e",
    plan: planShell(
      "update_policy",
      "Raise the period cap to $2,500",
      { change: "perPeriodCap: 2500" },
      "0x7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d",
      "0x8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e",
    ),
  },
];

const EVENTS: DaoEvent[] = [
  {
    id: "e-4",
    at: Date.UTC(2026, 10, 4, 16, 20),
    action: "vote",
    tier: 3,
    title: "Private vote cast on P-024",
    authorizers: ["member (private)"],
    promptHash: "0x3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829",
    planHash: "0x4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a",
    txHash: "0xaa11bb22cc33dd44ee55ff6600778899aa11bb22cc33dd44ee55ff6600778899",
    simulated: true,
  },
  {
    id: "e-3",
    at: Date.UTC(2026, 9, 28, 10, 5),
    action: "pay",
    tier: 1,
    title: "Pay October contributors · 350 USDC",
    authorizers: ["agent"],
    promptHash: "0x5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b",
    planHash: "0x6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c",
    txHash: "0xbb22cc33dd44ee55ff6600778899aa11bb22cc33dd44ee55ff6600778899aa11",
    simulated: true,
  },
  {
    id: "e-2",
    at: Date.UTC(2026, 9, 12, 9, 44),
    action: "add_members",
    tier: 1,
    title: "Added 2 members in one batch",
    authorizers: ["agent"],
    promptHash: "0xcc33dd44ee55ff6600778899aa11bb22cc33dd44ee55ff6600778899aa11bb22",
    planHash: "0xdd44ee55ff6600778899aa11bb22cc33dd44ee55ff6600778899aa11bb22cc33",
    txHash: "0xcc33dd44ee55ff6600778899aa11bb22cc33dd44ee55ff6600778899aa11bb22",
    simulated: true,
  },
  {
    id: "e-1",
    at: Date.UTC(2026, 5, 1, 12, 0),
    action: "propose",
    tier: 0,
    title: "Atlas Collective created",
    authorizers: ["owner"],
    promptHash: "0xee55ff6600778899aa11bb22cc33dd44ee55ff6600778899aa11bb22cc33dd44",
    planHash: "0xff6600778899aa11bb22cc33dd44ee55ff6600778899aa11bb22cc33dd44ee55",
    txHash: "0xee55ff6600778899aa11bb22cc33dd44ee55ff6600778899aa11bb22cc33dd44",
    simulated: true,
  },
];

function seedConfig(): DaoConfig {
  return {
    name: "Atlas Collective",
    daoId: "atlas",
    coreAddress: CORE,
    agentAddress: AGENT,
    treasuryAddress: TREASURY,
    adminAddress: ADMIN,
    treasuryUsdc: 5000,
    perTxCap: 200,
    perPeriodCap: 1000,
    addMemberRateLimit: 10,
    votingWindowHours: 48,
    createdAt: Date.UTC(2026, 5, 1),
    agentPaused: false,
  };
}

export function seedDao(): DaoState {
  return {
    version: 1,
    config: seedConfig(),
    members: MEMBERS.map((member) => ({ ...member })),
    invites: [
      {
        code: "ATLAS-1",
        label: "Sofia M.",
        issuedAt: Date.UTC(2026, 10, 4),
        status: "open",
      },
    ],
    proposals: PROPOSALS.map((proposal) => ({
      ...proposal,
      plan: { ...proposal.plan },
    })),
    assets: ASSETS.map((asset) => ({ ...asset })),
    events: EVENTS.map((event) => ({ ...event })),
    policy: POLICY.map((row) => ({ ...row })),
    capUsage: {
      periodSpent: 350,
      membersAdded: 4,
    },
  };
}

export type CreateDaoInput = {
  name: string;
  treasuryUsdc: number;
  perTxCap: number;
  perPeriodCap: number;
  addMemberRateLimit: number;
  votingWindowHours: number;
  adminAddress: string;
};

export function createDaoState(input: CreateDaoInput): DaoState {
  const now = Date.now();
  const config: DaoConfig = {
    name: input.name || "Untitled DAO",
    daoId: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dao",
    coreAddress: CORE,
    agentAddress: AGENT,
    treasuryAddress: TREASURY,
    adminAddress: input.adminAddress || ADMIN,
    treasuryUsdc: Math.max(0, input.treasuryUsdc),
    perTxCap: Math.max(1, input.perTxCap),
    perPeriodCap: Math.max(1, input.perPeriodCap),
    addMemberRateLimit: Math.max(1, input.addMemberRateLimit),
    votingWindowHours: Math.max(1, input.votingWindowHours),
    createdAt: now,
    agentPaused: false,
  };

  return {
    version: 1,
    config,
    members: [
      {
        id: "m-admin",
        name: "You (admin)",
        wallet: config.adminAddress,
        leaf: "0x07162534435261708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7",
        role: "admin",
        joinedAt: now,
        active: true,
      },
    ],
    invites: [],
    proposals: [],
    assets: ASSETS.map((asset) => ({ ...asset, held: false })),
    events: [
      {
        id: `e-created-${now}`,
        at: now,
        action: "propose",
        tier: 0,
        title: `${config.name} created`,
        authorizers: ["owner"],
        promptHash: "0x" + "11".repeat(32),
        planHash: "0x" + "22".repeat(32),
        txHash: "0x" + "33".repeat(32),
        simulated: true,
      },
    ],
    policy: POLICY.map((row) => ({ ...row })),
    capUsage: {
      periodSpent: 0,
      membersAdded: 0,
    },
  };
}

export const DAO_CONSTANTS = {
  CORE,
  AGENT,
  TREASURY,
  ADMIN,
  DAY,
};
