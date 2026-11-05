import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleDollarSign,
  Fuel,
  Landmark,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { config, isLiveConfigured } from "@/lib/config";

const roles = [
  {
    icon: Building2,
    title: "Company admin",
    body: "Registers the company, funds the treasury, and authorizes exactly which wallets may be sponsored.",
  },
  {
    icon: UserRound,
    title: "Beneficiary",
    body: "Pays with 0 ETH. A stable beneficiary ID keeps the allowance across wallet rotations.",
  },
  {
    icon: Wallet,
    title: "Paymaster",
    body: "Isolated per company. Enforces per-wallet credit, the company cap, and ETH solvency.",
  },
];

const steps = [
  {
    icon: ShieldCheck,
    title: "Verify",
    body: "The beneficiary signs the frame transaction; the EOA verify frame approves execution.",
    tag: "VERIFY",
  },
  {
    icon: CircleDollarSign,
    title: "Charge",
    body: "pre_verify calls charge(): authorize wallet, roll the period, check credit and solvency.",
    tag: "DEFAULT",
  },
  {
    icon: BadgeCheck,
    title: "Approve",
    body: "The pay frame approves payment only if this transaction was charged.",
    tag: "VERIFY",
  },
  {
    icon: Fuel,
    title: "Execute",
    body: "The sponsored action runs as the sender. The paymaster covers the gas.",
    tag: "SENDER",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-20">
      <section className="relative">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <Badge variant="default" className="mx-auto">
            EIP-8141 · ERC-8421 · company-scoped sponsorship
          </Badge>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Sponsor the transaction,
            <span className="block bg-gradient-to-r from-primary via-emerald-300 to-teal-200 bg-clip-text text-transparent">
              not the wallet.
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
            QuotaPay lets a company authorize beneficiary wallets, cap their
            spending, and pay gas for EIP-8141 frame transactions — with an
            isolated paymaster and a real solvency ledger per company.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/company/new">
                Register a company <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pay">Try a sponsored payment</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {roles.map((role) => (
          <Card key={role.title}>
            <CardHeader>
              <div className="mb-2 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/25">
                <role.icon className="h-5 w-5 text-primary" />
              </div>
              <CardTitle>{role.title}</CardTitle>
              <CardDescription>{role.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              One payment, four frames
            </h2>
            <p className="text-sm text-muted-foreground">
              The paymaster pays only when the charge for this exact transaction
              is recorded first.
            </p>
          </div>
          <Badge variant="outline">EIP-8141 layout</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <Card key={step.title} className="relative overflow-hidden">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                    <step.icon className="h-4 w-4 text-foreground/80" />
                  </div>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {step.tag}
                  </Badge>
                </div>
                <CardTitle className="mt-3 text-base">
                  {index + 1}. {step.title}
                </CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-primary" /> Why isolated
              paymasters
            </CardTitle>
            <CardDescription>
              One company, one sponsorship account. No shared balances, no
              cross-tenant accounting bugs.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {[
              "Per-beneficiary, per-period credit limits",
              "Company-wide spend cap",
              "ETH solvency = balance − pending withdrawals",
              "Delayed withdrawal queue",
              "Stable beneficiary IDs across wallet rotation",
              "Per-instance ERC-8421 staking",
            ].map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/40 p-3 text-sm text-muted-foreground"
              >
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Devnet status</CardTitle>
            <CardDescription>
              Configure via <span className="font-mono">NEXT_PUBLIC_*</span> env
              vars.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Chain ID" value={String(config.chainId)} />
            <Row label="RPC" value={config.rpcUrl} mono />
            <Row
              label="Factory"
              value={
                isLiveConfigured ? config.factoryAddress : "not configured"
              }
              mono
            />
            <Row
              label="Frame submit"
              value={config.submitEnabled ? "enabled" : "disabled"}
            />
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
              MetaMask cannot send EIP-8141 frame transactions. The pay flow
              uses an in-browser session key as the beneficiary signer and a
              relayer/RPC for submission.
            </div>
          </CardContent>
        </Card>
      </section>
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
    <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`max-w-[60%] truncate text-right ${
          mono ? "font-mono text-xs" : "font-medium"
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
