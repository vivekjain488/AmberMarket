export const amberMarketAbi = [
  {
    type: "function",
    name: "placeBet",
    stateMutability: "nonpayable",
    inputs: [
      { name: "rangeMin", type: "uint16" },
      { name: "rangeMax", type: "uint16" },
      { name: "stakeAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimWinnings",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "getCurrentMarket",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "junctionId", type: "bytes32" },
          { name: "marketState", type: "uint8" },
          { name: "predictionStart", type: "uint256" },
          { name: "predictionEnd", type: "uint256" },
          { name: "settlementCount", type: "uint256" },
          { name: "totalStaked", type: "uint256" },
          { name: "totalWinningStaked", type: "uint256" },
          { name: "toleranceLow", type: "uint256" },
          { name: "toleranceHigh", type: "uint256" },
          { name: "netPool", type: "uint256" },
        ],
      },
    ],
  },
  { type: "function", name: "marketId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "event",
    name: "MarketSettled",
    anonymous: false,
    inputs: [
      { indexed: true, name: "marketId", type: "uint256" },
      { indexed: false, name: "carCount", type: "uint256" },
      { indexed: false, name: "toleranceLow", type: "uint256" },
      { indexed: false, name: "toleranceHigh", type: "uint256" },
    ],
  },
];

