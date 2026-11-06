"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleDollarSign,
  Fuel,
  KeyRound,
  Landmark,
  ShieldCheck,
  Sparkles,
  UserPlus,
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

type Role = "user" | "admin";

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

const howItWorks: {
  icon: typeof Building2;
  step: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  role: Role;
}[] = [
  {
    icon: Building2,
    step: "01",
    title: "Register your company",
    body: "The admin deploys an isolated paymaster, sets the credit cap, and funds the gas tank.",
    cta: "Register a company",
    href: "/company/new",
    role: "admin",
  },
  {
    icon: UserPlus,
    step: "02",
    title: "Register as a beneficiary",
    body: "A user creates their sponsored wallet and asks the company to authorize it.",
    cta: "Register as a user",
    href: "/register",
    role: "user",
  },
  {
    icon: Sparkles,
    step: "03",
    title: "Pay with 0 ETH",
    body: "The beneficiary proves eligibility and the paymaster covers the gas — no balance needed.",
    cta: "Try a payment",
    href: "/pay",
    role: "user",
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
    <div className="space-y-24">
      <section className="relative pt-6 sm:pt-10">
        <div className="mx-auto max-w-3xl space-y-6 text-center">
          <Badge variant="default" className="mx-auto">
            EIP-8141 · ERC-8421 · company-scoped sponsorship
          </Badge>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Sponsor the transaction,
            <span className="block text-gradient">
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
              <Link href="/sponsorship/company/new">
                <Building2 className="h-4 w-4" /> I&apos;m a company admin
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sponsorship/register">
                <UserPlus className="h-4 w-4" /> I&apos;m a beneficiary
              </Link>
            </Button>
          </div>

          <div className="mx-auto mt-8 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Isolated paymasters
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-primary" />
              Zero-knowledge eligibility
            </span>
            <span className="inline-flex items-center gap-1.5">
              <BadgeCheck className="h-3.5 w-3.5 text-primary" />
              Per-company solvency ledger
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="mx-auto max-w-2xl space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            How it works
          </h2>
          <p className="text-balance text-sm text-muted-foreground">
            Two sides, one sponsorship account. Admins set the budget; users
            register and pay without ever holding ETH.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {howItWorks.map((item) => (
            <Card
              key={item.step}
              className="group relative flex flex-col overflow-hidden"
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/35">
                    <item.icon className="h-5 w-5 text-yellow-700" />
                  </div>
                  <span className="font-mono text-3xl font-semibold text-foreground/10">
                    {item.step}
                  </span>
                </div>
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.body}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <Link href={item.href}>
                    {item.cta} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="mx-auto max-w-2xl space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Built for three roles
          </h2>
          <p className="text-balance text-sm text-muted-foreground">
            Clean separation between who registers, who benefits, and who pays.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.title}>
              <CardHeader>
                <div className="mb-2 grid h-10 w-10 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/35">
                  <role.icon className="h-5 w-5 text-yellow-700" />
                </div>
                <CardTitle>{role.title}</CardTitle>
                <CardDescription>{role.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              One payment, four frames
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
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
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary ring-1 ring-border/60">
                    <step.icon className="h-4 w-4 text-muted-foreground" />
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
                className="flex items-start gap-2 rounded-xl border border-border/70 bg-secondary/30 p-3 text-sm text-muted-foreground"
              >
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live configuration</CardTitle>
            <CardDescription>
              Reads from <span className="font-mono">NEXT_PUBLIC_*</span> env
              vars at build time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row
              label="Network"
              value={isLiveConfigured ? "configured" : "demo mode"}
            />
            <Row
              label="Factory"
              value={isLiveConfigured ? "deployed" : "not configured"}
            />
            <Row
              label="Frame submit"
              value={config.submitEnabled ? "enabled" : "disabled"}
            />
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900">
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
