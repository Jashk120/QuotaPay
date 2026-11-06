import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { Web3Provider } from "@/components/web3-provider";
import { AnonRpcProvider } from "@/lib/anonRpc";
import { RoleProvider } from "@/lib/role";

export const metadata: Metadata = {
  title: {
    default: "QuotaPay — sponsored EIP-8141 payments",
    template: "%s · QuotaPay",
  },
  description:
    "Company-scoped ERC-8421 sponsorship: register a company, authorize wallets, and let the paymaster cover EIP-8141 frame transactions.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <Web3Provider>
          <AnonRpcProvider>
            <RoleProvider>
              <div className="pointer-events-none fixed inset-0 -z-10 bg-glow" />
              <div className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-grid-mask" />
              <SiteHeader />
              <main className="container pb-24 pt-10">{children}</main>
              <footer className="border-t border-border/60 py-10">
                <div className="container flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tracking-tight">
                        QuotaPay
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Sponsorship OS
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Company-scoped sponsorship on EIP-8141 frame transactions.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                    <Link
                      href="/company/new"
                      className="transition-colors hover:text-foreground"
                    >
                      Register a company
                    </Link>
                    <Link
                      href="/admin"
                      className="transition-colors hover:text-foreground"
                    >
                      Admin
                    </Link>
                    <Link
                      href="/pay"
                      className="transition-colors hover:text-foreground"
                    >
                      Pay
                    </Link>
                    <span className="hidden text-border/80 sm:inline">·</span>
                    <span>Draft devnet · not production audited</span>
                  </div>
                </div>
              </footer>
            </RoleProvider>
          </AnonRpcProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
