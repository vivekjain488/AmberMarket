const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AmberJunctionNFT and Royalties Integration", function () {
  async function deployFixture() {
    const [deployer, oracle, feeRecipient, user1, user2] = await ethers.getSigners();

    // Deploy AmberToken
    const AmberToken = await ethers.getContractFactory("AmberToken");
    const amber = await AmberToken.deploy(deployer.address);
    await amber.waitForDeployment();
    const amberAddr = await amber.getAddress();

    // Distribute tokens
    const mintAmount = ethers.parseUnits("10000", 18);
    await amber.transfer(user1.address, mintAmount);
    await amber.transfer(user2.address, mintAmount);

    // Deploy AmberMarket
    const AmberMarket = await ethers.getContractFactory("AmberMarket");
    const market = await AmberMarket.deploy(
      deployer.address,
      amberAddr,
      oracle.address,
      feeRecipient.address,
      300 // 3%
    );
    await market.waitForDeployment();
    const marketAddr = await market.getAddress();

    // Deploy AmberJunctionNFT
    const AmberJunctionNFT = await ethers.getContractFactory("AmberJunctionNFT");
    const nft = await AmberJunctionNFT.deploy(deployer.address, amberAddr);
    await nft.waitForDeployment();
    const nftAddr = await nft.getAddress();

    // Link
    await market.setJunctionNFT(nftAddr);
    await nft.setAmberMarket(marketAddr);

    // Approvals
    await amber.connect(user1).approve(marketAddr, ethers.MaxUint256);
    await amber.connect(user2).approve(marketAddr, ethers.MaxUint256);
    await amber.connect(user1).approve(nftAddr, ethers.MaxUint256);
    await amber.connect(user2).approve(nftAddr, ethers.MaxUint256);

    const junctionId = ethers.id("test-junction");

    return { market, nft, amber, deployer, oracle, feeRecipient, user1, user2, junctionId };
  }

  describe("Junction NFT Marketplace", function () {
    it("Should mint a junction at base price if 0 points", async function () {
      const { nft, amber, user1, deployer, junctionId } = await loadFixture(deployFixture);
      const basePrice = ethers.parseUnits("100", 18); // 100 AMBER

      const deployerBalBefore = await amber.balanceOf(deployer.address);
      await expect(nft.connect(user1).buyJunction(junctionId))
        .to.emit(nft, "JunctionPurchased")
        .withArgs(junctionId, user1.address, 1, basePrice);

      expect(await nft.getOwnerOfJunction(junctionId)).to.equal(user1.address);
      const deployerBalAfter = await amber.balanceOf(deployer.address);
      expect(deployerBalAfter - deployerBalBefore).to.equal(basePrice);
    });

    it("Should not allow buying an already owned junction", async function () {
      const { nft, user1, user2, junctionId } = await loadFixture(deployFixture);
      await nft.connect(user1).buyJunction(junctionId);
      await expect(nft.connect(user2).buyJunction(junctionId)).to.be.revertedWith("ALREADY_OWNED");
    });
  });

  describe("Dynamic Prediction Discounts", function () {
    it("Should apply 5% discount after winning predictions", async function () {
      const { market, nft, amber, oracle, user1, junctionId } = await loadFixture(deployFixture);

      // User1 wins 2 rounds with RANGE [10,20], count=15 to get 2 prediction points
      for (let i = 0; i < 2; i++) {
        await market.connect(oracle).openMarket(junctionId);
        // placeBet(RANGE=2, prediction=10, rangeMax=20, stake)
        await market.connect(user1).placeBet(2, 10, 20, ethers.parseUnits("10", 18));
        await market.connect(oracle).lockMarket();
        await market.connect(oracle).submitCount(15);
        const mId = await market.marketId();
        await market.connect(user1).claimWinnings(mId);
      }

      expect(await market.userPredictionPoints(junctionId, user1.address)).to.equal(2);

      // 2 points × 5% = 10% discount → 90 AMBER
      const expectedPrice = ethers.parseUnits("90", 18);
      expect(await nft.getDiscountedPrice(junctionId, user1.address)).to.equal(expectedPrice);

      await expect(nft.connect(user1).buyJunction(junctionId))
        .to.emit(nft, "JunctionPurchased")
        .withArgs(junctionId, user1.address, 1, expectedPrice);
    });
  });

  describe("0.5% Protocol Royalties to NFT Owner", function () {
    it("Should route 0.5% of totalStaked to junction owner on settlement", async function () {
      const { market, nft, amber, oracle, user1, user2, junctionId } = await loadFixture(deployFixture);

      // User1 buys the junction
      await nft.connect(user1).buyJunction(junctionId);

      // Start a market
      await market.connect(oracle).openMarket(junctionId);

      // User2 bets 100 AMBER (RANGE [10,20])
      const betAmt = ethers.parseUnits("100", 18);
      await market.connect(user2).placeBet(2, 10, 20, betAmt);

      const user1BalBefore = await amber.balanceOf(user1.address);

      await market.connect(oracle).lockMarket();
      await market.connect(oracle).submitCount(15);

      // Royalty = 0.5% of 100 AMBER = 0.5 AMBER
      const expectedRoyalty = ethers.parseUnits("0.5", 18);
      const user1BalAfter = await amber.balanceOf(user1.address);
      expect(user1BalAfter - user1BalBefore).to.equal(expectedRoyalty);
    });
  });
});
