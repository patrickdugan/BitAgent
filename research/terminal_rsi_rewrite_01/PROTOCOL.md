# Proposed candidate-only rewrite and quantization experiments

## Reuse and authority

Reuse sanitized traces from `apps/bitagent-launch-kernel/eval/` and its existing 51-case focused evaluator. The root README also identifies `model-releases/bitagent-bonsai8b-dagv2-lora-v3` and the `bitagent-hermes-launch` skill. Inspect actual schemas and current model hashes before integration. The 51 examples are smoke coverage, not a statistically powered generalization set. Retain GDK-first authority semantics and the existing deterministic host. `fundedExecutionAllowed` stays false.

Preserve inspect/explain, simulation, exact-effect disclosure, approval request, execution and verification as separately recorded stages. The candidate never signs, approves for the user, broadcasts or manufactures wallet state. Fresh-run tests use mock outcomes and synthetic approval nonces.

## TRSI-REWRITE-01

At a fixed inference budget, compare four treatments: current skill baseline; retrieval of accepted raw traces; verified rewritten procedures; family-balanced verified rewritten procedures with per-root caps. The rewrite process uses public instructions and permitted artifacts only. Each candidate procedure undergoes fresh execution in a clean mock state with new amounts, nonces, error conditions and task paraphrases. Protected checks remain inaccessible to the planner.

Log every discovery attempt, including failures, and each filter's decision. Distinguish task success, leakage rejection, syntax rejection and absent family support. Private-guided execution and public-context execution are separate columns. A public-context failure prevents deployment promotion.

Use whole-family/root-held-out splits, five seeds [11,23,37,53,71], and a fixed total number of discovery plus execution calls across arms. A fixed discovery mixture is the primary design; recursive accepted-mixture sampling is a deliberately adverse diagnostic. No auto-expansion in task count after a favorable partial result.

Include model-absent, shuffled-proposal and deterministic-script controls. Earlier strong script performance means identical final outcomes across these controls would indicate that the host carries the result. Primary endpoint is native authorized strict completion above the strongest simple comparator, with positive paired confidence interval and a proposed +.02 minimum effect. Discovery cost, retained family coverage and public-context replay rate accompany every result.

## TRSI-QUANT-01

After the replay gate, perform a 2x2 study: existing/raw demonstrations versus verified rewritten demonstrations, crossed with the actual trained adapter representation versus the actual deployed low-bit representation. Pin adapter and quantization hashes. Keep tool schemas, context budgets, initial states and host versions identical. This protocol does not presume that one-bit weights can be directly trained.

Report strict completion by horizon, canonical typed-action disagreement, invalid requests, recovery, latency, peak memory and model contribution beyond the deterministic baseline. Include longer held-out workflows. The coupling calculation is a diagnostic lens; sampled disagreement does not justify a universal TV guarantee.

For a phone-oriented decision, compare strict completions per measured joule or per-second only when the measurement instrument is available and calibrated. Otherwise report CPU/GPU time and state that energy is unmeasured. No invented energy estimates.

Status: finite references complete; native replay, adapter training and low-bit model comparisons UNRUN. No funded behavior, GPU launch, model download, production network action, CI change or automatic merge.
