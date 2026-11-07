/**
 * Deterministic stand-in for the cloud intent parser.
 *
 * UI-only build: this never calls an LLM and never builds calldata. It maps a
 * small demo vocabulary to one typed action, then runs the same off-chain
 * pre-checks the real policy engine would run. The on-chain layers are shown in
 * the plan card but are simulated in this build.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+instructions?/i,
  /disregard\s+.*(rules|policy|instructions)/i,
  /send\s+(all|the\s+entire|everything).*(funds|treasury|balance)/i,
  /transfer\s+everything/i,
  /drain\s+(the\s+)?(treasury|dao)/i,
  /(reveal|print|show|leak).*(seed phrase|private key)/i,
];

const STOP_WORDS = new Set([
  "buy",
  "acquire",
  "purchase",
  "asset",
  "the",
  "for",
  "and",
  "with",
  "usdc",
  "usd",
  "dollars",
  "please",
  "dao",
  "treasury",
  "from",
  "into",
  "this",
  "that",
]);

const LAYERS = [
  "Typed output only: the agent can emit one schema-validated tool call.",
  "Untrusted text is data: the pasted text is never treated as an instruction.",
  "Off-chain policy engine: the plan is rejected before a transaction is built.",
  "AgentAccount policy would reject an unknown target at validation.",
  "DaoCore tiers, caps and signatures would reject the action at execution.",
];

function rid() {
  return `plan-${Math.random().toString(36).slice(2, 10)}`;
}

function refusal(title, reason, prompt) {
  return { kind: "refusal", title, reason, layers: LAYERS, prompt };
}

/**
 * Whole-message chitchat only: greetings, thanks, goodbyes, "who are you",
 * "what can you do", "help". Anything containing a DAO action verb or an
 * address/amount is NOT chitchat and falls through to the policy engine.
 */
function greetingReply(prompt, state) {
  const normalized = String(prompt || "")
    .toLowerCase()
    .replace(/[?!.,;:'"()\[\]…\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 80) return null;
  if (/\b(pay|send|spend|transfer|withdraw|invite|add|onboard|remove|kick|offboard|buy|acquire|purchase|sell|dispose|redeem|vote|propose|draft|pause|resume|freeze|policy|cap|allowlist|treasury|member|contributor|asset|usdc|usd|\$|0x[0-9a-f]{4})/i.test(normalized)) {
    return null;
  }
  const patterns = [
    /^(hi+|hey+|hello+|helo+|heyy*|yo|sup|howdy|hiya|greetings|greetz|bonjour|hola)\b/,
    /^(good\s+(morning|afternoon|evening|day|night))\b/,
    /^(how\s+are\s+you|how\s+is\s+it\s+going|howre\s+you|hows\s+it\s+going|what'?s\s+up|whats\s+up|wassup)\b/,
    /^(thanks?|thank\s+you|thx|much\s+appreciated|appreciated)\b/,
    /^(bye+|goodbye|good\s*bye|see\s+you|later|good\s*night)\b/,
    /^(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|help|what\s+do\s+you\s+do)\b/,
    /^(ok|okay|cool|nice|great|awesome|sweet|lol|haha+|lmao|nice\s+one)\b/,
  ];
  if (!patterns.some((pattern) => pattern.test(normalized))) return null;

  const daoName = state?.config?.name || "this DAO";
  let text;
  if (/^(thanks?|thank\s+you|thx|much\s+appreciated|appreciated)\b/.test(normalized)) {
    text = `Anytime! Ping me when you need a payout, an invite, or a vote in ${daoName}.`;
  } else if (/^(bye+|goodbye|good\s*bye|see\s+you|later|good\s*night)\b/.test(normalized)) {
    text = `Later! I will be here when ${daoName} needs something.`;
  } else if (/^(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|help|what\s+do\s+you\s+do)\b/.test(normalized)) {
    text = `I am the operator agent for ${daoName}. Tell me to pay someone, invite or remove a member, buy an asset, or open a vote — I will build the typed plan and wait for the right authorization before anything executes.`;
  } else if (/^(how\s+are\s+you|how\s+is\s+it\s+going|howre\s+you|hows\s+it\s+going|what'?s\s+up|whats\s+up|wassup)\b/.test(normalized)) {
    text = `Doing well — caps checked, policy loaded. What should I do for ${daoName}? I can pay, invite, remove, buy, or open a vote.`;
  } else {
    text = `Hey! I run ${daoName} with you. Tell me to pay someone, invite or remove a member, buy an asset, or open a vote — plain words, I handle the plan.`;
  }
  return { kind: "message", text, prompt };
}

function check(label, ok, detail) {
  return { label, ok, detail };
}

function toNumber(raw, suffix) {
  const n = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return /^k$/i.test(suffix || "") ? n * 1000 : n;
}

function money(text) {
  const dollar = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (dollar) return toNumber(dollar[1], dollar[2]);
  const usdc = text.match(
    /([\d,]+(?:\.\d+)?)\s*(k)?\s*(usdc|usd|dollars?)\b/i,
  );
  if (usdc) return toNumber(usdc[1], usdc[2]);
  return null;
}

function parseMemberInputs(text) {
  const match = text.match(/(?:add|invite|onboard)\s+(.+)/i);
  if (!match) return [];
  return match[1]
    .replace(/\b(to|into)\s+(the\s+)?(dao|treasury)\b.*$/i, "")
    .replace(/\bas\s+members?\b.*$/i, "")
    .split(/,|\band\b/gi)
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(
      (part) =>
        part && !/^(new\s+)?members?$/i.test(part) && part.length < 120,
    )
    .slice(0, 25)
    .map((token) => {
      if (/^0x[0-9a-fA-F]{40}$/.test(token)) {
        return { label: token, address: token, ens: null };
      }
      if (/\.eth$/i.test(token)) {
        return { label: token, address: null, ens: token };
      }
      // A plain name still works: the invite carries no address, and the
      // member's wallet becomes the identity when they claim it.
      return { label: token, address: null, ens: null };
    });
}

function findMember(state, name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    state.members.find(
      (member) =>
        member.active &&
        (member.name.toLowerCase() === needle ||
          member.name.toLowerCase().includes(needle) ||
          member.name.toLowerCase().split(/\s+/)[0] === needle),
    ) || null
  );
}

function findAsset(state, text) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9#\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  let best = null;
  let bestScore = 0;
  for (const asset of state.assets) {
    const haystack = `${asset.name} ${asset.kind}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (haystack.includes(word)) score += 1;
    }
    if (score > bestScore) {
      best = asset;
      bestScore = score;
    }
  }
  return best;
}

function contributors(state) {
  const rows = state.members.filter(
    (member) => member.active && member.role === "contributor",
  );
  return rows.length > 0
    ? rows
    : state.members.filter((member) => member.active && member.role === "member");
}

function baseChecks(state) {
  return [
    check(
      "Sender is the agent account",
      true,
      `${state.config.agentAddress.slice(0, 10)}… (policy table v1)`,
    ),
    check("Target allowlisted", true, "checked at VERIFY, before execution"),
  ];
}

function adminCheck(tier) {
  return check(
    "Admin signature",
    tier < 2,
    tier >= 2
      ? "required · EIP-712, bound to paramsHash, nonce and expiry"
      : "not required at this tier",
  );
}

function voteCheck(tier) {
  return check(
    "Member vote",
    tier < 3,
    tier >= 3 ? "required · proposal must pass before execution" : "not required",
  );
}

export function detectInjection(text) {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

/**
 * @param {string} text
 * @param {import("./types").DaoState} state
 * @returns {import("./types").AgentReply}
 */
export function parsePrompt(text, state) {
  const prompt = String(text || "").trim();
  if (!prompt) {
    return refusal(
      "Nothing to do",
      "Send a prompt such as “pay October contributors” or “remove Arjun”.",
      prompt,
    );
  }

  // Chitchat is conversational, never a plan — and never blocked by pause.
  const greeting = greetingReply(prompt, state);
  if (greeting) return greeting;

  if (state.config.agentPaused && !/pause|freeze|resume/i.test(prompt)) {
    return refusal(
      "The agent is paused",
      "An admin paused the agent. Only an admin can resume it, and that action does not go through the agent.",
      prompt,
    );
  }

  if (detectInjection(prompt)) {
    return refusal(
      "Refused: prompt injection",
      "This text tries to change the agent's instructions or move the treasury. I only produce typed actions, and this is not one of them.",
      prompt,
    );
  }

  const foreignAddress = prompt.match(/0x[a-fA-F0-9]{40}/g);
  if (
    foreignAddress &&
    /\b(send|pay|transfer|withdraw)\b/i.test(prompt) &&
    foreignAddress.some(
      (address) =>
        !state.members.some(
          (member) => member.wallet.toLowerCase() === address.toLowerCase(),
        ),
    )
  ) {
    return refusal(
      "Refused: unknown recipient",
      "That address is not on the member registry. A payout target outside the allowlist cannot be authorized by the agent.",
      prompt,
    );
  }

  // Resume is also admin-only and does not go through the agent.
  if (/\bresume\b/i.test(prompt)) {
    const tier = 2;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "pause",
        tier,
        title: "Resume the agent",
        summary:
          "Clear the emergency pause. The admin signs directly; the agent does not authorize its own restart.",
        resolved: [
          {
            kind: "config",
            label: state.config.name,
            meta: "agent execution resume",
          },
        ],
        params: { scope: "agent", mode: "resume" },
        checks: [
          check("Agent bypassed", true, "admin acts directly, not through the agent"),
          check("Admin signature", true, "required"),
          check("Member vote", true, "not required for the safety valve"),
          ...baseChecks(state),
        ],
        authorization: "admin-only",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: [
          "Resume only after the cause of the pause has been reviewed and cleared.",
        ],
        status: "draft",
      },
    };
  }

  // Emergency pause / revoke: admin-only, deliberately outside the agent.
  if (/\b(pause|freeze|revoke\s+(the\s+)?agent|emergency)\b/i.test(prompt)) {
    const tier = 2;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "pause",
        tier,
        title: "Emergency pause",
        summary:
          "Freeze agent execution and require an admin signature. This action bypasses the agent entirely.",
        resolved: [
          {
            kind: "config",
            label: state.config.name,
            meta: "agent + treasury halt",
          },
        ],
        params: { scope: "agent", mode: "pause" },
        checks: [
          check("Agent bypassed", true, "admin acts directly, not through the agent"),
          check("Admin signature", true, "required"),
          check("Member vote", true, "not required for the safety valve"),
          ...baseChecks(state),
        ],
        authorization: "admin-only",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: [
          "The pause is immediate. Resuming the agent requires a separate admin signature.",
        ],
        status: "draft",
      },
    };
  }

  // Membership: remove.
  if (/\b(remove|offboard|kick|revoke\s+member)\b/i.test(prompt)) {
    const candidate = prompt
      .replace(/^.*?\b(remove|offboard|kick|revoke)\b\s*/i, "")
      .replace(/\b(from|as)\s+(the\s+)?(dao|member).*$/i, "")
      .trim();
    const member = findMember(state, candidate);
    if (!member) {
      return refusal(
        "Name not resolved",
        `I could not resolve “${candidate || "that person"}” to an active member. I will not guess at a leaf.`,
        prompt,
      );
    }
    const tier = 2;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "remove_member",
        tier,
        title: `Remove ${member.name}`,
        summary: `Zero ${member.name}'s leaf, update the member root and emit an audit event in one transaction.`,
        resolved: [
          {
            kind: "member",
            label: member.name,
            meta: `joined ${formatUtcDate(member.joinedAt)} · leaf ${member.leaf.slice(0, 10)}…`,
            address: member.wallet,
          },
        ],
        params: {
          name: member.name,
          memberId: member.id,
          leaf: member.leaf,
        },
        checks: [
          check("Resolved person shown", true, `${member.name} · ${member.wallet.slice(0, 8)}…`),
          check("Duplicate commitments", true, "none"),
          check("Leaf exists in current root", true, member.leaf.slice(0, 10) + "…"),
          adminCheck(tier),
          voteCheck(tier),
          ...baseChecks(state),
        ],
        authorization: "admin",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: [
          "Root snapshot: a removed member can still vote on proposals created before removal.",
        ],
        status: "draft",
      },
    };
  }

  // Membership: add / invite. Allowlist wording is a governance action, not
  // an invitation.
  if (/\b(add|invite|onboard)\b/i.test(prompt) && !/allowlist/i.test(prompt)) {
    const members = parseMemberInputs(prompt);
    const names = members.map((member) => member.label);
    if (members.length === 0) {
      return refusal(
        "No members to add",
        "Tell me who to invite, for example “add 0xabc… or alice.eth”.",
        prompt,
      );
    }
    const total = state.capUsage.membersAdded + names.length;
    const withinLimit = total <= state.config.addMemberRateLimit;
    // Root updates are admin co-signed until the membership tree is verified
    // on-chain, so both rate-limit branches are tier 2.
    const tier = 2;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "add_members",
        tier,
        title: `Add ${names.length} member${names.length === 1 ? "" : "s"}`,
        summary: `Create ${names.length} single-use invite${names.length === 1 ? "" : "s"} and add every accepted commitment in one atomic batch.`,
        resolved: members.map((member) => ({
          kind: "member",
          label: member.label,
          address: member.address ?? undefined,
          meta: member.address
            ? `address ${member.address.slice(0, 8)}…`
            : member.ens
              ? `ENS ${member.ens}`
              : "address pending · member claims it",
        })),
        params: { names, members, inviteCount: members.length },
        checks: [
          check(
            "Rate limit",
            withinLimit,
            `${total} of ${state.config.addMemberRateLimit} additions this period`,
          ),
          check("Invite binding", true, "one commitment per code, first use wins"),
          check("Duplicate commitments", true, "rejected by addMembers"),
          adminCheck(tier),
          voteCheck(tier),
          ...baseChecks(state),
        ],
        authorization: "admin",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: [
          withinLimit
            ? "The membership root is admin co-signed in this build; the rate limit still bounds the batch."
            : "Above the tier-1 rate limit: use addMembersAuthorized and the admin signature.",
        ],
        status: "draft",
      },
    };
  }

  // Role changes.
  if (/\b(role|promote|demote|make\s+.*\badmin)\b/i.test(prompt)) {
    const member =
      state.members.find((row) => prompt.toLowerCase().includes(row.name.toLowerCase().split(/\s+/)[0])) ||
      null;
    const tier = 2;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "change_role",
        tier,
        title: member ? `Change ${member.name}'s role` : "Change a member role",
        summary: "Update a non-admin role. The change is rooted in the member tree.",
        resolved: member
          ? [
              {
                kind: "member",
                label: member.name,
                meta: `current role: ${member.role}`,
                address: member.wallet,
              },
            ]
          : [],
        params: {
          member: member ? member.name : "unspecified",
          newRole: /admin/i.test(prompt) ? "admin" : "contributor",
        },
        checks: [adminCheck(tier), voteCheck(tier), ...baseChecks(state)],
        authorization: "admin",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: ["Admin roles themselves are tier 3 and are not changed here."],
        status: "draft",
      },
    };
  }

  // Assets: dispose.
  if (/\b(dispose|redeem|sell)\b/i.test(prompt)) {
    const asset = findAsset(state, prompt) || state.assets.find((row) => row.held);
    if (!asset) {
      return refusal(
        "Asset not resolved",
        "I could not find that asset in the registry.",
        prompt,
      );
    }
    const tier = 2;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "dispose_asset",
        tier,
        title: `Dispose of ${asset.name}`,
        summary: `Redeem ${asset.name}, clear the holding record and emit an audit event.`,
        resolved: [
          {
            kind: "asset",
            label: asset.name,
            meta: `${asset.kind} · held ${asset.held ? "yes" : "no"}`,
          },
        ],
        params: { assetId: asset.id, asset: asset.name },
        checks: [
          check("Asset allowlisted", asset.allowlisted, asset.name),
          check("Holding exists", asset.held, asset.held ? "recorded in DaoCore" : "not held"),
          adminCheck(tier),
          voteCheck(tier),
          ...baseChecks(state),
        ],
        authorization: "admin",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: ["Disposal is tier 2: the agent must show the resolved asset first."],
        status: "draft",
      },
    };
  }

  // Assets: acquire / buy.
  if (/\b(buy|acquire|purchase)\b/i.test(prompt)) {
    const asset = findAsset(state, prompt);
    if (!asset) {
      return refusal(
        "Asset not resolved",
        "I could not find that asset in the registry. Add it to the allowlist first.",
        prompt,
      );
    }
    const price = money(prompt) ?? asset.priceUsdc;
    const withinCap = price <= asset.capUsdc;
    const allowed = asset.allowlisted;
    const tier = allowed && withinCap ? 1 : 3;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "acquire_asset",
        tier,
        title: `Acquire ${asset.name}`,
        summary: `Buy ${asset.name} for ${moneyLabel(price)} in one atomic batch. No residual allowance is left.`,
        resolved: [
          {
            kind: "asset",
            label: asset.name,
            meta: `${asset.kind} · ${moneyLabel(price)} · cap ${moneyLabel(asset.capUsdc)}`,
          },
        ],
        params: {
          assetId: asset.id,
          asset: asset.name,
          price,
          token: "USDC",
        },
        checks: [
          check("Asset allowlisted", allowed, allowed ? "yes" : "no · requires a tier-3 vote"),
          check(
            "Per-asset cap",
            withinCap,
            `${moneyLabel(price)} vs ${moneyLabel(asset.capUsdc)}`,
          ),
          check("Token allowlisted", true, "USDC"),
          check("Approval reset", true, "allowance returns to zero"),
          adminCheck(tier),
          voteCheck(tier),
          ...baseChecks(state),
        ],
        authorization: tier === 3 ? "vote" : "agent",
        prompt,
        promptHash: "",
        planHash: "",
        batchSteps: [
          `Approve exactly ${moneyLabel(price)} USDC`,
          `Purchase ${asset.name}`,
          "Record the holding in DaoCore",
          "Reset the approval to zero",
        ],
        warnings:
          tier === 3
            ? [
                "Above the asset cap or not allowlisted: this must become a member vote.",
              ]
            : [],
        status: "draft",
      },
    };
  }

  // Poisoned policy / caps / agent key: governance only.
  if (/\b(policy|caps?|limit|agent\s+key|allowlist)\b/i.test(prompt)) {
    const tier = 3;
    const asset = /allowlist/i.test(prompt) ? findAsset(state, prompt) : null;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "update_policy",
        tier,
        title: asset
          ? `Add ${asset.name} to the allowlist`
          : "Update the agent mandate",
        summary: asset
          ? `Add ${asset.name} to the asset allowlist. This is a governance action, not an agent decision.`
          : "Change a cap, the selector policy table or the agent key. This is the only path that edits AgentAccount policy.",
        resolved: [
          asset
            ? {
                kind: "asset",
                label: asset.name,
                meta: `${asset.kind} · ${moneyLabel(asset.priceUsdc)} · cap ${moneyLabel(asset.capUsdc)}`,
              }
            : {
                kind: "config",
                label: state.config.name,
                meta: "AgentAccount policy table",
              },
        ],
        params: asset
          ? { change: prompt, assetId: asset.id }
          : { change: prompt },
        checks: [
          check("Governance path", true, "DaoCore proposal → vote → execute"),
          adminCheck(tier),
          voteCheck(tier),
          ...baseChecks(state),
        ],
        authorization: "vote",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: ["No admin can change the mandate alone. A member vote is required."],
        status: "draft",
      },
    };
  }

  // Payments / spend.
  if (/\b(pay|payout|spend|send)\b/i.test(prompt)) {
    const amount = money(prompt) ?? 150;
    const recipients = contributors(state);
    if (recipients.length === 0) {
      return refusal(
        "No contributors to pay",
        "Invite contributors first. A payout batch with no recipients is not a useful plan.",
        prompt,
      );
    }
    const perRecipient = amount / recipients.length;
    const withinTx = amount <= state.config.perTxCap;
    const withinPeriod =
      state.capUsage.periodSpent + amount <= state.config.perPeriodCap;
    const tier = withinTx && withinPeriod ? 1 : 3;
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "pay",
        tier,
        title: `Pay ${recipients.length} contributor${recipients.length === 1 ? "" : "s"}`,
        summary: `Send ${moneyLabel(amount)} USDC to ${recipients.length} contributor${recipients.length === 1 ? "" : "s"} as one atomic payout batch.`,
        resolved: recipients.map((member) => ({
          kind: "member",
          label: member.name,
          meta: `${moneyLabel(perRecipient)} · ${member.role}`,
          address: member.wallet,
        })),
        params: {
          amount,
          token: "USDC",
          recipients: recipients.map((member) => member.name),
        },
        checks: [
          check(
            "Per-transaction cap",
            withinTx,
            `${moneyLabel(amount)} vs ${moneyLabel(state.config.perTxCap)}`,
          ),
          check(
            "Per-period cap",
            withinPeriod,
            `${moneyLabel(state.capUsage.periodSpent + amount)} of ${moneyLabel(state.config.perPeriodCap)} after this payout`,
          ),
          check("Token allowlisted", true, "USDC only"),
          check("Payout selector allowed", true, "DaoCore.spend"),
          adminCheck(tier),
          voteCheck(tier),
          ...baseChecks(state),
        ],
        authorization: tier === 3 ? "vote" : "agent",
        prompt,
        promptHash: "",
        planHash: "",
        warnings:
          tier === 3
            ? [
                "This payout exceeds a tier-1 cap. It becomes a tier-3 proposal; the agent cannot execute it alone.",
              ]
            : [],
        status: "draft",
      },
    };
  }

  // Proposal drafting is free.
  if (/\b(draft|propose|proposal)\b/i.test(prompt)) {
    return {
      kind: "plan",
      plan: {
        id: rid(),
        action: "propose",
        tier: 0,
        title: "Draft a proposal",
        summary:
          "Drafting is off-chain and free. Submit it only when the plan is explicit and the required tier is known.",
        resolved: [
          {
            kind: "config",
            label: state.config.name,
            meta: "off-chain draft",
          },
        ],
        params: { draft: prompt },
        checks: [],
        authorization: "none",
        prompt,
        promptHash: "",
        planHash: "",
        warnings: [],
        status: "draft",
      },
    };
  }

  // Read-only summary (also the default).
  return {
    kind: "plan",
    plan: {
      id: rid(),
      action: "summarize",
      tier: 0,
      title: "DAO status summary",
      summary: `${state.config.name}: ${state.members.filter((m) => m.active).length} active members, ${moneyLabel(state.config.treasuryUsdc)} USDC treasury, ${moneyLabel(state.capUsage.periodSpent)} of ${moneyLabel(state.config.perPeriodCap)} period spend used.`,
      resolved: [
        {
          kind: "config",
          label: state.config.name,
          meta: `${state.members.filter((m) => m.active).length} members · ${state.proposals.filter((p) => p.status === "open").length} open proposals`,
        },
      ],
      params: {},
      checks: [],
      authorization: "none",
      prompt,
      promptHash: "",
      planHash: "",
      warnings: [],
      status: "draft",
    },
  };
}

export function moneyLabel(value) {
  const n = Number(value || 0);
  return `$${n.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

export function formatUtcDate(value) {
  const date = new Date(Number(value));
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}
