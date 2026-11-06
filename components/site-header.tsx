"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useAnonRpc } from "@/lib/anonRpc";

const links = [
  { href: "/", label: "Overview" },
  { href: "/company/new", label: "Register company" },
  { href: "/admin", label: "Admin" },
  { href: "/pay", label: "Pay" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { mode } = useAnonRpc();
  const [open, setOpen] = useState(false);
  // Gate transport-dependent UI on mount: the anon-rpc mode resolves in an
  // effect after hydration, and must never diverge from the SSR HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close the mobile menu on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const privacy =
    mode === "anonymous"
      ? { label: "anon-rpc", variant: "success" as const, Icon: ShieldCheck }
      : mode === "passthrough"
        ? { label: "passthrough", variant: "outline" as const, Icon: ShieldQuestion }
        : mode === "starting"
          ? { label: "privacy…", variant: "outline" as const, Icon: ShieldQuestion }
          : { label: "direct RPC", variant: "warning" as const, Icon: ShieldAlert };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/30">
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">QuotaPay</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Sponsorship OS
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-accent text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden lg:inline-flex">
            EIP-8141 · devnet
          </Badge>
          {mounted ? (
            <Badge variant={privacy.variant} className="hidden sm:inline-flex">
              <privacy.Icon className="mr-1 h-3 w-3" />
              {privacy.label}
            </Badge>
          ) : (
            <Badge variant="outline" className="hidden sm:inline-flex">
              <ShieldQuestion className="mr-1 h-3 w-3" />
              privacy…
            </Badge>
          )}
          <Link
            href="/company/new"
            className={cn(buttonVariants({ size: "sm" }), "hidden md:inline-flex")}
          >
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="grid h-10 w-10 place-items-center rounded-md text-foreground transition-colors hover:bg-accent md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open ? (
        <div className="border-t border-border/60 md:hidden">
          <nav className="container flex flex-col gap-1 py-4">
            {links.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    active && "bg-accent text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="mt-2 flex flex-wrap items-center gap-2 px-3">
              <Badge variant="outline">EIP-8141 · devnet</Badge>
              {mounted ? (
                <Badge variant={privacy.variant}>
                  <privacy.Icon className="mr-1 h-3 w-3" />
                  {privacy.label}
                </Badge>
              ) : (
                <Badge variant="outline">
                  <ShieldQuestion className="mr-1 h-3 w-3" />
                  privacy…
                </Badge>
              )}
            </div>
            <Link
              href="/company/new"
              className={cn(buttonVariants(), "mt-3")}
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
