# Confinement Width, revision 2

- `confinement_width_v2.tex`, `references.bib` -> `confinement_width_v2.pdf`
  (`pdflatex; bibtex; pdflatex; pdflatex`).
- `lean/` -> Lean 4 (core only, no Mathlib) development checked against
  `v4.35.0`: `cd lean && lake build && lean Check.lean`.
- `CHANGES.md` -> what changed from the July 6, 2026 version, and what still
  needs checking by a person with network access.
