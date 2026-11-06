"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useSignTypedData } from "wagmi";
import { Check, Loader2, PenLine, ShieldAlert, Wallet, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { config, isDaoChainConfigured } from "@/lib/config";
import { shortHash } from "@/lib/dao/hash";
import { useConnectedWallet } from "@/lib/wallet";

export type SignatureRequest = {
  title: string;
  actionType: number;
  paramsHash: `0x${string}`;
  nonce: number;
  expiry: number;
  daoCore: string;
};

export type SignatureResult = {
  signature: `0x${string}`;
  simulated: boolean;
  signer: string;
};

const ACTION_TYPES = {
  Action: [
    { name: "daoCore", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "actionType", type: "uint8" },
    { name: "paramsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export function AdminSignatureDialog({
  request,
  onClose,
  onSigned,
}: {
  request: SignatureRequest | null;
  onClose: () => void;
  onSigned: (result: SignatureResult) => void;
}) {
  const { address, isConnected, connect } = useConnectedWallet();
  const { signTypedDataAsync } = useSignTypedData();
  const [status, setStatus] = useState<"idle" | "signing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setStatus("idle");
    setError(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  if (!request) return null;

  const typedData = {
    domain: {
      name: "DaoCore",
      version: "1",
      chainId: config.chainId,
      verifyingContract: request.daoCore,
    },
    types: ACTION_TYPES,
    primaryType: "Action",
    message: {
      daoCore: request.daoCore,
      chainId: config.chainId,
      actionType: request.actionType,
      paramsHash: request.paramsHash,
      nonce: request.nonce,
      expiry: request.expiry,
    },
  };

  async function signWithWallet() {
    setStatus("signing");
    setError(null);
    try {
      const signature = await signTypedDataAsync({
        domain: {
          name: "DaoCore",
          version: "1",
          chainId: config.chainId,
          verifyingContract: request!.daoCore as Address,
        },
        types: ACTION_TYPES,
        primaryType: "Action",
        message: {
          daoCore: request!.daoCore as Address,
          chainId: BigInt(config.chainId),
          actionType: request!.actionType,
          paramsHash: request!.paramsHash,
          nonce: BigInt(request!.nonce),
          expiry: BigInt(request!.expiry),
        },
      });
      onSigned({
        signature,
        simulated: false,
        signer: address ?? "connected wallet",
      });
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function simulate() {
    onSigned({
      signature: `0x${"11".repeat(65)}`,
      simulated: true,
      signer: address ?? "0x1111111111111111111111111111111111111111",
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[hsl(40_20%_12%/0.28)] p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-title"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto"
        data-testid="signature-dialog"
      >
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <Badge variant="warning">EIP-712 admin approval</Badge>
            <CardTitle id="signature-title" className="pt-1 text-xl">
              {request.title}
            </CardTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close signature dialog"
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The contract recomputes <span className="font-mono">paramsHash</span>{" "}
            from the actual call. A signature for this action cannot authorize a
            different one.
          </p>

          <details className="rounded-xl border border-border/70 bg-secondary/30 p-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Authorization details
            </summary>
            <div className="mt-2 grid gap-2 text-sm">
              <Row label="daoCore" value={shortHash(request.daoCore, 12, 8)} mono />
              <Row label="chainId" value={String(config.chainId)} />
              <Row label="actionType" value={String(request.actionType)} />
              <Row
                label="paramsHash"
                value={shortHash(request.paramsHash, 14, 8)}
                mono
              />
              <Row label="nonce" value={String(request.nonce)} />
              <Row
                label="expiry"
                value={new Date(request.expiry).toISOString().slice(0, 16) + "Z"}
              />
            </div>
            <pre className="mt-3 overflow-x-auto border-t border-border/50 pt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(typedData, null, 2)}
            </pre>
          </details>

          {error ? (
            <Alert variant="error" title="Signature failed">
              {error}
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {isConnected ? (
              <Button
                onClick={() => void signWithWallet()}
                disabled={status === "signing"}
                data-testid="dao-sign-wallet"
              >
                {status === "signing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PenLine className="h-4 w-4" />
                )}
                Sign with {address ? shortHash(address, 6, 4) : "wallet"}
              </Button>
            ) : (
              <Button variant="outline" onClick={connect}>
                <Wallet className="h-4 w-4" /> Connect admin wallet
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={simulate}
              data-testid="dao-simulate-signature"
            >
              <Check className="h-4 w-4" /> Simulate signature (demo)
            </Button>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {isDaoChainConfigured
                ? "DaoCore verifies this signature against its admin key and nonce before the call executes. The simulated option cannot authorize an on-chain write."
                : "Local simulation: the signature is real EIP-712 typed data, but no contract verifies it until NEXT_PUBLIC_DAO_CORE is set."}
            </span>
          </div>
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
