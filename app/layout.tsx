import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { AnonRpcProvider } from "@/lib/anonRpc";

export const metadata: Metadata = {
  title: "QuotaPay — sponsored EIP-8141 payments",
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
        <AnonRpcProvider>
          <div className="pointer-events-none fixed inset-0 -z-10 bg-glow" />
          <div className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-grid-mask" />
          <SiteHeader />
          <main className="container pb-24 pt-10">{children}</main>
          <footer className="border-t border-border/60 py-8">
            <div className="container flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
              <span>QuotaPay · company-scoped sponsorship on EIP-8141</span>
              <span>Draft devnet · not production audited</span>
            </div>
          </footer>
        </AnonRpcProvider>
      </body>
    </html>
  );
}
