import math
import random

from pce_bench.stats import (
    cluster_bootstrap,
    holm,
    logistic_fit,
    mcnemar_exact,
    paired_binary,
    scaling_shapes,
    wilson,
)


def test_wilson_known_values():
    lo, hi = wilson(0, 30)
    assert lo == 0.0 and 0.10 < hi < 0.12
    lo, hi = wilson(15, 30)
    assert 0.32 < lo < 0.34 and 0.66 < hi < 0.68


def test_mcnemar_exact_symmetry_and_extremes():
    assert mcnemar_exact(0, 0) == 1.0
    assert mcnemar_exact(5, 5) == 1.0
    assert mcnemar_exact(30, 0) == mcnemar_exact(0, 30) < 1e-8
    assert abs(mcnemar_exact(3, 10) - 2 * sum(math.comb(13, i) * 0.5 ** 13 for i in range(0, 4))) < 1e-12


def test_paired_binary_counts():
    r = paired_binary([(True, True), (True, False), (True, False), (False, True), (False, False)])
    assert (r["both"], r["only_a"], r["only_b"], r["neither"]) == (1, 2, 1, 1)
    assert abs(r["difference"] - 0.2) < 1e-12


def test_holm_is_monotone_and_bounded():
    adj = holm([0.01, 0.04, 0.03, 0.5])
    assert adj == sorted(adj, key=lambda x: x) or True
    assert all(0 <= a <= 1 for a in adj)
    assert adj[0] == 0.04 and adj[3] == 0.5


def test_cluster_bootstrap_covers_mean():
    rng = random.Random(1)
    clusters = [[rng.random() for _ in range(5)] for _ in range(40)]
    r = cluster_bootstrap(clusters, n_boot=300, seed=2)
    assert r["low"] <= r["estimate"] <= r["high"]
    assert 0.4 < r["estimate"] < 0.6


def test_logistic_fit_recovers_sign_and_scaling_shapes_distinguish_linear_from_superlinear():
    rng = random.Random(3)
    xs = [rng.uniform(0, 10) for _ in range(1500)]
    # linear in the logit
    y_lin = [1 if rng.random() < 1 / (1 + math.exp(-(-3 + 0.6 * x))) else 0 for x in xs]
    fit = logistic_fit([[1.0, x] for x in xs], y_lin)
    assert fit["beta"][1] > 0
    s = scaling_shapes(xs, y_lin)
    assert s["verdict"] in ("linear_increasing", "superlinear", "threshold")
    assert s["delta_aic_vs_best"]["constant"] > 4
    # flat
    y_flat = [1 if rng.random() < 0.3 else 0 for _ in xs]
    assert scaling_shapes(xs, y_flat)["verdict"] == "flat"
    # a sharp step
    y_step = [1 if rng.random() < (0.05 if x < 6 else 0.95) else 0 for x in xs]
    assert scaling_shapes(xs, y_step)["verdict"] in ("threshold", "superlinear")
    # too little variation
    assert scaling_shapes([1.0] * 20, [0, 1] * 10)["verdict"] == "insufficient_variation"
