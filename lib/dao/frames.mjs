/**
 * EIP-8141 frame-transaction capability catalog (JS so the VPS worker can
 * import it without a TypeScript build step).
 *
 * Source: https://eips.ethereum.org/EIPS/eip-8141 (Draft, 2026-01-29) plus the
 * devnet profile in lib/devnetFrameTx.ts. This module is the single machine-
 * readable description of what a frame transaction can do, so the LLM picks
 * from real primitives instead of inventing calldata.
 *
 * Nothing here submits a transaction. Builders return a typed plan; the
 * worker/skill gate and the on-chain contracts still decide.
 */

export const EIP8141 = {
  type: "0x06",
  entryPoint: "0x00000000000000000000000000000000000000aa",
  expiryVerifier: "0x81413f0cF12e9b6a49B1D0439E081c577D57FfFf",
  maxFrames: 64,
  intrinsicGas: 12000n,
  perFrameGas: 475n,
  maxVerifyGas: 100000n,
  maxVerifyStateGas: 500000n,
  maxPendingPerSender: 1,
  maxPendingPerNonCanonicalPaymaster: 1,
  approve: { none: 0, payment: 1, execution: 2, both: 3 },
  atomicBatchFlag: 4,
};

export const FRAME_MODES = [
  {
    mode: 0,
    name: "DEFAULT",
    caller: "ENTRY_POINT (0xaa)",
    mutable: true,
    approval: "payment only",
    use: "pre_verify / charge hooks: policy checks, nullifier burns, fee accounting",
  },
  {
    mode: 1,
    name: "VERIFY",
    caller: "ENTRY_POINT (0xaa)",
    mutable: false,
    approval: "execution and/or payment; frame runs as STATICCALL",
    use: "signature/policy validation; approving execution authorizes every later SENDER frame",
  },
  {
    mode: 2,
    name: "SENDER",
    caller: "tx.sender",
    mutable: true,
    approval: "none (execution must already be approved)",
    use: "the actual user operation; the only mode allowed to carry value",
  },
];

export const INTROSPECTION = [
  {
    op: "TXPARAM (0xb0)",
    params: {
      "0x00": "tx type",
      "0x01": "nonce",
      "0x02": "sender",
      "0x03": "maxPriorityFeePerGas",
      "0x04": "maxFee",
      "0x07": "blob count",
      "0x08": "sig hash",
      "0x09": "frame count",
      "0x0a": "current frame index",
      "0x0b": "signature count",
      "0x0c": "state gas left",
    },
  },
  {
    op: "FRAMEPARAM (0xb3)",
    params: {
      "0x00": "resolved target",
      "0x01": "execution gas limit",
      "0x02": "mode",
      "0x03": "flags",
      "0x04": "data length",
      "0x05": "status (0 fail, 1 ok, 2 skipped)",
      "0x06": "allowed approval scope",
      "0x07": "atomic batch bit",
      "0x08": "value",
      "0x09": "state gas limit",
      "0x0a": "execution gas used",
      "0x0b": "state gas used",
    },
  },
  {
    op: "FRAMEDATALOAD (0xb1) / FRAMEDATACOPY (0xb2)",
    params: { note: "read another frame's calldata; how a VERIFY policy inspects SENDER frames" },
  },
  {
    op: "SIGPARAM (0xb4) / SIGDATACOPY (0xb5)",
    params: {
      "0x00": "resolved signer",
      "0x01": "scheme",
      "0x02": "msg",
      "0x03": "signature length (ARBITRARY only)",
      note: "raw bytes of protocol schemes are not introspectable",
    },
  },
];

export const SIGNATURE_SCHEMES = [
  { scheme: 0, name: "ARBITRARY", gas: 100, encoding: "any bytes", note: "witness readable via SIGDATACOPY" },
  { scheme: 1, name: "SECP256K1", gas: 2800, encoding: "v || r || s (65)", note: "default EOA code uses index 0" },
  { scheme: 2, name: "P256", gas: 6700, encoding: "r || s || qx || qy (128)", note: "post-quantum-friendly path" },
];

export const STATIC_RULES = [
  "1..64 frames; frame value is only legal on SENDER frames",
  "APPROVE_EXECUTION is only legal when the frame target is empty or tx.sender",
  "atomic batch flag (bit 2) is only legal on DEFAULT/SENDER, must not be last, and the next frame must not be VERIFY",
  "no approval-scope flags on any frame inside an atomic batch",
  "VERIFY frames execute as STATICCALL; only APPROVE may change tx-scoped state",
  "a transaction is invalid unless some frame sets payer (approve payment)",
  "transient storage is discarded between frames",
  "value transfer costs 6000 gas and emits an EIP-7708 log",
];

export const FRAME_PATTERNS = [
  {
    pattern: "sponsored_call",
    title: "Sponsored call (paymaster pays)",
    shape: "VERIFY(sender,exec) -> DEFAULT(paymaster.charge) -> VERIFY(paymaster,pay) -> SENDER(op)",
    use: "the QuotaPay default: beneficiary holds 0 ETH",
  },
  {
    pattern: "sponsored_deploy",
    title: "Sponsored deployment",
    shape: "VERIFY(sender,exec) -> DEFAULT(paymaster.charge) -> VERIFY(paymaster,pay) -> SENDER(target=null)",
    use: "deploy a contract without the deployer funding gas, e.g. DaoFactory in one tx",
  },
  {
    pattern: "self_funded_call",
    title: "Self-funded account",
    shape: "VERIFY(sender, exec+pay) -> SENDER(op)",
    use: "a smart account that pays itself; no paymaster frame",
  },
  {
    pattern: "atomic_batch",
    title: "Atomic batch",
    shape: "SENDER(a) [ATOMIC] -> SENDER(b) [ATOMIC] -> SENDER(c)",
    use: "all-or-nothing sequences: approve+swap, addMembers+root update",
  },
  {
    pattern: "value_transfer",
    title: "Native value transfer",
    shape: "VERIFY(sender,exec) -> ... -> SENDER(to, value)",
    use: "payouts; value is legal only on SENDER frames",
  },
  {
    pattern: "session_key",
    title: "Session key",
    shape: "VERIFY(account checks session key + expiry + scope) -> SENDER(op)",
    use: "rotating keys, subscriptions, agent mandates",
  },
  {
    pattern: "multisig",
    title: "M-of-N via multiple signature entries",
    shape: "VERIFY reads SIGPARAM(i) for each entry, counts approvals -> SENDER(op)",
    use: "threshold approval without a separate multisig contract call",
  },
  {
    pattern: "channel_expiry",
    title: "Expiring intent",
    shape: "VERIFY(expiry verifier 0x8141...) -> VERIFY(sender,exec) -> SENDER(op)",
    use: "time-boxed agent intents; at most one expiry frame",
  },
  {
    pattern: "erc20_fee",
    title: "ERC-20 fee payment",
    shape: "DEFAULT(paymaster charges token) -> VERIFY(paymaster,pay) -> SENDER(op)",
    use: "gas abstraction paid in a stablecoin instead of ETH",
  },
  {
    pattern: "policy_agent",
    title: "Policy-bound agent account",
    shape: "VERIFY(AgentAccount: signer + allowed target/selector) -> DEFAULT(charge) -> VERIFY(pay,pay) -> SENDER(calls)",
    use: "the DAO operator: authority enforced by the account, not the model",
  },
];

const MODE_NAME = ["DEFAULT", "VERIFY", "SENDER"];

function frame(mode, flags, to, executionGas, stateGas, purpose, value = 0n) {
  return {
    mode,
    modeName: MODE_NAME[mode],
    flags,
    to,
    executionGas: executionGas.toString(),
    stateGas: stateGas.toString(),
    value: value.toString(),
    purpose,
  };
}

/** Build the frame skeleton for a pattern. No calldata is invented here. */
export function buildFramePlan(pattern, opts = {}) {
  const sender = opts.sender ?? "0x0000000000000000000000000000000000000001";
  const paymaster = opts.paymaster ?? sender;
  const calls = Math.max(1, Math.min(opts.calls ?? 1, 32));
  const constraints = [];
  const notes = [];
  let frames = [];

  const verifyExec = () => frame(1, EIP8141.approve.execution, sender, 15000n, 0n, "approve execution for the sender");
  const charge = () => frame(0, 0, paymaster, 100000n, 300000n, "pre_verify: charge/policy");
  const pay = () => frame(1, EIP8141.approve.payment, paymaster, 12000n, 0n, "approve payment, set payer");
  const senderCalls = (n, value = 0n) =>
    Array.from({ length: n }, (_, i) =>
      frame(2, 0, null, 150000n, 300000n, `SENDER call ${i + 1}`, i === n - 1 ? value : 0n),
    );

  switch (pattern) {
    case "sponsored_call":
      frames = [verifyExec(), charge(), pay(), ...senderCalls(calls)];
      constraints.push("charge must set payer before any SENDER frame");
      break;
    case "sponsored_deploy":
      frames = [verifyExec(), charge(), pay(), frame(2, 0, null, 500000n, 500000n, "SENDER create (target null)")];
      notes.push("deployment gas is paid by the sponsor, not the deployer");
      break;
    case "self_funded_call":
      frames = [frame(1, EIP8141.approve.both, sender, 50000n, 0n, "approve execution + payment"), ...senderCalls(calls)];
      constraints.push("target must equal tx.sender for execution+payment approval");
      break;
    case "atomic_batch":
      // A batch cannot contain approval frames, so the approval prefix must
      // precede it. This is the sponsored shape the DAO actually uses.
      frames = [verifyExec(), charge(), pay(), ...Array.from({ length: calls }, (_, i) =>
        frame(
          2,
          i < calls - 1 ? EIP8141.atomicBatchFlag : 0,
          null,
          150000n,
          300000n,
          `batched SENDER call ${i + 1}`,
        ),
      )];
      constraints.push("atomic batch: all succeed or the whole group reverts; skipped frames report status 2");
      constraints.push("no approval flags inside the batch");
      break;
    case "value_transfer":
      frames = [verifyExec(), charge(), pay(), frame(2, 0, null, 60000n, 300000n, "SENDER transfer", opts.value ?? 0n)];
      constraints.push("value is only legal on SENDER frames; each costs 6000 gas");
      break;
    case "session_key":
      frames = [
        frame(1, EIP8141.approve.execution, sender, 40000n, 0n, "verify session key, expiry, scope"),
        charge(),
        pay(),
        ...senderCalls(calls),
      ];
      notes.push("the session key is the signature signer, not necessarily tx.sender");
      break;
    case "multisig":
      frames = [
        frame(1, EIP8141.approve.execution, sender, 60000n, 0n, "count approvals via SIGPARAM"),
        charge(),
        pay(),
        ...senderCalls(calls),
      ];
      notes.push("one signature entry per approver; all entries are validated before any frame runs");
      break;
    case "channel_expiry":
      frames = [
        frame(1, 0, EIP8141.expiryVerifier, 10000n, 0n, "expiry verifier (8-byte timestamp)"),
        verifyExec(),
        charge(),
        pay(),
        ...senderCalls(calls),
      ];
      constraints.push("expiry frame: flags 0, value 0, state gas 0, exactly 8 data bytes, at most one per tx");
      break;
    case "erc20_fee":
      frames = [verifyExec(), frame(0, 0, paymaster, 120000n, 400000n, "charge in ERC-20"), pay(), ...senderCalls(calls)];
      notes.push("paymaster transfers the token itself and still approves payment in ETH terms");
      break;
    case "policy_agent":
      frames = [
        frame(1, EIP8141.approve.execution, sender, 50000n, 0n, "AgentAccount: signer + target/selector policy"),
        charge(),
        pay(),
        ...senderCalls(calls),
      ];
      notes.push("VERIFY reads SENDER frames with FRAMEPARAM/FRAMEDATACOPY; out-of-policy calls never enter a block");
      break;
    default:
      return { pattern, frames: [], constraints: ["unknown pattern"], notes: [] };
  }

  if (opts.expiry && pattern !== "channel_expiry") {
    notes.push(`intent expiry ${opts.expiry} should be enforced by the account or an expiry frame`);
  }

  return {
    pattern,
    frames,
    constraints: ["1..64 frames", "payer must be set or the transaction is invalid", ...constraints],
    notes,
  };
}

/** Static sanity check mirroring the EIP's validity constraints. */
export function validateFramePlan(plan) {
  const errors = [];
  const frames = plan.frames ?? [];
  const n = frames.length;
  if (n < 1 || n > EIP8141.maxFrames) errors.push(`frame count ${n} outside 1..64`);

  frames.forEach((f, i) => {
    if (![0, 1, 2].includes(f.mode)) errors.push(`frame ${i}: invalid mode ${f.mode}`);
    if (f.mode !== 2 && BigInt(f.value ?? 0) !== 0n) errors.push(`frame ${i}: value only allowed on SENDER`);
    if (f.flags & EIP8141.atomicBatchFlag) {
      if (f.mode === 1) errors.push(`frame ${i}: atomic batch flag illegal on VERIFY`);
      if (i + 1 >= n) errors.push(`frame ${i}: atomic batch flag on last frame`);
      if (frames[i + 1]?.mode === 1) errors.push(`frame ${i}: batch must not include a VERIFY frame`);
    }
    const inBatch =
      Boolean(f.flags & EIP8141.atomicBatchFlag) ||
      (i > 0 && Boolean(frames[i - 1].flags & EIP8141.atomicBatchFlag));
    if (inBatch && (f.flags & EIP8141.approve.both)) {
      errors.push(`frame ${i}: approval scope flags are illegal inside a batch`);
    }
  });

  const payer = frames.some((f) => (f.flags & EIP8141.approve.payment) !== 0);
  if (!payer) errors.push("no frame approves payment: transaction would be invalid");

  return { ok: errors.length === 0, errors };
}

/** Prompt block injected into the LLM system message. */
export function buildFrameCatalogPrompt() {
  const modes = FRAME_MODES.map((m) => `- mode ${m.mode} ${m.name}: caller=${m.caller}; ${m.use}`).join("\n");
  const patterns = FRAME_PATTERNS.map((p) => `- ${p.pattern}: ${p.title} | ${p.shape} | ${p.use}`).join("\n");
  const sigs = SIGNATURE_SCHEMES.map((s) => `- ${s.scheme} ${s.name} (${s.gas} gas): ${s.encoding}`).join("\n");
  const rules = STATIC_RULES.map((r) => `- ${r}`).join("\n");
  return [
    "FRAME TRANSACTIONS (EIP-8141, tx type 0x06) you may build:",
    modes,
    "Approval scopes: 1=payment, 2=execution (target must be tx.sender), 3=both. Bit 2 = atomic batch (DEFAULT/SENDER only).",
    "Signature schemes:",
    sigs,
    "Static rules you must never violate:",
    rules,
    "Patterns you can select (pick one, never invent calldata):",
    patterns,
    'To build one, return {"action":"frame","args":{"pattern":"<pattern>","calls":<n>,"value":"<wei>"}}.',
  ].join("\n");
}
