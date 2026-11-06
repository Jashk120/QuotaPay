"use client";

import { useEffect, useState } from "react";
import { isAddress, parseEther, type Address } from "viem";
import { CheckCircle2, EyeOff } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/**
 * Holder-side blind issuance. Reused inline on /pay (the default flow) and on
 * /blind (standalone issuer demo).
 */
export function BlindTokenIssuer({
  onIssued,
}: {
  onIssued?: (token: BlindToken) => void;
}) {
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
      onIssued?.(nextToken);
      setStatus(
        "Token verified and saved. The session wallet can redeem it once for this epoch.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
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

      <div className="grid gap-4 sm:grid-cols-3">
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

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={createRequest}
          disabled={!session || !!fields}
          data-testid="blind-create"
        >
          <EyeOff className="h-4 w-4" /> Create blind request
        </Button>
        <Button
          variant="secondary"
          onClick={signAsIssuer}
          disabled={blinded === null || signedBlinded !== null}
          data-testid="blind-sign"
        >
          Sign as issuer (demo)
        </Button>
        <Button
          onClick={finalize}
          disabled={signedBlinded === null}
          data-testid="blind-finalize"
        >
          <CheckCircle2 className="h-4 w-4" /> Unblind &amp; save
        </Button>
      </div>

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
        </div>
      ) : null}

      {status ? (
        <p className="text-xs text-muted-foreground">{status}</p>
      ) : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
    </div>
  );
}
