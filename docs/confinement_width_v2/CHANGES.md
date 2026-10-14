# Confinement Width, revision 2: change log

Base: `Confinement_Width__Interface_Limits_for_Evaluator_Relative_Control_.pdf`
(July 6, 2026) as checked into `MoralityLabAI/morality-lab-site` at commit
`9477211` (October 9, 2026). The revision was prepared with coding-agent
assistance in an offline container; see "Sourcing" below for what that
implies.

The retained text is the author's, re-typeset from the PDF. Insertions are
marked `[v2: ...]` in red in the compiled PDF (macro `\revnote`); delete the
macro's body to strip the markers before circulation.

## What changed and why

1. **Bits before ports (new Remark 2.4, Table 1).** The bound is a rate,
   `h2 = m log2(1+delta)` bits per step; the port count is that divided by
   `b`. At `b = 32` and `delta = 0.1` a thousand unstable modes need five ports.
   v1's `Omega(m)` headline holds only for fixed low `b`. The table makes the
   regime explicit and names the low-`b` channels where the bound actually
   constrains: human approvals, short token budgets, symbolic action
   alphabets. The abstract and Section 8 were adjusted to match.

2. **Conjecture 4.1 relabelled (new Remark 4.3).** The conjecture lives in
   parameter space under a GOE null. Measured Hessian spectra of trained
   networks (Sagun et al., Ghorbani et al., Papyan) are bulk-near-zero plus few
   outliers, so the parameter-space instance is contradicted; the harness
   state spaces have no null model at all. Corollary 4.2 is kept but
   explicitly conditional. Item 1 of Future Work now says: write the null for
   the observed space or drop the corollary from the abstract.

3. **Discrete counting skeleton (new Lemma 3.2).** A cardinality version of
   the read-side data-rate argument: disturbance alphabet `Lambda`,
   observation alphabet `A = 2^R`, uncertainty cardinality `u_t`, recurrence
   `u_{t+1} A >= Lambda u_t`, hence bounded uncertainty forces `Lambda <= A`.
   The pigeonhole step is a paper proof; the recurrence-to-contradiction
   step is machine-checked. This also gives the finite-horizon shape that
   Remark 3.3 lacked.

4. **Exhibit 7.1 implementation status (new Section 7.1, Table 2).** The
   exhibit shipped in `MoralityLabAI/control-harness`
   (`src/evals/confinement_width.py`) with parameters that differ from
   Appendix A (`zeta`, `beta`, `y0`, `z0`, `u_bar`, horizon 80 not 10^4,
   5 seeds not 50, Bernoulli drift not REINFORCE). The section lists the
   deviations, tabulates observed medians against the drift prediction
   `14 / p(lambda)`, and says plainly that no optimizer is in the loop yet.
   v1 promised to cite its own plot; v2 cites the run it has.

5. **Lean 4 formalization (new Section 12, Table 3, `lean/`).** Core Lean
   only, no Mathlib, so it checks offline. Covered: Proposition 6.1 and its
   region conclusion; Remark 6.1 (division-free geometric bound); Lemma 10.1
   and `same_action`; the counted witness bound that the Control
   Observability pilot uses; Bernoulli in Nat; the counting lemma's second
   half; `data_rate_necessity` and its port form. Not covered: Theorem 3.1
   (needs Lebesgue measure), Conjecture 4.1, the exhibit.

6. **FRC reconciliation (new Section 9.1).** Four correspondences with the
   FRC papers as checked into the site repo: priced action channels are
   write ports; oversight bandwidth `B` is read rate; attested self-mods are
   the audit term `A_k`; eigensystem escape (FRC Lemma 2) is fiber ambiguity
   with the colliding states supplied by the masked branch. Stated as
   correspondences, not theorems. The section says explicitly that nothing
   here upgrades FRC Theorem 2.

7. **Citations.** 41 entries added (networked-control surveys and the
   feedback/invariance entropy relation; side-information limits; symbolic
   abstraction; CBF survey; Koopman/Mori-Zwanzig in data-driven form;
   spin-glass complexity and its deep-learning lineage; Hessian spectra; AI
   control, scalable oversight, steering, Goodhart; POMDPs; Lean and
   Mathlib; the TRM, HRM, LDT and FRC sources; the harness repository).
   Every added entry is flagged unverified (see Sourcing).

8. **Minor.** Remark 3.3 points at the discrete finite-horizon shape.
   Remark 6.1 names the Lean statement. Section 5 cites the TRM/LDT hybrid
   paper for the LDT gloss. Future Work gains items 6 (Mathlib port) and 7
   (measure `b` for the harness's real channels).

## Not changed

- No theorem statement was altered. Theorem 3.1, Proposition 6.1, Corollary
  6.3, Lemma 10.1, Propositions 10.1 and 10.2 are verbatim up to notation.
- Both public corrections (Remarks 3.2 and 3.5) are retained verbatim.
- Appendices B, C, D retained; B gained one flagged item.
- The cosmology remark (4.4) is retained as the author wrote it.

## Sourcing: what to check before circulation

- **Live site vs. repo.** `moralitylab.xyz` was unreachable from the drafting
  container (proxy policy denial), so every "site" document was read from
  the `morality-lab-site` repository at `9477211`. The FRC paper there is the
  August 15, 2025 draft (PDF created September 3, 2025). If the live site
  carries a later FRC revision, Section 9.1's references to its Theorem 2,
  Lemma 2, claim P2, Definition 4/11, and the companion's `Gamma = K_ver - B`
  must be re-checked against that version.
- **Bibliographic fields.** The container had no access to arXiv, Crossref,
  DBLP or Semantic Scholar. All 41 added entries were written from memory of
  the record. Titles and author lists are the parts most likely to be right;
  volume, issue, page and year fields need checking. Entries most worth
  checking first: `donkers2014`, `lee2022`, `colonius2013`, `kawan2011`,
  `subag2017`, `fyodorov2007`, `skalse2022` (title: "reward gaming" vs.
  "reward hacking"), `papyan2020`, `demoura2021`.
- **Lean build.** The development was written against Lean `v4.35.0` built
  from source. If `lake build` fails on a different toolchain, the likely
  culprits are lemma names (`Nat.pow_le_pow_left`, `Nat.le_mul_of_pos_right`,
  `Nat.mul_left_comm`) rather than the proofs' structure.
- **Exhibit numbers.** Table 2 reads `results/confinement_width/fiber_routing_summary.json`
  at control-harness `c7c1b3d`. If the exhibit is re-run with the Appendix A
  defaults, regenerate the table.

## Suggested next edits the author may not want from an assistant

- Decide whether Corollary 4.2 belongs in the abstract at all given Remark 4.3.
- Decide whether the exhibit's shipped defaults or the Appendix A defaults
  are canonical, and change the other.
- Port `lean/` to Mathlib so Proposition 6.1 is stated over the reals and
  Lemma 3.2's pigeonhole step is proved over `Finset`.
