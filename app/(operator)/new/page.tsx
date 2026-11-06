"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  PenLine,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  keccak256,
  parseEther,
  parseEventLogs,
  parseUnits,
  stringToHex,
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
import { daoFactoryAbi } from "@/lib/daoAbis.mjs";
import { daoSlug } from "@/lib/dao/slug";
import { useConnectedWallet } from "@/lib/wallet";

const DEFAULT_PROMPT =
  "Invite-only DAO, 5k USDC treasury, auto-approve spends up to $200.";

export default function NewDaoPage() {
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
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

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
    setCreated(null);
    if (!factory) {
      setError("NEXT_PUBLIC_DAO_FACTORY is not configured.");
      return;
    }
    if (!address) {
      connect();
      return;
    }
    setDeploying(true);
    try {
      const signerRes = await fetch("/api/dao/agent-signer");
      const signerJson = (await signerRes.json()) as {
        address?: string;
        error?: string;
      };
      if (!signerRes.ok || !signerJson.address) {
        throw new Error(signerJson.error ?? "agent signer unavailable");
      }

      const slug = daoSlug(name);
      const daoId = keccak256(stringToHex(slug));
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

      const hash = await writeContractAsync({
        address: factory,
        abi: daoFactoryAbi,
        functionName: "createDao",
        args: [
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
        ],
        value: fundingWei,
        // createDao deploys three contracts; the devnet estimate is ~54.7M.
        // Set the limit explicitly so MetaMask does not fail its fee estimate.
        gas: 56_000_000n,
        gasPrice: 2_000_000_000n,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const createdEvent = parseEventLogs({
        abi: daoFactoryAbi,
        eventName: "DaoCreated",
        logs: receipt.logs,
      })[0]?.args;
      if (!createdEvent) throw new Error("DaoCreated event not found");
      setCreated(createdEvent.daoCore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeploying(false);
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
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Treasury (USDC)" htmlFor="dao-treasury">
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
            <span className="font-mono">createDao</span>. The USDC treasury is
            funded afterwards by transferring USDC to the new DaoCore address.
          </p>

          <div className="grid gap-2 rounded-xl border border-border/70 bg-white/60 p-3 text-sm">
            <Row label="Factory" value={factory || "not configured"} mono />
            <Row label="Admin" value={address ?? "not connected"} mono />
            <Row label="Frame enforcement" value="false (devnet)" />
          </div>

          <Button
            className="w-full"
            onClick={() => void deploy()}
            disabled={deploying || !factory || !name.trim()}
          >
            {deploying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PenLine className="h-4 w-4" />
            )}
            {isConnected ? "Deploy on-chain" : "Connect wallet & deploy"}
          </Button>

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
                <div className="text-xs">
                  Set <span className="font-mono">NEXT_PUBLIC_DAO_CORE</span> to
                  this address to open it in the console.
                </div>
                <div className="text-xs">
                  Transfer {treasury} USDC to this address to fund the treasury.
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
