import type { InboundUtxoReceipt, ProceduralTemplateContext, TlWebPhantomIntent } from "../types.js";

function payloadHex(payload: string) {
  return Buffer.from(payload, "utf8").toString("hex");
}

export function buildTlWebPhantomIntent(input: {
  receipt: InboundUtxoReceipt;
  procedural: ProceduralTemplateContext;
  absorbPayload: string;
}): TlWebPhantomIntent {
  return {
    provider: "phantom",
    target: "tlweb",
    network: input.receipt.destinationChain,
    sourceChain: input.receipt.sourceChain,
    receipt: input.receipt,
    procedural: input.procedural,
    actions: [
      {
        kind: "token_issue",
        payload: input.procedural.issuePayload || "",
        payloadHex: payloadHex(input.procedural.issuePayload || ""),
        meta: {
          proceduralType: Number(process.env.TL_PROCEDURAL_TYPE || 1),
          templateHash: input.procedural.templateHash
        }
      },
      {
        kind: "grant_managed",
        payload: input.absorbPayload,
        payloadHex: payloadHex(input.absorbPayload),
        meta: {
          templateId: input.procedural.templateId,
          contractId: input.procedural.contractId,
          settlementState: input.procedural.settlementState
        }
      }
    ]
  };
}
