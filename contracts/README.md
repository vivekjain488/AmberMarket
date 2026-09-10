# AmberMarket Contracts (Hardhat)

This package compiles, tests, and deploys AmberMarket smart contracts.

## Important

Hardhat is not hosted as a server. You run it locally/CI to deploy contracts to a blockchain network.

## Setup

```bash
cd contracts
npm install
cp .env.example .env
```

Set at least:

- `ORACLE_PRIVATE_KEY`
- `BASE_SEPOLIA_RPC`

## Commands

- `npm run compile`
- `npm run test`
- `npm run node`
- `npm run deploy:localhost`
- `npm run deploy:sepolia`
- `npm run deploy:base-sepolia`

## Deployment output

After a deploy, the script will:

1. Print deployed contract addresses.
2. Write deployment metadata to `contracts/deployments/<network>.json`.
3. Print copy-paste env snippets for Render and Vercel.
4. Auto-update local `../server/.env` and `../client/.env` when those files exist.

## Recommended production target

Use Base Sepolia (`--network baseSepolia`) for the deployed testnet setup used by frontend/backend.
