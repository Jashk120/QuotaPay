"use client";

import { useState } from "react";
import { Check, Copy, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SessionKey } from "@/lib/wallet";

/**
 * The beneficiary's embedded EIP-8141 wallet. No external wallet (MetaMask,
 * WalletConnect, …) can sign an EIP-8141 frame transaction yet, so QuotaPay
 * generates a session key in the browser and presents it as a first-class
 * wallet: copy the address for the admin to authorize, or rotate it.
 */
export function SessionWalletCard({
  session,
  onReset,
}: {
  session: SessionKey | null;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const address = session?.address ?? null;

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Card className="border-primary/40 bg-gradient-to-br from-primary/[0.08] via-white to-white">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-b from-[hsl(45_96%_60%)] to-[hsl(42_95%_49%)] ring-1 ring-[hsl(40_80%_55%/0.5)]">
            <Wallet className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Embedded EIP-8141 wallet</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-[10px] font-medium text-yellow-700 ring-1 ring-yellow-600/20">
                <ShieldCheck className="h-3 w-3" /> ready
              </span>
            </div>
            <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {address ?? "generating…"}
            </div>
            <p className="mt-1.5 max-w-md text-xs text-muted-foreground">
              This in-browser key is the transaction sender — no external wallet
              signs EIP-8141 frame transactions yet. Share the address with your
              admin so they can authorize it; rotating it invalidates the old
              credential.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={!address}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="outline" onClick={onReset}>
            <RefreshCw className="h-4 w-4" /> Rotate
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
