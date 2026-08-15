import { ethers } from "ethers";
import type { EvmTemplateCommitment, InboundUtxoReceipt, ProceduralTemplateContext } from "../types.js";

const settlementStateCodes: Record<string, number> = {
  TEMPLATE: 0,
  FUNDED: 1,
  OPEN: 2,
  SETTLED: 3,
  CLOSED: 4,
  DISPUTED: 5
};

const destinationChainCodes: Record<string, number> = {
  bitcoin: 0,
  litecoin: 1
};

export function buildEvmTemplateCommitment(input: {
  receipt: InboundUtxoReceipt;
  procedural: ProceduralTemplateContext;
  depositor?: string;
  nonce?: bigint;
}): EvmTemplateCommitment {
  // The deployed compatibility contract calls this a THOR memo hash, but new
  // rails bind the same field to a deterministic route/quote commitment.
  const memo = String(input.receipt.swapRouteCommitment || input.receipt.thorchainMemo || input.receipt.swapQuoteId || "");
  const destinationAddress = String(input.receipt.destinationAddress || "");
  const destinationScriptCommitment = ethers.keccak256(ethers.toUtf8Bytes(destinationAddress));
  const thorMemoHash = ethers.keccak256(ethers.toUtf8Bytes(memo));
  const nonce = input.nonce ?? 1n;
  const depositor = input.depositor || ethers.ZeroAddress;
  const templateHashBytes = input.procedural.templateHash.startsWith("0x")
    ? input.procedural.templateHash
    : `0x${input.procedural.templateHash}`;

  const depositId = ethers.solidityPackedKeccak256(
    ["address", "uint64", "bytes32", "bytes32", "bytes32"],
    [depositor, nonce, templateHashBytes, destinationScriptCommitment, thorMemoHash]
  );

  return {
    depositId,
    templateHash: templateHashBytes,
    destinationScriptCommitment,
    thorMemoHash,
    destinationChain: destinationChainCodes[input.receipt.destinationChain] ?? 0,
    receiptPropertyId: Number(input.procedural.receiptPropertyId || 0),
    collateralPropertyId: Number(input.procedural.collateralPropertyId || 0),
    settlementState: settlementStateCodes[input.procedural.settlementState] ?? 0
  };
}
