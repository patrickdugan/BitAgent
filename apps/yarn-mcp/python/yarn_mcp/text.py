"""Tokenizing for theme analysis, token estimates, and redaction for packets."""

from __future__ import annotations

import math
import re

WORD = re.compile(r"[^\W\d_][\w'\-]{2,}", re.UNICODE)
FENCE = re.compile(r"```.*?(?:```|$)", re.DOTALL)
URL = re.compile(r"https?://\S+")
LATEX = re.compile(r"\\[A-Za-z]+")

STOPWORDS = frozenset(
    """
    a about above after again against all almost also although always am among an and another any anyone anything
    are aren around as ask asked at away back be because been before being below best better between both but by
    came can cannot could couldn did didn do does doesn doing don done down during each either else enough etc even
    ever every example few find first following for found from full further get gets getting give given go goes
    going good got great had hadn has hasn have haven having he her here hers herself him himself his how however
    i if in including instead into is isn it its itself just keep kind know known last least less let like likely
    lot made main make makes making many may maybe me might mine more most much must my myself need needs never new
    next no nor not nothing now of off often oh ok okay on once one only onto or other others otherwise our ours
    ourselves out over own part per perhaps please point possible probably put quite rather re really right said
    same say says see seem seems set several she should shouldn show since so some something sometimes still such
    sure take than thank thanks that the their theirs them themselves then there these they thing things think this
    those though through thus to together too took toward try trying two under until up upon us use used useful
    uses using usually very via want wants was wasn way ways we well went were weren what whatever when where whether
    which while who whom whose why will with within without won would wouldn yes yet you your yours yourself
    yourselves able actually already answer approach based case clear content continue different does each easy
    help here's i'd i'll i'm i've it's let's look looks means note okay overall provide provides question really
    simple specific step steps sure that's there's they're thing understand version we're what's work works you'd
    you'll you're you've great happy hello hi glad absolutely certainly definitely here's below above following
    def return import from class self none null true false const let var function async await print elif else
    """.split()
)


def words(text: str) -> list[str]:
    """Lowercased word tokens, stopwords removed, code fences, URLs and LaTeX commands dropped."""
    text = LATEX.sub(" ", URL.sub(" ", FENCE.sub(" ", text)))
    out = []
    for raw in WORD.findall(text):
        token = raw.lower().strip("'-")
        if len(token) >= 3 and token not in STOPWORDS and not token.endswith("'s"):
            out.append(token)
    return out


def features(text: str) -> list[str]:
    """Unigrams plus adjacent-pair bigrams (`looped transformer`), for TF-IDF."""
    tokens = words(text)
    return tokens + [f"{a} {b}" for a, b in zip(tokens, tokens[1:]) if a != b]


def estimate_tokens(text: str) -> int:
    """BPE token estimate: about 4 ASCII characters per token, about 1 token per other character."""
    if not text:
        return 0
    ascii_chars = sum(1 for ch in text if ord(ch) < 128)
    return math.ceil(ascii_chars / 3.8 + (len(text) - ascii_chars) * 0.9)


REDACTIONS = [
    ("pem", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL)),
    ("key", re.compile(r"\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_\-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}"
                       r"|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9\-]{10,}|AIza[0-9A-Za-z_\-]{30,})")),
    ("wif", re.compile(r"\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b")),
    ("xprv", re.compile(r"\b[xtyz]prv[1-9A-HJ-NP-Za-km-z]{100,}\b")),
    ("email", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    ("phone", re.compile(r"(?<![\w.])\+?\d{1,3}[\s.\-]?\(?\d{2,4}\)?[\s.\-]\d{3,4}[\s.\-]\d{3,4}(?![\w.])")),
]


def redact(text: str) -> tuple[str, int]:
    """Mask private keys, API keys, emails and phone numbers. Returns the text and how many were masked."""
    count = 0
    for label, pattern in REDACTIONS:
        text, n = pattern.subn(f"[redacted:{label}]", text)
        count += n
    return text, count


def clip(text: str, max_tokens: int) -> str:
    """Head and tail of `text` within about `max_tokens`, with the cut marked."""
    if estimate_tokens(text) <= max_tokens:
        return text
    chars = max(80, int(max_tokens * 3.8))
    head = text[: int(chars * 0.7)].rstrip()
    tail = text[-int(chars * 0.25):].lstrip()
    return f"{head}\n[... {estimate_tokens(text) - max_tokens} tokens cut ...]\n{tail}"
