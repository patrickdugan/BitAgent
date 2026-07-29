import { hashObject, opaqueId } from "../launch/canonical.js";
import type { OriginWalletBroker } from "./types.js";

export class ScriptedOriginWalletBroker implements OriginWalletBroker {
  async authorize(input: Parameters<OriginWalletBroker["authorize"]>[0]) {
    return {
      walletApprovalToken: opaqueId("origin_wallet_approval", {
        approvalId: input.approval.id,
        quoteHash: input.approval.quoteHash
      })
    };
  }

  async executeDeposit(input: Parameters<OriginWalletBroker["executeDeposit"]>[0]) {
    if (!input.walletApprovalToken.startsWith("origin_wallet_approval_")) {
      throw new Error("Wallet approval token is invalid");
    }
    return { txHash: hashObject({ quoteId: input.quote.quoteId, token: input.walletApprovalToken }) };
  }
}

export class FailClosedOriginWalletBroker implements OriginWalletBroker {
  async authorize(): Promise<never> {
    throw new Error("No wallet-owned EVM/NEAR origin broker is configured");
  }

  async executeDeposit(): Promise<never> {
    throw new Error("No wallet-owned EVM/NEAR origin broker is configured");
  }
}
