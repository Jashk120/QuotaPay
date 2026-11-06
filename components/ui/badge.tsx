import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-primary/45 bg-primary/15 text-yellow-800",
        secondary:
          "border-border bg-secondary text-secondary-foreground",
        outline: "border-border bg-white/60 text-foreground",
        success:
          "border-yellow-600/25 bg-yellow-50 text-yellow-700",
        warning:
          "border-yellow-600/30 bg-yellow-50 text-yellow-800",
        destructive:
          "border-gray-600/25 bg-gray-50 text-gray-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
