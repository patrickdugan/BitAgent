"""The YaRN-MCP tools: what a Goose agent can ask of the archive."""

from __future__ import annotations

import json
import time
from collections import Counter
from pathlib import Path
from typing import Any

from .distill import PRESETS, DistillError, distill
from .ingest import IngestError, read_export
from .store import Store, day
from .text import clip, estimate_tokens


class ToolError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def _obj(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required or [], "additionalProperties": False}


S = {"type": "string"}
I = {"type": "integer"}
CONV = {"type": "string", "description": "Conversation id, or a unique prefix of 6+ characters (the [c:<id>] tags)."}

TOOLS: list[dict[str, Any]] = [
    {"name": "archive_status", "readOnly": True,
     "description": "What the archive holds: sources, conversation and message counts, date span, themes, threads, "
                    "packet settings (token limit, ceiling, YaRN target).",
     "inputSchema": _obj({})},
    {"name": "search", "readOnly": True,
     "description": "Full-text search over every message (all words first, then any word). Returns conversations "
                    "with the matching snippets, best first.",
     "inputSchema": _obj({"query": S, "limit": {**I, "description": "conversations to return (default 10)"},
                          "role": {"type": "string", "enum": ["user", "assistant"]},
                          "since": {**S, "description": "YYYY-MM-DD"}, "until": {**S, "description": "YYYY-MM-DD"}},
                         ["query"])},
    {"name": "list_themes", "readOnly": True,
     "description": "The archive's themes: label, top terms, size, active span, the share of the text the person "
                    "wrote (user_share; high means their own voice, not assistant prose), example conversations.",
     "inputSchema": _obj({"limit": {**I, "description": "default 40"},
                          "sort": {"type": "string", "enum": ["size", "recent", "personal"]}})},
    {"name": "theme_card", "readOnly": True,
     "description": "One theme in depth: member conversations, related themes (by cross-theme links and shared "
                    "members), research threads inside it, and activity by month.",
     "inputSchema": _obj({"theme": {**S, "description": "theme id, e.g. T03"},
                          "members": {**I, "description": "members to list (default 15)"}}, ["theme"])},
    {"name": "research_threads", "readOnly": True,
     "description": "Research threads: lines of inquiry picked up again on different days, in time order. Filter "
                    "by theme or by a query that a member conversation must match.",
     "inputSchema": _obj({"theme": S, "query": S, "limit": {**I, "description": "default 20"},
                          "members": {**I, "description": "members to list per thread (default 8)"}})},
    {"name": "connections", "readOnly": True,
     "description": "Interconnections. With conversation: its nearest conversations and the terms that link them. "
                    "With term: the conversations and themes it runs through and the terms it co-occurs with. With "
                    "theme and other_theme: the conversations that bridge the two.",
     "inputSchema": _obj({"conversation": CONV, "term": S, "theme": S, "other_theme": S,
                          "limit": {**I, "description": "default 10"}})},
    {"name": "timeline", "readOnly": True,
     "description": "Activity by month for a term (messages mentioning it), a theme (its conversations), or the "
                    "whole archive.",
     "inputSchema": _obj({"term": S, "theme": S})},
    {"name": "get_conversation", "readOnly": True,
     "description": "Read one conversation, clipped to max_tokens (default 2000). Long messages keep their head and "
                    "tail with the cut marked.",
     "inputSchema": _obj({"conversation": CONV, "max_tokens": I, "from_message": I,
                          "role": {"type": "string", "enum": ["user", "assistant"]}}, ["conversation"])},
    {"name": "distill_yarn", "readOnly": False,
     "description": "Write a long-context packet (Markdown, cited [c:<id>]) for a query, theme, research thread, "
                    "chosen conversations, or the whole archive, at most token_limit tokens. The limit is clamped "
                    "by the server ceiling and by what YaRN reaches for the target model (native_ctx x "
                    "max_yarn_factor - reserve_tokens). Returns the packet path, its token count and the YaRN "
                    "plan: whether it fits natively, else the factor and llama.cpp / rope_scaling / vLLM settings.",
     "inputSchema": _obj({
         "query": S, "theme": S, "thread": S,
         "conversations": {"type": "array", "items": CONV},
         "token_limit": {**I, "description": "packet size in tokens (the token lip)"},
         "model": {"type": "string", "enum": sorted(PRESETS), "description": "preset native_ctx and max factor"},
         "native_ctx": {**I, "description": "the target model's trained context (original_max_position_embeddings)"},
         "max_yarn_factor": {"type": "number"},
         "reserve_tokens": {**I, "description": "room left for the question and the answer"},
         "include_assistant": {"type": "boolean", "description": "default true; false keeps only the person's words"},
         "label": S})},
    {"name": "ingest_export", "readOnly": False,
     "description": "Index a chat export (ChatGPT or Claude data export zip/dir/json, JSONL, or a folder of notes), "
                    "then recompute themes, links and threads. Newer copies of a conversation replace older ones.",
     "inputSchema": _obj({"path": S, "include_reasoning": {"type": "boolean"},
                          "include_do_not_remember": {"type": "boolean"}}, ["path"])},
]


def _ts(text: str | None, end: bool = False) -> float | None:
    if not text:
        return None
    try:
        return time.mktime(time.strptime(text[:10], "%Y-%m-%d")) + (86400 if end else 0)
    except ValueError as exc:
        raise ToolError("bad_date", f"{text}: use YYYY-MM-DD") from exc


class Service:
    def __init__(self, home: Path, *, read_only: bool = False, allow_ingest: bool = False,
                 token_limit: int = 32000, max_packet_tokens: int = 131072, native_ctx: int = 32768,
                 max_yarn_factor: float = 4.0, reserve_tokens: int = 4096, tokenize_url: str | None = None,
                 redact: bool = True):
        self.store = Store(home)
        self.read_only = read_only
        self.allow_ingest = allow_ingest and not read_only
        self.settings = {"token_limit": token_limit, "max_packet_tokens": max_packet_tokens,
                         "native_ctx": native_ctx, "max_yarn_factor": max_yarn_factor,
                         "reserve_tokens": reserve_tokens, "tokenize_url": tokenize_url, "redact": redact}

    def close(self) -> None:
        self.store.close()

    def tools(self) -> list[dict[str, Any]]:
        out = []
        for tool in TOOLS:
            if tool["name"] == "ingest_export" and not self.allow_ingest:
                continue
            if not tool["readOnly"] and self.read_only:
                continue
            out.append({"name": tool["name"], "description": tool["description"], "inputSchema": tool["inputSchema"],
                        "annotations": {"readOnlyHint": tool["readOnly"]}})
        return out

    def call(self, name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
        listed = {t["name"]: t for t in self.tools()}
        if name not in listed:
            raise ToolError("unknown_tool", f"{name} is not offered in this session")
        args = dict(arguments or {})
        schema = listed[name]["inputSchema"]
        unknown = sorted(set(args) - set(schema["properties"]))
        if unknown:
            raise ToolError("unknown_param", f"{name} takes {sorted(schema['properties'])}; got {unknown}")
        missing = [p for p in schema["required"] if args.get(p) in (None, "")]
        if missing:
            raise ToolError("missing_param", f"{name} needs parameter '{missing[0]}'")
        try:
            return getattr(self, f"t_{name}")(**args)
        except (DistillError, IngestError) as exc:
            raise ToolError(exc.code, exc.detail) from exc

    # ---- helpers ----

    def _conv(self, ref: str):
        row = self.store.resolve(ref.removeprefix("c:").strip("[]"))
        if row is None:
            raise ToolError("unknown_conversation", f"{ref}: no conversation with that id or unique prefix")
        return row

    def _brief(self, conv_id: str) -> dict[str, Any]:
        row = self.store.conversation(conv_id)
        themes = self.store.themes_of(conv_id)
        return {"id": conv_id, "cite": self.store.cite(conv_id),"title": row["title"], "date": day(row["created"]),
                "messages": row["n_messages"], "theme": themes[0]["theme"] if themes else None}

    def _theme(self, theme: str):
        row = self.store.db.execute("select * from themes where id = ?", (theme,)).fetchone()
        if row is None:
            raise ToolError("unknown_theme", f"{theme}: see list_themes")
        return row

    # ---- tools ----

    def t_archive_status(self) -> dict[str, Any]:
        db = self.store.db
        counts = db.execute("select count(*) n, min(created) first, max(created) last, sum(tokens) tokens, "
                            "sum(user_chars) uc, sum(assistant_chars) ac from conversations").fetchone()
        sources = [{"path": Path(r["path"]).name, "ingested": day(r["ingested"]),
                    **{k: v for k, v in json.loads(r["stats"]).items() if k in ("kept", "warnings", "sources")}}
                   for r in db.execute("select * from sources order by id")]
        by_source = dict(db.execute("select source, count(*) from conversations group by source").fetchall())
        return {
            "home": str(self.store.home), "conversations": counts["n"], "by_source": by_source,
            "messages": db.execute("select count(*) from messages").fetchone()[0],
            "tokens_estimate": counts["tokens"] or 0, "first": day(counts["first"]), "last": day(counts["last"]),
            "user_share": round((counts["uc"] or 0) / ((counts["uc"] or 0) + (counts["ac"] or 0) or 1), 3),
            "themes": db.execute("select count(*) from themes").fetchone()[0],
            "threads": db.execute("select count(*) from threads").fetchone()[0],
            "analyzed": self.store.meta("analyzed"), "sources": sources,
            "packets": {k: v for k, v in self.settings.items() if k != "tokenize_url"}
                       | {"exact_token_counts": bool(self.settings["tokenize_url"])},
            "read_only": self.read_only, "ingest_allowed": self.allow_ingest,
        }

    def t_search(self, query: str, limit: int = 10, role: str | None = None, since: str | None = None,
                 until: str | None = None) -> dict[str, Any]:
        lo, hi = _ts(since), _ts(until, end=True)
        grouped: dict[str, list[Any]] = {}
        for row in self.store.search_rows(query, limit=400, role=role):
            if (lo and (row["created"] or 0) < lo) or (hi and (row["created"] or 0) > hi):
                continue
            grouped.setdefault(row["conv_id"], []).append(row)
        ranked = sorted(grouped.items(), key=lambda kv: sum(sorted((r["rank"] for r in kv[1]))[:5]))
        results = []
        for conv_id, rows in ranked[: max(1, min(limit, 50))]:
            item = self._brief(conv_id)
            item["hits"] = len(rows)
            item["snippets"] = [{"message": r["idx"], "role": r["role"], "text": r["snippet"]} for r in rows[:3]]
            results.append(item)
        return {"query": query, "conversations": len(grouped), "results": results}

    def t_list_themes(self, limit: int = 40, sort: str = "size") -> dict[str, Any]:
        order = {"size": "size desc", "recent": "last desc", "personal": "user_share desc"}.get(sort, "size desc")
        out = []
        for row in self.store.db.execute(f"select * from themes order by {order} limit ?", (limit,)):
            examples = [r["conv_id"] for r in self.store.db.execute(
                "select conv_id from conv_themes where theme_id = ? and is_primary = 1 order by score desc limit 3",
                (row["id"],))]
            out.append({"theme": row["id"], "label": row["label"], "terms": json.loads(row["terms"])[:8],
                        "size": row["size"], "also_in": row["secondary"], "first": day(row["first"]),
                        "last": day(row["last"]), "user_share": row["user_share"],
                        "examples": [self._brief(c)["title"] for c in examples]})
        return {"themes": out, "total": self.store.db.execute("select count(*) from themes").fetchone()[0]}

    def t_theme_card(self, theme: str, members: int = 15) -> dict[str, Any]:
        row = self._theme(theme)
        db = self.store.db
        rows = db.execute("select conv_id, score, is_primary from conv_themes where theme_id = ? "
                          "order by is_primary desc, score desc", (theme,)).fetchall()
        inside = {r["conv_id"] for r in rows if r["is_primary"]}
        related: Counter[str] = Counter()
        for r in rows:
            for other in self.store.themes_of(r["conv_id"]):
                if other["theme"] != theme:
                    related[other["theme"]] += 2
        for edge in db.execute("select a, b from edges"):
            if (edge["a"] in inside) != (edge["b"] in inside):
                other = edge["b"] if edge["a"] in inside else edge["a"]
                for t in self.store.themes_of(other)[:1]:
                    if t["theme"] != theme:
                        related[t["theme"]] += 1
        labels = dict(db.execute("select id, label from themes").fetchall())
        threads = [{"thread": t["id"], "label": t["label"], "size": t["size"], "first": day(t["first"]),
                    "last": day(t["last"])}
                   for t in db.execute("select * from threads") if theme in json.loads(t["themes"])[:1]]
        months: Counter[str] = Counter()
        for r in rows:
            if r["is_primary"]:
                created = self.store.conversation(r["conv_id"])["created"]
                months[(day(created) or "undated")[:7]] += 1
        return {"theme": theme, "label": row["label"], "terms": json.loads(row["terms"]), "size": row["size"],
                "user_share": row["user_share"], "first": day(row["first"]), "last": day(row["last"]),
                "members": [self._brief(r["conv_id"]) | {"score": r["score"], "primary": bool(r["is_primary"])}
                            for r in rows[:members]],
                "related_themes": [{"theme": t, "label": labels.get(t), "links": n} for t, n in related.most_common(6)],
                "threads": threads, "by_month": dict(sorted(months.items()))}

    def t_research_threads(self, theme: str | None = None, query: str | None = None, limit: int = 20,
                           members: int = 8) -> dict[str, Any]:
        match = {c for _, c in self.store.rank_conversations(query, limit=500)} if query else None
        out = []
        for t in self.store.db.execute("select * from threads order by size desc, last desc"):
            ids = json.loads(t["members"])
            if theme and theme not in json.loads(t["themes"]):
                continue
            if match is not None and not match & set(ids):
                continue
            out.append({"thread": t["id"], "label": t["label"], "terms": json.loads(t["terms"])[:8],
                        "size": t["size"], "days": t["days"], "first": day(t["first"]), "last": day(t["last"]),
                        "themes": json.loads(t["themes"]),
                        "members": [self._brief(c) for c in ids[:members]],
                        "more": max(0, len(ids) - members)})
            if len(out) >= limit:
                break
        return {"threads": out, "total": self.store.db.execute("select count(*) from threads").fetchone()[0]}

    def t_connections(self, conversation: str | None = None, term: str | None = None, theme: str | None = None,
                      other_theme: str | None = None, limit: int = 10) -> dict[str, Any]:
        db = self.store.db
        if conversation:
            conv = self._conv(conversation)
            rows = db.execute("select * from edges where a = ? or b = ? order by weight desc limit ?",
                              (conv["id"], conv["id"], limit)).fetchall()
            return {"conversation": self._brief(conv["id"]), "terms": self.store.top_terms(conv["id"]),
                    "themes": self.store.themes_of(conv["id"]),
                    "linked": [self._brief(r["b"] if r["a"] == conv["id"] else r["a"])
                               | {"weight": r["weight"], "mutual": bool(r["mutual"]), "via": json.loads(r["shared"])}
                               for r in rows]}
        if term:
            key = term.lower().strip()
            rows = db.execute("select conv_id, weight from conv_terms where term = ? order by weight desc",
                              (key,)).fetchall()
            co: Counter[str] = Counter()
            themes: Counter[str] = Counter()
            for r in rows:
                co.update(t for t in self.store.top_terms(r["conv_id"], 12) if t != key and key not in t.split())
                for t in self.store.themes_of(r["conv_id"])[:1]:
                    themes[f"{t['theme']} {t['label']}"] += 1
            mentions = db.execute("select count(*) from messages_fts where messages_fts match ?",
                                  (f'"{key}"',)).fetchone()[0] if key.replace(" ", "").isalnum() else None
            return {"term": key, "conversations_where_central": len(rows), "messages_mentioning": mentions,
                    "themes": [{"theme": t, "conversations": n} for t, n in themes.most_common(8)],
                    "co_terms": [t for t, _ in co.most_common(15)],
                    "conversations": [self._brief(r["conv_id"]) | {"weight": r["weight"]} for r in rows[:limit]]}
        if theme and other_theme:
            self._theme(theme), self._theme(other_theme)
            ids_a = {r[0] for r in db.execute("select conv_id from conv_themes where theme_id = ?", (theme,))}
            ids_b = {r[0] for r in db.execute("select conv_id from conv_themes where theme_id = ?", (other_theme,))}
            both = sorted(ids_a & ids_b)
            edges = [r for r in db.execute("select * from edges order by weight desc")
                     if (r["a"] in ids_a and r["b"] in ids_b) or (r["a"] in ids_b and r["b"] in ids_a)]
            return {"theme": theme, "other_theme": other_theme,
                    "in_both": [self._brief(c) for c in both[:limit]],
                    "links": [{"a": self._brief(r["a"]), "b": self._brief(r["b"]), "weight": r["weight"],
                               "via": json.loads(r["shared"])} for r in edges[:limit]],
                    "total_links": len(edges)}
        raise ToolError("missing_param", "connections needs 'conversation', 'term', or 'theme' with 'other_theme'")

    def t_timeline(self, term: str | None = None, theme: str | None = None) -> dict[str, Any]:
        months: Counter[str] = Counter()
        db = self.store.db
        if term:
            rows = self.store.search_rows(term, limit=100000)
            for r in rows:
                months[(day(r["created"]) or "undated")[:7]] += 1
            scope = {"term": term, "messages": len(rows)}
        elif theme:
            self._theme(theme)
            for r in db.execute("select c.created from conv_themes ct join conversations c on c.id = ct.conv_id "
                                "where ct.theme_id = ? and ct.is_primary = 1", (theme,)):
                months[(day(r[0]) or "undated")[:7]] += 1
            scope = {"theme": theme}
        else:
            for r in db.execute("select created from conversations"):
                months[(day(r[0]) or "undated")[:7]] += 1
            scope = {"archive": True}
        return scope | {"by_month": dict(sorted(months.items()))}

    def t_get_conversation(self, conversation: str, max_tokens: int = 2000, from_message: int = 0,
                           role: str | None = None) -> dict[str, Any]:
        conv = self._conv(conversation)
        budget = max(200, min(max_tokens, 32000))
        out, used, last = [], 0, from_message - 1
        messages = [m for m in self.store.messages(conv["id"]) if m["idx"] >= from_message
                    and (role is None or m["role"] == role)]
        for m in messages:
            if budget - used < 40:
                break
            text = clip(m["text"], min(budget - used, max(300, budget // 3)))
            used += estimate_tokens(text) + 4
            out.append({"message": m["idx"], "role": m["role"], "text": text})
            last = m["idx"]
        remaining = sum(1 for m in messages if m["idx"] > last)
        return self._brief(conv["id"]) | {"themes": self.store.themes_of(conv["id"]), "messages_shown": out,
                                          "tokens": used, "next_message": last + 1 if remaining else None}

    def t_distill_yarn(self, query: str | None = None, theme: str | None = None, thread: str | None = None,
                       conversations: list[str] | None = None, token_limit: int | None = None,
                       model: str | None = None, native_ctx: int | None = None,
                       max_yarn_factor: float | None = None, reserve_tokens: int | None = None,
                       include_assistant: bool = True, label: str | None = None) -> dict[str, Any]:
        s = self.settings
        preset = PRESETS.get(model or "", {})
        manifest = distill(
            self.store, query=query, theme=theme, thread=thread, conversation_ids=conversations,
            token_limit=int(token_limit or s["token_limit"]), max_packet_tokens=int(s["max_packet_tokens"]),
            native_ctx=int(native_ctx or preset.get("native_ctx") or s["native_ctx"]),
            max_yarn_factor=float(max_yarn_factor or preset.get("max_yarn_factor") or s["max_yarn_factor"]),
            reserve_tokens=int(reserve_tokens if reserve_tokens is not None else s["reserve_tokens"]),
            tokenize_url=s["tokenize_url"], redact_secrets=bool(s["redact"]), include_assistant=include_assistant,
            label=label)
        manifest["included"] = [self._brief(c)["cite"] for c in manifest["included"]]
        return manifest

    def t_ingest_export(self, path: str, include_reasoning: bool = False,
                        include_do_not_remember: bool = False) -> dict[str, Any]:
        started = time.time()
        convs, stats = read_export(path, reasoning=include_reasoning, include_do_not_remember=include_do_not_remember)
        added = self.store.add(convs, str(Path(path).expanduser().resolve()), stats)
        analysis = self.store.reanalyze()
        return {"ingest": {k: v for k, v in stats.items() if k != "files"} | {"files": len(stats["files"])},
                "store": added, "analysis": analysis, "seconds": round(time.time() - started, 1)}
