import {
  formatUnits,
  parseAbi,
  parseAbiItem,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { agentAccountAbi, assetModuleAbi, daoCoreAbi } from "@/lib/daoAbis.mjs";
import { config } from "@/lib/config";
import type {
  ActionType,
  DaoAsset,
  DaoEvent,
  DaoState,
  Member,
  MemberRole,
  OraclePrice,
  Plan,
  PolicyRow,
  Proposal,
} from "./types";
import { readChainlinkUsdcUsd } from "./oracle";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const MEMBER_ADDED = parseAbiItem(
  "event MemberAdded(uint256 indexed index, uint256 commitment)",
);
const MEMBER_REMOVED = parseAbiItem(
  "event MemberRemoved(uint256 indexed index, uint256 commitment)",
);
const ACTION_EXECUTED = parseAbiItem(
  "event ActionExecuted(bytes32 indexed actionHash, uint8 tier, address indexed authorizer, uint8 actionType, bytes32 promptHash, bytes32 planHash)",
);
const ASSET_ALLOWED = parseAbiItem(
  "event AssetAllowed(bytes32 indexed assetId, address indexed token, uint256 unitPrice, uint256 cap)",
);
const DAO_INITIALIZED = parseAbiItem(
  "event DaoInitialized(bytes32 indexed daoId, address indexed admin)",
);

const ROLE_NAMES: MemberRole[] = ["member", "contributor", "admin"];

const ACTION_BY_CODE: Record<number, ActionType> = {
  1: "add_members",
  2: "remove_member",
  3: "change_role",
  4: "dispose_asset",
  5: "pay",
  6: "propose",
  7: "acquire_asset",
  8: "frame",
};

const SELECTOR_ACTION: Record<string, ActionType> = {
  [toFunctionSelector("addMembers(uint256[],uint256[],bytes32,(uint256,uint256,bytes))")]:
    "add_members",
  [toFunctionSelector(
    "addMembersAuthorized(uint256[],uint256[],bytes32,(uint256,uint256,bytes))",
  )]: "add_members",
  [toFunctionSelector("removeMember(uint256,bytes32,(uint256,uint256,bytes))")]:
    "remove_member",
  [toFunctionSelector("setRole(uint256,uint8,(uint256,uint256,bytes))")]: "change_role",
  [toFunctionSelector("disposeAsset(bytes32,uint256,address,(uint256,uint256,bytes))")]:
    "dispose_asset",
  [toFunctionSelector("spend(address,address,uint256,bytes32,bytes32)")]: "pay",
  [toFunctionSelector("spendAboveCap(address,address,uint256,bytes32,bytes32)")]: "pay",
  [toFunctionSelector("acquireAsset(bytes32,uint256)")]: "acquire_asset",
  [toFunctionSelector("acquireAssetAboveCap(bytes32,uint256)")]: "acquire_asset",
  [toFunctionSelector("createProposal(address,bytes,uint64,bytes32,bytes32)")]: "propose",
  [toFunctionSelector("executeProposal(uint256)")]: "propose",
  [toFunctionSelector("setTokenCap(address,bool,uint256,uint256,uint64)")]:
    "update_policy",
  [toFunctionSelector("setMemberPolicy(uint32,uint16,uint64,uint16)")]: "update_policy",
  [toFunctionSelector("setPolicy((address,bytes4,bool,uint8)[])")]: "update_policy",
};

/**
 * Selectors the console reads back from `AgentAccount.rules`. A mapping is not
 * enumerable, so we probe the known DAO surface instead of pretending the
 * policy table can be listed.
 */
const POLICY_PROBES: { signature: string; label: string }[] = [
  {
    signature: "addMembers(uint256[],uint256[],bytes32,(uint256,uint256,bytes))",
    label: "Add invited members (admin co-sign)",
  },
  {
    signature:
      "addMembersAuthorized(uint256[],uint256[],bytes32,(uint256,uint256,bytes))",
    label: "Add members above the rate limit",
  },
  {
    signature: "spend(address,address,uint256,bytes32,bytes32)",
    label: "Payout within caps",
  },
  {
    signature: "acquireAsset(bytes32,uint256)",
    label: "Acquire allowlisted asset",
  },
  {
    signature: "removeMember(uint256,bytes32,(uint256,uint256,bytes))",
    label: "Remove a member",
  },
  {
    signature: "setRole(uint256,uint8,(uint256,uint256,bytes))",
    label: "Change a non-admin role",
  },
  {
    signature: "disposeAsset(bytes32,uint256,address,(uint256,uint256,bytes))",
    label: "Dispose of an asset",
  },
  {
    signature: "createProposal(address,bytes,uint64,bytes32,bytes32)",
    label: "Open a governance proposal",
  },
  {
    signature: "executeProposal(uint256)",
    label: "Execute a passed proposal",
  },
];

export type ChainMember = {
  index: number;
  leaf: Hex;
  role: MemberRole;
};

export type ChainProposal = {
  id: number;
  target: Address;
  data: Hex;
  paramsHash: Hex;
  snapshotRoot: Hex;
  snapshotMembers: number;
  deadline: number;
  forVotes: number;
  againstVotes: number;
  executed: boolean;
  promptHash: Hex;
  planHash: Hex;
};

export type ChainAsset = {
  assetId: Hex;
  token: Address;
  unitPrice: bigint;
  cap: bigint;
  allowed: boolean;
  held: bigint;
};

export type ChainEvent = {
  id: string;
  at: number;
  action: ActionType;
  tier: number;
  authorizer: string;
  actionHash: Hex;
  promptHash: Hex;
  planHash: Hex;
  txHash: Hex;
};

export type ChainToken = {
  address: Address | null;
  decimals: number;
  balance: bigint;
  allowed: boolean;
  perTx: bigint;
  perPeriod: bigint;
  periodLength: bigint;
  periodStart: bigint;
  spent: bigint;
};

export type ChainSnapshot = {
  core: Address;
  daoId: Hex;
  admin: Address;
  agentAccount: Address;
  agentSigner: Address;
  agentPaused: boolean;
  frameEnforced: boolean;
  assetModule: Address | null;
  votePaymaster: Address | null;
  swapModule: Address | null;
  membershipRoot: Hex;
  memberCount: number;
  proposalCount: number;
  createdAt: number;
  members: ChainMember[];
  proposals: ChainProposal[];
  assets: ChainAsset[];
  events: ChainEvent[];
  policy: PolicyRow[];
  token: ChainToken;
  memberPolicy: {
    periodLength: number;
    addLimit: number;
    votePeriod: number;
    quorumBps: number;
    periodStart: number;
    addsThisPeriod: number;
  };
  oracle?: OraclePrice;
  warnings: string[];
};

async function optional<T>(fn: () => Promise<T>, warnings: string[], label: string) {
  try {
    return await fn();
  } catch (cause) {
    warnings.push(
      `${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return null;
  }
}

/**
 * Read a deployed DAO. Every field here is authoritative; nothing is seeded.
 * Individual reads are best-effort so one unsupported method (or a module that
 * was never deployed) does not blank the whole console.
 */
export async function readChainSnapshot(
  client: PublicClient,
  core: Address,
): Promise<ChainSnapshot> {
  const warnings: string[] = [];

  const [
    daoId,
    admin,
    agentAccount,
    assetModuleRaw,
    votePaymasterRaw,
    swapModuleRaw,
    membershipRoot,
    memberCountRaw,
    proposalCountRaw,
    memberPeriodLength,
    addMemberLimit,
    votePeriod,
    quorumBps,
    memberPeriodStart,
    memberAddsThisPeriod,
  ] = await Promise.all([
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "daoId" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "admin" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "agentAccount" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "assetModule" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "votePaymaster" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "swapModule" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "membershipRoot" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "memberCount" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "proposalCount" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "memberPeriodLength" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "addMemberLimit" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "votePeriod" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "quorumBps" }),
    client.readContract({ address: core, abi: daoCoreAbi, functionName: "memberPeriodStart" }),
    client.readContract({
      address: core,
      abi: daoCoreAbi,
      functionName: "memberAddsThisPeriod",
    }),
  ]);

  const assetModule =
    assetModuleRaw && assetModuleRaw !== ZERO_ADDRESS ? (assetModuleRaw as Address) : null;
  const votePaymaster =
    votePaymasterRaw && votePaymasterRaw !== ZERO_ADDRESS
      ? (votePaymasterRaw as Address)
      : null;
  const swapModule =
    swapModuleRaw && swapModuleRaw !== ZERO_ADDRESS ? (swapModuleRaw as Address) : null;

  const [agentPaused, frameEnforced, agentSigner] = await Promise.all([
    client.readContract({
      address: agentAccount as Address,
      abi: agentAccountAbi,
      functionName: "paused",
    }),
    client.readContract({
      address: agentAccount as Address,
      abi: agentAccountAbi,
      functionName: "frameEnforced",
    }),
    client.readContract({
      address: agentAccount as Address,
      abi: agentAccountAbi,
      functionName: "agentSigner",
    }),
  ]);

  // ---- token / treasury ---------------------------------------------------
  const tokenAddress = (config.usdcAddress || null) as Address | null;
  let decimals = config.usdcDecimals;
  let balance = 0n;
  let cap = {
    allowed: false,
    perTx: 0n,
    perPeriod: 0n,
    periodLength: 0n,
    periodStart: 0n,
    spent: 0n,
  };

  if (tokenAddress) {
    const [capRaw, balanceRaw, tokenDecimals] = await Promise.all([
      client.readContract({
        address: core,
        abi: daoCoreAbi,
        functionName: "tokenCaps",
        args: [tokenAddress],
      }),
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [core],
      }),
      optional(
        () =>
          client.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "decimals",
          }),
        warnings,
        "token.decimals",
      ),
    ]);
    cap = {
      allowed: capRaw[0],
      perTx: capRaw[1],
      perPeriod: capRaw[2],
      periodLength: capRaw[3],
      periodStart: capRaw[4],
      spent: capRaw[5],
    };
    balance = balanceRaw;
    if (tokenDecimals != null) decimals = Number(tokenDecimals);
  } else {
    balance = await client.getBalance({ address: core });
    decimals = 18;
  }

  const token: ChainToken = {
    address: tokenAddress,
    decimals,
    balance,
    ...cap,
  };

  // ---- optional real price source ----------------------------------------
  let oracle: OraclePrice | undefined;
  if (config.chainlinkUsdcUsd) {
    oracle =
      (await optional(
        () =>
          readChainlinkUsdcUsd(
            client,
            config.chainlinkUsdcUsd as Address,
          ),
        warnings,
        "Chainlink USDC/USD",
      )) ?? undefined;
  }

  // ---- members ------------------------------------------------------------
  const [addedLogs, removedLogs] = await Promise.all([
    optional(
      () => client.getLogs({ address: core, event: MEMBER_ADDED, fromBlock: 0n }),
      warnings,
      "MemberAdded logs",
    ),
    optional(
      () => client.getLogs({ address: core, event: MEMBER_REMOVED, fromBlock: 0n }),
      warnings,
      "MemberRemoved logs",
    ),
  ]);

  const seenIndices = [
    ...(addedLogs ?? []).map((log) => Number(log.args.index)),
    ...(removedLogs ?? []).map((log) => Number(log.args.index)),
  ];
  const maxIndex = seenIndices.length ? Math.max(...seenIndices) : -1;

  const members: ChainMember[] = [];
  if (maxIndex >= 0) {
    const slots = Array.from({ length: maxIndex + 1 }, (_, index) => index);
    const rows = await Promise.all(
      slots.map(async (index) => {
        const [leaf, role] = await Promise.all([
          client.readContract({
            address: core,
            abi: daoCoreAbi,
            functionName: "leafCommitment",
            args: [BigInt(index)],
          }),
          client.readContract({
            address: core,
            abi: daoCoreAbi,
            functionName: "memberRole",
            args: [BigInt(index)],
          }),
        ]);
        if (leaf === 0n) return null;
        return {
          index,
          leaf: `0x${leaf.toString(16).padStart(64, "0")}` as Hex,
          role: ROLE_NAMES[Number(role)] ?? "member",
        } satisfies ChainMember;
      }),
    );
    for (const row of rows) if (row) members.push(row);
  }

  // ---- proposals ----------------------------------------------------------
  const proposals: ChainProposal[] = [];
  for (let id = 1; id <= Number(proposalCountRaw); id++) {
    const raw = await client.readContract({
      address: core,
      abi: daoCoreAbi,
      functionName: "getProposal",
      args: [BigInt(id)],
    });
    proposals.push({
      id,
      target: raw.target as Address,
      data: raw.data as Hex,
      paramsHash: raw.paramsHash as Hex,
      snapshotRoot: raw.snapshotRoot as Hex,
      snapshotMembers: Number(raw.snapshotMembers),
      deadline: Number(raw.deadline),
      forVotes: Number(raw.forVotes),
      againstVotes: Number(raw.againstVotes),
      executed: raw.executed,
      promptHash: raw.promptHash as Hex,
      planHash: raw.planHash as Hex,
    });
  }

  // ---- assets -------------------------------------------------------------
  const assets: ChainAsset[] = [];
  if (assetModule) {
    const allowedLogs = await optional(
      () =>
        client.getLogs({
          address: assetModule,
          event: ASSET_ALLOWED,
          fromBlock: 0n,
        }),
      warnings,
      "AssetAllowed logs",
    );
    const assetIds = Array.from(
      new Set((allowedLogs ?? []).map((log) => log.args.assetId as Hex)),
    );
    const rows = await Promise.all(
      assetIds.map(async (assetId) => {
        const [assetRaw, held] = await Promise.all([
          client.readContract({
            address: assetModule,
            abi: assetModuleAbi,
            functionName: "assets",
            args: [assetId],
          }),
          client.readContract({
            address: assetModule,
            abi: assetModuleAbi,
            functionName: "holdings",
            args: [core, assetId],
          }),
        ]);
        return {
          assetId,
          token: assetRaw[0] as Address,
          unitPrice: assetRaw[1],
          cap: assetRaw[2],
          allowed: assetRaw[3],
          held,
        } satisfies ChainAsset;
      }),
    );
    assets.push(...rows);
  }

  // ---- policy -------------------------------------------------------------
  const policyRows = await Promise.all(
    POLICY_PROBES.map(async (probe) => {
      const selector = toFunctionSelector(probe.signature);
      const rule = await optional(
        () =>
          client.readContract({
            address: agentAccount as Address,
            abi: agentAccountAbi,
            functionName: "rules",
            args: [core, selector],
          }),
        warnings,
        `rules(${probe.label})`,
      );
      if (!rule) return null;
      return {
        target: "DaoCore",
        selector: probe.signature,
        label: probe.label,
        tier: (rule[0] ? Math.max(1, Number(rule[1])) : 0) as PolicyRow["tier"],
      } satisfies PolicyRow;
    }),
  );
  const policy: PolicyRow[] = policyRows.filter(
    (row): row is PolicyRow => row !== null,
  );

  // ---- events + creation time --------------------------------------------
  const [actionLogs, initLogs] = await Promise.all([
    optional(
      () =>
        client.getLogs({
          address: core,
          event: ACTION_EXECUTED,
          fromBlock: 0n,
        }),
      warnings,
      "ActionExecuted logs",
    ),
    optional(
      () =>
        client.getLogs({
          address: core,
          event: DAO_INITIALIZED,
          fromBlock: 0n,
        }),
      warnings,
      "DaoInitialized logs",
    ),
  ]);

  const blockTimes = new Map<bigint, number>();
  const uniqueBlocks = Array.from(
    new Set([
      ...(actionLogs ?? []).map((log) => log.blockNumber),
      ...(initLogs ?? []).map((log) => log.blockNumber),
    ]),
  );
  await Promise.all(
    uniqueBlocks.map(async (blockNumber) => {
      if (blockNumber == null) return;
      const block = await optional(
        () => client.getBlock({ blockNumber }),
        warnings,
        `block ${blockNumber}`,
      );
      if (block) blockTimes.set(blockNumber, Number(block.timestamp) * 1000);
    }),
  );

  const events: ChainEvent[] = (actionLogs ?? []).map((log) => {
    const code = Number(log.args.actionType ?? 0);
    return {
      id: `e-${log.transactionHash}-${log.logIndex}`,
      at: log.blockNumber != null ? (blockTimes.get(log.blockNumber) ?? 0) : 0,
      action: ACTION_BY_CODE[code] ?? "summarize",
      tier: Number(log.args.tier ?? 0),
      authorizer: (log.args.authorizer as string) ?? "",
      actionHash: (log.args.actionHash as Hex) ?? ZERO_HASH,
      promptHash: (log.args.promptHash as Hex) ?? ZERO_HASH,
      planHash: (log.args.planHash as Hex) ?? ZERO_HASH,
      txHash: (log.transactionHash as Hex) ?? ZERO_HASH,
    };
  });

  let createdAt = 0;
  if (initLogs?.[0]?.blockNumber != null) {
    createdAt = blockTimes.get(initLogs[0].blockNumber) ?? 0;
  }

  return {
    core,
    daoId: daoId as Hex,
    admin: admin as Address,
    agentAccount: agentAccount as Address,
    agentSigner: agentSigner as Address,
    agentPaused: Boolean(agentPaused),
    frameEnforced: Boolean(frameEnforced),
    assetModule,
    votePaymaster,
    swapModule,
    membershipRoot: membershipRoot as Hex,
    memberCount: Number(memberCountRaw),
    proposalCount: Number(proposalCountRaw),
    createdAt,
    members,
    proposals,
    assets,
    events: events.reverse(),
    policy,
    token,
    memberPolicy: {
      periodLength: Number(memberPeriodLength),
      addLimit: Number(addMemberLimit),
      votePeriod: Number(votePeriod),
      quorumBps: Number(quorumBps),
      periodStart: Number(memberPeriodStart),
      addsThisPeriod: Number(memberAddsThisPeriod),
    },
    oracle,
    warnings,
  };
}

function toNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

function shortHex(value: string, head = 8, tail = 6): string {
  if (!value || value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function proposalPlan(
  proposal: ChainProposal,
  title: string,
  action: ActionType,
  status: Proposal["status"],
): Plan {
  return {
    id: `chain-p${proposal.id}`,
    action,
    tier: 3,
    title,
    summary: title,
    resolved: [],
    params: {},
    checks: [],
    authorization: "vote",
    prompt: title,
    promptHash: proposal.promptHash,
    planHash: proposal.planHash,
    warnings: [],
    status: status === "executed" ? "executed" : "awaiting_vote",
    proposalId: String(proposal.id),
  };
}

function proposalStatus(
  proposal: ChainProposal,
  quorumBps: number,
): Proposal["status"] {
  if (proposal.executed) return "executed";
  const now = Math.floor(Date.now() / 1000);
  if (now < proposal.deadline) return "open";
  const total = proposal.forVotes + proposal.againstVotes;
  const quorum = Math.ceil((proposal.snapshotMembers * quorumBps) / 10_000);
  return total >= quorum && proposal.forVotes > proposal.againstVotes
    ? "passed"
    : "rejected";
}

/**
 * Project the chain snapshot into the UI model.
 *
 * Human names, asset kinds and proposal titles are not on-chain, so the console
 * shows the on-chain identifiers instead of inventing labels. Every numeric
 * value, role, cap, vote and event here comes from the contracts or their logs.
 */
export function snapshotToDaoState(snapshot: ChainSnapshot): DaoState {
  const decimals = snapshot.token.decimals;

  const members: Member[] = snapshot.members.map((row) => ({
    id: `m-${row.index}`,
    index: row.index,
    name: `Member ${row.index + 1}`,
    wallet: "",
    leaf: row.leaf,
    role: row.role,
    joinedAt: 0,
    active: true,
  }));

  const quorumBps = snapshot.memberPolicy.quorumBps;
  const proposals: Proposal[] = snapshot.proposals.map((proposal) => {
    const selector = proposal.data.slice(0, 10).toLowerCase();
    const action = SELECTOR_ACTION[selector] ?? "propose";
    const title = `Proposal #${proposal.id}`;
    const status = proposalStatus(proposal, quorumBps);
    return {
      id: String(proposal.id),
      title,
      action,
      tier: 3,
      amount: undefined,
      yes: proposal.forVotes,
      no: proposal.againstVotes,
      abstain: 0,
      quorum: Math.ceil((proposal.snapshotMembers * quorumBps) / 10_000),
      endsAt: proposal.deadline * 1000,
      status,
      createdAt: 0,
      promptHash: proposal.promptHash,
      planHash: proposal.planHash,
      plan: proposalPlan(proposal, title, action, status),
    };
  });

  const assets: DaoAsset[] = snapshot.assets.map((asset) => ({
    id: asset.assetId,
    name: `Asset ${shortHex(asset.assetId)}`,
    kind: "Token",
    priceUsdc: toNumber(asset.unitPrice, decimals),
    capUsdc: toNumber(asset.cap, decimals),
    allowlisted: asset.allowed,
    held: asset.held > 0n,
  }));

  const events: DaoEvent[] = snapshot.events.map((event) => ({
    id: event.id,
    at: event.at,
    action: event.action,
    tier: (event.tier as DaoEvent["tier"]) ?? 0,
    title: `${event.action.replace(/_/g, " ")} · ${shortHex(event.actionHash, 10, 6)}`,
    authorizers: event.authorizer ? [event.authorizer] : [],
    promptHash: event.promptHash,
    planHash: event.planHash,
    txHash: event.txHash,
    simulated: false,
  }));

  return {
    version: 1,
    config: {
      name: config.daoName || `DAO ${shortHex(snapshot.daoId)}`,
      daoId: snapshot.daoId,
      coreAddress: snapshot.core,
      agentAddress: snapshot.agentAccount,
      treasuryAddress: snapshot.core,
      adminAddress: snapshot.admin,
      treasuryUsdc: toNumber(snapshot.token.balance, decimals),
      perTxCap: toNumber(snapshot.token.perTx, decimals),
      perPeriodCap: toNumber(snapshot.token.perPeriod, decimals),
      addMemberRateLimit: snapshot.memberPolicy.addLimit,
      votingWindowHours: Math.max(
        1,
        Math.round(snapshot.memberPolicy.votePeriod / 3600),
      ),
      createdAt: snapshot.createdAt,
      agentPaused: snapshot.agentPaused,
    },
    members,
    invites: [],
    proposals,
    assets,
    events,
    policy: snapshot.policy,
    oracle: snapshot.oracle,
    capUsage: {
      periodSpent: toNumber(snapshot.token.spent, decimals),
      membersAdded: snapshot.memberPolicy.addsThisPeriod,
    },
  };
}
