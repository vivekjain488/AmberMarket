require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { BASE_SEPOLIA_RPC, ORACLE_PRIVATE_KEY, PRIVATE_KEY } = process.env;
const deployKey = ORACLE_PRIVATE_KEY || PRIVATE_KEY || "";
// Only pass accounts when the key looks like a valid hex private key (64 hex chars)
const isValidKey = /^(0x)?[0-9a-fA-F]{64}$/.test(deployKey);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
      }
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: isValidKey ? [`0x${deployKey.replace(/^0x/, "")}`] : [],
      chainId: 84532,
    },
    sepolia: {
      url: "https://1rpc.io/sepolia",
      accounts: isValidKey ? [`0x${deployKey.replace(/^0x/, "")}`] : [],
      chainId: 11155111,
    },
    // hardhat: {
    //   // This is the default network when you run `npx hardhat test`
    //   // Remove gas limits to allow unlimited gas for testing
    //   accounts: {
    //     mnemonic: "test test test test test test test test test test test junk",
    //     path: "m/44'/60'/0'/0",
    //     initialIndex: 0,
    //     count: 20,
    //     accountsBalance: "10000000000000000000000",
    //   }
    // }
  }
};
