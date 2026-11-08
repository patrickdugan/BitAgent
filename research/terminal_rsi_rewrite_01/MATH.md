# Verified rewriting, coverage and low-bit transfer

## 1. Success filtering changes the training mixture

Let p_f be the discovery task-family distribution and a_f the probability of passing protected verification and leakage review. Accepted demonstrations follow

    q_f = p_f a_f / sum_g p_g a_g.

In a deliberately simplified stationary recursion that uses the last accepted mixture as the next proposal distribution, q_f^(k) is proportional to p_f a_f^k. Starting equally on easy/hard families with acceptance .8/.2, the hard-family share falls from 50% to 20% after one round and to 1/1025, about .09756%, after five.

This extrapolation assumes fixed acceptance rates and recursive reweighting. It does not describe a training pipeline that independently resamples a frozen family distribution each round. Real improving policies require measuring a_(f,k) and the discovery schedule.

Maintain fixed discovery quotas and per-family replay quotas. Record accepted multiplicity and cap demonstrations per task root. A family with zero accepted examples has a support gap; inverse weights or resampling cannot manufacture successful demonstrations. Keep its failed trials in a diagnostic ledger while excluding them from a success-only actor target.

## 2. Private guidance and public execution

A demonstration produced with a private runbook may induce different actions after the runbook is removed. Public-prefix likelihood is not the guided trajectory's behavior probability. Re-execute under the deployment-visible context and preserve exact token/context provenance before assigning an on-policy interpretation. This is a separate acceptance condition from private test success.

## 3. Quantization through behavior

Let pi and pi_q denote full-precision/adapted and deployed low-bit policies over canonical typed actions. Assume a uniform conditional total-variation bound delta at every matched history, the same initial distribution, environment and host. Couple decisions until their first disagreement. Over H decisions,

    TV(trajectory_pi, trajectory_pi_q) <= 1-(1-delta)^H <= min(1,H delta).

The same bound applies to the difference in any binary trajectory event probability. With delta=.01 and H=50, the first bound is about .394994. This is an upper bound under a strong uniform premise, not a predicted degradation. An average KL or agreement rate on a small set does not establish that premise. Sampled estimates must include uncertainty and family coverage.

Weight-space distance alone cannot control deterministic argmax actions near decision boundaries. Match policies on deployment histories and use actual deployed quantization formats. One-bit inference results do not establish a viable one-bit training method.

## 4. Deterministic host maps

For the same state and fixed host mapping G,

    TV(G#pi, G#pi_q) <= TV(pi,pi_q).

This follows by grouping probabilities by the host's output and applying the triangle inequality. The reference checks 200 random distribution pairs. Its toy host reduces action-distribution TV from .15 to .05 by mapping different disallowed proposals to rejection.

The inequality concerns a common measured action space. It does not certify complete mediation, timing behavior, side channels, external state races or a changed host implementation. Preserve attempt logs even when the enforced output distributions coincide.
