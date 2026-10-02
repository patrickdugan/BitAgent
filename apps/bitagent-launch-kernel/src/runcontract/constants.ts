import type { ActionClass, GateId, ReapprovalTrigger } from "./types.js";

// CAIP-2 chain IDs: bip122 namespace plus the first 32 hex characters of the genesis block hash.
export const BITCOIN_MAINNET = "bip122:000000000019d6689c085ae165831e93";
export const BITCOIN_TESTNET4 = "bip122:00000000da84f2bafbbc53dee25a72ae";

export const CHAIN_NETWORK: Record<string, "bitcoin" | "bitcoin-testnet4"> = {
  [BITCOIN_MAINNET]: "bitcoin",
  [BITCOIN_TESTNET4]: "bitcoin-testnet4"
};

export function nativeBitcoinAsset(chain: string) {
  return `${chain}/slip44:${chain === BITCOIN_MAINNET ? 0 : 1}`;
}

export function tradeLayerAsset(chain: string, propertyId: number) {
  return `${chain}/tradelayer:${propertyId}`;
}

export const ACTION_CLASSES: ActionClass[] = [
  "swap", "bridge", "deposit", "place_limit", "cancel", "reduce_position", "withdraw"
];

export const REAPPROVAL_TRIGGERS: ReapprovalTrigger[] = [
  "scope_change", "limit_change", "budget_exhausted", "strategy_drift",
  "unresolved_price_conflict", "reconciliation_mismatch", "consecutive_rejections"
];

export const ALL_GATES: GateId[] = [
  "G01_contract_active", "G02_chain_allowed", "G03_asset_allowed", "G04_venue_allowed",
  "G05_destination_allowed", "G06_action_allowed", "G07_per_action_cap", "G08_cumulative_cap",
  "G09_quote_fresh", "G10_price_quorum", "G11_slippage_bound", "G12_fee_cap",
  "G13_units_consistent", "G14_idempotent", "G15_evidence_attested", "G16_strategy_bound",
  "G17_simulation_bound", "G18_run_limits"
];

// A quote may trail the host's known tip by at most this many blocks.
export const MAX_QUOTE_SEQUENCE_LAG = 1;
