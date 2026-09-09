// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract JunctionRegistry is Ownable {
    struct Junction {
        bytes32 id;
        string name;
        uint8 roadCount;
        int32 latE7;
        int32 lngE7;
        bool exists;
    }

    mapping(bytes32 => Junction) private junctions;
    bytes32[] private junctionIds;

    event JunctionRegistered(bytes32 indexed id, string name, uint8 roadCount, int32 latE7, int32 lngE7);

    constructor(address owner_) Ownable(owner_) {}

    function registerJunction(bytes32 id, string calldata name, uint8 roadCount, int32 latE7, int32 lngE7)
        external
        onlyOwner
    {
        require(id != bytes32(0), "INVALID_ID");
        require(!junctions[id].exists, "ALREADY_EXISTS");
        require(roadCount >= 2 && roadCount <= 5, "INVALID_ROAD_COUNT");

        junctions[id] = Junction({id: id, name: name, roadCount: roadCount, latE7: latE7, lngE7: lngE7, exists: true});
        junctionIds.push(id);

        emit JunctionRegistered(id, name, roadCount, latE7, lngE7);
    }

    function getJunction(bytes32 id) external view returns (Junction memory) {
        require(junctions[id].exists, "NOT_FOUND");
        return junctions[id];
    }

    function getAllJunctionIds() external view returns (bytes32[] memory) {
        return junctionIds;
    }

    function getMultiplierTier(bytes32 id) external view returns (uint8) {
        require(junctions[id].exists, "NOT_FOUND");
        uint8 rc = junctions[id].roadCount;
        if (rc <= 2) return 1;
        if (rc == 3) return 2;
        if (rc == 4) return 3;
        return 4;
    }
}

