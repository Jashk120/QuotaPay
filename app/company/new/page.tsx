"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  isAddress,
  parseEther,
  parseEventLogs,
  type Address,
} from "viem";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  Wallet,
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
import { companyFactoryAbi } from "@/lib/abis";
import { config, demoDefaults, isLiveConfigured } from "@/lib/config";
import {
  bytes32FromLabel,
  getWalletClient,
  publicClient,
} from "@/lib/contracts";
import { saveCompany, type DemoCompany } from "@/lib/demo-store";
import { useMetaMask } from "@/lib/wallet";

type Created = {
  company: DemoCompany;
  txHash?: `0x${string}`;
  onChain: boolean;
};

function bigintOr(value: string, fallback: bigint) {
  try {
    return value.trim() === "" ? fallback : BigInt(value);
  } catch {
    return fallback;
  }
}

export default function NewCompanyPage() {
  const { address: connected, connect, error: walletError } = useMetaMask();

  const [companyId, setCompanyId] = useState("acme");
  const [admin, setAdmin] = useState("");
  const [treasury, setTreasury] = useState("");
  const [depositEth, setDepositEth] = useState("1");
  const [globalCreditLimit, setGlobalCreditLimit] = useState(
    demoDefaults.globalCreditLimit.toString(),
  );
  const [creditPerTx, setCreditPerTx] = useState(
    demoDefaults.creditPerTx.toString(),
  );
  const [periodDays, setPeriodDays] = useState("30");
  const [maxSponsorEth, setMaxSponsorEth] = useState("0.002");
  const [withdrawalHours, setWithdrawalHours] = useState("24");
  const [existingPaymaster, setExistingPaymaster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const effectiveAdmin = (admin || connected || "") as Address;
  const effectiveTreasury = (treasury || effectiveAdmin || "") as Address;
  const canSubmit = useMemo(() => {
    return (
      companyId.trim().length > 0 &&
      isAddress(effectiveAdmin) &&
      isAddress(effectiveTreasury) &&
      !busy
    );
  }, [companyId, effectiveAdmin, effectiveTreasury, busy]);

  async function onSubmit() {
    setError(null);
    setCreated(null);

    if (!isAddress(effectiveAdmin) || !isAddress(effectiveTreasury)) {
      setError("Admin and treasury must be valid addresses.");
      return;
    }

    const companyIdBytes32 = bytes32FromLabel(companyId);
    const globalLimit = bigintOr(globalCreditLimit, demoDefaults.globalCreditLimit);
    const perTx = bigintOr(creditPerTx, demoDefaults.creditPerTx);
    const periodLength = Math.max(
      1,
      Math.floor(Number(periodDays || "30") * 86_400),
    );
    const withdrawalDelay = Math.max(
      0,
      Math.floor(Number(withdrawalHours || "24") * 3_600),
    );

    let maxSponsorCost = demoDefaults.maxSponsorCost;
    let value = 0n;
    try {
      maxSponsorCost = parseEther(maxSponsorEth || "0.002");
      value = parseEther(depositEth || "0");
    } catch {
      setError("Invalid ETH amount.");
      return;
    }

    const base: DemoCompany = {
      companyId: companyId.trim(),
      companyIdBytes32,
      admin: effectiveAdmin,
      treasury: effectiveTreasury,
      paymaster: isAddress(existingPaymaster)
        ? (existingPaymaster as Address)
        : "",
      globalCreditLimit: globalLimit.toString(),
      creditPerTx: perTx.toString(),
      maxSponsorCost: maxSponsorCost.toString(),
      periodLength,
      withdrawalDelay,
      createdAt: Date.now(),
    };

    if (!isLiveConfigured) {
      saveCompany(base);
      setCreated({ company: base, onChain: false });
      return;
    }

    setBusy(true);
    try {
      const client = getWalletClient(effectiveAdmin);
      const hash = await client.writeContract({
        address: config.factoryAddress as Address,
        abi: companyFactoryAbi,
        functionName: "createCompany",
        args: [
          {
            companyId: companyIdBytes32,
            admin: effectiveAdmin,
            treasury: effectiveTreasury,
            globalCreditLimit: globalLimit,
            companyPeriodLength: periodLength,
            creditPerTx: perTx,
            maxSponsorCost,
            withdrawalDelay: BigInt(withdrawalDelay),
          },
        ],
        value,
        account: effectiveAdmin,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const events = parseEventLogs({
        abi: companyFactoryAbi,
        eventName: "CompanyCreated",
        logs: receipt.logs,
      });
      const paymaster = (events[0]?.args?.paymaster ?? "") as Address | "";
      const company = { ...base, paymaster };
      saveCompany(company);
      setCreated({ company, txHash: hash, onChain: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Badge variant="outline">Admin · company onboarding</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Register a company
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Deploy an isolated paymaster, set the company credit cap and
          per-transaction cost, then fund the gas tank. The company admin — not
          the user — controls who can be sponsored.
        </p>
      </div>

      {!isLiveConfigured ? (
        <Alert variant="warning" title="Demo mode">
          <span className="font-mono">NEXT_PUBLIC_FACTORY_ADDRESS</span> is not
          set, so this form saves locally. Deploy{" "}
          <span className="font-mono">CompanyFactory</span> and set the env var to
          create real instances.
        </Alert>
      ) : null}

      {walletError ? (
        <Alert variant="error" title="Wallet">
          {walletError}
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="error" title="Could not register">
          {error}
        </Alert>
      ) : null}

      {created ? (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              {created.onChain ? "Company created on-chain" : "Saved in demo mode"}
            </CardTitle>
            <CardDescription>
              {created.onChain
                ? "The factory deployed an isolated CompanyPaymaster."
                : "Configure a factory address to deploy a real instance."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Company" value={created.company.companyId} />
              <Info
                label="Paymaster"
                value={created.company.paymaster || "not deployed"}
                mono
              />
              <Info label="Admin" value={created.company.admin} mono />
              <Info label="Treasury" value={created.company.treasury} mono />
            </div>
            {created.txHash ? (
              <a
                className="inline-flex text-sm text-primary underline-offset-4 hover:underline"
                href={`${config.explorerUrl.replace(/\/$/, "")}/tx/${created.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on explorer
              </a>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/admin">
                  Open admin <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/pay">Try a payment</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Company profile
            </CardTitle>
            <CardDescription>
              A stable company ID, a treasury, and the two credit limits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Company ID"
                hint="hashed to bytes32"
                htmlFor="companyId"
              >
                <Input
                  id="companyId"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  placeholder="acme"
                />
              </Field>
              <Field label="Initial deposit (ETH)" htmlFor="deposit">
                <Input
                  id="deposit"
                  value={depositEth}
                  onChange={(e) => setDepositEth(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field
                label="Admin address"
                hint={connected ? "connected wallet" : "connect MetaMask"}
                htmlFor="admin"
              >
                <div className="flex gap-2">
                  <Input
                    id="admin"
                    value={admin || connected || ""}
                    onChange={(e) => setAdmin(e.target.value)}
                    placeholder="0x…"
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void connect()}
                  >
                    <Wallet className="h-4 w-4" />
                  </Button>
                </div>
              </Field>
              <Field
                label="Treasury address"
                hint="withdrawals go here"
                htmlFor="treasury"
              >
                <Input
                  id="treasury"
                  value={treasury || effectiveAdmin}
                  onChange={(e) => setTreasury(e.target.value)}
                  placeholder="0x…"
                  className="font-mono text-xs"
                />
              </Field>
            </div>

            <div className="h-px bg-border/60" />

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Company credit limit"
                hint="credits / period"
                htmlFor="globalCreditLimit"
              >
                <Input
                  id="globalCreditLimit"
                  value={globalCreditLimit}
                  onChange={(e) => setGlobalCreditLimit(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field
                label="Credits per transaction"
                hint="business units, not ETH"
                htmlFor="creditPerTx"
              >
                <Input
                  id="creditPerTx"
                  value={creditPerTx}
                  onChange={(e) => setCreditPerTx(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Company period (days)" htmlFor="periodDays">
                <Input
                  id="periodDays"
                  value={periodDays}
                  onChange={(e) => setPeriodDays(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field
                label="Max sponsor cost (ETH)"
                hint="reserved per transaction"
                htmlFor="maxSponsorEth"
              >
                <Input
                  id="maxSponsorEth"
                  value={maxSponsorEth}
                  onChange={(e) => setMaxSponsorEth(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field
                label="Withdrawal delay (hours)"
                hint="delayed treasury exit"
                htmlFor="withdrawalHours"
              >
                <Input
                  id="withdrawalHours"
                  value={withdrawalHours}
                  onChange={(e) => setWithdrawalHours(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field
                label="Existing paymaster (optional)"
                hint="demo / already deployed"
                htmlFor="existingPaymaster"
              >
                <Input
                  id="existingPaymaster"
                  value={existingPaymaster}
                  onChange={(e) => setExistingPaymaster(e.target.value)}
                  placeholder="0x…"
                  className="font-mono text-xs"
                />
              </Field>
            </div>

            <Button
              className="w-full"
              size="lg"
              disabled={!canSubmit}
              onClick={() => void onSubmit()}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  Create company <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What gets deployed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {[
                "CompanyPaymaster with its own balance",
                "Embedded beneficiary registry (own storage)",
                "Per-period credit + company cap",
                "Delayed withdrawal queue",
                "Per-instance staking slot",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
          <Alert variant="info" title="Isolation">
            Each company gets its own instance. One company&apos;s spend can never
            consume another company&apos;s budget.
          </Alert>
        </div>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 truncate ${mono ? "font-mono text-xs" : "text-sm font-medium"}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
