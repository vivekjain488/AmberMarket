// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAmberMarket {
    function userPredictionPoints(bytes32 junctionId, address user) external view returns (uint256);
}

/// @title AmberJunctionNFT — Own traffic junctions and earn 0.5% royalties
contract AmberJunctionNFT is ERC721, Ownable {
    IAmberMarket public amberMarket;
    IERC20 public immutable amberToken;

    uint256 public constant BASE_PRICE = 100e18;     // 100 AMBER
    uint256 public constant DISCOUNT_PER_POINT = 5;  // 5% discount per point
    uint256 public constant MAX_DISCOUNT = 50;       // max 50% discount

    mapping(bytes32 => uint256) public junctionToTokenId;
    mapping(uint256 => bytes32) public tokenIdToJunction;

    uint256 private _nextTokenId = 1;

    event JunctionPurchased(bytes32 indexed junctionId, address indexed owner, uint256 tokenId, uint256 price);

    constructor(address initialOwner, address amberToken_) ERC721("Amber Junction NFT", "AMBJ") Ownable(initialOwner) {
        require(amberToken_ != address(0), "INVALID_TOKEN");
        amberToken = IERC20(amberToken_);
    }

    function setAmberMarket(address market_) external onlyOwner {
        require(market_ != address(0), "INVALID_MARKET");
        amberMarket = IAmberMarket(market_);
    }

    function getOwnerOfJunction(bytes32 junctionId) external view returns (address) {
        uint256 tokenId = junctionToTokenId[junctionId];
        if (tokenId == 0) return address(0);
        return ownerOf(tokenId);
    }

    function getDiscountedPrice(bytes32 junctionId, address user) public view returns (uint256) {
        if (address(amberMarket) == address(0)) return BASE_PRICE;

        uint256 points = amberMarket.userPredictionPoints(junctionId, user);
        uint256 discountPercent = points * DISCOUNT_PER_POINT;
        if (discountPercent > MAX_DISCOUNT) {
            discountPercent = MAX_DISCOUNT;
        }
        return (BASE_PRICE * (100 - discountPercent)) / 100;
    }

    function buyJunction(bytes32 junctionId) external {
        require(junctionId != bytes32(0), "INVALID_JUNCTION");
        require(junctionToTokenId[junctionId] == 0, "ALREADY_OWNED");
        require(address(amberMarket) != address(0), "MARKET_NOT_SET");

        uint256 price = getDiscountedPrice(junctionId, msg.sender);

        require(amberToken.transferFrom(msg.sender, owner(), price), "TRANSFER_FAILED");

        uint256 tokenId = _nextTokenId++;
        junctionToTokenId[junctionId] = tokenId;
        tokenIdToJunction[tokenId] = junctionId;

        _mint(msg.sender, tokenId);

        emit JunctionPurchased(junctionId, msg.sender, tokenId, price);
    }
}
