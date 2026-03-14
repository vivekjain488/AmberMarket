// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AmberMarket is Ownable {
    enum MarketState {
        OPEN,
        LOCKED,
        SETTLED
    }

    struct Bet {
        address bettor;
        uint16 rangeMin;
        uint16 rangeMax;
        uint256 stakeAmount;
        bool claimed;
    }

    struct Market {
        bytes32 junctionId;
        MarketState marketState;
        uint256 predictionStart;
        uint256 predictionEnd;
        uint256 settlementCount;
        uint256 totalStaked;
        uint256 totalWinningStaked;
        uint256 toleranceLow;
        uint256 toleranceHigh;
        uint256 netPool;
    }

    IERC20 public immutable usdc;
    address public oracleAddress;

    uint256 public marketId;
    Market private currentMarket;

    uint256 public constant MIN_BET = 1e6;
    uint256 public constant MAX_BET = 100e6;
    uint16 public constant MAX_RANGE_WIDTH = 10;
    uint16 public constant MAX_PREDICTION = 150;

    uint16 public platformFeeBps;
    address public feeRecipient;

    mapping(uint256 => mapping(address => Bet)) public bets;
    mapping(uint8 => uint256) public rangeBuckets;
    mapping(uint256 => address[]) private bettors;

    event MarketOpened(uint256 indexed marketId, bytes32 junctionId, uint256 timestamp);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, uint16 rangeMin, uint16 rangeMax, uint256 stakeAmount);
    event MarketLocked(uint256 indexed marketId, uint256 timestamp);
    event MarketSettled(uint256 indexed marketId, uint256 carCount, uint256 toleranceLow, uint256 toleranceHigh);
    event WinningsClaimed(uint256 indexed marketId, address indexed bettor, uint256 payout);

    error OnlyOracle();

    modifier onlyOracle() {
        if (msg.sender != oracleAddress) revert OnlyOracle();
        _;
    }

    constructor(
        address owner_,
        address usdc_,
        address oracle_,
        address feeRecipient_,
        uint16 platformFeeBps_
    )
        Ownable(owner_)
    {
        require(usdc_ != address(0), "INVALID_USDC");
        require(oracle_ != address(0), "INVALID_ORACLE");
        require(feeRecipient_ != address(0), "INVALID_FEE_RECIPIENT");
        require(platformFeeBps_ <= 2000, "FEE_TOO_HIGH");

        usdc = IERC20(usdc_);
        oracleAddress = oracle_;
        feeRecipient = feeRecipient_;
        platformFeeBps = platformFeeBps_;
    }

    function setOracle(address oracle_) external onlyOwner {
        require(oracle_ != address(0), "INVALID_ORACLE");
        oracleAddress = oracle_;
    }

    function setFee(uint16 platformFeeBps_, address feeRecipient_) external onlyOwner {
        require(feeRecipient_ != address(0), "INVALID_FEE_RECIPIENT");
        require(platformFeeBps_ <= 2000, "FEE_TOO_HIGH");
        platformFeeBps = platformFeeBps_;
        feeRecipient = feeRecipient_;
    }

    function getCurrentMarket() external view returns (Market memory) {
        return currentMarket;
    }

    function getBettors(uint256 marketId_) external view returns (address[] memory) {
        return bettors[marketId_];
    }

    function openMarket(bytes32 junctionId_) external onlyOracle {
        require(junctionId_ != bytes32(0), "INVALID_JUNCTION");

        marketId += 1;
        currentMarket = Market({
            junctionId: junctionId_,
            marketState: MarketState.OPEN,
            predictionStart: block.timestamp,
            predictionEnd: 0,
            settlementCount: 0,
            totalStaked: 0,
            totalWinningStaked: 0,
            toleranceLow: 0,
            toleranceHigh: 0,
            netPool: 0
        });

        emit MarketOpened(marketId, junctionId_, block.timestamp);
    }

    function placeBet(uint16 rangeMin, uint16 rangeMax, uint256 stakeAmount) external {
        require(currentMarket.marketState == MarketState.OPEN, "MARKET_NOT_OPEN");
        require(rangeMin < rangeMax, "INVALID_RANGE");
        require(rangeMax - rangeMin <= MAX_RANGE_WIDTH, "RANGE_TOO_WIDE");
        require(rangeMax <= MAX_PREDICTION, "RANGE_TOO_HIGH");
        require(stakeAmount >= MIN_BET, "BET_TOO_SMALL");
        require(stakeAmount <= MAX_BET, "BET_TOO_LARGE");

        Bet storage existing = bets[marketId][msg.sender];
        require(existing.stakeAmount == 0, "ALREADY_BET");

        bool ok = usdc.transferFrom(msg.sender, address(this), stakeAmount);
        require(ok, "USDC_TRANSFER_FAILED");

        bets[marketId][msg.sender] = Bet({
            bettor: msg.sender,
            rangeMin: rangeMin,
            rangeMax: rangeMax,
            stakeAmount: stakeAmount,
            claimed: false
        });
        bettors[marketId].push(msg.sender);

        currentMarket.totalStaked += stakeAmount;

        uint8 bucket = uint8((uint256(rangeMin) + uint256(rangeMax)) / 2);
        rangeBuckets[bucket] += stakeAmount;

        emit BetPlaced(marketId, msg.sender, rangeMin, rangeMax, stakeAmount);
    }

    function lockMarket() external onlyOracle {
        require(currentMarket.marketState == MarketState.OPEN, "MARKET_NOT_OPEN");
        currentMarket.marketState = MarketState.LOCKED;
        currentMarket.predictionEnd = block.timestamp;
        emit MarketLocked(marketId, block.timestamp);
    }

    function submitCount(uint256 carCount) external onlyOracle {
        require(currentMarket.marketState == MarketState.LOCKED, "MARKET_NOT_LOCKED");

        currentMarket.settlementCount = carCount;

        uint256 toleranceLow = (carCount * 85) / 100;
        uint256 toleranceHigh = (carCount * 115 + 99) / 100;

        currentMarket.toleranceLow = toleranceLow;
        currentMarket.toleranceHigh = toleranceHigh;

        uint256 w = 0;
        address[] storage b = bettors[marketId];
        for (uint256 i = 0; i < b.length; i++) {
            Bet storage bet_ = bets[marketId][b[i]];
            if (_overlaps(bet_.rangeMin, bet_.rangeMax, toleranceLow, toleranceHigh)) {
                w += bet_.stakeAmount;
            }
        }
        currentMarket.totalWinningStaked = w;

        uint256 fee = (currentMarket.totalStaked * platformFeeBps) / 10_000;
        currentMarket.netPool = currentMarket.totalStaked - fee;
        if (fee > 0) {
            bool ok = usdc.transfer(feeRecipient, fee);
            require(ok, "FEE_TRANSFER_FAILED");
        }

        currentMarket.marketState = MarketState.SETTLED;
        emit MarketSettled(marketId, carCount, toleranceLow, toleranceHigh);
    }

    function claimWinnings() external {
        require(currentMarket.marketState == MarketState.SETTLED, "MARKET_NOT_SETTLED");

        Bet storage bet_ = bets[marketId][msg.sender];
        require(bet_.stakeAmount > 0, "NO_BET");
        require(!bet_.claimed, "ALREADY_CLAIMED");

        bet_.claimed = true;

        bool isWinner = _overlaps(bet_.rangeMin, bet_.rangeMax, currentMarket.toleranceLow, currentMarket.toleranceHigh);
        if (!isWinner) {
            emit WinningsClaimed(marketId, msg.sender, 0);
            return;
        }

        require(currentMarket.totalWinningStaked > 0, "NO_WINNERS");

        uint256 payout = (bet_.stakeAmount * currentMarket.netPool) / currentMarket.totalWinningStaked;
        bool ok = usdc.transfer(msg.sender, payout);
        require(ok, "PAYOUT_TRANSFER_FAILED");

        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    function _overlaps(uint16 aMin, uint16 aMax, uint256 bMin, uint256 bMax) internal pure returns (bool) {
        return uint256(aMin) <= bMax && uint256(aMax) >= bMin;
    }
}

