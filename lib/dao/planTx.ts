import {
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  keccak256,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { daoCoreAbi } from "@/lib/daoAbis.mjs";
import { DEPTH, rootAndPath } from "@/lib/zk/tree.mjs";
import { config } from "@/lib/config";
import type { DaoState, Member, Plan } from "./types";

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

/** DaoCore action type codes, mirroring contracts/DaoCore.sol. */
export const ACTION_CODES = {
  add_members: 1,
  remove_member: 2,
  change_role: 3,
  dispose_asset: 4,
  pay: 5,
  propose: 6,
  acquire_asset: 7,
  swap: 8,
} as const;

export type CoreWrite =
  | "addMembers"
  | "removeMember"
  | "setRole"
  | "spend"
  | "acquireAsset"
  | "disposeAsset"
  | "pauseAgent"
  | "createProposal";

export type AdminAuth = {
  nonce: bigint;
  expiry: bigint;
  signature: Hex;
};

export type PreparedCall = {
  functionName: CoreWrite;
  to: Address;
  /**
   * Positional args. Admin-tier calls end with an `AdminAuth` placeholder that
   * `encodeCall` replaces once the admin has signed.
   */
  args: readonly unknown[];
  actionType: number;
  /** Exact `paramsHash` the admin must sign (contract encoding, not the UI hash). */
  paramsHash: Hex;
  tier: number;
  needsAdmin: boolean;
  /** Callable only by the admin EOA directly, not through the agent account. */
  direct?: boolean;
  /** Member secrets generated for `add_members`, to be stored as labels. */
  secrets?: { leaf: Hex; name: string; secret: string }[];
};

export type PrepareResult =
  | { ok: true; call: PreparedCall }
  | { ok: false; reason: string };

function bytes32FromLabel(label: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(label)) return label as Hex;
  return keccak256(stringToHex(label.trim()));
}

function tokenAddress(): Address | null {
  return isAddress(config.usdcAddress) ? config.usdcAddress : null;
}

function findMember(state: DaoState, nameOrId: string): Member | undefined {
  const needle = nameOrId.trim().toLowerCase();
  return state.members.find(
    (member) =>
      member.id.toLowerCase() === needle ||
      member.name.toLowerCase() === needle ||
      (member.wallet && member.wallet.toLowerCase() === needle),
  );
}

function memberIndex(state: DaoState, member: Member): number {
  if (typeof member.index === "number") return member.index;
  return state.members.indexOf(member);
}

function leavesFromState(state: DaoState): bigint[] {
  const indexed = state.members.filter(
    (member) => typeof member.index === "number" && member.active,
  );
  const max = indexed.reduce((acc, member) => Math.max(acc, member.index!), -1);
  const leaves = Array.from({ length: Math.max(0, max + 1) }, () => 0n);
  for (const member of indexed) {
    leaves[member.index!] = BigInt(member.leaf);
  }
  return leaves;
}

function hexFromBigInt(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

async function rootOf(leaves: bigint[]): Promise<Hex> {
  const { root } = await rootAndPath(leaves.length ? leaves : [0n], 0, DEPTH);
  return hexFromBigInt(root);
}

function authPlaceholder(): AdminAuth {
  return { nonce: 0n, expiry: 0n, signature: "0x" };
}

/**
 * Turn a plan into the exact DaoCore call it represents.
 *
 * This is the boundary between the agent's language and the chain: every
 * `paramsHash` is recomputed with the contract's own `abi.encode` shape, so the
 * admin signs the call that will actually run, not the UI's display hash.
 */
export async function preparePlan(
  plan: Plan,
  state: DaoState,
): Promise<PrepareResult> {
  const core = state.config.coreAddress as Address;
  const decimals = config.usdcDecimals;
  const promptHash = (plan.promptHash || ZERO_HASH) as Hex;
  const planHash = (plan.planHash || ZERO_HASH) as Hex;

  switch (plan.action) {
    case "pay": {
      const token = tokenAddress();
      if (!token) {
        return { ok: false, reason: "NEXT_PUBLIC_USDC_ADDRESS is not set" };
      }
      const recipients = Array.isArray(plan.params.recipients)
        ? (plan.params.recipients as string[])
        : [];
      const explicitTo = String(plan.params.to ?? "");
      const target =
        (isAddress(explicitTo) ? (explicitTo as Address) : undefined) ??
        (recipients.length
          ? (state.members.find((m) => m.name === recipients[0])?.wallet as
              | Address
              | undefined)
          : undefined);
      if (!target || !isAddress(target)) {
        return {
          ok: false,
          reason:
            "this payout has no on-chain recipient address; add a wallet to the plan",
        };
      }
      const amount = parseUnits(String(plan.params.amount ?? "0"), decimals);
      if (amount <= 0n) return { ok: false, reason: "payout amount is zero" };
      return {
        ok: true,
        call: {
          functionName: "spend",
          to: core,
          args: [token, target, amount, promptHash, planHash],
          actionType: ACTION_CODES.pay,
          paramsHash: ZERO_HASH,
          tier: 1,
          needsAdmin: false,
        },
      };
    }

    case "pause": {
      return {
        ok: true,
        call: {
          functionName: "pauseAgent",
          to: core,
          args: [plan.params.mode !== "resume"],
          actionType: 0,
          paramsHash: ZERO_HASH,
          tier: 2,
          needsAdmin: false,
          direct: true,
        },
      };
    }

    case "acquire_asset": {
      const assetId = bytes32FromLabel(String(plan.params.assetId ?? ""));
      const amount = BigInt(Number(plan.params.quantity ?? 1));
      if (amount <= 0n) return { ok: false, reason: "quantity is zero" };
      return {
        ok: true,
        call: {
          functionName: "acquireAsset",
          to: core,
          args: [assetId, amount],
          actionType: ACTION_CODES.acquire_asset,
          paramsHash: ZERO_HASH,
          tier: 1,
          needsAdmin: false,
        },
      };
    }

    case "dispose_asset": {
      const assetId = bytes32FromLabel(String(plan.params.assetId ?? ""));
      const amount = BigInt(Number(plan.params.quantity ?? 1));
      const to = String(plan.params.to ?? state.config.treasuryAddress);
      if (!isAddress(to)) return { ok: false, reason: "invalid dispose recipient" };
      const paramsHash = keccak256(
        encodeAbiParameters(
          [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }],
          [assetId, amount, to as Address],
        ),
      );
      return {
        ok: true,
        call: {
          functionName: "disposeAsset",
          to: core,
          args: [assetId, amount, to as Address, authPlaceholder()],
          actionType: ACTION_CODES.dispose_asset,
          paramsHash,
          tier: 2,
          needsAdmin: true,
        },
      };
    }

    case "change_role": {
      const member = findMember(state, String(plan.params.member ?? ""));
      if (!member) return { ok: false, reason: "member not found on-chain" };
      const roleName = String(plan.params.newRole ?? "member");
      const role = roleName === "contributor" ? 1 : roleName === "admin" ? 2 : 0;
      const index = memberIndex(state, member);
      if (index < 0) return { ok: false, reason: "member has no leaf index" };
      const paramsHash = keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint8" }],
          [BigInt(index), role],
        ),
      );
      return {
        ok: true,
        call: {
          functionName: "setRole",
          to: core,
          args: [BigInt(index), role, authPlaceholder()],
          actionType: ACTION_CODES.change_role,
          paramsHash,
          tier: 2,
          needsAdmin: true,
        },
      };
    }

    case "remove_member": {
      const member = findMember(
        state,
        String(plan.params.memberId ?? plan.params.name ?? ""),
      );
      if (!member) return { ok: false, reason: "member not found on-chain" };
      const index = memberIndex(state, member);
      if (index < 0) return { ok: false, reason: "member has no leaf index" };
      const leaves = leavesFromState(state);
      if (index < leaves.length) leaves[index] = 0n;
      const newRoot = await rootOf(leaves);
      const paramsHash = keccak256(
        encodeAbiParameters(
          [{ type: "uint256" }, { type: "bytes32" }],
          [BigInt(index), newRoot],
        ),
      );
      return {
        ok: true,
        call: {
          functionName: "removeMember",
          to: core,
          args: [BigInt(index), newRoot, authPlaceholder()],
          actionType: ACTION_CODES.remove_member,
          paramsHash,
          tier: 2,
          needsAdmin: true,
        },
      };
    }

    case "add_members": {
      const rawCommitments = Array.isArray(plan.params.commitments)
        ? (plan.params.commitments as string[])
        : [];
      const rawIndices = Array.isArray(plan.params.indices)
        ? (plan.params.indices as (number | string)[]).map((value) =>
            Number(value),
          )
        : [];
      if (
        rawCommitments.length === 0 ||
        rawCommitments.length !== rawIndices.length
      ) {
        return {
          ok: false,
          reason: "invites must be claimed before they can be added on-chain",
        };
      }
      const commitments = rawCommitments.map((value) => BigInt(value));
      const indices = rawIndices.map((value) => BigInt(value));
      const leaves = leavesFromState(state);
      for (let i = 0; i < commitments.length; i += 1) {
        const index = Number(indices[i]);
        while (leaves.length <= index) leaves.push(0n);
        leaves[index] = commitments[i];
      }
      const newRoot = await rootOf(leaves);
      const paramsHash = keccak256(
        encodeAbiParameters(
          [
            { type: "uint256[]" },
            { type: "uint256[]" },
            { type: "bytes32" },
          ],
          [commitments, indices, newRoot],
        ),
      );
      return {
        ok: true,
        call: {
          functionName: "addMembers",
          to: core,
          args: [commitments, indices, newRoot, authPlaceholder()],
          actionType: ACTION_CODES.add_members,
          paramsHash,
          tier: 2,
          needsAdmin: true,
        },
      };
    }

    case "propose":
    case "update_policy":
      return {
        ok: false,
        reason:
          "governance actions need a concrete target call; draft them as a proposal on-chain first",
      };

    case "frame":
      return {
        ok: false,
        reason: "frame plans are built by the worker, not executed from the console",
      };

    case "summarize":
    case "vote":
      return { ok: false, reason: "nothing to execute" };

    default:
      return { ok: false, reason: `unsupported action ${String(plan.action)}` };
  }
}

/** Encode the prepared call, filling in the admin signature when required. */
export function encodeCall(call: PreparedCall, auth?: AdminAuth): Hex {
  const args = call.needsAdmin
    ? [...call.args.slice(0, -1), auth ?? authPlaceholder()]
    : call.args;
  return encodeFunctionData({
    abi: daoCoreAbi,
    functionName: call.functionName,
    args: args as never,
  });
}
