// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IThorchainRouter {
    function depositWithExpiry(
        address payable vault,
        address asset,
        uint256 amount,
        string calldata memo,
        uint256 expiry
    ) external payable;
}

interface ITradeLayerIngress {
    function absorbUtxoRef(
        bytes32 utxoRef,
        uint64 sats,
        bytes calldata extraData
    ) external;
}
