import type { EvmTemplateCommitment, InboundUtxoReceipt, ProceduralTemplateContext } from "../types.js";
import { IntegrationBoundaryError } from "../types.js";
import { buildEvmTemplateCommitment } from "./evmTemplateAdapter.js";

export function verifyReceiptAgainstCommitment(input: {
  receipt: InboundUtxoReceipt;
  procedural: ProceduralTemplateContext;
  commitment: EvmTemplateCommitment;
  depositor?: string;
  nonce?: bigint;
}) {
  const recomputed = buildEvmTemplateCommitment({
    receipt: input.receipt,
    procedural: input.procedural,
    depositor: input.depositor,
    nonce: input.nonce
  });

  if (recomputed.depositId !== input.commitment.depositId) {
    throw new IntegrationBoundaryError("utxo_ref_map_error", "EVM template commitment depositId mismatch", {
      expected: input.commitment.depositId,
      actual: recomputed.depositId
    });
  }

  if (recomputed.templateHash.toLowerCase() !== input.commitment.templateHash.toLowerCase()) {
    throw new IntegrationBoundaryError("utxo_ref_map_error", "EVM template commitment templateHash mismatch", {
      expected: input.commitment.templateHash,
      actual: recomputed.templateHash
    });
  }

  if (recomputed.thorMemoHash.toLowerCase() !== input.commitment.thorMemoHash.toLowerCase()) {
    throw new IntegrationBoundaryError("utxo_ref_map_error", "EVM template commitment thorMemoHash mismatch", {
      expected: input.commitment.thorMemoHash,
      actual: recomputed.thorMemoHash
    });
  }

  if (recomputed.destinationScriptCommitment.toLowerCase() !== input.commitment.destinationScriptCommitment.toLowerCase()) {
    throw new IntegrationBoundaryError("utxo_ref_map_error", "EVM template commitment destinationScriptCommitment mismatch", {
      expected: input.commitment.destinationScriptCommitment,
      actual: recomputed.destinationScriptCommitment
    });
  }

  return recomputed;
}
