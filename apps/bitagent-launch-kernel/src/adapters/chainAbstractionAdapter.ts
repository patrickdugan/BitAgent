import { prepareNearChainSignature, type NearChainSignaturePreparation } from "./nearChainSignatureAdapter.js";
import type { ChainAbstractionEnvelope } from "../economy/types.js";
import type { CapabilityLease } from "../sovereign/types.js";
import { canonicalHash } from "../survival/policy.js";

export function buildChainAbstractionEnvelope(input: {
  targetChain: ChainAbstractionEnvelope["targetChain"];
  actionType: string;
  payload: unknown;
}): ChainAbstractionEnvelope {
  const payloadHash = canonicalHash(input.payload);
  return {
    envelopeId: canonicalHash({ targetChain: input.targetChain, actionType: input.actionType, payloadHash }),
    targetChain: input.targetChain,
    actionType: input.actionType,
    payloadHash,
    relayable: false,
    status: "unsigned"
  };
}

export function prepareEnvelopeWithNear(input: {
  envelope: ChainAbstractionEnvelope;
  lease: CapabilityLease;
  derivationPath: string;
  nearAccount?: string;
}): ChainAbstractionEnvelope & { signaturePreparation: NearChainSignaturePreparation } {
  const signaturePreparation = prepareNearChainSignature({
    lease: input.lease,
    targetChain: input.envelope.targetChain,
    derivationPath: input.derivationPath,
    payloadHash: input.envelope.payloadHash,
    nearAccount: input.nearAccount
  });
  return { ...input.envelope, signaturePreparation, status: "signature_prepared" };
}

