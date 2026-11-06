"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownUp,
  Coins,
  Gauge,
  Loader2,
  Sparkles,
  Wallet,
} from "lucide-react";
import { formatUnits, parseEther, parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { money, percent, utcDateTime } from "@/lib/dao/format";
import { TierBadge } from "@/components/dao/tier-badge";
import { config } from "@/lib/config";
import { publicClient } from "@/lib/contracts";
import { mockUsdcAbi, treasuryFundHelperAbi } from "@/lib/daoAbis.mjs";
import { useConnectedWallet } from "@/lib/wallet";
import type { DaoState } from "@/lib/dao/types";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export function TreasuryPanel({
  state,
  onFunded,
}: {
  state: DaoState;
  onFunded?: () => void;
}) {
  const used = state.capUsage.periodSpent;
  const cap = state.config.perPeriodCap;
  const usage = percent(used, cap);
  const payouts = state.events.filter((event) => event.action === "pay");

  const { address, connect } = useConnectedWallet();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("5000");
  const [ethAmount, setEthAmount] = useState("0.05");
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const dao = state.config.coreAddress as `0x${string}`;
  const isAdmin =
    Boolean(address) &&
    address!.toLowerCase() === state.config.adminAddress.toLowerCase();
  const decimals = config.usdcDecimals;

  useEffect(() => {
    let cancelled = false;
    if (!address || !config.usdcAddress) {
      setWalletUsdc(null);
      return;
    }
    publicClient
      .readContract({
        address: config.usdcAddress,
        abi: mockUsdcAbi,
        functionName: "balanceOf",
        args: [address],
      })
      .then((balance) => {
        if (!cancelled) setWalletUsdc(balance);
      })
      .catch(() => {
        if (!cancelled) setWalletUsdc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, state.config.treasuryUsdc]);

  async function mintTestUsdc() {
    if (!config.usdcAddress) {
      setNote("NEXT_PUBLIC_USDC_ADDRESS is not configured.");
      return;
    }
    setBusy("mint");
    setNote(null);
    try {
      const value = parseUnits(amount || "0", decimals);
      const hash = await writeContractAsync({
        address: config.usdcAddress,
        abi: mockUsdcAbi,
        functionName: "mint",
        args: [dao, value],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote(
        `Minted ${amount} test USDC to the DAO (devnet faucet; not real value).`,
      );
      onFunded?.();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function depositUsdc() {
    if (!config.usdcAddress) {
      setNote("NEXT_PUBLIC_USDC_ADDRESS is not configured.");
      return;
    }
    setBusy("deposit");
    setNote(null);
    try {
      const value = parseUnits(amount || "0", decimals);
      if (walletUsdc !== null && walletUsdc < value) {
        setNote(
          `Your wallet has ${money(Number(formatUnits(walletUsdc, decimals)))} USDC; deposit a smaller amount or mint test USDC.`,
        );
        return;
      }
      const hash = await writeContractAsync({
        address: config.usdcAddress,
        abi: mockUsdcAbi,
        functionName: "transfer",
        args: [dao, value],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote(`Deposited ${amount} USDC from your wallet.`);
      onFunded?.();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function swapEth() {
    if (!config.treasuryFundHelper || !config.usdcAddress) {
      setNote(
        "Uniswap v4 funding is not configured. Run scripts/seed-usdc-pool.mjs, then set NEXT_PUBLIC_TREASURY_FUND_HELPER.",
      );
      return;
    }
    setBusy("swap");
    setNote(null);
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const hash = await writeContractAsync({
        address: config.treasuryFundHelper,
        abi: treasuryFundHelperAbi,
        functionName: "fund",
        args: [
          {
            currency0: ZERO,
            currency1: config.usdcAddress,
            fee: config.usdcPoolFee,
            tickSpacing: config.usdcPoolTickSpacing,
            hooks: config.usdcPoolHooks,
          },
          dao,
          1n,
          deadline,
        ],
        value: parseEther(ethAmount || "0"),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNote(
        `Swapped ${ethAmount} ETH via Uniswap v4; the USDC was sent to the DAO.`,
      );
      onFunded?.();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Fund treasury
          </CardTitle>
          <CardDescription>
            A DAO has no balance until someone funds it. Mint test USDC on the
            devnet faucet, deposit USDC from your wallet, or swap ETH through
            Uniswap v4.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!address ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-white/60 p-3 text-sm">
              <span className="text-muted-foreground">
                Connect the admin wallet to fund this DAO.
              </span>
              <Button size="sm" variant="outline" onClick={connect}>
                Connect wallet
              </Button>
            </div>
          ) : !isAdmin ? (
            <div className="rounded-lg border border-border/70 bg-white/60 p-3 text-sm text-muted-foreground">
              Only the DAO admin ({state.config.adminAddress.slice(0, 6)}…
              {state.config.adminAddress.slice(-4)}) can fund the treasury.
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">Amount (USDC)</span>
                  <Input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">ETH to swap</span>
                  <Input
                    value={ethAmount}
                    onChange={(event) => setEthAmount(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void mintTestUsdc()}
                  disabled={busy !== null}
                >
                  {busy === "mint" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Coins className="h-4 w-4" />
                  )}
                  Mint test USDC
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void depositUsdc()}
                  disabled={busy !== null}
                >
                  {busy === "deposit" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wallet className="h-4 w-4" />
                  )}
                  Deposit USDC
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void swapEth()}
                  disabled={busy !== null}
                  title={
                    config.treasuryFundHelper
                      ? "Swap ETH for USDC via Uniswap v4"
                      : "Run scripts/seed-usdc-pool.mjs to enable the swap"
                  }
                >
                  {busy === "swap" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowDownUp className="h-4 w-4" />
                  )}
                  Swap ETH → USDC
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Wallet USDC:{" "}
                {walletUsdc === null
                  ? "—"
                  : money(Number(formatUnits(walletUsdc, decimals)))}{" "}
                · Minting is a devnet faucet, not real value. The swap uses your
                ETH and sends the USDC straight to the DAO.
              </div>
              {note ? (
                <div className="rounded-lg border border-border/70 bg-white px-3 py-2 text-xs text-muted-foreground">
                  {note}
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          icon={<Wallet className="h-4 w-4" />}
          label="Treasury"
          value={`${money(state.config.treasuryUsdc)} USDC`}
          hint="DAO-owned funds"
        />
        <Stat
          icon={<Gauge className="h-4 w-4" />}
          label="Per-transaction cap"
          value={`${money(state.config.perTxCap)} USDC`}
          hint="above this becomes a vote"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-primary" /> Period spend
          </CardTitle>
          <CardDescription>
            Cumulative caps are re-checked inside DaoCore, not just in VERIFY.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <span className="text-2xl font-semibold tracking-tight">
              {usage}%
            </span>
            <span className="text-xs text-muted-foreground">of the period cap</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[hsl(45_96%_55%)] to-[hsl(36_92%_52%)] shadow-[0_0_12px_hsl(42_90%_50%/0.5)] transition-all"
              style={{ width: `${usage}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Re-checked inside DaoCore</span>
            <Badge variant="outline">
              {cap > used ? "headroom available" : "cap reached"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payouts</CardTitle>
          <CardDescription>
            A payout needs an on-chain recipient. Ask the agent: “pay 10 USDC to
            0x…”. An amount above the per-tx cap becomes a governance proposal.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent payouts</CardTitle>
          <CardDescription>From the DaoCore audit events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {payouts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              No payouts yet.
            </div>
          ) : (
            payouts.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-white px-3 py-2 shadow-[0_1px_2px_hsl(40_30%_20%/0.03)]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{event.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {utcDateTime(event.at)}
                  </div>
                </div>
                <TierBadge tier={event.tier} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="text-primary">{icon}</span>
          {label}
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
