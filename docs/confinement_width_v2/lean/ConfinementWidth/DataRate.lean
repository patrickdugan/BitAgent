/-!
# Discrete data-rate necessity (combinatorial skeleton of Theorem 3.1)

Model.  The controller's uncertainty about the plant state at step `t` is a
finite set of cardinality `u t`.  Each step the plant branches
nondeterministically over a disturbance alphabet of size `Λ` (the discrete
analogue of volume expansion by `|det A_u|`), injectively in `(state,
disturbance)` for each fixed control.  The controller observes one of `A`
symbols (`A = 2^R` for `R` bits per step) and chooses its control from that
symbol alone.

Counting step (paper, Lemma 3.2; proved there, assumed here as `hrec`).  Some
observation symbol is received by at least `u t / A` states (pigeonhole); on
that class the control is constant, so the images of those states under the
`Λ` disturbances are `Λ * (that many)` distinct states.  Hence
`u (t+1) * A ≥ Λ * u t`.

What is checked here: the recurrence forces the uncertainty to exceed any
finite target unless `Λ ≤ A`.  So keeping the uncertainty set inside a target
of size `K` for all time requires `R ≥ log2 Λ`.
-/

namespace ConfinementWidth

theorem one_le_pow {a : Nat} (ha : 1 ≤ a) : ∀ n, 1 ≤ a ^ n
  | 0     => Nat.le_refl 1
  | n + 1 => by
    rw [Nat.pow_succ]
    exact Nat.le_trans (one_le_pow ha n)
      (Nat.le_mul_of_pos_right _ (Nat.lt_of_lt_of_le Nat.zero_lt_one ha))

/-- Bernoulli-type inequality in `Nat`: `(a+1)^(n+1) ≥ a^(n+1) + (n+1) a^n`. -/
theorem pow_succ_lower (a : Nat) : ∀ n, a ^ (n + 1) + (n + 1) * a ^ n ≤ (a + 1) ^ (n + 1)
  | 0 => by simp only [Nat.pow_succ, Nat.pow_zero]; omega
  | n + 1 => by
    have ih := pow_succ_lower a n
    have h1 : (a ^ (n + 1) + (n + 1) * a ^ n) * (a + 1) ≤ (a + 1) ^ (n + 1) * (a + 1) :=
      Nat.mul_le_mul_right (a + 1) ih
    have h2 : (a + 1) ^ (n + 1 + 1) = (a + 1) ^ (n + 1) * (a + 1) := Nat.pow_succ (a + 1) (n + 1)
    rw [h2]
    refine Nat.le_trans ?_ h1
    have e1 : a ^ (n + 1) * a = a ^ (n + 1 + 1) := (Nat.pow_succ a (n + 1)).symm
    have e2 : a ^ n * a = a ^ (n + 1) := (Nat.pow_succ a n).symm
    simp only [Nat.add_mul, Nat.mul_add, Nat.mul_one, Nat.one_mul, Nat.mul_assoc, e1, e2]
    omega

/-- Weighted uncertainty `w t = u t * A^t` grows at least like `Λ^t`. -/
theorem weighted_growth (A Lam : Nat) (u : Nat → Nat) (hu0 : 1 ≤ u 0)
    (hrec : ∀ t, Lam * u t ≤ u (t + 1) * A) :
    ∀ t, Lam ^ t ≤ u t * A ^ t
  | 0 => by simpa using hu0
  | t + 1 => by
    have ih := weighted_growth A Lam u hu0 hrec t
    calc Lam ^ (t + 1) = Lam * Lam ^ t := by rw [Nat.pow_succ, Nat.mul_comm]
      _ ≤ Lam * (u t * A ^ t) := Nat.mul_le_mul_left Lam ih
      _ = (Lam * u t) * A ^ t := by rw [Nat.mul_assoc]
      _ ≤ (u (t + 1) * A) * A ^ t := Nat.mul_le_mul_right _ (hrec t)
      _ = u (t + 1) * A ^ (t + 1) := by
          rw [Nat.pow_succ, Nat.mul_assoc, Nat.mul_comm A (A ^ t)]

/-- If `Λ > A`, the uncertainty cardinality is unbounded. -/
theorem uncertainty_unbounded (A Lam : Nat) (hA : 1 ≤ A) (hLam : A + 1 ≤ Lam)
    (u : Nat → Nat) (hu0 : 1 ≤ u 0) (hrec : ∀ t, Lam * u t ≤ u (t + 1) * A) :
    ∀ K, ∃ T, K < u T := by
  intro K
  refine ⟨K * A + 1, ?_⟩
  apply Nat.gt_of_not_le
  intro hle
  have hw := weighted_growth A Lam u hu0 hrec (K * A + 1)
  have hpow : (A + 1) ^ (K * A + 1) ≤ Lam ^ (K * A + 1) := Nat.pow_le_pow_left hLam _
  have hb := pow_succ_lower A (K * A)
  have hK : u (K * A + 1) * A ^ (K * A + 1) ≤ K * A ^ (K * A + 1) :=
    Nat.mul_le_mul_right _ hle
  have hone := one_le_pow hA (K * A)
  -- (K*A+1) * A^(K*A) = K * A^(K*A+1) + A^(K*A)
  have hsplit : (K * A + 1) * A ^ (K * A) = K * A ^ (K * A + 1) + A ^ (K * A) := by
    rw [Nat.add_mul, Nat.one_mul, Nat.pow_succ, Nat.mul_assoc, Nat.mul_comm A (A ^ (K * A))]
  rw [hsplit] at hb
  omega

/-- Data-rate necessity.  Bounded uncertainty for all time forces `Λ ≤ A`;
with `A = 2^R`, this is `R ≥ log2 Λ` bits per step. -/
theorem data_rate_necessity (A Lam K : Nat) (hA : 1 ≤ A)
    (u : Nat → Nat) (hu0 : 1 ≤ u 0) (hrec : ∀ t, Lam * u t ≤ u (t + 1) * A)
    (hbound : ∀ t, u t ≤ K) : Lam ≤ A := by
  cases Nat.lt_or_ge A Lam with
  | inr hge => exact hge
  | inl hlt =>
    exfalso
    obtain ⟨T, hT⟩ :=
      uncertainty_unbounded A Lam hA (Nat.succ_le_of_lt hlt) u hu0 hrec K
    exact Nat.lt_irrefl _ (Nat.lt_of_lt_of_le hT (hbound T))

/-- Port form: with `s` ports of `b` bits each, `A = 2^(s*b)`; invariance in a
finite target needs `Λ ≤ 2^(s*b)`. -/
theorem port_necessity (s b Lam K : Nat)
    (u : Nat → Nat) (hu0 : 1 ≤ u 0) (hrec : ∀ t, Lam * u t ≤ u (t + 1) * 2 ^ (s * b))
    (hbound : ∀ t, u t ≤ K) : Lam ≤ 2 ^ (s * b) :=
  data_rate_necessity (2 ^ (s * b)) Lam K (one_le_pow (by decide) _) u hu0 hrec hbound

end ConfinementWidth
