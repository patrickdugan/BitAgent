import { complianceHash } from "./policy.js";
import type { ComplianceAuditAppendInput, ComplianceAuditEvent } from "./audit.js";
import type { ComplianceDecision, ProductCategory } from "./types.js";
import type { TradeLayerProtocolPolicyReceipt } from "./tradelayerPolicy.js";
import { LaunchKernelError } from "../launch/errors.js";
import type {
  BitAgentWorkflowState,
  TransactionSimulation,
  WalletComplianceReceipt,
  WalletExecutionBroker
} from "../launch/types.js";

export type WalletComplianceEvaluation = {
  decision: ComplianceDecision;
  product: ProductCategory;
  protocol_policy: TradeLayerProtocolPolicyReceipt;
  expires_at: string;
};

export interface WalletComplianceAuthority {
  evaluate(input: {
    phase: "AUTHORIZE" | "EXECUTE";
    state: BitAgentWorkflowState;
    simulation: TransactionSimulation;
    now: Date;
  }): Promise<WalletComplianceEvaluation>;
}

type AuditSink = {
  append(input: ComplianceAuditAppendInput): ComplianceAuditEvent | Promise<ComplianceAuditEvent>;
};

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function verifyProtocolReceipt(receipt: TradeLayerProtocolPolicyReceipt): boolean {
  const { receipt_hash: hash, ...material } = receipt;
  return validHash(hash) && complianceHash(material) === hash;
}

export function createWalletComplianceReceipt(input: {
  evaluation: WalletComplianceEvaluation;
  simulation: TransactionSimulation;
  now: Date;
}): WalletComplianceReceipt {
  const { decision, protocol_policy: protocol, product } = input.evaluation;
  const expiry = Date.parse(input.evaluation.expires_at);
  if (!Number.isFinite(expiry) || expiry <= input.now.getTime()
    || expiry > Date.parse(input.simulation.expiresAt)) {
    throw new LaunchKernelError("compliance_required", "Compliance authorization is stale or outlives the exact simulation");
  }
  if (!["ALLOW", "ALLOW_WITH_DISCLOSURE"].includes(decision.status)
    || decision.compliance_state !== "VERIFIED"
    || decision.trading_permission !== "POLICY_ALLOWED"
    || decision.escalation !== "NONE"
    || !decision.allowed_products.includes(product)
    || !decision.policy_version
    || !validHash(decision.policy_receipt_hash)
    || !verifyProtocolReceipt(protocol)
    || protocol.status !== "ALLOW"
    || protocol.product !== product) {
    throw new LaunchKernelError("compliance_required", "Wallet action is not allowed by fresh jurisdiction and TradeLayer policy receipts");
  }
  const decisionHash = complianceHash(decision);
  const authorizationContextHash = complianceHash({
    action: input.simulation.action,
    simulation_hash: input.simulation.hash,
    product,
    decision_hash: decisionHash,
    policy_version: decision.policy_version,
    policy_receipt_hash: decision.policy_receipt_hash,
    protocol_status: protocol.status,
    protocol_country_code: protocol.country_code,
    protocol_policy_version: protocol.policy_version,
    protocol_source_hash: protocol.source_hash
  });
  const material = {
    schema: "bitagent_wallet_compliance_receipt_v1" as const,
    effect: "authorize_wallet_action" as const,
    action: input.simulation.action,
    product,
    simulation_hash: input.simulation.hash,
    decision,
    decision_hash: decisionHash,
    protocol_policy: protocol,
    authorization_context_hash: authorizationContextHash,
    issued_at: input.now.toISOString(),
    expires_at: new Date(expiry).toISOString()
  };
  return { ...material, receipt_hash: complianceHash(material) };
}

export function verifyWalletComplianceReceipt(input: {
  receipt: WalletComplianceReceipt;
  simulation: TransactionSimulation;
  now: Date;
}): boolean {
  const { receipt_hash: hash, ...material } = input.receipt;
  if (!validHash(hash) || complianceHash(material) !== hash
    || input.receipt.simulation_hash !== input.simulation.hash
    || input.receipt.action !== input.simulation.action
    || Date.parse(input.receipt.expires_at) <= input.now.getTime()
    || complianceHash(input.receipt.decision) !== input.receipt.decision_hash
    || !verifyProtocolReceipt(input.receipt.protocol_policy)) return false;
  try {
    const rebuilt = createWalletComplianceReceipt({
      evaluation: {
        decision: input.receipt.decision,
        product: input.receipt.product,
        protocol_policy: input.receipt.protocol_policy,
        expires_at: input.receipt.expires_at
      },
      simulation: input.simulation,
      now: new Date(input.receipt.issued_at)
    });
    return rebuilt.authorization_context_hash === input.receipt.authorization_context_hash
      && rebuilt.receipt_hash === input.receipt.receipt_hash;
  } catch {
    return false;
  }
}

export class ComplianceGatedWalletBroker implements WalletExecutionBroker {
  private readonly gatedActions: Set<TransactionSimulation["action"]>;

  constructor(
    private readonly wallet: WalletExecutionBroker,
    private readonly authority: WalletComplianceAuthority,
    private readonly audit: AuditSink,
    private readonly now: () => Date = () => new Date(),
    gatedActions: TransactionSimulation["action"][] = ["starter_strategy"]
  ) {
    this.gatedActions = new Set(gatedActions);
  }

  connect(input: Parameters<WalletExecutionBroker["connect"]>[0]) { return this.wallet.connect(input); }
  getDepositAddress(input: Parameters<WalletExecutionBroker["getDepositAddress"]>[0]) { return this.wallet.getDepositAddress(input); }
  estimateFee(input: Parameters<WalletExecutionBroker["estimateFee"]>[0]) { return this.wallet.estimateFee(input); }
  verify(input: Parameters<WalletExecutionBroker["verify"]>[0]) { return this.wallet.verify(input); }

  private async receipt(input: {
    phase: "AUTHORIZE" | "EXECUTE";
    state: BitAgentWorkflowState;
    simulation: TransactionSimulation;
    now: Date;
  }) {
    let evaluation: WalletComplianceEvaluation;
    try {
      evaluation = await this.authority.evaluate(input);
      const receipt = createWalletComplianceReceipt({ evaluation, simulation: input.simulation, now: input.now });
      await this.audit.append({
        event_type: "product_allowed",
        policy_version: evaluation.decision.policy_version || undefined,
        metadata: {
          phase: input.phase,
          product: evaluation.product,
          simulation_hash: input.simulation.hash,
          decision_hash: receipt.decision_hash,
          authorization_context_hash: receipt.authorization_context_hash,
          protocol_policy_receipt_hash: evaluation.protocol_policy.receipt_hash
        }
      });
      return receipt;
    } catch (error) {
      await this.audit.append({
        event_type: "product_blocked",
        metadata: {
          phase: input.phase,
          simulation_hash: input.simulation.hash,
          reason_code: error instanceof LaunchKernelError ? error.code : "COMPLIANCE_EVALUATION_ERROR"
        }
      });
      if (error instanceof LaunchKernelError) throw error;
      throw new LaunchKernelError("compliance_required", "Fresh wallet compliance evaluation failed closed");
    }
  }

  async authorize(input: Parameters<WalletExecutionBroker["authorize"]>[0]) {
    if (!this.gatedActions.has(input.simulation.action)) return this.wallet.authorize(input);
    const compliance = await this.receipt({
      phase: "AUTHORIZE", state: input.state, simulation: input.simulation, now: this.now()
    });
    const result = await this.wallet.authorize({ ...input, compliance });
    if (result.status === "rejected") return result;
    return {
      ...result,
      complianceAuthorizationHash: compliance.authorization_context_hash,
      complianceDecisionHash: compliance.decision_hash
    };
  }

  async execute(input: Parameters<WalletExecutionBroker["execute"]>[0]) {
    if (!this.gatedActions.has(input.simulation.action)) return this.wallet.execute(input);
    const compliance = await this.receipt({
      phase: "EXECUTE", state: input.state, simulation: input.simulation, now: input.now
    });
    if (!validHash(input.approval.complianceAuthorizationHash)
      || input.approval.complianceAuthorizationHash !== compliance.authorization_context_hash
      || input.approval.complianceDecisionHash !== compliance.decision_hash) {
      throw new LaunchKernelError(
        "compliance_required",
        "Compliance policy changed or was not bound to the wallet approval; obtain a fresh approval"
      );
    }
    const execution = await this.wallet.execute({ ...input, compliance });
    return {
      ...execution,
      complianceAuthorizationHash: compliance.authorization_context_hash,
      complianceDecisionHash: compliance.decision_hash
    };
  }
}
