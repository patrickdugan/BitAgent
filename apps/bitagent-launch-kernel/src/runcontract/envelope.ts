import { hashObject, opaqueId } from "../launch/canonical.js";
import { validateBitcoinAddress } from "../launch/bitcoin.js";
import { ACTION_CLASSES, BITCOIN_MAINNET, BITCOIN_TESTNET4 } from "./constants.js";
import { RunContractError } from "./errors.js";
import type {
  ActionClass,
  ActionEnvelopeDraft,
  EvidenceReceipt,
  RunContract
} from "./types.js";

const ATOMS = /^(0|[1-9][0-9]*)$/;
const DEFAULT_SIMULATION_TTL_MS = 60_000;

function typedString(receipt: EvidenceReceipt, key: string) {
  const value = receipt.typed[key];
  if (typeof value !== "string" || !value) {
    throw new RunContractError("envelope_invalid", `Evidence ${receipt.id} has no typed field ${key}`);
  }
  return value;
}

function typedAtoms(receipt: EvidenceReceipt, key: string) {
  const value = typedString(receipt, key);
  if (!ATOMS.test(value)) throw new RunContractError("envelope_invalid", `Evidence ${receipt.id} field ${key} is not an integer string`);
  return value;
}

export function addressChain(address: string) {
  for (const [chain, network] of [[BITCOIN_TESTNET4, "bitcoin-testnet4"], [BITCOIN_MAINNET, "bitcoin"]] as const) {
    try {
      validateBitcoinAddress(address, network);
      return chain;
    } catch {
      // try the next network
    }
  }
  return "unknown";
}

export function medianMarkCents(prices: EvidenceReceipt[]) {
  const marks = prices
    .map((price) => price.typed.markPriceCents)
    .filter((mark): mark is string => typeof mark === "string" && ATOMS.test(mark))
    .map((mark) => BigInt(mark))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (marks.length === 0) return null;
  const middle = Math.floor(marks.length / 2);
  return marks.length % 2 ? marks[middle]! : (marks[middle - 1]! + marks[middle]!) / 2n;
}

function ceilBps(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) return 10_000;
  if (numerator <= 0n) return 0;
  const bps = (numerator * 10_000n + denominator - 1n) / denominator;
  return bps > 10_000n ? 10_000 : Number(bps);
}

// Shortfall against the reference, in basis points, rounded against the user. A limit order is
// measured against the median mark; same-asset moves are measured against the amount spent.
export function effectiveSlippageBps(input: {
  spendAtoms: string;
  receiveMinAtoms: string;
  limitPriceCents?: string;
  prices: EvidenceReceipt[];
}) {
  if (input.limitPriceCents !== undefined) {
    const reference = medianMarkCents(input.prices);
    if (reference === null) return 10_000;
    return ceilBps(reference - BigInt(input.limitPriceCents), reference);
  }
  return ceilBps(BigInt(input.spendAtoms) - BigInt(input.receiveMinAtoms), BigInt(input.spendAtoms));
}

// Builds the exact action from typed evidence only. Free text never reaches this function, and the
// payload hash stands in for the tradelayer.js / wallet builder output that the live path binds.
export function buildActionEnvelope(input: {
  contract: RunContract;
  runId: string;
  stepIndex: number;
  intent: EvidenceReceipt;
  quote: EvidenceReceipt;
  prices: EvidenceReceipt[];
  now: Date;
}): ActionEnvelopeDraft {
  const { contract, intent, quote } = input;
  const actionClass = typedString(intent, "actionClass") as ActionClass;
  if (!ACTION_CLASSES.includes(actionClass)) {
    throw new RunContractError("envelope_invalid", `Unknown action class ${actionClass}`);
  }
  const chain = intent.chain || contract.scope.chains[0]!;
  const venueId = typedString(quote, "venueId");
  const spend = { asset: typedString(intent, "asset"), atoms: typedAtoms(intent, "amountAtoms") };
  const receiveMin = { asset: typedString(quote, "receiveAsset"), atoms: typedAtoms(quote, "receiveMinAtoms") };
  const destination = actionClass === "withdraw"
    ? (() => {
      const address = typedString(intent, "destinationAddress");
      return { chain: addressChain(address), address };
    })()
    : { chain, address: venueId };
  const fees = [{ asset: typedString(quote, "feeAsset"), atoms: typedAtoms(quote, "feeAtoms"), kind: "network" as const }];
  const limitPriceCents = typeof quote.typed.limitPriceCents === "string" ? typedAtoms(quote, "limitPriceCents") : undefined;
  const strategyParamsHash = typeof intent.typed.strategyParamsHash === "string" ? intent.typed.strategyParamsHash : undefined;
  const quoteExpiry = quote.expiresAt ? Date.parse(quote.expiresAt) : Number.POSITIVE_INFINITY;
  const expiresAt = new Date(Math.min(quoteExpiry, input.now.getTime() + DEFAULT_SIMULATION_TTL_MS)).toISOString();
  const payload = { actionClass, chain, venueId, spend, receiveMin, destination, limitPriceCents };
  const core = {
    runId: input.runId,
    contractHash: contract.contractHash,
    actionClass,
    chain,
    venueId,
    spend,
    receiveMin,
    destination,
    fees,
    intentRef: intent.id,
    quoteRef: quote.id,
    priceRefs: input.prices.map((price) => price.id).sort(),
    ...(limitPriceCents !== undefined ? { limitPriceCents } : {}),
    ...(strategyParamsHash !== undefined ? { strategyParamsHash } : {}),
    effectiveSlippageBps: effectiveSlippageBps({
      spendAtoms: spend.atoms,
      receiveMinAtoms: receiveMin.atoms,
      limitPriceCents,
      prices: input.prices
    }),
    payloadHash: hashObject(payload),
    idempotencyKey: hashObject({
      contractHash: contract.contractHash,
      intentRef: intent.id,
      actionClass,
      venueId,
      spend,
      destination
    }),
    expiresAt
  };
  const simulationHash = hashObject(core);
  return {
    schema: "bitagent.action_envelope.v1",
    envelopeId: opaqueId("env", { stepIndex: input.stepIndex, simulationHash }),
    stepIndex: input.stepIndex,
    ...core,
    simulationHash,
    authority: "deterministic_host",
    effect: "none",
    signingPerformed: false,
    broadcastPerformed: false
  };
}
