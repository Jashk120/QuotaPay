"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { ArrowRight, CheckCircle2, Loader2, UserPlus } from "lucide-react";
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
import { SessionWalletCard } from "@/components/session-wallet-card";
import { useSessionKey } from "@/lib/wallet";
import {
  listRegistrationRequests,
  saveRegistrationRequest,
  type RegistrationRequest,
} from "@/lib/demo-store";
import { shortAddress } from "@/lib/utils";

export default function RegisterPage() {
  const { session, reset } = useSessionKey();
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [group, setGroup] = useState("engineering");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<RegistrationRequest | null>(null);

  const existing = useMemo(() => listRegistrationRequests(), []);

  function submit() {
    setError(null);
    if (!session) {
      setError("Your wallet is still generating. Please try again.");
      return;
    }
    const id = beneficiaryId.trim();
    if (!id) {
      setError("Enter a beneficiary ID (e.g. alice).");
      return;
    }
    setBusy(true);
    try {
      const request: RegistrationRequest = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        beneficiaryId: id,
        label: id,
        wallet: session.address as Address,
        groupId: group.trim() || "engineering",
        requestedAt: Date.now(),
      };
      saveRegistrationRequest(request);
      setSubmitted(request);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <Badge variant="outline">Beneficiary · registration</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Register as a beneficiary
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Create your sponsored-wallet identity in two steps: your in-browser
          wallet is generated for you, then your company admin approves it and
          issues the credential you&apos;ll use to pay.
        </p>
      </div>

      <SessionWalletCard session={session} onReset={reset} />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Your details
            </CardTitle>
            <CardDescription>
              These identify you to the company that sponsors your payments.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Beneficiary ID"
              hint="e.g. alice — your stable identity"
              htmlFor="reg-id"
            >
              <Input
                id="reg-id"
                value={beneficiaryId}
                onChange={(e) => setBeneficiaryId(e.target.value)}
                placeholder="alice"
              />
            </Field>
            <Field
              label="Department / group"
              hint="for the admin's reporting"
              htmlFor="reg-group"
            >
              <Input
                id="reg-group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="engineering"
              />
            </Field>
            <Button
              className="w-full"
              disabled={busy || !session}
              onClick={submit}
              data-testid="register-submit"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Submit registration request
            </Button>
            {error ? <Alert variant="error">{error}</Alert> : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {submitted ? (
            <Card className="border-primary/40" data-testid="register-created">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Request submitted
                </CardTitle>
                <CardDescription>
                  Your admin will review and approve it, then issue your
                  credential.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Beneficiary</span>
                  <span className="font-medium">{submitted.beneficiaryId}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Wallet</span>
                  <span className="font-mono text-xs">
                    {shortAddress(submitted.wallet, 8)}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Group</span>
                  <span>{submitted.groupId}</span>
                </div>
                <Button asChild className="mt-2 w-full">
                  <Link href="/sponsorship/pay">
                    Go to Pay <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Alert variant="info" title="What happens next">
              Your request is sent to the company admin. Once approved, you&apos;ll
              get a <span className="font-mono">credential</span> (secret + Merkle
              path) to load on the <Link href="/sponsorship/pay" className="underline underline-offset-2">Pay</Link> page.
              In demo mode you can also just load the bundled demo credential.
            </Alert>
          )}

          {existing.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Your pending requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {existing.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-3 py-2 shadow-[0_1px_2px_hsl(40_30%_20%/0.03)]"
                  >
                    <span className="font-medium">{r.beneficiaryId}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {shortAddress(r.wallet, 6)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
