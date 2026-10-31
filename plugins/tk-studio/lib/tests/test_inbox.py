"""Tests for the inbox the sync-back derives (Story 31.5, AC2).

`inbox.derive` runs inside `syncback.tick`, so these drive the whole tick
through `plansync.sync_back` with the sync-back's fake Atlassian REST (no
network). Covered: the state by status name (canonical `blocked` alone is
never enough), the reason comment (the agent's mention of the owner), the
priority (pulled, else canonical, else null), the sort, the merge (an issue
not returned keeps its item, a local entity adds one), an issue leaving the
setup statuses, `validating` kept, and every failed tick leaving the
previous file untouched.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import inbox  # noqa: E402
import interchange  # noqa: E402
import jirabackend  # noqa: E402
import plansync  # noqa: E402

from test_syncback import (AGENT, KEY, OWNER, NOW, SyncBackTestCase,  # noqa: E402
                           comment, stamp)

BLOCKED = jirabackend.BLOCKED_STATUS
RESOLVED = jirabackend.RESOLVED_STATUS


class InboxTestCase(SyncBackTestCase):
    def inbox(self) -> dict:
        return json.loads((self.root / inbox.INBOX_REL).read_text(encoding="utf-8"))

    def items(self) -> list[dict]:
        return self.inbox()["items"]

    def set_priority(self, entity_id, priority):
        path = plansync.plan_dir(self.root) / f"{entity_id}.md"
        front, body = interchange.parse_entity(path)
        front["priority"] = priority
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")

    def block_comment(self, cid, minutes_ago, reason="needs a token"):
        return comment(cid, AGENT, f"[~accountid:{OWNER}] Blocked: {reason}\n"
                                   f"Resolves when: the owner answers",
                       minutes_ago)


class StateTests(InboxTestCase):
    def test_the_shape_and_the_state_by_name(self):
        self.bind("ST-002", f"{KEY}-2", "To Do", "ready")
        self.bind("ST-003", f"{KEY}-3", "To Do", "ready")
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30,
                        comments=[self.block_comment("c1", 35),
                                  comment("c0", OWNER, "an older owner "
                                          f"note [~accountid:{AGENT}]", 50)],
                        priority="High")
        self.fake.issue(f"{KEY}-2", RESOLVED, "indeterminate", 25,
                        priority="Low")
        self.fake.issue(f"{KEY}-3", "In Progress", "indeterminate", 20)
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        data = self.inbox()
        self.assertEqual(sorted(data), ["generated_at", "inbox_version",
                                        "items", "project_key"])
        self.assertEqual((data["inbox_version"], data["project_key"]),
                         (1, KEY))
        self.assertEqual(data["generated_at"], NOW.isoformat(timespec="seconds"))
        first, second = data["items"]
        self.assertEqual(first, {
            "issue": f"{KEY}-1", "entity": "ST-001", "title": "Alpha Story",
            "priority": "High", "blocked_since": stamp(35),
            "reason_comment": {"id": "c1", "body": self.block_comment(
                "c1", 35)["body"], "created": stamp(35)},
            "state": "open"})
        # no block comment: blocked_since is when the tick first saw it
        self.assertEqual((second["issue"], second["state"], second["priority"],
                          second["reason_comment"], second["blocked_since"]),
                         (f"{KEY}-2", "resolved", "Low", None,
                          NOW.isoformat(timespec="seconds")))

    def test_an_engagement_questions_issue_carries_engagement(self):
        # Story 32.3: `ENG-NNN: questions` (no plan entity) is an item with
        # `engagement` and the summary as `title`; the engagement's block
        # comment (`track.py block --engagement`) fills `reason_comment`
        body = (f"[~accountid:{OWNER}] Blocked: ENG-001 needs 1 answer(s)\n"
                f'Resolves when: reply with one "<id>: <option>" line per '
                f"question\n\nscope: How big?\nImpact: the quote\n"
                f"- Small (default)\n- Large")
        self.fake.issue(f"{KEY}-40", BLOCKED, "indeterminate", 30,
                        comments=[comment("c9", AGENT, body, 31)],
                        summary="ENG-001: questions")
        self.fake.issue(f"{KEY}-41", BLOCKED, "indeterminate", 29,
                        summary="ENG-001: questions, again")  # not exact
        self.run_tick()
        first, second = self.items()
        self.assertEqual(first, {
            "issue": f"{KEY}-40", "engagement": "ENG-001",
            "title": "ENG-001: questions", "priority": None,
            "blocked_since": stamp(31),
            "reason_comment": {"id": "c9", "body": body,
                               "created": stamp(31)},
            "state": "open"})
        self.assertNotIn("engagement", second)

    def test_canonical_blocked_alone_is_never_an_item(self):
        # a local entity canonically `blocked` whose Jira status is not one
        # of the two setup statuses is no inbox item
        self.bind("ST-002", f"{KEY}-2", "On Hold", "blocked")
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30)
        self.run_tick()
        self.assertEqual(self.items(), [])

    def test_an_agent_comment_without_the_owner_mention_is_no_reason(self):
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30,
                        comments=[comment("c1", AGENT, "a plain note", 35),
                                  comment("c2", OWNER,
                                          f"[~accountid:{OWNER}] me", 34)])
        self.run_tick()
        self.assertIsNone(self.items()[0]["reason_comment"])

    def test_a_colleagues_newer_mention_of_the_owner_is_not_the_reason(self):
        # every non-owner account logs as `agent`: only the block comment's
        # shape (the owner's mention, then `Blocked:`) makes it the reason
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30,
                        comments=[self.block_comment("c1", 35),
                                  comment("c2", "acc-colleague",
                                          f"hey [~accountid:{OWNER}] see this",
                                          32)])
        self.run_tick()
        item = self.items()[0]
        self.assertEqual(item["reason_comment"]["id"], "c1")
        self.assertEqual(item["blocked_since"], stamp(35))

    def test_validating_is_kept_while_still_block_resolved(self):
        self.fake.issue(f"{KEY}-1", RESOLVED, "indeterminate", 30)
        self.run_tick()
        data = self.inbox()
        data["items"][0]["state"] = "validating"  # 31.7 writes it
        (self.root / inbox.INBOX_REL).write_text(json.dumps(data), encoding="utf-8")
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-1", RESOLVED, "indeterminate", 5)
        self.run_tick(minutes_later=10)
        self.assertEqual(self.items()[0]["state"], "validating")
        # back to Blocked - Awaiting User: open again
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", -15)
        self.run_tick(minutes_later=20)
        self.assertEqual(self.items()[0]["state"], "open")

    def test_mark_validating_rewrites_one_items_state_and_derive_keeps_it(self):
        # Story 31.7: `validate --check` marks the item; nothing else moves
        self.bind("ST-002", f"{KEY}-2", "To Do", "ready")
        self.fake.issue(f"{KEY}-1", RESOLVED, "indeterminate", 30,
                        comments=[self.block_comment("c1", 35)])
        self.fake.issue(f"{KEY}-2", RESOLVED, "indeterminate", 25)
        self.run_tick()
        before = self.inbox()
        self.assertTrue(inbox.mark_validating(self.root, f"{KEY}-1"))
        after = self.inbox()
        self.assertEqual(after["items"][0]["state"], "validating")
        after["items"][0]["state"] = "resolved"
        self.assertEqual(after, before)
        # already validating, an unknown key, or no file: False, untouched
        self.assertFalse(inbox.mark_validating(self.root, f"{KEY}-1"))
        self.assertFalse(inbox.mark_validating(self.root, f"{KEY}-9"))
        (self.root / inbox.INBOX_REL).unlink()
        self.assertFalse(inbox.mark_validating(self.root, f"{KEY}-1"))
        self.assertFalse((self.root / inbox.INBOX_REL).exists())


class PriorityAndSortTests(InboxTestCase):
    def test_sorted_by_priority_rank_null_last_then_blocked_since(self):
        for n, eid in ((2, "ST-002"), (3, "ST-003")):
            self.bind(eid, f"{KEY}-{n}", "To Do", "ready")
        self.bind("EP-001", f"{KEY}-4", "To Do", "ready")
        self.set_priority("ST-003", "P0")       # canonical, no Jira priority
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30,
                        comments=[self.block_comment("c1", 40)])  # null
        self.fake.issue(f"{KEY}-2", BLOCKED, "indeterminate", 29,
                        comments=[self.block_comment("c2", 50)],
                        priority="Medium")
        self.fake.issue(f"{KEY}-3", BLOCKED, "indeterminate", 28,
                        comments=[self.block_comment("c3", 45)])
        self.fake.issue(f"{KEY}-4", RESOLVED, "indeterminate", 27,
                        comments=[self.block_comment("c4", 60)],
                        priority="Medium")
        self.run_tick()
        self.assertEqual([(i["issue"], i["priority"]) for i in self.items()],
                         [(f"{KEY}-3", "Highest"), (f"{KEY}-4", "Medium"),
                          (f"{KEY}-2", "Medium"), (f"{KEY}-1", None)])

    def test_the_jira_priority_wins_over_the_canonical(self):
        self.set_priority("ST-001", "P3")
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30,
                        priority="Highest")
        self.run_tick()
        self.assertEqual(self.items()[0]["priority"], "Highest")

    def test_canonical_mapping(self):
        self.assertEqual(inbox.CANONICAL_PRIORITY,
                         {"P0": "Highest", "P1": "High", "P2": "Medium",
                          "P3": "Low"})


class MergeTests(InboxTestCase):
    def test_an_issue_not_returned_keeps_its_item(self):
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30,
                        comments=[self.block_comment("c1", 35)])
        self.run_tick()
        before = self.items()
        self.fake.search_issues = []  # unchanged `updated`: not returned
        result = self.run_tick(minutes_later=10)
        self.assertIn(inbox.INBOX_REL.as_posix(), result["written"])
        self.assertEqual(self.items(), before)
        self.assertEqual(len(self.fake.jql), 2)  # one search per tick

    def test_an_engagement_item_keeps_engagement_from_the_previous_item(self):
        # Story 32.3: a later tick that returns the issue without its
        # summary keeps `engagement` (and `title`) from the previous item
        self.fake.issue(f"{KEY}-40", BLOCKED, "indeterminate", 30,
                        summary="ENG-002: questions")
        self.run_tick()
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-40", RESOLVED, "indeterminate", 5)
        self.run_tick(minutes_later=10)
        (item,) = self.items()
        self.assertEqual((item["engagement"], item["title"], item["state"]),
                         ("ENG-002", "ENG-002: questions", "resolved"))

    def test_an_issue_leaving_the_setup_statuses_leaves_the_inbox(self):
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30)
        self.run_tick()
        self.assertEqual(len(self.items()), 1)
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 2)
        self.run_tick(minutes_later=10)
        self.assertEqual(self.items(), [])

    def test_a_local_entity_in_a_setup_status_is_added(self):
        self.bind("ST-002", f"{KEY}-2", BLOCKED, "blocked")
        self.set_priority("ST-002", "P1")
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30)
        self.run_tick()
        (item,) = self.items()
        self.assertEqual((item["issue"], item["entity"], item["title"],
                          item["priority"], item["state"]),
                         (f"{KEY}-2", "ST-002", "Beta Story", "High", "open"))


    def test_a_stale_snapshot_never_re_adds_a_dropped_item(self):
        self.bind("ST-002", f"{KEY}-2", BLOCKED, "blocked")
        self.fake.issue(f"{KEY}-2", BLOCKED, "indeterminate", 30)
        self.run_tick()
        self.assertEqual([i["issue"] for i in self.items()], [f"{KEY}-2"])
        # tick N: the issue left the setup statuses, its item is dropped
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-2", "In Progress", "indeterminate", 2)
        self.run_tick(minutes_later=10)
        self.assertEqual(self.items(), [])
        # a both-changed conflict (or an unmapped status) leaves the recorded
        # snapshot at the setup status; tick N+1 does not return the issue
        self.bind("ST-002", f"{KEY}-2", BLOCKED, "blocked")
        self.fake.search_issues = []
        result = self.run_tick(minutes_later=20)
        self.assertIn(inbox.INBOX_REL.as_posix(), result["written"])
        self.assertEqual(self.items(), [])
        self.run_tick(minutes_later=30)
        self.assertEqual(self.items(), [])

    def test_an_existing_inbox_file_is_never_seeded_from_snapshots(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30)
        self.run_tick()
        self.assertEqual(self.items(), [])
        self.bind("ST-002", f"{KEY}-2", BLOCKED, "blocked")
        self.fake.search_issues = []
        self.run_tick(minutes_later=10)
        self.assertEqual(self.items(), [])


class FailedTickTests(InboxTestCase):
    def setUp(self):
        super().setUp()
        self.fake.issue(f"{KEY}-1", BLOCKED, "indeterminate", 30)
        self.run_tick()
        self.path = self.root / inbox.INBOX_REL
        self.before = self.path.read_bytes()
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-1", "Done", "done", 2)

    def assert_untouched(self, result):
        self.assertEqual(self.path.read_bytes(), self.before)
        self.assertNotIn(inbox.INBOX_REL.as_posix(), result["written"])

    def test_dry_run(self):
        self.assert_untouched(self.run_tick(minutes_later=10, dry_run=True))

    def test_rate_limited(self):
        self.fake.force[("GET", "/search/jql")] = (
            429, {"errorMessages": ["slow"]}, {"Retry-After": "1"})
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["case"], "rate-limited")
        self.assert_untouched(result)

    def test_error(self):
        self.fake.force[("GET", "/search/jql")] = (400, {"errorMessages": ["x"]})
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["case"], "error")
        self.assert_untouched(result)

    def test_blocked(self):
        self.fake.force[("GET", "/myself")] = (503, "Service Unavailable")
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["status"], "blocked")
        self.assert_untouched(result)

    def test_an_interrupted_page_read(self):
        self.fake.search_issues = []
        for n in range(3):
            self.fake.issue(f"{KEY}-{n + 1}", "Done", "done", 3 - n)
        self.fake.fail_token = "2"
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["status"], "partial")
        self.assert_untouched(result)


if __name__ == "__main__":
    unittest.main()
