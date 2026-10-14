/-!
# Predictive compounding (paper, Remark 6.1)

If the controller measures `z` only at `t = 0` and certifies a model
trajectory, the deviation `d_t` between the model trajectory and the true
projected trajectory obeys `d_{t+1} ≤ L d_t + η̄`, whence
`d_T ≤ η̄ Σ_{i<T} L^i = η̄ (L^T - 1)/(L - 1)` for `L ≠ 1` and `η̄ T` for `L = 1`.
The division-free form is proved here over `Nat`, read as scaled units.
-/

namespace ConfinementWidth

/-- `geom L T = Σ_{i<T} L^i`, by the recursion `geom (T+1) = 1 + L * geom T`. -/
def geom (L : Nat) : Nat → Nat
  | 0     => 0
  | T + 1 => 1 + L * geom L T

theorem geom_one : ∀ T, geom 1 T = T
  | 0     => rfl
  | T + 1 => by simp only [geom, geom_one T]; omega

theorem predictive_defect_bound (L eta : Nat) (d : Nat → Nat)
    (h0 : d 0 = 0) (hstep : ∀ t, d (t + 1) ≤ L * d t + eta) :
    ∀ T, d T ≤ eta * geom L T := by
  intro T
  induction T with
  | zero => simp [h0, geom]
  | succ T ih =>
    have h1 : L * d T ≤ L * (eta * geom L T) := Nat.mul_le_mul_left L ih
    calc d (T + 1) ≤ L * d T + eta := hstep T
      _ ≤ L * (eta * geom L T) + eta := Nat.add_le_add_right h1 eta
      _ = eta * geom L (T + 1) := by
          simp only [geom, Nat.mul_add, Nat.mul_one]
          rw [Nat.mul_left_comm L eta (geom L T)]
          exact Nat.add_comm _ _

/-- The `L = 1` case: linear compounding `d_T ≤ η̄ T`. -/
theorem predictive_defect_bound_contractive_edge (eta : Nat) (d : Nat → Nat)
    (h0 : d 0 = 0) (hstep : ∀ t, d (t + 1) ≤ d t + eta) :
    ∀ T, d T ≤ eta * T := by
  intro T
  have := predictive_defect_bound 1 eta d h0 (by intro t; simpa using hstep t) T
  simpa [geom_one] using this

end ConfinementWidth
