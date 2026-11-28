"""The archive: one SQLite file (FTS5 over messages) plus the analysis tables."""

from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from .analyze import analyze
from .text import estimate_tokens

SCHEMA = """
create table if not exists meta(key text primary key, value text);
create table if not exists sources(id integer primary key, path text, ingested real, stats text);
create table if not exists conversations(
  id text primary key, source text, source_id int, title text, created real, updated real, model text,
  flags text, n_messages int, user_chars int, assistant_chars int, tokens int);
create table if not exists messages(
  id integer primary key, conv_id text, idx int, role text, created real, text text, tokens int);
create index if not exists messages_conv on messages(conv_id, idx);
create virtual table if not exists messages_fts using fts5(
  text, content='messages', content_rowid='id', tokenize='porter unicode61');
create table if not exists conv_terms(conv_id text, term text, weight real, primary key(conv_id, term));
create index if not exists conv_terms_term on conv_terms(term);
create table if not exists themes(id text primary key, label text, terms text, size int, secondary int,
  first real, last real, user_share real);
create table if not exists conv_themes(conv_id text, theme_id text, score real, is_primary int);
create index if not exists conv_themes_conv on conv_themes(conv_id);
create index if not exists conv_themes_theme on conv_themes(theme_id);
create table if not exists edges(a text, b text, weight real, mutual int, shared text, primary key(a, b));
create index if not exists edges_b on edges(b);
create table if not exists threads(id text primary key, label text, terms text, size int, first real, last real,
  days int, themes text, members text);
"""

TERM = re.compile(r"\w+", re.UNICODE)


def day(ts: float | None) -> str | None:
    return time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else None


def fts_query(text: str, any_term: bool = False) -> str:
    terms = [t for t in TERM.findall(text) if len(t) > 1]
    return (" OR " if any_term else " ").join(f'"{t}"' for t in terms)


class Store:
    def __init__(self, home: Path):
        home.mkdir(parents=True, exist_ok=True)
        self.home = home
        self.path = home / "yarn.sqlite"
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    # ---- writing ----

    def add(self, convs: list[dict[str, Any]], source_path: str, stats: dict[str, Any]) -> dict[str, Any]:
        """Insert or replace conversations (a newer export supersedes the same ids)."""
        db = self.db
        with db:
            source_id = db.execute("insert into sources(path, ingested, stats) values (?, ?, ?)",
                                   (source_path, time.time(), json.dumps(stats))).lastrowid
            replaced = 0
            for conv in convs:
                old = db.execute("select id, text from messages where conv_id = ?", (conv["id"],)).fetchall()
                if old:
                    replaced += 1
                    db.executemany("insert into messages_fts(messages_fts, rowid, text) values ('delete', ?, ?)",
                                   [(r["id"], r["text"]) for r in old])
                    db.execute("delete from messages where conv_id = ?", (conv["id"],))
                tokens = user_chars = assistant_chars = 0
                for idx, message in enumerate(conv["messages"]):
                    n = estimate_tokens(message["text"])
                    tokens += n
                    if message["role"] == "user":
                        user_chars += len(message["text"])
                    else:
                        assistant_chars += len(message["text"])
                    rowid = db.execute(
                        "insert into messages(conv_id, idx, role, created, text, tokens) values (?, ?, ?, ?, ?, ?)",
                        (conv["id"], idx, message["role"], message.get("created"), message["text"], n)).lastrowid
                    db.execute("insert into messages_fts(rowid, text) values (?, ?)", (rowid, message["text"]))
                db.execute(
                    "insert or replace into conversations values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (conv["id"], conv["source"], source_id, conv["title"], conv.get("created"), conv.get("updated"),
                     conv.get("model"), json.dumps(conv.get("flags") or []), len(conv["messages"]), user_chars,
                     assistant_chars, tokens))
        return {"source_id": source_id, "added": len(convs) - replaced, "replaced": replaced}

    def conversations_for_analysis(self) -> list[dict[str, Any]]:
        convs: dict[str, dict[str, Any]] = {}
        for row in self.db.execute("select id, title, created from conversations"):
            convs[row["id"]] = {"id": row["id"], "title": row["title"], "created": row["created"], "messages": []}
        for row in self.db.execute("select conv_id, role, text from messages order by conv_id, idx"):
            if row["conv_id"] in convs:
                convs[row["conv_id"]]["messages"].append({"role": row["role"], "text": row["text"]})
        return list(convs.values())

    def reanalyze(self, k: int | None = None) -> dict[str, Any]:
        started = time.time()
        result = analyze(self.conversations_for_analysis(), k=k)
        self._cite_len = None
        db = self.db
        with db:
            for table in ("themes", "conv_themes", "edges", "threads", "conv_terms"):
                db.execute(f"delete from {table}")
            db.executemany("insert into themes values (?, ?, ?, ?, ?, ?, ?, ?)",
                           [(t["id"], t["label"], json.dumps(t["terms"]), t["size"], t["secondary"], t["first"],
                             t["last"], t["user_share"]) for t in result["themes"]])
            db.executemany("insert into conv_themes values (?, ?, ?, ?)",
                           [(r["conv_id"], r["theme_id"], r["score"], int(r["primary"])) for r in result["conv_themes"]])
            db.executemany("insert into edges values (?, ?, ?, ?, ?)",
                           [(e["a"], e["b"], e["weight"], int(e["mutual"]), json.dumps(e["shared"]))
                            for e in result["edges"]])
            db.executemany("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           [(t["id"], t["label"], json.dumps(t["terms"]), t["size"], t["first"], t["last"], t["days"],
                             json.dumps(t["themes"]), json.dumps(t["members"])) for t in result["threads"]])
            db.executemany("insert into conv_terms values (?, ?, ?)",
                           [(r["conv_id"], r["term"], r["weight"]) for r in result["conv_terms"]])
            db.execute("insert or replace into meta values ('analyzed', ?)",
                       (json.dumps({"at": time.time(), "k": result["k"], "seconds": round(time.time() - started, 2)}),))
        return {"themes": len(result["themes"]), "threads": len(result["threads"]), "edges": len(result["edges"]),
                "k": result["k"], "seconds": round(time.time() - started, 2)}

    def close(self) -> None:
        self.db.close()

    # ---- reading ----

    def cite(self, conv_id: str) -> str:
        """`c:<prefix>`: the shortest id prefix (8 characters or more) unique across the archive."""
        if getattr(self, "_cite_len", None) is None:
            ids = sorted(r[0] for r in self.db.execute("select id from conversations"))
            common = max((next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
                          for a, b in zip(ids, ids[1:])), default=0)
            self._cite_len = max(8, common + 1)
        return f"c:{conv_id[: self._cite_len]}"

    def meta(self, key: str) -> Any:
        row = self.db.execute("select value from meta where key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None

    def conversation(self, conv_id: str) -> sqlite3.Row | None:
        return self.db.execute("select * from conversations where id = ?", (conv_id,)).fetchone()

    def resolve(self, conv_id: str) -> sqlite3.Row | None:
        """A conversation by full id or a unique id prefix (at least 6 characters)."""
        row = self.conversation(conv_id)
        if row is None and len(conv_id) >= 6:
            rows = self.db.execute("select * from conversations where id like ? limit 2",
                                   (conv_id.replace("%", "") + "%",)).fetchall()
            row = rows[0] if len(rows) == 1 else None
        return row

    def messages(self, conv_id: str) -> list[sqlite3.Row]:
        return self.db.execute("select * from messages where conv_id = ? order by idx", (conv_id,)).fetchall()

    def themes_of(self, conv_id: str) -> list[dict[str, Any]]:
        return [{"theme": r["theme_id"], "label": r["label"], "primary": bool(r["is_primary"]), "score": r["score"]}
                for r in self.db.execute(
                    "select ct.theme_id, t.label, ct.is_primary, ct.score from conv_themes ct "
                    "join themes t on t.id = ct.theme_id where ct.conv_id = ? order by ct.is_primary desc, ct.score desc",
                    (conv_id,))]

    def top_terms(self, conv_id: str, n: int = 8) -> list[str]:
        return [r["term"] for r in self.db.execute(
            "select term from conv_terms where conv_id = ? order by weight desc limit ?", (conv_id, n))]

    def search_rows(self, query: str, limit: int = 200, role: str | None = None) -> list[sqlite3.Row]:
        sql = ("select m.id, m.conv_id, m.idx, m.role, m.created, bm25(messages_fts) as rank, "
               "snippet(messages_fts, 0, '[', ']', ' ... ', 18) as snippet "
               "from messages_fts join messages m on m.id = messages_fts.rowid where messages_fts match ? ")
        params: list[Any] = []
        if role in ("user", "assistant"):
            sql += "and m.role = ? "
            params.append(role)
        sql += "order by rank limit ?"
        for any_term in (False, True):
            q = fts_query(query, any_term)
            if not q:
                return []
            rows = self.db.execute(sql, [q, *params, limit]).fetchall()
            if rows:
                return rows
        return []

    def rank_conversations(self, query: str, limit: int = 50) -> list[tuple[float, str]]:
        """Conversations by summed relevance of their best five matching messages, plus title hits."""
        per: dict[str, list[float]] = {}
        for row in self.search_rows(query, limit=1000):
            per.setdefault(row["conv_id"], []).append(-row["rank"])
        terms = {t.lower() for t in TERM.findall(query) if len(t) > 2}
        scored = []
        for conv_id, ranks in per.items():
            score = sum(sorted(ranks, reverse=True)[:5])
            title = (self.conversation(conv_id)["title"] or "").lower()
            score *= 1.0 + 0.5 * sum(1 for t in terms if t in title)
            scored.append((round(score, 4), conv_id))
        return sorted(scored, reverse=True)[:limit]
