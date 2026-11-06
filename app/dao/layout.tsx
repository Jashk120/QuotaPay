import Link from "next/link";
import { ArrowLeft, Bot, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function DaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              DAO operator
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              UI-only demo
            </div>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <Link
            href="/dao"
            className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Console
          </Link>
          <Link
            href="/dao/new"
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> New DAO
          </Link>
          <Badge variant="outline" className="hidden sm:inline-flex">
            QuotaPay
          </Badge>
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
