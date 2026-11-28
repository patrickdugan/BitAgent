"""Themes, interconnections and research threads over an archive, stdlib only and deterministic.

- Each conversation becomes a TF-IDF vector over unigrams and bigrams. User messages count twice and
  titles three times, so themes follow what the person asked about more than the assistant's prose.
- Interconnections: cosine k-nearest neighbours, each edge carrying the terms that make it.
- Themes: spherical k-means (k-means++ seeding with a fixed seed). A conversation can also belong to a
  second theme when it scores close to it, which is how bridges between themes show up.
- Research threads: groups of conversations joined by mutual-neighbour edges, held on at least two
  different days, ordered in time: a line of inquiry picked up again.
"""

from __future__ import annotations

import heapq
import math
import random
from collections import Counter, defaultdict
from typing import Any

from .text import features

USER_WEIGHT, TITLE_WEIGHT = 2, 3
USER_CHARS, ASSISTANT_CHARS = 8000, 4000
VECTOR_TERMS = 60


def vectors(convs: list[dict[str, Any]]) -> list[dict[str, float]]:
    counts, df = [], Counter()
    for conv in convs:
        count = Counter()
        for term in features(conv["title"]):
            count[term] += TITLE_WEIGHT
        for message in conv["messages"]:
            user = message["role"] == "user"
            for term in features(message["text"][: USER_CHARS if user else ASSISTANT_CHARS]):
                count[term] += USER_WEIGHT if user else 1
        counts.append(count)
        df.update(count.keys())
    n = len(convs)
    min_df = 2 if n >= 10 else 1
    max_df = max(2, int(0.3 * n)) if n >= 20 else n
    out = []
    for count in counts:
        weights = {t: (1 + math.log(v)) * (math.log((n + 1) / (df[t] + 1)) + 1)
                   for t, v in count.items() if min_df <= df[t] <= max_df}
        top = heapq.nlargest(VECTOR_TERMS, weights.items(), key=lambda kv: (kv[1], kv[0]))
        norm = math.sqrt(sum(w * w for _, w in top)) or 1.0
        out.append({t: w / norm for t, w in top})
    return out


def dot(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(w * b.get(t, 0.0) for t, w in a.items())


def neighbours(vecs: list[dict[str, float]], k: int = 8, min_sim: float = 0.08) -> list[list[tuple[float, int]]]:
    postings: dict[str, list[tuple[int, float]]] = defaultdict(list)
    for i, vec in enumerate(vecs):
        for term, weight in vec.items():
            postings[term].append((i, weight))
    cap = max(50, int(0.08 * len(vecs)))
    out = []
    for i, vec in enumerate(vecs):
        acc: dict[int, float] = defaultdict(float)
        for term, weight in vec.items():
            posting = postings[term]
            if len(posting) > cap:
                continue
            for j, other in posting:
                if j != i:
                    acc[j] += weight * other
        out.append(heapq.nlargest(k, ((round(s, 6), j) for j, s in acc.items() if s >= min_sim)))
    return out


def shared_terms(a: dict[str, float], b: dict[str, float], n: int = 5) -> list[str]:
    return [t for _, t in heapq.nlargest(n, ((a[t] * b[t], t) for t in a.keys() & b.keys()))]


def kmeans(vecs: list[dict[str, float]], k: int, iters: int = 15, seed: int = 0
           ) -> tuple[list[int], list[dict[str, float]]]:
    live = [i for i, v in enumerate(vecs) if v]
    assign = [-1] * len(vecs)
    if not live:
        return assign, []
    k = max(1, min(k, len(live)))
    rng = random.Random(seed)
    centers = [dict(vecs[rng.choice(live)])]
    dist = [1.0 - dot(vecs[i], centers[0]) for i in live]
    while len(centers) < k:
        total = sum(d * d for d in dist)
        if total <= 1e-12:
            break
        r, acc, pick = rng.random() * total, 0.0, live[-1]
        for i, d in zip(live, dist):
            acc += d * d
            if acc >= r:
                pick = i
                break
        centers.append(dict(vecs[pick]))
        dist = [min(d, 1.0 - dot(vecs[i], centers[-1])) for i, d in zip(live, dist)]
    for _ in range(iters):
        changed = False
        for i in live:
            best = max(range(len(centers)), key=lambda c: (dot(vecs[i], centers[c]), -c))
            if assign[i] != best:
                assign[i], changed = best, True
        if not changed:
            break
        sums: list[dict[str, float]] = [defaultdict(float) for _ in centers]
        for i in live:
            for term, weight in vecs[i].items():
                sums[assign[i]][term] += weight
        for c, total_vec in enumerate(sums):
            if not total_vec:
                continue
            top = heapq.nlargest(300, total_vec.items(), key=lambda kv: (kv[1], kv[0]))
            norm = math.sqrt(sum(w * w for _, w in top)) or 1.0
            centers[c] = {t: w / norm for t, w in top}
    return assign, centers


def label(terms: list[str], n: int = 3) -> str:
    chosen: list[str] = []
    for term in terms:
        parts = term.split()
        if len(parts) > 1:
            if term in chosen or any(" " in c and set(parts) & set(c.split()) for c in chosen):
                continue
            chosen = [c for c in chosen if c not in parts] + [term]  # the bigram replaces its own words
        elif not any(term in c.split() for c in chosen):
            chosen.append(term)
        if len(chosen) >= n:
            break
    return " / ".join(chosen[:n]) or "misc"


class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def default_k(n: int) -> int:
    return max(2, min(40, round(math.sqrt(n / 2)))) if n >= 4 else 1


def analyze(convs: list[dict[str, Any]], k: int | None = None, thread_min: float = 0.18) -> dict[str, Any]:
    """Themes, edges and threads for `convs` (each with id, title, created, messages)."""
    convs = sorted(convs, key=lambda c: (c.get("created") or 0, c["id"]))
    vecs = vectors(convs)
    near = neighbours(vecs)
    assign, centers = kmeans(vecs, k or default_k(len(convs)))
    # themes
    members: dict[int, list[tuple[float, int]]] = defaultdict(list)
    for i, c in enumerate(assign):
        if c < 0:
            continue
        own = dot(vecs[i], centers[c])
        members[c].append((own, i))
        others = [(dot(vecs[i], center), j) for j, center in enumerate(centers) if j != c]
        if others:
            score, j = max(others)
            if score >= max(0.1, 0.6 * own):
                members[j].append((-score, i))  # negative score marks a secondary membership
    order = sorted((c for c in members if any(s >= 0 for s, _ in members[c])),
                   key=lambda c: (-sum(1 for s, _ in members[c] if s >= 0), c))
    theme_id = {c: f"T{n + 1:02d}" for n, c in enumerate(order)}
    themes, conv_themes = [], []
    for c in order:
        primary = [i for s, i in members[c] if s >= 0]
        user_chars = sum(len(m["text"]) for i in primary for m in convs[i]["messages"] if m["role"] == "user")
        all_chars = sum(len(m["text"]) for i in primary for m in convs[i]["messages"]) or 1
        times = [convs[i]["created"] for i in primary if convs[i].get("created")]
        terms = [t for t, _ in heapq.nlargest(12, centers[c].items(), key=lambda kv: (kv[1], kv[0]))]
        themes.append({"id": theme_id[c], "label": label(terms), "terms": terms, "size": len(primary),
                       "secondary": sum(1 for s, _ in members[c] if s < 0),
                       "first": min(times) if times else None, "last": max(times) if times else None,
                       "user_share": round(user_chars / all_chars, 3)})
        for score, i in members[c]:
            conv_themes.append({"conv_id": convs[i]["id"], "theme_id": theme_id[c], "score": round(abs(score), 4),
                                "primary": score >= 0})
    # edges
    edges, mutual = {}, set()
    near_sets = [{j for _, j in row} for row in near]
    for i, row in enumerate(near):
        for sim, j in row:
            a, b = (i, j) if i < j else (j, i)
            edges[(a, b)] = sim
            if i in near_sets[j]:
                mutual.add((a, b))
    edge_rows = [{"a": convs[a]["id"], "b": convs[b]["id"], "weight": w, "mutual": (a, b) in mutual,
                  "shared": shared_terms(vecs[a], vecs[b])} for (a, b), w in sorted(edges.items())]
    # threads
    uf = UnionFind(len(convs))
    for a, b in mutual:
        w = edges[(a, b)]
        # Two or more distinct shared words, so one generic word cannot chain two topics together.
        words = {word for term in shared_terms(vecs[a], vecs[b]) for word in term.split()}
        if w >= thread_min and len(words) >= 2 and (assign[a] == assign[b] or w >= 0.3):
            uf.union(a, b)
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(len(convs)):
        groups[uf.find(i)].append(i)
    threads = []
    for group in groups.values():
        days = {int((convs[i].get("created") or 0) // 86400) for i in group}
        if len(group) < 3 or len(days) < 2:
            continue
        term_count: Counter[str] = Counter()
        inside = set(group)
        for (a, b) in mutual:
            if a in inside and b in inside:
                term_count.update(shared_terms(vecs[a], vecs[b]))
        terms = [t for t, _ in term_count.most_common(10)]
        group.sort(key=lambda i: (convs[i].get("created") or 0, convs[i]["id"]))
        themes_in = Counter(theme_id.get(assign[i]) for i in group if assign[i] >= 0)
        threads.append({"label": label(terms), "terms": terms, "size": len(group),
                        "first": convs[group[0]].get("created"), "last": convs[group[-1]].get("created"),
                        "days": len(days), "themes": [t for t, _ in themes_in.most_common()],
                        "members": [convs[i]["id"] for i in group]})
    threads.sort(key=lambda t: (-t["size"], -(t["last"] or 0)))
    for n, thread in enumerate(threads):
        thread["id"] = f"R{n + 1:02d}"
    conv_terms = [{"conv_id": convs[i]["id"], "term": t, "weight": round(w, 5)}
                  for i, vec in enumerate(vecs)
                  for t, w in heapq.nlargest(25, vec.items(), key=lambda kv: (kv[1], kv[0]))]
    return {"themes": themes, "conv_themes": conv_themes, "edges": edge_rows, "threads": threads,
            "conv_terms": conv_terms, "k": len(centers)}
