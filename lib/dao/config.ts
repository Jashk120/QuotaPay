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
  const rate = amount(
    text,
    /(?:add|invite|onboard)\s*(?:up to\s*)?([\d,.]+)\s*(k)?\s*(?:members?|people|additions?)/i,
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

/** Validate a model-produced object into a safe config draft. */
export function coerceDaoConfig(raw: unknown): DaoConfigDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const name =
    typeof r.name === "string" && r.name.trim()
      ? r.name.trim().slice(0, 60)
      : DEFAULT_DAO_CONFIG.name;
  const perTx = num(r.perTxCap, DEFAULT_DAO_CONFIG.perTxCap);
  return {
    name,
    treasuryUsdc: num(r.treasuryUsdc, DEFAULT_DAO_CONFIG.treasuryUsdc),
    perTxCap: perTx,
    perPeriodCap: Math.max(num(r.perPeriodCap, perTx * 5), perTx),
    addMemberRateLimit: Math.round(
      num(r.addMemberRateLimit, DEFAULT_DAO_CONFIG.addMemberRateLimit),
    ),
    votingWindowHours: Math.round(
      num(r.votingWindowHours, DEFAULT_DAO_CONFIG.votingWindowHours),
    ),
  };
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
