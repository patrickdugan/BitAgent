import { evaluateCompliance } from "./policy.js";
import {
  evaluateTradeLayerProtocolPolicy,
  readTradeLayerValidityPolicyManifest,
  type TradeLayerJurisdictionSnapshot,
  type TradeLayerValidityPolicyManifest
} from "./tradelayerPolicy.js";
import type {
  AgeEligibility,
  CustodyModel,
  JurisdictionPolicyHost,
  ProductCategory,
  UserType
} from "./types.js";
import type { WalletComplianceAuthority, WalletComplianceEvaluation } from "./walletGate.js";

export type WalletComplianceFacts = {
  country_of_residence: string;
  current_location_country: string;
  age_eligibility: AgeEligibility;
  custody_model: CustodyModel;
  user_type: UserType;
  tradelayer_sender_address: string;
  expected_policy_version?: string;
};

export interface WalletComplianceFactsSource {
  get(workflowId: string): Promise<WalletComplianceFacts>;
}

export interface TradeLayerJurisdictionSnapshotSource {
  observe(input: {
    wallet_address: string;
    now: Date;
  }): Promise<TradeLayerJurisdictionSnapshot>;
}

function defaultProduct(action: string): ProductCategory {
  if (action === "starter_strategy") return "SPOT";
  throw new Error(`No compliance product mapping exists for wallet action ${action}`);
}

export class TradeLayerWalletComplianceAuthority implements WalletComplianceAuthority {
  private manifestPromise?: Promise<TradeLayerValidityPolicyManifest>;

  constructor(private readonly options: {
    policyHost: JurisdictionPolicyHost;
    factsSource: WalletComplianceFactsSource;
    snapshotSource: TradeLayerJurisdictionSnapshotSource;
    tradelayerRepoPath?: string;
    receiptTtlMs?: number;
    productForAction?: (action: string) => ProductCategory;
  }) {
    const ttl = options.receiptTtlMs ?? 60_000;
    if (!Number.isSafeInteger(ttl) || ttl < 1_000 || ttl > 300_000) {
      throw new Error("Wallet compliance receipt TTL must be 1-300 seconds");
    }
  }

  private manifest() {
    this.manifestPromise ||= readTradeLayerValidityPolicyManifest(this.options.tradelayerRepoPath);
    return this.manifestPromise;
  }

  async evaluate(input: Parameters<WalletComplianceAuthority["evaluate"]>[0]): Promise<WalletComplianceEvaluation> {
    const [facts, manifest] = await Promise.all([
      this.options.factsSource.get(input.state.id),
      this.manifest()
    ]);
    const product = (this.options.productForAction || defaultProduct)(input.simulation.action);
    const [decision, snapshot] = await Promise.all([
      evaluateCompliance(this.options.policyHost, {
        action: "ENABLE_PRODUCT",
        country_of_residence: facts.country_of_residence,
        current_location_country: facts.current_location_country,
        age_eligibility: facts.age_eligibility,
        product_requested: product,
        custody_model: facts.custody_model,
        user_type: facts.user_type,
        expected_policy_version: facts.expected_policy_version
      }),
      this.options.snapshotSource.observe({
        wallet_address: facts.tradelayer_sender_address,
        now: input.now
      })
    ]);
    const protocolPolicy = evaluateTradeLayerProtocolPolicy({
      manifest,
      snapshot,
      product,
      expected_current_location_country: facts.current_location_country
    });
    const ttlExpiry = input.now.getTime() + (this.options.receiptTtlMs ?? 60_000);
    const policyExpiry = Date.parse(decision.policy_expires_at || "");
    const simulationExpiry = Date.parse(input.simulation.expiresAt);
    const expiry = Math.min(
      ttlExpiry,
      Number.isFinite(policyExpiry) ? policyExpiry : input.now.getTime(),
      simulationExpiry
    );
    return {
      decision,
      product,
      protocol_policy: protocolPolicy,
      expires_at: new Date(expiry).toISOString()
    };
  }
}
