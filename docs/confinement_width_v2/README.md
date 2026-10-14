# Confinement Width, revision 3 draft

Built on the author's October 10, 2026 revision (site repo commit `5caf645`).

- `confinement_width_v2.tex`, `references.bib` -> `confinement_width_v2.pdf`
  (`pdflatex; bibtex; pdflatex; pdflatex`). Additions are marked `[r3: ...]`.
- `lean/` -> Lean 4 (core only, no Mathlib) development checked against
  `v4.35.0`: `cd lean && lake build && lean Check.lean`. The transcript of
  the check that was actually run is `lean/CHECK_OUTPUT.txt`.
- `CHANGES.md` -> what revision 3 adds, and what still needs checking by a
  person with network access.
