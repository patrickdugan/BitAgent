import { hashObject } from "../launch/canonical.js";
import { BITCOIN_MAINNET } from "../runcontract/constants.js";
import type { ActionEnvelope, EvidenceTyped } from "../runcontract/types.js";
import type { FaultSpec, WorldEffect, WorldSpec } from "./types.js";

export type ToolFaultClass = "timeout" | "malformed" | "insufficient_funds" | "unsupported";

export class ToolFault extends Error {
  constructor(readonly errorClass: ToolFaultClass, message: string) {
    super(message);
    this.name = "ToolFault";
  }
}

export type ProviderQuote = {
  chain: string;
  sequence: number;
  asOf: string;
  expiresAt: string;
  venueId: string;
  actionClass: string;
  spendAsset: string;
  spendAtoms: string;
  receiveAsset: string;
  receiveMinAtoms: string;
  feeAsset: string;
  feeAtoms: string;
  limitPriceCents?: string;
};

export type ProviderPrice = { sourceId: string; markPriceCents: string; asOf: string; sequence: number };

export type TxStatus = "confirmed" | "pending" | "not_found";

const BLOCK_MS = 600_000;

function add(target: Record<string, bigint>, asset: string, amount: bigint) {
  target[asset] = (target[asset] || 0n) + amount;
}

// What an envelope says will happen to the user's balances. The world applies exactly this, plus
// whatever a fault adds; reconciliation compares the two.
export function simulatedDeltas(envelope: ActionEnvelope): Record<string, string> {
  const deltas: Record<string, bigint> = {};
  add(deltas, envelope.spend.asset, -BigInt(envelope.spend.atoms));
  for (const fee of envelope.fees) add(deltas, fee.asset, -BigInt(fee.atoms));
  if (envelope.actionClass === "deposit") add(deltas, envelope.receiveMin.asset, BigInt(envelope.receiveMin.atoms));
  return Object.fromEntries(Object.entries(deltas).map(([asset, value]) => [asset, value.toString()]));
}

// Deterministic Bitcoin testnet4 / TradeLayer stand-in. It enforces balances and nothing else:
// authorization is the harness's job, so an ungated envelope that the user can afford will land.
export class SimWorld {
  readonly effects: WorldEffect[] = [];
  private clockMs: number;
  private tipHeight: number;
  private readonly balances: Record<string, bigint>;
  private readonly initial: Record<string, bigint>;
  private readonly calls = new Map<string, number>();
  private readonly submissions = new Map<string, { txid: string; applied: boolean }>();

  constructor(readonly spec: WorldSpec, private readonly faults: FaultSpec[]) {
    this.clockMs = Date.parse(spec.clockStart);
    this.tipHeight = spec.tip;
    this.balances = Object.fromEntries(Object.entries(spec.balances).map(([asset, atoms]) => [asset, BigInt(atoms)]));
    this.initial = { ...this.balances };
  }

  now() {
    return new Date(this.clockMs);
  }

  tip() {
    return this.tipHeight;
  }

  private advance(ms: number) {
    this.clockMs += ms;
    this.tipHeight += Math.floor(ms / BLOCK_MS);
  }

  // Starts a decision step and returns the injections due at it.
  beginStep(step: number) {
    if (step > 0) this.advance(this.spec.stepMs);
    const due = this.faults.filter((fault) => fault.at.step === step);
    for (const fault of due) {
      if (fault.kind === "clock_advance") this.advance(Number(fault.params.ms));
    }
    return due.filter((fault) => fault.kind === "inject_receipt");
  }

  private fire(tool: string) {
    const count = (this.calls.get(tool) || 0) + 1;
    this.calls.set(tool, count);
    const fired = this.faults.filter((fault) => fault.at.onTool === tool
      && (fault.params.persist === true ? count >= (fault.at.nth || 1) : count === (fault.at.nth || 1)));
    for (const fault of fired) {
      if (fault.kind === "clock_advance") this.advance(Number(fault.params.ms));
      if (fault.kind === "tool_timeout") throw new ToolFault("timeout", `${tool} timed out`);
      if (fault.kind === "tool_malformed") throw new ToolFault("malformed", `${tool} returned an unparseable body`);
    }
    return fired;
  }

  private medianMark() {
    const marks = this.spec.priceSources.map((source) => BigInt(source.markPriceCents))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return marks[Math.floor(marks.length / 2)]!;
  }

  fetchQuote(intent: EvidenceTyped): ProviderQuote {
    const fired = this.fire("market.get_quote");
    const actionClass = String(intent.actionClass);
    const spendAsset = String(intent.asset);
    const spendAtoms = String(intent.amountAtoms);
    const limit = this.medianMark();
    const quote: ProviderQuote = {
      chain: this.spec.chain,
      sequence: this.tipHeight,
      asOf: this.now().toISOString(),
      expiresAt: new Date(this.clockMs + this.spec.quoteTtlMs).toISOString(),
      venueId: this.spec.venueId,
      actionClass,
      spendAsset,
      spendAtoms,
      receiveAsset: this.spec.receiveAsset[actionClass] || spendAsset,
      receiveMinAtoms: actionClass === "place_limit" ? (BigInt(spendAtoms) * limit / 100n).toString() : spendAtoms,
      feeAsset: this.spec.feeAsset,
      feeAtoms: this.spec.networkFeeAtoms,
      ...(actionClass === "place_limit" ? { limitPriceCents: limit.toString() } : {})
    };
    for (const fault of fired) {
      const params = fault.params;
      if (fault.kind === "quote_stale") quote.asOf = new Date(this.clockMs - Number(params.ageMs)).toISOString();
      if (fault.kind === "quote_replay") quote.sequence = this.tipHeight - Number(params.sequenceLag);
      if (fault.kind === "quote_wrong_chain") quote.chain = BITCOIN_MAINNET;
      if (fault.kind === "quote_unlisted_venue") quote.venueId = String(params.venueId);
      if (fault.kind === "quote_fee_spike") quote.feeAtoms = String(params.feeAtoms);
      if (fault.kind === "quote_bad_limit") quote.limitPriceCents = String(params.limitPriceCents);
      if (fault.kind === "quote_impostor_asset") quote.receiveAsset = String(params.receiveAsset);
      if (fault.kind === "quote_low_receive") quote.receiveMinAtoms = String(params.receiveMinAtoms);
    }
    return quote;
  }

  fetchPrices(): ProviderPrice[] {
    const fired = this.fire("market.get_prices");
    const down = new Set(fired.filter((fault) => fault.kind === "price_source_down").map((fault) => String(fault.params.sourceId)));
    const overrides = new Map(fired.filter((fault) => fault.kind === "price_conflict")
      .map((fault) => [String(fault.params.sourceId), String(fault.params.markPriceCents)]));
    return this.spec.priceSources.filter((source) => !down.has(source.id)).map((source) => ({
      sourceId: source.id,
      markPriceCents: overrides.get(source.id) || source.markPriceCents,
      asOf: this.now().toISOString(),
      sequence: this.tipHeight
    }));
  }

  balanceSnapshot(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.balances).map(([asset, atoms]) => [asset, atoms.toString()]));
  }

  execute(envelope: ActionEnvelope, leaseSimulationHash: string | null) {
    const fired = this.fire("host.execute_approved");
    const txid = hashObject({ envelopeId: envelope.envelopeId, attempt: this.calls.get("host.execute_approved") });
    if (fired.some((fault) => fault.kind === "timeout_no_effect")) {
      this.submissions.set(envelope.envelopeId, { txid, applied: false });
      throw new ToolFault("timeout", "broker timed out before submission");
    }
    if (!["deposit", "place_limit", "withdraw"].includes(envelope.actionClass)) {
      throw new ToolFault("unsupported", `world v1 does not model ${envelope.actionClass}`);
    }
    const undisclosed = fired.filter((fault) => fault.kind === "undisclosed_fee")
      .reduce((total, fault) => total + BigInt(String(fault.params.atoms)), 0n);
    const deltas: Record<string, bigint> = Object.fromEntries(
      Object.entries(simulatedDeltas(envelope)).map(([asset, value]) => [asset, BigInt(value)])
    );
    if (undisclosed > 0n) add(deltas, this.spec.feeAsset, -undisclosed);
    for (const [asset, delta] of Object.entries(deltas)) {
      if ((this.balances[asset] || 0n) + delta < 0n) throw new ToolFault("insufficient_funds", `insufficient ${asset}`);
    }
    for (const [asset, delta] of Object.entries(deltas)) add(this.balances, asset, delta);
    this.submissions.set(envelope.envelopeId, { txid, applied: true });
    this.effects.push({
      effectId: `effect_${this.effects.length + 1}`,
      txid,
      at: this.now().toISOString(),
      tip: this.tipHeight,
      envelope: structuredClone(envelope),
      leaseSimulationHash,
      undisclosedFeeAtoms: undisclosed.toString(),
      deltas: Object.fromEntries(Object.entries(deltas).map(([asset, value]) => [asset, value.toString()]))
    });
    if (fired.some((fault) => fault.kind === "timeout_after_effect")) {
      throw new ToolFault("timeout", "broker timed out after submission");
    }
    return { txid };
  }

  // Ground truth, read without going through the provider that reported the submission.
  independentTxStatus(envelopeId: string): TxStatus {
    return this.submissions.get(envelopeId)?.applied ? "confirmed" : "not_found";
  }

  providerTxStatus(envelopeId: string): TxStatus {
    const lie = this.fire("tx.get_status").find((fault) => fault.kind === "provider_status_lie");
    return lie ? String(lie.params.status) as TxStatus : this.independentTxStatus(envelopeId);
  }

  effectsFor(envelopeId: string) {
    return this.effects.filter((effect) => effect.envelope.envelopeId === envelopeId);
  }

  ledgerDeltas(): Record<string, string> {
    const assets = new Set([...Object.keys(this.initial), ...Object.keys(this.balances)]);
    return Object.fromEntries([...assets]
      .map((asset) => [asset, ((this.balances[asset] || 0n) - (this.initial[asset] || 0n)).toString()] as const)
      .filter(([, delta]) => delta !== "0"));
  }
}
