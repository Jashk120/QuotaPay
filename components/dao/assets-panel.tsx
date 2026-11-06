"use client";

import { Boxes, Building2, ShoppingCart, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { money } from "@/lib/dao/format";
import type { DaoState } from "@/lib/dao/types";

export function AssetsPanel({
  state,
  onPrompt,
}: {
  state: DaoState;
  onPrompt: (text: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4 text-primary" /> Asset registry
          </CardTitle>
          <CardDescription>
            Mock RWA / NFT contracts. Acquisitions are one atomic batch and leave
            no residual allowance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.assets.map((asset) => (
            <div
              key={asset.id}
              className="rounded-xl border border-border/70 bg-white p-3 shadow-[0_1px_2px_hsl(40_30%_20%/0.03)]"
              data-testid="dao-asset"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{asset.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {asset.kind}
                    </Badge>
                    <Badge
                      variant={asset.allowlisted ? "success" : "warning"}
                      className="text-[10px]"
                    >
                      {asset.allowlisted ? "allowlisted" : "not allowlisted"}
                    </Badge>
                    {asset.held ? (
                      <Badge variant="default" className="text-[10px]">
                        held
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    price {money(asset.priceUsdc)} USDC
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {!asset.allowlisted ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        onPrompt(`Add ${asset.name} to the allowlist`)
                      }
                    >
                      <Building2 className="h-3.5 w-3.5" /> Propose allowlist
                    </Button>
                  ) : null}
                  {asset.allowlisted && !asset.held ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        onPrompt(`Buy ${asset.name} for ${asset.priceUsdc} USDC`)
                      }
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Acquire
                    </Button>
                  ) : null}
                  {asset.held ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onPrompt(`Dispose of ${asset.name}`)}
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Dispose
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Note
          title="Tier 1"
          body="Allowlisted asset up to its per-asset cap."
          variant="success"
        />
        <Note
          title="Tier 2"
          body="Dispose or redeem; agent plus admin signature."
          variant="warning"
        />
        <Note
          title="Tier 3"
          body="Above cap or not allowlisted; member vote first."
          variant="vote"
        />
      </div>

      <div className="rounded-xl border border-border/70 bg-secondary/40 p-3 text-xs text-muted-foreground">
        Payouts, recipients and asset holdings are public. Privacy in this design
        covers votes only, and only against chain observers.
      </div>
    </div>
  );
}

function Note({
  title,
  body,
  variant,
}: {
  title: string;
  body: string;
  variant: "success" | "warning" | "vote";
}) {
  return (
    <div
      className={
        variant === "success"
          ? "rounded-xl border border-yellow-200 bg-yellow-50/80 p-3 text-yellow-900"
          : variant === "warning"
            ? "rounded-xl border border-yellow-200 bg-yellow-50/90 p-3 text-yellow-900"
            : "rounded-xl border border-yellow-200 bg-yellow-50/80 p-3 text-yellow-900"
      }
    >
      <div className="text-[10px] uppercase tracking-widest opacity-70">
        {title}
      </div>
      <div className="mt-1 text-xs opacity-90">{body}</div>
    </div>
  );
}
