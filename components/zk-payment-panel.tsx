"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  parseEther,
  parseGwei,
  type Address,
  type Hex,
} from "viem";
import {
  CheckCircle2,
  Fuel,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Sparkles,
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
import { zkPaymasterAbi } from "@/lib/abis";
import { useAnonRpc } from "@/lib/anonRpc";
import { config } from "@/lib/config";
import { makePublicClient } from "@/lib/contracts";
import {
  buildSponsoredTransfer,
  getReceipt,
  sendFrameSponsoredTransfer,
  sendRawSponsoredTransfer,
  serializeSponsoredTransfer,
  signSponsoredTransfer,
  sponsoredTransferHash,
  type SignedEnvelope,
} from "@/lib/frameTx";
import {
  ZK_CHARGE_EXECUTION_GAS,
  ZK_CHARGE_STATE_GAS,
  buildZkWitness,
  expectedPublicSignals,
  proveZkMembership,
  samePublicSignals,
  type ZkCredential,
  type ZkProof,
  type ZkWitness,
} from "@/lib/zk/client";
import { shortAddress } from "@/lib/utils";

type Receipt = Awaited<ReturnType<typeof getReceipt>>;

function addressFromField(value: string): Address {
  return getAddress(`0x${BigInt(value).toString(16).padStart(40, "0")}`);
}

export function ZkPaymentPanel({
  session,
  credential,
  onResetSession,
}: {
  session: { privateKey: Hex; address: Address } | null;
  credential: ZkCredential | null;
  onResetSession: () => void;
}) {
  const { fetch: anonFetch } = useAnonRpc();

  const paymaster = useMemo<Address | null>(() => {
    const value = credential?.paymaster ?? config.zkPaymaster;
    return value && isAddress(value) ? (value as Address) : null;
  }, [credential]);

  const [root, setRoot] = useState<bigint | null>(null);
  const [epoch, setEpoch] = useState<bigint | null>(null);
  const [maxSponsorCost, setMaxSponsorCost] = useState<bigint | null>(null);
  const [used, setUsed] = useState<boolean | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);

  const [to, setTo] = useState("");
  const [amountEth, setAmountEth] = useState("0");
  const [nonce, setNonce] = useState("0");
  const [maxFeeGwei, setMaxFeeGwei] = useState("2");

  const [witness, setWitness] = useState<ZkWitness | null>(null);
  const [proof, setProof] = useState<ZkProof | null>(null);
  const [signed, setSigned] = useState<SignedEnvelope | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [receipt, setReceipt] = useState<Receipt>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const client = useMemo(() => makePublicClient(anonFetch), [anonFetch]);

  const refreshState = useCallback(async () => {
    if (!paymaster) {
      setRoot(null);
      setEpoch(null);
      setMaxSponsorCost(null);
      return;
    }
    setStateError(null);
    try {
      const [r, e, m] = await Promise.all([
        client.readContract({
          address: paymaster,
          abi: zkPaymasterAbi,
          functionName: "root",
        }),
        client.readContract({
          address: paymaster,
          abi: zkPaymasterAbi,
          functionName: "epoch",
        }),
        client.readContract({
          address: paymaster,
          abi: zkPaymasterAbi,
          functionName: "maxSponsorCost",
        }),
      ]);
      setRoot(r);
      setEpoch(e);
      setMaxSponsorCost(m);
    } catch (e) {
      setStateError(e instanceof Error ? e.message : String(e));
    }
  }, [client, paymaster]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    client
      .getTransactionCount({ address: session.address, blockTag: "pending" })
      .then((n) => {
        if (!cancelled) setNonce(String(n));
      })
      .catch(() => {
        /* keep manual nonce */
      });
    return () => {
      cancelled = true;
    };
  }, [client, session]);

  useEffect(() => {
    setWitness(null);
    setProof(null);
    setSigned(null);
    setTxHash(null);
    setReceipt(null);
    setStatus(null);
    setError(null);
    setUsed(null);
  }, [credential, session?.address]);

  async function prove() {
    setError(null);
    setStatus(null);
    setProof(null);
    setSigned(null);
    setTxHash(null);
    setReceipt(null);
    if (!session) {
      setError("Session key is still loading.");
      return;
    }
    if (!credential || !paymaster) {
      setError("Load a ZK credential first (Step 1).");
      return;
    }
    setBusy(true);
    setStatus("Generating the Groth16 proof in this browser…");
    try {
      const next = buildZkWitness(credential, session.address);

      // The proof itself needs no chain access. Preflight when the RPC is
      // reachable, but still let the user generate/inspect an offline proof.
      let liveRoot: bigint | null = null;
      let liveEpoch: bigint | null = null;
      try {
        [liveRoot, liveEpoch] = await Promise.all([
          client.readContract({
            address: paymaster,
            abi: zkPaymasterAbi,
            functionName: "root",
          }),
          client.readContract({
            address: paymaster,
            abi: zkPaymasterAbi,
            functionName: "epoch",
          }),
        ]);
      } catch {
        setStatus("Contract preflight unavailable; generating the proof offline.");
      }
      if (liveRoot !== null && BigInt(next.root) !== liveRoot) {
        throw new Error(
          "Credential root does not match the paymaster's current root. Ask the admin for an updated Merkle path.",
        );
      }
      if (liveEpoch !== null && BigInt(next.epoch) !== liveEpoch) {
        throw new Error(
          "Credential epoch does not match the paymaster's current epoch. The admin rotated it; request a fresh credential.",
        );
      }
      if (liveRoot !== null) {
        try {
          const alreadyUsed = await client.readContract({
            address: paymaster,
            abi: zkPaymasterAbi,
            functionName: "usedNullifier",
            args: [BigInt(next.identityNullifier)],
          });
          setUsed(alreadyUsed);
          if (alreadyUsed) {
            throw new Error(
              "This credential's identity nullifier is already spent in this epoch. Rotate the epoch or issue a new credential.",
            );
          }
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.includes("identity nullifier is already spent")
          ) {
            throw e;
          }
        }
      }

      const nextProof = await proveZkMembership(
        next,
        `${config.zkAssetsBase}/Membership.wasm`,
        `${config.zkAssetsBase}/Membership_final.zkey`,
      );
      if (!samePublicSignals(nextProof.publicSignals, expectedPublicSignals(next))) {
        throw new Error(
          "Proof public signals do not match the credential. Regenerate the credential/path.",
        );
      }
      setWitness(next);
      setProof(nextProof);
      setStatus("Proof generated. The secret never left this tab.");
    } catch (e) {
      setStatus(null);
      setError(
        e instanceof Error
          ? `${e.message}\n\nIf the prover assets are missing, run "npm run zk:publish".`
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  function build() {
    setError(null);
    setStatus(null);
    setSigned(null);
    setTxHash(null);
    setReceipt(null);
    if (!session || !witness || !proof || !paymaster) {
      setError("Generate a proof first.");
      return;
    }
    if (!isAddress(to)) {
      setError("Recipient must be a valid address.");
      return;
    }
    try {
      const value = parseEther(amountEth || "0");
      const maxFee = parseGwei(maxFeeGwei || "2");
      const chargeData = encodeFunctionData({
        abi: zkPaymasterAbi,
        functionName: "charge",
        args: [
          [BigInt(proof.a[0]), BigInt(proof.a[1])],
          [
            [BigInt(proof.b[0][0]), BigInt(proof.b[0][1])],
            [BigInt(proof.b[1][0]), BigInt(proof.b[1][1])],
          ],
          [BigInt(proof.c[0]), BigInt(proof.c[1])],
          BigInt(witness.identityNullifier),
          BigInt(witness.sessionNullifier),
        ],
      });
      const envelope = buildSponsoredTransfer({
        sender: session.address,
        paymaster: addressFromField(witness.paymaster),
        to: to as Address,
        value,
        nonce: BigInt(nonce || "0"),
        chainId: config.chainId,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: maxFee,
        chargeData,
        chargeExecutionGas: ZK_CHARGE_EXECUTION_GAS,
        chargeStateGas: ZK_CHARGE_STATE_GAS,
      });
      const nextSigned = signSponsoredTransfer(envelope, session.privateKey);
      setSigned(nextSigned);
      setTxHash(sponsoredTransferHash(nextSigned));
      setStatus("Transaction built and signed locally.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    if (!signed) return;
    if (!config.submitEnabled) {
      setError(
        "Submission is disabled. Set NEXT_PUBLIC_ENABLE_SUBMIT=true and a live EIP-8141 RPC.",
      );
      return;
    }
    if (!session) return;
    if (parseEther(amountEth || "0") > 0n) {
      const balance = await client.getBalance({ address: session.address });
      if (balance < parseEther(amountEth || "0")) {
        setError(
          "The frame value is debited from tx.sender (EIP-8141). This 0-ETH session key cannot transfer value; the paymaster sponsors gas only.",
        );
        return;
      }
    }
    setBusy(true);
    setError(null);
    setStatus("Submitting to the EIP-8141 RPC…");
    try {
      let hash: Hex;
      try {
        hash = await sendFrameSponsoredTransfer(config.rpcUrl, signed, anonFetch);
        setStatus("Accepted by eth_sendFrameTransaction.");
      } catch (frameError) {
        setStatus("Frame RPC rejected it; trying the raw encoding on the gateway…");
        try {
          hash = await sendRawSponsoredTransfer(
            config.gatewayUrl,
            signed,
            anonFetch,
          );
          setStatus("Accepted by eth_sendRawTransaction.");
        } catch (rawError) {
          throw new Error(
            `Frame RPC: ${toMessage(frameError)}\nRaw RPC: ${toMessage(rawError)}`,
          );
        }
      }
      setTxHash(hash);
      let r = await getReceipt(config.rpcUrl, hash, anonFetch);
      if (!r) {
        setStatus("Pending in the mempool, waiting to be mined…");
        for (let i = 0; i < 20 && !r; i++) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          try {
            r = await getReceipt(config.rpcUrl, hash, anonFetch);
          } catch {
            /* keep polling through transient RPC errors */
          }
        }
      }
      setReceipt(r);
      setStatus(r ? "Mined." : "Pending in the mempool.");
      await refreshState();
      const n = await client.getTransactionCount({
        address: session.address,
        blockTag: "pending",
      });
      setNonce(String(n));
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rootMatches =
    credential && root !== null ? BigInt(credential.root) === root : null;
  const epochMatches =
    credential && epoch !== null ? BigInt(credential.epoch) === epoch : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Step 2 · Prove and pay
          {proof ? <Badge variant="success">proof ready</Badge> : null}
        </CardTitle>
        <CardDescription>
          The paymaster verifies the proof on-chain, burns the identity
          nullifier, and pays the gas. Recipient/amount stay public.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 rounded-lg border border-border/60 bg-background/40 p-3 text-xs sm:grid-cols-2">
          <StateRow label="Paymaster" value={paymaster ?? "not configured"} />
          <StateRow
            label="Contract root"
            value={root !== null ? shortAddress(root.toString(), 10) : "—"}
            ok={rootMatches}
          />
          <StateRow
            label="Contract epoch"
            value={epoch !== null ? epoch.toString() : "—"}
            ok={epochMatches}
          />
          <StateRow
            label="Max sponsor cost"
            value={maxSponsorCost !== null ? `${maxSponsorCost} wei` : "—"}
          />
          <StateRow
            label="Identity nullifier spent"
            value={used === null ? "—" : used ? "yes" : "no"}
            ok={used === null ? null : !used}
          />
        </div>

        {stateError ? <Alert variant="error">{stateError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Recipient" htmlFor="zk-to" hint="0x…">
            <Input
              id="zk-to"
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x…"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="Amount (ETH)"
            htmlFor="zk-amount"
            hint="from tx.sender"
          >
            <Input
              id="zk-amount"
              value={amountEth}
              onChange={(e) => setAmountEth(e.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field label="Nonce" htmlFor="zk-nonce" hint="session account nonce">
            <Input
              id="zk-nonce"
              value={nonce}
              onChange={(e) => setNonce(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Max fee (gwei)" htmlFor="zk-fee">
            <Input
              id="zk-fee"
              value={maxFeeGwei}
              onChange={(e) => setMaxFeeGwei(e.target.value)}
              inputMode="decimal"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void prove()}
            disabled={!session || !credential || !paymaster || busy}
            data-testid="zk-prove"
          >
            {busy && !proof ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate proof
          </Button>
          <Button
            variant="secondary"
            onClick={build}
            disabled={!proof || busy}
            data-testid="zk-build"
          >
            <ShieldCheck className="h-4 w-4" /> Build &amp; sign
          </Button>
          <Button
            variant="secondary"
            onClick={() => void send()}
            disabled={!signed || busy}
            data-testid="zk-submit"
          >
            {busy && signed ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Fuel className="h-4 w-4" />
            )}
            Submit sponsored tx
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refreshState()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={onResetSession}>
            New session key
          </Button>
        </div>

        {status ? <Alert variant="info">{status}</Alert> : null}
        {error ? (
          <Alert variant="error" title="ZK payment failed">
            <div className="whitespace-pre-wrap break-words">{error}</div>
          </Alert>
        ) : null}

        {proof ? (
          <div
            data-testid="zk-proof"
            className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">
                <CheckCircle2 className="mr-1 h-3 w-3" /> proof verified off-chain
              </Badge>
              <span className="font-mono text-muted-foreground">
                identity {shortAddress(witness?.identityNullifier ?? "", 8)}
              </span>
              <span className="font-mono text-muted-foreground">
                session {shortAddress(witness?.sessionNullifier ?? "", 8)}
              </span>
            </div>
          </div>
        ) : null}

        {signed ? (
          <div
            data-testid="zk-signed"
            className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3 text-xs"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono">
                {signed.frames.length} frames
              </Badge>
              <span className="text-muted-foreground">
                {serializedSize(signed)} bytes · {shortAddress(txHash ?? "", 10)}
              </span>
            </div>
            {signed.frames.map((frame, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 text-muted-foreground"
              >
                <span className="font-mono">#{index}</span>
                <span>mode {String(frame.mode)}</span>
                <span>flags {String(frame.flags)}</span>
                <span>
                  exec {String(frame.executionGas ?? 0n)} · state{" "}
                  {String(frame.stateGas ?? 0n)}
                </span>
                <span className="ml-auto font-mono">
                  {frame.to ? shortAddress(frame.to, 6) : "sender"}
                </span>
              </div>
            ))}
            {receipt ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant="success">mined</Badge>
                <span>block {receipt.blockNumber ?? "—"}</span>
                <span>
                  payer {receipt.payer ? shortAddress(receipt.payer, 6) : "—"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <Alert variant="warning" title="What is hidden, what is not">
          The paymaster learns the session key, root, epoch, and nullifiers, not
          which authorized employee owns the credential. The recipient and value
          are public in the SENDER frame. One credential sponsors one
          transaction per epoch; incrementing the epoch invalidates it.
        </Alert>
        {!config.submitEnabled ? (
          <Alert variant="warning" title="Submission disabled">
            Set <span className="font-mono">NEXT_PUBLIC_ENABLE_SUBMIT=true</span>{" "}
            to broadcast. You can still generate the proof and inspect the signed
            frame.
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StateRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean | null;
}) {
  return (
    <div className="flex items-center gap-2">
      {ok === null || ok === undefined ? null : ok ? (
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <ShieldX className="h-3.5 w-3.5 text-red-400" />
      )}
      <span className="text-muted-foreground">{label}:</span>
      <span className="break-all font-mono">{value}</span>
    </div>
  );
}

function serializedSize(tx: SignedEnvelope) {
  try {
    return (serializeSponsoredTransfer(tx).length - 2) / 2;
  } catch {
    return 0;
  }
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
