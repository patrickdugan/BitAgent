export type TradeLayerActivationSource =
  | { kind: "bitcoin_transaction"; chainDerived: true; txid: string; blockHeight: number }
  | { kind: "local_db_seed"; chainDerived: false; profileId?: string }
  | { kind: "legacy_unknown"; chainDerived: false };

type PublicRecord = Record<string, unknown>;

export function normalizeTradeLayerActivationSource(value: unknown): TradeLayerActivationSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "legacy_unknown", chainDerived: false };
  }
  const source = value as PublicRecord;
  if (source.kind === "bitcoin_transaction" && source.chainDerived === true) {
    const txid = String(source.txid || "").trim().toLowerCase();
    const blockHeight = Number(source.blockHeight);
    if (/^[a-f0-9]{64}$/.test(txid) && Number.isSafeInteger(blockHeight) && blockHeight >= 0) {
      return { kind: "bitcoin_transaction", chainDerived: true, txid, blockHeight };
    }
  }
  if (source.kind === "local_db_seed") {
    const profileId = String(source.profileId || "").trim();
    return {
      kind: "local_db_seed",
      chainDerived: false,
      ...(profileId ? { profileId } : {})
    };
  }
  return { kind: "legacy_unknown", chainDerived: false };
}

export function isChainDerivedTradeLayerActivation(
  source: TradeLayerActivationSource,
  activationBlock: number | null
): boolean {
  return source.kind === "bitcoin_transaction"
    && source.chainDerived === true
    && activationBlock !== null
    && source.blockHeight === activationBlock;
}
