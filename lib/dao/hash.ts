import { keccak256, toHex } from "viem";
import type { Plan } from "./types";

/**
 * The spec calls promptHash and planHash "reported by the agent, informational,
 * not verified". We compute them locally so the audit feed has stable-looking
 * identifiers in the UI-only demo.
 */
export function withHashes(prompt: string, plan: Plan): Plan {
  const promptHash = keccak256(toHex(prompt));
  const planHash = keccak256(
    toHex(
      JSON.stringify({
        action: plan.action,
        tier: plan.tier,
        params: plan.params,
        resolved: plan.resolved.map((entity) => entity.label),
      }),
    ),
  );
  return { ...plan, promptHash, planHash };
}

export function shortHash(value: string, head = 10, tail = 6): string {
  if (!value || value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
