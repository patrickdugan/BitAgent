"""YaRN-MCP server tests on a synthetic export.

    PYTHONPATH=python python -m unittest discover -s tests
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

import synth  # noqa: E402
from yarn_mcp.distill import yarn_plan  # noqa: E402
from yarn_mcp.ingest import read_export  # noqa: E402
from yarn_mcp.server import handle, serve  # noqa: E402
from yarn_mcp.service import Service, ToolError  # noqa: E402
from yarn_mcp.text import estimate_tokens, redact  # noqa: E402


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.export = synth.write_zip(root / "export.zip")
        cls.service = Service(root / "home", allow_ingest=True)
        cls.ingested = cls.service.call("ingest_export", {"path": str(cls.export)})

    @classmethod
    def tearDownClass(cls):
        cls.service.close()
        cls.tmp.cleanup()


class IngestTests(Base):
    def test_counts_and_do_not_remember(self):
        stats = self.ingested["ingest"]
        self.assertEqual(stats["read"], 27)
        self.assertEqual(stats["kept"], 26)
        self.assertEqual(stats["skipped_do_not_remember"], 1)
        self.assertEqual(stats["warnings"], [])

    def test_truncated_zip_reads_local_headers(self):
        with tempfile.TemporaryDirectory() as tmp:
            cut = synth.write_zip(Path(tmp) / "cut.zip", truncate=True)
            convs, stats = read_export(cut)
        self.assertEqual(len(convs), 26)
        self.assertIn("central directory", stats["warnings"][0])

    def test_main_branch_only_and_markup(self):
        db = self.service.store.db
        branch = [r[0] for r in db.execute("select text from messages where conv_id = 'branch-0000-bbbb'")]
        self.assertEqual(branch, ["sourdough starter hydration question", "kept answer"])
        texts = [r[0] for r in db.execute("select text from messages where conv_id = 'markup-0000-cccc' order by idx")]
        self.assertEqual(len(texts), 2, texts)  # hidden system message and reasoning skipped
        self.assertNotIn("filecite", texts[1])
        self.assertIn("[Vault paper](https://example.org/v)", texts[1])
        self.assertNotIn("<box", texts[1])
        self.assertNotIn("<Cite", texts[1])

    def test_claude_jsonl_and_notes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "conversations.json").write_text(json.dumps([{
                "uuid": "claude-1", "name": "Claude chat", "created_at": "2026-02-01T10:00:00Z",
                "chat_messages": [{"sender": "human", "text": "hello covenant", "created_at": "2026-02-01T10:00:00Z"},
                                  {"sender": "assistant", "text": "", "content": [{"type": "text", "text": "hi"}]}]}]))
            (root / "more.jsonl").write_text(json.dumps({"id": "j1", "title": "J", "messages": [
                {"role": "user", "content": "jsonl text"}]}) + "\n")
            (root / "idea.md").write_text("# Idea\nlooped transformer note")
            convs, _ = read_export(root)
        by_id = {c["id"]: c for c in convs}
        self.assertEqual(by_id["claude-1"]["messages"][1], {"role": "assistant", "created": None, "text": "hi"})
        self.assertEqual(by_id["j1"]["messages"][0]["text"], "jsonl text")
        self.assertEqual(by_id["note:idea.md"]["messages"][0]["role"], "user")

    def test_reingest_replaces(self):
        again = self.service.call("ingest_export", {"path": str(self.export)})
        self.assertEqual(again["store"]["replaced"], 26)
        self.assertEqual(self.service.call("archive_status", {})["conversations"], 26)
        hits = self.service.call("search", {"query": "kept answer"})
        self.assertEqual(hits["results"][0]["snippets"][0]["text"].count("kept"), 1)


class AnalysisTests(Base):
    def topic_of(self, conv_id: str) -> str:
        return conv_id.split("-")[0]

    def test_themes_separate_topics(self):
        themes = self.service.call("list_themes", {})["themes"]
        purity = []
        for theme in themes:
            card = self.service.call("theme_card", {"theme": theme["theme"], "members": 50})
            topics = [self.topic_of(m["id"]) for m in card["members"] if m["primary"]
                      and self.topic_of(m["id"]) in synth.TOPICS]
            if topics:
                purity.append(max(topics.count(t) for t in set(topics)) / len(topics))
        self.assertGreaterEqual(min(purity), 0.75, (purity, [t["label"] for t in themes]))

    def test_threads_span_days_in_order(self):
        threads = self.service.call("research_threads", {"members": 50})["threads"]
        self.assertTrue(threads)
        for thread in threads:
            dates = [m["date"] for m in thread["members"]]
            self.assertEqual(dates, sorted(dates))
            self.assertGreaterEqual(thread["days"], 2)
            # The two "... test" titles share one word; that must not chain sourdough into covenants.
            topics = {self.topic_of(m["id"]) for m in thread["members"]} & set(synth.TOPICS)
            self.assertEqual(len(topics), 1, thread["label"])

    def test_connections(self):
        linked = self.service.call("connections", {"conversation": "loops-00"})
        self.assertTrue(linked["linked"])
        self.assertEqual(self.topic_of(linked["linked"][0]["id"]), "loops")
        self.assertTrue(linked["linked"][0]["via"])
        term = self.service.call("connections", {"term": "covenant"})
        self.assertGreater(term["messages_mentioning"], 0)
        with self.assertRaises(ToolError):
            self.service.call("connections", {})

    def test_search_filters_and_timeline(self):
        hits = self.service.call("search", {"query": "levain fermentation", "role": "user"})
        self.assertTrue(all(s["role"] == "user" for r in hits["results"] for s in r["snippets"]))
        self.assertEqual(self.topic_of(hits["results"][0]["id"]), "sourdough")
        none = self.service.call("search", {"query": "levain", "until": "2025-12-31"})
        self.assertEqual(none["results"], [])
        months = self.service.call("timeline", {"term": "covenant"})["by_month"]
        self.assertTrue(set(months) <= {"2026-01", "2026-02", "2026-03"}, months)

    def test_get_conversation_budget(self):
        conv = self.service.call("get_conversation", {"conversation": "sourdough-03", "max_tokens": 200})
        self.assertLessEqual(conv["tokens"], 220)
        self.assertEqual(conv["cite"], "c:sourdough-03")
        with self.assertRaises(ToolError) as caught:
            self.service.call("get_conversation", {"conversation": "nope-404"})
        self.assertEqual(caught.exception.code, "unknown_conversation")

    def test_argument_errors(self):
        with self.assertRaises(ToolError) as caught:
            self.service.call("search", {})
        self.assertEqual(caught.exception.code, "missing_param")
        with self.assertRaises(ToolError) as caught:
            self.service.call("search", {"query": "x", "bogus": 1})
        self.assertEqual(caught.exception.code, "unknown_param")


class DistillTests(Base):
    def test_query_packet_within_limit(self):
        out = self.service.call("distill_yarn", {"query": "mail key vaults", "token_limit": 1500})
        text = Path(out["packet_path"]).read_text(encoding="utf-8")
        self.assertLessEqual(out["packet_tokens"], 1500)
        self.assertEqual(estimate_tokens(text), out["packet_tokens"])
        self.assertIn("[c:markup", text)
        self.assertNotIn("sk-proj-abcdefghijklmnopqrstuvwx", text)
        self.assertNotIn("someone@example.com", text)
        self.assertGreaterEqual(out["redactions"], 2)
        self.assertFalse(out["yarn"]["needed"])
        manifest = json.loads(Path(out["packet_path"]).with_suffix(".json").read_text())
        self.assertEqual(manifest["sha256"], out["sha256"])

    def test_clamped_by_yarn_reach(self):
        out = self.service.call("distill_yarn", {"token_limit": 100000, "native_ctx": 4096, "max_yarn_factor": 2,
                                                 "reserve_tokens": 1000})
        self.assertEqual(out["token_limit"], 4096 * 2 - 1000)
        self.assertTrue(out["clamped"])
        self.assertIn("context does not permit", out["clamp_reason"])
        self.assertLessEqual(out["packet_tokens"], 7192)
        self.assertEqual(out["conversations_considered"], 26)

    def test_thread_packet_is_chronological(self):
        thread = self.service.call("research_threads", {})["threads"][0]["thread"]
        out = self.service.call("distill_yarn", {"thread": thread, "token_limit": 4000})
        text = Path(out["packet_path"]).read_text(encoding="utf-8")
        dates = [line.rsplit("(", 1)[1][:10] for line in text.splitlines() if line.startswith("### [c:")]
        self.assertEqual(dates, sorted(dates))

    def test_user_only_and_errors(self):
        out = self.service.call("distill_yarn", {"theme": "T01", "token_limit": 2000, "include_assistant": False})
        self.assertNotIn("**assistant:**", Path(out["packet_path"]).read_text(encoding="utf-8"))
        for args, code in (({"theme": "T99"}, "unknown_theme"), ({"token_limit": 10}, "token_limit_too_small"),
                           ({"query": "zzzqqq"}, "no_matches")):
            with self.assertRaises(ToolError) as caught:
                self.service.call("distill_yarn", args)
            self.assertEqual(caught.exception.code, code)

    def test_tokenize_url_must_be_loopback(self):
        service = Service(self.service.store.home, tokenize_url="http://example.com/tokenize")
        with self.assertRaises(ToolError) as caught:
            service.call("distill_yarn", {"query": "covenant", "token_limit": 1000})
        service.close()
        self.assertEqual(caught.exception.code, "tokenize_url_not_loopback")


class PlanTests(unittest.TestCase):
    def test_yarn_plan(self):
        native = yarn_plan(20000, 4096, 32768, 4.0)
        self.assertFalse(native["needed"])
        two = yarn_plan(40000, 4096, 32768, 4.0)
        self.assertEqual((two["factor"], two["context"]), (2.0, 65536))
        self.assertEqual(two["llama_cpp"], ["--rope-scaling", "yarn", "--rope-scale", "2", "--yarn-orig-ctx", "32768",
                                            "-c", "65536"])
        self.assertEqual(two["hf_rope_scaling"]["original_max_position_embeddings"], 32768)
        too_big = yarn_plan(200000, 4096, 32768, 4.0)
        self.assertFalse(too_big["fits"])

    def test_redact(self):
        text, n = redact("ghp_abcdefghijklmnopqrstuvwxyz0123 and +1 415 555 0134 and 5" + "H" * 50)
        self.assertEqual(n, 3, text)
        self.assertEqual(redact("txid " + "ab" * 32)[1], 0)


class ServerTests(Base):
    def test_protocol(self):
        frames = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
                  {"jsonrpc": "2.0", "method": "notifications/initialized"},
                  {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                  {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "archive_status"}},
                  {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "theme_card",
                                                                                 "arguments": {"theme": "T77"}}}]
        out = io.BytesIO()
        serve(self.service, io.BytesIO(b"\n".join(json.dumps(f).encode() for f in frames) + b"\nnot json\n"), out)
        replies = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual([r.get("id") for r in replies], [1, 2, 3, 4, None])
        self.assertIn("YaRN-MCP", replies[0]["result"]["instructions"])
        names = {t["name"] for t in replies[1]["result"]["tools"]}
        self.assertIn("ingest_export", names)
        self.assertEqual(replies[2]["result"]["structuredContent"]["conversations"], 26)
        self.assertTrue(replies[3]["result"]["isError"])
        self.assertEqual(replies[3]["result"]["structuredContent"]["error"], "unknown_theme")
        self.assertEqual(replies[4]["error"]["code"], -32700)

    def test_read_only_hides_writes(self):
        service = Service(self.service.store.home, read_only=True, allow_ingest=True)
        names = {t["name"] for t in service.tools()}
        self.assertNotIn("distill_yarn", names)
        self.assertNotIn("ingest_export", names)
        reply = handle(service, {"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                                 "params": {"name": "distill_yarn", "arguments": {}}})
        self.assertEqual(reply["result"]["structuredContent"]["error"], "unknown_tool")
        default = Service(self.service.store.home)
        self.assertNotIn("ingest_export", {t["name"] for t in default.tools()})
        service.close()
        default.close()


if __name__ == "__main__":
    unittest.main()
