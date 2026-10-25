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


if __name__ == "__main__":
    unittest.main()
