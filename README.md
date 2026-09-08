# AmberMarket

**Every signal is a market. Every junction is an asset.**

AmberMarket is a real-time prediction market platform in which participants take positions on live traffic counts at monitored road junctions. Market settlement is performed automatically by a computer-vision-backed oracle, with outcomes and payouts recorded on-chain.

## Overview

Each supported junction operates as an independent prediction market. Users open positions on the expected traffic count for a given time window, and the outcome is determined by an oracle service that ingests live signal data (optionally powered by computer vision), computes the result, and submits a settlement transaction to the smart contract on Base Sepolia. Balances, market state, and settlement history are all verifiable on-chain.

## Architecture

| Component | Technology | Deployment Target |
|---|---|---|
| Frontend | Vite + React (wallet-enabled UI) | Vercel (`client/`) |
| Backend API + Realtime | Express + Socket.IO (oracle backend) | Render (`server/`) |
| Smart Contracts | Solidity, deployed via Hardhat | Base Sepolia (or Sepolia) |
| Contract Tooling | Hardhat | Run locally or in CI/CD (`contracts/`) |

### On the role of Hardhat

Hardhat is a development and deployment tool, not a persistent service, and does not need to be hosted:

- Hardhat is run locally or from CI/CD solely to compile, test, and deploy the smart contracts.
- Once deployed, the contracts live on-chain (Base Sepolia) — independent of the Vercel and Render deployments.
- The frontend and backend only require the resulting contract addresses and RPC configuration to interact with the deployed contracts.

## Repository Layout

- `client/` — Vite + React frontend with wallet integration (deployed to Vercel)
- `server/` — Express + Socket.IO oracle backend (deployed to Render)
- `contracts/` — Hardhat project for Solidity compilation, testing, and deployment
- `render.yaml` — Render Blueprint for automated backend deployment

## Deployment Guide

### 1. Deploy Smart Contracts (Base Sepolia)

Configure the deployer key and RPC endpoint:

```bash
cd contracts
cp .env.example .env
```

At minimum, set the following environment variables:

- `ORACLE_PRIVATE_KEY`
- `BASE_SEPOLIA_RPC`

Install dependencies and deploy:

```bash
npm install
npm run deploy:base-sepolia
```

The deployment script produces:

- Environment variable snippets for Vercel and Render, printed to the console
- A deployment manifest at `contracts/deployments/baseSepolia.json`
- Automatic updates to local `client/.env` and `server/.env` files, where present

### 2. Deploy the Backend (Render)

Deployment via the `render.yaml` blueprint is recommended; manual configuration is also supported.

**Required environment variables:**

- `CLIENT_ORIGIN` — Vercel deployment URL(s), comma-separated if multiple
- `ORACLE_PRIVATE_KEY`
- `BASE_SEPOLIA_RPC`
- `BASE_SEPOLIA_CONTRACT_ADDRESS`
- `BASE_SEPOLIA_AMBER_TOKEN_ADDRESS`
- `BASE_SEPOLIA_JUNCTION_REGISTRY_ADDRESS`
- `BASE_SEPOLIA_JUNCTION_NFT_ADDRESS`

**Optional, recommended:**

- `ENABLE_CV_ORACLE=false` — disable unless the Python/OpenCV stack is installed on the target environment
- `NAMESPACE_API_KEY` — required only if ENS claim endpoints are in use
- `ETH_MAINNET_RPC` — enables ENS on-chain verification fallback

**Render build settings:**

| Setting | Value |
|---|---|
| Root directory | `server` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |

### 3. Deploy the Frontend (Vercel)

**Project settings:**

| Setting | Value |
|---|---|
| Root directory | `client` |
| Build command | `npm run build` |
| Output directory | `dist` |

**Required environment variables:**

- `VITE_SERVER_URL` — URL of the deployed Render backend
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_BASE_SEPOLIA_CONTRACT_ADDRESS`
- `VITE_BASE_SEPOLIA_JUNCTION_NFT_ADDRESS`
- `VITE_BASE_SEPOLIA_AMBER_TOKEN_ADDRESS`
- `VITE_BASE_SEPOLIA_RPC_URL`
- `VITE_CHAIN_ID=84532`

### 4. Post-Deployment Verification

1. Confirm the backend health endpoint (`/api/health`) returns `{ ok: true }`.
2. Load the frontend and verify the Socket.IO connection is established.
3. Connect a wallet and switch to the Base Sepolia network.
4. Confirm on-chain reads succeed (pool state, balances, market state).
5. Trigger one oracle cycle and confirm the settlement transaction is mined.

## Local Development

```bash
# Contracts
cd contracts
npm install
npm test

# Server
cd ../server
npm install
npm run dev

# Client
cd ../client
npm install
npm run dev
```

## Security Considerations

- Never commit `.env` files or private keys to version control.
- Rotate any key or credential that has ever been exposed.
- Restrict the Google Maps API key by domain and API scope.
- Use a dedicated, low-balance oracle wallet for testnet and production operations.

## Demo

https://www.youtube.com/watch?v=KrgYw6nwBe8
