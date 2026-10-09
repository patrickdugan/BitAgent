"""Statistics for PCE-Bench, standard library only.

Everything here is exact or resampling-based so the harness has no numeric
dependency.  The scaling test fits four nested shapes to attack success as a
function of a context measure and reports them side by side; the verdict rule
is pre-registered in docs/03_statistical_analysis_plan.md.
"""

from __future__ import annotations

import math
import random
from typing import Any, Callable, Iterable, Sequence

Z95 = 1.959963984540054


# ---------------------------------------------------------------------------
# Proportions and paired tests
# ---------------------------------------------------------------------------

def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    if n <= 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def _binom_pmf(k: int, n: int, p: float) -> float:
    return math.comb(n, k) * (p ** k) * ((1 - p) ** (n - k))


def mcnemar_exact(b: int, c: int) -> float:
    """Exact two-sided McNemar p-value from the discordant counts b and c."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(_binom_pmf(i, n, 0.5) for i in range(0, k + 1))
    return min(1.0, 2 * tail)


def paired_binary(pairs: Iterable[tuple[bool, bool]]) -> dict[str, Any]:
    """Pair counts and McNemar for (condition_a, condition_b) outcomes."""
    both = only_a = only_b = neither = 0
    for a, b in pairs:
        if a and b:
            both += 1
        elif a:
            only_a += 1
        elif b:
            only_b += 1
        else:
            neither += 1
    n = both + only_a + only_b + neither
    return {
        "n_pairs": n,
        "both": both,
        "only_a": only_a,
        "only_b": only_b,
        "neither": neither,
        "rate_a": (both + only_a) / n if n else None,
        "rate_b": (both + only_b) / n if n else None,
        "difference": ((both + only_a) - (both + only_b)) / n if n else None,
        "mcnemar_p": mcnemar_exact(only_a, only_b),
    }


def sign_flip_test(differences: Sequence[float], *, n_perm: int = 10000, seed: int = 0, exact_max: int = 20) -> dict[str, Any]:
    """Cluster-aware paired test on per-cluster mean differences.

    Under the null that linked and scattered are exchangeable within a
    persona, the sign of each persona's mean difference is a fair coin.  The
    statistic is the mean of the per-persona differences.  Exact enumeration
    of all 2^n sign patterns when n <= exact_max, Monte Carlo otherwise.
    This is the primary p-value for the matched-pair design because McNemar
    treats pairs within a persona as independent and they are not.
    """
    d = [float(x) for x in differences]
    n = len(d)
    if n == 0:
        return {"n_clusters": 0, "statistic": None, "p_value": None, "method": "none"}
    stat = sum(d) / n
    nonzero = [x for x in d if x != 0.0]
    if not nonzero:
        return {"n_clusters": n, "statistic": stat, "p_value": 1.0, "method": "degenerate_all_zero"}
    if len(nonzero) <= exact_max:
        m = len(nonzero)
        count = 0
        total = 1 << m
        target = abs(sum(nonzero))
        for mask in range(total):
            s = 0.0
            for i in range(m):
                s += nonzero[i] if (mask >> i) & 1 else -nonzero[i]
            if abs(s) >= target - 1e-12:
                count += 1
        return {"n_clusters": n, "statistic": stat, "p_value": count / total, "method": f"exact_{m}"}
    rng = random.Random(seed)
    target = abs(sum(nonzero))
    hits = 0
    for _ in range(n_perm):
        s = 0.0
        for x in nonzero:
            s += x if rng.random() < 0.5 else -x
        if abs(s) >= target - 1e-12:
            hits += 1
    return {"n_clusters": n, "statistic": stat, "p_value": (hits + 1) / (n_perm + 1), "method": f"monte_carlo_{n_perm}"}


def holm(pvalues: Sequence[float]) -> list[float]:
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, idx in enumerate(order):
        val = min(1.0, (m - rank) * pvalues[idx])
        running = max(running, val)
        adjusted[idx] = running
    return adjusted


# ---------------------------------------------------------------------------
# Cluster bootstrap
# ---------------------------------------------------------------------------

def cluster_bootstrap(
    clusters: Sequence[Sequence[float]],
    statistic: Callable[[Sequence[float]], float] = lambda xs: sum(xs) / len(xs),
    *,
    n_boot: int = 1000,
    seed: int = 0,
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Percentile CI resampling whole clusters (personas) with replacement."""
    clusters = [list(c) for c in clusters if len(c)]
    if not clusters:
        return {"estimate": None, "low": None, "high": None, "n_clusters": 0}
    rng = random.Random(seed)
    flat = [x for c in clusters for x in c]
    est = statistic(flat)
    draws = []
    for _ in range(n_boot):
        sample = [x for _ in range(len(clusters)) for x in clusters[rng.randrange(len(clusters))]]
        draws.append(statistic(sample))
    draws.sort()
    lo = draws[int(math.floor(alpha / 2 * (n_boot - 1)))]
    hi = draws[int(math.ceil((1 - alpha / 2) * (n_boot - 1)))]
    return {"estimate": est, "low": lo, "high": hi, "n_clusters": len(clusters), "n_boot": n_boot}


def cluster_bootstrap_difference(
    clusters_a: Sequence[Sequence[float]],
    clusters_b: Sequence[Sequence[float]],
    *,
    n_boot: int = 1000,
    seed: int = 0,
) -> dict[str, Any]:
    """CI for mean(a) - mean(b) when both are measured on the same clusters (paired by index)."""
    pairs = [(list(a), list(b)) for a, b in zip(clusters_a, clusters_b) if len(a) and len(b)]
    if not pairs:
        return {"estimate": None, "low": None, "high": None, "n_clusters": 0}
    rng = random.Random(seed)

    def diff(ps: Sequence[tuple[list[float], list[float]]]) -> float:
        fa = [x for a, _ in ps for x in a]
        fb = [x for _, b in ps for x in b]
        return sum(fa) / len(fa) - sum(fb) / len(fb)

    est = diff(pairs)
    draws = sorted(diff([pairs[rng.randrange(len(pairs))] for _ in range(len(pairs))]) for _ in range(n_boot))
    return {"estimate": est, "low": draws[int(0.025 * (n_boot - 1))], "high": draws[int(math.ceil(0.975 * (n_boot - 1)))], "n_clusters": len(pairs), "n_boot": n_boot}


# ---------------------------------------------------------------------------
# Logistic regression (IRLS) and scaling-shape comparison
# ---------------------------------------------------------------------------

def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-12:
            raise ValueError("singular system")
        m[col], m[pivot] = m[pivot], m[col]
        for r in range(n):
            if r != col:
                factor = m[r][col] / m[col][col]
                for c in range(col, n + 1):
                    m[r][c] -= factor * m[col][c]
    return [m[i][n] / m[i][i] for i in range(n)]


def logistic_fit(x_rows: Sequence[Sequence[float]], y: Sequence[int], *, ridge: float = 1e-3, max_iter: int = 50) -> dict[str, Any]:
    """Ridge-stabilised IRLS; returns coefficients, log-likelihood and AIC."""
    n = len(y)
    if n == 0:
        return {"beta": [], "loglik": 0.0, "aic": float("inf"), "n": 0}
    k = len(x_rows[0])
    beta = [0.0] * k
    for _ in range(max_iter):
        xtwx = [[ridge if i == j else 0.0 for j in range(k)] for i in range(k)]
        xtwz = [0.0] * k
        for row, yi in zip(x_rows, y):
            eta = sum(b * xi for b, xi in zip(beta, row))
            eta = max(-30.0, min(30.0, eta))
            mu = 1.0 / (1.0 + math.exp(-eta))
            w = max(mu * (1 - mu), 1e-9)
            z = eta + (yi - mu) / w
            for i in range(k):
                xtwz[i] += row[i] * w * z
                for j in range(k):
                    xtwx[i][j] += row[i] * w * row[j]
        try:
            new_beta = _solve(xtwx, xtwz)
        except ValueError:
            break
        delta = max(abs(a - b) for a, b in zip(new_beta, beta))
        beta = new_beta
        if delta < 1e-8:
            break
    ll = 0.0
    for row, yi in zip(x_rows, y):
        eta = max(-30.0, min(30.0, sum(b * xi for b, xi in zip(beta, row))))
        mu = 1.0 / (1.0 + math.exp(-eta))
        mu = min(max(mu, 1e-12), 1 - 1e-12)
        ll += yi * math.log(mu) + (1 - yi) * math.log(1 - mu)
    return {"beta": beta, "loglik": ll, "aic": 2 * k - 2 * ll, "n": n, "k": k}


def scaling_shapes(x: Sequence[float], y: Sequence[int], *, aic_margin: float = 4.0) -> dict[str, Any]:
    """Fit constant, linear, quadratic, and step models of P(y=1 | x).

    `x` is standardised before fitting.  The step model searches every
    distinct x for the changepoint and is penalised for that search by one
    extra parameter.  The verdict is the simplest model within `aic_margin` of
    the best.
    """
    n = len(x)
    if n < 8 or len(set(y)) < 2:
        return {"verdict": "insufficient_data", "n": n}
    mean = sum(x) / n
    sd = math.sqrt(sum((v - mean) ** 2 for v in x) / max(1, n - 1)) or 1.0
    xs = [(v - mean) / sd for v in x]
    const = logistic_fit([[1.0] for _ in xs], y)
    linear = logistic_fit([[1.0, v] for v in xs], y)
    quad = logistic_fit([[1.0, v, v * v] for v in xs], y)
    best_step: dict[str, Any] | None = None
    for cp in sorted(set(xs))[1:]:
        fit = logistic_fit([[1.0, 1.0 if v >= cp else 0.0] for v in xs], y)
        fit["changepoint_std"] = cp
        fit["changepoint"] = cp * sd + mean
        fit["aic"] += 2.0  # the search is a parameter
        if best_step is None or fit["aic"] < best_step["aic"]:
            best_step = fit
    if best_step is None or len(set(xs)) < 2:
        return {"verdict": "insufficient_variation", "n": n, "distinct_x": len(set(xs))}
    models = {"constant": const, "linear": linear, "quadratic": quad, "step": best_step}
    ranked = sorted(models.items(), key=lambda kv: kv[1]["aic"])
    best_aic = ranked[0][1]["aic"]
    order = ["constant", "linear", "quadratic", "step"]
    verdict_model = next(m for m in order if models[m]["aic"] - best_aic <= aic_margin)
    if verdict_model == "constant":
        verdict = "flat"
    elif verdict_model == "linear":
        verdict = "linear_increasing" if linear["beta"][1] > 0 else "linear_decreasing"
    elif verdict_model == "quadratic":
        verdict = "superlinear" if quad["beta"][2] > 0 else "saturating"
    else:
        verdict = "threshold"
    return {
        "n": n,
        "x_mean": mean,
        "x_sd": sd,
        "models": {k: {kk: vv for kk, vv in v.items() if kk != "k"} for k, v in models.items()},
        "delta_aic_vs_best": {k: v["aic"] - best_aic for k, v in models.items()},
        "verdict_model": verdict_model,
        "verdict": verdict,
        "aic_margin": aic_margin,
    }


def rate_table(rows: Iterable[dict[str, Any]], key: str = "success") -> dict[str, Any]:
    vals = [r[key] for r in rows if r.get(key) is not None]
    k = sum(1 for v in vals if v)
    n = len(vals)
    lo, hi = wilson(k, n)
    return {"k": k, "n": n, "rate": (k / n) if n else None, "wilson_low": lo if n else None, "wilson_high": hi if n else None}
