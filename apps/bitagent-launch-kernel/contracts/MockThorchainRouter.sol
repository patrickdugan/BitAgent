// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockThorchainRouter {
    event DepositObserved(
        address indexed vault,
        address indexed asset,
        uint256 amount,
        string memo,
        uint256 expiry,
        uint256 value
    );

    function depositWithExpiry(
        address payable vault,
        address asset,
        uint256 amount,
        string calldata memo,
        uint256 expiry
    ) external payable {
        emit DepositObserved(vault, asset, amount, memo, expiry, msg.value);
    }
}
