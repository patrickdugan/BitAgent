// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces.sol";

contract ThorchainDepositAdapter {
    using SafeERC20 for IERC20;

    error EthAmountMismatch();
    error UnsupportedNativeAsset();

    address public immutable router;
    address public immutable owner;
    address public constant NATIVE_ASSET = address(0);

    event ThorDepositRequested(
        address indexed sender,
        address indexed vault,
        address indexed asset,
        uint256 amount,
        string memo,
        uint256 expiry
    );

    constructor(address _router) {
        router = _router;
        owner = msg.sender;
    }

    function depositErc20(
        address vault,
        address asset,
        uint256 amount,
        string calldata memo,
        uint256 expiry
    ) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(router, amount);
        IThorchainRouter(router).depositWithExpiry(payable(vault), asset, amount, memo, expiry);
        emit ThorDepositRequested(msg.sender, vault, asset, amount, memo, expiry);
    }

    function depositNative(
        address vault,
        uint256 amount,
        string calldata memo,
        uint256 expiry
    ) external payable {
        if (msg.value != amount) revert EthAmountMismatch();
        IThorchainRouter(router).depositWithExpiry{value: amount}(payable(vault), NATIVE_ASSET, amount, memo, expiry);
        emit ThorDepositRequested(msg.sender, vault, NATIVE_ASSET, amount, memo, expiry);
    }
}
