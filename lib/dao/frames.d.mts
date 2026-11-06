export type FrameMode = 0 | 1 | 2;

export type FramePlanFrame = {
  mode: FrameMode;
  modeName: "DEFAULT" | "VERIFY" | "SENDER";
  flags: number;
  to: string | null;
  executionGas: string;
  stateGas: string;
  value: string;
  purpose: string;
};

export type FramePlan = {
  pattern: string;
  frames: FramePlanFrame[];
  constraints: string[];
  notes: string[];
};

export type FrameBuildOptions = {
  sender?: string;
  paymaster?: string;
  chargeSelector?: string;
  calls?: number;
  value?: bigint;
  expiry?: number;
};

export const EIP8141: {
  type: string;
  entryPoint: string;
  expiryVerifier: string;
  maxFrames: number;
  intrinsicGas: bigint;
  perFrameGas: bigint;
  maxVerifyGas: bigint;
  maxVerifyStateGas: bigint;
  maxPendingPerSender: number;
  maxPendingPerNonCanonicalPaymaster: number;
  approve: { none: number; payment: number; execution: number; both: number };
  atomicBatchFlag: number;
};

export const FRAME_MODES: ReadonlyArray<{
  mode: FrameMode;
  name: string;
  caller: string;
  mutable: boolean;
  approval: string;
  use: string;
}>;

export const INTROSPECTION: ReadonlyArray<{ op: string; params: Record<string, string> }>;

export const SIGNATURE_SCHEMES: ReadonlyArray<{
  scheme: 0 | 1 | 2;
  name: string;
  gas: number;
  encoding: string;
  note: string;
}>;

export const STATIC_RULES: ReadonlyArray<string>;

export const FRAME_PATTERNS: ReadonlyArray<{
  pattern: string;
  title: string;
  shape: string;
  use: string;
}>;

export function buildFramePlan(pattern: string, opts?: FrameBuildOptions): FramePlan;
export function validateFramePlan(plan: FramePlan): { ok: boolean; errors: string[] };
export function buildFrameCatalogPrompt(): string;
