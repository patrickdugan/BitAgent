export type PropagationMetrics = {
  agent_assisted_new_productive_users: number;
  existing_agent_assisted_productive_users: number;
  referral_depth: number;
  shared_strategy_hash_rate: number;
  shared_compute_provider_rate: number;
  synchronized_execution_score: number;
  geographic_cluster_score: number;
  common_message_template_rate: number;
  operator_concentration: number;
  self_referral_rate: number;
  agent_assisted_activation_rate: number;
};

export type PropagationThresholds = {
  gamma_threshold: number;
  common_strategy_threshold: number;
  coordination_threshold: number;
  cluster_threshold: number;
  operator_concentration_threshold: number;
  minimum_joint_signals: number;
};

export type PropagationReviewAction =
  | "reduce_agent_outreach_rate"
  | "require_manual_review"
  | "disable_agent_to_agent_referral";

function finiteNonnegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and non-negative`);
}

export function evaluatePropagationReview(
  metrics: PropagationMetrics,
  thresholds: PropagationThresholds
) {
  for (const [field, value] of Object.entries({ ...metrics, ...thresholds })) {
    finiteNonnegative(value, field);
  }
  const gamma = metrics.existing_agent_assisted_productive_users === 0
    ? 0
    : metrics.agent_assisted_new_productive_users / metrics.existing_agent_assisted_productive_users;
  const signals = [
    gamma >= thresholds.gamma_threshold ? "GAMMA_HIGH" : null,
    metrics.shared_strategy_hash_rate >= thresholds.common_strategy_threshold ? "SHARED_STRATEGY_HIGH" : null,
    metrics.synchronized_execution_score >= thresholds.coordination_threshold ? "SYNCHRONIZED_EXECUTION_HIGH" : null,
    metrics.common_message_template_rate >= thresholds.coordination_threshold ? "COMMON_TEMPLATE_HIGH" : null,
    metrics.geographic_cluster_score >= thresholds.cluster_threshold ? "GEOGRAPHIC_CLUSTER_HIGH" : null,
    metrics.operator_concentration >= thresholds.operator_concentration_threshold ? "OPERATOR_CONCENTRATION_HIGH" : null
  ].filter((value): value is string => Boolean(value));
  const enhancedReview = signals.length >= Math.max(2, thresholds.minimum_joint_signals);
  const actions: PropagationReviewAction[] = enhancedReview
    ? ["reduce_agent_outreach_rate", "require_manual_review", "disable_agent_to_agent_referral"]
    : [];
  return {
    schema: "bitagent_stego_hive_review_v1" as const,
    gamma,
    signals,
    enhanced_review: enhancedReview,
    actions,
    freeze_user_funds: false as const
  };
}
