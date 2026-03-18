// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces.sol";

contract MockTradeLayerIngress is ITradeLayerIngress {
    event UtxoAbsorbed(bytes32 indexed utxoRef, uint64 sats, bytes extraData);

    struct Absorbed {
        bytes32 utxoRef;
        uint64 sats;
        bytes extraData;
        uint256 timestamp;
    }

    Absorbed[] public absorbed;

    function absorbUtxoRef(bytes32 utxoRef, uint64 sats, bytes calldata extraData) external override {
        absorbed.push(Absorbed({
            utxoRef: utxoRef,
            sats: sats,
            extraData: extraData,
            timestamp: block.timestamp
        }));
        emit UtxoAbsorbed(utxoRef, sats, extraData);
    }
}
