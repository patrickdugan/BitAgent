import ConfinementWidth.CancelOrder

/-!
# Reactive quarantined confinement (paper, Proposition 6.1)

A quarantine is a projection `phi : X → Z` of the base state, a projected
model `G`, a projected evaluator `v`, and a certified set `S`.  The paper's
hypotheses are

* evaluator sufficiency on `S`: `|V x - v (phi x)| ≤ ε`;
* a closure-defect bound `‖phi (F x u) - G (phi x) u‖ ≤ η̄` together with
  `v` being `L`-Lipschitz, used only through `v (G (phi x) u) - L η̄ ≤ v (phi (F x u))`;
* the robust one-step condition `∀ z, v z ≥ τ + ε → ∃ u, v (G z u) ≥ τ + ε + L η̄`;
* `S ⊇ R_V ∪ F (R_V × U)`.

The statement below is slightly more general than the paper's: it uses only
the lower half of sufficiency (`v (phi x) ≤ V x + ε`), replaces the Lipschitz
and defect hypotheses by their one consequence (a defect penalty `c` in
evaluator units), and fixes a policy `pi : Z → U` realising the robust step.
Subtraction is avoided so the proof only needs `CancelOrder`.
-/

namespace ConfinementWidth

structure Quarantine (X Z U R : Type) where
  F   : X → U → X      -- base dynamics
  phi : X → Z          -- projection (harness state)
  G   : Z → U → Z      -- projected transition model
  V   : X → R          -- true evaluator
  v   : Z → R          -- projected evaluator
  S   : X → Prop       -- a-priori certified set
  tau : R              -- evaluator threshold
  eps : R              -- sufficiency slack
  c   : R              -- defect penalty, paper: L_v * η̄

variable {X Z U R : Type} [LE R] [Add R] [CancelOrder R]

structure ReactiveHypotheses (Q : Quarantine X Z U R) (pi : Z → U) : Prop where
  /-- `R_V ⊆ S`. -/
  region_in_S : ∀ x, Q.tau ≤ Q.V x → Q.S x
  /-- `F (R_V × U) ⊆ S` (forward adequacy). -/
  forward_adequate : ∀ x u, Q.tau ≤ Q.V x → Q.S (Q.F x u)
  /-- Lower half of `(V, ε)`-sufficiency on `S`. -/
  sufficiency : ∀ x, Q.S x → Q.v (Q.phi x) ≤ Q.V x + Q.eps
  /-- Defect penalty: the projected model overestimates the projected value of
  the true next state by at most `c`. -/
  defect : ∀ x u, Q.S x → Q.v (Q.G (Q.phi x) u) ≤ Q.v (Q.phi (Q.F x u)) + Q.c
  /-- Robust one-step condition realised by `pi`. -/
  robust_step : ∀ z, Q.tau + Q.eps ≤ Q.v z → (Q.tau + Q.eps) + Q.c ≤ Q.v (Q.G z (pi z))

/-- Closed-loop trajectory under the projected policy `pi ∘ phi`. -/
def traj (Q : Quarantine X Z U R) (pi : Z → U) (x0 : X) : Nat → X
  | 0     => x0
  | t + 1 => Q.F (traj Q pi x0 t) (pi (Q.phi (traj Q pi x0 t)))

/-- Proposition 6.1: if `x0 ∈ S` and `v (phi x0) ≥ τ + ε`, every closed-loop
state stays in `S`, keeps projected margin `τ + ε`, and satisfies `V ≥ τ`. -/
theorem reactive_confinement (Q : Quarantine X Z U R) (pi : Z → U)
    (H : ReactiveHypotheses Q pi) (x0 : X)
    (hS0 : Q.S x0) (hv0 : Q.tau + Q.eps ≤ Q.v (Q.phi x0)) :
    ∀ t, Q.S (traj Q pi x0 t)
        ∧ Q.tau + Q.eps ≤ Q.v (Q.phi (traj Q pi x0 t))
        ∧ Q.tau ≤ Q.V (traj Q pi x0 t) := by
  intro t
  induction t with
  | zero =>
    refine ⟨hS0, hv0, ?_⟩
    exact CancelOrder.le_of_add_le_add_right
      (CancelOrder.le_trans hv0 (H.sufficiency x0 hS0))
  | succ t ih =>
    obtain ⟨hS, hv, hV⟩ := ih
    have hS' : Q.S (traj Q pi x0 (t + 1)) :=
      H.forward_adequate _ _ hV
    have hstep := H.robust_step _ hv
    have hdef := H.defect (traj Q pi x0 t) (pi (Q.phi (traj Q pi x0 t))) hS
    have hv' : Q.tau + Q.eps ≤ Q.v (Q.phi (traj Q pi x0 (t + 1))) :=
      CancelOrder.le_of_add_le_add_right (CancelOrder.le_trans hstep hdef)
    refine ⟨hS', hv', ?_⟩
    exact CancelOrder.le_of_add_le_add_right
      (CancelOrder.le_trans hv' (H.sufficiency _ hS'))

/-- The region actually certified is the true evaluator region, for all time. -/
theorem reactive_confinement_region (Q : Quarantine X Z U R) (pi : Z → U)
    (H : ReactiveHypotheses Q pi) (x0 : X)
    (hS0 : Q.S x0) (hv0 : Q.tau + Q.eps ≤ Q.v (Q.phi x0)) :
    ∀ t, Q.tau ≤ Q.V (traj Q pi x0 t) :=
  fun t => (reactive_confinement Q pi H x0 hS0 hv0 t).2.2

end ConfinementWidth
