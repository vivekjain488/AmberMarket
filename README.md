# AmberMarket

**Every signal is a market. Every junction is an asset.**

Hackathon MVP: a real-time prediction market where users stake USDC on the **number of cars** crossing a junction during a green-light window. Settlement is driven by a trusted backend oracle (demo mode supported).

## Repo layout
- `client/`: Vite + React + Tailwind + Google Maps + wallet UI
- `server/`: Node.js + Express + Socket.io oracle loop + Python subprocess bridge
- `contracts/`: Hardhat + Solidity contracts deployed to Base Sepolia

## Security note (important)
Do **not** commit API keys or private keys.
- Put secrets in `.env` files (templates provided as `.env.example`).
- If you pasted a Google Maps API key anywhere public, **rotate it** in Google Cloud Console and restrict it.

## Quickstart (local)

### 1) Contracts (local tests)
```bash
cd contracts
npm install
npx hardhat test
```

### 2) Deploy to Base Sepolia (optional)
Create `contracts/.env` from `contracts/.env.example`:
```bash
cd contracts
cp .env.example .env
# set ORACLE_PRIVATE_KEY and BASE_SEPOLIA_RPC
npx hardhat run scripts/deploy.js --network baseSepolia
```
Copy the printed addresses into:
- `server/.env` (`CONTRACT_ADDRESS`, `JUNCTION_REGISTRY_ADDRESS`)
- `client/.env` (`VITE_CONTRACT_ADDRESS`, `VITE_JUNCTION_REGISTRY_ADDRESS`)

### 3) Server
Create `server/.env` from `server/.env.example`.
```bash
cd server
npm install
npm run dev
```
The server runs a simple cycle:
- RED_OPEN (bets open) → GREEN_COUNTING (bets locked + python counting) → SETTLING → repeat

### 4) Client
Create `client/.env` from `client/.env.example`.
```bash
cd client
npm install
npm run dev
```
Open `http://localhost:5173`.

## Notes
- **Google Maps**: client requires `VITE_GOOGLE_MAPS_API_KEY`.
- **Oracle mode**:
  - If `server/.env` includes `ORACLE_PRIVATE_KEY` + `CONTRACT_ADDRESS`, the server will send onchain txs.
  - Otherwise, it runs in simulated mode for UI/demo.
- **Python CV**: `server/cv_oracle/count_cars.py` runs a best-effort CV pipeline when deps are installed; otherwise it falls back to a deterministic fake counter so demos never stall.

