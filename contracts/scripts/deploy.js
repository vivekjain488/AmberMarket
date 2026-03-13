const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  try {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying with:", deployer.address);
    console.log("Network:", hre.network.name);

    // Calculate unlock time (e.g., 1 year from now)
    // You can adjust this value as needed
    const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year from now
    console.log("\nUnlock time:", new Date(unlockTime * 1000).toISOString());

    // Deploy Lock
    console.log("\nDeploying Lock...");
    const Lock = await hre.ethers.getContractFactory("Lock");
    const lock = await Lock.deploy(unlockTime);
    await lock.waitForDeployment();
    const lockAddress = await lock.getAddress();
    console.log("Lock deployed to:", lockAddress);

    // Save deployment info
    const deploymentInfo = {
      network: hre.network.name,
      deployer: deployer.address,
      deploymentTime: new Date().toISOString(),
      contracts: {
        lock: {
          address: lockAddress,
          unlockTime: unlockTime,
          unlockTimeReadable: new Date(unlockTime * 1000).toISOString()
        }
      }
    };
    const deploymentPath = path.join(__dirname, "..", "deployment.json");
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("\nSaved deployment info to:", deploymentPath);

    console.log("\nDone.");
    console.log("Lock:", lockAddress);
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });