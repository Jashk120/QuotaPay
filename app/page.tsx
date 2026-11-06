import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <section className="relative flex min-h-[calc(100vh-11rem)] flex-col items-center justify-center py-16 text-center">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[420px] max-w-4xl rounded-full bg-primary/20 blur-[120px]" />

      <Badge variant="outline" className="mb-6">
        EIP-8141 · on-chain DAO operator
      </Badge>

      <h1 className="max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
        Run a DAO by chatting with an agent
        <span className="block text-gradient">you don&apos;t have to trust.</span>
      </h1>

      <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
        On-chain tiers, caps and admin signatures. The agent can act, but it
        cannot exceed its mandate — the contracts decide, not the model.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/daos">
            Open DAOs <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/new">
            <Plus className="h-4 w-4" /> Create a DAO
          </Link>
        </Button>
      </div>

      <p className="mt-10 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        Non-custodial · policy enforced on-chain · gas-sponsored
      </p>
    </section>
  );
}
