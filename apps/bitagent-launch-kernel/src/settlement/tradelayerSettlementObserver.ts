import { createRequire } from "node:module";
import path from "node:path";
import { externalRepos } from "../config.js";
import type { TradeLayerTestnetArtifact } from "../economy/types.js";
import { canonicalHash } from "../survival/policy.js";
import { IntegrationBoundaryError } from "../types.js";
import type {
  BitcoinChainSource,
  DecodedTokenTrade,
  SettlementLifecycleState,
  TradeLayerSettlementReport,
  TradeLegSettlement,
  TradePairSettlement
} from "./types.js";

type ArtifactTradeStep = TradeLayerTestnetArtifact["steps"][number] & {
  txType?: number;
  tradePrintId?: string;
  side?: string;
  payload?: string;
  payloadHex?: string;
};

type TradeLayerDecoder = {
  decodeOnChainTokenForToken(payload: string): DecodedTokenTrade;
};

function loadDecoder(tradelayerRepo: string): TradeLayerDecoder {
  try {
    const require = createRequire(import.meta.url);
    return require(path.join(tradelayerRepo, "src", "txDecoder.js")) as TradeLayerDecoder;
  } catch (error) {
    throw new IntegrationBoundaryError("settlement_error", "Could not load the sibling TradeLayer transaction decoder", error);
  }
}

function decodeTradePayload(payloadHex: string, decoder: TradeLayerDecoder): DecodedTokenTrade {
  const payload = Buffer.from(payloadHex, "hex").toString("utf8");
  if (!payload.startsWith("tl5")) {
    throw new IntegrationBoundaryError("settlement_error", "Observed TradeLayer payload is not a tx5 token trade", { payload });
  }
  return decoder.decodeOnChainTokenForToken(payload.slice(3));
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.00000001;
}

function reciprocal(maker?: DecodedTokenTrade, taker?: DecodedTokenTrade): boolean {
  return Boolean(
    maker &&
      taker &&
      maker.propertyIdOffered === taker.propertyIdDesired &&
      maker.propertyIdDesired === taker.propertyIdOffered &&
      close(maker.amountOffered, taker.amountExpected) &&
      close(maker.amountExpected, taker.amountOffered)
  );
}

async function observeLeg(input: {
  side: "maker" | "taker";
  txid: string | null;
  step: ArtifactTradeStep;
  chainSource: BitcoinChainSource;
  decoder: TradeLayerDecoder;
}): Promise<TradeLegSettlement> {
  const expectedPayloadHex = String(input.step.payloadHex || "").toLowerCase();
  const transitions: SettlementLifecycleState[] = ["planned"];
  if (!input.txid) {
    return {
      side: input.side,
      transitions,
      state: "planned",
      expectedPayloadHex,
      payloadMatches: false,
      confirmations: 0
    };
  }

  transitions.push("broadcast");
  const evidence = await input.chainSource.observeTransaction(input.txid);
  const observedPayloadHex = evidence.payloadHex?.toLowerCase();
  const payloadMatches = Boolean(observedPayloadHex && observedPayloadHex === expectedPayloadHex);
  let decoded: DecodedTokenTrade | undefined;
  if (observedPayloadHex) decoded = decodeTradePayload(observedPayloadHex, input.decoder);

  if (evidence.state === "reorged") transitions.push("reorged");
  else if (evidence.state === "mempool") transitions.push("mempool");
  else if (evidence.state === "confirmed") transitions.push("confirmed");

  return {
    side: input.side,
    txid: input.txid,
    transitions,
    state: transitions[transitions.length - 1]!,
    expectedPayloadHex,
    observedPayloadHex,
    payloadMatches,
    confirmations: evidence.confirmations,
    decoded,
    evidence
  };
}

function findTradeStep(artifact: TradeLayerTestnetArtifact, tradePrintId: string, side: string): ArtifactTradeStep {
  const step = artifact.steps.find((candidate) => {
    const typed = candidate as ArtifactTradeStep;
    return typed.tradePrintId === tradePrintId && typed.side === side;
  }) as ArtifactTradeStep | undefined;
  if (!step?.payloadHex) {
    throw new IntegrationBoundaryError("settlement_error", "TradeLayer artifact is missing an expected trade step", {
      tradePrintId,
      side
    });
  }
  return step;
}

export async function observeTradeLayerSettlement(input: {
  artifact: TradeLayerTestnetArtifact;
  chainSource: BitcoinChainSource;
  minimumConfirmations?: number;
  tradelayerRepo?: string;
  now?: Date;
}): Promise<TradeLayerSettlementReport> {
  const minimumConfirmations = input.minimumConfirmations ?? 1;
  if (!Number.isInteger(minimumConfirmations) || minimumConfirmations < 1) {
    throw new IntegrationBoundaryError("settlement_error", "minimumConfirmations must be a positive integer");
  }
  const decoder = loadDecoder(input.tradelayerRepo || externalRepos.tradelayer);
  const pairs: TradePairSettlement[] = [];

  for (const print of input.artifact.tradePrints) {
    const maker = await observeLeg({
      side: "maker",
      txid: print.makerTxid,
      step: findTradeStep(input.artifact, print.id, "sell-tlbtc"),
      chainSource: input.chainSource,
      decoder
    });
    const taker = await observeLeg({
      side: "taker",
      txid: print.takerTxid,
      step: findTradeStep(input.artifact, print.id, "sell-tlusd"),
      chainSource: input.chainSource,
      decoder
    });
    const transitions: SettlementLifecycleState[] = ["planned"];
    if (maker.txid && taker.txid) transitions.push("broadcast");
    if (maker.state === "reorged" || taker.state === "reorged") {
      transitions.push("reorged");
    } else {
      if (maker.state === "mempool" && taker.state === "mempool") transitions.push("mempool");
      const bothConfirmed = maker.confirmations > 0 && taker.confirmations > 0;
      if (bothConfirmed) transitions.push("confirmed");
      const reciprocalMatch = bothConfirmed && maker.payloadMatches && taker.payloadMatches && reciprocal(maker.decoded, taker.decoded);
      if (reciprocalMatch) transitions.push("matched");
      if (reciprocalMatch && maker.confirmations >= minimumConfirmations && taker.confirmations >= minimumConfirmations) {
        transitions.push("settled");
      }
    }
    const reciprocalMatch = transitions.includes("matched");
    const state = transitions[transitions.length - 1]!;
    const settlementEvidenceHash = state === "settled"
      ? canonicalHash({ tradePrintId: print.id, maker: maker.evidence, taker: taker.evidence, decoded: [maker.decoded, taker.decoded] })
      : undefined;
    pairs.push({
      tradePrintId: print.id,
      price: print.price,
      transitions,
      state,
      maker,
      taker,
      reciprocalMatch,
      settlementEvidenceHash
    });
  }

  const observedAt = (input.now || new Date()).toISOString();
  const reportCore = {
    observedAt,
    minimumConfirmations,
    pairs,
    allSettled: pairs.length > 0 && pairs.every((pair) => pair.state === "settled"),
    settledPairCount: pairs.filter((pair) => pair.state === "settled").length
  };
  return { ...reportCore, reportHash: canonicalHash(reportCore) };
}

