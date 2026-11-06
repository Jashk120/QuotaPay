"use client";

import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
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
import { config } from "@/lib/config";
import { useAnonRpc } from "@/lib/anonRpc";
import {
  loadZkCredential,
  saveZkCredential,
} from "@/lib/zk/credentialStore";
import type { ZkCredential } from "@/lib/zk/client";
import { useSessionKey } from "@/lib/wallet";

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
          Prove eligibility, not identity
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          This builds a four-frame EIP-8141 transaction with a Groth16
          membership proof, signs it with a local session key, and submits it
          to the EIP-8141 RPC. The beneficiary holds 0 ETH; the company
          paymaster pays. The paymaster learns a rotating session key and a
          nullifier — never which employee is paying.
        </p>
      </div>

      {!config.zkPaymaster ? (
        <Alert variant="info" title="No default ZK paymaster configured">
          Set <span className="font-mono">NEXT_PUBLIC_ZK_PAYMASTER</span> after{" "}
          <span className="font-mono">npm run zk:deploy</span>, or paste a
          credential whose <span className="font-mono">paymaster</span> field
          points at a deployed <span className="font-mono">ZkPaymaster</span>.
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard
          icon={<KeyRound className="h-4 w-4 text-primary" />}
          title="Session key"
          body={session?.address ?? "generating…"}
        />
        <InfoCard
          icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          title="Proof system"
          body="Groth16 / BN254, 7 public inputs, ~256k verifier gas"
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

      <Card>
        <CardHeader>
          <CardTitle>Setup</CardTitle>
          <CardDescription>
            The proof assets are generated locally and are gitignored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-mono text-foreground">npm run zk:setup</span>{" "}
            compiles the circuit, builds the devnet zkey, and exports the
            verifier.
          </p>
          <p>
            <span className="font-mono text-foreground">npm run zk:deploy</span>{" "}
            deploys the verifier + paymaster, sets the root, and stakes.
          </p>
          <p>
            <span className="font-mono text-foreground">npm run zk:publish</span>{" "}
            copies the wasm/zkey to <span className="font-mono">public/zk</span>{" "}
            and writes the demo credential.
          </p>
          <p>
            The CLI equivalent is{" "}
            <span className="font-mono text-foreground">npm run zk:sponsor</span>.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Session rotation:</span>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border/60 px-2 py-1 text-foreground transition-colors hover:bg-accent"
        >
          generate a new session key
        </button>
        <span>(the old credential will no longer match the new sender)</span>
      </div>
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
