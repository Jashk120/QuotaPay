"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A single, polished wallet entry point used in the header and on the admin /
 * company pages. It drives RainbowKit's connect modal, shows the connected
 * account, and flags an unsupported network.
 */
export function ConnectWalletButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          return (
            <Button size="sm" variant="outline" disabled aria-label="Loading wallet">
              <Loader2 className="h-4 w-4 animate-spin" />
            </Button>
          );
        }

        if (!connected) {
          return (
            <Button size="sm" type="button" onClick={openConnectModal}>
              <Wallet className="h-4 w-4" /> Connect wallet
            </Button>
          );
        }

        if (chain.unsupported) {
          return (
            <Button
              size="sm"
              variant="destructive"
              type="button"
              onClick={openChainModal}
            >
              Wrong network
            </Button>
          );
        }

        return (
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={openAccountModal}
          >
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            {account.displayName}
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}
