// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IAmberJunctionNFT {
    function getOwnerOfJunction(bytes32 junctionId) external view returns (address);
}

/// @title AmberMarket — CCTV Rush Hour Prediction Engine
/// @notice 4 bet types (Under/Over/Range/Exact) with gradient payouts
contract AmberMarket is Ownable {

    // ─── Enums ───────────────────────────────────────────
    enum MarketState { OPEN, LOCKED, SETTLED }
    enum BetType { UNDER, OVER, RANGE, EXACT }

    // ─── Structs ─────────────────────────────────────────
    struct Bet {
        address bettor;
        BetType betType;
        uint16 prediction;   // Single number for UNDER/OVER/EXACT
        uint16 rangeMin;     // Only for RANGE
        uint16 rangeMax;     // Only for RANGE
        uint256 stakeAmount; // In $AMBER (18 decimals)
        bool claimed;
    }

    struct Market {
        bytes32 junctionId;
        MarketState marketState;
        uint256 predictionStart;
        uint256 predictionEnd;
        uint256 settlementCount;       // Final car count from oracle
        uint256 totalStaked;           // Sum of all stakes
        uint256 totalWeightedWinning;  // Sum of weighted scores for winners
        uint256 netPool;               // totalStaked - fees
    }

    // ─── Constants ───────────────────────────────────────
    uint256 public constant MIN_BET = 1e18;          // 1 AMBER minimum
    uint256 public constant MAX_BET = 10_000e18;     // 10,000 AMBER maximum
    uint16 public constant MAX_PREDICTION = 200;     // Max car prediction
    uint16 public constant MAX_RANGE_WIDTH = 15;     // Max range span
    uint16 public constant EXACT_TOLERANCE = 1;      // ±1 for exact bets
    uint256 internal constant SCALE = 1e18;          // Fixed-point scale

    // ─── State ───────────────────────────────────────────
    IERC20 public immutable amberToken;
    address public oracleAddress;
    uint16 public platformFeeBps;
    address public feeRecipient;
    IAmberJunctionNFT public junctionNft;

    uint256 public marketId;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Bet)) public bets;
    mapping(uint256 => mapping(address => uint256)) public betWeights;
    mapping(uint256 => address[]) private bettors;

    // Prediction skill points (junctionId => user => points)
    mapping(bytes32 => mapping(address => uint256)) public userPredictionPoints;

    // ─── Events ──────────────────────────────────────────
    event MarketOpened(uint256 indexed marketId, bytes32 junctionId, uint256 timestamp);
    event BetPlaced(
        uint256 indexed marketId,
        address indexed bettor,
        BetType betType,
        uint16 prediction,
        uint16 rangeMax,
        uint256 stakeAmount
    );
    event MarketLocked(uint256 indexed marketId, uint256 timestamp);
    event MarketSettled(uint256 indexed marketId, uint256 carCount);
    event WinningsClaimed(uint256 indexed marketId, address indexed bettor, uint256 payout);

    // ─── Errors ──────────────────────────────────────────
    error OnlyOracle();

    modifier onlyOracle() {
        if (msg.sender != oracleAddress) revert OnlyOracle();
        _;
    }

    // ─── Constructor ─────────────────────────────────────
    constructor(
        address owner_,
        address amberToken_,
        address oracle_,
        address feeRecipient_,
        uint16 platformFeeBps_
    ) Ownable(owner_) {
        require(amberToken_ != address(0), "INVALID_TOKEN");
        require(oracle_ != address(0), "INVALID_ORACLE");
        require(feeRecipient_ != address(0), "INVALID_FEE_RECIPIENT");
        require(platformFeeBps_ <= 2000, "FEE_TOO_HIGH");

        amberToken = IERC20(amberToken_);
        oracleAddress = oracle_;
        feeRecipient = feeRecipient_;
        platformFeeBps = platformFeeBps_;
    }

    // ─── Admin ───────────────────────────────────────────
    function setOracle(address oracle_) external onlyOwner {
        require(oracle_ != address(0), "INVALID_ORACLE");
        oracleAddress = oracle_;
    }

    function setFee(uint16 bps, address recipient) external onlyOwner {
        require(recipient != address(0), "INVALID_FEE_RECIPIENT");
        require(bps <= 2000, "FEE_TOO_HIGH");
        platformFeeBps = bps;
        feeRecipient = recipient;
    }

    function setJunctionNFT(address nft_) external onlyOwner {
        require(nft_ != address(0), "INVALID_NFT");
        junctionNft = IAmberJunctionNFT(nft_);
    }

    // ─── Views ───────────────────────────────────────────
    function getCurrentMarket() external view returns (Market memory) {
        return markets[marketId];
    }

    function getMarket(uint256 id) external view returns (Market memory) {
        return markets[id];
    }

    function getBettors(uint256 id) external view returns (address[] memory) {
        return bettors[id];
    }

    function getBet(uint256 id, address user) external view returns (Bet memory) {
        return bets[id][user];
    }

    // ─── Oracle: Open Market ─────────────────────────────
    function openMarket(bytes32 junctionId_) external onlyOracle {
        require(junctionId_ != bytes32(0), "INVALID_JUNCTION");

        marketId += 1;
        markets[marketId] = Market({
            junctionId: junctionId_,
            marketState: MarketState.OPEN,
            predictionStart: block.timestamp,
            predictionEnd: 0,
            settlementCount: 0,
            totalStaked: 0,
            totalWeightedWinning: 0,
            netPool: 0
        });

        emit MarketOpened(marketId, junctionId_, block.timestamp);
    }

    // ─── Player: Place Bet ───────────────────────────────
    /// @notice Place a bet on the current market
    /// @param betType 0=UNDER, 1=OVER, 2=RANGE, 3=EXACT
    /// @param prediction The number (for UNDER/OVER/EXACT) or rangeMin (for RANGE)
    /// @param rangeMax   The rangeMax (only for RANGE; ignored otherwise)
    /// @param stakeAmount Amount of $AMBER to stake (18 decimals)
    function placeBet(
        BetType betType,
        uint16 prediction,
        uint16 rangeMax,
        uint256 stakeAmount
    ) external {
        Market storage m = markets[marketId];
        require(m.marketState == MarketState.OPEN, "MARKET_NOT_OPEN");
        require(stakeAmount >= MIN_BET, "BET_TOO_SMALL");
        require(stakeAmount <= MAX_BET, "BET_TOO_LARGE");
        require(bets[marketId][msg.sender].stakeAmount == 0, "ALREADY_BET");

        // Validate per bet type
        if (betType == BetType.UNDER || betType == BetType.OVER) {
            require(prediction > 0 && prediction <= MAX_PREDICTION, "INVALID_PREDICTION");
        } else if (betType == BetType.RANGE) {
            require(prediction < rangeMax, "MIN_GTE_MAX");
            require(rangeMax - prediction <= MAX_RANGE_WIDTH, "RANGE_TOO_WIDE");
            require(rangeMax <= MAX_PREDICTION, "RANGE_TOO_HIGH");
        } else if (betType == BetType.EXACT) {
            require(prediction <= MAX_PREDICTION, "INVALID_PREDICTION");
        }

        // Transfer $AMBER from player
        require(amberToken.transferFrom(msg.sender, address(this), stakeAmount), "TRANSFER_FAILED");

        uint16 rMin = betType == BetType.RANGE ? prediction : 0;
        uint16 rMax = betType == BetType.RANGE ? rangeMax : 0;

        bets[marketId][msg.sender] = Bet({
            bettor: msg.sender,
            betType: betType,
            prediction: prediction,
            rangeMin: rMin,
            rangeMax: rMax,
            stakeAmount: stakeAmount,
            claimed: false
        });
        bettors[marketId].push(msg.sender);
        m.totalStaked += stakeAmount;

        emit BetPlaced(marketId, msg.sender, betType, prediction, rMax, stakeAmount);
    }

    // ─── Oracle: Lock Market ─────────────────────────────
    function lockMarket() external onlyOracle {
        Market storage m = markets[marketId];
        require(m.marketState == MarketState.OPEN, "MARKET_NOT_OPEN");
        m.marketState = MarketState.LOCKED;
        m.predictionEnd = block.timestamp;
        emit MarketLocked(marketId, block.timestamp);
    }

    // ─── Oracle: Submit Count (Settlement) ───────────────
    function submitCount(uint256 carCount) external onlyOracle {
        Market storage m = markets[marketId];
        require(m.marketState == MarketState.LOCKED, "NOT_LOCKED");

        m.settlementCount = carCount;

        // Calculate weighted winnings for every bettor
        uint256 totalWeighted = 0;
        address[] storage bs = bettors[marketId];

        for (uint256 i = 0; i < bs.length; i++) {
            Bet storage b = bets[marketId][bs[i]];
            uint256 weight = _calculateWeight(b, carCount);
            betWeights[marketId][bs[i]] = weight;
            totalWeighted += weight;
        }
        m.totalWeightedWinning = totalWeighted;

        // Deduct platform fee (3%)
        uint256 platformFee = (m.totalStaked * platformFeeBps) / 10000;

        // Deduct NFT royalty (0.5%)
        uint256 nftRoyalty = 0;
        if (address(junctionNft) != address(0)) {
            address jOwner = junctionNft.getOwnerOfJunction(m.junctionId);
            if (jOwner != address(0)) {
                nftRoyalty = (m.totalStaked * 50) / 10000;
                amberToken.transfer(jOwner, nftRoyalty);
            }
        }

        m.netPool = m.totalStaked - platformFee - nftRoyalty;
        if (platformFee > 0) {
            amberToken.transfer(feeRecipient, platformFee);
        }

        m.marketState = MarketState.SETTLED;
        emit MarketSettled(marketId, carCount);
    }

    // ─── Player: Claim Winnings ──────────────────────────
    function claimWinnings(uint256 marketId_) external {
        Market storage m = markets[marketId_];
        require(m.marketState == MarketState.SETTLED, "NOT_SETTLED");

        Bet storage b = bets[marketId_][msg.sender];
        require(b.stakeAmount > 0, "NO_BET");
        require(!b.claimed, "ALREADY_CLAIMED");
        b.claimed = true;

        uint256 weight = betWeights[marketId_][msg.sender];
        if (weight == 0) {
            // Lost — money stays in pool for winners
            emit WinningsClaimed(marketId_, msg.sender, 0);
            return;
        }

        require(m.totalWeightedWinning > 0, "NO_WINNERS");

        uint256 payout = (weight * m.netPool) / m.totalWeightedWinning;

        // Record skill point for this junction
        userPredictionPoints[m.junctionId][msg.sender] += 1;

        amberToken.transfer(msg.sender, payout);
        emit WinningsClaimed(marketId_, msg.sender, payout);
    }

    // ─── Internal: Gradient Scoring Engine ───────────────
    /// @dev Returns 0 for losers, or a weighted score for winners
    /// Under/Over use gradient scoring; Range uses flat; Exact gets 2x bonus
    function _calculateWeight(Bet storage b, uint256 carCount) internal view returns (uint256) {
        if (b.betType == BetType.UNDER) {
            // Wins when actual < prediction
            if (carCount >= uint256(b.prediction)) return 0;

            // Score = (prediction - actual) / prediction — further under = higher score
            uint256 diff = uint256(b.prediction) - carCount;
            uint256 score = (diff * SCALE) / uint256(b.prediction);
            if (score < SCALE / 10) score = SCALE / 10; // floor at 10%
            return (b.stakeAmount * score) / SCALE;

        } else if (b.betType == BetType.OVER) {
            // Wins when actual > prediction
            if (carCount <= uint256(b.prediction)) return 0;

            // Score = (actual - prediction) / actual — further over = higher score
            uint256 diff = carCount - uint256(b.prediction);
            uint256 score = (diff * SCALE) / carCount;
            if (score < SCALE / 10) score = SCALE / 10; // floor at 10%
            return (b.stakeAmount * score) / SCALE;

        } else if (b.betType == BetType.RANGE) {
            // Wins when actual ∈ [rangeMin, rangeMax]
            if (carCount < uint256(b.rangeMin) || carCount > uint256(b.rangeMax)) return 0;
            return b.stakeAmount; // flat weight = 1.0x

        } else if (b.betType == BetType.EXACT) {
            // Wins when |actual - prediction| <= EXACT_TOLERANCE
            uint256 diff = carCount > uint256(b.prediction)
                ? carCount - uint256(b.prediction)
                : uint256(b.prediction) - carCount;
            if (diff > uint256(EXACT_TOLERANCE)) return 0;
            return b.stakeAmount * 2; // 2x weight bonus for exact
        }

        return 0;
    }
}
