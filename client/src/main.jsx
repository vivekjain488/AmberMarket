import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { baseSepolia, hardhat, sepolia } from "wagmi/chains";

import "./index.css";
import App from "./App.jsx";
import { GameModeProvider } from "./contexts/GameModeContext.jsx";

const queryClient = new QueryClient();
const preferredChainId = Number(import.meta.env.VITE_CHAIN_ID || sepolia.id);
const supportedChains = [hardhat, sepolia, baseSepolia];
const chains = [
  ...supportedChains.filter((chain) => chain.id === preferredChainId),
  ...supportedChains.filter((chain) => chain.id !== preferredChainId),
];

const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  transports: {
    [hardhat.id]: http(import.meta.env.VITE_LOCAL_RPC_URL || "http://127.0.0.1:8545"),
    [sepolia.id]: http(import.meta.env.VITE_SEPOLIA_RPC_URL),
    [baseSepolia.id]: http(import.meta.env.VITE_BASE_SEPOLIA_RPC_URL),
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <BrowserRouter>
            <GameModeProvider>
              <App />
            </GameModeProvider>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
