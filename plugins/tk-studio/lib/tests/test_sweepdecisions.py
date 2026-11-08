"""Tests for the owner's sweep decisions (Story 38.4, hole 112, DW-171).

The source: `sweepdecisions` letters the skill's options, groups related
decisions and `track.py block --source sweep` posts one Task per group (the
`tk-studio-decision` label, the owner assigned, `Blocked - Awaiting User`, the
mention comment) and writes `_bmad-output/tracking/decisions-jira.json`. The
sink: the sync-back tick's `ingest` parses the owner's answer lines, writes the
ledger's `decision:` lines through `plansync.ledger_decide`, replies, and moves
the issue to Done or re-blocks it naming the missing ids. `FakeTrack` (the
sync-back fake plus the block's routes) stands in for Jira: no network call.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import inbox  # noqa: E402
import jirabackend  # noqa: E402
import sweepdecisions as sd  # noqa: E402

from test_syncback import AGENT, KEY, NOW, OWNER, comment  # noqa: E402
from test_track import BLOCKED, TrackTestCase  # noqa: E402

RESOLVED = jirabackend.RESOLVED_STATUS


def decision(dw, question="keep the flag or drop it?", options=None, rec="2",
             context="the flag is unused"):
    if options is None:
        options = [{"key": "1", "label": "Keep", "effect": "keep-open"},
                   {"key": "2", "label": "Drop", "effect": "close",
                    "resolution": "nothing reads it"}]
    return {"id": dw, "question": question, "context": context,
            "options": options, "recommendation": rec}


LEDGER = """# Deferred Work

### DW-3: three
status: open

### DW-5: five
reason: r
status: open

### DW-12: twelve
status: open
"""


class ShapeTests(unittest.TestCase):
    def test_lettering_and_the_default(self):
        d = sd.shape(decision("DW-1", options=[
            {"key": "a", "label": "Build", "effect": "build", "intent": "add it"},
            {"key": "b", "label": "Close", "effect": "close"},
            {"key": "c", "label": "Keep", "effect": "keep-open"}], rec="b"))
        self.assertEqual([(o["letter"], o["text"], o["key"]) for o in d["options"]],
                         [("A", "Build — add it", "a"), ("B", "Close", "b"),
                          ("C", "Keep", "c")])
        self.assertEqual(d["default"], "B")
        self.assertEqual(sd.shape({"id": "DW-2", "question": "q"})["options"], [])
        self.assertIsNone(sd.shape({"id": "DW-2", "question": "q"})["default"])
        long = sd.shape(decision("DW-1", options=[
            {"key": "1", "label": "x" * 300, "effect": "build"}]))
        self.assertEqual(len(long["options"][0]["text"]), 200)

    def test_grouping_related_pairs_by_question_and_options(self):
        a = decision("DW-12", question="Keep DW-12's flag?")
        b = decision("DW-3", question="keep  DW-3's FLAG?")
        c = decision("DW-5", question="keep DW-5's flag?", rec="1")  # another default
        groups = sd.groups([a, c, b])
        self.assertEqual([[d["id"] for d in g] for g in groups],
                         [["DW-3", "DW-12"], ["DW-5"]])
        many = [decision(f"DW-{n}") for n in range(1, 36)]
        self.assertEqual([len(g) for g in sd.groups(many)], [30, 5])

    def test_summary_and_description(self):
        self.assertEqual(sd.summary(["DW-87"], "Keep it?"), "Decision: DW-87 — Keep it?")
        self.assertEqual(sd.summary(["DW-12", "DW-13"], "Q"), "Decisions: DW-12, DW-13 — Q")
        ids = [f"DW-{n}" for n in range(12, 20)]
        self.assertEqual(sd.summary(ids, "Q"), "Decisions: DW-12, …, DW-17 +2 — Q")
        self.assertEqual(len(sd.summary(["DW-1"], "q" * 400)), 255)
        shaped = [sd.lettered(decision("DW-3")), sd.lettered(decision("DW-12"))]
        self.assertEqual(sd.description("run-sweep-1", "E1", shaped, {"DW-12": ("A", f"{KEY}-9")}), "\n".join([
            'Sweep run-sweep-1 (engine E1) needs 2 decision(s). Answer in one comment: one "<id>: <letter>" '
            'line per decision, "all: <letter>" for every decision here, or "default" to take each default.',
            "", "DW-3: keep the flag or drop it?", "the flag is unused", "A) Keep",
            "B) Drop — nothing reads it", "Default: B",
            "", "DW-12: keep the flag or drop it?", "the flag is unused", "A) Keep",
            "B) Drop — nothing reads it", "Default: B",
            f"Earlier answer: A ({KEY}-9) no longer matches these options"]))


class ParseTests(unittest.TestCase):
    DECISIONS = {dw: {"options": [{"letter": "A"}, {"letter": "B"}], "default": "B"}
                 for dw in ("DW-1", "DW-2")}

    def parse(self, *texts, decisions=None, ids=("DW-1", "DW-2")):
        return sd.parse_answers(list(texts), decisions or self.DECISIONS, list(ids))

    def test_own_line_then_all(self):
        self.assertEqual(self.parse("thanks!\n- dw-1: b\nall: A"),
                         ({"DW-1": "B", "DW-2": "A"}, {}))

    def test_a_missing_line_without_default_stays_open(self):
        self.assertEqual(self.parse("DW-1 = A."), ({"DW-1": "A"}, {"DW-2": "no answer line"}))

    def test_default_only_when_the_comment_says_default(self):
        self.assertEqual(self.parse("DW-1: A", "default"), ({"DW-1": "A", "DW-2": "B"}, {}))
        no_default = {"DW-1": {"options": [{"letter": "A"}], "default": None}}
        self.assertEqual(self.parse("default", decisions=no_default, ids=("DW-1",)),
                         ({}, {"DW-1": "no default"}))

    def test_bad_letters_and_qualified_answers(self):
        self.assertEqual(self.parse("DW-1: E\nDW-2: A with one change"),
                         ({}, {"DW-1": "no option E", "DW-2": "qualified answer, not ingested"}))
        # a later line wins
        self.assertEqual(self.parse("DW-2: A with one change", "DW-2: A"),
                         ({"DW-2": "A"}, {"DW-1": "no answer line"}))

    def test_unreadable_options_are_never_invented(self):
        self.assertEqual(self.parse("all: A", decisions={"DW-1": {"options": [], "default": None}},
                                    ids=("DW-1",)),
                         ({}, {"DW-1": "not ingested: options unreadable"}))

    def test_reply_text(self):
        decisions = {"DW-1": {"options": [{"letter": "B", "text": "Drop"}]}}
        self.assertEqual(sd.reply_text({"DW-1": "B"}, decisions, {"DW-12": "no option E", "DW-3": "no answer line"}),
                         "Ingested: DW-1: B — Drop\nStill open: DW-3 (no answer line), DW-12 (no option E)")
        self.assertEqual(sd.reply_text({}, {}, {}), "Ingested: none\nStill open: none")

    def test_options_from_a_hand_posted_description(self):
        options, default = sd.options_from_description(
            "Pick one:\n- **A**) accept and close\n- B. build the fix (recommended)\nC: keep open\n")
        self.assertEqual([(o["letter"], o["text"]) for o in options],
                         [("A", "accept and close"), ("B", "build the fix (recommended)"), ("C", "keep open")])
        self.assertEqual(default, "B")
        self.assertEqual(sd.options_from_description("no letters here"), ([], None))


class DecisionsTestCase(TrackTestCase):
    def setUp(self):
        super().setUp()
        ledger = self.root / "_bmad-output" / "implementation-artifacts" / "deferred-work.md"
        ledger.parent.mkdir(parents=True, exist_ok=True)
        ledger.write_text(LEDGER, encoding="utf-8", newline="\n")
        self.ledger = ledger
        self.triage_path = self.root / ".bmad-loop" / "runs" / "E1" / "triage.json"
        self.triage([decision("DW-12"), decision("DW-3"), decision("DW-5", question="another?")])

    def triage(self, decisions, path=None):
        path = path or self.triage_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"decisions": decisions}), encoding="utf-8")
        return path

    def post(self, *paths, **kwargs):
        return sd.post(self.root, [str(p) for p in (paths or (self.triage_path,))],
                       kwargs.pop("run_id", "run-sweep-1"), transport=self.fake,
                       sleep=self.sleeps.append, now=NOW, **kwargs)

    def record(self):
        return json.loads((self.root / sd.RECORD_REL).read_text(encoding="utf-8"))


class PostTests(DecisionsTestCase):
    def test_one_task_per_related_group_blocked_with_the_mention(self):
        result = self.post()
        self.assert_track_block(result, "complete")
        self.assertEqual((result["source"], result["run_id"]), ("sweep", "run-sweep-1"))
        self.assertEqual([(i["issue"], i["ids"], i["created"], i["transitioned"], i["commented"])
                          for i in result["issues"]],
                         [(f"{KEY}-100", ["DW-3", "DW-12"], True, True, True),
                          (f"{KEY}-101", ["DW-5"], True, True, True)])
        first = self.fake.created[0]
        self.assertEqual({k: first[k] for k in ("project", "summary", "issuetype", "labels", "assignee")}, {
            "project": {"key": KEY}, "summary": "Decisions: DW-3, DW-12 — keep the flag or drop it?",
            "issuetype": {"name": "Task"}, "labels": ["tk-studio-decision"],
            "assignee": {"accountId": OWNER}})
        self.assertTrue(first["description"].startswith("Sweep run-sweep-1 (engine E1) needs 2 decision(s)."))
        self.assertEqual(self.fake.created[1]["summary"], "Decision: DW-5 — another?")
        self.assertEqual(self.fake.status[f"{KEY}-100"], BLOCKED)
        body = self.fake.posted[f"{KEY}-100"][0]
        self.assertEqual(body, f"[~accountid:{OWNER}] Blocked: 2 sweep decision(s) need your answer: DW-3, DW-12\n"
                               'Resolves when: reply with one "<id>: <letter>" line per decision, "all: <letter>", or "default"')
        self.assertTrue(inbox.BLOCK_COMMENT_RE.match(body))
        record = self.record()
        self.assertEqual(result["written"], ["_bmad-output/tracking/decisions-jira.json"])
        entry = record["issues"][f"{KEY}-100"]
        self.assertEqual((entry["ids"], entry["run_id"], entry["engine_run_id"], entry["state"]),
                         (["DW-3", "DW-12"], "run-sweep-1", "E1", "open"))
        self.assertEqual(entry["decisions"]["DW-3"]["default"], "B")

    def test_a_re_run_skips_asked_and_answered_ids_and_ask_re_asks(self):
        self.post()
        creates = len(self.fake.created)
        again = self.post()
        self.assert_track_block(again, "complete")
        self.assertEqual(again["issues"], [])
        self.assertEqual(sorted(again["skipped"]), [f"DW-12: already asked on {KEY}-100",
                                                    f"DW-3: already asked on {KEY}-100",
                                                    f"DW-5: already asked on {KEY}-101"])
        self.assertEqual(len(self.fake.created), creates)
        record = self.record()
        record["issues"][f"{KEY}-101"]["state"] = "done"
        record["answers"]["DW-5"] = {"letter": "A", "issue": f"{KEY}-101"}
        (self.root / sd.RECORD_REL).write_text(json.dumps(record), encoding="utf-8")
        third = self.post()
        self.assertIn(f"DW-5: answered on {KEY}-101", third["skipped"])
        fourth = self.post(ask=["DW-5"])
        self.assertEqual([i["ids"] for i in fourth["issues"]], [["DW-5"]])
        self.assertIn(f"Earlier answer: A ({KEY}-101) no longer matches these options",
                      self.fake.created[-1]["description"])

    def test_a_repeated_ask_is_idempotent(self):
        """Review patch 2: an id `--ask` re-asked on an open issue is not asked
        again by the next call with the same `--ask` (the close-out re-derives
        it from the unchanged recorded answer)."""
        self.post()
        record = self.record()
        record["issues"][f"{KEY}-101"]["state"] = "done"
        record["answers"]["DW-5"] = {"letter": "A", "issue": f"{KEY}-101"}
        (self.root / sd.RECORD_REL).write_text(json.dumps(record), encoding="utf-8")
        first = self.post(ask=["DW-5"])
        self.assertEqual([(i["issue"], i["ids"]) for i in first["issues"]], [(f"{KEY}-102", ["DW-5"])])
        creates = len(self.fake.created)
        again = self.post(ask=["DW-5"])
        self.assert_track_block(again, "complete")
        self.assertEqual(again["issues"], [])
        self.assertIn(f"DW-5: already re-asked on {KEY}-102", again["skipped"])
        self.assertEqual(len(self.fake.created), creates)

    def _ask_twice_posts_once(self, dw, reask_key):
        creates = len(self.fake.created)
        first = self.post(ask=[dw])
        self.assert_track_block(first, "complete")
        self.assertEqual([(i["issue"], i["ids"]) for i in first["issues"]], [(reask_key, [dw])])
        self.assertEqual(len(self.fake.created), creates + 1)
        again = self.post(ask=[dw])
        self.assert_track_block(again, "complete")
        self.assertEqual(again["issues"], [])
        self.assertIn(f"{dw}: already re-asked on {reask_key}", again["skipped"])
        self.assertEqual(len(self.fake.created), creates + 1)

    def test_a_repeated_ask_is_idempotent_while_the_answer_issue_stays_open(self):
        """Follow-up review patch 1: the issue holding the recorded answer is
        still open (re-blocked for another id): a second `--ask` finds the
        re-ask issue, not the answer's, and posts no second Task."""
        self.post()
        record = self.record()
        self.assertEqual(record["issues"][f"{KEY}-100"]["state"], "open")  # DW-12 still missing
        record["answers"]["DW-3"] = {"letter": "A", "issue": f"{KEY}-100"}
        (self.root / sd.RECORD_REL).write_text(json.dumps(record), encoding="utf-8")
        self._ask_twice_posts_once("DW-3", f"{KEY}-102")

    def test_a_repeated_ask_is_idempotent_while_a_legacy_answer_issue_is_not_done(self):
        """Follow-up review patch 1, the legacy variant: the answer's issue is
        a legacy entry whose status is not Done."""
        self.post()
        record = self.record()
        record["issues"][f"{KEY}-101"]["state"] = "done"
        record["issues"][f"{KEY}-220"] = {"theme": "x", "dw": "DW-5", "status": BLOCKED}
        record["answers"]["DW-5"] = {"letter": "A", "issue": f"{KEY}-220"}
        (self.root / sd.RECORD_REL).write_text(json.dumps(record), encoding="utf-8")
        self._ask_twice_posts_once("DW-5", f"{KEY}-102")

    def test_a_repeated_ask_finishes_a_cut_short_re_ask_block(self):
        self.post()
        record = self.record()
        record["issues"][f"{KEY}-101"]["state"] = "done"
        record["answers"]["DW-5"] = {"letter": "A", "issue": f"{KEY}-101"}
        (self.root / sd.RECORD_REL).write_text(json.dumps(record), encoding="utf-8")
        key = f"{KEY}-102"
        self.fake.force[("POST", f"/issue/{key}/comment")] = (503, "down")
        first = self.post(ask=["DW-5"])
        self.assertEqual((first["status"], first.get("retry")), ("partial", True))
        self.assertFalse(self.record()["issues"][key]["blocked"])
        del self.fake.force[("POST", f"/issue/{key}/comment")]
        creates = len(self.fake.created)
        again = self.post(ask=["DW-5"])
        self.assert_track_block(again, "complete")
        self.assertEqual([(i["issue"], i["ids"], i["created"], i["commented"]) for i in again["issues"]],
                         [(key, ["DW-5"], False, True)])
        self.assertEqual(len(self.fake.created), creates)
        self.assertTrue(self.record()["issues"][key]["blocked"])

    def test_a_dry_run_names_each_group_and_writes_nothing(self):
        result = self.post(dry_run=True)
        self.assert_track_block(result, "partial")
        self.assertEqual(self.fake.created, [])
        self.assertEqual(self.writes(), [])
        self.assertFalse((self.root / sd.RECORD_REL).exists())
        self.assertEqual(result["written"], [])
        self.assertEqual(result["notes"][0],
                         'dry run: would create "Decisions: DW-3, DW-12 — keep the flag or drop it?" (Task, '
                         "tk-studio-decision, assigned to the owner) for DW-3, DW-12 and move it to "
                         "'Blocked - Awaiting User' with the mention comment")
        self.assertEqual(result["issues"][0], {"issue": None, "ids": ["DW-3", "DW-12"], "created": False,
                                               "transitioned": False, "commented": False})

    def test_refusals_and_nothing_to_post(self):
        result = self.post(self.root / "absent.json")
        self.assert_track_block(result, "blocked")
        self.assertIn("TriageUnreadable", result["reason"])
        bad = self.triage([], path=self.root / "list.json")
        bad.write_text("[1]", encoding="utf-8")
        self.assertIn("TriageUnreadable", self.post(bad)["reason"])
        self.assertEqual(self.fake.calls, [])
        empty = self.triage([], path=self.root / "empty.json")
        self.assert_track_block(self.post(empty), "complete")
        self.assertEqual(self.fake.created, [])
        # a later triage wins by id
        later = self.triage([decision("DW-3", question="changed?")], path=self.root / ".bmad-loop" / "runs" / "E1" / "triage-2.json")
        self.post(self.triage_path, later)
        self.assertIn("Decision: DW-3 — changed?", [c["summary"] for c in self.fake.created])

    def test_a_temporary_failure_is_a_retry(self):
        self.fake.force[("POST", "/issue")] = (502, "bad gateway")
        result = self.post()
        self.assertEqual((result["status"], result["ok"], result.get("retry")), ("partial", False, True))

    def test_a_refused_create_quotes_the_summary(self):
        self.fake.refuse_create = True
        result = self.post()
        self.assert_track_block(result, "blocked")
        self.assertIn('creating "Decisions: DW-3, DW-12 — keep the flag or drop it?" (issue type', result["reason"])

    def test_a_block_cut_short_after_the_create_is_finished_on_a_re_run(self):
        key = f"{KEY}-100"
        self.fake.force[("POST", f"/issue/{key}/comment")] = (503, "down")
        first = self.post()
        self.assertEqual((first["status"], first.get("retry")), ("partial", True))
        self.assertEqual(self.fake.status[key], BLOCKED)
        self.assertNotIn(key, self.fake.posted)
        entry = self.record()["issues"][key]
        self.assertEqual((entry["state"], entry["blocked"]), ("open", False))
        del self.fake.force[("POST", f"/issue/{key}/comment")]
        again = self.post()
        self.assert_track_block(again, "complete")
        # the cut-short issue's block finished (its ids not skipped), the rest posted
        self.assertEqual([(i["issue"], i["ids"], i["created"], i["commented"]) for i in again["issues"]],
                         [(key, ["DW-3", "DW-12"], False, True), (f"{KEY}-101", ["DW-5"], True, True)])
        self.assertEqual(again["skipped"], [])
        self.assertTrue(inbox.BLOCK_COMMENT_RE.match(self.fake.posted[key][0]))
        self.assertEqual(len(self.fake.created), 2)
        self.assertTrue(self.record()["issues"][key]["blocked"])
        third = self.post()
        self.assertEqual(third["issues"], [])
        self.assertIn(f"DW-3: already asked on {key}", third["skipped"])

    def test_a_legacy_files_other_data_is_kept_on_write(self):
        path = self.root / sd.RECORD_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        legacy = {f"{KEY}-220": {"dw": "DW-90"}, "posted_by": "hand", "answers": ["x"]}
        path.write_text(json.dumps(legacy), encoding="utf-8")
        self.post()
        record = self.record()
        self.assertEqual(record["issues"][f"{KEY}-220"], {"dw": "DW-90"})
        self.assertEqual(record["posted_by"], "hand")
        self.assertEqual(record["legacy"], {"answers": ["x"]})
        self.assertEqual(record["answers"], {})
        # a written record's unrecognised keys survive the next write
        self.post(ask=["DW-5"])
        self.assertEqual((self.record()["posted_by"], self.record()["legacy"]), ("hand", {"answers": ["x"]}))
        # a legacy top-level list is kept verbatim under `legacy`
        listed = [{"key": f"{KEY}-221", "ids": "DW-91"}, "a note"]
        path.write_text(json.dumps(listed), encoding="utf-8")
        sd.write_record(self.root, sd.load_record(self.root))
        record = self.record()
        self.assertEqual(record["legacy"], listed)
        self.assertEqual(record["issues"][f"{KEY}-221"], listed[0])


class IngestTests(DecisionsTestCase):
    """The tick: an answered issue at `Block Resolved` ingested."""

    def answered(self, key, *texts, minutes_ago=-1):
        """The owner answers on `key` and moves it to `Block Resolved`; the
        tick's search returns it with every comment and its label."""
        store = self.fake.comment_store.setdefault(key, [])
        for n, text in enumerate(texts):
            store.append(comment(f"o{len(store) + 1}", OWNER, text, minutes_ago - n))
        self.fake.status[key] = RESOLVED
        self.fake.search_issues = [i for i in self.fake.search_issues if i["key"] != key]
        self.fake.issue(key, RESOLVED, "indeterminate", minutes_ago - len(texts), comments=list(store),
                        summary=self.fake.summaries.get(key), labels=["tk-studio-decision"])

    def test_a_full_answer_writes_the_ledger_replies_and_moves_to_done(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "DW-3: A\nall: B")
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["counts"]["decisions_ingested"], 2)
        self.assertEqual(result["counts"]["decisions_done"], 1)
        text = self.ledger.read_text(encoding="utf-8")
        self.assertIn(f"### DW-3: three\nstatus: open\ndecision: A — Keep ({key}, 2026-10-24)\n", text)
        self.assertIn(f"### DW-12: twelve\nstatus: open\ndecision: B — Drop — nothing reads it ({key}, 2026-10-24)\n", text)
        self.assertEqual(self.fake.posted[key][-1],
                         "Ingested: DW-3: A — Keep; DW-12: B — Drop — nothing reads it\nStill open: none")
        self.assertEqual(self.fake.status[key], "Done")
        record = self.record()
        self.assertEqual(record["issues"][key]["state"], "done")
        self.assertEqual(record["answers"]["DW-3"]["letter"], "A")
        self.assertEqual(record["answers"]["DW-12"]["key"], "2")
        self.assertEqual(record["issues"][key]["cycles"][0]["ingested"], ["DW-3", "DW-12"])
        inbox_items = inbox.load(self.root)["items"]
        self.assertEqual([(i["issue"], i["decision"], i["state"]) for i in inbox_items],
                         [(key, {"ids": ["DW-3", "DW-12"]}, "resolved")])
        # the cycle is recorded: the next tick (the item unchanged) ingests nothing again
        posted = len(self.fake.posted[key])
        self.run_tick(minutes_later=20)
        self.assertEqual(len(self.fake.posted[key]), posted)

    def test_a_partial_answer_replies_and_re_blocks_naming_the_missing_ids(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "DW-3: E\nDW-12: B")
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["counts"]["decisions_reblocked"], 1)
        self.assertEqual(self.fake.posted[key][-2],
                         "Ingested: DW-12: B — Drop — nothing reads it\nStill open: DW-3 (no option E)")
        self.assertEqual(self.fake.posted[key][-1],
                         f"[~accountid:{OWNER}] Blocked: 1 sweep decision(s) still need your answer: DW-3\n"
                         'Resolves when: reply with one "<id>: <letter>" line per decision, "all: <letter>", or "default"')
        self.assertEqual(self.fake.status[key], BLOCKED)
        self.assertEqual(self.record()["issues"][key]["cycles"][0]["missing"], ["DW-3"])
        self.assertNotIn("decision: E", self.ledger.read_text(encoding="utf-8"))

    def test_a_temporary_failure_records_no_cycle_and_the_next_tick_retries(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "all: A")
        self.fake.force[("POST", f"/issue/{key}/comment")] = (503, "down")
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result.get("retry"))
        self.assertEqual(self.record()["issues"][key]["cycles"], [])
        del self.fake.force[("POST", f"/issue/{key}/comment")]
        self.run_tick(minutes_later=11)
        self.assertEqual(self.fake.status[key], "Done")
        # the ledger line written on the failed tick is idempotent
        self.assertEqual(self.ledger.read_text(encoding="utf-8").count(f"decision: A — Keep ({key}"), 2)

    def test_a_half_done_item_is_not_persisted_by_a_later_items_write(self):
        self.post()
        first, second = f"{KEY}-100", f"{KEY}-101"
        self.answered(first, "all: A")
        self.answered(second, "DW-5: B")
        self.fake.force[("POST", f"/issue/{first}/comment")] = (503, "down")
        result = self.run_tick(minutes_later=10)
        self.assertTrue(result.get("retry"))
        self.assertEqual(self.fake.status[second], "Done")  # the later item's write ran
        record = self.record()
        self.assertEqual(sorted(record["answers"]), ["DW-5"])
        self.assertEqual(record["issues"][first]["cycles"], [])
        del self.fake.force[("POST", f"/issue/{first}/comment")]
        self.run_tick(minutes_later=11)
        self.assertEqual(self.fake.posted[first][-1],
                         "Ingested: DW-3: A — Keep; DW-12: A — Keep\nStill open: none")
        self.assertEqual(self.fake.status[first], "Done")

    def test_no_move_to_done_records_the_cycle_once_over_two_ticks(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "all: A")
        self.fake.lacking[key] = {"Done"}  # no Done route on either tick
        result = self.run_tick(minutes_later=10)
        self.assertTrue(any("no move to 'Done'" in n and "cycle is recorded" in n
                            for n in result["notes"]))
        self.assertEqual(result["counts"]["decisions_done"], 0)
        self.run_tick(minutes_later=11)
        replies = [t for t in self.fake.posted[key] if t.startswith("Ingested:")]
        self.assertEqual(replies, ["Ingested: DW-3: A — Keep; DW-12: A — Keep\nStill open: none"])
        record = self.record()
        self.assertEqual(len(record["issues"][key]["cycles"]), 1)
        self.assertEqual(record["issues"][key]["cycles"][0]["ingested"], ["DW-3", "DW-12"])
        self.assertEqual(record["issues"][key]["state"], "open")
        self.assertEqual(sorted(record["answers"]), ["DW-12", "DW-3"])
        self.assertNotEqual(self.fake.status[key], "Done")

    def test_a_refused_re_block_records_the_cycle_with_a_note(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "DW-12: B")
        self.fake.no_blocked.add(key)
        result = self.run_tick(minutes_later=10)
        self.assertTrue(any("re-block" in n and "cycle is recorded" in n for n in result["notes"]))
        self.assertEqual(result["counts"]["decisions_reblocked"], 0)
        self.assertEqual(self.record()["issues"][key]["cycles"][0]["missing"], ["DW-3"])
        self.fake.no_blocked.discard(key)
        posted = len(self.fake.posted[key])
        self.run_tick(minutes_later=11)  # the cycle is recorded: nothing again
        self.assertEqual(len(self.fake.posted[key]), posted)
        self.assertEqual(len(self.record()["issues"][key]["cycles"]), 1)

    def test_a_refused_done_move_after_the_reply_records_the_cycle_once(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "all: A")
        self.fake.force[("POST", f"/issue/{key}/transitions")] = (400, {"errorMessages": ["no"]})
        result = self.run_tick(minutes_later=10)
        self.assertFalse(result.get("retry"))
        self.assertTrue(any(n.startswith(f"{key}: decision ingest:") and "cycle is recorded" in n
                            for n in result["notes"]))
        self.assertEqual(result["counts"]["decisions_done"], 0)
        self.run_tick(minutes_later=11)
        replies = [t for t in self.fake.posted[key] if t.startswith("Ingested:")]
        self.assertEqual(replies, ["Ingested: DW-3: A — Keep; DW-12: A — Keep\nStill open: none"])
        record = self.record()
        cycles = record["issues"][key]["cycles"]
        self.assertEqual(len(cycles), 1)
        self.assertEqual((cycles[0]["ingested"], cycles[0]["missing"]), (["DW-3", "DW-12"], []))
        self.assertEqual(sorted(record["answers"]), ["DW-12", "DW-3"])
        self.assertEqual(record["issues"][key]["state"], "open")
        self.assertNotEqual(self.fake.status[key], "Done")

    def test_a_refused_reply_records_the_cycle_with_a_note_and_no_second_attempt(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "DW-3: A")
        path = f"/issue/{key}/comment"
        self.fake.force[("POST", path)] = (400, {"errorMessages": ["refused"]})
        before = len([c for c in self.fake.calls if c[:2] == ("POST", path)])
        result = self.run_tick(minutes_later=10)
        self.assertFalse(result.get("retry"))
        self.assertTrue(any(n.startswith(f"{key}: decision ingest:") and "cycle is recorded" in n
                            for n in result["notes"]))
        attempts = len([c for c in self.fake.calls if c[:2] == ("POST", path)])
        self.assertEqual(attempts - before, 1)
        record = self.record()
        cycles = record["issues"][key]["cycles"]
        self.assertEqual(len(cycles), 1)
        # DW-3's ledger line was written before the refusal; DW-12 had no answer
        self.assertEqual((cycles[0]["ingested"], cycles[0]["missing"]), (["DW-3"], ["DW-12"]))
        self.assertEqual(sorted(record["answers"]), ["DW-3"])
        self.run_tick(minutes_later=11)
        self.assertEqual(len([c for c in self.fake.calls if c[:2] == ("POST", path)]), attempts)
        self.assertEqual(len(self.record()["issues"][key]["cycles"]), 1)

    def test_no_reason_comment_is_skipped_before_any_reply_or_ledger_line(self):
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "all: A")
        real_load, real_ingest = inbox.load, sd.ingest
        ledger_before = self.ledger.read_text(encoding="utf-8")
        posted = len(self.fake.posted.get(key) or [])

        def stripped(root):
            data = real_load(root)
            for item in data.get("items") or []:
                item.pop("reason_comment", None)
            return data

        def ingest(*args, **kwargs):
            with mock.patch.object(inbox, "load", stripped):
                return real_ingest(*args, **kwargs)
        with mock.patch.object(sd, "ingest", ingest):
            result = self.run_tick(minutes_later=10)
        self.assertTrue(any("no block comment to key the cycle on" in n and "skipped" in n
                            for n in result["notes"]))
        self.assertEqual(len(self.fake.posted.get(key) or []), posted)
        self.assertEqual(self.ledger.read_text(encoding="utf-8"), ledger_before)
        record = self.record()
        self.assertEqual(record["issues"][key]["cycles"], [])
        self.assertEqual(record["answers"], {})
        self.assertEqual(result["counts"]["decisions_ingested"], 0)
        self.assertNotEqual(self.fake.status[key], "Done")

    def test_a_legacy_entry_is_kept_and_unreadable_options_re_block(self):
        key = f"{KEY}-220"
        legacy = {key: {"theme": "x", "dw": "DW-5", "posted": "2026-11-05"}}
        path = self.root / sd.RECORD_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(legacy), encoding="utf-8")
        self.fake.status[key] = BLOCKED
        self.fake.summaries[key] = "Decision: DW-5 — another?"
        self.fake.comment_store[key] = [comment("a1", AGENT, f"[~accountid:{OWNER}] Blocked: please\nResolves when: x", 5)]
        self.answered(key, "all: A")
        self.run_tick(minutes_later=10)
        self.assertEqual(self.fake.posted[key][-2],
                         "Ingested: none\nStill open: DW-5 (not ingested: options unreadable)")
        self.assertEqual(self.fake.status[key], BLOCKED)
        record = self.record()
        self.assertEqual(record["issues"][key], legacy[key])  # kept as it was
        self.assertEqual(record["legacy_cycles"][0]["missing"], ["DW-5"])

    def test_a_legacy_entry_with_readable_options_is_ingested(self):
        key = f"{KEY}-221"
        path = self.root / sd.RECORD_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([{"key": key, "ids": "DW-5"}]), encoding="utf-8")
        self.fake.status[key] = BLOCKED
        self.fake.summaries[key] = "Decision: DW-5"
        self.fake.comment_store[key] = [comment("a1", AGENT, f"[~accountid:{OWNER}] Blocked: please\nResolves when: x", 5)]
        self.fake.force[("GET", f"/issue/{key}")] = (200, {"key": key, "fields": {
            "description": "A) accept and close\nB) build it\nDefault: A",
            "status": {"name": RESOLVED, "statusCategory": {"key": "indeterminate"}}}})
        self.answered(key, "default")
        self.run_tick(minutes_later=10)
        self.assertIn(f"decision: A — accept and close ({key}, 2026-10-24)", self.ledger.read_text(encoding="utf-8"))
        self.assertEqual(self.fake.status[key], "Done")

    def test_a_temporary_failure_after_the_reply_retries_only_the_move(self):
        """Review patch 3: the reply is posted, the Done move hits a 503 — the
        next tick posts no second reply and does move the issue to Done."""
        self.post()
        key = f"{KEY}-100"
        self.answered(key, "all: A")
        self.fake.force[("POST", f"/issue/{key}/transitions")] = (503, "down")
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result.get("retry"))
        self.assertNotEqual(self.fake.status[key], "Done")
        # follow-up review patch 2: a retried move is not also "not retried"
        self.assertEqual([n for n in result["notes"] if "not retried" in n], [])
        cycles = self.record()["issues"][key]["cycles"]
        self.assertEqual(len(cycles), 1)
        self.assertEqual((cycles[0]["ingested"], cycles[0]["missing"], cycles[0].get("move_pending")),
                         (["DW-3", "DW-12"], [], True))
        self.assertEqual(sorted(self.record()["answers"]), ["DW-12", "DW-3"])
        del self.fake.force[("POST", f"/issue/{key}/transitions")]
        again = self.run_tick(minutes_later=11)
        self.assertEqual(self.fake.status[key], "Done")
        self.assertEqual(again["counts"]["decisions_done"], 1)
        self.assertEqual(again["counts"]["decisions_ingested"], 0)
        replies = [t for t in self.fake.posted[key] if t.startswith("Ingested:")]
        self.assertEqual(replies, ["Ingested: DW-3: A — Keep; DW-12: A — Keep\nStill open: none"])
        record = self.record()
        self.assertEqual(len(record["issues"][key]["cycles"]), 1)
        self.assertNotIn("move_pending", record["issues"][key]["cycles"][0])
        self.assertEqual(record["issues"][key]["state"], "done")
        posted = len(self.fake.posted[key])
        self.run_tick(minutes_later=12)
        self.assertEqual(len(self.fake.posted[key]), posted)

    def test_the_shipped_group_keyed_legacy_file_is_indexed_by_issue(self):
        """Review patch 1: the 2026-11-05 record is keyed by group name
        (`DW-32`, `R1`, `HUD`, …), each entry naming its `issue`."""
        open_key = f"{KEY}-220"
        legacy = {
            "DW-32": {"issue": f"{KEY}-206", "ids": ["DW-32"], "default": "B", "blocked": True,
                      "comment_id": "10265", "posted": "2026-11-05T21:26:23Z", "answer": "A",
                      "answered": "2026-11-05T17:0xZ", "ingested": "https://example.invalid/pull/332",
                      "status": "Done"},
            "R1": {"issue": f"{KEY}-207", "ids": ["DW-8", "DW-9"], "default": "A", "blocked": True,
                   "comment_id": "10266", "posted": "2026-11-05T21:26:49Z", "status": "Done"},
            "HUD": {"issue": f"{KEY}-213", "ids": ["DW-3"], "default": "A", "blocked": True,
                    "comment_id": "10272", "posted": "2026-11-05T21:27:01Z", "status": "Done"},
            "R6": {"issue": open_key, "ids": ["DW-87", "DW-88"], "default": "A", "blocked": True,
                   "comment_id": "10300", "posted": "2026-11-05T21:28:00Z"},
        }
        path = self.root / sd.RECORD_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(legacy), encoding="utf-8")
        loaded = sd.load_record(self.root)
        self.assertEqual(sorted(loaded["issues"]), sorted(v["issue"] for v in legacy.values()))
        self.assertNotIn("DW-32", loaded["issues"])
        self.assertNotIn("DW-32", loaded)
        self.assertEqual(loaded["issues"][f"{KEY}-207"]["group"], "R1")
        self.assertEqual(sd.entry_ids(loaded["issues"][open_key]), ["DW-87", "DW-88"])

        def kept_every_entry():
            issues = self.record()["issues"]
            for group, entry in legacy.items():
                stored = issues[entry["issue"]]
                self.assertEqual({k: stored[k] for k in entry}, entry)
                self.assertEqual(stored["group"], group)

        # the post: a Done legacy entry is not asked; an open one is asked on its issue
        with self.ledger.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n### DW-87: eighty-seven\nstatus: open\n\n### DW-88: eighty-eight\nstatus: open\n")
        self.triage([decision("DW-12"), decision("DW-3"), decision("DW-5", question="another?"),
                     decision("DW-87", question="third?")])
        result = self.post()
        self.assert_track_block(result, "complete")
        self.assertFalse(any("already asked on DW-" in s for s in result["skipped"]))
        self.assertEqual(result["skipped"], [f"DW-87: already asked on {open_key}"])
        self.assertIn(["DW-3", "DW-12"], [i["ids"] for i in result["issues"]])
        kept_every_entry()

        # the ingest: the returning issue matched to its entry and the entry's ids
        self.fake.status[open_key] = BLOCKED
        self.fake.summaries[open_key] = "Decision: DW-87"
        self.fake.comment_store[open_key] = [comment("a1", AGENT, f"[~accountid:{OWNER}] Blocked: please\nResolves when: x", 5)]
        self.fake.force[("GET", f"/issue/{open_key}")] = (200, {"key": open_key, "fields": {
            "description": "A) accept and close\nB) build it\nDefault: A",
            "status": {"name": RESOLVED, "statusCategory": {"key": "indeterminate"}}}})
        self.answered(open_key, "all: A")
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["counts"]["decisions_ingested"], 2)
        item = next(i for i in inbox.load(self.root)["items"] if i["issue"] == open_key)
        self.assertEqual(item["decision"], {"ids": ["DW-87", "DW-88"]})
        self.assertEqual(self.fake.posted[open_key][-1],
                         "Ingested: DW-87: A — accept and close; DW-88: A — accept and close\nStill open: none")
        self.assertEqual(self.fake.status[open_key], "Done")
        text = self.ledger.read_text(encoding="utf-8")
        for dw in ("DW-87", "DW-88"):
            self.assertIn(f"decision: A — accept and close ({open_key}, 2026-10-24)", text.split(f"### {dw}:")[1])
        record = self.record()
        self.assertEqual([(c["issue"], c["ingested"]) for c in record["legacy_cycles"]],
                         [(open_key, ["DW-87", "DW-88"])])
        self.assertEqual(record["answers"]["DW-88"]["issue"], open_key)
        kept_every_entry()
        # the write-back round-trip is stable
        sd.write_record(self.root, sd.load_record(self.root))
        kept_every_entry()
        self.assertEqual(sd.load_record(self.root)["issues"], record["issues"])


if __name__ == "__main__":
    unittest.main()
