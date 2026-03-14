export const config = {
  serverUrl: import.meta.env.VITE_SERVER_URL || "http://localhost:3001",
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  contractAddress: import.meta.env.VITE_CONTRACT_ADDRESS,
  junctionNftAddress: import.meta.env.VITE_JUNCTION_NFT_ADDRESS,
  amberTokenAddress: import.meta.env.VITE_AMBER_TOKEN_ADDRESS,
  chainId: Number(import.meta.env.VITE_CHAIN_ID || 31337),
};

