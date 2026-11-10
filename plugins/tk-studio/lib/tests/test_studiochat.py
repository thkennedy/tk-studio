"""Tests for the studio chat's scripts (Story 39.3, design addendum
2026-11-07 §3.8, AD-11, driver contract 0.1.35 additive).

`studiochat.py context` reads the turn (the owner line, the chat so far,
the supervisor's reads, the orchestrator's routing, the voice) and
`studiochat.py reply` appends one reply under `studio-chat.lock`. The
`TerminalAndPageResolveAlike` class is CAP-11's identity: the orchestrator
SKILL's documented command and the job's entry print the same routing.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config as configlib  # noqa: E402
import recommend  # noqa: E402
import studiochat  # noqa: E402

LIB = Path(__file__).resolve().parents[1]
PLUGIN = LIB.parent
ORCHESTRATOR_SKILL = PLUGIN / "skills" / "tk-studio-orchestrator" / "SKILL.md"
DOCUMENTED = ('uv run "${CLAUDE_PLUGIN_ROOT}/lib/orchestrate.py" resolve '
              '--directory <project-root>')


def _line(seq, body, author="owner", **extra):
    return {"seq": seq, "at": "2026-11-10T00:00:00.000Z", "author": author,
            "body": body, **extra}


class StudioChatTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self._old = {key: os.environ.get(key)
                     for key in ("TK_STUDIO_HOME", "CLAUDE_CONFIG_DIR")}
        self.store = base / "store"
        os.environ["TK_STUDIO_HOME"] = str(self.store)
        # hermetic: never read the real ~/.claude.json (assistant profile)
        self.claude_dir = base / "claude"
        os.environ["CLAUDE_CONFIG_DIR"] = str(self.claude_dir)
        self.root = base / "proj"
        self.root.mkdir()
        self.tracking = self.root / "_bmad-output" / "tracking"

    def tearDown(self):
        for key, old in self._old.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self._tmp.cleanup()

    def _chat(self, *lines):
        self.tracking.mkdir(parents=True, exist_ok=True)
        (self.tracking / "studio-chat.jsonl").write_text(
            "".join(json.dumps(line, ensure_ascii=False) + "\n"
                    for line in lines), encoding="utf-8", newline="\n")

    def _lines(self):
        return studiochat.read_chat(self.root)

    def _store_with_role(self, role="direction-giver"):
        self.store.mkdir(parents=True, exist_ok=True)
        (self.store / "config.yaml").write_text(
            f"user_name: tester\nrole: {role}\nmachine_id: box\n",
            encoding="utf-8")

    def _confirmed_set(self, role="direction-giver", resources=("cis",)):
        configlib.standup_project_config(self.root)
        recommend.record(self.root, role, list(resources))


class RecordAndLock(StudioChatTestCase):
    def test_reply_appends_the_next_seq_naming_its_line(self):
        self._chat(_line(1, "what is running"))
        result = studiochat.reply(self.root, 1, "Nothing is running.",
                                  run_id="run-1", now="2026-11-10T00:01:00Z")
        self.assertEqual(result["status"], "complete", result["reason"])
        self.assertEqual(result["intent"], "tk-studio-engage")
        self.assertEqual(result["artifacts"],
                         ["_bmad-output/tracking/studio-chat.jsonl"])
        lines = self._lines()
        self.assertEqual(lines[-1], {
            "seq": 2, "at": "2026-11-10T00:01:00Z", "author": "planner",
            "body": "Nothing is running.", "run_id": "run-1",
            "reply_to": 1, "proposals": []})
        # the file is whole JSON lines, the owner's line unchanged
        self.assertEqual(lines[0], _line(1, "what is running"))

    def test_seq_is_reread_past_later_lines(self):
        self._chat(_line(1, "first"), _line(2, "second"))
        result = studiochat.reply(self.root, 1, "One.", run_id="r1")
        self.assertEqual(result["line"]["seq"], 3)
        self.assertEqual(result["line"]["reply_to"], 1)

    def test_a_held_lock_is_chat_busy_and_nothing_is_appended(self):
        self._chat(_line(1, "hi"))
        (self.tracking / "studio-chat.lock").write_text("", encoding="utf-8")
        result = studiochat.reply(self.root, 1, "Hello.", run_id="r1",
                                  wait_s=0.05)
        self.assertEqual(result["status"], "blocked")
        self.assertIn("ChatBusy", result["reason"])
        self.assertEqual(len(self._lines()), 1)

    def test_a_stale_lock_is_taken_over(self):
        self._chat(_line(1, "hi"))
        lock = self.tracking / "studio-chat.lock"
        lock.write_text("", encoding="utf-8")
        old = time.time() - 60
        os.utime(lock, (old, old))
        result = studiochat.reply(self.root, 1, "Hello.", run_id="r1",
                                  wait_s=0.05)
        self.assertEqual(result["status"], "complete", result["reason"])
        self.assertFalse(lock.exists())

    def test_a_torn_line_is_skipped(self):
        self.tracking.mkdir(parents=True)
        (self.tracking / "studio-chat.jsonl").write_text(
            json.dumps(_line(1, "hi")) + "\n{\"seq\": 2, \"au",
            encoding="utf-8")
        result = studiochat.reply(self.root, 1, "Hello.", run_id="r1")
        self.assertEqual(result["line"]["seq"], 2)
        self.assertEqual([l["seq"] for l in self._lines()], [1, 2])

    def test_a_chat_that_is_not_utf8_is_unreadable(self):
        self.tracking.mkdir(parents=True)
        (self.tracking / "studio-chat.jsonl").write_bytes(b"\xff\xfe{")
        result = studiochat.context(self.root, 1)
        self.assertEqual(result["status"], "blocked")
        self.assertIn("ChatUnreadable", result["reason"])

    def test_body_rules_and_run_id(self):
        self._chat(_line(1, "hi"))
        for body, name in (("   ", "BodyEmpty"),
                           ("x" * (32 * 1024 + 1), "BodyTooLarge")):
            result = studiochat.reply(self.root, 1, body, run_id="r1")
            self.assertIn(name, result["reason"])
        result = studiochat.reply(self.root, 1, "ok", run_id=" ")
        self.assertIn("RunIdRequired", result["reason"])
        self.assertEqual(len(self._lines()), 1)


class AlreadyAnsweredAndUnknownLine(StudioChatTestCase):
    def test_a_second_reply_to_one_line_is_refused(self):
        self._chat(_line(1, "hi"))
        first = studiochat.reply(self.root, 1, "Hello.", run_id="r1")
        self.assertEqual(first["status"], "complete")
        second = studiochat.reply(self.root, 1, "Again.", run_id="r1")
        self.assertEqual(second["status"], "blocked")
        self.assertIn("AlreadyAnswered", second["reason"])
        self.assertEqual(len(self._lines()), 2)

    def test_a_failure_reply_also_answers_the_line(self):
        self._chat(_line(1, "hi"),
                   _line(2, "No reply: the run ended failed: x",
                         author="planner", run_id="r1", reply_to=1,
                         proposals=[], failed=True))
        result = studiochat.reply(self.root, 1, "Late.", run_id="r1")
        self.assertIn("AlreadyAnswered", result["reason"])

    def test_unknown_line_on_reply_and_context(self):
        self._chat(_line(1, "pressed: Queue 38.2", pressed={
            "seq": 0, "index": 0, "kind": "queue"}))
        for result in (studiochat.reply(self.root, 1, "x", run_id="r1"),
                       studiochat.reply(self.root, 9, "x", run_id="r1"),
                       studiochat.context(self.root, 1)):
            self.assertEqual(result["status"], "blocked")
            self.assertIn("UnknownLine", result["reason"])

    def test_context_on_a_missing_chat_is_unknown_line(self):
        result = subprocess.run(
            [sys.executable, str(LIB / "studiochat.py"), "context",
             "--directory", str(self.root), "--seq", "1"],
            capture_output=True, text=True, encoding="utf-8", timeout=30)
        self.assertEqual(result.returncode, 2)
        block = json.loads(result.stdout)
        self.assertEqual(block["status"], "blocked")
        self.assertIn("UnknownLine", block["reason"])
        self.assertFalse(self.tracking.exists())


class Proposals(StudioChatTestCase):
    KINDS = (
        {"kind": "queue", "label": "Queue 38.2", "project": "tk-studio",
         "job": "run-epic-38"},
        {"kind": "answer", "label": "Answer DW-87 with A", "id": "DW-87",
         "letter": "A", "note": "", "issue": "TKSTUDIO-240"},
        {"kind": "answer", "label": "A, with a note", "id": "q1",
         "letter": "B", "note": "only after the docs PR", "issue": "AB-1"},
        {"kind": "open", "label": "Open the board",
         "route": "/app/board/tk-studio"},
        {"kind": "engagement", "label": "Plan it",
         "title": "An epic for X"},
    )

    def setUp(self):
        super().setUp()
        self._chat(_line(1, "what now"))

    def test_each_kind_validates_and_is_written(self):
        result = studiochat.reply(self.root, 1, "Here.", run_id="r1",
                                  proposals=list(self.KINDS))
        self.assertEqual(result["status"], "complete", result["reason"])
        self.assertEqual(self._lines()[-1]["proposals"], list(self.KINDS))

    def test_both_39_7_kinds_are_refused_by_name(self):
        for kind in ("stop-after-story", "open-studio"):
            result = studiochat.reply(
                self.root, 1, "Here.", run_id="r1",
                proposals=[self.KINDS[0], {"kind": kind, "label": "Do it"}])
            self.assertEqual(result["status"], "blocked")
            self.assertIn(f"ProposalNotYet: {kind} lands in Story 39.7",
                          result["reason"])
        self.assertEqual(len(self._lines()), 1)

    def test_invalid_proposals_name_their_index(self):
        cases = [
            ({"kind": "queue", "label": "x", "project": "", "job": "a"},
             "project"),
            ({"kind": "queue", "label": "x", "project": "p", "job": "Bad"},
             "job"),
            ({"kind": "answer", "label": "x", "id": "-x", "letter": "A",
              "note": "", "issue": "AB-1"}, "id"),
            ({"kind": "answer", "label": "x", "id": "DW-1", "letter": "a",
              "note": "", "issue": "AB-1"}, "letter"),
            ({"kind": "answer", "label": "x", "id": "DW-1", "letter": "A",
              "note": "n" * 2001, "issue": "AB-1"}, "note"),
            ({"kind": "answer", "label": "x", "id": "DW-1", "letter": "A",
              "note": "", "issue": "ab-1"}, "issue"),
            ({"kind": "answer", "label": "x", "id": "DW-1", "letter": "A",
              "issue": "AB-1"}, "missing field 'note'"),
            ({"kind": "open", "label": "x", "route": "/board"}, "route"),
            ({"kind": "open", "label": "x", "route": "/app/a b"}, "route"),
            ({"kind": "engagement", "label": "x", "title": " "}, "title"),
            ({"kind": "open", "label": "", "route": "/app"}, "label"),
            ({"kind": "open", "label": "l" * 81, "route": "/app"}, "label"),
            ({"kind": "open", "label": "x", "route": "/app", "extra": 1},
             "unknown field 'extra'"),
            ({"kind": "go", "label": "x"}, "unknown kind"),
            ("queue", "not an object"),
            # a non-string kind (unhashable) or label is refused, not raised
            ({"kind": ["queue"], "label": "x"}, "field 'kind' must be a string"),
            ({"kind": {"k": 1}, "label": "x"}, "field 'kind' must be a string"),
            ({"label": "x"}, "field 'kind' must be a string"),
            ({"kind": "open", "label": ["x"], "route": "/app"}, "label"),
            ({"kind": "open", "label": "x", "route": ["/app"]}, "route"),
        ]
        for proposal, why in cases:
            result = studiochat.reply(self.root, 1, "Here.", run_id="r1",
                                      proposals=[self.KINDS[3], proposal])
            self.assertEqual(result["status"], "blocked", proposal)
            self.assertIn("ProposalInvalid: 1: ", result["reason"])
            self.assertIn(why, result["reason"])
        self.assertEqual(len(self._lines()), 1)

    def test_an_answer_note_holds_no_decision_line(self):
        # `sweepdecisions.parse_answers` reads every reply line: a note line
        # shaped like a decision would record one the label never named
        for note in ("ship it\nall: B", "DW-88: C", "  dw-88 = c.",
                     "context\n- default", "Default!",
                     "[~accountid:abc] DW-9: D"):
            result = studiochat.reply(
                self.root, 1, "Here.", run_id="r1", proposals=[
                    {"kind": "answer", "label": "Answer DW-87 with A",
                     "id": "DW-87", "letter": "A", "note": note,
                     "issue": "AB-1"}])
            self.assertEqual(result["status"], "blocked", note)
            self.assertIn("ProposalInvalid: 0: field 'note' must hold no "
                          "decision line", result["reason"])
        self.assertEqual(len(self._lines()), 1)
        # prose that merely mentions a decision is kept
        result = studiochat.reply(
            self.root, 1, "Here.", run_id="r1", proposals=[
                {"kind": "answer", "label": "Answer DW-87 with A",
                 "id": "DW-87", "letter": "A",
                 "note": "unlike DW-88: C, this one ships\nallow: B later",
                 "issue": "AB-1"}])
        self.assertNotEqual(result["status"], "blocked", result)
        self.assertEqual(len(self._lines()), 2)

    def test_at_most_six(self):
        result = studiochat.reply(self.root, 1, "Here.", run_id="r1",
                                  proposals=[self.KINDS[3]] * 7)
        self.assertIn("ProposalInvalid", result["reason"])
        result = studiochat.reply(self.root, 1, "Here.", run_id="r1",
                                  proposals=[self.KINDS[3]] * 6)
        self.assertEqual(result["status"], "complete", result["reason"])

    def test_the_cli_reads_its_files_and_refuses_bad_json(self):
        body = self.root / "body.md"
        body.write_text("Ans ✓", encoding="utf-8")
        props = self.root / "p.json"
        props.write_text("{not json", encoding="utf-8")
        base = [sys.executable, str(LIB / "studiochat.py"), "reply",
                "--directory", str(self.root), "--seq", "1",
                "--run-id", "r1", "--body-file", str(body)]
        bad = subprocess.run(base + ["--proposals-file", str(props)],
                             capture_output=True, text=True,
                             encoding="utf-8", timeout=30)
        self.assertEqual(bad.returncode, 2)
        self.assertIn("ProposalInvalid", json.loads(bad.stdout)["reason"])
        props.write_text(json.dumps([self.KINDS[0]]), encoding="utf-8")
        good = subprocess.run(base + ["--proposals-file", str(props)],
                              capture_output=True, text=True,
                              encoding="utf-8", timeout=30)
        self.assertEqual(good.returncode, 0, good.stdout)
        self.assertEqual(self._lines()[-1]["body"], "Ans ✓")

    def test_the_cli_refuses_a_non_string_kind_with_a_status_block(self):
        body = self.root / "body.md"
        body.write_text("Here.", encoding="utf-8")
        props = self.root / "p.json"
        props.write_text(json.dumps([{"kind": ["queue"], "label": "x"}]),
                         encoding="utf-8")
        run = subprocess.run(
            [sys.executable, str(LIB / "studiochat.py"), "reply",
             "--directory", str(self.root), "--seq", "1", "--run-id", "r1",
             "--body-file", str(body), "--proposals-file", str(props)],
            capture_output=True, text=True, encoding="utf-8", timeout=30)
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertNotIn("Traceback", run.stderr)
        self.assertIn("ProposalInvalid: 0: field 'kind' must be a string",
                      json.loads(run.stdout)["reason"])
        self.assertEqual(len(self._lines()), 1)


class DryRun(StudioChatTestCase):
    def test_a_dry_run_writes_nothing_and_ends_partial(self):
        self._chat(_line(1, "hi"))
        before = (self.tracking / "studio-chat.jsonl").read_bytes()
        result = studiochat.reply(self.root, 1, "Hello.", run_id="r1",
                                  dry_run=True)
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["ok"])
        self.assertIsNone(result["line"]["seq"])
        self.assertEqual(result["line"]["reply_to"], 1)
        self.assertEqual(result["artifacts"], [])
        self.assertEqual((self.tracking / "studio-chat.jsonl").read_bytes(),
                         before)
        self.assertFalse((self.tracking / "studio-chat.lock").exists())


class ContextAndVoice(StudioChatTestCase):
    def test_context_reads_the_line_the_chat_and_the_reads(self):
        lines = [_line(i, f"line {i}") for i in range(1, 46)]
        self._chat(*lines)
        reads = {"at": "x", "project": "p", "board": {"epics": []}}
        (self.tracking / "studio-chat-reads").mkdir()
        (self.tracking / "studio-chat-reads" / "44.json").write_text(
            json.dumps(reads), encoding="utf-8")
        result = studiochat.context(self.root, 44)
        self.assertEqual(result["status"], "complete", result["reason"])
        self.assertEqual(result["mode"], "context")
        self.assertFalse(result["dry_run"])
        self.assertEqual(result["line"], lines[43])
        self.assertEqual(len(result["chat"]), 40)
        self.assertEqual(result["chat"][-1]["seq"], 44)
        self.assertEqual(result["reads"], reads)
        self.assertEqual(result["not_yet"], ["stop-after-story",
                                             "open-studio"])
        self.assertEqual(result["written"], [])

    def test_no_reads_file_is_null_with_a_note(self):
        self._chat(_line(1, "hi"))
        result = studiochat.context(self.root, 1)
        self.assertIsNone(result["reads"])
        self.assertTrue(any("studio-chat-reads/1.json" in n
                            for n in result["notes"]))

    def test_plain_by_default_council_on_request(self):
        self._chat(_line(1, "what is running"),
                   _line(2, "Convene the COUNCIL: what is running"),
                   _line(3, "the councillor says hi"))
        plain = studiochat.context(self.root, 1)
        self.assertEqual(plain["voice"], "plain")
        self.assertNotIn("shell", plain)
        council = studiochat.context(self.root, 2)
        self.assertEqual(council["voice"], "council")
        self.assertEqual(council["shell"]["shell_version"], 1)
        self.assertTrue(council["shell"]["assets"])
        self.assertEqual(studiochat.context(self.root, 3)["voice"], "plain")
        # the shell is never a routing input
        self.assertEqual(plain["routing"], council["routing"])

    def test_context_writes_nothing(self):
        self._chat(_line(1, "hi"))
        before = sorted(p.name for p in self.root.rglob("*"))
        studiochat.context(self.root, 1)
        self.assertEqual(sorted(p.name for p in self.root.rglob("*")), before)


class TerminalAndPageResolveAlike(StudioChatTestCase):
    """CAP-11 (AD-11): the orchestrator SKILL.md's documented command and
    the studio-chat job's entry print the same routing payload."""

    def _run(self, argv):
        result = subprocess.run(
            [sys.executable, *argv], capture_output=True, text=True,
            encoding="utf-8", timeout=30, env=dict(os.environ))
        self.assertIn(result.returncode, (0, 2), result.stderr)
        return result.stdout

    def _terminal(self):
        skill = ORCHESTRATOR_SKILL.read_text(encoding="utf-8")
        self.assertIn(DOCUMENTED, skill)
        # `uv run` is the interpreter the gate already runs under; the
        # rest is the documented argv
        return json.loads(self._run([str(LIB / "orchestrate.py"), "resolve",
                                     "--directory", str(self.root)]))

    def _page(self, seq):
        out = self._run([str(LIB / "studiochat.py"), "context",
                         "--directory", str(self.root), "--seq", str(seq)])
        context = json.loads(out)
        self.assertEqual(context["status"], "complete", context["reason"])
        return context

    def test_ready(self):
        self._store_with_role()
        self._confirmed_set()
        self._chat(_line(1, "what is running"))
        terminal = self._terminal()
        self.assertEqual(terminal["outcome"], "ready")
        self.assertEqual(terminal, self._page(1)["routing"])

    def test_needs_onboarding(self):
        self._store_with_role()
        self._chat(_line(1, "what is running"))
        terminal = self._terminal()
        self.assertEqual(terminal["outcome"], "needs-onboarding")
        self.assertEqual(terminal["gaps"], ["working_set.direction-giver"])
        self.assertEqual(terminal, self._page(1)["routing"])

    def test_council_and_plain_route_alike(self):
        self._store_with_role()
        self._confirmed_set()
        self._chat(_line(1, "convene the council: what is running"),
                   _line(2, "what is running"))
        terminal = self._terminal()
        council, plain = self._page(1), self._page(2)
        self.assertEqual(council["voice"], "council")
        self.assertIn("shell", council)
        self.assertEqual(plain["voice"], "plain")
        self.assertNotIn("shell", plain)
        self.assertEqual(terminal, council["routing"])
        self.assertEqual(terminal, plain["routing"])


if __name__ == "__main__":
    unittest.main()
