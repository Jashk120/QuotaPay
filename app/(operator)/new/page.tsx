"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Loader2,
  PenLine,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  parseEther,
  parseEventLogs,
  parseUnits,
} from "viem";
import { useWriteContract } from "wagmi";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { config } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import {
  daoFactoryAbi,
  mockUsdcAbi,
  sharedDaoGasPaymasterAbi,
} from "@/lib/daoAbis.mjs";
import { daoIdFromName } from "@/lib/dao/factory";
import { useConnectedWallet } from "@/lib/wallet";

const DEFAULT_PROMPT =
  "Invite-only DAO, 5k USDC treasury, auto-approve spends up to $200.";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Check both the new per-admin namespace and the legacy global mapping. */
async function daoNameTaken(daoId: `0x${string}`, admin: `0x${string}`) {
  const factory = config.daoFactoryAddress;
  if (!factory) return false;
  try {
    const record = await publicClient.readContract({
      address: factory,
      abi: daoFactoryAbi,
      functionName: "daoOf",
      args: [admin, daoId],
    });
    return record[0] !== ZERO_ADDRESS;
  } catch {
    // Older factory without daoOf(admin, daoId).
    try {
      const record = await publicClient.readContract({
        address: factory,
        abi: daoFactoryAbi,
        functionName: "daos",
        args: [daoId],
      });
      return record[0] !== ZERO_ADDRESS;
    } catch {
      return false;
    }
  }
}

/**
 * A factory rejects duplicate ids. Until the per-admin factory is deployed the
 * id is globally unique, so pick "Name 2", "Name 3", … instead of surfacing a
 * decoded `dao exists` revert.
 */
async function pickAvailableName(base: string, admin: `0x${string}`) {
  const clean = base.trim() || "New Collective";
  if (!(await daoNameTaken(daoIdFromName(clean), admin))) {
    return { name: clean, original: clean, changed: false };
  }
  for (let i = 2; i <= 50; i += 1) {
    const suffix = ` ${i}`;
    const stem = clean.slice(0, Math.max(1, 31 - suffix.length));
    const candidate = `${stem}${suffix}`;
    if (!(await daoNameTaken(daoIdFromName(candidate), admin))) {
      return { name: candidate, original: clean, changed: true };
    }
  }
  throw new Error("Could not find an available DAO name. Try a different name.");
}

export default function NewDaoPage() {
  const router = useRouter();
  const { address, isConnected, connect } = useConnectedWallet();
  const { writeContractAsync } = useWriteContract();

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [name, setName] = useState("New Collective");
  const [treasury, setTreasury] = useState("5000");
  const [funding, setFunding] = useState("0.05");
  const [perTx, setPerTx] = useState("200");
  const [perPeriod, setPerPeriod] = useState("1000");
  const [rateLimit, setRateLimit] = useState("10");
  const [windowHours, setWindowHours] = useState("48");
  const [interpreting, setInterpreting] = useState(false);
  const [interpreted, setInterpreted] = useState(false);
  const [configSource, setConfigSource] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [fundedTreasury, setFundedTreasury] = useState<string | null>(null);
  const [fundingNote, setFundingNote] = useState<string | null>(null);
  // Both are deliberately off: creating the DAO must be a single wallet
  // confirmation. Extra setup is opt-in and can also be done from the console.
  const [fundAfterDeploy, setFundAfterDeploy] = useState(false);
  const [enableSponsorship, setEnableSponsorship] = useState(false);

  const factory = config.daoFactoryAddress;

  async function interpret() {
    setInterpreting(true);
    try {
      const res = await fetch("/api/dao/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`config API ${res.status}`);
      const json = (await res.json()) as {
        config: {
          name: string;
          treasuryUsdc: number;
          perTxCap: number;
          perPeriodCap: number;
          addMemberRateLimit: number;
          votingWindowHours: number;
        };
        source?: string;
        llmError?: string;
      };
      setConfigSource(json.source ?? "local");
      setName(json.config.name);
      setTreasury(String(json.config.treasuryUsdc));
      setPerTx(String(json.config.perTxCap));
      setPerPeriod(String(json.config.perPeriodCap));
      setRateLimit(String(json.config.addMemberRateLimit));
      setWindowHours(String(json.config.votingWindowHours));
    } catch {
      const { parseDaoConfig } = await import("@/lib/dao/config");
      const cfg = parseDaoConfig(prompt);
      setConfigSource("local");
      setName(cfg.name);
      setTreasury(String(cfg.treasuryUsdc));
      setPerTx(String(cfg.perTxCap));
      setPerPeriod(String(cfg.perPeriodCap));
      setRateLimit(String(cfg.addMemberRateLimit));
      setWindowHours(String(cfg.votingWindowHours));
    } finally {
      setInterpreting(false);
      setInterpreted(true);
    }
  }

  async function deploy() {
    setError(null);
    setNotice(null);
    setCreated(null);
    setFundedTreasury(null);
    setFundingNote(null);
    if (!factory) {
      setError("NEXT_PUBLIC_DAO_FACTORY is not configured.");
      return;
    }
    if (!address) {
      connect();
      return;
    }
    setDeploying(true);
    setStep("Creating the DAO…");
    try {
      const signerRes = await fetch("/api/dao/agent-signer");
      const signerJson = (await signerRes.json()) as {
        address?: string;
        error?: string;
      };
      if (!signerRes.ok || !signerJson.address) {
        throw new Error(signerJson.error ?? "agent signer unavailable");
      }

      // Never send a transaction we know will revert with "dao exists".
      const picked = await pickAvailableName(name, address as `0x${string}`);
      if (picked.changed) {
        setName(picked.name);
        setNotice(
          `A DAO named “${picked.original}” already exists. Deploying as “${picked.name}”.`,
        );
      }
      const daoId = daoIdFromName(picked.name);
      const fundingWei = parseEther(funding || "0");
      const tokenCaps =
        config.usdcAddress && isAddressLike(config.usdcAddress)
          ? [
              {
                token: config.usdcAddress,
                perTx: parseUnits(perTx || "0", config.usdcDecimals),
                perPeriod: parseUnits(perPeriod || "0", config.usdcDecimals),
                periodLength: 2_592_000n,
              },
            ]
          : [];
      const daoArgs = [
        {
          daoId,
          admin: address,
          agentSigner: signerJson.address as `0x${string}`,
          frameEnforced: false,
          memberPeriodLength: 2_592_000,
          addMemberLimit: Number(rateLimit) || 1,
          votePeriod: BigInt((Number(windowHours) || 1) * 3600),
          quorumBps: 5_000,
        },
        [],
        tokenCaps,
        [],
      ] as const;

      // createDao deploys three contracts (~56.7M measured 2026-11-07) against
      // a 60M block limit, so a hardcoded limit starves or breaks as state
      // drifts. Estimate at deploy time, add 10%, cap at the block limit.
      const [estimate, latestBlock] = await Promise.all([
        publicClient.estimateContractGas({
          account: address as `0x${string}`,
          address: factory,
          abi: daoFactoryAbi,
          functionName: "createDao",
          args: [...daoArgs],
          value: fundingWei,
        }),
        publicClient.getBlock({ blockTag: "latest" }),
      ]);
      const blockLimit = latestBlock.gasLimit;
      let gasLimit = (estimate * 110n) / 100n;
      let gasCapped = false;
      if (gasLimit >= blockLimit) {
        gasLimit = blockLimit - 500_000n;
        gasCapped = true;
      }

      const hash = await writeContractAsync({
        address: factory,
        abi: daoFactoryAbi,
        functionName: "createDao",
        args: [...daoArgs],
        value: fundingWei,
        gas: gasLimit,
        gasPrice: 2_000_000_000n,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        const gasUsed = receipt.gasUsed.toString();
        const starved =
          receipt.gasUsed >= gasLimit
            ? " It consumed the full gas limit, so it likely ran out of gas"
            : gasCapped
              ? ` The 10%-buffered estimate (${estimate.toString()}) did not fit the block limit (${blockLimit.toString()}), so the transaction was capped and may have been starved`
              : "";
        throw new Error(
          `Deployment reverted on-chain (${hash}). Gas used ${gasUsed} of ${gasLimit.toString()} limit (estimate was ${estimate.toString()}).${starved ? `${starved};` : ""} Otherwise the name may already be taken, or the factory rejected the config.`,
        );
      }
      const createdEvent = parseEventLogs({
        abi: daoFactoryAbi,
        eventName: "DaoCreated",
        logs: receipt.logs,
      })[0]?.args;
      if (!createdEvent) {
        throw new Error(
          `DaoCreated event not found in ${hash}. The transaction may have reverted without an event.`,
        );
      }
      setCreated(createdEvent.daoCore);

      // The DAO exists now. Everything below is best-effort setup; the user is
      // never sent back to the deploy form (which would create a second DAO).
      if (enableSponsorship && config.daoGasPaymaster) {
        setStep("Enabling gas sponsorship…");
        try {
          const allowHash = await writeContractAsync({
            address: config.daoGasPaymaster,
            abi: sharedDaoGasPaymasterAbi,
            functionName: "allowAgent",
            args: [createdEvent.daoCore],
          });
          await publicClient.waitForTransactionReceipt({ hash: allowHash });
        } catch (cause) {
          // The DAO exists; the chat page offers an "Enable gas sponsorship"
          // button if this second transaction did not land.
          console.warn("allowAgent failed", cause);
        }
      }

      // Fund the treasury. The devnet USDC is a MockERC20 with a permissionless
      // mint; on a real token we transfer from the admin wallet instead.
      const treasuryAmount =
        config.usdcAddress && isAddressLike(config.usdcAddress)
          ? parseUnits(treasury || "0", config.usdcDecimals)
          : 0n;
      if (
        fundAfterDeploy &&
        treasuryAmount > 0n &&
        config.usdcAddress &&
        isAddressLike(config.usdcAddress)
      ) {
        setStep("Funding the treasury…");
        const token = config.usdcAddress;
        try {
          const walletBalance = await publicClient.readContract({
            address: token,
            abi: mockUsdcAbi,
            functionName: "balanceOf",
            args: [address],
          });
          const fromWallet = walletBalance >= treasuryAmount;
          const fundHash = fromWallet
            ? await writeContractAsync({
                address: token,
                abi: mockUsdcAbi,
                functionName: "transfer",
                args: [createdEvent.daoCore, treasuryAmount],
              })
            : await writeContractAsync({
                address: token,
                abi: mockUsdcAbi,
                functionName: "mint",
                args: [createdEvent.daoCore, treasuryAmount],
              });
          await publicClient.waitForTransactionReceipt({ hash: fundHash });
          setFundedTreasury(
            fromWallet
              ? `${treasury} USDC from your wallet`
              : `${treasury} test USDC (devnet faucet)`,
          );
        } catch (cause) {
          setFundingNote(
            `Treasury was not funded: ${
              cause instanceof Error ? cause.message : String(cause)
            }. You can transfer USDC to ${createdEvent.daoCore} later.`,
          );
        }
      }

      // Always open the console once the DAO exists — even if the optional
      // sponsorship or funding step failed.
      setStep("Opening the console…");
      router.push(`/dao/${createdEvent.daoCore}/chat`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeploying(false);
      setStep(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Create a DAO</Badge>
          <Badge variant="warning">on-chain deploy</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Deploy a DAO from one prompt
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The config is a real <span className="font-mono">DaoFactory.createDao</span>{" "}
          transaction. The factory deploys DaoCore, AgentAccount and AssetModule;
          nothing is stored locally.
        </p>
      </div>

      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/daos">
          <ArrowLeft className="h-4 w-4" /> Back to DAOs
        </Link>
      </Button>

      {!factory ? (
        <Alert variant="warning" title="No factory configured">
          Set <span className="font-mono">NEXT_PUBLIC_DAO_FACTORY</span> to a
          deployed <span className="font-mono">DaoFactory</span>, or deploy one
          with <span className="font-mono">node scripts/deploy-dao.mjs</span>.
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> 1. Describe the DAO
          </CardTitle>
          <CardDescription>
            The agent extracts a config; you review it before signing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            aria-label="DAO prompt"
            className="w-full resize-none rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-[inset_0_1px_2px_hsl(40_30%_20%/0.04)] outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void interpret()}
              disabled={interpreting}
            >
              {interpreting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              Interpret config
            </Button>
            {interpreted ? (
              <Badge variant="success">config parsed</Badge>
            ) : null}
            {configSource ? (
              <Badge variant="outline">
                {configSource.startsWith("llm:")
                  ? configSource
                  : "parser: local"}
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Review the config</CardTitle>
          <CardDescription>
            These values become the on-chain caps and policy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="DAO name" htmlFor="dao-name" className="sm:col-span-2">
              <Input
                id="dao-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNotice(null);
                }}
              />
            </Field>
            <Field label="Treasury target (USDC)" htmlFor="dao-treasury">
              <Input
                id="dao-treasury"
                value={treasury}
                onChange={(event) => setTreasury(event.target.value)}
              />
            </Field>
            <Field label="Native funding (ETH)" htmlFor="dao-funding">
              <Input
                id="dao-funding"
                value={funding}
                onChange={(event) => setFunding(event.target.value)}
              />
            </Field>
            <Field label="Per-tx cap (USDC)" htmlFor="dao-pertx">
              <Input
                id="dao-pertx"
                value={perTx}
                onChange={(event) => setPerTx(event.target.value)}
              />
            </Field>
            <Field label="Per-period cap (USDC)" htmlFor="dao-period">
              <Input
                id="dao-period"
                value={perPeriod}
                onChange={(event) => setPerPeriod(event.target.value)}
              />
            </Field>
            <Field label="Add-member limit / period" htmlFor="dao-rate">
              <Input
                id="dao-rate"
                value={rateLimit}
                onChange={(event) => setRateLimit(event.target.value)}
              />
            </Field>
            <Field label="Voting window (hours)" htmlFor="dao-window">
              <Input
                id="dao-window"
                value={windowHours}
                onChange={(event) => setWindowHours(event.target.value)}
              />
            </Field>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Native funding is sent with{" "}
            <span className="font-mono">createDao</span>. A DAO starts with 0
            USDC; the target is funded after deploy. The devnet mock is minted
            as test USDC; a real token is transferred from your wallet if it
            holds enough.
          </p>

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={fundAfterDeploy}
              onChange={(event) => setFundAfterDeploy(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Optional: fund the treasury after deploy (devnet faucet mints test
              USDC; adds one extra wallet confirmation).
            </span>
          </label>

          {config.daoGasPaymaster ? (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={enableSponsorship}
                onChange={(event) =>
                  setEnableSponsorship(event.target.checked)
                }
                className="mt-0.5"
              />
              <span>
                Optional: enable gas sponsorship after deploy (adds one extra
                wallet confirmation; the console can also do this later).
              </span>
            </label>
          ) : null}

          <div className="grid gap-2 rounded-xl border border-border/70 bg-white/60 p-3 text-sm">
            <Row label="Factory" value={factory || "not configured"} mono />
            <Row label="Admin" value={address ?? "not connected"} mono />
          </div>

          {notice ? (
            <Alert variant="warning" title="Name adjusted">
              {notice}
            </Alert>
          ) : null}

          {deploying && step ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {step}
            </p>
          ) : null}

          {created && !deploying ? (
            <Button asChild className="w-full">
              <Link href={`/dao/${created}/chat`}>
                Open DAO <ArrowLeft className="h-4 w-4 rotate-180" />
              </Link>
            </Button>
          ) : (
            <Button
              className="w-full"
              onClick={() => void deploy()}
              disabled={
                deploying || Boolean(created) || !factory || !name.trim()
              }
            >
              {deploying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PenLine className="h-4 w-4" />
              )}
              {deploying
                ? "Finishing setup…"
                : isConnected
                  ? "Deploy on-chain"
                  : "Connect wallet & deploy"}
            </Button>
          )}

          {error ? (
            <Alert variant="error" title="Deploy failed">
              {error}
            </Alert>
          ) : null}

          {created ? (
            <Alert variant="success" title="DAO deployed">
              <div className="space-y-1">
                <div>
                  DaoCore: <span className="font-mono">{created}</span>
                </div>
                {fundedTreasury ? (
                  <div className="text-xs">
                    Treasury funded with {fundedTreasury}.
                  </div>
                ) : null}
                {fundingNote ? (
                  <div className="text-xs text-destructive">{fundingNote}</div>
                ) : null}
                {!fundAfterDeploy ? (
                  <div className="text-xs">
                    Treasury is unfunded. Use the Treasury panel to mint test
                    USDC, deposit USDC, or swap ETH.
                  </div>
                ) : null}
                <div className="text-xs">
                  Opening your console…{" "}
                  <Link
                    href={`/dao/${created}/chat`}
                    className="font-medium underline underline-offset-2"
                  >
                    open it now
                  </Link>{" "}
                  if nothing happens.
                </div>
              </div>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`max-w-[65%] truncate text-right ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function isAddressLike(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
