import type { DaoState } from "./types";

/**
 * The state before the first chain read (or when no DAO is configured).
 *
 * It is deliberately empty: the console must never render invented members,
 * assets, proposals or balances. Everything shown comes from `DaoCore`,
 * `AgentAccount`, `AssetModule` and their logs.
 */
export function emptyDaoState(core = ""): DaoState {
  return {
    version: 1,
    config: {
      name: core ? "On-chain DAO" : "No DAO configured",
      daoId: "",
      coreAddress: core,
      agentAddress: "",
      treasuryAddress: core,
      adminAddress: "",
      treasuryUsdc: 0,
      perTxCap: 0,
      perPeriodCap: 0,
      addMemberRateLimit: 0,
      votingWindowHours: 0,
      createdAt: 0,
      agentPaused: false,
    },
    members: [],
    invites: [],
    proposals: [],
    assets: [],
    events: [],
    transactions: [],
    policy: [],
    capUsage: { periodSpent: 0, membersAdded: 0 },
  };
}
