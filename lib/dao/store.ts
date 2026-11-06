import { seedDao } from "./seed";
import type { DaoState } from "./types";

export const DAO_STORAGE_KEY = "dao.operator.state.v1";
export const DAO_CHANNEL = "dao.operator.v1";

function isDaoState(value: unknown): value is DaoState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DaoState>;
  return (
    candidate.version === 1 &&
    Boolean(candidate.config) &&
    Array.isArray(candidate.members) &&
    Array.isArray(candidate.proposals) &&
    Array.isArray(candidate.events)
  );
}

export function loadDao(): DaoState {
  if (typeof window === "undefined") return seedDao();
  try {
    const raw = window.localStorage.getItem(DAO_STORAGE_KEY);
    if (!raw) return seedDao();
    const parsed: unknown = JSON.parse(raw);
    return isDaoState(parsed) ? parsed : seedDao();
  } catch {
    return seedDao();
  }
}

export function saveDao(state: DaoState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DAO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode — the demo still works in memory */
  }
}

export function clearDao() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DAO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function broadcastDao() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return;
  }
  try {
    const channel = new BroadcastChannel(DAO_CHANNEL);
    channel.postMessage({ type: "state-changed" });
    channel.close();
  } catch {
    /* ignore */
  }
}
