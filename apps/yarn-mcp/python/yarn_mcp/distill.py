"""Distill a long-context packet from the archive, sized for a YaRN-extended model.

A packet is one Markdown file: a map of the themes and threads it covers, then excerpts of the most
relevant conversations, each cited as [c:<id>]. Its size is the token limit the caller sets (the
"token lip"), clamped by the server ceiling and by what YaRN can reach for the target model:
`native_ctx * max_yarn_factor - reserve_tokens`. The manifest next to it says whether the packet fits
the native window and, when it does not, the YaRN factor and the serving flags that fit it
(llama.cpp, Hugging Face `rope_scaling`, vLLM).
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
import urllib.request
from pathlib import Path
from typing import Any

from .store import Store, day
from .text import clip, estimate_tokens, redact

# Native window and the largest YaRN factor the model card documents.
PRESETS = {
    "qwen3": {"native_ctx": 32768, "max_yarn_factor": 4.0},
    "qwen2.5": {"native_ctx": 32768, "max_yarn_factor": 4.0},
}
LOOPBACK = ("http://127.0.0.1:", "http://localhost:", "http://[::1]:")
MIN_SECTION = 250


class DistillError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def yarn_plan(packet_tokens: int, reserve: int, native_ctx: int, max_factor: float) -> dict[str, Any]:
    need = packet_tokens + reserve
    plan: dict[str, Any] = {"packet_tokens": packet_tokens, "reserve_tokens": reserve, "needed_context": need,
                            "original_max_position_embeddings": native_ctx, "max_yarn_factor": max_factor}
    if need <= native_ctx:
        plan.update(needed=False, factor=1.0, context=native_ctx, fits=True,
                    note="Fits the native window; serve without rope scaling.")
        return plan
    factor = float(math.ceil(need / native_ctx))
    if factor > max_factor:
        plan.update(needed=True, factor=factor, fits=False, context=need,
                    note=f"Needs factor {factor:g}, above the max {max_factor:g}: context does not permit.")
        return plan
    context = int(native_ctx * factor)
    plan.update(
        needed=True, factor=factor, context=context, fits=True,
        llama_cpp=["--rope-scaling", "yarn", "--rope-scale", f"{factor:g}", "--yarn-orig-ctx", str(native_ctx),
                   "-c", str(context)],
        hf_rope_scaling={"rope_type": "yarn", "factor": factor, "original_max_position_embeddings": native_ctx},
        vllm=["--rope-scaling", json.dumps({"rope_type": "yarn", "factor": factor,
                                            "original_max_position_embeddings": native_ctx}),
              "--max-model-len", str(context)],
        note="Static YaRN scales every request on that server, which can cost some quality on short prompts; "
             "serve the packet from its own instance.")
    return plan


def count_tokens(text: str, tokenize_url: str | None) -> tuple[int, str]:
    if not tokenize_url:
        return estimate_tokens(text), "estimate"
    if not tokenize_url.startswith(LOOPBACK):
        raise DistillError("tokenize_url_not_loopback", "token counting talks to a local server only")
    body = json.dumps({"content": text}).encode()
    request = urllib.request.Request(tokenize_url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            tokens = json.loads(response.read())["tokens"]
    except (OSError, ValueError, KeyError) as exc:
        raise DistillError("tokenize_failed", f"{tokenize_url}: {exc}") from exc
    return len(tokens), "tokenize"


def _focus(text: str) -> list[str]:
    return sorted({t.lower() for t in re.findall(r"\w+", text) if len(t) > 2})


def _render(store: Store, conv_id: str, cap: int, focus: list[str], include_assistant: bool) -> tuple[str, int]:
    conv = store.conversation(conv_id)
    themes = store.themes_of(conv_id)
    theme = f", theme {themes[0]['theme']} {themes[0]['label']}" if themes else ""
    header = f"### [{store.cite(conv_id)}] {conv['title']} ({day(conv['created']) or 'undated'}{theme})\n"
    messages = [m for m in store.messages(conv_id) if include_assistant or m["role"] == "user"]
    budget = cap - estimate_tokens(header)
    if budget < 60 or not messages:
        return header, estimate_tokens(header)

    def score(m: Any) -> float:
        low = m["text"].lower()
        hits = sum(min(low.count(t), 5) for t in focus)
        return hits * (1.5 if m["role"] == "user" else 1.0) + (3.0 if m["idx"] == 0 else 0.0) + (
            0.5 if m["role"] == "user" else 0.0)

    per_message = max(120, cap // 3)
    picked: dict[int, str] = {}
    for m in sorted(messages, key=lambda m: (-score(m), m["idx"])):
        if budget < 60:
            break
        body = clip(m["text"], min(per_message, budget - 10))
        cost = estimate_tokens(body) + 6
        if cost > budget:
            continue
        picked[m["idx"]] = f"**{m['role']}:** {body}"
        budget -= cost
    lines, last = [header], -1
    for idx in sorted(picked):
        if idx > last + 1:
            lines.append(f"[... {idx - last - 1} messages omitted ...]")
        lines.append(picked[idx])
        last = idx
    if last < messages[-1]["idx"]:
        lines.append(f"[... {sum(1 for m in messages if m['idx'] > last)} later messages omitted ...]")
    text = "\n\n".join(lines) + "\n"
    return text, estimate_tokens(text)


def _candidates(store: Store, query: str | None, theme: str | None, thread: str | None,
                conversation_ids: list[str] | None) -> tuple[list[tuple[float, str]], list[str], str, bool]:
    """(score, conv id) in packet order, focus terms, scope text, chronological."""
    db = store.db
    focus = _focus(query or "")
    if conversation_ids:
        rows = [store.resolve(c) for c in conversation_ids]
        missing = [c for c, r in zip(conversation_ids, rows) if r is None]
        if missing:
            raise DistillError("unknown_conversation", ", ".join(missing))
        return [(1.0, r["id"]) for r in rows], focus, f"{len(rows)} chosen conversations", False
    if thread:
        row = db.execute("select * from threads where id = ?", (thread,)).fetchone()
        if row is None:
            raise DistillError("unknown_thread", thread)
        focus += json.loads(row["terms"])
        return ([(1.0, c) for c in json.loads(row["members"])], focus,
                f"research thread {thread} ({row['label']})", True)
    if theme:
        row = db.execute("select * from themes where id = ?", (theme,)).fetchone()
        if row is None:
            raise DistillError("unknown_theme", theme)
        focus += json.loads(row["terms"])[:8]
        members = [(r["score"] + (1.0 if r["is_primary"] else 0.0), r["conv_id"]) for r in db.execute(
            "select conv_id, score, is_primary from conv_themes where theme_id = ?", (theme,))]
        if query:
            ranked = dict((c, s) for s, c in store.rank_conversations(query, limit=500))
            members = [(s + ranked.get(c, 0.0), c) for s, c in members]
        scope = f"theme {theme} ({row['label']})" + (f", query '{query}'" if query else "")
        return sorted(members, reverse=True), focus, scope, False
    if query:
        ranked = store.rank_conversations(query, limit=200)
        if not ranked:
            raise DistillError("no_matches", f"nothing in the archive matches '{query}'")
        return ranked, focus, f"query '{query}'", False
    # The whole archive: round-robin over themes, best members first.
    per_theme = []
    for row in db.execute("select id, terms from themes order by size desc"):
        focus += json.loads(row["terms"])[:2]
        per_theme.append([r["conv_id"] for r in db.execute(
            "select conv_id from conv_themes where theme_id = ? and is_primary = 1 order by score desc", (row["id"],))])
    order, seen, rank = [], set(), 0
    while any(rank < len(m) for m in per_theme):
        for members in per_theme:
            if rank < len(members) and members[rank] not in seen:
                seen.add(members[rank])
                order.append((1.0 / (rank + 1), members[rank]))
        rank += 1
    if not order:
        raise DistillError("not_analyzed", "the archive has no themes yet; ingest an export first")
    return order, focus, "whole archive (themes round-robin)", False


def _map(store: Store, conv_ids: list[str]) -> str:
    if not conv_ids:
        return ""
    marks = ",".join("?" * len(conv_ids))
    themes = store.db.execute(
        f"select t.id, t.label, count(*) n, t.size from conv_themes ct join themes t on t.id = ct.theme_id "
        f"where ct.conv_id in ({marks}) and ct.is_primary = 1 group by t.id order by n desc limit 12",
        conv_ids).fetchall()
    lines = ["## Map", "", "Themes in this packet (conversations here / in the archive):"]
    lines += [f"- {t['id']} {t['label']}: {t['n']}/{t['size']}" for t in themes]
    inside = set(conv_ids)
    threads = [t for t in store.db.execute("select id, label, members, first, last from threads")
               if inside & set(json.loads(t["members"]))]
    if threads:
        lines += ["", "Research threads touched:"]
        lines += [f"- {t['id']} {t['label']} ({day(t['first'])} to {day(t['last'])}, "
                  f"{len(inside & set(json.loads(t['members'])))} of {len(json.loads(t['members']))} here)"
                  for t in threads[:10]]
    return "\n".join(lines) + "\n"


def distill(store: Store, *, query: str | None = None, theme: str | None = None, thread: str | None = None,
            conversation_ids: list[str] | None = None, token_limit: int, max_packet_tokens: int,
            native_ctx: int, max_yarn_factor: float, reserve_tokens: int, tokenize_url: str | None = None,
            redact_secrets: bool = True, include_assistant: bool = True, label: str | None = None,
            ) -> dict[str, Any]:
    if token_limit < 1000:
        raise DistillError("token_limit_too_small", "token_limit must be at least 1000")
    reach = int(native_ctx * max_yarn_factor) - reserve_tokens
    limit = min(token_limit, max_packet_tokens, reach)
    clamp_reason = None
    if token_limit > limit:
        clamp_reason = ("context does not permit: native_ctx x max_yarn_factor - reserve_tokens = "
                        f"{reach}" if limit == reach else f"server ceiling --max-packet-tokens {max_packet_tokens}")
    candidates, focus, scope, chronological = _candidates(store, query, theme, thread, conversation_ids)
    focus = sorted(set(focus))
    title = f"# YaRN packet: {label or scope}\n\n"
    intro = (f"Distilled from a personal chat archive on {time.strftime('%Y-%m-%d')}. Scope: {scope}. Each section is "
             "an excerpt of one conversation, cited as [c:<id>]; omitted messages are marked. Quote and cite the "
             "excerpts; do not infer what an omitted message said.\n\n")
    weights = [max(s, 1e-6) for s, _ in candidates]
    # Share the budget among about one conversation per 1000 tokens (at least 40): bigger packets go wider.
    total_weight = sum(weights[: max(40, limit // 1000)]) or 1.0

    def build(scale: float) -> tuple[list[tuple[str, str, int]], int]:
        sections, used = [], estimate_tokens(title + intro) + 400  # room for the map
        for (score, conv_id), weight in zip(candidates, weights):
            if limit - used < MIN_SECTION:
                break
            cap = int(min(0.25 * limit, max(MIN_SECTION * 2, limit * weight / total_weight)) * scale)
            cap = min(cap, limit - used)
            text, tokens = _render(store, conv_id, cap, focus, include_assistant)
            if used + tokens > limit:
                continue
            sections.append((conv_id, text, tokens))
            used += tokens
        return sections, used

    sections, used = build(1.0)
    for scale in (2.0, 4.0, 8.0):
        if len(sections) < len(candidates) or used > 0.85 * limit:
            break
        bigger, bigger_used = build(scale)
        if bigger_used <= limit and bigger_used > used:
            sections, used = bigger, bigger_used
    if chronological:
        when = {c: (store.conversation(c)["created"] or 0) for c, _, _ in sections}
        sections.sort(key=lambda s: when[s[0]])
    redactions = 0

    def assemble(parts: list[tuple[str, str, int]]) -> str:
        nonlocal redactions
        body = title + intro + _map(store, [c for c, _, _ in parts]) + "\n## Conversations\n\n" + "\n".join(
            text for _, text, _ in parts)
        if redact_secrets:
            body, redactions = redact(body)
        return body

    packet = assemble(sections)
    tokens, counter = count_tokens(packet, tokenize_url)
    while tokens > limit and sections:
        sections = sections[:-1]
        packet = assemble(sections)
        tokens, counter = count_tokens(packet, tokenize_url)
    plan = yarn_plan(tokens, reserve_tokens, native_ctx, max_yarn_factor)
    digest = hashlib.sha256(packet.encode()).hexdigest()
    packet_id = f"p{time.strftime('%Y%m%d-%H%M%S')}-{digest[:8]}"
    out = store.home / "packets"
    out.mkdir(exist_ok=True)
    path = out / f"{packet_id}.md"
    path.write_text(packet, encoding="utf-8")
    manifest = {
        "packet_id": packet_id, "packet_path": str(path), "sha256": digest, "scope": scope,
        "requested_token_limit": token_limit, "token_limit": limit, "clamped": clamp_reason is not None,
        "clamp_reason": clamp_reason, "packet_tokens": tokens, "token_counter": counter,
        "conversations_included": len(sections), "conversations_considered": len(candidates),
        "included": [c for c, _, _ in sections], "focus_terms": focus[:30], "redactions": redactions,
        "redacted": redact_secrets, "yarn": plan,
    }
    (out / f"{packet_id}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
