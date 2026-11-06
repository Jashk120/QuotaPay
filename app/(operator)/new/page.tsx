"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { keccak256, toHex } from "viem";
import {
  ArrowLeft,
  Check,
  Loader2,
  PenLine,
  Sparkles,
  Wand2,
} from "lucide-react";
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
import {
  AdminSignatureDialog,
  type SignatureRequest,
} from "@/components/dao/admin-signature-dialog";
import { money } from "@/lib/dao/format";
import { DAO_CONSTANTS, createDaoState } from "@/lib/dao/seed";
import { useDaoState } from "@/lib/dao/use-dao";
import { config, isDaoChainConfigured } from "@/lib/config";
import { useConnectedWallet } from "@/lib/wallet";

const DEFAULT_PROMPT =
  "Invite-only DAO, 5k USDC treasury, auto-approve spends up to $200.";

const DEPLOY_STEPS = [
  "Verify the owner signature over the config hash",
  "Deploy DaoCore and initialise the member tree",
  "Deploy AgentAccount with the tiered policy table",
  "Fund the treasury and emit the creation event",
];

export default function NewDaoPage() {
  const router = useRouter();
  const { replace } = useDaoState();
  const { address, isConnected } = useConnectedWallet();

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [name, setName] = useState("New Collective");
  const [treasury, setTreasury] = useState("5000");
  const [perTx, setPerTx] = useState("200");
  const [perPeriod, setPerPeriod] = useState("1000");
  const [rateLimit, setRateLimit] = useState("10");
  const [windowHours, setWindowHours] = useState("48");
  const [interpreted, setInterpreted] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [signingRequest, setSigningRequest] = useState<SignatureRequest | null>(
    null,
  );
  const [deployStep, setDeployStep] = useState(-1);
  const [deploying, setDeploying] = useState(false);

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
      };
      setName(json.config.name);
      setTreasury(String(json.config.treasuryUsdc));
      setPerTx(String(json.config.perTxCap));
      setPerPeriod(String(json.config.perPeriodCap));
      setRateLimit(String(json.config.addMemberRateLimit));
      setWindowHours(String(json.config.votingWindowHours));
      setSource(json.source ?? null);
    } catch {
      // Offline: the deterministic parser is in the same module the route uses.
      const { parseDaoConfig } = await import("@/lib/dao/config");
      const cfg = parseDaoConfig(prompt);
      setName(cfg.name);
      setTreasury(String(cfg.treasuryUsdc));
      setPerTx(String(cfg.perTxCap));
      setPerPeriod(String(cfg.perPeriodCap));
      setRateLimit(String(cfg.addMemberRateLimit));
      setWindowHours(String(cfg.votingWindowHours));
      setSource("local");
    } finally {
      setInterpreted(true);
      setInterpreting(false);
    }
  }

  function configSnapshot() {
    return {
      name,
      treasuryUsdc: Number(treasury) || 0,
      perTxCap: Number(perTx) || 1,
      perPeriodCap: Number(perPeriod) || 1,
      addMemberRateLimit: Number(rateLimit) || 1,
      votingWindowHours: Number(windowHours) || 1,
    };
  }

  function openSignature() {
    // No wallet? Skip the signature step entirely. The signature is only the
    // owner's consent for a real deploy; local demo state needs no key.
    if (!isConnected) {
      void deploy();
      return;
    }
    const snapshot = configSnapshot();
    setSigningRequest({
      title: `Create ${snapshot.name}`,
      actionType: 0,
      paramsHash: keccak256(toHex(JSON.stringify(snapshot))),
      nonce: 1,
      expiry: Date.now() + 60 * 60 * 1000,
      daoCore: DAO_CONSTANTS.CORE,
    });
  }

  async function deploy() {
    setSigningRequest(null);
    setDeploying(true);
    for (let index = 0; index < DEPLOY_STEPS.length; index += 1) {
      setDeployStep(index);
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
    setDeployStep(DEPLOY_STEPS.length);
    const snapshot = configSnapshot();
    replace(
      createDaoState({
        ...snapshot,
        adminAddress: address ?? DAO_CONSTANTS.ADMIN,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    router.push("/");
  }

  const snapshot = configSnapshot();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Create a DAO</Badge>
          <Badge variant="warning">simulated deploy</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          One prompt, one signed config
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Describe the DAO you want. The agent produces a structured config; the
          owner signs its hash; one frame transaction would deploy the factory,
          core, agent account and treasury funding.
        </p>
      </div>

      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> Back to the console
        </Link>
      </Button>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> 1. Describe the DAO
          </CardTitle>
          <CardDescription>
            The agent reads your description and fills the config. No wallet is
            required to plan or create a local DAO.
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void interpret()} disabled={interpreting}>
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
            {source ? (
              <Badge variant="outline" title="Config extractor">
                {source.startsWith("llm:") ? source : "parser: local"}
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className={interpreted ? "border-primary/30" : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Review the config</CardTitle>
          <CardDescription>
            These values become the signed config hash and the initial
            AgentAccount policy.
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
                inputMode="decimal"
              />
            </Field>
            <Field label="Per-transaction cap" htmlFor="dao-per-tx">
              <Input
                id="dao-per-tx"
                value={perTx}
                onChange={(event) => setPerTx(event.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Per-period cap" htmlFor="dao-per-period">
              <Input
                id="dao-per-period"
                value={perPeriod}
                onChange={(event) => setPerPeriod(event.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Add-member rate limit" htmlFor="dao-rate">
              <Input
                id="dao-rate"
                value={rateLimit}
                onChange={(event) => setRateLimit(event.target.value)}
                inputMode="numeric"
              />
            </Field>
            <Field label="Voting window (hours)" htmlFor="dao-window">
              <Input
                id="dao-window"
                value={windowHours}
                onChange={(event) => setWindowHours(event.target.value)}
                inputMode="numeric"
              />
            </Field>
          </div>

          <div className="rounded-xl border border-border/70 bg-secondary/40 p-3 text-xs text-muted-foreground">
            Membership is invite-only. Removing a member needs an admin signature;
            changing caps or the agent key needs a member vote.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="h-4 w-4 text-primary" /> 3. Sign and deploy
          </CardTitle>
          <CardDescription>
            The owner signs the EIP-712 config hash. No free-form calldata.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-xl border border-border/70 bg-secondary/30 p-3 text-sm">
            <Row label="DAO" value={snapshot.name} />
            <Row label="Treasury" value={`${money(snapshot.treasuryUsdc)} USDC`} />
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Deployment details
              </summary>
              <div className="mt-2 grid gap-2">
                <Row
                  label="Per-tx / period"
                  value={`${money(snapshot.perTxCap)} / ${money(snapshot.perPeriodCap)}`}
                />
                <Row label="Admin" value={address ?? DAO_CONSTANTS.ADMIN} mono />
                <Row label="DaoCore" value={DAO_CONSTANTS.CORE} mono />
              </div>
            </details>
          </div>

          <Button
            className="w-full"
            onClick={openSignature}
            disabled={deploying || !name.trim() || isDaoChainConfigured}
            data-testid="dao-deploy"
          >
            {deploying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PenLine className="h-4 w-4" />
            )}
            Sign config &amp; deploy
          </Button>
          <p className="text-xs text-muted-foreground">
            {isDaoChainConfigured
              ? "This console is bound to a deployed DaoCore, so a local create would be discarded on the next chain read."
              : isConnected
                ? "Your wallet signs the config hash before the deploy."
                : "No wallet connected — the DAO is created locally without a signature. Connect a wallet only when you deploy on-chain."}
          </p>

          {deployStep >= 0 ? (
            <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/30 p-3">
              {DEPLOY_STEPS.map((step, index) => {
                const done = deployStep > index;
                const active = deployStep === index;
                return (
                  <div
                    key={step}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-border" />
                    )}
                    {step}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isDaoChainConfigured ? (
        <Alert variant="info" title="On-chain DAO configured">
          This page creates a local demo DAO only. The console reads{" "}
          <span className="font-mono">{config.daoCoreAddress}</span>. To create a
          real DAO, deploy one with{" "}
          <span className="font-mono">node scripts/deploy-dao.mjs</span> and point{" "}
          <span className="font-mono">NEXT_PUBLIC_DAO_CORE</span> at it.
        </Alert>
      ) : (
        <Alert variant="warning" title="Replaces the local demo">
          This writes a fresh DAO to this browser&apos;s localStorage. The previous
          demo state is not recoverable except with “Reset demo”.
        </Alert>
      )}

      <AdminSignatureDialog
        request={signingRequest}
        onClose={() => setSigningRequest(null)}
        onSigned={() => void deploy()}
      />
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
