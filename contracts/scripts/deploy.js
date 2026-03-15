const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function updateEnvFile(filePath, keysUpdates) {
  let content = "";
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, "utf8");
  }

  for (const [key, value] of Object.entries(keysUpdates)) {
    const regex = new RegExp(`^${key}=.*`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }

  content = content.replace(/\n{3,}/g, "\n\n").trim() + "\n";
  fs.writeFileSync(filePath, content, "utf8");
}

async function main() {
  const [deployer, ...signers] = await hre.ethers.getSigners();
  const networkInfo = await hre.ethers.provider.getNetwork();
  const chainId = Number(networkInfo.chainId);
  const isLocalNetwork = hre.network.name === "localhost" || hre.network.name === "hardhat" || chainId === 31337;
  const hardhatDefaultPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  console.log("Deploying with:", deployer.address);
  console.log("Network:", hre.network.name);

  // ─── 1. Deploy AmberToken ─────────────────────────────
  console.log("\n1. Deploying AmberToken ($AMBER)...");
  const AmberToken = await hre.ethers.getContractFactory("AmberToken");
  const amberToken = await AmberToken.deploy(deployer.address);
  await amberToken.waitForDeployment();
  const amberTokenAddress = await amberToken.getAddress();
  console.log("   AmberToken:", amberTokenAddress);

  // ─── 2. Deploy JunctionRegistry ───────────────────────
  console.log("2. Deploying JunctionRegistry...");
  const JunctionRegistry = await hre.ethers.getContractFactory("JunctionRegistry");
  const junctionRegistry = await JunctionRegistry.deploy(deployer.address);
  await junctionRegistry.waitForDeployment();
  const junctionRegistryAddress = await junctionRegistry.getAddress();
  console.log("   JunctionRegistry:", junctionRegistryAddress);

  // ─── 3. Deploy AmberMarket ────────────────────────────
  console.log("3. Deploying AmberMarket...");
  const AmberMarket = await hre.ethers.getContractFactory("AmberMarket");
  const platformFeeBps = 300; // 3%
  const amberMarket = await AmberMarket.deploy(
    deployer.address,
    amberTokenAddress,
    deployer.address,   // oracle = deployer for dev
    deployer.address,   // feeRecipient = deployer for dev
    platformFeeBps
  );
  await amberMarket.waitForDeployment();
  const amberMarketAddress = await amberMarket.getAddress();
  console.log("   AmberMarket:", amberMarketAddress);

  // ─── 4. Deploy AmberJunctionNFT ───────────────────────
  console.log("4. Deploying AmberJunctionNFT...");
  const AmberJunctionNFT = await hre.ethers.getContractFactory("AmberJunctionNFT");
  const amberJunctionNFT = await AmberJunctionNFT.deploy(
    deployer.address,
    amberTokenAddress
  );
  await amberJunctionNFT.waitForDeployment();
  const amberJunctionNFTAddress = await amberJunctionNFT.getAddress();
  console.log("   AmberJunctionNFT:", amberJunctionNFTAddress);

  // ─── 5. Link contracts ────────────────────────────────
  console.log("5. Linking contracts...");
  let tx = await amberMarket.setJunctionNFT(amberJunctionNFTAddress);
  await tx.wait();
  tx = await amberJunctionNFT.setAmberMarket(amberMarketAddress);
  await tx.wait();
  console.log("   Linked: AmberMarket <-> AmberJunctionNFT");

  // ─── 6. Register demo junctions ───────────────────────
  const demoJunctions = [
    {
      id: hre.ethers.id("bkc-signal-1"),
      name: "Bandra-Kurla Complex Junction",
      roadCount: 4,
      latE7: 190596000,
      lngE7: 728656000,
    },
    {
      id: hre.ethers.id("worli-signal-1"),
      name: "Worli Sea Face Signal",
      roadCount: 2,
      latE7: 190176000,
      lngE7: 728156000,
    },
  ];

  console.log("6. Registering demo junctions...");
  for (const j of demoJunctions) {
    tx = await junctionRegistry.registerJunction(j.id, j.name, j.roadCount, j.latE7, j.lngE7);
    await tx.wait();
    console.log("   Registered:", j.name);
  }

  // ─── 7. Distribute test $AMBER to Hardhat accounts ───
  console.log("7. Distributing test $AMBER...");
  const testAmount = hre.ethers.parseUnits("10000", 18); // 10,000 AMBER each
  for (let i = 0; i < Math.min(signers.length, 5); i++) {
    tx = await amberToken.transfer(signers[i].address, testAmount);
    await tx.wait();
    console.log(`   Sent 10,000 AMBER to Account #${i + 1}: ${signers[i].address}`);
  }

  // ─── 8. Update .env files ─────────────────────────────
  console.log("\n8. Updating .env files...");
  
  const envPrefix = hre.network.name === "baseSepolia" ? "BASE_SEPOLIA_" 
                  : hre.network.name === "sepolia" ? "SEPOLIA_" 
                  : "";
                  
  const serverEnv = path.join(__dirname, "../../server/.env");
  const serverEnvUpdates = {};
  
  if (isLocalNetwork) {
    serverEnvUpdates["CONTRACT_ADDRESS"] = amberMarketAddress;
    serverEnvUpdates["AMBER_TOKEN_ADDRESS"] = amberTokenAddress;
    serverEnvUpdates["JUNCTION_REGISTRY_ADDRESS"] = junctionRegistryAddress;
    serverEnvUpdates["JUNCTION_NFT_ADDRESS"] = amberJunctionNFTAddress;
    serverEnvUpdates["ORACLE_PRIVATE_KEY"] = hardhatDefaultPrivateKey;
    serverEnvUpdates["LOCAL_RPC"] = "http://127.0.0.1:8545";
  } else {
    serverEnvUpdates[`${envPrefix}CONTRACT_ADDRESS`] = amberMarketAddress;
    serverEnvUpdates[`${envPrefix}AMBER_TOKEN_ADDRESS`] = amberTokenAddress;
    serverEnvUpdates[`${envPrefix}JUNCTION_REGISTRY_ADDRESS`] = junctionRegistryAddress;
    serverEnvUpdates[`${envPrefix}JUNCTION_NFT_ADDRESS`] = amberJunctionNFTAddress;
    
    if (hre.network.name === "sepolia") {
      serverEnvUpdates["SEPOLIA_RPC"] = "https://1rpc.io/sepolia";
    } else if (hre.network.name === "baseSepolia") {
      serverEnvUpdates["BASE_SEPOLIA_RPC"] = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
    }
  }
  await updateEnvFile(serverEnv, serverEnvUpdates);

  const clientEnv = path.join(__dirname, "../../client/.env");
  const clientEnvUpdates = {};
  
  if (isLocalNetwork) {
    clientEnvUpdates["VITE_CONTRACT_ADDRESS"] = amberMarketAddress;
    clientEnvUpdates["VITE_AMBER_TOKEN_ADDRESS"] = amberTokenAddress;
    clientEnvUpdates["VITE_JUNCTION_NFT_ADDRESS"] = amberJunctionNFTAddress;
    clientEnvUpdates["VITE_JUNCTION_REGISTRY_ADDRESS"] = junctionRegistryAddress;
    clientEnvUpdates["VITE_CHAIN_ID"] = String(chainId);
    clientEnvUpdates["VITE_LOCAL_RPC_URL"] = "http://127.0.0.1:8545";
  } else {
    clientEnvUpdates[`VITE_${envPrefix}CONTRACT_ADDRESS`] = amberMarketAddress;
    clientEnvUpdates[`VITE_${envPrefix}AMBER_TOKEN_ADDRESS`] = amberTokenAddress;
    clientEnvUpdates[`VITE_${envPrefix}JUNCTION_NFT_ADDRESS`] = amberJunctionNFTAddress;
    clientEnvUpdates[`VITE_${envPrefix}JUNCTION_REGISTRY_ADDRESS`] = junctionRegistryAddress;
    
    if (hre.network.name === "sepolia") {
      clientEnvUpdates["VITE_SEPOLIA_RPC_URL"] = "https://1rpc.io/sepolia";
    }
  }
  await updateEnvFile(clientEnv, clientEnvUpdates);

  console.log("\n✅ Deployment complete!");
  console.log("─────────────────────────────────");
  console.log("AmberToken:        ", amberTokenAddress);
  console.log("JunctionRegistry:  ", junctionRegistryAddress);
  console.log("AmberMarket:       ", amberMarketAddress);
  console.log("AmberJunctionNFT:  ", amberJunctionNFTAddress);
  console.log("─────────────────────────────────");
  console.log("✅ .env files updated automatically.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });