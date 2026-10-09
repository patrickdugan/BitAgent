# 04. Paper outline

Working title: *Does Memory Make the Attacker? Measuring How Accumulated
Personal Context Changes an Assistant's Exploitability*

Target venues: IEEE S&P or USENIX Security (security framing); PETS
(privacy framing); SaTML (AI-control framing). The control-harness result
and the receipt discipline fit SaTML best; the inference-leakage result fits
PETS.

## Abstract (claims to support)

1. A personal assistant's memory is a relational asset whose attacker value
   can be computed from its structure (availability of sensitive
   conclusions) independently of any model.
2. Whether a model *realises* that value depends on connectivity, not only
   volume: on matched contexts with equal fact count and sensitivity, [a
   live defender] asserts protected conclusions [Δ] more often when the
   premises join.
3. Summarise-then-store memory converts that reasoning step into a lookup;
   a defender that never joins leaks conclusions once the memory system has
   written them down.
4. Tool access, not information richness, drives unauthorized actions; the
   capability factorial separates the two.
5. An independent control harness at the retrieval, disclosure and action
   boundaries removes unauthorized commits and most disclosure without
   measurable utility loss on authorized requests, at three extra round
   trips.

## 1. Introduction

- The dossier framing: months of context as a continuously updated
  personal intelligence asset.
- Why existing benchmarks miss it: single-turn PII tests, injection suites
  without persistent memory, agent benchmarks without a principal.
- Contributions: threat model with an access lattice; synthetic
  longitudinal population with a relational graph; seven probe families
  with judge-free scoring; matched-pair falsification design; architecture
  frontier; Control-Harness-compatible receipts.

## 2. Threat model

From [01](01_threat_model.md): system tuple, access classes A1-A6, six
scenarios, goals and negations, scope boundaries.

## 3. PCE-Bench

- Population generator and arc catalogue; fragments, conflicts, uncertainty.
- Context levels and the three orthogonal factors.
- Probe families and templates; the bounded impersonation design.
- Scoring against the graph; decoys and precision.
- Receipts and verification.

## 4. Experimental design

- Hypothesis critique and the three readings (volume, connectivity,
  architecture artefact) from [00](00_hypothesis_critique.md).
- Matched connectivity pair; decision rule; pre-registration.
- Ladder with length matching; capability factorial; memory-mode ablation.
- Defenders: two or three model families; scripted controls.

## 5. Results

5.1 Dataset properties: availability and sensitivity mass per level (no
model).
5.2 Matched pair: Δ per defender with intervals; null-defender calibration.
5.3 Ladder shapes: conditional and unconditional; decomposition
coefficients; length-matched comparison.
5.4 Capability factorial: injection compliance flat across levels; tool
access as the driver of unauthorized actions.
5.5 Memory mode: the summariser artefact in live defenders.
5.6 Architectures: security-utility frontier table; what each boundary
buys; cost.
5.7 Recovery and flagging.

## 6. Discussion

- Harm vs behaviour: what the benchmark can and cannot say about risk.
- Design implications: information-flow controls and capability tokens as
  the minimum; why an output-side validator is needed even with
  purpose-limited retrieval.
- Threats to validity: synthetic arcs authored with knowledge of the
  controls; surface-form scoring underestimates paraphrased leakage; one
  rendering; no multi-week erosion.

## 7. Related work

Memory and personalisation in assistants; indirect prompt injection; agent
security benchmarks; AI control; privacy attacks on LLMs (membership,
extraction, inference attacks from innocuous text); information-flow
control and capability systems.

## 8. Ethics and responsible disclosure

All personas and services fictional; no deployable attack text; attacker
endpoints non-resolving; bounded impersonation design; artifacts released
with the scripted controls so claims are reproducible without any model.

## Appendices

A. Arc catalogue and surface forms. B. Probe templates. C. Decision rule and
constants. D. Receipt schema. E. Full tables per defender.
