export type StrategyMandateErrorCode =
  | "covenant_invalid"
  | "covenant_expired"
  | "secret_material_prohibited"
  | "proposal_invalid"
  | "market_state_invalid"
  | "portfolio_state_invalid"
  | "shadow_source_error"
  | "shadow_state_invalid"
  | "shadow_state_stale"
  | "shadow_state_conflict"
  | "risk_rejected"
  | "candidate_invalid";

export class StrategyMandateError extends Error {
  constructor(
    readonly code: StrategyMandateErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "StrategyMandateError";
  }
}
