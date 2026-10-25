"""Tests for the sync-back on a timer (Story 31.4).

`plansync.sync_back` sequences the tick in `syncback` (AD-4) through the
agent seat's gateway tokens. `FakeSyncBack` extends the setup fake with the
routes the tick reads — `GET /search/jql` (paged by `nextPageToken`), the
comment overflow `GET /issue/{key}/comment` and the Confluence
`GET /spaces/{id}/pages` — whose shapes are ungraded on the live site and
pinned here. No test makes a network call. Covered: the status mapping
(both setup statuses), the append-once comment log and edits, the attachment
links, the page mirror and the overwrite report, the cursor (an interrupted
tick included), the 429 path, the three named states and the refusals.
Story 32.4: an engagement's scope page read by id (`FakeScopeSyncBack`): an
owner edit in `scoping` replaces `scope.md` wholesale and merges the
version, in `quoted` only the mirror and a note, an unchanged version
nothing, a 404 a note.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import sys
import unittest
import unittest.mock
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "skills"
                       / "tk-studio-activate" / "scripts"))

import confluence  # noqa: E402
import drift_check  # noqa: E402
import engage  # noqa: E402
import interchange  # noqa: E402
import jirabackend  # noqa: E402
import plansync  # noqa: E402
import syncback  # noqa: E402

from test_plansync import EPICS_DOC  # noqa: E402
from test_tracking_setup import FakeAtlassian, SetupTestCase, SITE  # noqa: E402

KEY = "TKSTUDIO"
NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
OWNER, AGENT = "acc-owner", "acc-agent"


def stamp(minutes_ago: float) -> str:
    """A Jira-shaped `updated` (`…T…+0000`)."""
    at = NOW - timedelta(minutes=minutes_ago)
    return at.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def comment(cid, author, body, minutes_ago, edited_ago=None, updater=None):
    return {"id": cid, "author": {"accountId": author},
            "updateAuthor": {"accountId": updater or author}, "body": body,
            "created": stamp(minutes_ago),
            "updated": stamp(minutes_ago if edited_ago is None else edited_ago)}


class FakeSyncBack(FakeAtlassian):
    """FakeAtlassian plus the sync-back read routes."""

    def __init__(self):
        super().__init__()
        self.search_issues: list[dict] = []
        self.search_page = 2
        self.fail_token = None        # a nextPageToken answered with 500
        self.comment_store: dict[str, list[dict]] = {}
        self.space_pages: list[dict] = []
        self.jql: list[str] = []
        self.headers = {"X-RateLimit-Limit": "200", "RateLimit-Policy": "burst"}

    def _jira(self, method, path, query, body):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        if method == "GET" and path == "/search/jql":
            self.jql.append(q["jql"])
            # Story 32.3: `summary` rides the one search (the engagement item)
            assert q["fields"] == ("status,updated,comment,attachment,"
                                   "priority,summary"), q
            token = q.get("nextPageToken")
            if token is not None and token == self.fail_token:
                return 500, {"errorMessages": ["boom"]}
            start = int(token or 0)
            page = self.search_issues[start:start + self.search_page]
            data = {"issues": page}
            if start + len(page) < len(self.search_issues):
                data["nextPageToken"] = str(start + len(page))
            return 200, data, dict(self.headers)
        m = re.match(r"^/issue/([^/]+)/comment$", path)
        if method == "GET" and m:
            values = self.comment_store.get(m.group(1), [])
            start = int(q.get("startAt", 0))
            page = values[start:start + 2]
            return 200, {"comments": page, "startAt": start,
                         "total": len(values)}
        return super()._jira(method, path, query, body)

    def _confluence(self, method, path, query, body):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        m = re.match(r"^/spaces/([^/]+)/pages$", path)
        if method == "GET" and m:
            assert q.get("body-format") == "storage", q
            assert q.get("limit") == "250", q
            return self._cursor_page(path, self.space_pages, q)
        return super()._confluence(method, path, query, body)

    def page(self, pid, title, body, author=OWNER, version=1):
        entry = {"id": pid, "title": title, "authorId": author,
                 "version": {"number": version},
                 "body": {"storage": {"value": body,
                                      "representation": "storage"}},
                 "_links": {"webui": f"/spaces/{KEY}/pages/{pid}"}}
        self.space_pages = [p for p in self.space_pages if p["id"] != pid]
        self.space_pages.append(entry)
        return entry

    def issue(self, key, status, category, minutes_ago, comments=(),
              attachments=(), total=None, priority=None, summary=None):
        entry = {"key": key, "fields": {
            "status": {"name": status, "statusCategory": {"key": category}},
            "updated": stamp(minutes_ago),
            "comment": {"comments": list(comments),
                        "total": len(comments) if total is None else total},
            "attachment": list(attachments)}}
        if priority is not None:
            entry["fields"]["priority"] = {"name": priority}
        if summary is not None:
            entry["fields"]["summary"] = summary
        self.search_issues.append(entry)
        return entry


class SyncBackTestCase(SetupTestCase):
    def setUp(self):
        super().setUp()
        self.fake = FakeSyncBack()
        self.sleeps: list[float] = []
        plansync.write_binding(self.root, {
            "jira": {"site": SITE, "project_key": KEY,
                     "owner_account_id": OWNER, "agent_account_id": AGENT},
            "confluence": {"space_key": KEY, "space_id": "S-1"}})
        planning = self.root / "_bmad-output" / "planning-artifacts"
        planning.mkdir(parents=True)
        (planning / "epics.md").write_text(EPICS_DOC, encoding="utf-8",
                                           newline="\n")
        plansync.normalize(self.root)
        self.bind("ST-001", f"{KEY}-1", "In Progress", "in-progress")

    # ---- helpers
    def entity(self, entity_id):
        path = plansync.plan_dir(self.root) / f"{entity_id}.md"
        return interchange.parse_entity(path)

    def bind(self, entity_id, jira_key, jira_status, canonical):
        path = plansync.plan_dir(self.root) / f"{entity_id}.md"
        front, body = interchange.parse_entity(path)
        front["status"] = canonical
        front["external"] = {"jira": {
            "key": jira_key, "status": jira_status,
            "canonical_status": canonical, "assignee": "",
            "canonical_assignee": "", "content_hash": "x",
            "synced_at": "2026-10-24T00:00:00+00:00"}}
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")

    def run_tick(self, minutes_later=0, **kwargs):
        return plansync.sync_back(
            self.root, transport=self.fake, sleep=self.sleeps.append,
            now=NOW + timedelta(minutes=minutes_later), **kwargs)

    def lines(self, rel):
        path = self.root / rel
        return [json.loads(l) for l in
                path.read_text(encoding="utf-8").splitlines()] \
            if path.is_file() else []

    def state(self):
        return json.loads((self.root / syncback.STATE_REL)
                          .read_text(encoding="utf-8"))

    def assert_block_last(self, result, status):
        self.assertEqual(list(result)[-4:], list(plansync.SETUP_BLOCK_KEYS))
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-plan-sync")
        self.assertEqual(result["artifacts"], result["written"])

    def happy(self):
        self.fake.issue(f"{KEY}-1", "Done", "done", 30, comments=[
            comment("c1", OWNER, f"please look [~accountid:{AGENT}]", 40),
            comment("c2", AGENT, f"on it [~accountid:{OWNER}] "
                                 f"[~accountid:acc-other]", 35)],
            attachments=[{"id": "a1", "filename": "shot.png",
                          "mimeType": "image/png", "size": 1234,
                          "author": {"accountId": OWNER},
                          "created": stamp(39),
                          "content": "https://api.atlassian.com/a1/content"}])
        self.fake.issue(f"{KEY}-9", "To Do", "new", 20)  # an inbox issue
        self.fake.page("P-1", "Owner Notes", "<p>Hello <b>owner</b></p>")
        self.fake.page("P-2", "Agent Page", "<p>x</p>", author=AGENT)


class HappyTickTests(SyncBackTestCase):
    def test_happy_tick(self):
        self.happy()
        self.fake.search_page = 1
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        self.assertTrue(result["ok"])
        self.assertEqual(result["case"], "ok")
        # one paged search (two pages of one), never a GET per issue; the
        # first tick has no bound
        self.assertEqual(self.fake.jql,
                         [f'project = "{KEY}" ORDER BY updated ASC'] * 2)
        self.assertFalse([c for c in self.fake.calls
                          if re.match(r"^/issue/[^/]+$", c[1])])
        self.assertFalse(self.fake.writes())  # nothing promoted
        # status applied, the Jira original kept
        front, _ = self.entity("ST-001")
        self.assertEqual(front["status"], "done")
        self.assertEqual(front["external"]["jira"]["status"], "Done")
        self.assertEqual([a["id"] for a in result["applied"]], ["ST-001"])
        # comments
        log = self.lines(f"_bmad-output/tracking/{KEY}-1/comments.jsonl")
        self.assertEqual([sorted(l) for l in log][0],
                         sorted(["issue", "id", "author", "update_author",
                                 "body", "mentions", "created", "updated",
                                 "source"]))
        self.assertEqual([(l["id"], l["author"], l["mentions"]) for l in log],
                         [("c1", "owner", ["agent"]),
                          ("c2", "agent", ["owner", "acc-other"])])
        self.assertEqual({l["source"] for l in log}, {"jira"})
        self.assertEqual(log[0]["issue"], f"{KEY}-1")
        # attachments as links
        atts = self.lines(f"_bmad-output/tracking/{KEY}-1/attachments.jsonl")
        self.assertEqual(atts, [{"issue": f"{KEY}-1", "id": "a1",
                                 "filename": "shot.png", "mime": "image/png",
                                 "size": 1234, "author": "owner",
                                 "created": stamp(39),
                                 "url": "https://api.atlassian.com/a1/content",
                                 "source": "jira"}])
        # the mirror: the owner's page only
        mirror = self.root / "kb" / "confluence" / "owner-notes.md"
        text = mirror.read_bytes().decode("utf-8")
        body = "<p>Hello <b>owner</b></p>"
        self.assertTrue(text.endswith("---\n" + body))
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        for line in ("source: confluence", 'page_id: "P-1"',
                     'title: "Owner Notes"', f'space_key: "{KEY}"',
                     "author: owner", "version: 1",
                     f'url: "https://{SITE}/wiki/spaces/{KEY}/pages/P-1"',
                     "read_only: true", f"content_hash: sha256:{digest}"):
            self.assertIn(line + "\n", text)
        self.assertFalse((self.root / "kb" / "confluence" /
                          "agent-page.md").exists())
        self.assertFalse((self.root / "kb" / "index.md").exists())
        # counts, newest comment, cursor, written[]
        counts = result["counts"]
        self.assertEqual((counts["issues"], counts["comments_appended"],
                          counts["attachments_appended"],
                          counts["pages_mirrored"]), (2, 2, 1, 1))
        self.assertEqual(result["newest_comment"]["id"], "c2")
        state = self.state()
        self.assertEqual(state["cursor"], stamp(20))
        self.assertEqual(state["last_run"]["status"], "complete")
        self.assertEqual(state["last_run"]["newest_comment"]["id"], "c2")
        self.assertEqual(state["pages"]["P-1"]["path"],
                         "kb/confluence/owner-notes.md")
        self.assertEqual(sorted(result["written"]), sorted([
            "_bmad-output/planning-artifacts/plan/ST-001.md",
            f"_bmad-output/tracking/{KEY}-1/comments.jsonl",
            f"_bmad-output/tracking/{KEY}-1/attachments.jsonl",
            "kb/confluence/owner-notes.md",
            "_bmad-output/tracking/sync-state.json",
            "_bmad-output/tracking/inbox.json",
            "_bmad-output/planning-artifacts/plan/index.md"]))
        # the observed rate-limit headers are recorded
        self.assertEqual(result["rate_limit"]["jira"]["headers"],
                         {"x-ratelimit-limit": "200",
                          "ratelimit-policy": "burst"})
        self.assertNotIn("fake-jira-token", json.dumps(result))
        self.assertNotIn("fake-jira-token",
                         (self.root / syncback.STATE_REL).read_text("utf-8"))

    def test_duplicate_key_across_pages_takes_the_latest(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 50)
        self.fake.issue(f"{KEY}-5", "To Do", "new", 45)
        self.fake.issue(f"{KEY}-1", "Done", "done", 10)
        result = self.run_tick()
        self.assertEqual(result["counts"]["issues"], 2)
        front, _ = self.entity("ST-001")
        self.assertEqual(front["status"], "done")
        self.assertEqual(self.state()["cursor"], stamp(10))

    def test_dry_run_reads_and_writes_nothing(self):
        self.happy()
        result = self.run_tick(dry_run=True)
        self.assertEqual(result["written"], [])
        self.assertFalse((self.root / "_bmad-output" / "tracking").exists())
        self.assertFalse((self.root / "kb").exists())
        front, _ = self.entity("ST-001")
        self.assertEqual(front["status"], "in-progress")
        self.assertEqual(result["counts"]["comments_appended"], 2)


class StatusMappingTests(SyncBackTestCase):
    def test_both_setup_statuses_map_to_blocked(self):
        self.fake.issue(f"{KEY}-1", jirabackend.BLOCKED_STATUS,
                        "indeterminate", 30)
        self.run_tick()
        front, _ = self.entity("ST-001")
        self.assertEqual(front["status"], "blocked")
        self.assertEqual(front["external"]["jira"]["status"],
                         "Blocked - Awaiting User")
        self.assertEqual(front["external"]["jira"]["canonical_status"],
                         "blocked")
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-1", jirabackend.RESOLVED_STATUS,
                        "indeterminate", 5)
        self.run_tick(minutes_later=10)
        front, _ = self.entity("ST-001")
        self.assertEqual(front["status"], "blocked")  # never in-progress
        self.assertEqual(front["external"]["jira"]["status"], "Block Resolved")

    def test_only_status_changes(self):
        _, body_before = self.entity("ST-001")
        before, _ = self.entity("ST-001")
        self.fake.issue(f"{KEY}-1", "Done", "done", 30)
        self.run_tick()
        front, body = self.entity("ST-001")
        self.assertEqual(body, body_before)
        for field in ("title", "id", "parent", "labels", "assignee"):
            self.assertEqual(front.get(field), before.get(field))

    def test_both_changed_is_a_conflict_and_partial(self):
        path = plansync.plan_dir(self.root) / "ST-001.md"
        front, body = interchange.parse_entity(path)
        front["status"] = "review"
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")
        self.fake.issue(f"{KEY}-1", "Done", "done", 30)
        result = self.run_tick()
        self.assert_block_last(result, "partial")
        self.assertEqual([c["id"] for c in result["conflicts"]], ["ST-001"])
        self.assertEqual(self.entity("ST-001")[0]["status"], "review")

    def test_an_applied_status_regenerates_the_plan_index(self):
        index = plansync.plan_dir(self.root) / "index.md"
        rel = "_bmad-output/planning-artifacts/plan/index.md"
        plansync.generate_plan_index(self.root)  # as the last `sync` left it
        self.assertNotIn("`done`", index.read_text("utf-8"))
        self.fake.issue(f"{KEY}-1", "Done", "done", 30)
        result = self.run_tick()
        self.assertIn(rel, result["written"])
        self.assertIn(rel, result["artifacts"])
        self.assertIn("`done`", index.read_text("utf-8"))
        self.assertEqual(index.read_text("utf-8"), plansync.render_plan_index(
            self.root.resolve().name,
            [interchange.parse_entity(p)[0] for p in
             interchange.scan_entities(plansync.plan_dir(self.root))[0]]))
        self.assertFalse(self.fake.writes())  # local-only: never a promote
        # no status change (an unchanged issue, a dry run): not rewritten
        second = self.run_tick(minutes_later=10)
        self.assertNotIn(rel, second["written"])
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-1", "To Do", "new", 2)
        before = index.read_text("utf-8")
        dry = self.run_tick(minutes_later=20, dry_run=True)
        self.assertNotIn(rel, dry["written"])
        self.assertEqual(index.read_text("utf-8"), before)

    def test_a_snapshot_only_refresh_is_not_counted(self):
        # `In Review` moves within the same canonical `in-progress`
        self.fake.issue(f"{KEY}-1", "In Review", "indeterminate", 30)
        result = self.run_tick()
        self.assertEqual(result["counts"]["statuses_applied"], 0)
        self.assertEqual([(a["id"], a["fields"]) for a in result["applied"]],
                         [("ST-001", ["external.jira.status"])])
        front, _ = self.entity("ST-001")
        self.assertEqual(front["status"], "in-progress")
        self.assertEqual(front["external"]["jira"]["status"], "In Review")


class CommentLogTests(SyncBackTestCase):
    REL = f"_bmad-output/tracking/{KEY}-1/comments.jsonl"

    def test_a_comment_seen_twice_is_written_once(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30,
                        comments=[comment("c1", OWNER, "hi", 40)])
        self.run_tick()
        second = self.run_tick(minutes_later=10)
        self.assertEqual(len(self.lines(self.REL)), 1)
        self.assertEqual(second["counts"]["comments_appended"], 0)
        self.assertEqual(second["counts"]["comments_seen"], 1)
        self.assertNotIn(self.REL, second["written"])

    def test_an_edit_appends_a_line_with_the_same_id(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30,
                        comments=[comment("c1", OWNER, "hi", 40)])
        self.run_tick()
        self.fake.search_issues = []
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 3,
                        comments=[comment("c1", OWNER, "hi (edited)", 40,
                                          edited_ago=3)])
        self.run_tick(minutes_later=10)
        log = self.lines(self.REL)
        self.assertEqual([(l["id"], l["body"]) for l in log],
                         [("c1", "hi"), ("c1", "hi (edited)")])

    def test_comment_overflow_pages_that_issue_only(self):
        store = [comment(f"c{i}", AGENT, f"n{i}", 50 - i) for i in range(5)]
        self.fake.comment_store[f"{KEY}-1"] = store
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30,
                        comments=store[:2], total=5)
        self.fake.issue(f"{KEY}-2", "To Do", "new", 25,
                        comments=[comment("d1", OWNER, "x", 26)])
        self.run_tick()
        reads = [c for c in self.fake.calls if c[1].endswith("/comment")]
        self.assertTrue(reads)
        self.assertEqual({c[1] for c in reads}, {f"/issue/{KEY}-1/comment"})
        self.assertEqual(len(self.lines(self.REL)), 5)

    def test_author_is_agent_unless_the_owner_id_matches(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30,
                        comments=[comment("c1", "", "blank", 40),
                                  comment("c2", "acc-stranger", "x", 39)])
        self.run_tick()
        self.assertEqual([l["author"] for l in self.lines(self.REL)],
                         ["agent", "agent"])

    def test_update_author_is_logged_on_new_lines(self):
        # Story 31.5 (additive): an owner's comment last edited by the agent
        # is not the owner's reply — `update_author` says who edited last
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30,
                        comments=[comment("c1", OWNER, "mine", 40),
                                  comment("c2", OWNER, "edited", 39,
                                          updater=AGENT),
                                  comment("c3", AGENT, "agent's", 38)])
        self.run_tick()
        self.assertEqual([(l["author"], l["update_author"])
                          for l in self.lines(self.REL)],
                         [("owner", "owner"), ("owner", "agent"),
                          ("agent", "agent")])

    def test_old_lines_without_update_author_are_left_as_they_are(self):
        path = self.root / self.REL
        path.parent.mkdir(parents=True)
        old = {"issue": f"{KEY}-1", "id": "c0", "author": "owner",
               "body": "old", "mentions": [], "created": stamp(90),
               "updated": stamp(90), "source": "jira"}
        path.write_text(json.dumps(old) + "\n", encoding="utf-8")
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30,
                        comments=[comment("c1", OWNER, "new", 40)])
        self.run_tick()
        log = self.lines(self.REL)
        self.assertEqual(log[0], old)
        self.assertEqual(log[1]["update_author"], "owner")


class InboxSeamTests(SyncBackTestCase):
    """The tick's call into `inbox.derive` (Story 31.5): only a non-dry-run
    tick whose search read every page writes `inbox.json`."""
    INBOX = "_bmad-output/tracking/inbox.json"

    def test_a_complete_tick_derives_the_inbox_and_names_it(self):
        self.fake.issue(f"{KEY}-1", jirabackend.BLOCKED_STATUS, "indeterminate",
                        30, priority="High")
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        self.assertIn(self.INBOX, result["written"])
        data = json.loads((self.root / self.INBOX).read_text("utf-8"))
        self.assertEqual([(i["issue"], i["state"], i["priority"])
                          for i in data["items"]],
                         [(f"{KEY}-1", "open", "High")])
        # the search asked for the priority, in its one paged search
        self.assertEqual(len(self.fake.jql), 1)

    def test_the_summary_reaches_the_inbox_as_the_engagement(self):
        # Story 32.3: the one search asks for `summary`; an engagement's
        # questions issue lands as an item carrying `engagement`
        self.fake.issue(f"{KEY}-40", jirabackend.BLOCKED_STATUS,
                        "indeterminate", 30, summary="ENG-001: questions")
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        data = json.loads((self.root / self.INBOX).read_text("utf-8"))
        self.assertEqual([(i["issue"], i.get("engagement"), i.get("title"))
                          for i in data["items"]],
                         [(f"{KEY}-40", "ENG-001", "ENG-001: questions")])
        self.assertEqual(syncback.SEARCH_FIELDS,
                         "status,updated,comment,attachment,priority,summary")

    def test_a_dry_run_or_an_interrupted_search_writes_no_inbox(self):
        self.fake.issue(f"{KEY}-1", jirabackend.BLOCKED_STATUS, "indeterminate",
                        30)
        result = self.run_tick(dry_run=True)
        self.assertNotIn(self.INBOX, result["written"])
        self.assertFalse((self.root / self.INBOX).exists())
        self.fake.force[("GET", "/search/jql")] = (400, {"errorMessages": ["x"]})
        result = self.run_tick()
        self.assertEqual(result["status"], "partial")
        self.assertFalse((self.root / self.INBOX).exists())

    def test_a_complete_search_with_a_mirror_429_or_error_leaves_the_inbox(self):
        self.fake.issue(f"{KEY}-1", jirabackend.BLOCKED_STATUS, "indeterminate",
                        30)
        self.fake.page("P-1", "Owner Notes", "<p>one</p>")
        self.assert_block_last(self.run_tick(), "complete")
        before = (self.root / self.INBOX).read_bytes()
        real = self.fake._confluence
        for answer, case in (((429, {}, {"Retry-After": "600"}), "rate-limited"),
                             ((400, {"message": "bad"}), "error")):
            # the search reads every page and would move the item to resolved
            self.fake.search_issues[0]["fields"]["status"] = {
                "name": jirabackend.RESOLVED_STATUS,
                "statusCategory": {"key": "indeterminate"}}

            def failing(method, path, query, body, answer=answer):
                if path.endswith("/pages"):
                    return answer
                return real(method, path, query, body)
            self.fake._confluence = failing
            result = self.run_tick(minutes_later=10)
            self.assertEqual((result["status"], result["case"]),
                             ("partial", case))
            self.assertNotIn(self.INBOX, result["written"])
            self.assertEqual((self.root / self.INBOX).read_bytes(), before)

    def test_a_held_inbox_keeps_the_cursor_so_the_next_tick_re_reads(self):
        # a complete read whose mirror then fails holds the inbox; the cursor
        # must stay where it was, or the issue that left the status on the
        # held tick is never re-read and keeps its open item (AC2)
        self.fake.issue(f"{KEY}-1", jirabackend.BLOCKED_STATUS, "indeterminate",
                        30, comments=[comment("c1", OWNER, "a ruling", 31)],
                        attachments=[{"id": "a1", "filename": "x.png",
                                      "author": {"accountId": OWNER},
                                      "created": stamp(31)}])
        self.fake.page("P-1", "Owner Notes", "<p>one</p>")
        self.assert_block_last(self.run_tick(), "complete")
        prior = self.state()["cursor"]
        self.assertEqual(prior, stamp(30))
        real = self.fake._confluence
        for answer, case in (((429, {}, {"Retry-After": "600"}), "rate-limited"),
                             ((400, {"message": "bad"}), "error")):
            with self.subTest(case=case):
                before = (self.root / self.INBOX).read_bytes()
                self.fake.search_issues[0]["fields"].update({
                    "status": {"name": "In Progress",
                               "statusCategory": {"key": "indeterminate"}},
                    "updated": stamp(5)})

                def failing(method, path, query, body, answer=answer):
                    if path.endswith("/pages"):
                        return answer
                    return real(method, path, query, body)
                self.fake._confluence = failing
                result = self.run_tick(minutes_later=10)
                self.assertEqual((result["status"], result["case"]),
                                 ("partial", case))
                self.assertIn("cursor unchanged", result["reason"])
                self.assertEqual((self.root / self.INBOX).read_bytes(), before)
                self.assertEqual(self.state()["cursor"], prior)
        # the next clean tick searches from the prior cursor and derives the
        # inbox with the status change: the item is gone
        self.fake._confluence = real
        self.fake.jql.clear()
        result = self.run_tick(minutes_later=20)
        self.assert_block_last(result, "complete")
        self.assertIn(self.INBOX, result["written"])
        self.assertEqual(self.fake.jql, [syncback.jql_for(
            KEY, prior, NOW + timedelta(minutes=20))])
        data = json.loads((self.root / self.INBOX).read_text("utf-8"))
        self.assertNotIn(f"{KEY}-1", [i["issue"] for i in data["items"]])
        self.assertEqual(self.state()["cursor"], stamp(5))
        # re-reading appended nothing twice
        for log in ("comments", "attachments"):
            self.assertEqual(len(self.lines(
                f"_bmad-output/tracking/{KEY}-1/{log}.jsonl")), 1)

    def test_a_held_inbox_on_the_first_tick_leaves_no_cursor(self):
        self.fake.issue(f"{KEY}-1", jirabackend.BLOCKED_STATUS, "indeterminate",
                        30)
        real = self.fake._confluence

        def failing(method, path, query, body):
            if path.endswith("/pages"):
                return 400, {"message": "bad"}
            return real(method, path, query, body)
        self.fake._confluence = failing
        result = self.run_tick()
        self.assertEqual((result["status"], result["case"]),
                         ("partial", "error"))
        self.assertFalse((self.root / self.INBOX).exists())
        self.assertIsNone(self.state()["cursor"])


class AttachmentTests(SyncBackTestCase):
    def test_attachment_links_append_once_by_id(self):
        att = {"id": "a1", "filename": "f.txt", "mimeType": "text/plain",
               "size": 3, "author": {"accountId": AGENT},
               "created": stamp(40), "content": "https://x/a1"}
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30,
                        attachments=[att])
        self.run_tick()
        self.fake.search_issues[0]["fields"]["attachment"].append(
            dict(att, id="a2", content="https://x/a2"))
        self.run_tick(minutes_later=10)
        rel = f"_bmad-output/tracking/{KEY}-1/attachments.jsonl"
        self.assertEqual([(a["id"], a["url"], a["author"])
                          for a in self.lines(rel)],
                         [("a1", "https://x/a1", "agent"),
                          ("a2", "https://x/a2", "agent")])
        # links only: never a download or an upload
        self.assertFalse([c for c in self.fake.calls
                          if "attachment" in c[1].lower()])


class MirrorTests(SyncBackTestCase):
    MIRROR = "kb/confluence/owner-notes.md"

    def setUp(self):
        super().setUp()
        self.fake.page("P-1", "Owner Notes", "<p>one</p>")

    def test_unchanged_page_is_not_rewritten(self):
        self.run_tick()
        second = self.run_tick(minutes_later=10)
        self.assertNotIn(self.MIRROR, second["written"])
        self.assertEqual(second["counts"]["pages_unchanged"], 1)
        self.assertEqual(second["overwritten"], [])

    def test_a_new_version_is_rewritten(self):
        self.run_tick()
        self.fake.page("P-1", "Owner Notes", "<p>two</p>", version=2)
        second = self.run_tick(minutes_later=10)
        self.assertIn(self.MIRROR, second["written"])
        self.assertTrue((self.root / self.MIRROR).read_text("utf-8")
                        .endswith("<p>two</p>"))
        self.assertEqual(second["overwritten"], [])

    def test_a_local_edit_is_overwritten_and_reported(self):
        self.run_tick()
        path = self.root / self.MIRROR
        path.write_text(path.read_text("utf-8") + "\nmy local note\n",
                        encoding="utf-8", newline="\n")
        second = self.run_tick(minutes_later=10)
        self.assertEqual(second["overwritten"], [self.MIRROR])
        self.assertIn(self.MIRROR, second["written"])
        self.assertNotIn("my local note", path.read_text("utf-8"))
        self.assertEqual(second["counts"]["pages_overwritten"], 1)

    def test_a_crlf_checkout_is_not_a_local_edit(self):
        # git autocrlf on a Windows host: an unedited page is left alone
        self.run_tick()
        path = self.root / self.MIRROR
        path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
        second = self.run_tick(minutes_later=10)
        self.assertNotIn(self.MIRROR, second["overwritten"])
        self.assertEqual(second["counts"]["pages_overwritten"], 0)
        # a real edit under CRLF is still caught
        path.write_bytes(path.read_bytes() + b"my local note\r\n")
        third = self.run_tick(minutes_later=20)
        self.assertEqual(third["overwritten"], [self.MIRROR])

    def test_a_header_only_edit_is_overwritten_and_reported(self):
        self.run_tick()
        path = self.root / self.MIRROR
        original = path.read_text("utf-8")
        self.assertIn("read_only: true\n", original)
        path.write_text(original.replace("read_only: true",
                                         "read_only: false"),
                        encoding="utf-8", newline="\n")
        second = self.run_tick(minutes_later=10)
        self.assertEqual(second["overwritten"], [self.MIRROR])
        self.assertIn(self.MIRROR, second["written"])
        self.assertEqual(second["counts"]["pages_overwritten"], 1)
        restored = path.read_text("utf-8")
        self.assertIn("read_only: true\n", restored)
        self.assertNotIn("read_only: false", restored)

    def test_a_lost_sync_state_is_not_an_overwrite_of_an_unedited_file(self):
        # no recorded entry: the mirrored version is unknown, so version,
        # title and url are not compared; the body hash still decides
        self.run_tick()
        path = self.root / self.MIRROR
        (self.root / syncback.STATE_REL).unlink()
        # a retitle that keeps the slug, so the same file is read
        self.fake.page("P-1", "Owner notes!", "<p>two</p>", version=2)
        second = self.run_tick(minutes_later=10)
        self.assertEqual(second["overwritten"], [])
        self.assertEqual(second["counts"]["pages_overwritten"], 0)
        self.assertIn(self.MIRROR, second["written"])
        text = path.read_text("utf-8")
        self.assertTrue(text.endswith("<p>two</p>"))
        self.assertIn("version: 2\n", text)
        # a header-only edit is still caught with the state lost
        path.write_text(text.replace("read_only: true", "read_only: false"),
                        encoding="utf-8", newline="\n")
        (self.root / syncback.STATE_REL).unlink()
        third = self.run_tick(minutes_later=20)
        self.assertEqual(third["overwritten"], [self.MIRROR])
        self.assertIn("read_only: true\n", path.read_text("utf-8"))

    def test_the_confluence_rate_limit_lands_in_the_record(self):
        real = self.fake._confluence
        answers = [(429, {}, {"Retry-After": "2",
                              "RateLimit-Reason": "confluence-burst",
                              "X-RateLimit-Limit": "100"})]

        def throttled(method, path, query, body):
            if path.endswith("/pages") and answers:
                return answers.pop(0)
            answer = real(method, path, query, body)
            if path.endswith("/pages"):
                return (*answer[:2], {"RateLimit-Remaining": "99"})
            return answer
        self.fake._confluence = throttled
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        self.assertEqual(self.sleeps, [2.0])
        record = result["rate_limit"]["confluence"]
        self.assertEqual(record["headers"]["x-ratelimit-limit"], "100")
        self.assertEqual(record["headers"]["ratelimit-remaining"], "99")
        self.assertEqual(len(record["throttled"]), 1)
        hit = record["throttled"][0]
        self.assertEqual((hit["method"], hit["reason"], hit["retry_after"]),
                         ("GET", "confluence-burst", "2"))
        self.assertIn("/spaces/S-1/pages", hit["path"])
        self.assertTrue(any(n.startswith("confluence 429 on GET ")
                            and "RateLimit-Reason: confluence-burst" in n
                            for n in result["notes"]))
        self.assertEqual(self.state()["rate_limit"]["confluence"], record)

    def test_slug_collision_appends_the_page_id_and_paths_stick(self):
        self.fake.page("P-2", "Owner: notes!", "<p>other</p>")
        self.run_tick()
        pages = self.state()["pages"]
        self.assertEqual(pages["P-1"]["path"], self.MIRROR)
        self.assertEqual(pages["P-2"]["path"],
                         "kb/confluence/owner-notes-P-2.md")
        self.fake.page("P-1", "Renamed Notes", "<p>one</p>", version=2)
        self.run_tick(minutes_later=10)
        self.assertEqual(self.state()["pages"]["P-1"]["path"], self.MIRROR)

    def test_published_pages_are_excluded_and_gone_pages_noted(self):
        index = self.root / ".tk-studio" / "confluence-pages.json"
        index.write_text(json.dumps({"pages": [
            {"title": "Brief: b1", "page_id": "P-9", "source": "x",
             "category": "brief", "webui": "/w"}]}), encoding="utf-8")
        self.fake.page("P-9", "Brief: b1", "<p>published</p>")
        self.run_tick()
        self.assertFalse((self.root / "kb/confluence/brief-b1.md").exists())
        self.fake.space_pages = []
        second = self.run_tick(minutes_later=10)
        self.assertTrue((self.root / self.MIRROR).is_file())
        self.assertTrue(any("P-1" in n and "left on disk" in n
                            for n in second["notes"]))


class CursorTests(SyncBackTestCase):
    def test_second_tick_bounds_relatively_with_the_overlap(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 30)
        self.run_tick()
        self.fake.jql.clear()
        self.run_tick(minutes_later=10)
        # cursor 30 min before NOW, tick at NOW+10: 40 minutes + 5 overlap
        self.assertEqual(self.fake.jql[0], f'project = "{KEY}" AND updated >= '
                                           f'-45m ORDER BY updated ASC')

    def test_an_error_between_pages_leaves_the_cursor(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 60)
        self.run_tick()
        self.assertEqual(self.state()["cursor"], stamp(60))
        self.fake.search_issues = []
        for n in range(3):
            self.fake.issue(f"{KEY}-{n + 1}", "Done", "done", 10 - n)
        self.fake.fail_token = "2"
        result = self.run_tick(minutes_later=10)
        self.assert_block_last(result, "partial")
        self.assertEqual(self.state()["cursor"], stamp(60))
        self.assertIn("cursor unchanged", result["reason"])
        self.assertEqual(self.entity("ST-001")[0]["status"], "in-progress")

    def test_429_exhausted_names_the_reason_and_keeps_the_cursor(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 60)
        self.run_tick()
        self.fake.force[("GET", "/search/jql")] = (
            429, {"errorMessages": ["slow down"]},
            {"Retry-After": "3", "RateLimit-Reason": "jira-burst-based"})
        self.sleeps.clear()
        result = self.run_tick(minutes_later=10)
        self.assert_block_last(result, "partial")
        self.assertEqual(self.sleeps, [3.0] * 5)
        self.assertIn("jira-burst-based", result["reason"])
        self.assertEqual(result["case"], "rate-limited")
        self.assertEqual(self.state()["cursor"], stamp(60))
        self.assertEqual(len(result["rate_limit"]["jira"]["throttled"]), 6)
        self.assertTrue(any("RateLimit-Reason: jira-burst-based" in n
                            for n in result["notes"]))
        self.assertNotIn("cloud-test", json.dumps(self.state()))
        self.assertEqual(result["rate_limit"]["jira"]["throttled"][0]["path"],
                         "/ex/jira/rest/api/2/search/jql")

    def test_a_long_retry_after_ends_the_tick_at_once(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 60)
        self.run_tick()
        self.fake.force[("GET", "/search/jql")] = (
            429, {}, {"Retry-After": "600", "RateLimit-Reason": "jira-quota"})
        self.sleeps.clear()
        result = self.run_tick(minutes_later=10)
        self.assert_block_last(result, "partial")
        self.assertEqual(self.sleeps, [])
        self.assertEqual(result["case"], "rate-limited")
        self.assertIn("jira-quota", result["reason"])
        last = self.state()["last_run"]
        self.assertEqual((last["status"], last["case"]),
                         ("partial", "rate-limited"))
        self.assertEqual(self.state()["cursor"], stamp(60))

    def test_429_without_retry_after_backs_off_exponentially(self):
        answers = [(429, {}, {}), (429, {}, {})]
        real = self.fake._jira

        def flaky(method, path, query, body):
            if path == "/search/jql" and answers:
                return answers.pop(0)
            return real(method, path, query, body)
        self.fake._jira = flaky
        self.fake.issue(f"{KEY}-1", "Done", "done", 30)
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        self.assertEqual(self.sleeps, [1, 2])
        self.assertEqual(self.entity("ST-001")[0]["status"], "done")


class NamedStateTests(SyncBackTestCase):
    def plane(self):
        return drift_check.check_tracking(self.root, now=NOW)

    def test_no_confluence_token_runs_the_jira_half(self):
        os.environ.pop(jirabackend.AGENT_CONFLUENCE_TOKEN_ENV)
        self.happy()
        result = self.run_tick()
        self.assert_block_last(result, "partial")
        self.assertEqual(result["case"], "token-missing")
        self.assertIn("TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN", result["reason"])
        self.assertEqual(self.entity("ST-001")[0]["status"], "done")
        self.assertFalse((self.root / "kb").exists())
        self.assertFalse([c for c in self.fake.calls
                          if c[1].startswith("confluence:")])
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("drift", "token-missing"))
        self.assertIn("TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN", plane["fix"])

    def test_unreachable_preflight(self):
        self.fake.force[("GET", "/myself")] = (503, "Service Unavailable")
        result = self.run_tick()
        self.assert_block_last(result, "blocked")
        self.assertEqual(result["case"], "unreachable")
        self.assertEqual([c[1] for c in self.fake.calls], ["/myself"])
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]),
                         ("drift", "unreachable"))

    def test_connection_error_is_unreachable(self):
        def down(method, url, body):
            raise jirabackend.JiraError("cannot reach api.atlassian.com: "
                                        "Name or service not known")
        result = plansync.sync_back(self.root, transport=down, now=NOW)
        self.assert_block_last(result, "blocked")
        self.assertEqual(result["case"], "unreachable")

    def test_deactivated_site_names_the_owner_sign_in(self):
        for code in (404, 410):
            self.fake.force[("GET", "/myself")] = (code, {"message": "gone"})
            result = self.run_tick()
            self.assert_block_last(result, "blocked")
            self.assertEqual(result["case"], "deactivated")
            self.assertIn("owner signs in", result["reason"])
            plane = self.plane()
            self.assertEqual((plane["status"], plane["case"]),
                             ("drift", "deactivated"))
            self.assertIn("owner signs in", plane["fix"])

    def test_auth_split(self):
        self.fake.fail_auth = True
        result = self.run_tick()
        self.assert_block_last(result, "blocked")
        self.assertEqual(result["case"], "auth")
        self.assertIn("401", result["reason"])
        self.assertEqual(self.plane()["case"], "auth")

    def test_a_non_network_preflight_answer_is_error_not_unreachable(self):
        self.fake.force[("GET", "/myself")] = (400, {"errorMessages": ["bad"]})
        result = self.run_tick()
        self.assert_block_last(result, "blocked")
        self.assertEqual(result["case"], "error")
        self.assertEqual(self.state()["last_run"]["case"], "error")
        plane = self.plane()  # not a plane case: read by status, so stale
        self.assertEqual((plane["status"], plane["case"]), ("drift", "stale"))

    def test_a_400_on_the_search_is_error_and_partial(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 60)
        self.run_tick()
        self.fake.force[("GET", "/search/jql")] = (
            400, {"errorMessages": ["bad JQL"]})
        result = self.run_tick(minutes_later=10)
        self.assert_block_last(result, "partial")
        self.assertEqual(result["case"], "error")
        self.assertEqual(self.state()["cursor"], stamp(60))
        plane = self.plane()  # a recent partial tick reads ok by age
        self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"))

    def test_a_pager_that_never_ends_is_error(self):
        self.fake.issue(f"{KEY}-1", "In Progress", "indeterminate", 60)
        self.fake.issue(f"{KEY}-2", "In Progress", "indeterminate", 50)
        self.fake.search_page = 1
        with unittest.mock.patch.object(jirabackend, "MAX_PAGES", 1):
            result = self.run_tick()
        self.assertEqual(result["case"], "error")
        self.assertIn("did not end", result["reason"])

    def test_a_5xx_or_connection_error_stays_unreachable(self):
        self.assertEqual(syncback.classify(jirabackend.JiraError(
            "sync-back: GET /search/jql returned 502")), "unreachable")
        self.assertEqual(syncback.classify(confluence.ConfluenceError(
            "cannot reach api.atlassian.com: timed out")), "unreachable")
        self.assertEqual(syncback.classify(jirabackend.JiraError(
            "sync-back: GET /search/jql returned 400")), "error")

    def test_a_mid_tick_5xx_is_partial_and_the_plane_reads_it_by_age(self):
        for n in range(3):
            self.fake.issue(f"{KEY}-{n + 1}", "Done", "done", 10 - n)
        self.fake.fail_token = "2"
        result = self.run_tick()
        self.assert_block_last(result, "partial")
        self.assertEqual(result["case"], "unreachable")
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"))

    def test_a_failed_preflight_or_refusal_keeps_the_newest_comment(self):
        self.happy()
        self.run_tick()
        newest = self.state()["last_run"]["newest_comment"]
        self.assertEqual(newest["id"], "c2")
        self.fake.force[("GET", "/myself")] = (503, "Service Unavailable")
        result = self.run_tick(minutes_later=10)
        self.assertEqual(result["newest_comment"], newest)
        self.assertEqual(self.state()["last_run"]["newest_comment"], newest)
        os.environ.pop(jirabackend.AGENT_TOKEN_ENV)
        result = self.run_tick(minutes_later=20)
        self.assert_block_last(result, "blocked")
        self.assertEqual(self.state()["last_run"]["case"], "token-missing")
        self.assertEqual(self.state()["last_run"]["newest_comment"], newest)

    def test_a_complete_tick_reads_ok(self):
        self.happy()
        self.run_tick()
        plane = self.plane()
        self.assertEqual((plane["status"], plane["case"]), ("ok", "ok"))
        self.assertEqual(plane["last_run"]["status"], "complete")


class RefusalTests(SyncBackTestCase):
    def test_no_binding_is_blocked_with_no_call(self):
        config = self.root / ".tk-studio" / "config.yaml"
        config.write_text("vcs: git\n", encoding="utf-8", newline="\n")
        result = self.run_tick()
        self.assert_block_last(result, "blocked")
        self.assertIn("planning.jira", result["reason"])
        self.assertEqual(self.fake.calls, [])
        self.assertFalse((self.root / "_bmad-output" / "tracking").exists())

    def test_absent_jira_variables_are_named_with_no_call(self):
        for name in (jirabackend.AGENT_TOKEN_ENV, jirabackend.AGENT_EMAIL_ENV,
                     jirabackend.CLOUD_ID_ENV):
            os.environ.pop(name)
        result = self.run_tick()
        self.assert_block_last(result, "blocked")
        self.assertFalse(result["ok"])
        self.assertIn("TK_ATLASSIAN_AGENT_TOKEN", result["reason"])
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.state()["last_run"]["case"], "token-missing")
        self.assertEqual(result["written"],
                         ["_bmad-output/tracking/sync-state.json"])

    def test_no_owner_account_id_skips_logs_and_mirror(self):
        config = self.root / ".tk-studio" / "config.yaml"
        config.write_text(config.read_text("utf-8").replace(
            f'    owner_account_id: "{OWNER}"\n', ""), encoding="utf-8",
            newline="\n")
        self.happy()
        prior = stamp(60)
        state_path = self.root / syncback.STATE_REL
        state_path.parent.mkdir(parents=True)
        state_path.write_text(json.dumps({"cursor": prior, "pages": {}}),
                              encoding="utf-8")
        result = self.run_tick()
        self.assert_block_last(result, "partial")
        self.assertIn("planning.jira.owner_account_id", result["reason"])
        self.assertIn("cursor unchanged", result["reason"])
        self.assertEqual(self.entity("ST-001")[0]["status"], "done")
        self.assertFalse((self.root / "_bmad-output" / "tracking" /
                          f"{KEY}-1").exists())
        self.assertFalse((self.root / "kb").exists())
        # the cursor did not move past the skipped comments and attachments
        self.assertEqual(self.state()["cursor"], prior)
        # once the owner is recorded the next tick logs them
        config.write_text(config.read_text("utf-8").replace(
            f'    agent_account_id: "{AGENT}"\n',
            f'    owner_account_id: "{OWNER}"\n'
            f'    agent_account_id: "{AGENT}"\n'), encoding="utf-8",
            newline="\n")
        self.fake.jql.clear()
        self.run_tick(minutes_later=10)
        self.assertIn("updated >= -75m", self.fake.jql[0])
        self.assertEqual(len(self.lines(
            f"_bmad-output/tracking/{KEY}-1/comments.jsonl")), 2)
        self.assertEqual(len(self.lines(
            f"_bmad-output/tracking/{KEY}-1/attachments.jsonl")), 1)
        self.assertEqual(self.state()["cursor"], stamp(20))

    def test_a_non_jira_key_is_noted_and_the_cursor_advances(self):
        self.fake.issue("not-a-key", "Done", "done", 30)
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        self.assertIsNone(result["reason"])
        self.assertTrue(any("'not-a-key' is not a Jira key" in n
                            for n in result["notes"]))
        self.assertEqual(self.state()["cursor"], stamp(30))

    def test_cli_refusal_exits_2_with_the_block_last(self):
        os.environ.pop(jirabackend.AGENT_TOKEN_ENV)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = plansync.main(["sync-back", "--directory", str(self.root),
                                  "--dry-run"])
        self.assertEqual(code, 2)
        result = json.loads(out.getvalue())
        self.assert_block_last(result, "blocked")
        self.assertFalse((self.root / syncback.STATE_REL).exists())


class HelperTests(unittest.TestCase):
    def test_jql_first_tick_and_rounding(self):
        self.assertEqual(syncback.jql_for("K", None, NOW),
                         'project = "K" ORDER BY updated ASC')
        cursor = (NOW - timedelta(minutes=10, seconds=1)).strftime(
            "%Y-%m-%dT%H:%M:%S.000+0000")
        self.assertIn("updated >= -16m", syncback.jql_for("K", cursor, NOW))

    def test_slug(self):
        self.assertEqual(syncback.slug_for("Owner: Notes — v2!"),
                         "owner-notes-v2")
        self.assertEqual(syncback.slug_for("!!!"), "page")



# ------------------------------------------- engagement scope pages (32.4)

ENG = "ENG-001"
SCOPE_PAGE = "P-90"
EDITED = ("<h1>ENG-001: Scope of Work</h1><h2 local-id=\"g\">Goal</h2>"
          "<p><span>The owner rewrote the goal.</span></p>"
          "<h2>Deliverables</h2><h3>CSV export</h3>"
          "<p>Acceptance signal: a file downloads.</p>"
          "<p><em>Published by tk-studio from <code>_bmad-output/engagements/"
          "ENG-001/scope.md</code> at commit <code>no commit</code>. "
          "content-hash: sha256:" + "0" * 64 + "</em></p>")


class FakeScopeSyncBack(FakeSyncBack):
    """FakeSyncBack plus `GET /pages/{id}` (body-format storage) for the
    engagement scope pages, which are never in the owner's page list."""

    def __init__(self):
        super().__init__()
        self.by_id: dict[str, dict] = {}

    def scope_page(self, pid, body, version):
        self.by_id[pid] = {
            "id": pid, "title": f"{ENG}: Scope of Work",
            "version": {"number": version},
            "body": {"storage": {"value": body, "representation": "storage"}},
            "_links": {"webui": f"/spaces/{KEY}/pages/{pid}"}}

    def _confluence(self, method, path, query, body):
        m = re.match(r"^/pages/([^/]+)$", path)
        if method == "GET" and m:
            q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
            assert q.get("body-format") == "storage", q
            page = self.by_id.get(m.group(1))
            return (200, page) if page else (404, {"message": "not found"})
        return super()._confluence(method, path, query, body)


class EngagementScopeMirrorTests(SyncBackTestCase):
    MIRROR = "kb/confluence/eng-001-scope-of-work.md"
    SCOPE = "# ENG-001: Scope of Work\n\n## Goal\n\nThe planner's goal.\n"

    def setUp(self):
        super().setUp()
        self.fake = FakeScopeSyncBack()
        self.dir = self.root / "_bmad-output" / "engagements" / ENG
        self.dir.mkdir(parents=True)
        self.write_record("scoping")
        (self.dir / "scope.md").write_text(self.SCOPE, encoding="utf-8",
                                           newline="\n")

    def write_record(self, state, version=1):
        record = {"shape_version": 1, "id": ENG, "project": "tk-studio",
                  "state": state, "request": "CSV export", "questions": [],
                  "assumptions": [],
                  "scope_page": {"id": SCOPE_PAGE,
                                 "url": f"https://{SITE}/wiki/x",
                                 "version": version},
                  "quote": None, "autonomy": None, "approved_at": None,
                  "closeout": None, "created": "2026-10-25T03:00:00.000Z",
                  "updated": "2026-10-25T03:00:00.000Z",
                  "spend": {"planning_usd": 0, "runs_usd": 0}, "inputs": []}
        (self.dir / "engagement.yaml").write_text(
            json.dumps(record, indent=2) + "\n", encoding="utf-8")

    def record(self):
        return json.loads((self.dir / "engagement.yaml")
                          .read_text(encoding="utf-8"))

    def scope_text(self):
        return (self.dir / "scope.md").read_text(encoding="utf-8")

    def test_an_owner_edit_while_scoping_replaces_scope_md_wholesale(self):
        self.fake.scope_page(SCOPE_PAGE, EDITED, 2)
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        markdown = ("# ENG-001: Scope of Work\n\n## Goal\n\nThe owner "
                    "rewrote the goal.\n\n## Deliverables\n\n### CSV export"
                    "\n\nAcceptance signal: a file downloads.\n")
        # replaced wholesale, unchecked (D9: the page is authoritative)
        self.assertEqual(self.scope_text(), markdown)
        record = self.record()
        self.assertEqual(record["scope_page"],
                         {"id": SCOPE_PAGE, "url": f"https://{SITE}/wiki/x",
                          "version": 2})
        self.assertEqual(record["state"], "scoping")
        # the mirror: the header plus `engagement`, the Markdown body
        text = (self.root / self.MIRROR).read_text(encoding="utf-8")
        self.assertTrue(text.endswith("---\n" + markdown))
        digest = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
        for line in ("source: confluence", f'page_id: "{SCOPE_PAGE}"',
                     'title: "ENG-001: Scope of Work"', "version: 2",
                     f'url: "https://{SITE}/wiki/spaces/{KEY}/pages/'
                     f'{SCOPE_PAGE}"', f"content_hash: sha256:{digest}",
                     f"engagement: {ENG}"):
            self.assertIn(line + "\n", text)
        counts = result["counts"]
        self.assertEqual((counts["engagement_pages_mirrored"],
                          counts["scopes_replaced"]), (1, 1))
        self.assertIn(self.MIRROR, result["written"])
        self.assertIn(f"_bmad-output/engagements/{ENG}/scope.md",
                      result["written"])
        state = self.state()
        self.assertEqual(state["engagement_pages"][SCOPE_PAGE]["version"], 2)
        self.assertNotIn(SCOPE_PAGE, state.get("pages", {}))
        self.assertFalse(any("gone or no longer" in n for n in result["notes"]))
        # the next tick: nothing new
        second = self.run_tick(minutes_later=10)
        self.assertEqual((second["counts"]["engagement_pages_mirrored"],
                          second["counts"]["scopes_replaced"]), (0, 0))
        self.assertEqual(self.scope_text(), markdown)

    def test_an_owner_edit_in_quoted_mirrors_only_with_a_note_once(self):
        self.write_record("quoted")
        before = (self.dir / "engagement.yaml").read_bytes()
        self.fake.scope_page(SCOPE_PAGE, EDITED, 2)
        result = self.run_tick()
        self.assert_block_last(result, "complete")
        self.assertTrue((self.root / self.MIRROR).is_file())
        self.assertEqual(self.scope_text(), self.SCOPE)
        self.assertEqual((self.dir / "engagement.yaml").read_bytes(), before)
        note = f"scope edit of {ENG} not applied: state quoted (send revise)"
        self.assertIn(note, result["notes"])
        self.assertEqual(result["counts"]["scopes_replaced"], 0)
        second = self.run_tick(minutes_later=10)
        self.assertNotIn(note, second["notes"])
        self.assertEqual(second["counts"]["engagement_pages_mirrored"], 0)
        # a newer edit is noted once more
        self.fake.scope_page(SCOPE_PAGE, EDITED.replace("rewrote", "redid"),
                             3)
        third = self.run_tick(minutes_later=20)
        self.assertIn(note, third["notes"])
        self.assertEqual(self.record()["state"], "quoted")

    def test_an_edit_noted_in_quoted_is_applied_once_back_in_scoping(self):
        self.write_record("quoted")
        self.fake.scope_page(SCOPE_PAGE, EDITED, 2)
        note = f"scope edit of {ENG} not applied: state quoted (send revise)"
        first = self.run_tick()
        self.assertIn(note, first["notes"])
        self.assertEqual(first["counts"]["engagement_pages_mirrored"], 1)
        mirror = (self.root / self.MIRROR).read_bytes()
        self.assertEqual(self.scope_text(), self.SCOPE)
        # a bodiless revise: back in scoping, the page itself unchanged
        self.write_record("scoping")
        second = self.run_tick(minutes_later=10)
        self.assert_block_last(second, "complete")
        markdown = ("# ENG-001: Scope of Work\n\n## Goal\n\nThe owner "
                    "rewrote the goal.\n\n## Deliverables\n\n### CSV export"
                    "\n\nAcceptance signal: a file downloads.\n")
        self.assertEqual(self.scope_text(), markdown)
        self.assertEqual(self.record()["scope_page"]["version"], 2)
        self.assertEqual(self.record()["scope_page"]["id"], SCOPE_PAGE)
        self.assertNotIn(note, second["notes"])
        self.assertEqual((second["counts"]["engagement_pages_mirrored"],
                          second["counts"]["scopes_replaced"]), (0, 1))
        self.assertIn(f"_bmad-output/engagements/{ENG}/scope.md",
                      second["written"])
        self.assertNotIn(self.MIRROR, second["written"])
        self.assertEqual((self.root / self.MIRROR).read_bytes(), mirror)
        # applied: the next tick does nothing
        third = self.run_tick(minutes_later=20)
        self.assertEqual((third["counts"]["engagement_pages_mirrored"],
                          third["counts"]["scopes_replaced"]), (0, 0))

    def test_a_state_or_page_changed_before_the_lock_applies_nothing(self):
        real = engage._with_scope_lock
        page = {"id": SCOPE_PAGE, "version": 2, "body": EDITED}
        for why, change in (("state", lambda: self.write_record("quoted")),
                            ("page id", lambda: self.set_page_id("999"))):
            with self.subTest(why=why):
                self.write_record("scoping")

                def racing(root, engagement, fn, **kwargs):
                    return real(root, engagement,
                                lambda: (change(), fn())[1], **kwargs)

                with unittest.mock.patch("engage._with_scope_lock", racing):
                    out = engage.apply_page_revision(self.root, ENG, page)
                self.assertIs(out["applied"], False)
                self.assertEqual(out["written"], [])
                self.assertEqual(self.scope_text(), self.SCOPE)
                self.assertEqual(self.record()["scope_page"]["version"], 1)

    def set_page_id(self, pid):
        record = self.record()
        record["scope_page"]["id"] = pid
        (self.dir / "engagement.yaml").write_text(
            json.dumps(record, indent=2) + "\n", encoding="utf-8")

    def test_an_unchanged_version_does_nothing_and_a_404_is_a_note(self):
        self.fake.scope_page(SCOPE_PAGE, EDITED, 1)
        result = self.run_tick()
        self.assertEqual(result["counts"]["engagement_pages_mirrored"], 0)
        self.assertFalse((self.root / self.MIRROR).exists())
        self.assertEqual(self.scope_text(), self.SCOPE)
        self.fake.by_id.clear()
        gone = self.run_tick(minutes_later=10)
        self.assert_block_last(gone, "complete")
        self.assertTrue(any(f"scope page {SCOPE_PAGE} was not found (404)"
                            in n for n in gone["notes"]))
        self.assertEqual(self.scope_text(), self.SCOPE)

    def test_a_confluence_error_is_partial(self):
        self.fake.force[("GET", f"confluence:/pages/{SCOPE_PAGE}")] = (
            500, {"message": "boom"})
        result = self.run_tick()
        self.assert_block_last(result, "partial")
        self.assertIn("engagement scope mirror interrupted", result["reason"])
        self.assertEqual(self.scope_text(), self.SCOPE)

    def test_a_held_scope_lock_retries_on_the_next_tick(self):
        self.fake.scope_page(SCOPE_PAGE, EDITED, 2)
        (self.dir / "scope.lock").write_text("", encoding="utf-8")
        with unittest.mock.patch("engage.SCOPE_LOCK_WAIT_S", 0):
            result = self.run_tick()
        (self.dir / "scope.lock").unlink()
        self.assertEqual(self.scope_text(), self.SCOPE)
        self.assertTrue(any("ScopeBusy" in n for n in result["notes"]))
        self.assertNotIn(SCOPE_PAGE, self.state().get("engagement_pages", {}))
        again = self.run_tick(minutes_later=10)
        self.assertEqual(again["counts"]["scopes_replaced"], 1)
        self.assertEqual(self.record()["scope_page"]["version"], 2)

    def test_a_version_published_while_the_tick_waited_is_not_overwritten(self):
        # the tick GETs version 2; before it takes scope.lock a concurrent
        # `engage.py scope` publishes version 3 and records it
        self.fake.scope_page(SCOPE_PAGE, EDITED, 2)
        real = engage._with_scope_lock
        published = "# ENG-001: Scope of Work\n\n## Goal\n\nPublished v3.\n"

        def racing(root, engagement, fn, **kwargs):
            def concurrent_publish():
                (self.dir / "scope.md").write_text(published,
                                                   encoding="utf-8",
                                                   newline="\n")
                self.write_record("scoping", version=3)
            return real(root, engagement,
                        lambda: (concurrent_publish(), fn())[1], **kwargs)

        with unittest.mock.patch("engage._with_scope_lock", racing):
            result = self.run_tick()
        self.assert_block_last(result, "complete")
        self.assertEqual(self.scope_text(), published)  # not the stale v2
        self.assertEqual(self.record()["scope_page"]["version"], 3)
        self.assertEqual(result["counts"]["scopes_replaced"], 0)
        self.assertFalse(any("not applied" in n for n in result["notes"]))
        # and directly: a record at or past the page's version applies nothing
        before = (self.dir / "engagement.yaml").read_bytes()
        out = engage.apply_page_revision(
            self.root, ENG, {"id": SCOPE_PAGE, "version": 3, "body": EDITED})
        self.assertEqual((out["applied"], out["retry"], out["note"],
                          out["written"]), (False, False, None, []))
        self.assertEqual(self.scope_text(), published)
        self.assertEqual((self.dir / "engagement.yaml").read_bytes(), before)

    def test_a_dry_run_writes_nothing(self):
        self.fake.scope_page(SCOPE_PAGE, EDITED, 2)
        result = self.run_tick(dry_run=True)
        self.assertEqual(result["counts"]["engagement_pages_mirrored"], 1)
        self.assertFalse((self.root / self.MIRROR).exists())
        self.assertEqual(self.scope_text(), self.SCOPE)
        self.assertEqual(self.record()["scope_page"]["version"], 1)


if __name__ == "__main__":
    unittest.main()
