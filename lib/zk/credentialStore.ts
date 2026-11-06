// Local credential storage for the ZK demo. The credential contains the
// holder's secret; in production this belongs in a secure keystore, not
// localStorage. The session key is derived separately and never stored here.
import { parseZkCredential, type ZkCredential } from "./client";

const KEY = "quotapay.zk-credential.v1";

export function saveZkCredential(credential: ZkCredential) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(credential));
}

export function loadZkCredential(): ZkCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return parseZkCredential(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearZkCredential() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
