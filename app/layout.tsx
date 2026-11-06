import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { Web3Provider } from "@/components/web3-provider";
import { AnonRpcProvider } from "@/lib/anonRpc";

export const metadata: Metadata = {
  title: {
    default: "QuotaPay — DAO operator agent",
    template: "%s · QuotaPay",
  },
  description:
    "Run a DAO by chatting with an agent you don't have to trust. On-chain tiers, caps and admin signatures; private, gas-sponsored voting.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Web3Provider>
          <AnonRpcProvider>
            <div className="pointer-events-none fixed inset-0 -z-10 bg-glow" />
              <div className="pointer-events-none fixed inset-0 -z-10 opacity-60 bg-grid bg-grid-mask" />
              <SiteHeader />
              <main className="container pb-24 pt-10">{children}</main>
              <footer className="border-t border-border/70 bg-white/40 py-10 backdrop-blur">
                <div className="container flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tracking-tight">
                        QuotaPay
                      </span>
                      <span className="text-xs text-muted-foreground">
                        DAO operator agent
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      On-chain authority for an agent that runs your DAO.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                    <Link
                      href="/"
                      className="transition-colors hover:text-foreground"
                    >
                      Your DAO
                    </Link>
                    <Link
                      href="/new"
                      className="transition-colors hover:text-foreground"
                    >
                      Create DAO
                    </Link>
                    <Link
                      href="/sponsorship"
                      className="transition-colors hover:text-foreground"
                    >
                      Sponsorship
                    </Link>
                    <span className="hidden text-border/80 sm:inline">·</span>
                    <span>Draft devnet · not production audited</span>
                  </div>
                </div>
              </footer>
          </AnonRpcProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
