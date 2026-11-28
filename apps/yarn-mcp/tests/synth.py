"""A synthetic ChatGPT-format export: three topics over three months, written as a zip like the real one."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

TOPICS = {
    "sourdough": ["sourdough starter hydration", "levain fermentation schedule", "crumb structure and oven spring",
                  "rye flour starter feeding", "banneton proofing overnight", "autolyse dough strength"],
    "covenants": ["bitcoin covenant opcode", "op_ctv vault design", "taproot script path covenant",
                  "covenant vault recovery key", "op_cat covenant introspection", "bitvm covenant bridge"],
    "loops": ["looped transformer depth recurrence", "recurrent block weight tying", "looped transformer halting",
              "test-time recurrence extrapolation", "weight-tied recurrent layers", "looped transformer probing"],
}
DAY = 86400
START = 1767225600  # 2026-01-01


def conversation(cid: str, title: str, created: float, turns: list[tuple[str, str]], extra: dict | None = None
                 ) -> dict:
    mapping, parent = {"root": {"id": "root", "message": None, "parent": None, "children": []}}, "root"
    for n, (role, text) in enumerate(turns):
        node = f"{cid}-n{n}"
        mapping[node] = {"id": node, "parent": parent, "children": [],
                         "message": {"id": node, "author": {"role": role}, "create_time": created + n * 60,
                                     "content": {"content_type": "text", "parts": [text]}, "metadata": {}}}
        mapping[parent]["children"].append(node)
        parent = node
    raw = {"conversation_id": cid, "id": cid, "title": title, "create_time": created, "update_time": created + 3600,
           "mapping": mapping, "current_node": parent, "default_model_slug": "gpt-test"}
    raw.update(extra or {})
    return raw


def conversations() -> list[dict]:
    out = []
    for t, (topic, phrases) in enumerate(TOPICS.items()):
        for i in range(8):
            phrase = phrases[i % len(phrases)]
            other = phrases[(i + 1) % len(phrases)]
            created = START + (t * 3 + i * 9) * DAY
            turns = [("user", f"I keep coming back to {phrase}. How does {other} relate to {phrase}?"),
                     ("assistant", f"On {phrase}: the main point is that {other} and {phrase} interact. " * 6),
                     ("user", f"Follow-up on {phrase} and {other}, my notes from last time.")]
            out.append(conversation(f"{topic}-{i:02d}-0000-aaaa", f"{phrase.title()} notes {i}", created, turns))
    # One conversation with a regenerated branch: only the current_node path should be kept.
    branched = conversation("branch-0000-bbbb", "Sourdough branch test", START + 40 * DAY,
                            [("user", "sourdough starter hydration question"), ("assistant", "kept answer")])
    branched["mapping"]["stale"] = {"id": "stale", "parent": "branch-0000-bbbb-n0", "children": [], "message": {
        "id": "stale", "author": {"role": "assistant"}, "create_time": START, "metadata": {},
        "content": {"content_type": "text", "parts": ["regenerated answer that was discarded"]}}}
    out.append(branched)
    # Markup, secrets, a hidden system message, reasoning, and a do-not-remember conversation.
    marked = conversation("markup-0000-cccc", "Covenant markup test", START + 50 * DAY, [
        ("user", "My key is sk-proj-abcdefghijklmnopqrstuvwx and mail me at someone@example.com about op_ctv vaults"),
        ("assistant", 'Vaults \ue200filecite\ue202turn0file0\ue201 see <Link url="https://example.org/v" title="Vault '
                      'paper"/>. <box gap={1}><text>op_ctv vault covenant</text></box><Cite ref="x"/>')])
    marked["mapping"]["markup-0000-cccc-n1"]["message"]["metadata"] = {}
    hidden = marked["mapping"]["markup-0000-cccc-n0"]
    hidden_node = {"id": "hidden", "parent": "root", "children": [], "message": {
        "id": "hidden", "author": {"role": "system"}, "create_time": START, "metadata": {
            "is_visually_hidden_from_conversation": True},
        "content": {"content_type": "text", "parts": ["system prompt text"]}}}
    marked["mapping"]["hidden"] = hidden_node
    hidden["parent"] = "hidden"
    think = {"id": "think", "parent": "markup-0000-cccc-n1", "children": [], "message": {
        "id": "think", "author": {"role": "assistant"}, "create_time": START, "metadata": {},
        "content": {"content_type": "thoughts", "thoughts": [{"content": "private reasoning"}]}}}
    marked["mapping"]["think"] = think
    marked["current_node"] = "think"
    out.append(marked)
    out.append(conversation("dnr-0000-dddd", "Do not remember", START + 60 * DAY,
                            [("user", "forget this sourdough chat")], {"is_do_not_remember": True}))
    return out


def write_zip(path: Path, shards: int = 2, truncate: bool = False) -> Path:
    convs = conversations()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("ads.json", "{}")
        for s in range(shards):
            archive.writestr(f"conversations-{s:03d}.json", json.dumps(convs[s::shards]))
        archive.writestr("chat.html", "<html></html>")
    if truncate:
        data = path.read_bytes()
        path.write_bytes(data[: data.find(b"PK\x01\x02") - 5])  # no central directory, last entry cut
    return path
