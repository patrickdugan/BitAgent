"""Read chat exports into one conversation shape.

Supported inputs (a file, a directory, or a zip, including a zip whose download was cut off):

- ChatGPT data export: `conversations.json` or the sharded `conversations-000.json` ... files. The main
  branch of each conversation is the path from `current_node` back to the root; regenerated and edited
  branches are skipped. Reasoning (`thoughts`, `reasoning_recap`), tool output, hidden system context and
  conversations marked "do not remember" are skipped unless asked for.
- Claude data export: `conversations.json` with `chat_messages`.
- Generic JSONL: one conversation per line, `{"id", "title", "created", "messages": [{"role", "content"}]}`.
- Markdown or text notes: one document per file, attributed to the user.

Every conversation comes out as
`{"id", "source", "title", "created", "updated", "model", "flags", "messages": [{"role", "created", "text"}]}`.
"""

from __future__ import annotations

import io
import json
import re
import struct
import zipfile
import zlib
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

SHARD = re.compile(r"(?:^|/)conversations(?:-\d+)?\.json$")
NOTE_SUFFIXES = {".md", ".markdown", ".txt"}
MAX_MEMBER_BYTES = 1 << 30
TEXT_TYPES = {"text", "multimodal_text"}
REASONING_TYPES = {"thoughts", "reasoning_recap"}
# ChatGPT wraps inline citations and widgets in private-use markers: U+E200 kind U+E202 payload U+E201.
MARKUP = re.compile("\ue200[^\ue201]*\ue201|[\ue000-\uf8ff]")


class IngestError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def _epoch(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value) / (1000.0 if value > 1e11 else 1.0)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ---- ChatGPT ----

# ChatGPT's rich replies embed UI components (<box>, <Cite/>, <Link url=...>) in the Markdown.
_LAYOUT = ("box|row|grid|text|caption|title|badge|button|radio|label|list|slider|WritingBlock|Entity|"
           "AsyncImageGroup|CodeBlock")
_DROP = "Cite|MemoryCite|FileCite|icon|divider|AsyncImage|Chart"
LINK = re.compile(r'<Link\b[^<>]*?\burl="([^"]*)"[^<>]*>(.*?)</Link>', re.DOTALL)
SVG = re.compile(r"<svg\b.*?</svg>", re.DOTALL)
DROP_TAG = re.compile(rf"<(?:{_DROP})\b[^<>]*?/>|<(?:{_DROP})\b[^<>]*>.*?</(?:{_DROP})>", re.DOTALL)
LAYOUT_TAG = re.compile(rf"</?(?:{_LAYOUT})\b[^<>]*?/?>")
CODE_FENCE = re.compile(r"(```.*?```)", re.DOTALL)
BLANK_RUNS = re.compile(r"\n[ \t]*(?:\n[ \t]*){2,}")
LINK_SELF = re.compile(r"<Link\b([^<>]*?)/>")
ATTR = re.compile(r'\b(url|title)="([^"]*)"')


def _self_link(match: re.Match[str]) -> str:
    attrs = dict(ATTR.findall(match.group(1)))
    url = attrs.get("url", "")
    return f"[{attrs['title']}]({url})" if attrs.get("title") else url


def clean_components(text: str) -> str:
    """Replace UI components with their text (links become Markdown links); code fences stay as written."""
    if "<" not in text:
        return text
    parts = CODE_FENCE.split(text)
    for i in range(0, len(parts), 2):
        part = LINK_SELF.sub(_self_link, parts[i])  # self-closing first, so LINK never spans two links
        part = LINK.sub(lambda m: f"[{m.group(2).strip()}]({m.group(1)})", part)
        part = LAYOUT_TAG.sub("", DROP_TAG.sub("", SVG.sub("", part)))
        parts[i] = BLANK_RUNS.sub("\n\n", part)
    return "".join(parts)


def _chatgpt_text(content: dict[str, Any], reasoning: bool) -> str:
    kind = content.get("content_type")
    if kind in TEXT_TYPES:
        parts = []
        for part in content.get("parts") or []:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "\n".join(p for p in parts if p)
    if kind == "code":
        return f"```\n{content.get('text') or ''}\n```"
    if reasoning and kind == "thoughts":
        return "\n".join(str(t.get("content") or "") for t in content.get("thoughts") or [] if isinstance(t, dict))
    if reasoning and kind == "reasoning_recap":
        return str(content.get("content") or "")
    return ""


def chatgpt_conversation(raw: dict[str, Any], reasoning: bool = False) -> dict[str, Any]:
    mapping = raw.get("mapping") or {}
    chain: list[dict[str, Any]] = []
    node, seen = raw.get("current_node"), set()
    while node and node in mapping and node not in seen:
        seen.add(node)
        chain.append(mapping[node])
        node = mapping[node].get("parent")
    chain.reverse()
    if not chain:
        chain = sorted(mapping.values(), key=lambda n: ((n.get("message") or {}).get("create_time") or 0))
    messages = []
    for item in chain:
        message = item.get("message") or {}
        meta = message.get("metadata") or {}
        role = (message.get("author") or {}).get("role")
        if role not in ("user", "assistant") or meta.get("is_visually_hidden_from_conversation"):
            continue
        text = MARKUP.sub("", _chatgpt_text(message.get("content") or {}, reasoning))
        text = clean_components(text).strip() if role == "assistant" else text.strip()
        if text:
            messages.append({"role": role, "created": _epoch(message.get("create_time")), "text": text})
    flags = [f for f in ("is_archived", "is_starred", "is_do_not_remember") if raw.get(f)]
    return {
        "id": str(raw.get("conversation_id") or raw.get("id") or ""),
        "source": "chatgpt",
        "title": str(raw.get("title") or "untitled"),
        "created": _epoch(raw.get("create_time")),
        "updated": _epoch(raw.get("update_time")),
        "model": raw.get("default_model_slug"),
        "flags": flags,
        "messages": messages,
    }


# ---- Claude ----

def claude_conversation(raw: dict[str, Any]) -> dict[str, Any]:
    messages = []
    for message in raw.get("chat_messages") or []:
        text = message.get("text") or ""
        if not text:
            text = "\n".join(c.get("text") or "" for c in message.get("content") or []
                             if isinstance(c, dict) and c.get("type") == "text")
        role = "user" if message.get("sender") == "human" else "assistant"
        if text.strip():
            messages.append({"role": role, "created": _epoch(message.get("created_at")), "text": text.strip()})
    return {
        "id": str(raw.get("uuid") or ""),
        "source": "claude",
        "title": str(raw.get("name") or "untitled"),
        "created": _epoch(raw.get("created_at")),
        "updated": _epoch(raw.get("updated_at")),
        "model": raw.get("model"),
        "flags": [],
        "messages": messages,
    }


def generic_conversation(raw: dict[str, Any], fallback_id: str) -> dict[str, Any]:
    messages = []
    for message in raw.get("messages") or []:
        text = message.get("content") if isinstance(message.get("content"), str) else message.get("text")
        role = message.get("role") if message.get("role") in ("user", "assistant") else "user"
        if isinstance(text, str) and text.strip():
            messages.append({"role": role, "created": _epoch(message.get("created")), "text": text.strip()})
    return {
        "id": str(raw.get("id") or fallback_id),
        "source": str(raw.get("source") or "jsonl"),
        "title": str(raw.get("title") or "untitled"),
        "created": _epoch(raw.get("created")),
        "updated": _epoch(raw.get("updated")),
        "model": raw.get("model"),
        "flags": [],
        "messages": messages,
    }


def parse_records(records: Any, reasoning: bool = False) -> Iterator[dict[str, Any]]:
    if isinstance(records, dict):
        records = records.get("conversations") or [records]
    if not isinstance(records, list):
        raise IngestError("unknown_format", "expected a list of conversations")
    for index, raw in enumerate(records):
        if not isinstance(raw, dict):
            continue
        if "mapping" in raw:
            yield chatgpt_conversation(raw, reasoning)
        elif "chat_messages" in raw:
            yield claude_conversation(raw)
        elif "messages" in raw:
            yield generic_conversation(raw, f"record-{index}")


# ---- zip members, including zips whose central directory is missing ----

def _scan_local_entries(path: Path) -> Iterator[tuple[str, int, int, int, int]]:
    """(name, data offset, compressed size, method, crc) for each entry, read from local headers."""
    with path.open("rb") as handle:
        pos = 0
        while True:
            handle.seek(pos)
            header = handle.read(30)
            if len(header) < 30 or header[:4] != b"PK\x03\x04":
                return
            _, _, flag, method, _, _, crc, csize, _, name_len, extra_len = struct.unpack("<IHHHHHIIIHH", header)
            name = handle.read(name_len).decode("utf-8", errors="replace")
            extra = handle.read(extra_len)
            if csize == 0xFFFFFFFF:
                i = 0
                while i + 4 <= len(extra):
                    hid, hsize = struct.unpack("<HH", extra[i:i + 4])
                    if hid == 1 and hsize >= 16:
                        _, csize = struct.unpack("<QQ", extra[i + 4:i + 20])
                        break
                    i += 4 + hsize
            if flag & 8 and csize == 0:
                return  # streamed entry with a trailing data descriptor: its size is unknown here
            yield name, pos + 30 + name_len + extra_len, csize, method, crc
            pos += 30 + name_len + extra_len + csize


def _read_local(path: Path, offset: int, csize: int, method: int, crc: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        data = handle.read(csize)
    if len(data) < csize:
        raise IngestError("truncated_member", "entry is cut off by the end of the file")
    if method == 8:
        data = zlib.decompress(data, -15)
    elif method != 0:
        raise IngestError("unsupported_compression", f"zip method {method}")
    if zlib.crc32(data) & 0xFFFFFFFF != crc:
        raise IngestError("crc_mismatch", "entry is corrupt")
    return data


def zip_members(path: Path, warnings: list[str]) -> Iterator[tuple[str, bytes]]:
    try:
        with zipfile.ZipFile(path) as archive:
            names = [i for i in archive.infolist() if SHARD.search(i.filename) or i.filename.endswith(".jsonl")]
            for info in sorted(names, key=lambda i: i.filename):
                if info.file_size > MAX_MEMBER_BYTES:
                    warnings.append(f"{info.filename}: skipped, larger than {MAX_MEMBER_BYTES} bytes")
                    continue
                yield info.filename, archive.read(info)
        return
    except zipfile.BadZipFile:
        pass
    warnings.append("zip has no central directory (download cut off?); read entries from local headers")
    entries = [e for e in _scan_local_entries(path) if SHARD.search(e[0]) or e[0].endswith(".jsonl")]
    if not entries:
        raise IngestError("no_conversations", f"{path.name}: no conversations*.json entries readable")
    for name, offset, csize, method, crc in sorted(entries):
        try:
            yield name, _read_local(path, offset, csize, method, crc)
        except IngestError as exc:
            warnings.append(f"{name}: {exc.code}")


# ---- entry point ----

def _from_bytes(name: str, data: bytes, reasoning: bool) -> Iterator[dict[str, Any]]:
    if name.endswith(".jsonl"):
        for number, line in enumerate(io.TextIOWrapper(io.BytesIO(data), encoding="utf-8")):
            if line.strip():
                record = json.loads(line)
                if isinstance(record, dict) and ("mapping" in record or "chat_messages" in record):
                    yield from parse_records([record], reasoning)
                elif isinstance(record, dict):
                    yield generic_conversation(record, f"{Path(name).stem}-{number}")
        return
    yield from parse_records(json.loads(data.decode("utf-8")), reasoning)


def _note(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    stat = path.stat()
    return {"id": f"note:{path.name}", "source": "notes", "title": path.stem, "created": stat.st_mtime,
            "updated": stat.st_mtime, "model": None, "flags": [],
            "messages": [{"role": "user", "created": stat.st_mtime, "text": text.strip()}] if text.strip() else []}


def read_export(path: str | Path, reasoning: bool = False, include_do_not_remember: bool = False
                ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """All conversations under `path`, plus stats and warnings."""
    path = Path(path).expanduser()
    if not path.exists():
        raise IngestError("not_found", str(path))
    warnings: list[str] = []
    found: list[dict[str, Any]] = []
    files: list[str] = []
    if path.is_dir():
        members = sorted(p for p in list(path.glob("*")) + list(path.glob("*/*"))
                         if p.is_file() and (SHARD.search(p.as_posix()) or p.suffix in (".jsonl", ".zip")
                                             or p.suffix in NOTE_SUFFIXES))
        for member in members:
            files.append(member.name)
            if member.suffix == ".zip":
                for name, data in zip_members(member, warnings):
                    found.extend(_from_bytes(name, data, reasoning))
            elif member.suffix in NOTE_SUFFIXES:
                found.append(_note(member))
            else:
                found.extend(_from_bytes(member.name, member.read_bytes(), reasoning))
    elif path.suffix == ".zip":
        for name, data in zip_members(path, warnings):
            files.append(name)
            found.extend(_from_bytes(name, data, reasoning))
    elif path.suffix in NOTE_SUFFIXES:
        files.append(path.name)
        found.append(_note(path))
    else:
        files.append(path.name)
        found.extend(_from_bytes(path.name, path.read_bytes(), reasoning))
    kept, skipped_dnr, empty, dupes, seen = [], 0, 0, 0, set()
    for conversation in found:
        if not conversation["id"]:
            continue
        if "is_do_not_remember" in conversation["flags"] and not include_do_not_remember:
            skipped_dnr += 1
            continue
        if not conversation["messages"]:
            empty += 1
            continue
        if conversation["id"] in seen:
            dupes += 1
            continue
        seen.add(conversation["id"])
        kept.append(conversation)
    if not kept and not found:
        raise IngestError("no_conversations", f"{path.name}: nothing readable as conversations")
    stats = {"files": files, "read": len(found), "kept": len(kept), "skipped_do_not_remember": skipped_dnr,
             "skipped_empty": empty, "skipped_duplicate": dupes, "warnings": warnings,
             "sources": sorted({c["source"] for c in kept})}
    return kept, stats
