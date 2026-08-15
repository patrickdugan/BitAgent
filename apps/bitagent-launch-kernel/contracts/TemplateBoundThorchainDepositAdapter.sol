// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces.sol";

contract TemplateBoundThorchainDepositAdapter {
    using SafeERC20 for IERC20;

    error EthAmountMismatch();
    error EmptyTemplateHash();
    error EmptyMemo();

    address public immutable router;
    address public immutable owner;
    address public constant NATIVE_ASSET = address(0);

    struct TemplateBoundDeposit {
        address depositor;
        address vault;
        address asset;
        uint256 amount;
        bytes32 templateHash;
        bytes32 destinationScriptCommitment;
        bytes32 thorMemoHash;
        uint32 destinationChain;
        uint32 receiptPropertyId;
        uint32 collateralPropertyId;
        uint32 settlementState;
        uint64 nonce;
        uint256 expiry;
    }

    mapping(bytes32 => TemplateBoundDeposit) public templateBoundDeposits;
    mapping(address => uint64) public depositorNonces;

    event ThorDepositRequested(
        address indexed sender,
        address indexed vault,
        address indexed asset,
        uint256 amount,
        string memo,
        uint256 expiry
    );

    event TemplateBoundSwapCommitted(
        bytes32 indexed depositId,
        address indexed depositor,
        address indexed asset,
        bytes32 templateHash,
        bytes32 destinationScriptCommitment,
        bytes32 thorMemoHash,
        uint32 destinationChain,
        uint32 receiptPropertyId,
        uint32 collateralPropertyId,
        uint32 settlementState,
        uint64 nonce,
        uint256 amount,
        uint256 expiry
    );

    constructor(address _router) {
        router = _router;
        owner = msg.sender;
    }

    function computeDepositId(
        address depositor,
        uint64 nonce,
        bytes32 templateHash,
        bytes32 destinationScriptCommitment,
        bytes32 thorMemoHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                depositor,
                nonce,
                templateHash,
                destinationScriptCommitment,
                thorMemoHash
            )
        );
    }

    function _commitDeposit(
        address depositor,
        address vault,
        address asset,
        uint256 amount,
        string calldata memo,
        uint256 expiry,
        bytes32 templateHash,
        bytes32 destinationScriptCommitment,
        uint32 destinationChain,
        uint32 receiptPropertyId,
        uint32 collateralPropertyId,
        uint32 settlementState
    ) internal returns (bytes32 depositId) {
        uint64 nonce = ++depositorNonces[depositor];
        bytes32 thorMemoHash = keccak256(bytes(memo));
        depositId = computeDepositId(depositor, nonce, templateHash, destinationScriptCommitment, thorMemoHash);

        templateBoundDeposits[depositId] = TemplateBoundDeposit({
            depositor: depositor,
            vault: vault,
            asset: asset,
            amount: amount,
            templateHash: templateHash,
            destinationScriptCommitment: destinationScriptCommitment,
            thorMemoHash: thorMemoHash,
            destinationChain: destinationChain,
            receiptPropertyId: receiptPropertyId,
            collateralPropertyId: collateralPropertyId,
            settlementState: settlementState,
            nonce: nonce,
            expiry: expiry
        });

        emit TemplateBoundSwapCommitted(
            depositId,
            depositor,
            asset,
            templateHash,
            destinationScriptCommitment,
            thorMemoHash,
            destinationChain,
            receiptPropertyId,
            collateralPropertyId,
            settlementState,
            nonce,
            amount,
            expiry
        );
    }

    function depositErc20WithTemplate(
        address vault,
        address asset,
        uint256 amount,
        string calldata memo,
        uint256 expiry,
        bytes32 templateHash,
        bytes32 destinationScriptCommitment,
        uint32 destinationChain,
        uint32 receiptPropertyId,
        uint32 collateralPropertyId,
        uint32 settlementState
    ) external returns (bytes32 depositId) {
        if (templateHash == bytes32(0)) revert EmptyTemplateHash();
        if (bytes(memo).length == 0) revert EmptyMemo();
        depositId = _commitDeposit(
            msg.sender,
            vault,
            asset,
            amount,
            memo,
            expiry,
            templateHash,
            destinationScriptCommitment,
            destinationChain,
            receiptPropertyId,
            collateralPropertyId,
            settlementState
        );

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(router, amount);
        IThorchainRouter(router).depositWithExpiry(payable(vault), asset, amount, memo, expiry);
        emit ThorDepositRequested(msg.sender, vault, asset, amount, memo, expiry);
    }

    function depositNativeWithTemplate(
        address vault,
        uint256 amount,
        string calldata memo,
        uint256 expiry,
        bytes32 templateHash,
        bytes32 destinationScriptCommitment,
        uint32 destinationChain,
        uint32 receiptPropertyId,
        uint32 collateralPropertyId,
        uint32 settlementState
    ) external payable returns (bytes32 depositId) {
        if (templateHash == bytes32(0)) revert EmptyTemplateHash();
        if (bytes(memo).length == 0) revert EmptyMemo();
        if (msg.value != amount) revert EthAmountMismatch();
        depositId = _commitDeposit(
            msg.sender,
            vault,
            NATIVE_ASSET,
            amount,
            memo,
            expiry,
            templateHash,
            destinationScriptCommitment,
            destinationChain,
            receiptPropertyId,
            collateralPropertyId,
            settlementState
        );

        IThorchainRouter(router).depositWithExpiry{value: amount}(payable(vault), NATIVE_ASSET, amount, memo, expiry);
        emit ThorDepositRequested(msg.sender, vault, NATIVE_ASSET, amount, memo, expiry);
    }
}
