"use client";

import { useEffect, useMemo, useState } from "react";
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
import { config } from "@/lib/config";
import { clearZkCredential } from "@/lib/zk/credentialStore";
import {
  computeZkNullifiers,
  parseZkCredentialJson,
  type ZkCredential,
} from "@/lib/zk/client";
import { shortAddress } from "@/lib/utils";

export function ZkCredentialForm({
  credential,
  sessionAddress,
  onCredential,
}: {
  credential: ZkCredential | null;
  sessionAddress: string | null;
  onCredential: (credential: ZkCredential | null) => void;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);

  useEffect(() => {
    setText(credential ? JSON.stringify(credential, null, 2) : "");
  }, [credential]);

  const nullifiers = useMemo(() => {
    if (!credential || !sessionAddress) return null;
    try {
      return computeZkNullifiers({
        secret: credential.secret,
        epoch: credential.epoch,
        sessionKey: sessionAddress,
      });
    } catch {
      return null;
    }
  }, [credential, sessionAddress]);

  function useCredential() {
    setError(null);
    setStatus(null);
    try {
      const next = parseZkCredentialJson(text);
      onCredential(next);
      setStatus("Credential loaded in this browser. The secret is not sent anywhere.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadDemo() {
    setError(null);
    setStatus(null);
    setLoadingDemo(true);
    try {
      const res = await fetch(`${config.zkAssetsBase}/demo-credential.json`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(
          `demo credential not found (${res.status}); run "npm run zk:deploy" then "npm run zk:publish"`,
        );
      }
      const next = parseZkCredentialJson(await res.text());
      onCredential(next);
      setStatus("Demo credential loaded. It is a devnet secret, not for value.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDemo(false);
    }
  }

  function clear() {
    clearZkCredential();
    onCredential(null);
    setText("");
    setStatus(null);
    setError(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Step 1 · ZK credential
          {credential ? <Badge variant="success">loaded</Badge> : null}
        </CardTitle>
        <CardDescription>
          Paste the credential JSON (secret + Merkle path + root) or load the
          devnet demo. The proof is generated in this browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-border/60 bg-background/50 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Session key (bound into the proof)
          </div>
          <div className="mt-1 break-all font-mono text-xs" data-testid="zk-session">
            {sessionAddress ?? "generating…"}
          </div>
          {nullifiers ? (
            <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
              <span>
                identity nullifier:{" "}
                {shortAddress(nullifiers.identityNullifier.toString(), 8)}
              </span>
              <span>
                session nullifier:{" "}
                {shortAddress(nullifiers.sessionNullifier.toString(), 8)}
              </span>
            </div>
          ) : null}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={9}
          placeholder={'{\n  "secret": "…",\n  "root": "…",\n  "epoch": "0",\n  "paymaster": "0x…",\n  "chainId": 1337,\n  "pathElements": ["… 20 entries …"],\n  "pathIndices": [0, 0, …]\n}'}
          className="w-full rounded-lg border border-border/60 bg-background/60 p-3 font-mono text-[11px] text-foreground outline-none ring-offset-background placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="flex flex-wrap gap-2">
          <Button onClick={useCredential} disabled={!text.trim()}>
            Use credential
          </Button>
          <Button variant="secondary" onClick={loadDemo} disabled={loadingDemo}>
            {loadingDemo ? "Loading…" : "Load demo credential"}
          </Button>
          <Button variant="ghost" onClick={clear} disabled={!credential && !text}>
            Clear
          </Button>
        </div>

        {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Alert variant="warning" title="Demo trust boundary">
          The credential secret stays in this tab, but it is stored in
          localStorage for convenience. A production wallet should keep it in a
          secure keystore. The demo credential file is gitignored and contains a
          throwaway devnet secret.
        </Alert>
      </CardContent>
    </Card>
  );
}
