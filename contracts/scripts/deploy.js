const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", hre.network.name);

  const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  console.log("\nDeploying JunctionRegistry...");
  const JunctionRegistry = await hre.ethers.getContractFactory("JunctionRegistry");
  const junctionRegistry = await JunctionRegistry.deploy(deployer.address);
  await junctionRegistry.waitForDeployment();
  const junctionRegistryAddress = await junctionRegistry.getAddress();
  console.log("JunctionRegistry deployed to:", junctionRegistryAddress);

  console.log("\nDeploying AmberMarket...");
  const AmberMarket = await hre.ethers.getContractFactory("AmberMarket");
  const platformFeeBps = 300;
  const amberMarket = await AmberMarket.deploy(
    deployer.address,
    USDC_BASE_SEPOLIA,
    deployer.address,
    deployer.address,
    platformFeeBps
  );
  await amberMarket.waitForDeployment();
  const amberMarketAddress = await amberMarket.getAddress();
  console.log("AmberMarket deployed to:", amberMarketAddress);

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
    {
      id: hre.ethers.id("dadar-tt-1"),
      name: "Dadar TT Circle",
      roadCount: 5,
      latE7: 190178000,
      lngE7: 728478000,
    },
  ];

  console.log("\nRegistering demo junctions...");
  for (const j of demoJunctions) {
    const tx = await junctionRegistry.registerJunction(j.id, j.name, j.roadCount, j.latE7, j.lngE7);
    await tx.wait();
    console.log("Registered:", j.name, j.id);
  }

  console.log("\nDone.");
  console.log("JunctionRegistry:", junctionRegistryAddress);
  console.log("AmberMarket:", amberMarketAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });