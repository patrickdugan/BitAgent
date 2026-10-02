export type RunContractErrorCode =
  | "contract_invalid"
  | "contract_not_effective"
  | "contract_expired"
  | "approval_invalid"
  | "secret_material_prohibited"
  | "covenant_map_error"
  | "evidence_invalid"
  | "evidence_unregistered"
  | "envelope_invalid"
  | "unit_parse_error";

export class RunContractError extends Error {
  constructor(
    readonly code: RunContractErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "RunContractError";
  }
}
