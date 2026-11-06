// Client-side ZK helpers. Keep this module free of Node-only imports: it runs
// in the browser, where the proof is generated from the holder's secret.
import { isAddress } from "viem";
import { poseidon2, poseidon3 } from "poseidon-lite";

export const ZK_TREE_DEPTH = 20;
// Measured verifier ~256k. The declared frame budget is 330k, matching
// scripts/zk-sponsor.mjs and ZK.md.
export const ZK_CHARGE_EXECUTION_GAS = 330_000n;
export const ZK_CHARGE_STATE_GAS = 300_000n;

export type ZkCredential = {
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  root: string;
  epoch: string;
  paymaster: string;
  chainId: number;
};

export type ZkWitness = {
  secret: string;
  pathElements: string[];
  pathIndices: number[];
  root: string;
  epoch: string;
  paymaster: string;
  chainId: string;
  sessionKey: string;
  identityNullifier: string;
  sessionNullifier: string;
};

export type ZkProof = {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[];
};

function asBigInt(value: unknown, field: string): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string" && value.trim() !== "") return BigInt(value);
  } catch {
    /* fall through */
  }
  throw new Error(`${field} must be an integer`);
}

/** Validate and normalize a credential JSON pasted by the holder. */
export function parseZkCredential(raw: unknown): ZkCredential {
  if (!raw || typeof raw !== "object") throw new Error("credential must be an object");
  const c = raw as Record<string, unknown>;
  const secret = asBigInt(c.secret, "secret").toString();
  const root = asBigInt(c.root, "root").toString();
  const epoch = asBigInt(c.epoch, "epoch").toString();
  const chainId = Number(asBigInt(c.chainId, "chainId"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("chainId is invalid");
  }
  if (typeof c.paymaster !== "string" || !isAddress(c.paymaster)) {
    throw new Error("paymaster must be a valid address");
  }
  if (
    !Array.isArray(c.pathElements) ||
    c.pathElements.length !== ZK_TREE_DEPTH
  ) {
    throw new Error(`pathElements must have ${ZK_TREE_DEPTH} entries`);
  }
  if (!Array.isArray(c.pathIndices) || c.pathIndices.length !== ZK_TREE_DEPTH) {
    throw new Error(`pathIndices must have ${ZK_TREE_DEPTH} entries`);
  }
  const pathElements = c.pathElements.map((v, i) =>
    asBigInt(v, `pathElements[${i}]`).toString(),
  );
  const pathIndices = c.pathIndices.map((v, i) => {
    const bit = Number(v);
    if (bit !== 0 && bit !== 1) throw new Error(`pathIndices[${i}] must be 0 or 1`);
    return bit;
  });
  return {
    secret,
    pathElements,
    pathIndices,
    root,
    epoch,
    paymaster: c.paymaster,
    chainId,
  };
}

export function parseZkCredentialJson(text: string): ZkCredential {
  try {
    return parseZkCredential(JSON.parse(text));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error("credential is not valid JSON");
    throw e;
  }
}

/** Compute the per-epoch nullifier and the session-binding value. */
export function computeZkNullifiers({
  secret,
  epoch,
  sessionKey,
}: {
  secret: string;
  epoch: string;
  sessionKey: string;
}) {
  const s = asBigInt(secret, "secret");
  const e = asBigInt(epoch, "epoch");
  const k = asBigInt(sessionKey, "sessionKey");
  return {
    identityNullifier: poseidon2([s, e]),
    sessionNullifier: poseidon3([s, e, k]),
  };
}

/** Build the exact input object circuits/Membership.circom expects. */
export function buildZkWitness(
  credential: ZkCredential,
  sessionKey: string,
): ZkWitness {
  if (!isAddress(sessionKey)) throw new Error("sessionKey must be an address");
  const { identityNullifier, sessionNullifier } = computeZkNullifiers({
    secret: credential.secret,
    epoch: credential.epoch,
    sessionKey,
  });
  return {
    secret: credential.secret,
    pathElements: credential.pathElements,
    pathIndices: credential.pathIndices,
    root: credential.root,
    epoch: credential.epoch,
    paymaster: asBigInt(credential.paymaster, "paymaster").toString(),
    chainId: asBigInt(credential.chainId, "chainId").toString(),
    sessionKey: asBigInt(sessionKey, "sessionKey").toString(),
    identityNullifier: identityNullifier.toString(),
    sessionNullifier: sessionNullifier.toString(),
  };
}

/** Public inputs in the circuit's declaration order. */
export function expectedPublicSignals(witness: ZkWitness): string[] {
  return [
    witness.root,
    witness.epoch,
    witness.paymaster,
    witness.chainId,
    witness.sessionKey,
    witness.identityNullifier,
    witness.sessionNullifier,
  ];
}

type SnarkjsBrowser = {
  groth16: {
    fullProve: (
      input: unknown,
      wasmUrl: string,
      zkeyUrl: string,
    ) => Promise<{
      proof: {
        pi_a: [string, string, ...string[]];
        pi_b: [[string, string], [string, string], ...unknown[]];
        pi_c: [string, string, ...string[]];
      };
      publicSignals: string[];
    }>;
  };
};

/**
 * Generate the Groth16 proof in the browser. The wasm/zkey are served from
 * public/zk (run `npm run zk:publish`); the secret never leaves this tab.
 */
export async function proveZkMembership(
  witness: ZkWitness,
  wasmUrl: string,
  zkeyUrl: string,
): Promise<ZkProof> {
  const mod = (await import("snarkjs")) as unknown as SnarkjsBrowser;
  const { proof, publicSignals } = await mod.groth16.fullProve(
    witness,
    wasmUrl,
    zkeyUrl,
  );
  // snarkjs' Solidity calldata convention swaps the two B coordinates.
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
    publicSignals,
  };
}

export function samePublicSignals(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => BigInt(v) === BigInt(b[i]));
}
