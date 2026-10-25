"""Tests for `tk-studio-engage reply` (Story 32.2, AC1 and AC2).

The fixture project `fixtures/engage-project/` (copied to a temp root per
test, so nothing writes into the tree) holds one engagement in `intake`
with one owner line, a plan under `_bmad-output/planning-artifacts/`, `kb/`
and `kb/confluence/`. Covered: the memory it assembles (the record, the
chat, the three capped indexes), the reply line (the next `seq` under the
chat lock), the proposal shape (`{verb, payload, label}` with 32.1's
per-verb rules), every named refusal (nothing appended), the lock and the
CLI with its status block.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import engage  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "engage-project"
ENG = "ENG-001"
NOW = "2026-10-25T05:00:00.000Z"


class EngageTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "project"
        shutil.copytree(FIXTURE, self.root)
        self.dir = self.root / "_bmad-output" / "engagements" / ENG
        self.chat = self.dir / "chat.jsonl"

    def tearDown(self):
        self._tmp.cleanup()

    def lines(self) -> list[dict]:
        return [json.loads(raw) for raw in
                self.chat.read_text(encoding="utf-8").splitlines() if raw]

    def set_record(self, **changes):
        path = self.dir / "engagement.yaml"
        record = json.loads(path.read_text(encoding="utf-8"))
        record.update(changes)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    def assert_status_block_last(self, result: dict, status: str):
        self.assertEqual(list(result)[-4:],
                         ["status", "intent", "artifacts", "reason"])
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-engage")


class MemoryTestCase(EngageTestCase):
    def test_the_memory_is_the_record_the_chat_and_three_indexes(self):
        result = engage.reply(self.root, ENG)
        self.assert_status_block_last(result, "complete")
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "memory")
        self.assertEqual(result["record"]["id"], ENG)
        self.assertEqual(result["record"]["state"], "intake")
        self.assertEqual(result["chat"], [
            {"seq": 1, "at": "2026-10-25T03:01:00.000Z", "author": "owner",
             "body": "Which reports would the export cover?"}])
        memory = result["memory"]
        self.assertEqual(sorted(memory), ["confluence", "kb", "plan"])
        plan = memory["plan"]
        self.assertEqual(plan["root"], "_bmad-output/planning-artifacts")
        self.assertFalse(plan["truncated"])
        self.assertEqual([(f["path"], f["title"]) for f in plan["files"]], [
            ("_bmad-output/planning-artifacts/epics.md", "Fixture Epics"),
            ("_bmad-output/planning-artifacts/prd.md", "Fixture PRD")])
        epics = self.root / "_bmad-output/planning-artifacts/epics.md"
        self.assertEqual(plan["files"][0]["bytes"], epics.stat().st_size)
        # kb/ leaves kb/confluence/ to its own index
        self.assertEqual([f["path"] for f in memory["kb"]["files"]],
                         ["kb/notes.md"])
        self.assertEqual(memory["confluence"]["files"], [
            {"path": "kb/confluence/scope-of-work.md",
             "bytes": (self.root / "kb/confluence/scope-of-work.md")
             .stat().st_size, "title": "Scope of Work"}])
        # an index, never a dump: no file body rides the answer
        self.assertNotIn("Exports go through the reports service",
                         json.dumps(result))
        self.assertEqual(result["written"], [])
        self.assertEqual(len(self.lines()), 1)  # nothing appended

    def test_the_index_is_sorted_capped_and_skips_dot_names(self):
        for name in ("b.md", "a.txt", ".hidden.md"):
            (self.root / "kb" / name).write_text("x", encoding="utf-8")
        (self.root / "kb" / ".git").mkdir()
        (self.root / "kb" / ".git" / "HEAD").write_text("x", encoding="utf-8")
        full = engage.index(self.root, "kb", "kb/confluence")
        self.assertEqual([f["path"] for f in full["files"]],
                         ["kb/a.txt", "kb/b.md", "kb/notes.md"])
        self.assertIsNone(full["files"][0]["title"])  # not Markdown
        self.assertIsNone(full["files"][1]["title"])  # no heading
        capped = engage.index(self.root, "kb", "kb/confluence", cap=2)
        self.assertEqual(len(capped["files"]), 2)
        self.assertTrue(capped["truncated"])
        missing = engage.index(self.root, "nowhere")
        self.assertEqual(missing, {"root": "nowhere", "files": [],
                                   "truncated": False})


class WriteTestCase(EngageTestCase):
    PROPOSALS = [
        {"verb": "go", "payload": {}, "label": "Start scoping"},
        {"verb": "answer", "payload": {"answers": {"q1": "monthly"}},
         "label": "Monthly reports only"},
        {"verb": "revise", "payload": {"body": "narrow it"}, "label": "Narrow"},
        {"verb": "question", "payload": {"text": "how long?"},
         "label": "Ask about time"},
        {"verb": "approve", "payload": {"autonomy": "steady"},
         "label": "Approve, one story per run"},
        {"verb": "cancel", "payload": {"reason": "not now"}, "label": "Cancel"},
    ]

    def test_the_reply_line_takes_the_next_seq_with_its_proposals(self):
        result = engage.reply(self.root, ENG, body="The export covers the "
                              "monthly reports.", proposals=self.PROPOSALS,
                              run_id="engagement-chat-r1", now=NOW)
        self.assert_status_block_last(result, "complete")
        line = {"seq": 2, "at": NOW, "author": "planner",
                "body": "The export covers the monthly reports.",
                "run_id": "engagement-chat-r1", "proposals": self.PROPOSALS}
        self.assertEqual(result["line"], line)
        self.assertEqual(result["written"],
                         ["_bmad-output/engagements/ENG-001/chat.jsonl"])
        self.assertEqual(result["artifacts"], result["written"])
        self.assertEqual(self.lines()[-1], line)
        second = engage.reply(self.root, ENG, body="And weekly ones.",
                              run_id="engagement-chat-r2", now=NOW)
        self.assertEqual(second["line"]["seq"], 3)
        self.assertEqual(second["line"]["proposals"], [])
        self.assertEqual([l["seq"] for l in self.lines()], [1, 2, 3])
        self.assertFalse((self.dir / "chat.lock").exists())

    def test_the_first_line_of_a_missing_chat_is_seq_1(self):
        self.chat.unlink()
        result = engage.reply(self.root, ENG, body="hello", run_id="r")
        self.assertEqual(result["line"]["seq"], 1)
        self.assertEqual([l["seq"] for l in self.lines()], [1])

    def test_a_proposal_is_verb_payload_label_checked_by_the_verb_rules(self):
        bad = [
            ({"verb": "launch", "payload": {}, "label": "x"}, "unknown verb"),
            ({"verb": "go", "payload": {"cap": -1}, "label": "x"},
             "'cap' must be a number > 0"),
            ({"verb": "go", "payload": {"cap": True}, "label": "x"},
             "'cap' must be a number > 0"),
            ({"verb": "approve", "payload": {"autonomy": "max"},
              "label": "x"}, "'autonomy' must be one of"),
            ({"verb": "answer", "payload": {"answers": {}}, "label": "x"},
             "non-empty object"),
            ({"verb": "question", "payload": {"questions": [],
                                              "run_id": "r"}, "label": "x"},
             "unknown field 'questions'"),
            ({"verb": "cancel", "payload": {}, "label": ""},
             "'label' must be a non-empty string"),
            ({"verb": "cancel", "payload": {}, "label": "x" * 81},
             "exceeds 80 characters"),
            ({"verb": "go", "label": "x"}, "missing field 'payload'"),
            ({"verb": "go", "payload": {}, "label": "x", "apply": True},
             "unknown field 'apply'"),
            ("go", "not an object"),
        ]
        for proposal, why in bad:
            with self.subTest(proposal=proposal):
                result = engage.reply(self.root, ENG, body="b",
                                      proposals=[self.PROPOSALS[0], proposal],
                                      run_id="r")
                self.assert_status_block_last(result, "blocked")
                self.assertFalse(result["ok"])
                self.assertIn("ProposalInvalid: proposals[1]: ",
                              result["reason"])
                self.assertIn(why, result["reason"])
                self.assertEqual(len(self.lines()), 1)
        ok = engage.reply(self.root, ENG, body="b", run_id="r", proposals=[
            {"verb": "cancel", "payload": {}, "label": "x" * 80}])
        self.assertEqual(ok["status"], "complete")
        not_list = engage.reply(self.root, ENG, body="b", run_id="r",
                                proposals={"verb": "go"})
        self.assertIn("ProposalInvalid", not_list["reason"])

    def test_the_refusals_are_named_and_append_nothing(self):
        cases = [
            (dict(engagement="ENG-1"), "BadEngagement"),
            (dict(engagement="ENG-009"), "UnknownEngagement"),
            (dict(body=""), "BodyEmpty"),
            (dict(body="x" * (32 * 1024 + 1)), "BodyTooLarge"),
            (dict(run_id=None), "RunIdRequired"),
        ]
        for change, name in cases:
            with self.subTest(name=name):
                args = {"engagement": ENG, "body": "b", "run_id": "r",
                        **change}
                result = engage.reply(self.root, args.pop("engagement"),
                                      **args)
                self.assert_status_block_last(result, "blocked")
                self.assertTrue(result["reason"].startswith(
                    f"engage refused: {name}: "), result["reason"])
        for state in ("delivered", "failed", "cancelled"):
            with self.subTest(state=state):
                self.set_record(state=state)
                for body in (None, "b"):
                    result = engage.reply(self.root, ENG, body=body,
                                          run_id="r")
                    self.assertIn("EngagementClosed", result["reason"])
        self.assertEqual(len(self.lines()), 1)
        # a body of exactly 32 KiB UTF-8 is accepted
        self.set_record(state="scoping")
        ok = engage.reply(self.root, ENG, body="é" * (16 * 1024), run_id="r")
        self.assertEqual(ok["status"], "complete")

    def test_a_record_that_is_not_json_is_engagement_record_unreadable(self):
        path = self.dir / "engagement.yaml"
        for text in ("shape_version: 1\nid: ENG-001\nstate: intake\n",
                     json.dumps({"shape_version": 2, "id": ENG}),
                     json.dumps({"shape_version": 1, "id": "ENG-002"})):
            with self.subTest(text=text):
                path.write_text(text, encoding="utf-8")
                for body in (None, "b"):
                    result = engage.reply(self.root, ENG, body=body,
                                          run_id="r")
                    self.assert_status_block_last(result, "blocked")
                    self.assertIn("EngagementRecordUnreadable",
                                  result["reason"])
                    self.assertNotIn(str(self.root), result["reason"])
        self.assertEqual(len(self.lines()), 1)

    def test_an_unwritable_chat_is_chat_unwritable_and_appends_nothing(self):
        # a chat that is not UTF-8: refused by name, the file left as it was
        raw = b'{"seq": 1, "body": "caf\xe9"}\n'
        self.chat.write_bytes(raw)
        result = engage.reply(self.root, ENG, body="b", run_id="r")
        self.assert_status_block_last(result, "blocked")
        self.assertEqual(result["reason"], "engage refused: ChatUnwritable: "
                         "_bmad-output/engagements/ENG-001/chat.jsonl: "
                         "UnicodeDecodeError")
        self.assertEqual(result["written"], [])
        self.assertEqual(self.chat.read_bytes(), raw)
        self.assertFalse((self.dir / "chat.lock").exists())
        # the memory mode still reads it (errors replaced, never refused)
        self.assertEqual(engage.reply(self.root, ENG)["status"], "complete")
        self.chat.write_text(json.dumps({"seq": 1, "body": "x"}) + "\n",
                             encoding="utf-8")
        before = self.chat.read_bytes()
        # the OS refusing the write, or the lock: refused by name
        for target in ("engage.atomic_write_text", "engage.os.open"):
            with self.subTest(target=target), \
                    mock.patch(target, side_effect=PermissionError(13, "no")):
                result = engage.reply(self.root, ENG, body="b", run_id="r")
                self.assert_status_block_last(result, "blocked")
                self.assertEqual(result["reason"],
                                 "engage refused: ChatUnwritable: "
                                 "_bmad-output/engagements/ENG-001/"
                                 "chat.jsonl: PermissionError")
                self.assertEqual(result["written"], [])
                self.assertEqual(self.chat.read_bytes(), before)
        self.assertFalse((self.dir / "chat.lock").exists())

    def test_the_dry_run_appends_nothing_and_ends_partial(self):
        result = engage.reply(self.root, ENG, body="b", run_id="r",
                              dry_run=True)
        self.assert_status_block_last(result, "partial")
        self.assertEqual(result["line"]["seq"], None)
        self.assertEqual(result["written"], [])
        self.assertEqual(len(self.lines()), 1)


class ChatLockTestCase(EngageTestCase):
    def test_a_held_lock_is_chat_busy_and_a_stale_one_is_taken_over(self):
        lock = self.dir / "chat.lock"
        lock.write_text("", encoding="utf-8")
        with self.assertRaises(engage.Refused) as caught:
            engage._with_chat_lock(self.root, ENG, lambda: "ran", wait_s=0)
        self.assertEqual(caught.exception.name, "ChatBusy")
        self.assertTrue(lock.exists())
        old = time.time() - engage.CHAT_LOCK_STALE_S - 5
        os.utime(lock, (old, old))
        self.assertEqual(engage._with_chat_lock(self.root, ENG,
                                                lambda: "ran", wait_s=0),
                         "ran")
        self.assertFalse(lock.exists())

    def test_a_stale_takeover_is_an_atomic_rename_and_never_steals_a_retaken_lock(self):
        lock = self.dir / "chat.lock"
        # stale: moved aside under a unique name, then removed; nothing left
        lock.write_text("", encoding="utf-8")
        old = time.time() - engage.CHAT_LOCK_STALE_S - 5
        os.utime(lock, (old, old))
        engage._take_over_stale(lock, time.time)
        self.assertFalse(lock.exists())
        self.assertEqual(sorted(p.name for p in self.dir.glob("chat.lock*")), [])
        # another writer retook the lock between this writer's stat and its
        # rename (what is moved is fresh): it is put back, never stolen
        lock.write_text("", encoding="utf-8")
        engage._take_over_stale(lock, time.time)
        self.assertTrue(lock.exists())
        self.assertEqual(sorted(p.name for p in self.dir.glob("chat.lock*")),
                         ["chat.lock"])
        # the stale lock already taken over by another writer: a no-op
        lock.unlink()
        engage._take_over_stale(lock, time.time)
        self.assertFalse(lock.exists())

    def test_the_last_seq_is_reread_inside_the_lock(self):
        # a line another writer appended after the caller last read the
        # file is seen: the seq is computed under the lock, never before
        with self.chat.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"seq": 2, "at": NOW, "author": "owner",
                                     "body": "and?"}) + "\n")
        result = engage.reply(self.root, ENG, body="b", run_id="r")
        self.assertEqual(result["line"]["seq"], 3)
        # a torn last line is skipped, never renumbered
        with self.chat.open("a", encoding="utf-8") as handle:
            handle.write('{"seq": 9, "bo')
        result = engage.reply(self.root, ENG, body="c", run_id="r")
        self.assertEqual(result["line"]["seq"], 4)
        self.assertEqual([l["seq"] for l in engage.read_chat(self.root, ENG)],
                         [1, 2, 3, 4])

    def test_a_seq_that_is_not_finite_is_skipped_like_a_torn_line(self):
        # json.loads accepts NaN and Infinity: such a line is skipped, so
        # the memory stays well-formed and the next seq never crashes
        valid = {"seq": 1, "at": NOW, "author": "owner", "body": "hello?"}
        self.chat.write_text(
            '{"seq": NaN, "author": "owner", "body": "nan"}\n'
            '{"seq": Infinity, "author": "owner", "body": "inf"}\n'
            + json.dumps(valid) + "\n", encoding="utf-8")
        memory = engage.reply(self.root, ENG)
        self.assert_status_block_last(memory, "complete")
        self.assertEqual(memory["chat"], [valid])
        json.dumps(memory, allow_nan=False)  # no NaN rides the answer
        result = engage.reply(self.root, ENG, body="b", run_id="r", now=NOW)
        self.assert_status_block_last(result, "complete")
        self.assertEqual(result["line"]["seq"], 2)
        self.assertEqual([l["seq"] for l in engage.read_chat(self.root, ENG)],
                         [1, 2])


class CliTestCase(EngageTestCase):
    def run_cli(self, *argv: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = engage.main(["reply", "--directory", str(self.root),
                                "--engagement", ENG, *argv])
        return code, json.loads(out.getvalue())

    def test_the_cli_reads_the_memory_and_writes_from_files(self):
        code, memory = self.run_cli()
        self.assertEqual(code, 0)
        self.assertEqual(memory["mode"], "memory")
        self.assert_status_block_last(memory, "complete")
        body = Path(self._tmp.name) / "body.md"
        body.write_text("The export covers the monthly reports.",
                        encoding="utf-8")
        proposals = Path(self._tmp.name) / "proposals.json"
        proposals.write_text(json.dumps([{"verb": "go", "payload": {},
                                          "label": "Start scoping"}]),
                             encoding="utf-8")
        code, result = self.run_cli("--body-file", str(body),
                                    "--proposals-file", str(proposals),
                                    "--run-id", "engagement-chat-r1")
        self.assertEqual(code, 0)
        self.assertEqual(result["line"]["seq"], 2)
        self.assertEqual(result["line"]["proposals"][0]["label"],
                         "Start scoping")
        self.assertEqual(self.lines()[-1]["run_id"], "engagement-chat-r1")

    def test_the_cli_refusals_exit_2_with_the_status_block(self):
        body = Path(self._tmp.name) / "body.md"
        body.write_text("b", encoding="utf-8")
        bad = Path(self._tmp.name) / "bad.json"
        bad.write_text("{nope", encoding="utf-8")
        for argv, name in (
                (("--body-file", str(body), "--proposals-file", str(bad),
                  "--run-id", "r"), "ProposalInvalid"),
                (("--body-file", str(Path(self._tmp.name) / "none.md"),
                  "--run-id", "r"), "cannot read --body-file"),
                (("--proposals-file", str(bad)), "needs --body-file"),
                (("--body-file", str(body)), "RunIdRequired")):
            with self.subTest(name=name):
                code, result = self.run_cli(*argv)
                self.assertEqual(code, 2)
                self.assert_status_block_last(result, "blocked")
                self.assertIn(name, result["reason"])
        self.assertEqual(len(self.lines()), 1)


if __name__ == "__main__":
    unittest.main()
