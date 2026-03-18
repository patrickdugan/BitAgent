import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import type { DlcPreparationHook } from "../types.js";

const require = createRequire(import.meta.url);

export class ArkDlcPreparationAdapter implements DlcPreparationHook {
  private readonly bridgeName: string;

  constructor() {
    try {
      const { ArkTradeLayerBridge } = require(
        path.join(externalRepos.ark, "tl-vtxo-handshake-optimized", "ark-tradelayer-handshake.js")
      );
      this.bridgeName = ArkTradeLayerBridge.name || "ArkTradeLayerBridge";
    } catch {
      this.bridgeName = "ArkTradeLayerBridgeStub";
    }
  }

  async prepareFromAbsorbedUtxo(input: { tlTxid: string; utxoRef: string; walletAccount?: string }) {
    return {
      dlcCandidateId: `${input.tlTxid}:${input.utxoRef}`,
      relayPayload: {
        bridge: this.bridgeName,
        walletAccount: input.walletAccount || null,
        utxoRef: input.utxoRef
      },
      status: "stub" as const
    };
  }
}
