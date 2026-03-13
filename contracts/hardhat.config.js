require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { BASE_SEPOLIA_RPC, ORACLE_PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
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
      accounts: ORACLE_PRIVATE_KEY ? [`0x${ORACLE_PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 84532,
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
