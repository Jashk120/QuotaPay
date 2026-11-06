"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  isAddress,
  parseEther,
  type Address,
} from "viem";
import { useWriteContract } from "wagmi";
import {
  ArrowRight,
  Coins,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
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
import { companyPaymasterAbi } from "@/lib/abis";
import { config, demoDefaults, isLiveConfigured } from "@/lib/config";
import {
  bytes32FromLabel,
  readPaymaster,
  type PaymasterSnapshot,
} from "@/lib/contracts";
import {
  getActiveCompany,
  getActivePaymaster,
  getCompany,
  listBeneficiaries,
  listRegistrationRequests,
  removeRegistrationRequest,
  saveBeneficiary,
  setActiveCompany,
  setActivePaymaster,
  setBeneficiaryActive,
  type DemoBeneficiary,
  type RegistrationRequest,
} from "@/lib/demo-store";
import { useConnectedWallet } from "@/lib/wallet";
import { useAnonRpc } from "@/lib/anonRpc";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export default function AdminPage() {
  const { address: admin, connect } = useConnectedWallet();
  const { mutateAsync: writeContract } = useWriteContract();
  const { fetch: anonFetch } = useAnonRpc();

  const [paymaster, setPaymaster] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [snapshot, setSnapshot] = useState<PaymasterSnapshot | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<DemoBeneficiary[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // enrollment form
  const [label, setLabel] = useState("alice");
  const [wallet, setWallet] = useState("");
  const [perPeriodLimit, setPerPeriodLimit] = useState("100");
  const [periodDays, setPeriodDays] = useState("30");
  const [expiryDays, setExpiryDays] = useState("0");
  const [group, setGroup] = useState("engineering");

  // policy form
  const [creditPerTx, setCreditPerTx] = useState("1");
  const [globalCreditLimit, setGlobalCreditLimit] = useState("500");
  const [maxSponsorEth, setMaxSponsorEth] = useState("0.002");

  // treasury form
  const [depositEth, setDepositEth] = useState("0.5");
  const [withdrawEth, setWithdrawEth] = useState("0.1");

  const live = isLiveConfigured && isAddress(paymaster);

  const refresh = useCallback(async () => {
    setError(null);
    const cid = companyId || getActiveCompany() || "";
    if (cid) {
      setCompanyId(cid);
      setBeneficiaries(listBeneficiaries(cid));
    }
    setRegistrations(listRegistrationRequests());
    if (live) {
      try {
        const snap = await readPaymaster(paymaster as Address, anonFetch);
        setSnapshot(snap);
      } catch (e) {
        setSnapshot(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    } else {
      setSnapshot(null);
    }
  }, [companyId, live, paymaster, anonFetch]);

  useEffect(() => {
    const pm = getActivePaymaster();
    const cid = getActiveCompany();
    if (pm) setPaymaster(pm);
    if (cid) setCompanyId(cid);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const company = useMemo(
    () => (companyId ? getCompany(companyId) : undefined),
    [companyId],
  );

  const totals = useMemo(() => {
    const fallbackCredits = company ? BigInt(company.creditPerTx) : 1n;
    const fallbackLimit = company ? BigInt(company.globalCreditLimit) : 500n;
    return {
      creditPerTx: snapshot?.creditPerTx ?? fallbackCredits,
      globalLimit: snapshot?.globalCreditLimit ?? fallbackLimit,
      spent: snapshot?.companySpent ?? 0n,
      available: snapshot?.availableBalance ?? 0n,
      pending: snapshot?.pendingWithdrawals ?? 0n,
    };
  }, [company, snapshot]);

  async function write(
    action: string,
    fn: () => Promise<`0x${string}`>,
  ): Promise<boolean> {
    setError(null);
    setNotice(null);
    if (!admin) {
      setError("Connect the company admin wallet first.");
      return false;
    }
    if (!isAddress(paymaster)) {
      setError("Enter the deployed paymaster address.");
      return false;
    }
    setBusy(action);
    try {
      const hash = await fn();
      setNotice(`${action} submitted: ${hash.slice(0, 10)}…`);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function enrollBeneficiary() {
    if (!isAddress(wallet)) {
      setError("Beneficiary wallet must be a valid address.");
      return;
    }
    if (!companyId) {
      setError("Register or select a company first.");
      return;
    }
    const id = bytes32FromLabel(label);
    const groupId = bytes32FromLabel(group);
    const periodLength = Math.max(
      1,
      Math.floor(Number(periodDays || "30") * 86_400),
    );
    const expiry =
      Number(expiryDays) > 0
        ? nowSeconds() + Math.floor(Number(expiryDays) * 86_400)
        : 0;
    const limit = BigInt(perPeriodLimit || "0");

    if (live) {
      const ok = await write("Enroll beneficiary", () =>
        writeContract({
          address: paymaster as Address,
          abi: companyPaymasterAbi,
          functionName: "enroll",
          args: [id, wallet as Address, BigInt(expiry), periodLength, limit, groupId],
        }),
      );
      if (!ok) return;
    }

    saveBeneficiary({
      companyId,
      beneficiaryId: label,
      beneficiaryIdBytes32: id,
      wallet: wallet as Address,
      label,
      perPeriodLimit: limit.toString(),
      spent: "0",
      active: true,
      expiry,
      periodLength,
      groupId: group,
      createdAt: Date.now(),
    });
    setBeneficiaries(listBeneficiaries(companyId));
    if (!live) setNotice("Saved locally (demo mode). Enable live mode to enroll on-chain.");
  }

  async function revoke(row: DemoBeneficiary) {
    if (live) {
      const ok = await write("Revoke wallet", () =>
        writeContract({
          address: paymaster as Address,
          abi: companyPaymasterAbi,
          functionName: "revokeWallet",
          args: [row.wallet],
        }),
      );
      if (!ok) return;
    }
    setBeneficiaryActive(row.companyId, row.wallet, false);
    setBeneficiaries(listBeneficiaries(row.companyId));
  }

  async function reactivate(row: DemoBeneficiary) {
    if (live) {
      const ok = await write("Reactivate wallet", () =>
        writeContract({
          address: paymaster as Address,
          abi: companyPaymasterAbi,
          functionName: "setWalletActive",
          args: [row.wallet, true],
        }),
      );
      if (!ok) return;
    }
    setBeneficiaryActive(row.companyId, row.wallet, true);
    setBeneficiaries(listBeneficiaries(row.companyId));
  }

  async function approveRegistration(req: RegistrationRequest) {
    if (!companyId) {
      setError("Register or select a company first.");
      return;
    }
    const id = bytes32FromLabel(req.beneficiaryId);
    const groupId = bytes32FromLabel(req.groupId);
    const periodLength = demoDefaults.beneficiaryPeriodLength;
    const limit = demoDefaults.perPeriodLimit;

    if (live) {
      const ok = await write("Approve registration", () =>
        writeContract({
          address: paymaster as Address,
          abi: companyPaymasterAbi,
          functionName: "enroll",
          args: [id, req.wallet, 0n, periodLength, limit, groupId],
        }),
      );
      if (!ok) return;
    }

    saveBeneficiary({
      companyId,
      beneficiaryId: req.beneficiaryId,
      beneficiaryIdBytes32: id,
      wallet: req.wallet,
      label: req.beneficiaryId,
      perPeriodLimit: limit.toString(),
      spent: "0",
      active: true,
      expiry: 0,
      periodLength,
      groupId: req.groupId,
      createdAt: Date.now(),
    });
    removeRegistrationRequest(req.id);
    setRegistrations(listRegistrationRequests());
    setBeneficiaries(listBeneficiaries(companyId));
    if (!live) {
      setNotice(
        `Approved ${req.beneficiaryId}. They can now load a credential and pay.`,
      );
    }
  }

  function dismissRegistration(req: RegistrationRequest) {
    removeRegistrationRequest(req.id);
    setRegistrations(listRegistrationRequests());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Badge variant="outline">Company admin</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Sponsorship control room
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Authorize beneficiary wallets, tune the credit policy, and manage
            the company treasury. Only the admin key can do any of this.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/sponsorship/company/new">
              <Plus className="h-4 w-4" /> New company
            </Link>
          </Button>
          <Button asChild>
            <Link href="/sponsorship/pay">
              Pay page <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {!isLiveConfigured ? (
        <Alert variant="warning" title="Demo mode">
          No factory configured. Enrollment and policy changes are stored
          locally; set <span className="font-mono">NEXT_PUBLIC_FACTORY_ADDRESS</span>{" "}
          and <span className="font-mono">NEXT_PUBLIC_ENABLE_SUBMIT=true</span> for
          live mode.
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="Action failed">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success" title="Done">
          {notice}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-end">
          <Field
            label="Paymaster address"
            hint={live ? "live reads enabled" : "paste a deployed instance"}
            className="flex-1"
            htmlFor="paymaster"
          >
            <Input
              id="paymaster"
              value={paymaster}
              onChange={(e) => setPaymaster(e.target.value.trim())}
              placeholder="0x…"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="Company ID"
            hint="local label"
            className="md:w-48"
            htmlFor="company"
          >
            <Input
              id="company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setActiveCompany(e.target.value);
              }}
              placeholder="acme"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void refresh()}
              disabled={busy !== null}
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (isAddress(paymaster)) setActivePaymaster(paymaster);
                void connect();
              }}
            >
              <Wallet className="h-4 w-4" />
              {admin ? `${admin.slice(0, 6)}…` : "Connect admin"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Credits / tx"
          value={totals.creditPerTx.toString()}
          hint="business units"
        />
        <Stat
          label="Company spend"
          value={`${totals.spent.toString()} / ${totals.globalLimit.toString()}`}
          hint="credits this period"
        />
        <Stat
          label="Available ETH"
          value={`${formatEth(totals.available)} ETH`}
          hint="excludes pending withdrawals"
        />
        <Stat
          label="Pending withdrawals"
          value={`${formatEth(totals.pending)} ETH`}
          hint="reserved"
        />
      </div>

      {registrations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Registration requests
            </CardTitle>
            <CardDescription>
              Beneficiaries who registered themselves and are waiting for your
              approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4">Beneficiary</th>
                    <th className="pb-2 pr-4">Wallet</th>
                    <th className="pb-2 pr-4">Group</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((req) => (
                    <tr
                      key={req.id}
                      className="border-b border-border/40 last:border-0"
                      data-testid="registration-row"
                    >
                      <td className="py-3 pr-4 font-medium">{req.beneficiaryId}</td>
                      <td className="py-3 pr-4 font-mono text-xs" title={req.wallet}>
                        {req.wallet.slice(0, 8)}…{req.wallet.slice(-6)}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {req.groupId}
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void approveRegistration(req)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => dismissRegistration(req)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Register a beneficiary
            </CardTitle>
            <CardDescription>
              Authorize a wallet under a stable beneficiary ID. Rotating the
              wallet keeps the same allowance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Beneficiary ID" hint="e.g. alice" htmlFor="b-label">
                <Input
                  id="b-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <Field label="Wallet" hint="0x…" htmlFor="b-wallet">
                <Input
                  id="b-wallet"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value.trim())}
                  placeholder="0x…"
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Credits / period" htmlFor="b-limit">
                <Input
                  id="b-limit"
                  value={perPeriodLimit}
                  onChange={(e) => setPerPeriodLimit(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Period (days)" htmlFor="b-period">
                <Input
                  id="b-period"
                  value={periodDays}
                  onChange={(e) => setPeriodDays(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Expiry (days, 0 = never)" htmlFor="b-expiry">
                <Input
                  id="b-expiry"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Group / department" htmlFor="b-group">
                <Input
                  id="b-group"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />
              </Field>
            </div>
            <Button
              className="w-full"
              disabled={busy !== null || !companyId}
              onClick={() => void enrollBeneficiary()}
            >
              {busy === "Enroll beneficiary" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Authorize wallet
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Policy
            </CardTitle>
            <CardDescription>
              Credit units are business accounting, not ETH. Solvency is tracked
              separately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Credits / tx" htmlFor="p-credit">
                <Input
                  id="p-credit"
                  value={creditPerTx}
                  onChange={(e) => setCreditPerTx(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Company credit limit" htmlFor="p-limit">
                <Input
                  id="p-limit"
                  value={globalCreditLimit}
                  onChange={(e) => setGlobalCreditLimit(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Max sponsor cost (ETH)" htmlFor="p-max">
                <Input
                  id="p-max"
                  value={maxSponsorEth}
                  onChange={(e) => setMaxSponsorEth(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <Button
              className="w-full"
              variant="secondary"
              disabled={busy !== null || !live || !admin}
              onClick={() =>
                void write("Update policy", async () => {
                  const paymasterAddress = paymaster as Address;
                  await writeContract({
                    address: paymasterAddress,
                    abi: companyPaymasterAbi,
                    functionName: "setCreditPerTx",
                    args: [BigInt(creditPerTx || "1")],
                  });
                  await writeContract({
                    address: paymasterAddress,
                    abi: companyPaymasterAbi,
                    functionName: "setGlobalCreditLimit",
                    args: [BigInt(globalCreditLimit || "0")],
                  });
                  return writeContract({
                    address: paymasterAddress,
                    abi: companyPaymasterAbi,
                    functionName: "setMaxSponsorCost",
                    args: [parseEther(maxSponsorEth || "0.002")],
                  });
                })
              }
            >
              Save policy
            </Button>
            {!live ? (
              <p className="text-xs text-muted-foreground">
                Live paymaster required to write policy.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Beneficiaries
          </CardTitle>
          <CardDescription>
            {beneficiaries.length === 0
              ? "No wallets authorized yet."
              : `${beneficiaries.length} wallet(s) on this company.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {beneficiaries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
              Authorize a wallet above, then share its address with the
              beneficiary.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4">Wallet</th>
                    <th className="pb-2 pr-4">Beneficiary</th>
                    <th className="pb-2 pr-4">Limit</th>
                    <th className="pb-2 pr-4">Group</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {beneficiaries.map((row) => (
                    <tr
                      key={`${row.companyId}:${row.wallet}`}
                      className="border-b border-border/40 last:border-0"
                      data-testid="beneficiary-row"
                    >
                      <td className="py-3 pr-4 font-mono text-xs" title={row.wallet}>
                        {row.wallet.slice(0, 8)}…{row.wallet.slice(-6)}
                      </td>
                      <td className="py-3 pr-4">{row.beneficiaryId}</td>
                      <td className="py-3 pr-4">{row.perPeriodLimit}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {row.groupId}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={row.active ? "success" : "destructive"}>
                          {row.active ? "active" : "revoked"}
                        </Badge>
                      </td>
                      <td className="py-3">
                        {row.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => void revoke(row)}
                          >
                            Revoke
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => void reactivate(row)}
                          >
                            Reactivate
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" /> Fund the gas tank
            </CardTitle>
            <CardDescription>
              Deposits raise the ETH solvency budget. Withdrawals are delayed and
              reserved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Deposit (ETH)" htmlFor="t-deposit">
                <Input
                  id="t-deposit"
                  value={depositEth}
                  onChange={(e) => setDepositEth(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Request withdrawal (ETH)" htmlFor="t-withdraw">
                <Input
                  id="t-withdraw"
                  value={withdrawEth}
                  onChange={(e) => setWithdrawEth(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy !== null || !live || !admin}
                onClick={() =>
                  void write("Deposit", () =>
                    writeContract({
                      address: paymaster as Address,
                      abi: companyPaymasterAbi,
                      functionName: "deposit",
                      args: [],
                      value: parseEther(depositEth || "0"),
                    }),
                  )
                }
              >
                Deposit
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null || !live || !admin}
                onClick={() =>
                  void write("Request withdrawal", () =>
                    writeContract({
                      address: paymaster as Address,
                      abi: companyPaymasterAbi,
                      functionName: "requestWithdrawal",
                      args: [parseEther(withdrawEth || "0")],
                    }),
                  )
                }
              >
                Request withdrawal
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null || !live || !admin}
                onClick={() =>
                  void write("Execute withdrawal", () =>
                    writeContract({
                      address: paymaster as Address,
                      abi: companyPaymasterAbi,
                      functionName: "executeWithdrawal",
                      args: [],
                    }),
                  )
                }
              >
                Execute
              </Button>
              <Button
                variant="ghost"
                disabled={busy !== null || !live || !admin}
                onClick={() =>
                  void write("Cancel withdrawal", () =>
                    writeContract({
                      address: paymaster as Address,
                      abi: companyPaymasterAbi,
                      functionName: "cancelWithdrawal",
                      args: [],
                    }),
                  )
                }
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-primary" /> Instance snapshot
            </CardTitle>
            <CardDescription>
              {live
                ? "Read directly from the paymaster."
                : "Demo values from the local company record."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Admin" value={snapshot?.admin ?? admin ?? "—"} mono />
            <Row
              label="Treasury"
              value={snapshot?.treasury ?? company?.treasury ?? "—"}
              mono
            />
            <Row
              label="Max sponsor cost"
              value={`${formatEth(snapshot?.maxSponsorCost ?? (company ? BigInt(company.maxSponsorCost) : 0n))} ETH`}
            />
            <Row
              label="Company ID"
              value={companyId || "—"}
            />
            <Row
              label="Explorer"
              value={`${config.explorerUrl.replace(/\/$/, "")}`}
              mono
            />
            {company ? (
              <div className="pt-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/sponsorship/pay">
                    Open pay page <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
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
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`max-w-[62%] truncate text-right ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function formatEth(value: bigint, digits = 4) {
  const n = Number(value) / 1e18;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
