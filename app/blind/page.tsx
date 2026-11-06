"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAddress, parseEther, type Address } from "viem";
import {
  ArrowRight,
  CheckCircle2,
  EyeOff,
  KeyRound,
  ShieldCheck,
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
import { config } from "@/lib/config";
import {
  buildBlindRequest,
  finalizeToken,
  randomSerial,
  signBlinded,
  verifyTokenOffline,
  type BlindToken,
  type TokenFields,
} from "@/lib/blindToken";
import { saveBlindToken } from "@/lib/blindTokenStore";
import { getActivePaymaster, setActivePaymaster } from "@/lib/demo-store";
import { shortAddress } from "@/lib/utils";
import { useSessionKey } from "@/lib/wallet";

export default function BlindPage() {
  const { session } = useSessionKey();

  const [paymaster, setPaymaster] = useState("");
  const [epoch, setEpoch] = useState("0");
  const [maxCostEth, setMaxCostEth] = useState("0.002");
  const [fields, setFields] = useState<TokenFields | null>(null);
  const [blinded, setBlinded] = useState<bigint | null>(null);
  const [blindFactor, setBlindFactor] = useState<bigint | null>(null);
  const [signedBlinded, setSignedBlinded] = useState<bigint | null>(null);
  const [token, setToken] = useState<BlindToken | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPaymaster(getActivePaymaster());
  }, []);

  function createRequest() {
    setError(null);
    setStatus(null);
    setToken(null);
    setSignedBlinded(null);
    if (!session) {
      setError("Session key is still loading.");
      return;
    }
    if (!isAddress(paymaster)) {
      setError("Enter a valid paymaster address.");
      return;
    }
    try {
      const nextFields: TokenFields = {
        sessionKey: session.address,
        paymaster: paymaster as Address,
        chainId: config.chainId,
        epoch: BigInt(epoch || "0"),
        maxCost: parseEther(maxCostEth || "0.002"),
        serial: randomSerial(),
      };
      const request = buildBlindRequest(nextFields);
      setFields(nextFields);
      setBlinded(request.blinded);
      setBlindFactor(request.blindFactor);
      setStatus(
        "Blinded request created. The issuer signs this blob without seeing the payload.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function signAsIssuer() {
    if (blinded === null) return;
    setError(null);
    setSignedBlinded(signBlinded(blinded));
    setStatus("Issuer signed the blinded value. Only the holder can unblind it.");
  }

  function finalize() {
    if (!fields || signedBlinded === null || blindFactor === null) return;
    setError(null);
    try {
      const nextToken = finalizeToken(fields, signedBlinded, blindFactor);
      if (!verifyTokenOffline(nextToken)) {
        setError("Signature verification failed.");
        return;
      }
      setToken(nextToken);
      saveBlindToken(nextToken);
      setActivePaymaster(paymaster);
      setStatus(
        "Token verified and saved. The session wallet can redeem it once for this epoch.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Badge variant="outline">Privacy · blind token issuer</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Session-bound blind tokens
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The paymaster never learns the beneficiary. The company blind-signs a
          token; the user unblinds it and redeems it once, bound to the rotating
          session key and a persistent nullifier.
        </p>
      </div>

      <Alert variant="warning" title="Demo trust boundary">
        This page runs the issuer and the holder in one browser to demonstrate
        the protocol. In production the company backend holds the RSA private
        key and only ever sees the blinded value; the user's browser blinds and
        unblinds.
      </Alert>

      {error ? (
        <Alert variant="error" title="Token flow failed">
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="info" title="Status">
          {status}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Holder
            </CardTitle>
            <CardDescription>
              The session key the token is bound to.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-background/50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Session address
              </div>
              <div
                className="mt-1 break-all font-mono text-xs"
                data-testid="blind-session"
              >
                {session?.address ?? "generating…"}
              </div>
            </div>
            <Field
              label="Paymaster"
              hint="BlindTokenPaymaster"
              htmlFor="blind-paymaster"
            >
              <Input
                id="blind-paymaster"
                value={paymaster}
                onChange={(e) => setPaymaster(e.target.value.trim())}
                placeholder="0x…"
                className="font-mono text-xs"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Epoch" htmlFor="blind-epoch">
                <Input
                  id="blind-epoch"
                  value={epoch}
                  onChange={(e) => setEpoch(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Max cost (ETH)" htmlFor="blind-maxcost">
                <Input
                  id="blind-maxcost"
                  value={maxCostEth}
                  onChange={(e) => setMaxCostEth(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <Button
              className="w-full"
              onClick={createRequest}
              disabled={!session || !!fields}
              data-testid="blind-create"
            >
              <EyeOff className="h-4 w-4" /> Create blind request
            </Button>
            {blinded !== null ? (
              <div
                className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs"
                data-testid="blind-blinded"
              >
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Blinded message
                </div>
                <div className="mt-1 break-all font-mono">
                  0x{blinded.toString(16)}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Issuer
            </CardTitle>
            <CardDescription>
              Sign the blinded blob; never see the payload.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full"
              variant="secondary"
              onClick={signAsIssuer}
              disabled={blinded === null || signedBlinded !== null}
              data-testid="blind-sign"
            >
              Sign as issuer (demo)
            </Button>
            {signedBlinded !== null ? (
              <div
                className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs"
                data-testid="blind-signed"
              >
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Blind signature
                </div>
                <div className="mt-1 break-all font-mono">
                  0x{signedBlinded.toString(16)}
                </div>
              </div>
            ) : null}
            <Button
              className="w-full"
              onClick={finalize}
              disabled={signedBlinded === null}
              data-testid="blind-finalize"
            >
              <CheckCircle2 className="h-4 w-4" /> Unblind &amp; save token
            </Button>
            {token ? (
              <div
                className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs"
                data-testid="blind-token"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="success">verified</Badge>
                  <span className="font-mono text-muted-foreground">
                    serial {shortAddress(token.serial, 6)}
                  </span>
                </div>
                <div
                  className="break-all font-mono"
                  data-testid="blind-signature"
                >
                  {token.signature}
                </div>
                <Button asChild size="sm" variant="outline" className="w-full">
                  <Link href="/pay">
                    Use it on the pay page <ArrowRight className="h-4 w-4" />
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
