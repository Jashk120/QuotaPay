"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { keccak256, type Hex } from "viem";
import { useSignMessage } from "wagmi";
import { ArrowRight, Fingerprint, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { config } from "@/lib/config";
import { inviteMessage } from "@/lib/dao/inviteMessage";
import { useDaoState } from "@/lib/dao/use-dao";
import { daoLeafHash } from "@/lib/zk/daoVote.mjs";
import { useConnectedWallet } from "@/lib/wallet";

type Invite = {
  code: string;
  dao: string;
  address: string;
  label: string | null;
  commitment: string | null;
  status: "open" | "claimed" | "added";
};

export default function JoinDaoPage() {
  const params = useParams<{ code: string }>();
  const code = typeof params.code === "string" ? params.code : "";
  const { address, isConnected, connect } = useConnectedWallet();
  const { signMessageAsync } = useSignMessage();
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const { state, ready } = useDaoState({ coreAddress: invite?.dao });
  const [status, setStatus] = useState<
    "idle" | "signing" | "claimed" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dao/invites?code=${encodeURIComponent(code)}`)
      .then((res) => res.json())
      .then((json: { invite?: Invite | null }) => {
        if (!cancelled) setInvite(json.invite ?? null);
      })
      .catch(() => {
        if (!cancelled) setInvite(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function claim() {
    if (!invite) return;
    if (!isConnected || !address) {
      connect();
      return;
    }
    if (
      invite.address &&
      address.toLowerCase() !== invite.address.toLowerCase()
    ) {
      setError(`Connect the invited wallet ${invite.address}.`);
      return;
    }
    setStatus("signing");
    setError(null);
    try {
      const message = inviteMessage(invite.dao, invite.code);
      const signature = await signMessageAsync({ message });
      const secret = BigInt(keccak256(signature as Hex));
      const leaf = await daoLeafHash({
        secret,
        dao: BigInt(invite.dao),
        chainId: BigInt(config.chainId),
      });
      const res = await fetch("/api/dao/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "claim",
          code: invite.code,
          message,
          signature,
          commitment: leaf.toString(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "claim failed");
      setStatus("claimed");
      setInvite({ ...invite, status: "claimed" });
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  if (invite === undefined) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading invite…
        </CardContent>
      </Card>
    );
  }

  if (invite === null) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4 p-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            Invite not found
          </h1>
          <p className="text-sm text-muted-foreground">
            This code does not exist or has expired.
          </p>
          <Button asChild variant="outline">
            <Link href="/daos">All DAOs</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const chatHref = `/dao/${invite.dao}/chat`;
  const claimed = invite.status === "claimed" || status === "claimed";
  const added = invite.status === "added";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Invite</Badge>
          <Badge variant="secondary" className="font-mono">
            {invite.code}
          </Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {ready ? `Join ${state.config.name}` : "Join the DAO"}
        </h1>
        <p className="text-sm text-muted-foreground">
          The admin invited{" "}
          <span className="font-mono">{invite.label ?? invite.address}</span>.
        </p>
      </div>

      <Alert variant="info" title="Your secret never leaves this browser">
        Sign the message below. The signature derives a secret, and only the
        Poseidon commitment is sent to the admin. The admin then adds that
        commitment to <span className="font-mono">DaoCore</span>.
      </Alert>

      {added ? (
        <Alert variant="success" title="Already added">
          This membership is already on-chain.
        </Alert>
      ) : claimed ? (
        <Alert variant="success" title="Commitment claimed">
          The admin can now add you on-chain. Your address is the public
          identity; the secret stays here.
        </Alert>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-5">
            {error ? (
              <Alert variant="error" title="Claim failed">
                {error}
              </Alert>
            ) : null}
            <Button
              onClick={() => void claim()}
              disabled={status === "signing"}
              className="w-full"
            >
              {status === "signing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="h-4 w-4" />
              )}
              {isConnected ? "Sign & claim" : "Connect wallet & claim"}
            </Button>
            {isConnected && invite.address ? (
              <p className="text-center text-[11px] text-muted-foreground">
                Invited address:{" "}
                <span className="font-mono">{invite.address}</span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Button asChild variant="outline">
        <Link href={chatHref}>
          Open console <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
