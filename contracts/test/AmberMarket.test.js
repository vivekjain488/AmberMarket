const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AmberMarket", function () {
  async function deploy() {
    const [owner, oracle, alice, bob, feeRecipient] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const AmberMarket = await ethers.getContractFactory("AmberMarket");
    const market = await AmberMarket.deploy(
      owner.address,
      await usdc.getAddress(),
      oracle.address,
      feeRecipient.address,
      300
    );
    await market.waitForDeployment();

    const mint = async (to, amount) => {
      await usdc.mint(to.address, amount);
      await usdc.connect(to).approve(await market.getAddress(), amount);
    };

    return { owner, oracle, alice, bob, feeRecipient, usdc, market, mint };
  }

  it("only oracle can open/lock/submit", async function () {
    const { alice, oracle, market } = await deploy();
    const junctionId = ethers.id("bkc-signal-1");

    await expect(market.connect(alice).openMarket(junctionId)).to.be.revertedWithCustomError(market, "OnlyOracle");

    await market.connect(oracle).openMarket(junctionId);
    await expect(market.connect(alice).lockMarket()).to.be.revertedWithCustomError(market, "OnlyOracle");
    await market.connect(oracle).lockMarket();
    await expect(market.connect(alice).submitCount(10)).to.be.revertedWithCustomError(market, "OnlyOracle");
  });

  it("bet validation and one bet per wallet per market", async function () {
    const { oracle, alice, market, mint } = await deploy();
    const junctionId = ethers.id("bkc-signal-1");

    await market.connect(oracle).openMarket(junctionId);

    await mint(alice, 10n * 1_000_000n);
    await expect(market.connect(alice).placeBet(10, 10, 1_000_000)).to.be.revertedWith("INVALID_RANGE");
    await expect(market.connect(alice).placeBet(10, 25, 1_000_000)).to.be.revertedWith("RANGE_TOO_WIDE");
    await expect(market.connect(alice).placeBet(10, 12, 0)).to.be.revertedWith("BET_TOO_SMALL");

    await market.connect(alice).placeBet(10, 12, 1_000_000);
    await expect(market.connect(alice).placeBet(10, 12, 1_000_000)).to.be.revertedWith("ALREADY_BET");
  });

  it("locks market and prevents further betting", async function () {
    const { oracle, alice, market, mint } = await deploy();
    const junctionId = ethers.id("bkc-signal-1");

    await market.connect(oracle).openMarket(junctionId);
    await mint(alice, 2n * 1_000_000n);
    await market.connect(alice).placeBet(10, 12, 1_000_000);

    await market.connect(oracle).lockMarket();
    await expect(market.connect(alice).placeBet(10, 12, 1_000_000)).to.be.revertedWith("MARKET_NOT_OPEN");
  });

  it("settles and pays winners proportionally", async function () {
    const { oracle, alice, bob, feeRecipient, market, usdc, mint } = await deploy();
    const junctionId = ethers.id("bkc-signal-1");

    await market.connect(oracle).openMarket(junctionId);

    await mint(alice, 10n * 1_000_000n);
    await mint(bob, 10n * 1_000_000n);

    // carCount=20 => tolerance [17,23]
    await market.connect(alice).placeBet(18, 19, 5_000_000); // winner
    await market.connect(bob).placeBet(0, 5, 5_000_000); // loser

    await market.connect(oracle).lockMarket();

    const feeRecipientBefore = await usdc.balanceOf(feeRecipient.address);
    await market.connect(oracle).submitCount(20);
    const feeRecipientAfter = await usdc.balanceOf(feeRecipient.address);
    expect(feeRecipientAfter - feeRecipientBefore).to.equal(300_000n); // 3% of 10 USDC

    const aliceBefore = await usdc.balanceOf(alice.address);
    await market.connect(alice).claimWinnings();
    const aliceAfter = await usdc.balanceOf(alice.address);

    // net pool = 9.7 USDC, only winner stake=W=5 => payout=9.7
    expect(aliceAfter - aliceBefore).to.equal(9_700_000n);

    const bobBefore = await usdc.balanceOf(bob.address);
    await market.connect(bob).claimWinnings();
    const bobAfter = await usdc.balanceOf(bob.address);
    expect(bobAfter - bobBefore).to.equal(0n);
  });
});

