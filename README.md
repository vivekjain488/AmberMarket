# AmberMarket

Every signal is a market. Every junction is an asset.

Real-time prediction market where users bet on traffic count and settlement is performed by an oracle backend.

## Deployment architecture

- Frontend: Vercel (`client/`)
- Backend API + Socket server: Render (`server/`)
- Smart contracts: Base Sepolia (or Sepolia) blockchain
- Contract deployment tool: Hardhat (`contracts/`)

### Do you need to "host Hardhat"?

No. Hardhat is a deployment/build tool, not a long-running service.

- You run Hardhat locally or in CI/CD to deploy contracts.
- The deployed contracts live on-chain (Base Sepolia), not on Vercel/Render.
- Your backend/frontend only need contract addresses + RPC configuration.

## Repo layout

- `client/`: Vite + React + wallet UI (deploy to Vercel)
- `server/`: Express + Socket.IO oracle backend (deploy to Render)
- `contracts/`: Hardhat project for Solidity compile/test/deploy
- `render.yaml`: Render Blueprint for backend deployment

## 1) Deploy contracts (Base Sepolia)

1. Configure deployer key and RPC:

```bash
cd contracts
cp .env.example .env
```

Set at least:

- `ORACLE_PRIVATE_KEY`
- `BASE_SEPOLIA_RPC`

2. Install + deploy:

```bash
npm install
npm run deploy:base-sepolia
```

3. Deployment outputs:

- console env snippets for Vercel/Render
- deployment manifest at `contracts/deployments/baseSepolia.json`
- local `client/.env` and `server/.env` auto-updated when present

## 2) Deploy backend on Render

Use `render.yaml` blueprint (recommended) or configure manually.

### Required env vars on Render

- `CLIENT_ORIGIN` → your Vercel URL(s), comma-separated if multiple
- `ORACLE_PRIVATE_KEY`
- `BASE_SEPOLIA_RPC`
- `BASE_SEPOLIA_CONTRACT_ADDRESS`
- `BASE_SEPOLIA_AMBER_TOKEN_ADDRESS`
- `BASE_SEPOLIA_JUNCTION_REGISTRY_ADDRESS`
- `BASE_SEPOLIA_JUNCTION_NFT_ADDRESS`

### Optional but recommended

- `ENABLE_CV_ORACLE=false` on Render unless Python/OpenCV stack is installed
- `NAMESPACE_API_KEY` (only if ENS claim endpoints are needed)
- `ETH_MAINNET_RPC` for ENS on-chain verification fallback

### Render build settings

- Root directory: `server`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/api/health`

## 3) Deploy frontend on Vercel

Project settings:

- Root directory: `client`
- Build command: `npm run build`
- Output directory: `dist`

### Required env vars on Vercel

- `VITE_SERVER_URL` → your Render backend URL
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_BASE_SEPOLIA_CONTRACT_ADDRESS`
- `VITE_BASE_SEPOLIA_JUNCTION_NFT_ADDRESS`
- `VITE_BASE_SEPOLIA_AMBER_TOKEN_ADDRESS`
- `VITE_BASE_SEPOLIA_RPC_URL`
- `VITE_CHAIN_ID=84532`

## 4) Post-deploy checklist

1. Open backend health URL: `/api/health` returns `{ ok: true }`.
2. Open frontend and verify socket connects.
3. Connect wallet to Base Sepolia.
4. Confirm on-chain reads succeed (pool, balances, market state).
5. Run one oracle cycle and confirm settlement transaction is mined.

## Local development quickstart

```bash
# contracts
cd contracts
npm install
npm test

# server
cd ../server
npm install
npm run dev

# client
cd ../client
npm install
npm run dev
```

## Security checklist

- Never commit `.env` files or private keys.
- Rotate any key that has ever been exposed.
- Restrict Google Maps key by domain and API scope.
- Use a dedicated low-balance oracle wallet for testnet/prod operations.

