"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  isAddress,
  parseEther,
  parseGwei,
  type Address,
  type Hex,
} from "viem";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Fuel,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
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
import { config, isLiveConfigured } from "@/lib/config";
import { isAuthorized } from "@/lib/contracts";
import { getActivePaymaster } from "@/lib/demo-store";
import {
  buildSponsoredTransfer,
  getReceipt,
  sendFrameSponsoredTransfer,
  sendRawSponsoredTransfer,
  serializeSponsoredTransfer,
  signSponsoredTransfer,
  sponsoredTransferHash,
  type SignedEnvelope,
} from "@/lib/frameTx";
import { shortAddress } from "@/lib/utils";
import { useSessionKey } from "@/lib/wallet";

type Receipt = Awaited<ReturnType<typeof getReceipt>>;

export default function PayPage() {
  const { session, reset } = useSessionKey();

  const [paymaster, setPaymaster] = useState("");
  const [to, setTo] = useState("");
  const [amountEth, setAmountEth] = useState("0.001");
  const [nonce, setNonce] = useState("0");
  const [maxFeeGwei, setMaxFeeGwei] = useState("2");
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [signed, setSigned] = useState<SignedEnvelope | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [receipt, setReceipt] = useState<Receipt>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPaymaster(getActivePaymaster());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!session || !isAddress(paymaster) || !isLiveConfigured) {
        setAuthorized(null);
        return;
      }
      try {
        const ok = await isAuthorized(
          paymaster as Address,
          session.address,
        );
        if (!cancelled) setAuthorized(ok);
      } catch {
        if (!cancelled) setAuthorized(null);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [session, paymaster]);

  const serialized = useMemo(() => {
    if (!signed) return null;
    try {
      return serializeSponsoredTransfer(signed);
    } catch {
      return null;
    }
  }, [signed]);

  function build() {
    setError(null);
    setStatus(null);
    setReceipt(null);
    setTxHash(null);
    setSigned(null);

    if (!session) {
      setError("Session key is still loading.");
      return;
    }
    if (!isAddress(paymaster)) {
      setError("Enter the deployed paymaster address.");
      return;
    }
    if (!isAddress(to)) {
      setError("Recipient must be a valid address.");
      return;
    }

    try {
      const envelope = buildSponsoredTransfer({
        sender: session.address,
        paymaster: paymaster as Address,
        to: to as Address,
        value: parseEther(amountEth || "0"),
        nonce: BigInt(nonce || "0"),
        chainId: config.chainId,
        maxFeePerGas: parseGwei(maxFeeGwei || "2"),
        maxPriorityFeePerGas: parseGwei(maxFeeGwei || "2"),
      });
      const signedEnvelope = signSponsoredTransfer(
        envelope,
        session.privateKey,
      );
      setSigned(signedEnvelope);
      setTxHash(sponsoredTransferHash(signedEnvelope));
      setStatus("Transaction built and signed locally.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    if (!signed) return;
    if (!config.submitEnabled) {
      setError(
        "Submission is disabled. Set NEXT_PUBLIC_ENABLE_SUBMIT=true and an EIP-8141 RPC URL.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Submitting to the EIP-8141 RPC…");
    try {
      let hash: Hex;
      try {
        hash = await sendFrameSponsoredTransfer(config.rpcUrl, signed);
        setStatus("Accepted by eth_sendFrameTransaction.");
      } catch (frameError) {
        setStatus("Frame RPC rejected it; trying the raw encoding…");
        try {
          hash = await sendRawSponsoredTransfer(config.rpcUrl, signed);
          setStatus("Accepted by eth_sendRawTransaction.");
        } catch (rawError) {
          throw new Error(
            `Frame RPC: ${toMessage(frameError)}\nRaw RPC: ${toMessage(rawError)}`,
          );
        }
      }
      setTxHash(hash);
      const r = await getReceipt(config.rpcUrl, hash);
      setReceipt(r);
      setStatus(r ? "Mined." : "Pending in the mempool.");
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied to clipboard.");
    } catch {
      setStatus("Could not access the clipboard.");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Badge variant="outline">Beneficiary · sponsored payment</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Let the paymaster cover it
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          This builds a four-frame EIP-8141 transaction with Ox, signs it with a
          local session key, and submits it to the EIP-8141 RPC. The beneficiary
          holds 0 ETH; the company paymaster pays.
        </p>
      </div>

      {!config.submitEnabled ? (
        <Alert variant="warning" title="Submission disabled">
          Set <span className="font-mono">NEXT_PUBLIC_ENABLE_SUBMIT=true</span>{" "}
          to broadcast. You can still build, sign, and inspect the transaction.
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="error" title="Payment failed">
          <div className="whitespace-pre-wrap break-words">{error}</div>
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="info" title="Status">
          {status}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Beneficiary signer
            </CardTitle>
            <CardDescription>
              A session key in this browser. The address must be authorized by
              the company admin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-background/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Session address
              </div>
              <div className="mt-1 break-all font-mono text-xs">
                {session?.address ?? "generating…"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => session && void copy(session.address)}
              >
                <Copy className="h-4 w-4" /> Copy address
              </Button>
              <Button variant="outline" size="sm" onClick={reset}>
                <RefreshCw className="h-4 w-4" /> New key
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin">
                  Enroll in admin <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              {authorized === null ? (
                <span className="text-muted-foreground">
                  Authorization status unavailable (demo / no RPC).
                </span>
              ) : authorized ? (
                <span className="text-emerald-300">Wallet is authorized</span>
              ) : (
                <span className="text-red-300">
                  Wallet is not authorized — enroll it first.
                </span>
              )}
            </div>
            <Alert variant="info" title="Why a session key?">
              MetaMask cannot construct or broadcast EIP-8141 frame
              transactions. The session key satisfies the EOA VERIFY frame; the
              app relays the signed envelope.
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" /> Payment
            </CardTitle>
            <CardDescription>
              The paymaster address must point at your company instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Paymaster" htmlFor="pay-paymaster" hint="CompanyPaymaster">
              <Input
                id="pay-paymaster"
                value={paymaster}
                onChange={(e) => setPaymaster(e.target.value.trim())}
                placeholder="0x…"
                className="font-mono text-xs"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Recipient" htmlFor="pay-to" hint="0x…">
                <Input
                  id="pay-to"
                  value={to}
                  onChange={(e) => setTo(e.target.value.trim())}
                  placeholder="0x…"
                  className="font-mono text-xs"
                />
              </Field>
              <Field label="Amount (ETH)" htmlFor="pay-amount">
                <Input
                  id="pay-amount"
                  value={amountEth}
                  onChange={(e) => setAmountEth(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Nonce" htmlFor="pay-nonce" hint="account nonce">
                <Input
                  id="pay-nonce"
                  value={nonce}
                  onChange={(e) => setNonce(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Max fee (gwei)" htmlFor="pay-fee">
                <Input
                  id="pay-fee"
                  value={maxFeeGwei}
                  onChange={(e) => setMaxFeeGwei(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={build} disabled={!session}>
                Build & sign <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                onClick={() => void send()}
                disabled={!signed || busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Fuel className="h-4 w-4" />
                )}
                Submit sponsored tx
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {signed ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" /> Signed frame
              transaction
            </CardTitle>
            <CardDescription>
              {txHash ? `Hash ${shortAddress(txHash, 8)}` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Info label="Chain ID" value={String(config.chainId)} />
              <Info label="Frames" value={String(signed.frames.length)} />
              <Info
                label="Serialized"
                value={`${serialized ? (serialized.length - 2) / 2 : 0} bytes`}
              />
            </div>
            <div className="space-y-2">
              {signed.frames.map((frame, index) => (
                <div
                  key={index}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 p-3 text-xs"
                >
                  <Badge variant="secondary" className="font-mono">
                    #{index} · {String(frame.mode)}
                  </Badge>
                  <span className="text-muted-foreground">
                    flags {String(frame.flags)} · exec{" "}
                    {String(frame.executionGas ?? 0n)} · state{" "}
                    {String(frame.stateGas ?? 0n)}
                  </span>
                  <span className="ml-auto font-mono text-muted-foreground">
                    {frame.to ? shortAddress(frame.to, 6) : "sender"}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="sm" variant="outline">
                <a
                  href={`${config.explorerUrl.replace(/\/$/, "")}/tx/${txHash ?? ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" /> Explorer
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => session && void copy(session.address)}
              >
                <Copy className="h-4 w-4" /> Copy signer
              </Button>
            </div>
            {receipt ? (
              <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">mined</Badge>
                  <span className="text-muted-foreground">
                    block {receipt.blockNumber ?? "—"}
                  </span>
                  <span className="text-muted-foreground">
                    payer {receipt.payer ? shortAddress(receipt.payer, 6) : "—"}
                  </span>
                  <span className="text-muted-foreground">
                    frames {receipt.frameReceipts?.length ?? 0}
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            The paymaster pays the gas; the beneficiary needs 0 ETH.
          </span>
          <span className="flex items-center gap-2">
            <Spark /> Wire-format compatibility: see{" "}
            <span className="font-mono text-xs">npm run compat</span>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function Spark() {
  return <span className="inline-block h-2 w-2 rounded-full bg-primary" />;
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
