"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ZkCredentialForm } from "@/components/zk-credential-form";
import { ZkPaymentPanel } from "@/components/zk-payment-panel";
import { SessionWalletCard } from "@/components/session-wallet-card";
import { config } from "@/lib/config";
import { useAnonRpc } from "@/lib/anonRpc";
import {
  loadZkCredential,
  saveZkCredential,
} from "@/lib/zk/credentialStore";
import type { ZkCredential } from "@/lib/zk/client";
import { useSessionKey } from "@/lib/wallet";
import { cn } from "@/lib/utils";

const flowSteps = [
  { n: "1", label: "Load credential" },
  { n: "2", label: "Prove" },
  { n: "3", label: "Submit" },
];

export default function PayPage() {
  const { session, reset } = useSessionKey();
  const { mode: anonMode } = useAnonRpc();
  const [credential, setCredential] = useState<ZkCredential | null>(null);

  useEffect(() => {
    setCredential(loadZkCredential());
  }, []);

  function updateCredential(next: ZkCredential | null) {
    setCredential(next);
    if (next) saveZkCredential(next);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <Badge variant="outline">Beneficiary · sponsored payment</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          Pay with 0 ETH — prove you&apos;re eligible
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Load the credential your company gave you, generate a private proof in
          this tab, then submit one sponsored transaction. The company paymaster
          covers the gas; you hold 0 ETH the whole way.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {flowSteps.map((step, index) => {
          const done = index === 0 && credential !== null;
          return (
            <div key={step.n} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  done
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : step.n}
              </div>
              <span
                className={cn(
                  "hidden text-xs sm:block",
                  done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
              {index < flowSteps.length - 1 ? (
                <div className="h-px flex-1 bg-border/70" />
              ) : null}
            </div>
          );
        })}
      </div>

      {!config.zkPaymaster ? (
        <Alert variant="info" title="No default ZK paymaster configured">
          Set <span className="font-mono">NEXT_PUBLIC_ZK_PAYMASTER</span> after{" "}
          <span className="font-mono">npm run zk:deploy</span>, or paste a
          credential whose <span className="font-mono">paymaster</span> field
          points at a deployed <span className="font-mono">ZkPaymaster</span>.
        </Alert>
      ) : null}

      <SessionWalletCard session={session} onReset={reset} />

      <div className="grid gap-3 md:grid-cols-2">
        <InfoCard
          icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          title="Proof system"
          body="Groth16 / BN254 · verifies on-chain"
        />
        <InfoCard
          icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          title="Transport"
          body={
            anonMode === "anonymous"
              ? "anon-rpc (anonymous)"
              : anonMode === "direct"
                ? "direct RPC (privacy off)"
                : `anon-rpc (${anonMode})`
          }
        />
      </div>

      <ZkCredentialForm
        credential={credential}
        sessionAddress={session?.address ?? null}
        onCredential={updateCredential}
      />

      <ZkPaymentPanel
        session={session}
        credential={credential}
        onResetSession={reset}
      />

      <details className="group">
        <summary className="cursor-pointer list-none text-sm text-muted-foreground transition-colors [&::-webkit-details-marker]:hidden hover:text-foreground">
          Setup &amp; deploy commands (admins)
        </summary>
        <Card className="mt-3">
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>
              The proof assets are generated locally and are gitignored.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <span className="font-mono text-foreground">
                npm run zk:setup
              </span>{" "}
              compiles the circuit, builds the devnet zkey, and exports the
              verifier.
            </p>
            <p>
              <span className="font-mono text-foreground">
                npm run zk:deploy
              </span>{" "}
              deploys the verifier + paymaster, sets the root, and stakes.
            </p>
            <p>
              <span className="font-mono text-foreground">
                npm run zk:publish
              </span>{" "}
              copies the wasm/zkey to <span className="font-mono">public/zk</span>{" "}
              and writes the demo credential.
            </p>
            <p>
              The CLI equivalent is{" "}
              <span className="font-mono text-foreground">npm run zk:sponsor</span>.
            </p>
          </CardContent>
        </Card>
      </details>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="mt-0.5">{icon}</div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {title}
          </div>
          <div className="mt-1 break-all font-mono text-xs">{body}</div>
        </div>
      </CardContent>
    </Card>
  );
}
