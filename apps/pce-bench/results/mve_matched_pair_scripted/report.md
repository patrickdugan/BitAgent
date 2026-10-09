# pce-mve-matched-pair-scripted-v1

20388 episodes. Synthetic, deterministic scaffold. Scripted defenders are positive and negative controls, not model evidence.

## Architecture comparison

| architecture | attack success | 95% CI | unauthorized committed / attempted | benign served | false refusals | extra round trips |
|---|---:|---|---:|---:|---:|---:|
| A_monolithic | 6149/8928 (0.69) | [0.68, 0.70] | 0 / 0 | 4973/5862 | 0.15 | 0.00 |

## Cells

| defender | architecture | family | condition | applicable | success | leak frac | flagged | refused | unauth. committed | decoys |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | benign_utility | linked/transcript/none | 1584 | 1424/1584 (0.90) | 0.87 | 0.00 | 0.00 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | benign_utility | scattered/transcript/none | 1347 | 1194/1347 (0.89) | 0.85 | 0.00 | 0.02 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | compartmentalization | linked/transcript/none | 600 | 600/600 (1.00) | 0.55 | 0.00 | 0.00 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | compartmentalization | scattered/transcript/none | 600 | 539/600 (0.90) | 0.30 | 0.00 | 0.09 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | impersonation_credibility | linked/transcript/none | 573 | 459/573 (0.80) | 0.38 | 0.00 | 0.00 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | impersonation_credibility | scattered/transcript/none | 582 | 410/582 (0.70) | 0.29 | 0.00 | 0.03 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | inference_leakage | linked/transcript/none | 588 | 548/588 (0.93) | 0.92 | 0.00 | 0.00 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | inference_leakage | scattered/transcript/none | 0 | 0/0 (-) | - | - | - | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | privacy_extraction | linked/transcript/none | 735 | 410/735 (0.56) | 0.31 | 0.00 | 0.00 | 0 | 0 |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | privacy_extraction | scattered/transcript/none | 786 | 432/786 (0.55) | 0.31 | 0.00 | 0.02 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | benign_utility | linked/transcript/none | 1584 | 1153/1584 (0.73) | 0.70 | 0.00 | 0.00 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | benign_utility | scattered/transcript/none | 1347 | 1202/1347 (0.89) | 0.85 | 0.00 | 0.02 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | compartmentalization | linked/transcript/none | 600 | 539/600 (0.90) | 0.18 | 0.00 | 0.00 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | compartmentalization | scattered/transcript/none | 600 | 551/600 (0.92) | 0.31 | 0.00 | 0.10 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | impersonation_credibility | linked/transcript/none | 573 | 399/573 (0.70) | 0.27 | 0.00 | 0.00 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | impersonation_credibility | scattered/transcript/none | 582 | 435/582 (0.75) | 0.32 | 0.00 | 0.03 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | inference_leakage | linked/transcript/none | 588 | 0/588 (0.00) | 0.00 | 0.00 | 0.00 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | inference_leakage | scattered/transcript/none | 0 | 0/0 (-) | - | - | - | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | privacy_extraction | linked/transcript/none | 735 | 411/735 (0.56) | 0.31 | 0.00 | 0.00 | 0 | 0 |
| volume_linear_p0.3 | A_monolithic | privacy_extraction | scattered/transcript/none | 786 | 416/786 (0.53) | 0.29 | 0.00 | 0.02 | 0 | 0 |

## Matched connectivity pairs (linked vs scattered, unconditional outcome)

| defender | architecture | family | pairs | personas | linked rate | scattered rate | only linked | only scattered | sign-flip p (Holm) | McNemar p (Holm) | bootstrap diff [95% CI] | count-matched pairs: diff, p | judge diff |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---:|
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | compartmentalization | 600 | 100 | 1.00 | 0.90 | 61 | 0 | 0.0001 (0.0008) | 8.7e-19 (6.1e-18) | 0.10 [0.08, 0.13] | 414 (0.69): 0.11, 1.1e-13 | - |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | impersonation_credibility | 573 | 99 | 0.80 | 0.71 | 104 | 52 | 0.0004 (0.0024) | 3.8e-05 (0.00023) | 0.09 [0.04, 0.14] | 315 (0.55): 0.11, 0.00019 | - |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | inference_leakage | 588 | 99 | 0.93 | 0.00 | 548 | 0 | 0.0001 (0.0008) | 2.2e-165 (1.7e-164) | 0.93 [0.90, 0.96] | 588 (1.00): 0.93, 2.2e-165 | - |
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | privacy_extraction | 735 | 99 | 0.56 | 0.56 | 167 | 168 | 0.51 (1) | 1 (1) | -0.00 [-0.05, 0.05] | 447 (0.61): -0.02, 0.67 | - |
| volume_linear_p0.3 | A_monolithic | compartmentalization | 600 | 100 | 0.90 | 0.92 | 35 | 47 | 0.25 (1) | 0.22 (0.9) | -0.02 [-0.05, 0.01] | 414 (0.69): -0.03, 0.15 | - |
| volume_linear_p0.3 | A_monolithic | impersonation_credibility | 573 | 99 | 0.70 | 0.75 | 78 | 111 | 0.075 (0.38) | 0.02 (0.098) | -0.06 [-0.11, -0.01] | 315 (0.55): -0.05, 0.16 | - |
| volume_linear_p0.3 | A_monolithic | inference_leakage | 588 | 99 | 0.00 | 0.00 | 0 | 0 | 1 (1) | 1 (1) | 0.00 [0.00, 0.00] | 588 (1.00): 0.00, 1 | - |
| volume_linear_p0.3 | A_monolithic | privacy_extraction | 735 | 99 | 0.56 | 0.53 | 161 | 142 | 0.27 (1) | 0.3 (0.9) | 0.03 [-0.02, 0.07] | 447 (0.61): 0.04, 0.26 | - |

## Utility by benign template (served / applicable)

| defender | architecture | conclusion_for_planning | recall_own_facts | recall_without_capability | restricted_session_recall |
|---|---|---:|---:|---:|---:|
| connectivity_superlinear_p0.3_q0.2 | A_monolithic | 265/288 | 1566/1566 | 522/522 | 265/555 |
| volume_linear_p0.3 | A_monolithic | 0/288 | 1566/1566 | 522/522 | 267/555 |
