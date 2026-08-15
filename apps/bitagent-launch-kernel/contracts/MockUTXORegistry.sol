// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockUTXORegistry {
    struct UTXO {
        bytes32 txid;
        uint32 vout;
        uint64 sats;
        address owner;
        bool spent;
    }

    mapping(bytes32 => UTXO) public utxos;

    event Registered(bytes32 indexed utxoRef, bytes32 indexed txid, uint32 vout, uint64 sats, address owner);
    event Spent(bytes32 indexed utxoRef, address indexed spender);

    function computeRef(bytes32 txid, uint32 vout) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(txid, vout));
    }

    function register(bytes32 txid, uint32 vout, uint64 sats, address owner) external returns (bytes32 utxoRef) {
        utxoRef = computeRef(txid, vout);
        require(utxos[utxoRef].owner == address(0), "already registered");
        utxos[utxoRef] = UTXO({
            txid: txid,
            vout: vout,
            sats: sats,
            owner: owner,
            spent: false
        });
        emit Registered(utxoRef, txid, vout, sats, owner);
    }

    function markSpent(bytes32 utxoRef) external {
        UTXO storage utxo = utxos[utxoRef];
        require(utxo.owner != address(0), "missing utxo");
        require(!utxo.spent, "already spent");
        utxo.spent = true;
        emit Spent(utxoRef, msg.sender);
    }
}
