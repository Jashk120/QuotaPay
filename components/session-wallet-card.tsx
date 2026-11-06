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
    <Card className="border-primary/30 bg-primary/[0.04]">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Embedded EIP-8141 wallet</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
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
