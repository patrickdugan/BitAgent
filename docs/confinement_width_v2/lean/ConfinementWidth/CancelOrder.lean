/-!
# Order facts used by the quarantine transfer proof

The reactive transfer proposition (paper, Proposition 6.1) uses only three
facts about the evaluator's value type: reflexivity and transitivity of `≤`,
and right-cancellation of addition under `≤`.  Bundling exactly these lets the
proof be checked in core Lean without Mathlib.  `Int` and `Nat` are instances;
`ℝ` is an instance in Mathlib (`le_of_add_le_add_right`).
-/

namespace ConfinementWidth

class CancelOrder (R : Type u) [LE R] [Add R] : Prop where
  le_refl : ∀ a : R, a ≤ a
  le_trans : ∀ {a b c : R}, a ≤ b → b ≤ c → a ≤ c
  le_of_add_le_add_right : ∀ {a b c : R}, a + c ≤ b + c → a ≤ b

instance : CancelOrder Int where
  le_refl := Int.le_refl
  le_trans := Int.le_trans
  le_of_add_le_add_right := fun h => by omega

instance : CancelOrder Nat where
  le_refl := Nat.le_refl
  le_trans := Nat.le_trans
  le_of_add_le_add_right := fun h => by omega

end ConfinementWidth
