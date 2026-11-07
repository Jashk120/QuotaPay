"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatEther,
  formatUnits,
  isAddress,
  parseEther,
  parseUnits,
  toFunctionSelector,
  type Address,
} from "viem";
import { useWriteContract } from "wagmi";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Wallet } from "lucide-react";
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
import { agentAccountAbi, mockUsdcAbi } from "@/lib/daoAbis.mjs";
import { config } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import { shortHash } from "@/lib/dao/hash";
import type { DaoState } from "@/lib/dao/types";
import { useConnectedWallet } from "@/lib/wallet";

/**
 * The agent account is a real account: it can hold ETH, USDC and any ERC20.
 * ETH in this account is also the self-funded gas path — the agent pays for its
 * own frame transactions once the balance is above the server's threshold.
 */
export function AgentWalletCard({ state }: { state: DaoState }) {
  const { address: wallet, connect } = useConnectedWallet();
  const { writeContractAsync } = useWriteContract();

  const agent = state.config.agentAddress;
  const token =
    config.usdcAddress && isAddress(config.usdcAddress)
      ? (config.usdcAddress as Address)
      : null;

  const [eth, setEth] = useState<bigint | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [supportsWallet, setSupportsWallet] = useState<boolean | null>(null);
  const [ethAmount, setEthAmount] = useState("0.01");
  const [tokenAmount, setTokenAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin =
    Boolean(wallet) &&
    Boolean(state.config.adminAddress) &&
    wallet!.toLowerCase() === state.config.adminAddress.toLowerCase();

  const refresh = useCallback(async () => {
    if (!agent || !isAddress(agent)) return;
    try {
      const [nextEth, nextUsdc, code] = await Promise.all([
        publicClient.getBalance({ address: agent as Address }),
        token
          ? publicClient.readContract({
              address: token,
              abi: mockUsdcAbi,
              functionName: "balanceOf",
              args: [agent as Address],
            })
          : Promise.resolve(0n),
        publicClient.getBytecode({ address: agent as Address }),
      ]);
      setEth(nextEth);
      setUsdc(nextUsdc);
      // Old AgentAccounts have no deposit()/withdraw() selectors in their
      // dispatcher. There is no proxy, so those DAOs need a redeploy.
      const depositSelector = toFunctionSelector("deposit()").slice(2);
      setSupportsWallet(
        Boolean(code && code.toLowerCase().includes(depositSelector)),
      );
    } catch {
      /* the agent may not exist yet */
    }
  }, [agent, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: "deposit" | "withdraw" | "withdrawToken") {
    setError(null);
    if (!agent || !isAddress(agent)) {
      setError("The agent account is not available yet.");
      return;
    }
    if (!wallet) {
      connect();
      return;
    }
    if (action !== "deposit" && !isAdmin) {
      setError("Only the DAO admin can withdraw from the agent account.");
      return;
    }
    setBusy(action);
    try {
      const hash =
        action === "deposit"
          ? await writeContractAsync({
              address: agent as Address,
              abi: agentAccountAbi,
              functionName: "deposit",
              value: parseEther(ethAmount || "0"),
            })
          : action === "withdraw"
            ? await writeContractAsync({
                address: agent as Address,
                abi: agentAccountAbi,
                functionName: "withdraw",
                args: [wallet, parseEther(ethAmount || "0")],
              })
            : token
              ? await writeContractAsync({
                  address: agent as Address,
                  abi: agentAccountAbi,
                  functionName: "withdrawToken",
                  args: [
                    token,
                    wallet,
                    parseUnits(tokenAmount || "0", config.usdcDecimals),
                  ],
                })
              : (() => {
                  throw new Error("No USDC token is configured.");
                })();
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-white via-white to-[hsl(46_70%_97%)]">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-amber-700" /> Agent wallet
          </CardTitle>
          <CardDescription>
            The agent can hold ETH, USDC and any ERC20. ETH here also pays its
            own gas once it clears the server threshold.
          </CardDescription>
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] text-muted-foreground">
            {agent && isAddress(agent) ? shortHash(agent, 8, 6) : "no agent"}
          </div>
          {isAdmin ? (
            <Badge variant="success" className="mt-1 text-[10px]">
              admin
            </Badge>
          ) : (
            <Badge variant="outline" className="mt-1 text-[10px]">
              read only
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-white/70 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              ETH
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight">
              {eth === null ? "—" : Number(formatEther(eth)).toFixed(6)}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-white/70 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              USDC
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight">
              {usdc === null
                ? "—"
                : Number(formatUnits(usdc, config.usdcDecimals)).toLocaleString(
                    "en-US",
                    { maximumFractionDigits: 2 },
                  )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="ETH amount" htmlFor="agent-eth-amount">
            <Input
              id="agent-eth-amount"
              value={ethAmount}
              onChange={(event) => setEthAmount(event.target.value)}
              inputMode="decimal"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void run("deposit")}
              disabled={busy !== null || supportsWallet === false}
            >
              {busy === "deposit" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
              Deposit ETH
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void run("withdraw")}
              disabled={busy !== null || !isAdmin || supportsWallet === false}
            >
              {busy === "withdraw" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpFromLine className="h-3.5 w-3.5" />
              )}
              Withdraw
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="USDC amount" htmlFor="agent-usdc-amount">
            <Input
              id="agent-usdc-amount"
              value={tokenAmount}
              onChange={(event) => setTokenAmount(event.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run("withdrawToken")}
            disabled={busy !== null || !isAdmin || !token || supportsWallet === false}
          >
            {busy === "withdrawToken" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUpFromLine className="h-3.5 w-3.5" />
            )}
            Withdraw USDC
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Any ERC20 can be sent to the agent address. Only the DAO admin (or
          governance) can withdraw it. No `receive()` is used, so deposits go
          through `deposit()`.
        </p>

        {supportsWallet === false ? (
          <Alert variant="warning" title="Wallet support not deployed">
            This DAO’s <span className="font-mono">AgentAccount</span> was
            deployed before ETH/ERC20 custody existed. It has no proxy, so it
            cannot receive deposits. Create a new DAO with the updated factory to
            get a wallet-enabled agent.
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="error" title="Agent wallet">
            {error}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
