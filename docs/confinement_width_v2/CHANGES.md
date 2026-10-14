# Confinement Width, revision 3 draft: change log

Base: the **October 10, 2026** revision of
`Confinement_Width__Interface_Limits_for_Evaluator_Relative_Control_.pdf` as
checked into `MoralityLabAI/morality-lab-site` at commit `5caf645`
(October 14, 2026). The author's October 10 text, numbering, revision log and
open items are reproduced verbatim (re-typeset from the PDF). Everything
added here is marked `[r3: ...]` in red by the `\revnote` macro; empty the
macro to strip the markers. New theorem-like items are lettered (Remark 2.A,
Lemma 3.A, Remark 4.A, Remark 6.A, Remark 10.A) and new displays tagged
(D1), so no October 10 number moves.

An earlier draft of this directory (commits `fe142a9`..`9f6b728`) was built on
the July 6 text before the October 10 revision was available in the repo; it
has been superseded in full.

## What revision 3 adds

1. **Remark 2.A, Table 1: bits before ports.** The bound restated as a bit
   budget, tabulated at four port precisions, and tied to the October
   revision's own Remark 4.3 (null-model rate `N c(gamma)`, about 0.03
   bits per dimension per step at `gamma sigma = 0.05`) and Remark 6.2 (cap
   `d ceil(b'/b)` at coarse `b`). Names the low-`b` channels (human verdicts,
   short token budgets, symbolic action alphabets) where the bound binds.
2. **Lemma 3.A: discrete skeleton of Proposition 3.1.** Cardinality version
   of the volume count, display (D1), with `log2(K/u0)` in the role of `c0`.
   The recurrence-to-contradiction half is machine-checked; the pigeonhole
   step is a paper proof.
3. **Remark 4.A: the conjecture's state space.** Measured Hessian spectra
   cited (Sagun, Ghorbani, Papyan) behind the October text's
   "bulk-zero-plus-outlier" sentence; no null model exists for harness state
   spaces; Corollary 4.1 read as conditional.
4. **Remark 6.A and Appendix E: Lean 4 development** (core only, no
   Mathlib). Checked: Proposition 6.1 and its region conclusion; Remark 6.1
   (division-free geometric bound); **Remark 6.2 (quantized measurement),
   new in this revision of the Lean code**; Lemma 10.1 and `same_action`;
   the counted witness bound the Control Observability pilot uses;
   Bernoulli in Nat; Lemma 3.A's second half; `data_rate_necessity` and
   its port form. Axiom audit in `lean/CHECK_OUTPUT.txt`: three theorems
   axiom-free, four use `propext` and `Quot.sound`, none uses
   `Classical.choice` or `sorryAx`.
5. **Section 7.1, Table 2: implementation status of Exhibit 7.1** from
   `MoralityLabAI/control-harness` at `c7c1b3d`, with the deviations from
   Appendix A listed (defaults, horizon 80 vs 10^4, 5 seeds vs 50,
   Bernoulli drift vs REINFORCE) and the drift prediction `14/p(lambda)`
   checked against observed medians. Half-discharges debt 5.
6. **Section 9.1: reconciliation with the October 10 FRC papers.** Written
   against the revised papers: competence floor, on-support verifiers,
   Theorem 2 demoted to Conjecture 1, the new conditional Theorem 3, the
   `2^l - |H_l|` masked-branch count, Corollary 2 as the cost of one
   defence, and the companion's split Lemma 1 (verification gap vs.
   Hypothesis 1). Five correspondences, none a theorem; the last one
   separates the two linear floors so a reader does not take them for one
   result. Both FRC revisions now cite this paper's Lemma 10.1; the
   section records that it is also the machine-checked one.
7. **Remark 10.A.** What the checked statements do and do not add (nothing
   to Conjecture 4.1, Corollary 4.1, or Remark 10.2's status).
8. **Section 11.** Debts 8 (Mathlib port of the rate bound) and 9 (measure
   `b` on the harness's real channels) added; debt 5 annotated; debt 1
   annotated.
9. **Citations.** 42 external entries added, all flagged unverified (see
   Sourcing); the six entries the October revision added ([21]-[26]) and the
   Yao 1977 / Goldreich-Goldwasser-Ron 1998 sources for the query bound
   carried into `references.bib`.

## Not changed

- No October 10 statement, proof, remark, equation number, revision note,
  revision-log item or open item was altered.
- The semicircle lower bound in Remark 4.3 was re-derived (Appendix B, last
  paragraph) and agrees.

## Sourcing: what to check before circulation

- **Live site vs. repo.** `moralitylab.xyz` was unreachable from the drafting
  container (proxy policy denial). All three papers were read from the
  `morality-lab-site` repository at `5caf645`, which the author pushed on
  October 14 carrying the October 10 revisions. If the live site is newer
  still, Section 9.1 should be re-read against it.
- **Bibliographic fields.** No access to arXiv, Crossref, DBLP or Semantic
  Scholar. The 42 added entries were written from memory of the record.
  Titles and author lists are the parts most likely to be right; volume,
  issue, page and year fields need checking. Check first: `donkers2014`,
  `lee2022`, `colonius2013`, `kawan2011`, `subag2017`, `fyodorov2007`,
  `skalse2022` (title: "reward gaming" vs. "reward hacking"), `papyan2020`,
  `demoura2021`, `yao1977`, `goldreich1998`.
- **Lean build.** All five modules and `Check.lean` were checked with Lean
  `v4.35.0` built from source (transcript in `lean/CHECK_OUTPUT.txt`).
  `lake` itself was not exercised, so `lake build` on an elan toolchain is
  untested; lemma names (`Nat.pow_le_pow_left`, `Nat.le_mul_of_pos_right`,
  `Nat.mul_left_comm`, `Nat.gt_of_not_le`) are the likely breakage on a
  different version.
- **Exhibit numbers.** Table 2 reads
  `results/confinement_width/fiber_routing_summary.json` at control-harness
  `c7c1b3d` and was re-verified against the file. If the exhibit is re-run
  with the Appendix A defaults, regenerate the table.
- **Typesetting.** The October build used Computer Modern (the author's
  open item (c)); this build does the same. Theorem-like environments use
  one counter per type, as the author's builds do.

## Open for the author (revision 3)

- Whether Corollary 4.1 belongs in the abstract given Remark 4.A.
- Whether the shipped exhibit defaults or Appendix A's are canonical.
- Whether Section 9.1 should move into the FRC paper, which now cites this one.
