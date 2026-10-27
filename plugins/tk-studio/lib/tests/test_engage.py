"""Tests for `tk-studio-engage reply` (Story 32.2, AC1 and AC2) and
`questions` (Story 32.3, AC1: the cap, the shape, the state refusals) and
`scope` (Story 32.4, AC1 and AC2: the shape check and its named refusals,
the publish to `Engagements/ENG-NNN` against a fake Confluence REST with
the skip, the update and the 429, nothing under `plan/`, the `revise` body
and the `reply` memory's `scope`).

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
import re
import shutil
import sys
import tempfile
import time
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import confluence  # noqa: E402
import engage  # noqa: E402
import plansync  # noqa: E402

from test_publish import FakeConfluencePublish  # noqa: E402
from test_tracking_setup import SetupTestCase, SITE  # noqa: E402

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


def question(qid="scope", **changes):
    q = {"id": qid, "text": "How big is the first cut?",
         "options": [{"label": "Small", "default": True}, {"label": "Large"}],
         "impact": "sets the quote"}
    q.update(changes)
    return q


class QuestionsTestCase(EngageTestCase):
    def ask(self, asked, **kwargs):
        kwargs.setdefault("run_id", "engagement-chat-q1")
        return engage.questions(self.root, ENG, asked, now=NOW, **kwargs)

    def written(self) -> Path:
        return self.dir / "questions.json"

    def test_one_to_three_valid_questions_write_questions_json(self):
        asked = [question(), question("db", text="Which database?",
                                      options=[{"label": "sqlite"},
                                               {"label": "postgres",
                                                "default": True}],
                                      impact="the hosting cost")]
        result = self.ask(asked)
        self.assert_status_block_last(result, "complete")
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "questions")
        self.assertEqual(result["written"],
                         [f"_bmad-output/engagements/{ENG}/questions.json"])
        doc = json.loads(self.written().read_text(encoding="utf-8"))
        self.assertEqual(doc, {"run_id": "engagement-chat-q1", "at": NOW,
                               "questions": asked})
        self.assertEqual(result["questions"], doc)
        # the planner moves no state: the record is untouched
        record = json.loads((self.dir / "engagement.yaml")
                            .read_text(encoding="utf-8"))
        self.assertEqual(record["state"], "intake")
        self.assertEqual(record["questions"], [])
        # three is the cap, not a refusal
        three = [question("a"), question("b"), question("c")]
        self.assert_status_block_last(self.ask(three), "complete")

    def test_a_fourth_question_is_too_many_questions_and_writes_nothing(self):
        result = self.ask([question(q) for q in ("a", "b", "c", "d")])
        self.assert_status_block_last(result, "blocked")
        self.assertFalse(result["ok"])
        self.assertIn("TooManyQuestions", result["reason"])
        self.assertFalse(self.written().exists())

    def test_each_invalid_shape_is_question_invalid_naming_the_index(self):
        cases = {
            "no default": [question(options=[{"label": "a"},
                                             {"label": "b"}])],
            "two defaults": [question(options=[
                {"label": "a", "default": True},
                {"label": "b", "default": True}])],
            "one option": [question(options=[{"label": "a",
                                              "default": True}])],
            "seven options": [question(options=[
                {"label": f"o{i}", **({"default": True} if i == 0 else {})}
                for i in range(7)])],
            "duplicate id": [question("a"), question("a")],
            "duplicate label": [question(options=[
                {"label": "Same", "default": True}, {"label": "same"}])],
            "bad id": [question("Not An Id")],
            # `$` alone would accept a trailing newline the supervisor refuses
            "id with a trailing newline": [question("q1\n")],
            "empty text": [question(text="  ")],
            "empty impact": [question(impact="")],
            "default false": [question(options=[
                {"label": "a", "default": True},
                {"label": "b", "default": False}])],
            "unknown field": [question(extra=1)],
            "not an array": {"questions": [question()]},
            "none": [],
        }
        for why, asked in cases.items():
            with self.subTest(why=why):
                result = self.ask(asked)
                self.assert_status_block_last(result, "blocked")
                self.assertIn("QuestionInvalid", result["reason"])
                if why == "duplicate id":
                    self.assertIn("questions[1]", result["reason"])
                elif isinstance(asked, list) and asked:
                    self.assertIn("questions[0]", result["reason"])
                self.assertFalse(self.written().exists())

    def test_the_state_refusals_and_the_run_id(self):
        result = self.ask([question()], run_id=None)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("RunIdRequired", result["reason"])
        for state, name in (("awaiting-answers", "NotIntake"),
                            ("scoping", "NotIntake"),
                            ("cancelled", "EngagementClosed"),
                            ("delivered", "EngagementClosed")):
            with self.subTest(state=state):
                self.set_record(state=state)
                result = self.ask([question()])
                self.assert_status_block_last(result, "blocked")
                self.assertIn(name, result["reason"])
        result = engage.questions(self.root, "ENG-404", [question()],
                                  run_id="r")
        self.assertIn("UnknownEngagement", result["reason"])
        result = engage.questions(self.root, "nope", [question()],
                                  run_id="r")
        self.assertIn("BadEngagement", result["reason"])
        self.assertFalse(self.written().exists())

    def test_a_dry_run_writes_nothing_and_ends_partial(self):
        result = self.ask([question()], dry_run=True)
        self.assert_status_block_last(result, "partial")
        self.assertTrue(result["ok"])
        self.assertEqual(result["written"], [])
        self.assertEqual(result["questions"]["run_id"], "engagement-chat-q1")
        self.assertFalse(self.written().exists())

    def test_the_cli_writes_from_the_questions_file_and_refuses_by_name(self):
        path = Path(self._tmp.name) / "questions.json"

        def run(*argv):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = engage.main(["questions", "--directory",
                                    str(self.root), "--engagement", ENG,
                                    "--questions-file", str(path), *argv])
            return code, json.loads(out.getvalue())

        path.write_text(json.dumps([question(q) for q in "abcd"]),
                        encoding="utf-8")
        code, result = run("--run-id", "r1")
        self.assertEqual(code, 2)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("TooManyQuestions", result["reason"])
        path.write_text("{nope", encoding="utf-8")
        code, result = run("--run-id", "r1")
        self.assertEqual(code, 2)
        self.assertIn("QuestionInvalid", result["reason"])
        path.write_text(json.dumps([question()]), encoding="utf-8")
        code, result = run()
        self.assertEqual(code, 2)
        self.assertIn("RunIdRequired", result["reason"])
        code, result = run("--run-id", "r1")
        self.assertEqual(code, 0)
        self.assert_status_block_last(result, "complete")
        self.assertEqual(json.loads(self.written().read_text("utf-8"))
                         ["run_id"], "r1")



# ------------------------------------------------------- the scope (32.4)

SCOPE = """# ENG-001: Scope of Work

## Goal

Owners export the monthly reports as CSV with the date range filter.

## Deliverables

### CSV export

A **CSV** button on the reports page.

Acceptance signal: the downloaded file holds the filtered rows.

### Date range filter

The filter applies to the export.

Acceptance signal: a range of one month exports that month only.

## Exclusions

- No Excel format.
- No scheduled exports.

## What the studio needs from you

- Read access to the reports service by 2026-11-02.
- A sample export from production by 2026-11-05.

## Milestones

1. Export button: 2026-11-10.
2. Filter applied: 2026-11-17.

## Proposed epics and stories

### Epic 1: Report exports

#### Story 1.1: CSV button

As a report reader,
I want a CSV button,
So that I can share the rows.

**Acceptance Criteria:**

**Given** the reports page **When** I press CSV **Then** a file downloads.

#### Story 1.2: Filtered export

As a report reader,
I want the export to follow the date range,
So that I export only what I see.

**Acceptance Criteria:**

**Given** a range **When** I export **Then** only that range is in the file.
"""
SCOPE_TITLE = "ENG-001: Scope of Work"
SCOPE_REL = "_bmad-output/engagements/ENG-001/scope.md"
REVISE_AT = "2026-10-25T05:30:00.000Z"
FOLDERS_GET = ("GET", "confluence:/spaces/S-1/direct-children")


class FakeEngagementConfluence(FakeConfluencePublish):
    """FakeConfluencePublish whose folders keep their parent: `POST
    /folders` with a `parentId` lands a child folder, listed (with the
    pages) by `GET /folders/{id}/direct-children`."""

    def __init__(self):
        super().__init__()
        self.child_folders: dict[str, list[dict]] = {}
        self.folder_bodies: list[dict] = []

    def _confluence(self, method, path, query, body):
        if method == "POST" and path == "/folders":
            self.folder_bodies.append(dict(body))
            if body.get("parentId"):
                entry = {"id": self._id(55000), "type": "folder",
                         "title": body["title"], "parentId": body["parentId"]}
                self.child_folders.setdefault(body["parentId"], []).append(
                    entry)
                return 200, entry
        return super()._confluence(method, path, query, body)

    def _pages(self, method, path, query, body):
        m = re.match(r"^/folders/([^/]+)/direct-children$", path)
        if method == "GET" and m:
            q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
            kids = [{"id": f["id"], "type": "folder", "title": f["title"]}
                    for f in self.child_folders.get(m.group(1), [])]
            kids += [{"id": p["id"], "type": "page", "title": p["title"]}
                     for p in self.pages.values()
                     if p["parentId"] == m.group(1)]
            return self._cursor_page(path, kids, q)
        return super()._pages(method, path, query, body)


class ScopeTestCase(SetupTestCase):
    def setUp(self):
        super().setUp()
        shutil.copytree(FIXTURE, self.root, dirs_exist_ok=True)
        self.dir = self.root / "_bmad-output" / "engagements" / ENG
        self.unbound = self.config.read_text(encoding="utf-8")
        plansync.write_binding(self.root, {
            "jira": {"site": SITE},
            "confluence": {"space_key": "TKSTUDIO", "space_id": "S-1"}})
        self.fake = FakeEngagementConfluence()
        self.fake.folders["S-1"] = []
        self.sleeps: list[float] = []
        self.set_record(state="scoping")

    def record(self) -> dict:
        return json.loads((self.dir / "engagement.yaml")
                          .read_text(encoding="utf-8"))

    def set_record(self, **changes):
        record = self.record()
        record.update(changes)
        (self.dir / "engagement.yaml").write_text(
            json.dumps(record, indent=2) + "\n", encoding="utf-8")

    def scope(self, text=SCOPE, **kwargs):
        kwargs.setdefault("now", NOW)
        return engage.scope(self.root, ENG, text=text, transport=self.fake,
                            sleep=self.sleeps.append, **kwargs)

    def scope_file(self) -> Path:
        return self.dir / "scope.md"

    def assert_status_block_last(self, result: dict, status: str):
        self.assertEqual(list(result)[-4:],
                         ["status", "intent", "artifacts", "reason"])
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-engage")

    def snapshot(self) -> dict:
        """Every byte under plan/, the planning artifacts and .tk-studio/."""
        files = {}
        for rel in ("plan", "_bmad-output/planning-artifacts", ".tk-studio"):
            base = self.root / rel
            if base.is_dir():
                for path in sorted(base.rglob("*")):
                    if path.is_file():
                        files[path.relative_to(self.root).as_posix()] = \
                            path.read_bytes()
        return files


class ScopePublishTests(ScopeTestCase):
    def test_the_planner_scope_lands_in_engagements_eng_nnn_and_records_scope_page(self):
        result = self.scope()
        self.assert_status_block_last(result, "complete")
        self.assertTrue(result["ok"])
        self.assertEqual((result["mode"], result["source"], result["scope"]),
                         ("scope", "planner", SCOPE_REL))
        # the folders: a top-level `Engagements`, its child `ENG-001`
        top = [f for f in self.fake.folders["S-1"]
               if f["title"] == "Engagements"]
        self.assertEqual(len(top), 1)
        child = self.fake.child_folders[top[0]["id"]]
        self.assertEqual([f["title"] for f in child], [ENG])
        self.assertEqual(self.fake.folder_bodies[1],
                         {"spaceId": "S-1", "title": ENG,
                          "parentId": top[0]["id"]})
        # the page: titled per engagement, with the provenance footer
        page = self.fake.page(SCOPE_TITLE)
        self.assertEqual(page["parentId"], child[0]["id"])
        self.assertIn("<h2>Goal</h2>", page["body"])
        self.assertIn("<h3>CSV export</h3>", page["body"])
        self.assertRegex(page["body"], r"<p><em>Published by tk-studio from "
                         r"<code>_bmad-output/engagements/ENG-001/scope\.md"
                         r"</code> at commit <code>[^<]+</code>\. "
                         r"content-hash: sha256:[0-9a-f]{64}</em></p>$")
        # recorded: {id, url, version}, merged with `updated`
        url = f"https://{SITE}/wiki/spaces/TKSTUDIO/pages/{page['id']}"
        self.assertEqual(result["page"], {"id": page["id"], "url": url,
                                          "version": 1, "action": "created"})
        record = self.record()
        self.assertEqual(record["scope_page"], {"id": page["id"], "url": url,
                                                "version": 1})
        self.assertEqual(record["updated"], NOW)
        self.assertEqual(record["state"], "scoping")
        self.assertEqual(self.scope_file().read_text(encoding="utf-8"), SCOPE)
        self.assertEqual(result["written"], [
            SCOPE_REL, "_bmad-output/engagements/ENG-001/engagement.yaml"])
        self.assertFalse((self.dir / "scope.lock").exists())

    def test_an_unchanged_scope_is_skipped_and_a_changed_one_updated(self):
        self.scope()
        self.fake.calls.clear()
        again = self.scope()
        self.assert_status_block_last(again, "complete")
        self.assertEqual(again["page"]["action"], "skipped")
        self.assertEqual(self.fake.writes(), [])  # no PUT, no folder
        self.assertNotIn(SCOPE_REL, again["written"])  # the same text
        changed = self.scope(SCOPE.replace("monthly reports",
                                           "monthly and weekly reports"))
        self.assertEqual(changed["page"]["action"], "updated")
        self.assertEqual(changed["page"]["version"], 2)
        self.assertEqual(self.record()["scope_page"]["version"], 2)
        self.assertEqual([c for c in self.fake.writes()],
                         [("PUT", f"confluence:/pages/"
                                  f"{changed['page']['id']}")])
        self.assertIn("weekly", self.scope_file().read_text(encoding="utf-8"))
        # the folders were found by title again, never created twice
        self.assertEqual(len(self.fake.folder_bodies), 2)

    def test_an_owner_bumped_version_with_an_unchanged_footer_is_updated_not_skipped(self):
        first = self.scope()
        page = self.fake.pages[first["page"]["id"]]
        # the owner saved the page (version 2) with the footer untouched:
        # the hash still matches, but the record is at 1, so local wins
        page["version"] = 2
        self.fake.calls.clear()
        again = self.scope()
        self.assert_status_block_last(again, "complete")
        self.assertEqual(again["page"]["action"], "updated")
        self.assertEqual(again["page"]["version"], 3)
        self.assertEqual(self.record()["scope_page"]["version"], 3)
        self.assertEqual(self.fake.writes(),
                         [("PUT", f"confluence:/pages/{page['id']}")])
        # recorded and remote agree again: skipped
        self.assertEqual(self.scope()["page"]["action"], "skipped")

    def test_a_429_or_a_5xx_is_partial_retry_scope_md_kept_scope_page_unchanged(self):
        for status in (429, 503):
            with self.subTest(status=status):
                self.fake.force[FOLDERS_GET] = (status,
                                                {"message": "slow down"})
                result = self.scope()
                self.assert_status_block_last(result, "partial")
                self.assertTrue(result["ok"])
                self.assertIs(result["retry"], True)
                self.assertIsNone(self.record()["scope_page"])
                self.assertEqual(self.scope_file().read_text("utf-8"), SCOPE)
        self.assertTrue(self.sleeps)  # the 429 was retried before giving up
        del self.fake.force[FOLDERS_GET]
        self.assertEqual(self.scope()["page"]["action"], "created")

    def test_a_refused_page_write_is_publish_refused(self):
        self.fake.force[("POST", "confluence:/pages")] = (
            400, {"message": "bad request"})
        result = self.scope()
        self.assert_status_block_last(result, "blocked")
        self.assertIn("engage refused: PublishRefused: ", result["reason"])
        self.assertIsNone(self.record()["scope_page"])

    def test_a_scope_md_the_os_refuses_is_scope_unwritable(self):
        with mock.patch.object(engage, "atomic_write_text",
                               side_effect=PermissionError("denied")):
            result = self.scope()
        self.assert_status_block_last(result, "blocked")
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "engage refused: ScopeUnwritable: "
                         f"{SCOPE_REL}: PermissionError")
        self.assertNotIn(str(self.root), json.dumps(result))
        self.assertEqual(result["written"], [])
        self.assertIsNone(self.record()["scope_page"])
        self.assertFalse((self.dir / "scope.lock").exists())
        self.assertEqual(self.fake.calls, [])  # nothing published

    def test_a_record_merge_the_os_refuses_is_scope_unwritable_after_scope_md(self):
        real = engage.atomic_write_text

        def write(path, text):
            if Path(path).name == "engagement.yaml":
                raise OSError("disk full")
            return real(path, text)

        with mock.patch.object(engage, "atomic_write_text", side_effect=write):
            result = self.scope()
        self.assert_status_block_last(result, "blocked")
        self.assertEqual(result["reason"], "engage refused: ScopeUnwritable: "
                         "_bmad-output/engagements/ENG-001/engagement.yaml: "
                         "OSError")
        self.assertEqual(result["written"], [SCOPE_REL])  # honestly landed
        self.assertEqual(self.scope_file().read_text("utf-8"), SCOPE)
        self.assertIsNone(self.record()["scope_page"])

    def test_a_scope_lock_the_os_refuses_is_scope_unwritable(self):
        real = os.open

        def refuse(path, *args, **kwargs):
            if Path(path).name == "scope.lock":
                raise PermissionError("denied")
            return real(path, *args, **kwargs)

        with mock.patch.object(engage.os, "open", side_effect=refuse):
            result = self.scope()
        self.assert_status_block_last(result, "blocked")
        self.assertEqual(result["reason"], "engage refused: ScopeUnwritable: "
                         "scope.lock: PermissionError")
        self.assertEqual(result["written"], [])
        self.assertFalse(self.scope_file().exists())
        self.assertIsNone(self.record()["scope_page"])

    def test_the_proposed_epics_and_stories_are_not_plan_entities(self):
        (self.root / "plan").mkdir(exist_ok=True)
        (self.root / "plan" / "index.md").write_text("# Plan\n",
                                                     encoding="utf-8")
        before = self.snapshot()
        self.assertIn(".tk-studio/config.yaml", before)
        self.assertEqual(self.scope()["status"], "complete")
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.root / ".tk-studio" /
                          "confluence-pages.json").exists())

    def test_a_held_scope_lock_is_partial_retry_and_writes_nothing(self):
        (self.dir / "scope.lock").write_text("", encoding="utf-8")
        result = self.scope(lock_wait_s=0)
        self.assert_status_block_last(result, "partial")
        self.assertIs(result["retry"], True)
        self.assertIn("ScopeBusy", result["reason"])
        self.assertFalse(self.scope_file().exists())
        self.assertEqual(self.fake.calls, [])


class ScopeLockTests(ScopeTestCase):
    def test_the_scope_lock_is_stale_only_well_past_a_slow_publish(self):
        self.assertGreaterEqual(engage.SCOPE_LOCK_STALE_S, 600)
        lock = self.dir / "scope.lock"
        lock.write_text("someone", encoding="utf-8")
        # 60 s old: stale for chat.lock, still held for scope.lock
        old = time.time() - 60
        os.utime(lock, (old, old))
        result = self.scope(lock_wait_s=0)
        self.assertIn("ScopeBusy", result["reason"])
        self.assertEqual(lock.read_text(encoding="utf-8"), "someone")
        # past SCOPE_LOCK_STALE_S it is retaken
        old = time.time() - engage.SCOPE_LOCK_STALE_S - 5
        os.utime(lock, (old, old))
        self.assertEqual(self.scope(lock_wait_s=0)["status"], "complete")
        self.assertFalse(lock.exists())

    def test_release_never_removes_a_lock_another_holder_took_over(self):
        lock = self.dir / "scope.lock"

        def taken_over():
            # this holder ran past the stale threshold; another writer
            # retook the lock (its own token) before this one released
            lock.unlink()
            lock.write_text("the-second-holder", encoding="utf-8")
            return "done"

        self.assertEqual(engage._with_scope_lock(self.root, ENG, taken_over),
                         "done")
        self.assertEqual(lock.read_text(encoding="utf-8"),
                         "the-second-holder")
        lock.unlink()

        def held():
            self.assertTrue(lock.read_text(encoding="ascii"))  # a token
            return "own"

        self.assertEqual(engage._with_scope_lock(self.root, ENG, held), "own")
        self.assertFalse(lock.exists())


class ScopeRefusalTests(ScopeTestCase):
    def assert_refused(self, result, name):
        self.assert_status_block_last(result, "blocked")
        self.assertFalse(result["ok"])
        self.assertTrue(result["reason"].startswith(
            f"engage refused: {name}"), result["reason"])
        self.assertFalse(self.scope_file().exists())
        self.assertIsNone(self.record()["scope_page"])
        self.assertEqual(self.fake.calls, [])

    def test_a_deliverable_without_an_acceptance_signal_is_refused_by_name(self):
        text = SCOPE.replace("Acceptance signal: a range of one month "
                             "exports that month only.\n", "")
        result = self.scope(text)
        self.assert_refused(result, "DeliverableWithoutSignal")
        self.assertEqual(result["reason"], "engage refused: "
                         "DeliverableWithoutSignal: Date range filter")
        # a signal line with nothing after it is no signal
        empty = SCOPE.replace("Acceptance signal: the downloaded file holds "
                              "the filtered rows.", "Acceptance signal:")
        self.assertIn("DeliverableWithoutSignal: CSV export",
                      self.scope(empty)["reason"])

    def test_the_signal_colon_may_sit_inside_or_outside_the_bold(self):
        plain = "Acceptance signal: a range of one month exports that month only."
        self.assertIn(plain, SCOPE)
        for form in ("**Acceptance signal:** a range of one month exports.",
                     "**Acceptance signal**: a range of one month exports.",
                     "__Acceptance signal__: a range of one month exports."):
            with self.subTest(form=form):
                engage.check_scope(SCOPE.replace(plain, form))
        with self.assertRaises(engage.Refused) as caught:
            engage.check_scope(SCOPE.replace(plain, "**Acceptance signal**:"))
        self.assertEqual(caught.exception.name, "DeliverableWithoutSignal")

    def test_each_bad_shape_is_scope_invalid_naming_what(self):
        cases = {
            "missing": (SCOPE.replace("## Exclusions\n\n- No Excel format.\n"
                                      "- No scheduled exports.\n\n", ""),
                        "section '## Exclusions' is missing"),
            "empty": (SCOPE.replace("- No Excel format.\n- No scheduled "
                                    "exports.\n", ""),
                      "section '## Exclusions' is empty"),
            "out of order": (SCOPE.replace("## Exclusions", "## Tmp")
                             .replace("## Milestones", "## Exclusions")
                             .replace("## Tmp", "## Milestones"),
                             "is out of order"),
            "unknown": (SCOPE + "\n## Risks\n\nNone.\n",
                        "unknown section '## Risks'"),
            "undated": (SCOPE.replace(" by 2026-11-05", " soon"),
                        "dependency 2 has no date"),
            "no story": (SCOPE[:SCOPE.index("#### Story 1.1")],
                         "no proposed story"),
            "story shape": (SCOPE.replace("So that I can share the rows.",
                                          "Because."),
                            "'#### Story 1.1: CSV button' has no 'So that'"),
            "image": (SCOPE.replace("A **CSV** button",
                                    "![shot](shot.png) A **CSV** button"),
                      "an image (shot.png)"),
            "no deliverable": (SCOPE.replace("### CSV export", "CSV export")
                               .replace("### Date range filter", "Date"),
                               "names no deliverable"),
        }
        for why, (text, detail) in cases.items():
            with self.subTest(why=why):
                result = self.scope(text)
                self.assert_refused(result, "ScopeInvalid")
                self.assertIn(detail, result["reason"])

    def test_a_web_image_is_scope_invalid_too(self):
        for src in ("https://example.com/shot.png", "//example.com/s.png"):
            with self.subTest(src=src):
                result = self.scope(SCOPE.replace(
                    "A **CSV** button", f"![shot]({src}) A **CSV** button"))
                self.assert_refused(result, "ScopeInvalid")
                self.assertIn(f"an image ({src})", result["reason"])

    def test_a_state_that_left_scoping_before_the_lock_is_not_scoping(self):
        real = engage._with_scope_lock

        def racing(root, engagement, fn, **kwargs):
            def moved():
                self.set_record(state="quoted")
                return fn()
            return real(root, engagement, moved, **kwargs)

        with mock.patch("engage._with_scope_lock", racing):
            result = self.scope()
        self.assert_refused(result, "NotScoping")
        self.assertEqual(result["reason"], "engage refused: NotScoping: "
                         "ENG-001 is quoted; the scope is written only in "
                         "scoping")
        self.assertEqual(self.fake.writes(), [])

    def test_an_assumption_not_named_in_the_assumptions_section_is_unstated(self):
        self.set_record(assumptions=[
            {"question": "db", "text": "Which database?",
             "assumed": "postgres"},
            {"question": "scope", "text": "How big?", "assumed": "Small"}])
        result = self.scope(SCOPE + "\n## Assumptions\n\n- db: postgres "
                                    "(the default)\n")
        self.assert_refused(result, "AssumptionUnstated")
        self.assertEqual(result["reason"],
                         "engage refused: AssumptionUnstated: scope")
        self.assertIn("AssumptionUnstated: db", self.scope()["reason"])
        ok = self.scope(SCOPE + "\n## Assumptions\n\n- db: postgres\n"
                                "- scope: Small\n")
        self.assertEqual(ok["status"], "complete")

    def test_the_state_the_binding_and_the_env_are_refused_by_name(self):
        for state, name in (("intake", "NotScoping"), ("quoted", "NotScoping"),
                            ("cancelled", "EngagementClosed"),
                            ("delivered", "EngagementClosed")):
            with self.subTest(state=state):
                self.set_record(state=state)
                self.assert_refused(self.scope(), name)
        self.set_record(state="scoping")
        os.environ.pop("TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN")
        result = self.scope()
        self.assert_refused(result, "ConfluenceEnvMissing")
        self.assertIn("TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN is not set",
                      result["reason"])
        self.config.write_text(self.unbound, encoding="utf-8")
        self.assert_refused(self.scope(), "ConfluenceUnbound")
        self.assert_refused(engage.scope(self.root, "ENG-404", text=SCOPE),
                            "UnknownEngagement")

    def test_a_dry_run_checks_and_writes_nothing(self):
        result = self.scope(dry_run=True)
        self.assert_status_block_last(result, "partial")
        self.assertEqual(result["written"], [])
        self.assertFalse(self.scope_file().exists())
        self.assertEqual(self.fake.calls, [])


class ScopeReviseTests(ScopeTestCase):
    BODY = "Just the CSV button, please — no filter.\n"

    def add_revise(self, body=BODY, at=REVISE_AT):
        record = self.record()
        record["inputs"].append({"at": at, "verb": "revise",
                                 "source": "cookie",
                                 **({"payload": {"body": body}}
                                    if body is not None else {}),
                                 "from": "quoted", "to": "scoping"})
        self.set_record(inputs=record["inputs"])

    def test_a_revise_body_becomes_scope_md_verbatim_and_the_page(self):
        self.add_revise()
        result = engage.scope(self.root, ENG, revise_at=REVISE_AT,
                              transport=self.fake, now=NOW)
        self.assert_status_block_last(result, "complete")
        self.assertEqual((result["source"], result["revise_at"]),
                         ("revise", REVISE_AT))
        # not shape-checked (D9): the owner's text as written
        self.assertEqual(self.scope_file().read_text("utf-8"), self.BODY)
        page = self.fake.page(SCOPE_TITLE)
        self.assertIn("Just the CSV button", page["body"])
        self.assertEqual(self.record()["scope_page"]["id"], page["id"])
        # it replaces a planner scope wholesale
        self.scope()
        self.add_revise("Second thoughts.\n", "2026-10-25T05:40:00.000Z")
        second = engage.scope(self.root, ENG,
                              revise_at="2026-10-25T05:40:00.000Z",
                              transport=self.fake, now=NOW)
        self.assertEqual(second["page"]["action"], "updated")
        self.assertEqual(self.scope_file().read_text("utf-8"),
                         "Second thoughts.\n")

    def test_a_revise_with_no_body_or_no_line_is_revise_not_found(self):
        self.add_revise(body=None)
        for at in (REVISE_AT, "2026-10-25T09:99:00.000Z"):
            with self.subTest(at=at):
                result = engage.scope(self.root, ENG, revise_at=at,
                                      transport=self.fake)
                self.assert_status_block_last(result, "blocked")
                self.assertIn("ReviseNotFound", result["reason"])
        self.assertFalse(self.scope_file().exists())


class ScopeMemoryAndCliTests(ScopeTestCase):
    def test_the_reply_memory_carries_the_scope(self):
        self.assertIsNone(engage.reply(self.root, ENG)["scope"])
        self.scope()
        memory = engage.reply(self.root, ENG)
        self.assert_status_block_last(memory, "complete")
        self.assertEqual(memory["scope"], {"path": SCOPE_REL, "text": SCOPE})
        self.assertEqual(sorted(memory["memory"]),
                         ["confluence", "kb", "plan"])

    def test_the_cli_publishes_from_the_scope_file_and_refuses_by_name(self):
        def run(*argv):
            out = io.StringIO()
            with contextlib.redirect_stdout(out), \
                    mock.patch.object(confluence.ConfluenceClient, "_http",
                                      lambda _s, m, u, b: self.fake(m, u, b)):
                code = engage.main(["scope", "--directory", str(self.root),
                                    "--engagement", ENG, *argv])
            return code, json.loads(out.getvalue())

        # the default source: the engagement's own scope.md
        code, result = run()
        self.assertEqual(code, 2)
        self.assertIn("cannot read --scope-file", result["reason"])
        self.scope_file().write_text(SCOPE, encoding="utf-8")
        code, result = run()
        self.assertEqual(code, 0)
        self.assert_status_block_last(result, "complete")
        self.assertEqual(result["page"]["action"], "created")
        self.assertEqual(result["written"],
                         ["_bmad-output/engagements/ENG-001/engagement.yaml"])
        bad = Path(self._tmp.name) / "bad.md"
        bad.write_text(SCOPE.replace("## Milestones", "## Timeline"),
                       encoding="utf-8")
        code, result = run("--scope-file", str(bad))
        self.assertEqual(code, 2)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("ScopeInvalid", result["reason"])
        code, result = run("--revise-at", REVISE_AT)
        self.assertEqual(code, 2)
        self.assertIn("ReviseNotFound", result["reason"])



# ------------------------------------------------------- the quote (32.5)

import quote as quotelib  # noqa: E402

BANDS = """# Studio pipeline budget bands (fixture).
# operator-tunable
bands_version: 1
currency: usd
bands:
  S:
    usd_estimate: 4.5
"""


def meter_line(key, usd, tokens, project="project",
               ts="2026-10-20T00:00:00.000+00:00", route=None):
    payload = {"source": "other", "description": f"meter: story={key} "
               f"usd={usd}", "kind": "meter", "story_key": key, "usd": usd,
               "legs": {"session": {"usd": usd, "usage": {
                   "input": tokens, "output": 0, "cache_read": 0,
                   "cache_write": 0}}}}
    if route is not None:
        payload["route"] = route
    return {"ts": ts, "event": "observation", "user": "u", "machine": "m",
            "project": project, "payload": payload}


class ScopeVoidsQuoteTests(ScopeTestCase):
    """A scope rewritten in `scoping` voids a quote of the old scope in the
    same merge (`scoping + revise -> scoping` carries no `void-quote`), so
    the owner's `go` cannot pass `quote-present` at an old story count."""
    QUOTE = {"band50": {"tokens": 1, "usd": 1.0, "share": "share unknown"},
             "band85": {"tokens": 2, "usd": 2.0, "share": "share unknown"},
             "band95": {"tokens": 3, "usd": 3.0, "share": "share unknown"},
             "cap": 4.0, "basis": {"stories": 2}, "computed_at": NOW}

    def test_a_rewritten_scope_voids_the_quote_and_an_unchanged_one_keeps_it(self):
        self.scope()
        self.set_record(quote=self.QUOTE, spend={"planning_usd": 0.5})
        same = self.scope(now="2026-10-25T06:00:00.000Z")
        self.assert_status_block_last(same, "complete")
        self.assertEqual(self.record()["quote"], self.QUOTE)  # same text
        changed = self.scope(SCOPE.replace("monthly reports",
                                           "monthly and weekly reports"),
                             now="2026-10-25T07:00:00.000Z")
        self.assert_status_block_last(changed, "complete")
        record = self.record()
        self.assertIsNone(record["quote"])
        self.assertEqual(record["updated"], "2026-10-25T07:00:00.000Z")
        self.assertEqual(record["spend"], {"planning_usd": 0.5})
        self.assertEqual(record["scope_page"]["version"], 2)
        self.assertEqual(record["state"], "scoping")
        self.assertIn("scope.md replaced: the quote is voided",
                      changed["notes"])

    def test_the_quote_is_voided_before_the_publish_so_a_failed_one_keeps_it_void(self):
        self.set_record(quote=self.QUOTE)
        self.fake.force[FOLDERS_GET] = (503, {"message": "slow down"})
        result = self.scope()
        self.assert_status_block_last(result, "partial")
        self.assertIs(result["retry"], True)  # still the retryable 5xx
        self.assertEqual(result["written"], [
            "_bmad-output/engagements/ENG-001/engagement.yaml",
            "_bmad-output/engagements/ENG-001/scope.md"])
        self.assertIn("scope.md replaced: the quote is voided",
                      result["notes"])
        self.assertEqual(self.scope_file().read_text("utf-8"), SCOPE)
        record = self.record()
        self.assertIsNone(record["quote"])
        self.assertIsNone(record["scope_page"])
        # the rerun publishes; the quote stays void, the note is not repeated
        del self.fake.force[FOLDERS_GET]
        again = self.scope()
        self.assert_status_block_last(again, "complete")
        self.assertIsNone(self.record()["quote"])
        self.assertNotIn("scope.md replaced: the quote is voided",
                         again["notes"])

    def test_a_failed_void_refuses_and_leaves_scope_md_unchanged(self):
        self.scope()
        self.set_record(quote=self.QUOTE)
        before = self.record()
        real = engage.atomic_write_text

        def no_record(path, text):
            if Path(path).name == "engagement.yaml":
                raise PermissionError("denied")
            real(path, text)

        changed = SCOPE.replace("monthly reports", "weekly reports")
        with mock.patch.object(engage, "atomic_write_text", no_record):
            result = self.scope(changed)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("ScopeUnwritable: _bmad-output/engagements/ENG-001/"
                      "engagement.yaml: PermissionError", result["reason"])
        self.assertEqual(result["written"], [])
        self.assertEqual(self.scope_file().read_text("utf-8"), SCOPE)
        self.assertEqual(self.record(), before)  # quote and page kept
        self.assertFalse((self.dir / "scope.lock").exists())

    def test_an_unreadable_record_at_the_void_is_its_own_refusal(self):
        self.scope()
        self.set_record(quote=self.QUOTE)
        real = engage.read_record
        calls = []

        def unreadable_at_the_void(root, engagement):
            calls.append(engagement)
            if len(calls) == 3:  # scope(), its locked re-read, the void
                raise engage.Refused("EngagementRecordUnreadable", "x")
            return real(root, engagement)

        changed = SCOPE.replace("monthly reports", "weekly reports")
        with mock.patch.object(engage, "read_record", unreadable_at_the_void):
            result = self.scope(changed)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("EngagementRecordUnreadable", result["reason"])
        self.assertEqual(result["written"], [])
        self.assertEqual(self.scope_file().read_text("utf-8"), SCOPE)
        self.assertEqual(self.record()["quote"], self.QUOTE)

    def test_a_failed_void_of_a_page_revision_leaves_scope_md_unchanged(self):
        first = self.scope()
        self.set_record(quote=self.QUOTE)
        page = {"id": first["page"]["id"], "version": 2,
                "body": "<h2>Goal</h2><p>Owner edit.</p>"}
        real = engage.atomic_write_text

        def no_record(path, text):
            if Path(path).name == "engagement.yaml":
                raise PermissionError("denied")
            real(path, text)

        with mock.patch.object(engage, "atomic_write_text", no_record):
            out = engage.apply_page_revision(self.root, ENG, page)
        self.assertIs(out["applied"], False)
        self.assertIs(out["retry"], True)
        self.assertEqual(out["written"], [])
        self.assertEqual(self.scope_file().read_text("utf-8"), SCOPE)
        self.assertEqual(self.record()["quote"], self.QUOTE)
        self.assertEqual(self.record()["scope_page"]["version"], 1)

    def test_the_sync_back_page_revision_voids_the_quote(self):
        first = self.scope()
        self.set_record(quote=self.QUOTE)
        page = {"id": first["page"]["id"], "version": 2,
                "body": "<h2>Goal</h2><p>Owner edit.</p>"}
        out = engage.apply_page_revision(self.root, ENG, page,
                                         now="2026-10-25T08:00:00.000Z")
        self.assertIs(out["applied"], True)
        record = self.record()
        self.assertIsNone(record["quote"])
        self.assertEqual(record["scope_page"]["version"], 2)
        self.assertEqual(record["updated"], "2026-10-25T08:00:00.000Z")
        self.assertIn("Owner edit.", self.scope_file().read_text("utf-8"))
        # a revision already applied changes nothing, quote or not
        self.set_record(quote=self.QUOTE)
        again = engage.apply_page_revision(self.root, ENG, page)
        self.assertIs(again["applied"], False)
        self.assertEqual(self.record()["quote"], self.QUOTE)


    def test_a_version_bump_with_the_same_markdown_keeps_the_quote(self):
        first = self.scope()
        body = "<h2>Goal</h2><p>Owner edit.</p>"
        page = {"id": first["page"]["id"], "version": 2, "body": body}
        engage.apply_page_revision(self.root, ENG, page)
        self.set_record(quote=self.QUOTE)
        same = dict(page, version=3)  # a re-save: the Markdown is unchanged
        before = self.scope_file().read_bytes()
        out = engage.apply_page_revision(self.root, ENG, same,
                                         now="2026-10-25T09:00:00.000Z")
        self.assertIs(out["applied"], True)
        self.assertEqual(out["written"], [
            "_bmad-output/engagements/ENG-001/engagement.yaml"])
        record = self.record()
        self.assertEqual(record["quote"], self.QUOTE)
        self.assertEqual(record["scope_page"]["version"], 3)
        self.assertEqual(record["updated"], "2026-10-25T09:00:00.000Z")
        self.assertEqual(self.scope_file().read_bytes(), before)

    def test_a_write_failing_after_the_void_names_the_void_in_written(self):
        record_rel = "_bmad-output/engagements/ENG-001/engagement.yaml"
        for fail_at, landed in (("scope.md", [record_rel]),
                                ("version", [record_rel, SCOPE_REL])):
            with self.subTest(fail_at=fail_at):
                first = self.scope()
                self.set_record(quote=self.QUOTE)
                version = self.record()["scope_page"]["version"]
                page = {"id": first["page"]["id"], "version": version + 1,
                        "body": f"<h2>Goal</h2><p>Edit {fail_at}.</p>"}
                real = engage.atomic_write_text
                record_writes = []

                def failing(path, text):
                    name = Path(path).name
                    if name == "engagement.yaml":
                        record_writes.append(path)
                        if fail_at == "version" and len(record_writes) == 2:
                            raise PermissionError("denied")
                    elif name == "scope.md" and fail_at == "scope.md":
                        raise PermissionError("denied")
                    real(path, text)

                with mock.patch.object(engage, "atomic_write_text", failing):
                    out = engage.apply_page_revision(self.root, ENG, page)
                self.assertIs(out["applied"], False)
                self.assertIs(out["retry"], True)
                self.assertEqual(out["written"], landed)
                record = self.record()
                self.assertIsNone(record["quote"])  # the void landed
                self.assertEqual(record["scope_page"]["version"], version)
                self.assertEqual(self.scope_file().read_text("utf-8") == SCOPE,
                                 fail_at == "scope.md")

    def add_revise(self, body, at):
        record = self.record()
        record["inputs"].append({"at": at, "verb": "revise",
                                 "source": "cookie",
                                 "payload": {"body": body},
                                 "from": "quoted", "to": "scoping"})
        self.set_record(inputs=record["inputs"])

    def test_the_revise_pass_voids_the_quote_and_an_unchanged_one_keeps_it(self):
        self.scope()
        self.set_record(quote=self.QUOTE)
        self.add_revise("Just the CSV button, please.\n", REVISE_AT)
        result = engage.scope(self.root, ENG, revise_at=REVISE_AT,
                              transport=self.fake, now=NOW)
        self.assert_status_block_last(result, "complete")
        self.assertEqual(result["source"], "revise")
        record = self.record()
        self.assertIsNone(record["quote"])
        self.assertEqual(record["state"], "scoping")
        self.assertIn("scope.md replaced: the quote is voided",
                      result["notes"])
        self.assertEqual(self.scope_file().read_text("utf-8"),
                         "Just the CSV button, please.\n")
        # a revise body equal to scope.md replaces nothing: the quote stays
        self.set_record(quote=self.QUOTE)
        again_at = "2026-10-25T05:45:00.000Z"
        self.add_revise("Just the CSV button, please.\n", again_at)
        again = engage.scope(self.root, ENG, revise_at=again_at,
                             transport=self.fake, now=NOW)
        self.assert_status_block_last(again, "complete")
        record = self.record()
        self.assertEqual(record["quote"], self.QUOTE)
        self.assertEqual(record["state"], "scoping")
        self.assertNotIn(SCOPE_REL, again["written"])


class QuoteTestCase(EngageTestCase):
    def setUp(self):
        super().setUp()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        self.home = Path(self._tmp.name) / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.home)
        self.set_record(state="scoping")
        (self.dir / "scope.md").write_text(SCOPE, encoding="utf-8")
        (self.root / ".tk-studio").mkdir()
        (self.root / ".tk-studio" / "plan-counter.yaml").write_text(
            "counter_version: 1\nnext:\n  epic: 33\n  story: 130\n"
            "  task: 1\n", encoding="utf-8")
        self.bands = self.root / ".tk-studio" / "budget-bands.yaml"
        self.bands.write_text(BANDS, encoding="utf-8")

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        super().tearDown()

    def history(self, k, **kwargs):
        lines = [meter_line(f"9-{i + 1}-s", round(2.0 + i, 2),
                            100_000 * (i + 1), **kwargs) for i in range(k)]
        path = self.home / "measurements" / "u-m.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            for line in lines:
                handle.write(json.dumps(line) + "\n")
        return lines

    def record(self) -> dict:
        return json.loads((self.dir / "engagement.yaml")
                          .read_text(encoding="utf-8"))

    def quote(self, **kwargs):
        kwargs.setdefault("now", NOW)
        return engage.quote(self.root, ENG, **kwargs)

    def files(self) -> dict:
        return {"record": (self.dir / "engagement.yaml").read_bytes(),
                "bands": self.bands.read_bytes()}


class QuoteVerbTests(QuoteTestCase):
    def test_a_rich_history_lands_the_quote_and_the_bands(self):
        self.history(8)
        result = self.quote()
        self.assert_status_block_last(result, "complete")
        self.assertEqual(result["written"], [
            "_bmad-output/engagements/ENG-001/engagement.yaml",
            ".tk-studio/budget-bands.yaml"])
        record = self.record()
        self.assertEqual(record["state"], "scoping")  # the owner's go moves it
        self.assertEqual(record["updated"], NOW)
        q = record["quote"]
        self.assertEqual(sorted(q), ["band50", "band85", "band95", "basis",
                                     "cap", "computed_at"])
        self.assertEqual(q, result["quote"])
        self.assertEqual(q["computed_at"], NOW)
        seed = quotelib.default_seed(ENG, 2)
        self.assertLess(seed, 2 ** 53)  # exact through the JSON rewrite
        samples = [{"story_key": f"9-{i + 1}-s", "tokens": 100_000 * (i + 1),
                    "usd": 2.0 + i, "route": None} for i in range(8)]
        want = quotelib.compute(samples, 2, [{"k": 1, "stories": 2}], seed,
                                None)
        for band in ("band50", "band85", "band95"):
            self.assertEqual(q[band], want[band])
        self.assertIsInstance(q["cap"], float)
        self.assertEqual(q["cap"], want["cap"])
        basis = q["basis"]
        self.assertEqual(basis["method"], "bootstrap")
        self.assertEqual(basis["resamples"], 10000)
        self.assertEqual(basis["seed"], seed)
        self.assertEqual(basis["stories"], 2)
        self.assertEqual(basis["epics"], [{"k": 1, "title": "Report exports",
                                           "stories": 2,
                                           "ep_id": "EP-033"}])
        self.assertEqual(basis["history"], {"n": 8, "unstructured": 0,
                                            "project": "project"})
        self.assertEqual(basis["kind"], "story")
        self.assertFalse(basis["thin"])
        self.assertNotIn("widen", basis)
        self.assertEqual(basis["at_cap"], "the run pauses partial, the "
                         "engagement's issue blocks with the figures, the "
                         "owner decides")
        self.assertEqual(basis["autonomy"], ["ask", "steady", "full"])
        self.assertEqual((basis["planning_usd"], basis["scoping_billable"]),
                         (0, False))
        self.assertEqual(basis["prices_date"],
                         json.loads(Path(engage.__file__).with_name(
                             "prices.json").read_text())["date"])
        self.assertIsNone(basis["window_tokens"])
        self.assertEqual(basis["cap_tokens"], want["cap_tokens"])
        self.assertEqual(q["band50"]["share"], "share unknown")
        # the bands: every byte before epics kept, EP-033 from the p85
        text = self.bands.read_text(encoding="utf-8")
        self.assertTrue(text.startswith(BANDS))
        self.assertEqual(text[len(BANDS):], "epics:\n  EP-033:\n    "
                         f"usd_estimate: {want['epic_usd'][1]}\n")

    def test_seeded_rerun_is_identical_and_another_seed_differs(self):
        path = self.home / "measurements" / "u-m.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(meter_line(
            f"9-{i}-s", round(1 + (i * 7.31) % 13, 2), 10_007 * (i * i + 3)))
            + "\n" for i in range(12)), encoding="utf-8")
        a = self.quote(dry_run=True)["quote"]
        b = self.quote(dry_run=True)["quote"]
        self.assertEqual(a, b)
        c = self.quote(dry_run=True, seed=99)["quote"]
        self.assertEqual(c["basis"]["seed"], 99)
        self.assertNotEqual((a["band50"], a["band95"]),
                            (c["band50"], c["band95"]))

    def test_thin_history_widens_and_names_the_prior(self):
        result = self.quote()
        self.assert_status_block_last(result, "complete")
        q = self.record()["quote"]
        self.assertTrue(q["basis"]["thin"])
        self.assertEqual(q["basis"]["widen"], 1.5)
        self.assertEqual(q["basis"]["prior"], "kb/trial-record-opus-5-5.md")
        self.assertEqual(q["basis"]["history"]["n"], 0)
        self.assertIsNone(q["band85"]["tokens"])
        self.assertIsNone(q["band85"]["share"])
        self.assertGreater(q["band85"]["usd"], 0)
        self.assertIn("thin history: 0 landed stories", result["notes"])
        self.assertIn("tokens unknown: thin history (no metered story)",
                      result["notes"])

    def test_the_share_over_the_user_config_window(self):
        self.history(8)
        self.home.mkdir(parents=True, exist_ok=True)
        (self.home / "config.yaml").write_text(
            "plan:\n  window_tokens: 1000000\n", encoding="utf-8")
        q = self.quote(dry_run=True)["quote"]
        self.assertEqual(q["basis"]["window_tokens"], 1_000_000)
        self.assertEqual(q["band50"]["share"],
                         round(q["band50"]["tokens"] / 1_000_000, 4))
        for bad in ("0", "lots", "true"):
            (self.home / "config.yaml").write_text(
                f"plan:\n  window_tokens: {bad}\n", encoding="utf-8")
            q = self.quote(dry_run=True)["quote"]
            self.assertEqual(q["band50"]["share"], "share unknown", bad)
            self.assertIsNone(q["basis"]["window_tokens"])

    def test_the_project_filter_and_unstructured_history(self):
        self.history(3, project="someone-else")
        path = self.home / "measurements" / "u-m.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "ts": "t", "event": "observation", "project": "project",
                "payload": {"source": "other",
                            "description": "meter: story=1-1 usd=3.0"}})
                + "\n")
        basis = self.quote(dry_run=True)["quote"]["basis"]
        self.assertEqual(basis["history"], {"n": 0, "unstructured": 1,
                                            "project": "project"})

    def test_the_merge_is_a_fresh_read_of_quote_and_updated_only(self):
        self.history(8)
        real = quotelib.compute

        def concurrent(*args, **kwargs):
            # the supervisor's chatSpendPass lands while the quote computes
            record = self.record()
            record["spend"] = {"planning_usd": 1.75, "runs_usd": 0}
            (self.dir / "engagement.yaml").write_text(
                json.dumps(record, indent=2) + "\n", encoding="utf-8")
            return real(*args, **kwargs)

        with mock.patch.object(quotelib, "compute", concurrent):
            result = self.quote()
        self.assert_status_block_last(result, "complete")
        record = self.record()
        self.assertEqual(record["spend"]["planning_usd"], 1.75)
        self.assertIsNotNone(record["quote"])
        self.assertEqual(record["state"], "scoping")
        # the basis agrees with the spend it was merged beside
        self.assertEqual((record["quote"]["basis"]["planning_usd"],
                          record["quote"]["basis"]["scoping_billable"]),
                         (1.75, True))
        self.assertEqual(result["quote"], record["quote"])

    def test_the_quote_prices_the_scope_on_disk_under_scope_lock(self):
        self.history(8)
        real = quotelib.compute
        raced = []

        def concurrent(*args, **kwargs):
            # a `scope --revise-at` or the sync-back tries to replace
            # scope.md while the quote computes: scope.lock is held
            def rewrite():
                (self.dir / "scope.md").write_text(
                    SCOPE + "\n### Epic 2: More\n\n#### Story 2.1: One\n"
                    "\ntext\n", encoding="utf-8")
            try:
                engage._with_scope_lock(self.root, ENG, rewrite, wait_s=0)
            except engage.Refused as exc:
                raced.append(exc.name)
            return real(*args, **kwargs)

        with mock.patch.object(quotelib, "compute", concurrent):
            result = self.quote()
        self.assert_status_block_last(result, "complete")
        self.assertEqual(raced, ["ScopeBusy"])
        on_disk = engage.scope_counts(
            (self.dir / "scope.md").read_text(encoding="utf-8"))
        self.assertEqual(self.record()["quote"]["basis"]["stories"],
                         on_disk["stories"])
        self.assertEqual(on_disk["stories"], 2)
        self.assertFalse((self.dir / "scope.lock").exists())

    def test_a_sample_route_keeps_only_string_models(self):
        self.history(2, route={"session": 7, "review": "claude-opus-5-5"})
        result = self.quote(dry_run=True)
        self.assert_status_block_last(result, "partial")
        self.assertEqual(result["quote"]["basis"]["route"],
                         {"review": "claude-opus-5-5"})
        self.history(1, route={"session": ["x"]})
        result = self.quote(dry_run=True)
        self.assert_status_block_last(result, "partial")
        self.assertIsNone(result["quote"]["basis"]["route"])

    def test_scoping_billable_from_the_planning_spend(self):
        self.set_record(state="scoping",
                        spend={"planning_usd": 0.42, "runs_usd": 0})
        basis = self.quote(dry_run=True)["quote"]["basis"]
        self.assertEqual((basis["planning_usd"], basis["scoping_billable"]),
                         (0.42, True))

    def test_a_voided_quote_is_requoted_and_the_memory_shows_it(self):
        # a `revise` from quoted voided it (32.1): back in scoping, null
        self.set_record(state="scoping", quote=None)
        self.assertIsNone(engage.reply(self.root, ENG)["record"]["quote"])
        result = self.quote()
        self.assert_status_block_last(result, "complete")
        memory = engage.reply(self.root, ENG)
        self.assertEqual(memory["record"]["quote"], result["quote"])

    def test_another_epics_entry_is_kept_and_this_one_overwritten(self):
        self.bands.write_text(BANDS + "epics:\n  EP-010:\n    usd_estimate: "
                              "7.5\n  EP-033:\n    usd_estimate: 1.0\n",
                              encoding="utf-8")
        self.quote()
        text = self.bands.read_text(encoding="utf-8")
        self.assertTrue(text.startswith(BANDS))
        import miniyaml
        epics = miniyaml.loads(text)["epics"]
        self.assertEqual(epics["EP-010"], {"usd_estimate": 7.5})
        self.assertNotEqual(epics["EP-033"]["usd_estimate"], 1.0)

    def test_the_dry_run_writes_nothing(self):
        before = self.files()
        result = self.quote(dry_run=True)
        self.assert_status_block_last(result, "partial")
        self.assertEqual(result["written"], [])
        self.assertIsNotNone(result["quote"])
        self.assertEqual(self.files(), before)


class QuoteRefusalTests(QuoteTestCase):
    def assert_refused(self, name, **kwargs):
        before = self.files()
        result = self.quote(**kwargs)
        self.assert_status_block_last(result, "blocked")
        self.assertFalse(result["ok"])
        self.assertIn(f"{name}:", result["reason"])
        self.assertEqual(result["written"], [])
        self.assertEqual(self.files(), before)
        return result

    def test_each_named_refusal_writes_nothing(self):
        record = self.dir / "engagement.yaml"
        text = record.read_text(encoding="utf-8")
        record.write_text("state: scoping\n", encoding="utf-8")
        self.assert_refused("EngagementRecordUnreadable")
        record.write_text(text, encoding="utf-8")
        for state in ("delivered", "failed", "cancelled"):
            self.set_record(state=state)
            self.assert_refused("EngagementClosed")
        for state in ("intake", "quoted", "approved"):
            self.set_record(state=state)
            self.assert_refused("NotScoping")
        self.set_record(state="scoping")
        (self.dir / "scope.md").write_text(
            SCOPE.split("### Epic 1")[0], encoding="utf-8")
        self.assert_refused("NoScope")
        (self.dir / "scope.md").unlink()
        self.assert_refused("NoScope")
        (self.dir / "scope.md").write_text(SCOPE, encoding="utf-8")
        bad = Path(self._tmp.name) / "prices.json"
        bad.write_text("{nope", encoding="utf-8")
        self.assert_refused("PricesUnreadable", prices_path=bad)
        self.history(2, route={"session": "claude-unpriced-9"})
        self.assert_refused("PricesUnreadable")

    def test_a_repeated_epic_number_is_no_scope_naming_it(self):
        (self.dir / "scope.md").write_text(
            SCOPE + "\n### Epic 1: Again\n\n#### Story 1.1: Twice\n\ntext\n",
            encoding="utf-8")
        result = self.assert_refused("NoScope")
        self.assertIn("repeats epic ### Epic 1", result["reason"])

    def test_epics_not_numbered_one_to_m_are_no_scope(self):
        # an `### Epic 0` would key to EP-032 (a live epic) and overwrite
        # its band; 1 and 3 would key to a gap
        zero = SCOPE.replace("### Epic 1:", "### Epic 0:").replace(
            "#### Story 1.", "#### Story 0.")
        self.assertIn("### Epic 0:", zero)
        (self.dir / "scope.md").write_text(zero, encoding="utf-8")
        result = self.assert_refused("NoScope")
        self.assertIn("numbers its epics ### Epic 0", result["reason"])
        self.assertIn("numbered 1 to 1 in order", result["reason"])
        (self.dir / "scope.md").write_text(
            SCOPE + "\n### Epic 3: Later\n\n#### Story 3.1: Gap\n\ntext\n",
            encoding="utf-8")
        result = self.assert_refused("NoScope")
        self.assertIn("### Epic 1, ### Epic 3", result["reason"])
        self.assertIn("numbered 1 to 2 in order", result["reason"])
        self.assert_refused("NoScope", dry_run=True)

    def test_a_held_scope_lock_is_quote_unwritable_and_writes_nothing(self):
        self.history(8)
        (self.dir / "scope.lock").write_text("other", encoding="utf-8")
        result = self.assert_refused("QuoteUnwritable", lock_wait_s=0)
        self.assertIn("_bmad-output/engagements/ENG-001/scope.lock is held",
                      result["reason"])
        self.assertIsNone(self.record().get("quote"))
        self.assertEqual((self.dir / "scope.lock").read_text("utf-8"),
                         "other")  # never removed by the refused quote

    def test_an_os_refusal_is_quote_unwritable(self):
        before = self.files()
        with mock.patch.object(engage, "atomic_write_text",
                               side_effect=PermissionError("denied")):
            result = self.quote()
        self.assert_status_block_last(result, "blocked")
        self.assertIn("QuoteUnwritable:", result["reason"])
        self.assertEqual(result["written"], [])
        self.assertEqual(self.files(), before)

    def test_bands_refused_after_the_record_names_the_record(self):
        real = engage.atomic_write_text

        def only_record(path, text):
            if Path(path).name == "budget-bands.yaml":
                raise PermissionError("denied")
            real(path, text)

        with mock.patch.object(engage, "atomic_write_text", only_record):
            result = self.quote()
        self.assert_status_block_last(result, "blocked")
        self.assertIn("QuoteUnwritable: .tk-studio/budget-bands.yaml",
                      result["reason"])
        self.assertEqual(result["written"], [
            "_bmad-output/engagements/ENG-001/engagement.yaml"])
        self.assertEqual(self.bands.read_text(encoding="utf-8"), BANDS)


    def test_a_scalar_epics_in_the_bands_is_quote_unwritable(self):
        self.history(8)
        self.bands.write_text(BANDS + 'epics: ""\n', encoding="utf-8")
        before = self.files()
        result = self.quote()
        self.assert_status_block_last(result, "blocked")
        self.assertIn("QuoteUnwritable: .tk-studio/budget-bands.yaml's "
                      "top-level epics is", result["reason"])
        self.assertEqual(result["written"], [])
        self.assertEqual(self.files(), before)  # nothing written

class QuoteCliTests(QuoteTestCase):
    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = engage.main(["quote", "--directory", str(self.root),
                                "--engagement", ENG, *argv])
        return code, json.loads(out.getvalue())

    def test_the_cli_quotes_with_a_seed_and_refuses_by_name(self):
        code, result = self.run_cli("--seed", "5", "--dry-run")
        self.assertEqual(code, 0)
        self.assert_status_block_last(result, "partial")
        self.assertEqual(result["quote"]["basis"]["seed"], 5)
        code, result = self.run_cli()
        self.assertEqual(code, 0)
        self.assert_status_block_last(result, "complete")
        self.assertIsNotNone(self.record()["quote"])
        self.set_record(state="quoted")
        code, result = self.run_cli()
        self.assertEqual(code, 2)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("NotScoping", result["reason"])

    def test_a_seed_outside_the_json_exact_range_refuses(self):
        before = self.files()
        for bad in ("-1", str(2 ** 53), str(2 ** 64)):
            code, result = self.run_cli("--seed", bad)
            self.assertEqual(code, 2, bad)
            self.assert_status_block_last(result, "blocked")
            self.assertIn("BadSeed", result["reason"])
            self.assertEqual(result["written"], [])
            self.assertIsNone(result["quote"])
        self.assertEqual(self.files(), before)  # nothing written
        code, result = self.run_cli("--seed", str(2 ** 53 - 1), "--dry-run")
        self.assertEqual(code, 0)
        self.assertEqual(result["quote"]["basis"]["seed"], 2 ** 53 - 1)

    def test_scope_counts_from_the_headings(self):
        counts = engage.scope_counts(SCOPE)
        self.assertEqual(counts, {"epics": [{"k": 1,
                                             "title": "Report exports",
                                             "stories": 2}],
                                  "stories": 2})
        two = SCOPE + ("\n### Epic 2: Later\n\n#### Story 2.1: One\n\n"
                       "text\n")
        self.assertEqual(engage.scope_counts(two)["stories"], 3)
        self.assertEqual(engage.scope_counts("# nothing\n"),
                         {"epics": [], "stories": 0})


# ------------------------------------------------------- the closeout (32.8)

CLOSEOUT_REL = "_bmad-output/engagements/ENG-001/closeout.md"
RECORD_REL = "_bmad-output/engagements/ENG-001/engagement.yaml"
PR_1 = "https://github.com/acme/widget/pull/7"
PR_2 = "https://github.com/acme/widget/pull/8"
CLOSEOUT_QUOTE = {"band50": {"tokens": 1, "usd": 3.0, "share": "x"},
                  "band85": {"tokens": 2, "usd": 5.0, "share": "x"},
                  "band95": {"tokens": 3, "usd": 8.0, "share": "x"},
                  "cap": 10.0, "basis": {"stories": 2}, "computed_at": NOW}


def closeout_input(**changes) -> dict:
    """The supervisor's composition (Settled shape 2): Epic 1 queued as
    run-epic-41, both stories landed and merged, one cap side exit."""
    data = {
        "run_id": "q-2", "outcome_hint": "partial",
        "runs": [{"run_id": "q-1", "job": "run-epic-41", "state": "partial",
                  "studio_run_id": "s-1", "cost_usd": 2.5, "pr": PR_1},
                 {"run_id": "q-2", "job": "run-epic-41", "state": "complete",
                  "studio_run_id": "s-2", "cost_usd": None, "pr": PR_2}],
        "stories": [{"key": "41-1-csv-button", "run_id": "q-1",
                     "spec_status": "done", "pr": PR_1,
                     "pr_state": "MERGED"},
                    {"key": "41-2-filtered-export", "run_id": "q-2",
                     "spec_status": "done", "pr": PR_2,
                     "pr_state": "MERGED"}],
        "epics": [{"job": "run-epic-41", "queued": True}],
        "side_exits": [{"at": "2026-10-25T07:00:00.000Z", "to": "partial",
                        "verb": "cap", "reason": "cap"}],
        "spend": {"planning_usd": 0.5, "runs_usd": 4.0},
        "quote": CLOSEOUT_QUOTE,
    }
    data.update(changes)
    return data


def story(key, run="q-2", status="done", pr=PR_2, state="MERGED") -> dict:
    return {"key": key, "run_id": run, "spec_status": status, "pr": pr,
            "pr_state": state}


class CloseoutTestCase(ScopeTestCase):
    def setUp(self):
        super().setUp()
        self.scope_file().write_text(SCOPE, encoding="utf-8")
        self.set_record(state="in-progress", quote=CLOSEOUT_QUOTE,
                        spend={"planning_usd": 0.5, "runs_usd": 4.0})
        self.measurements = Path(self._tmp.name) / "measurements"
        self.measurements.mkdir()

    def closeout(self, data=None, **kwargs):
        kwargs.setdefault("now", NOW)
        kwargs.setdefault("measurements", self.measurements)
        return engage.closeout(self.root, ENG, closeout_input()
                               if data is None else data,
                               transport=self.fake, sleep=self.sleeps.append,
                               **kwargs)

    def report(self) -> str:
        return (self.dir / "closeout.md").read_text(encoding="utf-8")


class CloseoutRenderTests(CloseoutTestCase):
    def test_every_section_written_published_beside_the_scope_and_merged(self):
        self.set_record(state="scoping")
        self.scope()  # the scope's page: the folder the closeout joins
        self.set_record(state="in-progress")
        with (self.measurements / "u-m.jsonl").open("w") as handle:
            handle.write(json.dumps(meter_line("41-1-csv-button", 1.25,
                                               120_000,
                                               project="tk-studio")) + "\n")
        result = self.closeout()
        self.assert_status_block_last(result, "complete")
        self.assertEqual((result["mode"], result["outcome"]),
                         ("closeout", "delivered"))
        text = self.report()
        sections = [line[3:] for line in text.split("\n")
                    if line.startswith("## ")]
        self.assertEqual(sections, ["Outcome", "Deliverables",
                                    "Pull requests", "Cost per story",
                                    "Spend", "Quote against actual",
                                    "Side exits"])
        for phrase in ("- Outcome: delivered", "### CSV export",
                       "Acceptance signal: the downloaded file holds the "
                       "filtered rows.", "Verdict: done",
                       f"- {PR_1} (MERGED)", f"- {PR_2} (MERGED)",
                       "| story | run | tokens | usd |",
                       "| 41-1-csv-button | q-1 | 120000 | $1.25 |",
                       "| 41-2-filtered-export | q-2 | — | — |",
                       "| q-1 | run-epic-41 | partial | $2.50 |",
                       "| q-2 | run-epic-41 | complete | — |",
                       "- planning_usd: $0.50", "- runs_usd: $4.00",
                       "- total: $4.50", "- band50: $3.00",
                       "- band85: $5.00", "- band95: $8.00",
                       "- cap: $10.00", "- actual (runs_usd): $4.00",
                       "- band hit: within band85",
                       "- cap hit: under the cap",
                       "- 2026-10-25T07:00:00.000Z: cap → partial — cap"):
            self.assertIn(phrase, text)
        # the page: `ENG-001: Closeout` in the scope's ENG-001 folder
        scope_page = self.fake.page(SCOPE_TITLE)
        page = self.fake.page("ENG-001: Closeout")
        self.assertEqual(page["parentId"], scope_page["parentId"])
        self.assertIn("<h2>Cost per story</h2>", page["body"])
        self.assertIn(f"<code>{CLOSEOUT_REL}</code>", page["body"])
        url = f"https://{SITE}/wiki/spaces/TKSTUDIO/pages/{page['id']}"
        self.assertEqual(result["page"], {"id": page["id"], "url": url,
                                          "version": 1, "action": "created"})
        record = self.record()
        self.assertEqual(record["closeout"], {
            "path": CLOSEOUT_REL,
            "page": {"id": page["id"], "url": url, "version": 1},
            "outcome": "delivered", "done": 2, "not_done": 0,
            "run_id": "q-2", "at": NOW})
        # run-ended is the supervisor's: the state does not move here
        self.assertEqual(record["state"], "in-progress")
        self.assertEqual(result["written"], [CLOSEOUT_REL, RECORD_REL])

    def quote_section(self) -> list:
        text = self.report()
        start = text.index("## Quote against actual")
        return text[start:text.index("## Side exits")].split("\n")

    def test_quote_against_actual_compares_runs_usd_alone(self):
        # planning pushes the total past band85; the bands and the cap are
        # priced from story runs and the cap meters runs_usd: runs_usd alone
        # is compared, planning and the total still printed
        self.closeout(closeout_input(spend={"planning_usd": 1.5,
                                            "runs_usd": 4.0}))
        lines = self.quote_section()
        for phrase in ("- actual (runs_usd): $4.00", "- planning_usd: $1.50",
                       "- total: $5.50", "- band hit: within band85",
                       "- cap hit: under the cap"):
            self.assertIn(phrase, lines)
        # runs_usd at the cap (the supervisor caps at runs_usd >= cap), a
        # total over it is not what decides
        self.closeout(closeout_input(spend={"planning_usd": 0.0,
                                            "runs_usd": 10.0}))
        lines = self.quote_section()
        self.assertIn("- band hit: at or over the cap", lines)
        self.assertIn("- cap hit: at or over the cap", lines)
        self.closeout(closeout_input(spend={"planning_usd": 5.0,
                                            "runs_usd": 9.0}))
        lines = self.quote_section()
        self.assertIn("- band hit: within the cap", lines)
        self.assertIn("- cap hit: under the cap", lines)
        self.assertIn("- total: $14.00", lines)

    def test_an_unchanged_report_skips_the_page_and_a_repeat_replaces_it(self):
        self.closeout()
        self.fake.calls.clear()
        again = self.closeout()
        self.assertEqual(again["page"]["action"], "skipped")
        self.assertEqual(self.fake.writes(), [])
        self.assertNotIn(CLOSEOUT_REL, again["written"])
        # a new last run after go {cap}: a new report replaces file and page
        self.set_record(state="partial")
        third = self.closeout(closeout_input(run_id="q-3"))
        self.assertEqual(third["page"]["action"], "updated")
        self.assertEqual(third["page"]["version"], 2)
        self.assertIn("- Last run: q-3", self.report())
        self.assertEqual(self.record()["closeout"]["run_id"], "q-3")

    def test_no_confluence_binding_writes_the_file_with_page_null(self):
        self.config.write_text(self.unbound, encoding="utf-8")
        result = self.closeout()
        self.assert_status_block_last(result, "complete")
        self.assertIsNone(result["page"])
        self.assertTrue(any(n.startswith("ConfluenceUnbound")
                            for n in result["notes"]))
        self.assertEqual(self.fake.calls, [])
        self.assertIn("## Outcome", self.report())
        self.assertIsNone(self.record()["closeout"]["page"])

    def test_the_record_merge_keeps_every_other_field(self):
        before = self.record()
        self.closeout()
        after = self.record()
        self.assertEqual(list(after), list(before))
        self.assertEqual({k: v for k, v in after.items() if k != "closeout"},
                         {k: v for k, v in before.items() if k != "closeout"})

    def test_a_transient_publish_ends_partial_with_retry_and_no_merge(self):
        with mock.patch.object(engage, "_publish_scope",
                               side_effect=engage._Transient("HTTP 503")):
            result = self.closeout()
        self.assert_status_block_last(result, "partial")
        self.assertTrue(result["retry"])
        self.assertIsNone(self.record().get("closeout"))
        self.assertEqual(result["written"], [CLOSEOUT_REL])

    def test_a_dry_run_writes_nothing(self):
        result = self.closeout(dry_run=True)
        self.assert_status_block_last(result, "partial")
        self.assertEqual(result["outcome"], "delivered")
        self.assertFalse((self.dir / "closeout.md").exists())
        self.assertEqual(self.fake.calls, [])


class CloseoutVerdictTests(unittest.TestCase):
    def verdicts(self, text=SCOPE, **changes):
        return engage.closeout_verdicts(text, closeout_input(**changes))

    def test_the_why_in_order(self):
        no_signal = SCOPE.replace("Acceptance signal: the downloaded file "
                                  "holds the filtered rows.", "")
        v = self.verdicts(no_signal, epics=[{"job": "run-epic-41",
                                             "queued": False}])
        self.assertEqual(v[0]["why"], "no acceptance signal")
        self.assertEqual(v[1]["why"], "epic not run")
        v = self.verdicts(stories=[story("41-1-csv-button", status="in-review",
                                         state="OPEN")])
        self.assertEqual(v[0]["why"], "story 41-1-csv-button not landed")
        v = self.verdicts(stories=[story("41-1-csv-button")])
        self.assertEqual(v[0]["why"], "story 41-2 not landed")
        # no spec read (no worktree, no run branch ref): not landed
        v = self.verdicts(stories=[story("41-1-csv-button", status=None)])
        self.assertEqual(v[0]["why"], "story 41-1-csv-button not landed")
        v = self.verdicts(stories=[story("41-1-csv-button", state="OPEN"),
                                   story("41-2-filtered-export")])
        self.assertEqual(v[0]["why"], f"PR {PR_2} not merged")
        self.assertFalse(v[0]["done"])
        v = self.verdicts()
        self.assertEqual([x["done"] for x in v], [True, True])
        self.assertEqual(engage.closeout_outcome(v, closeout_input()),
                         "delivered")

    def test_a_deliverable_takes_the_stories_naming_it(self):
        named = SCOPE.replace("#### Story 1.1: CSV button",
                              "#### Story 1.1: CSV export button")
        v = self.verdicts(named, stories=[story("41-1-csv-button")])
        self.assertEqual(v[0]["stories"], ["41-1-csv-button"])
        self.assertTrue(v[0]["done"])
        self.assertEqual(v[1]["stories"], ["41-1-csv-button", "41-2"])
        self.assertEqual(v[1]["why"], "story 41-2 not landed")

    def test_the_outcome_failed_for_a_blocked_last_run_else_partial(self):
        runs = [{"run_id": "q-2", "job": "run-epic-41", "state": "blocked"}]
        v = self.verdicts(stories=[], runs=runs)
        self.assertEqual(engage.closeout_outcome(v, closeout_input(
            stories=[], runs=runs)), "failed")
        runs[0]["state"] = "cancelled"
        self.assertEqual(engage.closeout_outcome(v, closeout_input(
            stories=[], runs=runs)), "partial")

    def test_the_signal_fallback_and_no_signal_never_crash(self):
        text = SCOPE.replace("Acceptance signal: the downloaded file holds the "
                             "filtered rows.",
                             "> **ACCEPTANCE SIGNAL** — the file opens")
        v = self.verdicts(text)
        self.assertEqual(v[0]["signal"], "the file opens")
        self.assertTrue(v[0]["done"])
        bare = "# s\n\n## Deliverables\n\n### Thing\n\nNo signal here.\n"
        v = self.verdicts(bare)
        self.assertEqual((v[0]["signal"], v[0]["why"]),
                         (None, "no acceptance signal"))
        self.assertEqual(self.verdicts("no headings at all\n"), [])
        self.assertEqual(engage.closeout_outcome([], closeout_input()),
                         "partial")

    def test_an_unqueued_epic_reads_epic_not_run(self):
        two = SCOPE + ("\n### Epic 2: Later\n\n#### Story 2.1: Date range "
                       "filter presets\n\nAs a u, I want x, So that y.\n\n"
                       "**Acceptance Criteria:** z\n")
        v = self.verdicts(two, epics=[{"job": "run-epic-41", "queued": True},
                                      {"job": "run-epic-42",
                                       "queued": False}])
        self.assertEqual(v[1]["title"], "Date range filter")
        self.assertEqual(v[1]["why"], "epic not run")


class CloseoutRefusalTests(CloseoutTestCase):
    def assert_refused(self, name, data=None):
        before = self.record()
        result = self.closeout(data)
        self.assert_status_block_last(result, "blocked")
        self.assertIn(f"engage refused: {name}", result["reason"])
        self.assertEqual(result["written"], [])
        self.assertFalse((self.dir / "closeout.md").exists())
        self.assertEqual(self.fake.calls, [])
        return before

    def test_no_scope(self):
        self.scope_file().unlink()
        self.assert_refused("NoScope")

    def test_bad_input(self):
        for bad in ([], {"run_id": ""}, closeout_input(stories="x"),
                    closeout_input(stories=[{"run_id": "q"}]),
                    closeout_input(outcome_hint="done"),
                    closeout_input(quote=3)):
            self.assert_refused("CloseoutInputInvalid", bad)

    def test_an_unreadable_record(self):
        (self.dir / "engagement.yaml").write_text("not json", encoding="utf-8")
        result = self.closeout()
        self.assert_status_block_last(result, "blocked")
        self.assertIn("EngagementRecordUnreadable", result["reason"])
        self.assertFalse((self.dir / "closeout.md").exists())

    def test_a_scoping_or_terminal_record(self):
        self.set_record(state="scoping")
        self.assert_refused("NotInProgress")
        for state in ("cancelled", "delivered"):
            self.set_record(state=state)
            self.assert_refused("EngagementClosed")


class CloseoutCliTests(CloseoutTestCase):
    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
                mock.patch.dict(os.environ, {"TK_STUDIO_HOME":
                                             str(self.measurements.parent)}):
            code = engage.main(["closeout", "--directory", str(self.root),
                                "--engagement", ENG, *argv])
        return code, json.loads(out.getvalue())

    def test_the_cli_reads_the_input_file_and_refuses_a_bad_one(self):
        self.config.write_text(self.unbound, encoding="utf-8")
        path = Path(self._tmp.name) / "closeout-input.json"
        path.write_text(json.dumps(closeout_input()), encoding="utf-8")
        code, result = self.run_cli("--input-file", str(path), "--dry-run")
        self.assertEqual(code, 0)
        self.assert_status_block_last(result, "partial")
        code, result = self.run_cli("--input-file", str(path))
        self.assertEqual(code, 0)
        self.assert_status_block_last(result, "complete")
        self.assertEqual(result["outcome"], "delivered")
        path.write_text("{not json", encoding="utf-8")
        code, result = self.run_cli("--input-file", str(path))
        self.assertEqual(code, 2)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("CloseoutInputInvalid", result["reason"])

    def test_an_os_refusal_reading_the_input_file_is_transient(self):
        self.config.write_text(self.unbound, encoding="utf-8")
        before = {p: p.read_bytes() for p in self.root.rglob("*")
                  if p.is_file()}
        for path in (Path(self._tmp.name) / "absent.json",
                     Path(self._tmp.name)):  # absent; a directory
            code, result = self.run_cli("--input-file", str(path))
            self.assertEqual(code, 0)
            self.assert_status_block_last(result, "partial")
            self.assertIs(result["retry"], True)
            self.assertTrue(result["ok"])
            self.assertEqual(result["written"], [])
            self.assertIn("transient", result["reason"])
            self.assertNotIn("CloseoutInputInvalid", result["reason"])
        self.assertFalse((self.dir / "closeout.md").exists())
        self.assertEqual({p: p.read_bytes() for p in self.root.rglob("*")
                          if p.is_file()}, before)


# ---------------------------------------------- Story 34.8: the game path

BRIEF = "# Game Brief\n\nA greybox courier run across one moon.\n"
GDD = "# GDD\n\n## Core loop\n\nPick up, fly, deliver.\n"
BRIEF_REL = "_bmad-output/engagements/ENG-001/brief.md"
GDD_REL = "_bmad-output/engagements/ENG-001/gdd.md"


class GameScopeTests(ScopeTestCase):
    def make_game(self, entry="gds"):
        with self.config.open("a", encoding="utf-8") as handle:
            handle.write(f"working_set:\n  developer:\n    - {entry}\n")

    def test_detection_reads_the_tracked_working_set_only(self):
        self.assertFalse(engage.is_game_project(self.root))
        self.make_game("gds-engine-godot-4")
        self.assertTrue(engage.is_game_project(self.root))
        self.assertFalse(engage.is_game_project(self.root / "nowhere"))

    def test_a_game_scope_publishes_brief_and_gdd_beside_the_scope(self):
        self.make_game()
        result = self.scope(brief=BRIEF, gdd=GDD)
        self.assert_status_block_last(result, "complete")
        self.assertTrue(result["game"])
        scope_page = self.fake.page(SCOPE_TITLE)
        brief = self.fake.page("ENG-001: Game Brief")
        gdd = self.fake.page("ENG-001: GDD")
        # the same Engagements/ENG-001 folder as the scope
        self.assertEqual(brief["parentId"], scope_page["parentId"])
        self.assertEqual(gdd["parentId"], scope_page["parentId"])
        self.assertIn("<code>_bmad-output/engagements/ENG-001/brief.md</code>",
                      brief["body"])
        self.assertIn("<h2>Core loop</h2>", gdd["body"])
        self.assertEqual((self.dir / "brief.md").read_text(encoding="utf-8"),
                         BRIEF)
        self.assertEqual((self.dir / "gdd.md").read_text(encoding="utf-8"),
                         GDD)
        record = self.record()
        self.assertIs(record["game"], True)
        for key, page in (("brief_page", brief), ("gdd_page", gdd)):
            url = f"https://{SITE}/wiki/spaces/TKSTUDIO/pages/{page['id']}"
            self.assertEqual(record[key], {"id": page["id"], "url": url,
                                           "version": 1})
            self.assertEqual(result[key]["action"], "created")
        self.assertIn(BRIEF_REL, result["written"])
        self.assertIn(GDD_REL, result["written"])
        # a second run with the same docs skips every page
        self.fake.calls.clear()
        again = self.scope(brief=BRIEF, gdd=GDD)
        self.assert_status_block_last(again, "complete")
        self.assertEqual(again["brief_page"]["action"], "skipped")
        self.assertEqual(again["gdd_page"]["action"], "skipped")
        self.assertEqual(self.fake.writes(), [])

    def test_a_game_project_without_either_doc_is_refused(self):
        self.make_game()
        for kwargs, missing in (({"gdd": GDD}, "brief"),
                                ({"brief": BRIEF}, "gdd"), ({}, "brief")):
            result = self.scope(**kwargs)
            self.assert_status_block_last(result, "blocked")
            self.assertIn(f"GameDocsMissing: {missing}", result["reason"])
        self.assertFalse(self.scope_file().exists())
        self.assertNotIn("game", self.record())

    def test_a_revise_of_a_scope_published_before_34_8_needs_no_doc_flags(self):
        # a game engagement scoped before 34.8: scope_page, no brief/gdd page
        self.scope()
        self.make_game()
        self.assertIn("scope_page", self.record())
        record = self.record()
        record["inputs"] = list(record.get("inputs") or []) + [{
            "at": REVISE_AT, "verb": "revise", "source": "bearer",
            "payload": {"body": "# revised scope\n"}, "from": "scoping",
            "to": "scoping"}]
        self.set_record(inputs=record["inputs"])
        result = self.scope(text=None, revise_at=REVISE_AT)
        self.assert_status_block_last(result, "complete")
        self.assertTrue(result["game"])
        self.assertNotIn("brief_page", self.record())
        self.assertNotIn("gdd_page", self.record())
        # no doc published by this revise: no `game` key minted
        self.assertNotIn("game", self.record())
        # a record already carrying `game: true` keeps it through a flagless revise
        self.set_record(game=True)
        kept = self.scope(text=None, revise_at=REVISE_AT)
        self.assert_status_block_last(kept, "complete")
        self.assertIs(self.record().get("game"), True)
        # the first scope of a fresh game engagement still needs both
        self.set_record(scope_page=None)
        refused = self.scope(text=None, revise_at=REVISE_AT)
        self.assertIn("GameDocsMissing: brief", refused["reason"])

    def test_doc_flags_on_another_project_are_refused(self):
        result = self.scope(brief=BRIEF, gdd=GDD)
        self.assert_status_block_last(result, "blocked")
        self.assertIn("NotAGameProject", result["reason"])
        self.assertFalse(self.scope_file().exists())
        # no flag on another project: unchanged, no game key
        plain = self.scope()
        self.assert_status_block_last(plain, "complete")
        self.assertFalse(plain["game"])
        self.assertNotIn("game", self.record())
        self.assertNotIn("brief_page", self.record())

    def test_the_cli_takes_the_doc_files(self):
        self.make_game()
        brief = Path(self._tmp.name) / "brief-in.md"
        brief.write_text(BRIEF, encoding="utf-8")
        scope_in = Path(self._tmp.name) / "scope-in.md"
        scope_in.write_text(SCOPE, encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = engage._scope_main(self.root, engage.argparse.Namespace(
                engagement=ENG, scope_file=str(scope_in), revise_at=None,
                dry_run=False, brief_file=str(brief), gdd_file=None),
                transport=self.fake)
        result = json.loads(out.getvalue())
        self.assertEqual(code, 2)
        self.assertIn("GameDocsMissing: gdd", result["reason"])


class CloseoutSliceTests(CloseoutTestCase):
    def sheet(self) -> Path:
        path = Path(self._tmp.name) / "store" / "contact-sheet.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x89PNG\r\n\x1a\nfake-sheet")
        return path

    def test_no_slice_no_section(self):
        self.closeout()
        self.assertNotIn("## Slice verdicts", self.report())

    def test_slice_verdicts_per_story_with_the_contact_sheet_attached(self):
        self.set_record(state="scoping")
        self.scope()
        self.set_record(state="in-progress")
        sheet = self.sheet()
        result = self.closeout(closeout_input(slices=[
            {"story": "41-1-csv-button", "engine": "green", "assets": "green",
             "playable": "pass", "contact_sheet": str(sheet)},
            {"story": "41-2-filtered-export", "engine": "red",
             "assets": "skipped", "playable": "skipped"}]))
        self.assert_status_block_last(result, "complete")
        text = self.report()
        sections = [line[3:] for line in text.split("\n")
                    if line.startswith("## ")]
        self.assertEqual(sections[:3], ["Outcome", "Deliverables",
                                        "Slice verdicts"])
        self.assertIn("- 41-1-csv-button — engine green; assets green; "
                      "playable pass", text)
        self.assertIn("- 41-2-filtered-export — engine red; assets skipped; "
                      "playable skipped", text)
        self.assertIn("![41-1-csv-button contact sheet]"
                      "(41-1-csv-button-contact-sheet.png)", text)
        copied = self.dir / "41-1-csv-button-contact-sheet.png"
        self.assertEqual(copied.read_bytes(), sheet.read_bytes())
        page = self.fake.page("ENG-001: Closeout")
        self.assertIn('ri:filename="41-1-csv-button-contact-sheet.png"',
                      page["body"])
        files = self.fake.attachments[page["id"]]
        self.assertEqual([f["title"] for f in files],
                         ["41-1-csv-button-contact-sheet.png"])
        self.assertEqual(files[0]["content"], sheet.read_bytes())
        # a re-run with the same sheet uploads nothing again
        self.fake.calls.clear()
        self.closeout(closeout_input(slices=[
            {"story": "41-1-csv-button", "engine": "green", "assets": "green",
             "playable": "pass", "contact_sheet": str(sheet)},
            {"story": "41-2-filtered-export", "engine": "red",
             "assets": "skipped", "playable": "skipped"}]))
        self.assertFalse([c for c in self.fake.calls
                          if c[0] == "PUT" and "attachment" in c[1]])

    def test_an_unreadable_sheet_is_a_note_and_bad_slices_are_refused(self):
        result = self.closeout(closeout_input(slices=[
            {"story": "41-1-csv-button", "engine": "green", "assets": "green",
             "playable": "pass",
             "contact_sheet": str(Path(self._tmp.name) / "missing.png")}]))
        self.assert_status_block_last(result, "complete")
        self.assertTrue(any("contact sheet of 41-1-csv-button unreadable" in n
                            for n in result["notes"]))
        self.assertNotIn("contact sheet](", self.report())
        bad = self.closeout(closeout_input(slices=[{"engine": "green"}]))
        self.assert_status_block_last(bad, "blocked")
        self.assertIn("CloseoutInputInvalid", bad["reason"])

    def test_a_slice_without_engine_assets_or_playable_is_refused(self):
        whole = {"story": "41-1-csv-button", "engine": "green",
                 "assets": "green", "playable": "pass"}
        for field in ("engine", "assets", "playable"):
            for value in (None, "", "  ", 3):
                entry = dict(whole)
                if value is None:
                    del entry[field]
                else:
                    entry[field] = value
                with self.subTest(field=field, value=value):
                    bad = self.closeout(closeout_input(slices=[entry]))
                    self.assert_status_block_last(bad, "blocked")
                    self.assertIn("CloseoutInputInvalid", bad["reason"])
                    self.assertIn(f"slices[0] {field}", bad["reason"])


if __name__ == "__main__":
    unittest.main()
