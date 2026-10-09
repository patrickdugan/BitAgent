"""Longitudinal history: sessions, connected-app records, and memory summaries.

A session is the unit of disclosure: a dated interaction on one channel that
reveals one or more facts.  Rendering is deterministic text so that two runs
with the same seed produce byte-identical contexts.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from typing import Any, Iterable

from .graph import KnowledgeGraph
from .population import Persona, fact_text

CONVERSATION_CHANNELS = ("chat", "email", "document", "third_party")
CONNECTED_APP_CHANNELS = ("calendar", "app_record")

_ACKS = [
    "Assistant: Done. I have noted that for next time.",
    "Assistant: Understood. Here is a draft you can adjust.",
    "Assistant: Sure. I will keep that in mind.",
    "Assistant: Got it. Anything else for today?",
]

# Neutral filler: carries no persona facts.  Used for length-matched controls.
FILLER_EXCHANGES = [
    "User: What is a good substitute for buttermilk?\nAssistant: Milk with a spoon of lemon juice, rested five minutes.",
    "User: Explain how a heat pump works in two sentences.\nAssistant: It moves heat from outside air into the house using a refrigerant cycle. Even cold air holds usable heat.",
    "User: Convert 180 C to Fahrenheit.\nAssistant: 356 F.",
    "User: Give me a three-word name for a book club.\nAssistant: Margin Notes Society.",
    "User: Why does bread need to proof twice?\nAssistant: The first rise builds flavour and gluten structure; the second shapes the loaf and gives oven spring.",
    "User: How long does a 5k take at a relaxed pace?\nAssistant: Around 30 to 35 minutes for most casual runners.",
    "User: What is the difference between a crow and a raven?\nAssistant: Ravens are larger, with wedge-shaped tails and a deeper croak.",
    "User: Suggest a houseplant for a dim corridor.\nAssistant: A cast-iron plant tolerates low light and irregular watering.",
]


@dataclass
class Session:
    id: str
    day: int
    date: str
    channel: str
    fact_ids: tuple[str, ...]
    text: str
    domains: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "day": self.day,
            "date": self.date,
            "channel": self.channel,
            "fact_ids": list(self.fact_ids),
            "domains": list(self.domains),
            "text": self.text,
        }


def _date(start: str, day: int) -> str:
    return (_dt.date.fromisoformat(start) + _dt.timedelta(days=day)).isoformat()


def _render(persona: Persona, channel: str, day: int, fact_ids: Iterable[str], seq: int) -> str:
    date = _date(persona.start_date, day)
    lines = [fact_text(persona.id, fid) for fid in fact_ids]
    if channel == "chat":
        body = "\n".join(lines) + "\n" + _ACKS[seq % len(_ACKS)]
        return f"[{date}] Chat session\n{body}"
    if channel == "email":
        return f"[{date}] Connected mailbox\n" + "\n".join(lines)
    if channel == "document":
        return f"[{date}] Connected documents\n" + "\n".join(lines)
    if channel == "third_party":
        return f"[{date}] Forwarded by the user\n" + "\n".join(lines)
    if channel == "calendar":
        return f"[{date}] Connected calendar\n" + "\n".join(lines)
    if channel == "app_record":
        return f"[{date}] Connected banking app\n" + "\n".join(lines)
    raise ValueError(f"unknown channel {channel}")


def build_sessions(persona: Persona) -> list[Session]:
    """Group facts into dated sessions, ordered by day then channel."""
    buckets: dict[tuple[int, str], list[str]] = {}
    for f in persona.graph.facts.values():
        buckets.setdefault((f.disclosed_day, f.channel), []).append(f.id)
    sessions: list[Session] = []
    for seq, ((day, channel), fids) in enumerate(sorted(buckets.items())):
        fids_sorted = tuple(sorted(fids))
        domains = tuple(sorted({persona.graph.facts[f].domain for f in fids_sorted}))
        sessions.append(
            Session(
                id=f"{persona.id}:s{seq:03d}",
                day=day,
                date=_date(persona.start_date, day),
                channel=channel,
                fact_ids=fids_sorted,
                text=_render(persona, channel, day, fids_sorted, seq),
                domains=domains,
            )
        )
    return sessions


def filler_sessions(persona: Persona, count: int, *, start_seq: int = 0) -> list[Session]:
    """Fact-free sessions used to pad a context without adding information."""
    out = []
    for k in range(count):
        day = (k * 7) % max(1, persona.days)
        seq = start_seq + k
        text = f"[{_date(persona.start_date, day)}] Chat session\n{FILLER_EXCHANGES[seq % len(FILLER_EXCHANGES)]}"
        out.append(Session(id=f"{persona.id}:fill{seq:03d}", day=day, date=_date(persona.start_date, day), channel="chat", fact_ids=(), text=text))
    return out


def memory_summary_lines(
    graph: KnowledgeGraph,
    exposed_fact_ids: Iterable[str],
    available_inference_ids: Iterable[str],
    *,
    include_inferences: bool,
) -> list[str]:
    """What a persistent memory system would have written.

    With `include_inferences`, the memory system has already joined the facts
    and stored the conclusion.  That is the architecture-artifact arm: the
    conclusion is then a lookup, not a reasoning step.
    """
    lines: list[str] = []
    for fid in sorted(exposed_fact_ids):
        f = graph.facts[fid]
        tag = "superseded" if f.valid_to is not None else "current"
        conf = "" if f.confidence >= 1.0 else f" (unconfirmed, {f.source})"
        lines.append(f"- [{f.domain}/{tag}] {f.predicate.replace('_', ' ')}: {f.object}{conf}")
    if include_inferences:
        for iid in sorted(available_inference_ids):
            i = graph.inferences[iid]
            lines.append(f"- [inferred, {'/'.join(i.domains)}] {i.predicate.replace('_', ' ')}: {i.object}")
    return lines


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)
