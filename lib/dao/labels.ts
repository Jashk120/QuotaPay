import type { DaoAsset, Invite } from "./types";

/**
 * Presentation overlay for on-chain DAOs.
 *
 * The chain stores commitments, roles, caps and votes — not human names. This
 * store keeps the labels (member names, asset names, proposal titles) that the
 * UI needs, keyed by the on-chain identifier so a label can never masquerade as
 * state. Nothing here is authoritative: deleting it changes how the DAO is
 * displayed, never what it can do.
 */
export type DaoLabels = {
  version: 1;
  daoName?: string;
  createdAt?: number;
  /** key: lowercase leaf commitment (`0x…`) */
  members: Record<string, { name: string; wallet?: string; secret?: string }>;
  /** key: lowercase assetId (`0x…`) */
  assets: Record<string, { name: string; kind: DaoAsset["kind"] }>;
  /** key: lowercase paramsHash (`0x…`) */
  proposals: Record<string, { title: string }>;
  invites: Invite[];
};

export const DAO_LABELS_KEY = "dao.operator.labels.v1";

export function emptyLabels(): DaoLabels {
  return { version: 1, members: {}, assets: {}, proposals: {}, invites: [] };
}

function isLabels(value: unknown): value is DaoLabels {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DaoLabels>;
  return (
    candidate.version === 1 &&
    Boolean(candidate.members) &&
    Boolean(candidate.assets) &&
    Boolean(candidate.proposals)
  );
}

export function loadLabels(): DaoLabels {
  if (typeof window === "undefined") return emptyLabels();
  try {
    const raw = window.localStorage.getItem(DAO_LABELS_KEY);
    if (!raw) return emptyLabels();
    const parsed: unknown = JSON.parse(raw);
    return isLabels(parsed) ? parsed : emptyLabels();
  } catch {
    return emptyLabels();
  }
}

export function saveLabels(labels: DaoLabels) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DAO_LABELS_KEY, JSON.stringify(labels));
  } catch {
    /* quota or private mode — labels are optional */
  }
}

export function patchLabels(
  recipe: (draft: DaoLabels) => void,
): DaoLabels {
  const draft = loadLabels();
  recipe(draft);
  saveLabels(draft);
  return draft;
}

/** Stable lowercase key for a hex identifier. */
export function labelKey(value: string): string {
  return value.toLowerCase();
}
