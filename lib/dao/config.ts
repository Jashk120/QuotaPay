import type { DaoState } from "./types";

export type DaoConfigDraft = {
  name: string;
  treasuryUsdc: number;
  perTxCap: number;
  perPeriodCap: number;
  addMemberRateLimit: number;
  votingWindowHours: number;
};

export const DEFAULT_DAO_CONFIG: DaoConfigDraft = {
  name: "New Collective",
  treasuryUsdc: 5000,
  perTxCap: 200,
  perPeriodCap: 1000,
  addMemberRateLimit: 10,
  votingWindowHours: 48,
};

function amount(text: string, pattern: RegExp, fallback: number): number {
  const match = text.match(pattern);
  if (!match) return fallback;
  const value = Number(String(match[1]).replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return /^k$/i.test(match[2] || "") ? value * 1000 : value;
}

/** Deterministic fallback: regex extraction from the prompt. Always available. */
export function parseDaoConfig(prompt: string): DaoConfigDraft {
  const text = String(prompt || "");
  const treasury = amount(
    text,
    /([\d,.]+)\s*(k)?\s*(?:usdc\s*)?(?:in\s+)?treasury/i,
    DEFAULT_DAO_CONFIG.treasuryUsdc,
  );
  const perTx = amount(
    text,
    /(?:up to|cap(?:ped)?\s+at|max(?:imum)?\s+(?:spend\s+)?(?:of)?)\s*\$?([\d,.]+)\s*(k)?/i,
    DEFAULT_DAO_CONFIG.perTxCap,
  );
  const perPeriod = amount(
    text,
    /(?:per[- ]period|monthly|per[- ]month)\s*(?:cap)?\s*(?:of\s*)?\$?([\d,.]+)\s*(k)?/i,
    Math.max(perTx * 5, DEFAULT_DAO_CONFIG.perPeriodCap),
  );
  const rate =
    amount(
      text,
      /(?:add|invite|onboard|up to|max(?:imum)?)\s*([\d,.]+)\s*(k)?\s*(?:members?|people|additions?)/i,
      Number.NaN,
    ) ||
    amount(
      text,
      /([\d,.]+)\s*(k)?\s*(?:members?|people)\s*(?:max|maximum|limit)/i,
      DEFAULT_DAO_CONFIG.addMemberRateLimit,
    );
  const window = amount(
    text,
    /([\d,.]+)\s*(k)?\s*(?:hours?|hrs?)\s*(?:voting|vote|window)?/i,
    DEFAULT_DAO_CONFIG.votingWindowHours,
  );
  const named = text.match(/(?:call(?:ed)?\s+it|named?|name\s*:)\s*["“]?([A-Za-z0-9 .&'-]{2,60})["”]?/i);
  return {
    name: named ? named[1].trim() : DEFAULT_DAO_CONFIG.name,
    treasuryUsdc: treasury,
    perTxCap: perTx,
    perPeriodCap: Math.max(perPeriod, perTx),
    addMemberRateLimit: Math.round(rate),
    votingWindowHours: Math.round(window),
  };
}

/** Validate a model-produced object into the fields it actually returned. */
export function coerceDaoConfig(raw: unknown): Partial<DaoConfigDraft> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const out: Partial<DaoConfigDraft> = {};
  if (typeof r.name === "string" && r.name.trim()) {
    out.name = r.name.trim().slice(0, 60);
  }
  const treasury = num(r.treasuryUsdc);
  if (treasury !== undefined) out.treasuryUsdc = treasury;
  const perTx = num(r.perTxCap);
  if (perTx !== undefined) out.perTxCap = perTx;
  const perPeriod = num(r.perPeriodCap);
  if (perPeriod !== undefined) out.perPeriodCap = perPeriod;
  const rate = num(r.addMemberRateLimit);
  if (rate !== undefined) out.addMemberRateLimit = Math.round(rate);
  const window = num(r.votingWindowHours);
  if (window !== undefined) out.votingWindowHours = Math.round(window);
  return out;
}

export function buildConfigSystemPrompt(): string {
  return [
    "You convert a plain-language DAO description into a JSON config.",
    'Output ONE JSON object: {"name": string, "treasuryUsdc": number, "perTxCap": number, "perPeriodCap": number, "addMemberRateLimit": number, "votingWindowHours": number}.',
    "Numbers are USDC whole units, no symbols. Omit any field you cannot infer.",
    "Never output addresses, calldata, code, or prose.",
    'Example: "invite-only DAO, 5k treasury, auto-approve up to $200" -> {"treasuryUsdc":5000,"perTxCap":200,"perPeriodCap":1000}.',
  ].join("\n");
}

export type { DaoState };
