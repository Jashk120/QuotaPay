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
  DaoTransaction,
  Member,
  MemberRole,
  OraclePrice,
  Plan,
  PolicyRow,
  Proposal,
} from "./types";
import { readChainlinkUsdcUsd } from "./oracle";
import { DAO_CREATED, daoNameFromId } from "./factory";

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
const ROLE_SET = parseAbiItem(
  "event RoleSet(uint256 indexed index, uint8 role)",
);
const PROPOSAL_CREATED = parseAbiItem(
  "event ProposalCreated(uint256 indexed proposalId, address indexed target, bytes4 selector, bytes32 paramsHash, bytes32 snapshotRoot, uint64 deadline)",
);
const VOTE_CAST = parseAbiItem(
  "event VoteCast(uint256 indexed proposalId, bool support, uint256 voteNullifier)",
);
const PROPOSAL_EXECUTED = parseAbiItem(
  "event ProposalExecuted(uint256 indexed proposalId, bytes32 actionHash)",
);
const SPENT = parseAbiItem(
  "event Spent(address indexed token, address indexed to, uint256 amount, uint256 spentThisPeriod)",
);
const DEPOSITED = parseAbiItem(
  "event Deposited(address indexed from, uint256 amount)",
);
const TOKEN_CAP_SET = parseAbiItem(
  "event TokenCapSet(address indexed token, bool allowed, uint256 perTx, uint256 perPeriod, uint64 periodLength)",
);
const ADMIN_SET = parseAbiItem(
  "event AdminSet(address indexed previous, address indexed next)",
);
const AGENT_SIGNER_SET = parseAbiItem(
  "event AgentSignerSet(address indexed previous, address indexed next)",
);
const VOTE_PAYMASTER_SET = parseAbiItem(
  "event VotePaymasterSet(address indexed paymaster)",
);
const PAUSED_SET = parseAbiItem("event PausedSet(bool paused)");
const ASSET_CAP_SET = parseAbiItem(
  "event AssetCapSet(bytes32 indexed assetId, uint256 cap)",
);
const ACQUIRED = parseAbiItem(
  "event Acquired(bytes32 indexed assetId, uint256 amount, uint256 cost)",
);
const DISPOSED = parseAbiItem(
  "event Disposed(bytes32 indexed assetId, uint256 amount, address indexed to)",
);
const TOKEN_TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const FUNDED = parseAbiItem(
  "event Funded(address indexed dao, address indexed caller, uint256 amountIn, uint256 amountOut)",
);
const SWAPPED = parseAbiItem(
  "event Swapped(bytes32 indexed poolId, address indexed caller, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
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
  transactions: DaoTransaction[];
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

  // ---- logs: agent actions + the full on-chain activity stream -------------
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

  const [
    roleLogs,
    proposalLogs,
    voteLogs,
    executedLogs,
    spentLogs,
    depositLogs,
    capLogs,
    adminLogs,
    signerLogs,
    paymasterLogs,
    pausedLogs,
    assetAllowedLogs,
    assetCapLogs,
    acquiredLogs,
    disposedLogs,
    inboundTransfers,
    outboundTransfers,
    fundedLogs,
    swappedLogs,
    createdLogs,
  ] = await Promise.all([
    optional(
      () => client.getLogs({ address: core, event: ROLE_SET, fromBlock: 0n }),
      warnings,
      "RoleSet logs",
    ),
    optional(
      () =>
        client.getLogs({ address: core, event: PROPOSAL_CREATED, fromBlock: 0n }),
      warnings,
      "ProposalCreated logs",
    ),
    optional(
      () => client.getLogs({ address: core, event: VOTE_CAST, fromBlock: 0n }),
      warnings,
      "VoteCast logs",
    ),
    optional(
      () =>
        client.getLogs({
          address: core,
          event: PROPOSAL_EXECUTED,
          fromBlock: 0n,
        }),
      warnings,
      "ProposalExecuted logs",
    ),
    optional(
      () => client.getLogs({ address: core, event: SPENT, fromBlock: 0n }),
      warnings,
      "Spent logs",
    ),
    optional(
      () => client.getLogs({ address: core, event: DEPOSITED, fromBlock: 0n }),
      warnings,
      "Deposited logs",
    ),
    optional(
      () => client.getLogs({ address: core, event: TOKEN_CAP_SET, fromBlock: 0n }),
      warnings,
      "TokenCapSet logs",
    ),
    optional(
      () => client.getLogs({ address: core, event: ADMIN_SET, fromBlock: 0n }),
      warnings,
      "AdminSet logs",
    ),
    optional(
      () =>
        client.getLogs({
          address: agentAccount as Address,
          event: AGENT_SIGNER_SET,
          fromBlock: 0n,
        }),
      warnings,
      "AgentSignerSet logs",
    ),
    optional(
      () =>
        client.getLogs({
          address: core,
          event: VOTE_PAYMASTER_SET,
          fromBlock: 0n,
        }),
      warnings,
      "VotePaymasterSet logs",
    ),
    optional(
      () =>
        client.getLogs({
          address: agentAccount as Address,
          event: PAUSED_SET,
          fromBlock: 0n,
        }),
      warnings,
      "PausedSet logs",
    ),
    assetModule
      ? optional(
          () =>
            client.getLogs({
              address: assetModule,
              event: ASSET_ALLOWED,
              fromBlock: 0n,
            }),
          warnings,
          "AssetAllowed logs",
        )
      : Promise.resolve(null),
    assetModule
      ? optional(
          () =>
            client.getLogs({
              address: assetModule,
              event: ASSET_CAP_SET,
              fromBlock: 0n,
            }),
          warnings,
          "AssetCapSet logs",
        )
      : Promise.resolve(null),
    assetModule
      ? optional(
          () =>
            client.getLogs({
              address: assetModule,
              event: ACQUIRED,
              fromBlock: 0n,
            }),
          warnings,
          "Acquired logs",
        )
      : Promise.resolve(null),
    assetModule
      ? optional(
          () =>
            client.getLogs({
              address: assetModule,
              event: DISPOSED,
              fromBlock: 0n,
            }),
          warnings,
          "Disposed logs",
        )
      : Promise.resolve(null),
    tokenAddress
      ? optional(
          () =>
            client.getLogs({
              address: tokenAddress,
              event: TOKEN_TRANSFER,
              args: { to: core },
              fromBlock: 0n,
            }),
          warnings,
          "USDC inbound transfers",
        )
      : Promise.resolve(null),
    tokenAddress
      ? optional(
          () =>
            client.getLogs({
              address: tokenAddress,
              event: TOKEN_TRANSFER,
              args: { from: core },
              fromBlock: 0n,
            }),
          warnings,
          "USDC outbound transfers",
        )
      : Promise.resolve(null),
    config.treasuryFundHelper
      ? optional(
          () =>
            client.getLogs({
              address: config.treasuryFundHelper as Address,
              event: FUNDED,
              args: { dao: core },
              fromBlock: 0n,
            }),
          warnings,
          "TreasuryFundHelper.Funded logs",
        )
      : Promise.resolve(null),
    swapModule
      ? optional(
          () =>
            client.getLogs({
              address: swapModule,
              event: SWAPPED,
              fromBlock: 0n,
            }),
          warnings,
          "DaoSwapModule.Swapped logs",
        )
      : Promise.resolve(null),
    config.daoFactoryAddress
      ? optional(
          () =>
            client.getLogs({
              address: config.daoFactoryAddress as Address,
              event: DAO_CREATED,
              args: { daoCore: core },
              fromBlock: 0n,
            }),
          warnings,
          "DaoFactory.DaoCreated logs",
        )
      : Promise.resolve(null),
  ]);

  const allLogs = [
    ...(actionLogs ?? []),
    ...(initLogs ?? []),
    ...(addedLogs ?? []),
    ...(removedLogs ?? []),
    ...(roleLogs ?? []),
    ...(proposalLogs ?? []),
    ...(voteLogs ?? []),
    ...(executedLogs ?? []),
    ...(spentLogs ?? []),
    ...(depositLogs ?? []),
    ...(capLogs ?? []),
    ...(adminLogs ?? []),
    ...(signerLogs ?? []),
    ...(paymasterLogs ?? []),
    ...(pausedLogs ?? []),
    ...(assetAllowedLogs ?? []),
    ...(assetCapLogs ?? []),
    ...(acquiredLogs ?? []),
    ...(disposedLogs ?? []),
    ...(inboundTransfers ?? []),
    ...(outboundTransfers ?? []),
    ...(fundedLogs ?? []),
    ...(swappedLogs ?? []),
    ...(createdLogs ?? []),
  ];

  const blockTimes = new Map<bigint, number>();
  const uniqueBlocks = Array.from(
    new Set(allLogs.map((log) => log.blockNumber)),
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

  const at = (log: { blockNumber?: bigint | null }) =>
    log.blockNumber != null ? (blockTimes.get(log.blockNumber) ?? 0) : 0;
  const txId = (
    prefix: string,
    log: { transactionHash?: Hex | null; logIndex?: number | null },
  ) => `${prefix}-${log.transactionHash}-${log.logIndex}`;
  const hashOf = (log: { transactionHash?: Hex | null }) =>
    (log.transactionHash as Hex) ?? ZERO_HASH;
  const blockOf = (log: { blockNumber?: bigint | null }) =>
    Number(log.blockNumber ?? 0n);
  const usdc = (value: bigint) => Number(formatUnits(value, decimals));

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

  const transactions: DaoTransaction[] = [];

  for (const log of createdLogs ?? []) {
    transactions.push({
      id: txId("created", log),
      at: at(log),
      kind: "create",
      title: "DAO deployed",
      detail: `${formatUnits(log.args.funding ?? 0n, 18)} ETH funding · admin ${shortHex(
        (log.args.admin as string) ?? "",
      )}`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  if ((createdLogs ?? []).length === 0) {
    for (const log of initLogs ?? []) {
      transactions.push({
        id: txId("init", log),
        at: at(log),
        kind: "create",
        title: "DAO initialized",
        detail: `daoId ${shortHex((log.args.daoId as string) ?? "", 10, 6)}`,
        txHash: hashOf(log),
        block: blockOf(log),
      });
    }
  }

  for (const log of addedLogs ?? []) {
    transactions.push({
      id: txId("member-add", log),
      at: at(log),
      kind: "member_add",
      title: "Member added",
      detail: `index ${log.args.index?.toString() ?? "?"} · commitment ${shortHex(
        `0x${(log.args.commitment ?? 0n).toString(16).padStart(64, "0")}`,
        10,
        6,
      )}`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of removedLogs ?? []) {
    transactions.push({
      id: txId("member-remove", log),
      at: at(log),
      kind: "member_remove",
      title: "Member removed",
      detail: `index ${log.args.index?.toString() ?? "?"}`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of roleLogs ?? []) {
    transactions.push({
      id: txId("role", log),
      at: at(log),
      kind: "role",
      title: "Role set",
      detail: `member #${log.args.index?.toString() ?? "?"} → ${
        ROLE_NAMES[Number(log.args.role ?? 0)] ?? "member"
      }`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of proposalLogs ?? []) {
    transactions.push({
      id: txId("proposal", log),
      at: at(log),
      kind: "proposal",
      title: `Proposal #${log.args.proposalId?.toString() ?? "?"} created`,
      detail: `${shortHex((log.args.target as string) ?? "")} · ${
        (log.args.selector as string) ?? ""
      }`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of voteLogs ?? []) {
    transactions.push({
      id: txId("vote", log),
      at: at(log),
      kind: "vote",
      title: `Vote on #${log.args.proposalId?.toString() ?? "?"}`,
      detail: log.args.support ? "for" : "against",
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of executedLogs ?? []) {
    transactions.push({
      id: txId("executed", log),
      at: at(log),
      kind: "proposal_executed",
      title: `Proposal #${log.args.proposalId?.toString() ?? "?"} executed`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of spentLogs ?? []) {
    const amount = usdc(log.args.amount ?? 0n);
    transactions.push({
      id: txId("spent", log),
      at: at(log),
      kind: "spend",
      title: "Payout",
      detail: `to ${shortHex((log.args.to as string) ?? "")}`,
      amount,
      unit: "USDC",
      direction: "out",
      token: (log.args.token as string) ?? undefined,
      counterparty: (log.args.to as string) ?? undefined,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of depositLogs ?? []) {
    const amount = Number(formatUnits(log.args.amount ?? 0n, 18));
    transactions.push({
      id: txId("deposit", log),
      at: at(log),
      kind: "deposit",
      title: "Native deposit",
      detail: `${amount} ETH from ${shortHex((log.args.from as string) ?? "")}`,
      amount,
      unit: "ETH",
      direction: "in",
      counterparty: (log.args.from as string) ?? undefined,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of capLogs ?? []) {
    transactions.push({
      id: txId("cap", log),
      at: at(log),
      kind: "token_cap",
      title: "Token cap set",
      detail: `${shortHex((log.args.token as string) ?? "")} · ${usdc(
        log.args.perTx ?? 0n,
      )}/${usdc(log.args.perPeriod ?? 0n)} USDC per ${
        log.args.periodLength?.toString() ?? "?"
      }s`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of adminLogs ?? []) {
    transactions.push({
      id: txId("admin", log),
      at: at(log),
      kind: "admin",
      title: "Admin changed",
      detail: `${shortHex((log.args.previous as string) ?? "")} → ${shortHex(
        (log.args.next as string) ?? "",
      )}`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of signerLogs ?? []) {
    transactions.push({
      id: txId("signer", log),
      at: at(log),
      kind: "agent_signer",
      title: "Agent signer changed",
      detail: `${shortHex((log.args.previous as string) ?? "")} → ${shortHex(
        (log.args.next as string) ?? "",
      )}`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of paymasterLogs ?? []) {
    transactions.push({
      id: txId("paymaster", log),
      at: at(log),
      kind: "vote_paymaster",
      title: "Vote paymaster set",
      detail: shortHex((log.args.paymaster as string) ?? ""),
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of pausedLogs ?? []) {
    transactions.push({
      id: txId("pause", log),
      at: at(log),
      kind: "pause",
      title: log.args.paused ? "Agent paused" : "Agent resumed",
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of assetAllowedLogs ?? []) {
    transactions.push({
      id: txId("asset-allowed", log),
      at: at(log),
      kind: "asset_allowed",
      title: "Asset allowlisted",
      detail: `${shortHex((log.args.assetId as string) ?? "")} · ${usdc(
        log.args.unitPrice ?? 0n,
      )}/${usdc(log.args.cap ?? 0n)} USDC`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of assetCapLogs ?? []) {
    transactions.push({
      id: txId("asset-cap", log),
      at: at(log),
      kind: "asset_cap",
      title: "Asset cap set",
      detail: `${shortHex((log.args.assetId as string) ?? "")} · ${usdc(
        log.args.cap ?? 0n,
      )} USDC`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of acquiredLogs ?? []) {
    transactions.push({
      id: txId("acquired", log),
      at: at(log),
      kind: "acquired",
      title: "Asset acquired",
      detail: `${shortHex((log.args.assetId as string) ?? "")} · ${
        log.args.amount?.toString() ?? "?"
      } units · ${usdc(log.args.cost ?? 0n)} USDC`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of disposedLogs ?? []) {
    transactions.push({
      id: txId("disposed", log),
      at: at(log),
      kind: "disposed",
      title: "Asset disposed",
      detail: `${shortHex((log.args.assetId as string) ?? "")} · ${
        log.args.amount?.toString() ?? "?"
      } units → ${shortHex((log.args.to as string) ?? "")}`,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of fundedLogs ?? []) {
    const amount = usdc(log.args.amountOut ?? 0n);
    transactions.push({
      id: txId("funded", log),
      at: at(log),
      kind: "funding",
      title: "Treasury funded via Uniswap",
      detail: `${formatUnits(log.args.amountIn ?? 0n, 18)} ETH → ${amount.toFixed(
        2,
      )} USDC`,
      amount,
      unit: "USDC",
      direction: "in",
      counterparty: (log.args.caller as string) ?? undefined,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of swappedLogs ?? []) {
    transactions.push({
      id: txId("swapped", log),
      at: at(log),
      kind: "swap",
      title: "Treasury swap",
      detail: `${shortHex((log.args.tokenIn as string) ?? "")} → ${shortHex(
        (log.args.tokenOut as string) ?? "",
      )}`,
      amount: usdc(log.args.amountOut ?? 0n),
      unit: "USDC",
      direction: "in",
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  const seenTransfers = new Set<string>();
  for (const log of inboundTransfers ?? []) {
    const key = `${log.transactionHash}-${log.logIndex}`;
    if (seenTransfers.has(key)) continue;
    seenTransfers.add(key);
    const amount = usdc(log.args.value ?? 0n);
    transactions.push({
      id: txId("transfer-in", log),
      at: at(log),
      kind: "transfer_in",
      title: "USDC received",
      detail: `from ${shortHex((log.args.from as string) ?? "")}`,
      amount,
      unit: "USDC",
      direction: "in",
      token: tokenAddress ?? undefined,
      counterparty: (log.args.from as string) ?? undefined,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  for (const log of outboundTransfers ?? []) {
    const key = `${log.transactionHash}-${log.logIndex}`;
    if (seenTransfers.has(key)) continue;
    seenTransfers.add(key);
    const amount = usdc(log.args.value ?? 0n);
    transactions.push({
      id: txId("transfer-out", log),
      at: at(log),
      kind: "transfer_out",
      title: "USDC sent",
      detail: `to ${shortHex((log.args.to as string) ?? "")}`,
      amount,
      unit: "USDC",
      direction: "out",
      token: tokenAddress ?? undefined,
      counterparty: (log.args.to as string) ?? undefined,
      txHash: hashOf(log),
      block: blockOf(log),
    });
  }

  transactions.sort((a, b) => b.at - a.at || b.block - a.block);

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
    transactions,
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

export type ChainDaoSummary = {
  core: Address;
  daoId: Hex;
  admin: Address;
  agentAccount: Address;
  agentPaused: boolean;
  memberCount: number;
  proposalCount: number;
  balance: bigint;
  decimals: number;
};

/**
 * Cheap card-level read for the DAO list.
 *
 * `readChainSnapshot` reads every member, proposal, asset and log — the right
 * thing for one open console, far too much for N cards. This only reads the
 * handful of slots the list renders.
 */
export async function readChainSummary(
  client: PublicClient,
  core: Address,
): Promise<ChainDaoSummary> {
  const [daoId, admin, agentAccount, memberCount, proposalCount] =
    await Promise.all([
      client.readContract({ address: core, abi: daoCoreAbi, functionName: "daoId" }),
      client.readContract({ address: core, abi: daoCoreAbi, functionName: "admin" }),
      client.readContract({
        address: core,
        abi: daoCoreAbi,
        functionName: "agentAccount",
      }),
      client.readContract({
        address: core,
        abi: daoCoreAbi,
        functionName: "memberCount",
      }),
      client.readContract({
        address: core,
        abi: daoCoreAbi,
        functionName: "proposalCount",
      }),
    ]);

  let agentPaused = false;
  try {
    agentPaused = await client.readContract({
      address: agentAccount as Address,
      abi: agentAccountAbi,
      functionName: "paused",
    });
  } catch {
    /* agent account may not be readable yet */
  }

  const tokenAddress = config.usdcAddress;
  let balance = 0n;
  let decimals = config.usdcDecimals;
  if (tokenAddress) {
    try {
      balance = await client.readContract({
        address: tokenAddress as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [core],
      });
    } catch {
      /* token may not be deployed on this chain */
    }
  } else {
    balance = await client.getBalance({ address: core });
    decimals = 18;
  }

  return {
    core,
    daoId: daoId as Hex,
    admin: admin as Address,
    agentAccount: agentAccount as Address,
    agentPaused: Boolean(agentPaused),
    memberCount: Number(memberCount),
    proposalCount: Number(proposalCount),
    balance,
    decimals,
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
export function snapshotToDaoState(
  snapshot: ChainSnapshot,
  nameOverride?: string,
): DaoState {
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
      name:
        nameOverride ||
        daoNameFromId(snapshot.daoId) ||
        `DAO ${shortHex(snapshot.daoId)}`,
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
    transactions: snapshot.transactions,
    policy: snapshot.policy,
    oracle: snapshot.oracle,
    capUsage: {
      periodSpent: toNumber(snapshot.token.spent, decimals),
      membersAdded: snapshot.memberPolicy.addsThisPeriod,
    },
  };
}
