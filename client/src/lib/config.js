export const config = {
  serverUrl: import.meta.env.VITE_SERVER_URL || "http://localhost:3001",
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  
  contracts: {
    11155111: {
      contractAddress: import.meta.env.VITE_SEPOLIA_CONTRACT_ADDRESS,
      junctionNftAddress: import.meta.env.VITE_SEPOLIA_JUNCTION_NFT_ADDRESS,
      amberTokenAddress: import.meta.env.VITE_SEPOLIA_AMBER_TOKEN_ADDRESS
    },
    84532: {
      contractAddress: import.meta.env.VITE_BASE_SEPOLIA_CONTRACT_ADDRESS,
      junctionNftAddress: import.meta.env.VITE_BASE_SEPOLIA_JUNCTION_NFT_ADDRESS,
      amberTokenAddress: import.meta.env.VITE_BASE_SEPOLIA_AMBER_TOKEN_ADDRESS
    }
  }
};

export function getChainConfig(chainId) {
  return config.contracts[chainId] || config.contracts[11155111] || {};
}
