import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { devnet } from "./contracts";
import { config } from "./config";
import { rpcFetch } from "./rpcTransport";

/**
 * WalletConnect needs a projectId from https://cloud.walletconnect.com.
 * When it is absent (e.g. local dev) we still expose injected wallets
 * (MetaMask, Coinbase, Rainbow, Brave, …) and simply omit the WalletConnect
 * (mobile / QR) option instead of crashing.
 */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// These are wallet *factories*; `connectorsForWallets` instantiates them and
// passes `projectId` through to the WalletConnect wallet.
const wallets = [injectedWallet, ...(projectId ? [walletConnectWallet] : [])];

const connectors = connectorsForWallets(
  [{ groupName: "Recommended", wallets }],
  {
    appName: "QuotaPay",
    appDescription:
      "Company-scoped EIP-8141 sponsorship: register a company, authorize wallets, and let the paymaster cover gas.",
    projectId,
  },
);

export const wagmiConfig = createConfig({
  chains: [devnet],
  transports: {
    [devnet.id]: http(config.rpcUrl, { fetchFn: rpcFetch }),
  },
  connectors,
  ssr: true,
});
