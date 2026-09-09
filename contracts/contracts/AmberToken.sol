// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AmberToken — The native currency of the CCTV Rush Hour prediction game
/// @notice ERC-20 with 18 decimals, built-in faucet for testnet, and owner-mint for rewards
contract AmberToken is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 10_000_000 * 1e18; // 10M tokens
    uint256 public constant FAUCET_AMOUNT = 1000 * 1e18;        // 1000 per claim
    mapping(address => uint256) public lastFaucetClaim;

    constructor(address owner_) ERC20("Amber Token", "AMBER") Ownable(owner_) {
        _mint(owner_, INITIAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @notice Anyone can claim 1000 $AMBER once every 24 hours (testnet faucet)
    function faucet() external {
        require(
            block.timestamp - lastFaucetClaim[msg.sender] >= 1 days,
            "FAUCET_COOLDOWN"
        );
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner can mint for rewards, airdrops, leaderboard prizes
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
