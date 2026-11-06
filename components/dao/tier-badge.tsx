import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Authorization, Tier } from "@/lib/dao/types";

const TIER_LABEL: Record<Tier, string> = {
  0: "Tier 0 · read",
  1: "Tier 1 · agent",
  2: "Tier 2 · admin",
  3: "Tier 3 · vote",
};

export function TierBadge({
  tier,
  authorization,
  className,
}: {
  tier: Tier;
  authorization?: Authorization;
  className?: string;
}) {
  if (authorization === "admin-only") {
    return (
      <Badge variant="destructive" className={className}>
        Admin only
      </Badge>
    );
  }

  if (tier === 3) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-violet-500/30 bg-violet-500/10 text-violet-300",
          className,
        )}
      >
        {TIER_LABEL[3]}
      </Badge>
    );
  }

  return (
    <Badge
      variant={tier === 1 ? "success" : tier === 2 ? "warning" : "secondary"}
      className={className}
    >
      {TIER_LABEL[tier]}
    </Badge>
  );
}
