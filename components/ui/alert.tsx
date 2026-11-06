import * as React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const styles = {
  info: "border-gray-200 bg-gray-50/80 text-gray-800",
  success: "border-yellow-200 bg-yellow-50/80 text-yellow-800",
  error: "border-gray-200 bg-gray-50/80 text-gray-800",
  warning: "border-yellow-200 bg-yellow-50/90 text-yellow-900",
} as const;

const icons = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertCircle,
} as const;

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: keyof typeof styles;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = icons[variant];
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border p-4 text-sm shadow-[0_1px_2px_hsl(40_30%_20%/0.03)]",
        styles[variant],
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className="text-sm opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
