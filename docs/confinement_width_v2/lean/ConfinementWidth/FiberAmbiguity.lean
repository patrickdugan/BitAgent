/-!
# Fiber ambiguity (paper, Lemma 10.1) and its counted form

Any controller or certificate that factors through the projection `phi` must
treat two states with the same projection identically.  If one of them is
inside the evaluator region with slack and the other is outside with slack,
no `phi`-measurable certificate can be correct on both.

The counted form is the witness lower bound used by the Control Observability
pilot in the Control-Harness repository: `n` colliding, oppositely labelled
pairs force at least `n` classification errors on any classifier that reads
only the projected fields.
-/

namespace ConfinementWidth

variable {X Z A R : Type}

/-- A controller that factors through `phi` cannot act differently on states
with the same projection. -/
theorem same_action (phi : X → Z) (kappa : Z → A) {x x' : X}
    (h : phi x = phi x') : kappa (phi x) = kappa (phi x') := by
  rw [h]

/-- Lemma 10.1.  There is no `phi`-measurable certificate that accepts every
state with `V ≥ τ + ε` and rejects every state with `V < τ - ε`, as soon as two
such states collide under `phi`. -/
theorem fiber_ambiguity [LE R] [LT R] [Add R] [Sub R]
    (phi : X → Z) (V : X → R) (tau eps : R)
    (x x' : X) (hcoll : phi x = phi x')
    (hx : tau + eps ≤ V x) (hx' : V x' < tau - eps) :
    ¬ ∃ cert : Z → Bool,
        (∀ y, tau + eps ≤ V y → cert (phi y) = true) ∧
        (∀ y, V y < tau - eps → cert (phi y) = false) := by
  rintro ⟨cert, hsound, hcomplete⟩
  have h1 := hsound x hx
  have h2 := hcomplete x' hx'
  rw [← hcoll] at h2
  rw [h1] at h2
  exact Bool.noConfusion h2

/-- Finite sum `Σ_{i<n} f i`, self-contained to avoid library dependence. -/
def sumTo (f : Nat → Nat) : Nat → Nat
  | 0     => 0
  | n + 1 => sumTo f n + f n

theorem sumTo_ge (f : Nat → Nat) : ∀ n, (∀ i, i < n → 1 ≤ f i) → n ≤ sumTo f n
  | 0, _ => Nat.le_refl 0
  | n + 1, h => by
    have ih := sumTo_ge f n (fun i hi => h i (Nat.lt_succ_of_lt hi))
    have hn := h n (Nat.lt_succ_self n)
    simp only [sumTo]
    omega

/-- Error count of a Boolean classifier on the `i`-th witness pair:
the first member should be accepted, the second rejected. -/
def pairErrors (phi : X → Z) (cert : Z → Bool) (p : Nat → X × X) (i : Nat) : Nat :=
  (if cert (phi (p i).1) = true then 0 else 1) +
  (if cert (phi (p i).2) = false then 0 else 1)

/-- Witness bound.  If the first `n` pairs each collide under `phi`, any
classifier reading only `phi` makes at least `n` errors on those `2n` records.
This is the pair-witness ceiling `1 - (#colliding pairs)/N` of the pilot,
with `N = 2n`. -/
theorem witness_bound (phi : X → Z) (cert : Z → Bool) (p : Nat → X × X) (n : Nat)
    (hcoll : ∀ i, i < n → phi (p i).1 = phi (p i).2) :
    n ≤ sumTo (pairErrors phi cert p) n := by
  apply sumTo_ge
  intro i hi
  unfold pairErrors
  rw [hcoll i hi]
  cases cert (phi (p i).2) <;> simp

end ConfinementWidth
