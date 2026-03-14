const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("AmberMarket — 4 Bet Types with Gradient Payouts", function () {

  async function deployFixture() {
    const [owner, oracle, feeRecipient, alice, bob, carol, dave] = await ethers.getSigners();

    // Deploy $AMBER token
    const AmberToken = await ethers.getContractFactory("AmberToken");
    const amber = await AmberToken.deploy(owner.address);
    const amberAddr = await amber.getAddress();

    // Deploy AmberMarket
    const AmberMarket = await ethers.getContractFactory("AmberMarket");
    const market = await AmberMarket.deploy(
      owner.address,
      amberAddr,
      oracle.address,
      feeRecipient.address,
      300            // 3% platform fee
    );
    const marketAddr = await market.getAddress();

    // Deploy NFT
    const AmberJunctionNFT = await ethers.getContractFactory("AmberJunctionNFT");
    const nft = await AmberJunctionNFT.deploy(owner.address, amberAddr);
    const nftAddr = await nft.getAddress();

    // Link
    await market.setJunctionNFT(nftAddr);
    await nft.setAmberMarket(marketAddr);

    // Distribute AMBER to test accounts
    const amt = ethers.parseUnits("10000", 18);
    for (const s of [alice, bob, carol, dave]) {
      await amber.transfer(s.address, amt);
      await amber.connect(s).approve(marketAddr, ethers.MaxUint256);
      await amber.connect(s).approve(nftAddr, ethers.MaxUint256);
    }

    const junctionId = ethers.id("test-junction-1");

    return { owner, oracle, feeRecipient, alice, bob, carol, dave, amber, market, nft, marketAddr, amberAddr, nftAddr, junctionId };
  }

  async function openMarket(market, oracle, junctionId) {
    await market.connect(oracle).openMarket(junctionId);
  }

  async function lockAndSettle(market, oracle, carCount) {
    await market.connect(oracle).lockMarket();
    await market.connect(oracle).submitCount(carCount);
  }

  // ─── UNDER BET TESTS ──────────────────────────────────

  it("Under 20, count=5 → WIN with high payout (score=0.75)", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(0, 20, 0, stake); // UNDER 20
    await lockAndSettle(market, oracle, 5);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.be.gt(0);

    // Weight should be 100 * 0.75 = 75 AMBER (scaled)
    const expectedWeight = (stake * 75n) / 100n;
    expect(weight).to.equal(expectedWeight);
  });

  it("Under 20, count=18 → WIN with minimum payout (score floored at 0.10)", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(0, 20, 0, stake); // UNDER 20
    await lockAndSettle(market, oracle, 18);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    // (20-18)/20 = 0.10, meets the floor
    const expectedWeight = (stake * 10n) / 100n;
    expect(weight).to.equal(expectedWeight);
  });

  it("Under 20, count=25 → LOSE (payout=0)", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(0, 20, 0, stake);
    await lockAndSettle(market, oracle, 25);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.equal(0);
  });

  // ─── OVER BET TESTS ───────────────────────────────────

  it("Over 10, count=30 → WIN with high payout", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(1, 10, 0, stake); // OVER 10
    await lockAndSettle(market, oracle, 30);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    // (30-10)/30 = 0.6667 → weight ≈ 66.67 AMBER. Solidity truncates.
    expect(weight).to.be.gt(0);
    // Use closeTo to handle integer division truncation
    const expected = (stake * 20n) / 30n;
    // Within 1e3 wei tolerance for rounding
    expect(weight).to.be.closeTo(expected, ethers.parseUnits("1", 3));
  });

  it("Over 10, count=12 → WIN with low payout (score≈0.17)", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(1, 10, 0, stake); // OVER 10
    await lockAndSettle(market, oracle, 12);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    const expected = (stake * 2n) / 12n; // (12 - 10) / 12
    expect(weight).to.be.closeTo(expected, ethers.parseUnits("1", 3));
  });

  it("Over 10, count=5 → LOSE", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(1, 10, 0, stake);
    await lockAndSettle(market, oracle, 5);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.equal(0);
  });

  // ─── RANGE BET TESTS ──────────────────────────────────

  it("Range [10,20], count=15 → WIN with flat weight", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(2, 10, 20, stake); // RANGE [10,20]
    await lockAndSettle(market, oracle, 15);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.equal(stake); // flat 1.0 weight
  });

  it("Range [10,20], count=25 → LOSE", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(2, 10, 20, stake);
    await lockAndSettle(market, oracle, 25);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.equal(0);
  });

  // ─── EXACT BET TESTS ──────────────────────────────────

  it("Exact 15, count=15 → WIN with 2x weight", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(3, 15, 0, stake); // EXACT 15
    await lockAndSettle(market, oracle, 15);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.equal(stake * 2n); // 2x bonus
  });

  it("Exact 15, count=16 → WIN (within ±1 tolerance)", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(3, 15, 0, stake);
    await lockAndSettle(market, oracle, 16);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.equal(stake * 2n); // still wins with tolerance
  });

  it("Exact 15, count=17 → LOSE (diff=2 > tolerance=1)", async function () {
    const { oracle, alice, market, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(3, 15, 0, stake);
    await lockAndSettle(market, oracle, 17);

    const mId = await market.marketId();
    const weight = await market.betWeights(mId, alice.address);
    expect(weight).to.equal(0);
  });

  // ─── MIXED BET TYPES ──────────────────────────────────

  it("Mixed bets: Under + Over + Exact, pool math is correct", async function () {
    const { oracle, alice, bob, carol, market, amber, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(0, 20, 0, stake);  // UNDER 20
    await market.connect(bob).placeBet(1, 10, 0, stake);    // OVER 10
    await market.connect(carol).placeBet(3, 15, 0, stake);  // EXACT 15

    // Total staked = 300 AMBER
    await lockAndSettle(market, oracle, 15);

    // Count=15: Under 20 wins (15<20), Over 10 wins (15>10), Exact 15 wins
    const mId = await market.marketId();

    // All should win
    const wAlice = await market.betWeights(mId, alice.address);
    const wBob = await market.betWeights(mId, bob.address);
    const wCarol = await market.betWeights(mId, carol.address);
    const marketData = await market.getMarket(mId);

    expect(wAlice).to.be.gt(0);
    expect(wBob).to.be.gt(0);
    expect(wCarol).to.be.gt(0);

    // Claim winnings and verify payout sum ≈ netPool
    const aliceBefore = await amber.balanceOf(alice.address);
    const bobBefore = await amber.balanceOf(bob.address);
    const carolBefore = await amber.balanceOf(carol.address);

    await market.connect(alice).claimWinnings(mId);
    await market.connect(bob).claimWinnings(mId);
    await market.connect(carol).claimWinnings(mId);

    const aliceAfter = await amber.balanceOf(alice.address);
    const bobAfter = await amber.balanceOf(bob.address);
    const carolAfter = await amber.balanceOf(carol.address);

    const payoutAlice = aliceAfter - aliceBefore;
    const payoutBob = bobAfter - bobBefore;
    const payoutCarol = carolAfter - carolBefore;
    const payoutSum = payoutAlice + payoutBob + payoutCarol;

    const netPool = marketData.netPool;
    expect(payoutSum).to.be.lte(netPool);
    // Integer division can leave tiny dust. Ensure it is negligible.
    expect(netPool - payoutSum).to.be.lt(3n);
  });

  // ─── NO WINNERS ────────────────────────────────────────

  it("No winners: all bets lose, tokens stay in contract", async function () {
    const { oracle, alice, bob, market, amber, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("100", 18);
    const marketAddr = await market.getAddress();

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(0, 5, 0, stake);   // UNDER 5
    await market.connect(bob).placeBet(1, 50, 0, stake);    // OVER 50

    // Count=20: Under 5 loses (20 >= 5), Over 50 loses (20 <= 50)
    await lockAndSettle(market, oracle, 20);

    const mId = await market.marketId();
    const wAlice = await market.betWeights(mId, alice.address);
    const wBob = await market.betWeights(mId, bob.address);
    expect(wAlice).to.equal(0);
    expect(wBob).to.equal(0);

    const contractBalBeforeClaims = await amber.balanceOf(marketAddr);

    // Claiming should emit 0 payout
    await expect(market.connect(alice).claimWinnings(mId))
      .to.emit(market, "WinningsClaimed")
      .withArgs(mId, alice.address, 0);

    await expect(market.connect(bob).claimWinnings(mId))
      .to.emit(market, "WinningsClaimed")
      .withArgs(mId, bob.address, 0);

    const contractBalAfterClaims = await amber.balanceOf(marketAddr);
    expect(contractBalAfterClaims).to.equal(contractBalBeforeClaims);
  });

  // ─── FEE DEDUCTIONS ───────────────────────────────────

  it("Platform fee (3%) is deducted correctly", async function () {
    const { feeRecipient, oracle, alice, market, amber, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("1000", 18);

    const feeRecipientBefore = await amber.balanceOf(feeRecipient.address);

    await openMarket(market, oracle, junctionId);
    await market.connect(alice).placeBet(0, 50, 0, stake); // UNDER 50
    await lockAndSettle(market, oracle, 10);

    const feeRecipientAfter = await amber.balanceOf(feeRecipient.address);
    const fee = feeRecipientAfter - feeRecipientBefore;

    // 3% of 1000 = 30 AMBER
    expect(fee).to.equal(ethers.parseUnits("30", 18));
  });

  it("NFT royalty + platform fee routing: owner gets 0.5%, feeRecipient gets 3%", async function () {
    const { oracle, feeRecipient, alice, bob, market, nft, amber, junctionId } = await loadFixture(deployFixture);
    const stake = ethers.parseUnits("1000", 18);

    // Alice buys the junction and becomes royalty recipient.
    await nft.connect(alice).buyJunction(junctionId);
    expect(await nft.getOwnerOfJunction(junctionId)).to.equal(alice.address);

    await openMarket(market, oracle, junctionId);
    await market.connect(bob).placeBet(2, 10, 20, stake); // RANGE

    const aliceBefore = await amber.balanceOf(alice.address);
    const feeRecipientBefore = await amber.balanceOf(feeRecipient.address);

    await lockAndSettle(market, oracle, 15);

    const aliceAfter = await amber.balanceOf(alice.address);
    const feeRecipientAfter = await amber.balanceOf(feeRecipient.address);

    const royaltyDelta = aliceAfter - aliceBefore;
    const feeDelta = feeRecipientAfter - feeRecipientBefore;

    // 0.5% and 3% of 1000 AMBER respectively
    expect(royaltyDelta).to.equal(ethers.parseUnits("5", 18));
    expect(feeDelta).to.equal(ethers.parseUnits("30", 18));
  });
});
