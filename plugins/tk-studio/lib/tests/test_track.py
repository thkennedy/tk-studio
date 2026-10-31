"""Tests for `tk-studio-track block` (Story 31.5, AC1) and `reply` (31.6).

`track.block` moves a story's issue and each dependent's (the entities whose
`depends_on` names it) to `Blocked - Awaiting User` by transition name, with
one agent comment that @mentions the owner, through `jirabackend` (AD-4). A
fake Atlassian REST stands in behind the transport seam (the sync-back's,
plus the issue status, the transitions by name and the comment POST, whose
shapes are pinned here): no test makes a network call. Covered: the block
with its dependents, the comment text with the wiki mention, idempotence,
every refusal (no call where none may be made), a failed dependent, the
loop story key, the dry run and the CLI.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import re
import sys
import tempfile
import unittest
import unittest.mock
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import interchange  # noqa: E402
import jirabackend  # noqa: E402
import inbox  # noqa: E402
import plansync  # noqa: E402
import track  # noqa: E402

from test_syncback import (AGENT, KEY, NOW, OWNER, FakeSyncBack,  # noqa: E402
                           SyncBackTestCase, comment, stamp)

BLOCKED = jirabackend.BLOCKED_STATUS
WORKFLOW = ["To Do", "In Progress", BLOCKED, jirabackend.RESOLVED_STATUS, "Done"]


class FakeTrack(FakeSyncBack):
    """The sync-back fake plus the block's routes: `GET /issue/{key}` (the
    status), `GET|POST /issue/{key}/transitions` (by id, each naming its
    target status) and `POST /issue/{key}/comment` (posted as the agent
    into the `comment_store` the live `GET /issue/{key}/comment` reads)."""

    def __init__(self):
        super().__init__()
        self.status: dict[str, str] = {}
        self.no_blocked: set[str] = set()   # workflows lacking the transition
        self.no_resolved: set[str] = set()  # ... into Block Resolved (31.6)
        self.comment_as = AGENT             # the seat the token belongs to
        self.posted: dict[str, list[str]] = {}
        self.lacking: dict[str, set[str]] = {}  # 31.7: more missing targets
        # 32.3: the engagement issue's create and its exact-summary search
        self.created: list[dict] = []        # each POST /issue's fields
        self.summaries: dict[str, str] = {}  # key -> summary (the search)
        self.next_issue = 100
        self.refuse_create = False           # a 400 (e.g. no Task type)

    def _jira(self, method, path, query, body):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        if method == "GET" and path == "/search/jql" \
                and q.get("fields") == "summary,status":
            self.jql.append(q["jql"])
            # a contains-match (as Jira's `~`): the caller matches exactly
            m = re.search(r'summary ~ "\\"(.+)\\""$', q["jql"])
            wanted = m.group(1) if m else ""
            return 200, {"issues": [
                {"key": k, "fields": {"summary": v, "status": {
                    "name": self.status.get(k, "To Do")}}}
                for k, v in self.summaries.items() if wanted in v]}
        if method == "POST" and path == "/issue":
            assert set(body) == {"fields"}, body
            if self.refuse_create:
                return 400, {"errors": {"issuetype": "The issue type "
                                        "selected is invalid."}}
            self.created.append(body["fields"])
            key = f"{KEY}-{self.next_issue}"
            self.next_issue += 1
            self.summaries[key] = body["fields"]["summary"]
            self.status[key] = "To Do"
            return 201, {"id": "1", "key": key}
        m = re.match(r"^/issue/([^/]+)$", path)
        if method == "GET" and m and m.group(1) in self.status:
            return 200, {"key": m.group(1), "fields": {"status": {
                "name": self.status[m.group(1)],
                "statusCategory": {"key": "indeterminate"}}}}
        m = re.match(r"^/issue/([^/]+)/transitions$", path)
        if m and m.group(1) in self.status:
            names = [n for n in WORKFLOW if not (
                n == BLOCKED and m.group(1) in self.no_blocked) and not (
                n == jirabackend.RESOLVED_STATUS
                and m.group(1) in self.no_resolved)
                and n not in self.lacking.get(m.group(1), ())]
            if method == "GET":
                return 200, {"transitions": [
                    {"id": str(10 * (WORKFLOW.index(n) + 1)),
                     "to": {"name": n,
                            "statusCategory": {"key": "indeterminate"}}}
                    for n in names]}
            assert set(body) == {"transition"}, body
            self.status[m.group(1)] = WORKFLOW[
                int(body["transition"]["id"]) // 10 - 1]
            # the changelog (31.7) records the move as the token's seat
            self.history(m.group(1), f"h{len(self.calls)}", self.comment_as,
                         self.status[m.group(1)], stamp(0))
            return 204, None
        m = re.match(r"^/issue/([^/]+)/comment$", path)
        if method == "POST" and m:
            assert set(body) == {"body"}, body
            self.posted.setdefault(m.group(1), []).append(body["body"])
            created = comment(str(10000 + len(self.posted[m.group(1)])),
                              self.comment_as, body["body"], 0)
            self.comment_store.setdefault(m.group(1), []).append(created)
            return 201, created
        return super()._jira(method, path, query, body)


def body(reason="the spec needs a ruling", resolves="a ruling in the spec",
         blocked_by=None):
    text = (f"[~accountid:{OWNER}] Blocked: {reason}\n"
            f"Resolves when: {resolves}")
    return text + (f"\nBlocked by: {blocked_by}" if blocked_by else "")


class TrackTestCase(SyncBackTestCase):
    def setUp(self):
        super().setUp()
        self.fake = FakeTrack()
        self.bind("ST-002", f"{KEY}-2", "To Do", "ready")
        self.bind("ST-003", f"{KEY}-3", "In Progress", "in-progress")
        for n, name in ((1, "In Progress"), (2, "To Do"), (3, "In Progress")):
            self.fake.status[f"{KEY}-{n}"] = name

    def seed_comment(self, key, author, text, minutes_ago, cid=None):
        """A comment already on `key` in the fake REST (no sync-back log)."""
        store = self.fake.comment_store.setdefault(key, [])
        store.append(comment(cid or f"c{len(store) + 1}", author, text,
                             minutes_ago))

    def set_front(self, entity_id, **fields):
        path = plansync.plan_dir(self.root) / f"{entity_id}.md"
        front, text = interchange.parse_entity(path)
        for name, value in fields.items():
            if value is None:
                front.pop(name, None)
            else:
                front[name] = value
        path.write_text(interchange.render_entity(front, text),
                        encoding="utf-8", newline="\n")

    def depends(self, entity_id, *on):
        path = plansync.plan_dir(self.root) / f"{entity_id}.md"
        front, text = interchange.parse_entity(path)
        front["depends_on"] = list(on)
        path.write_text(interchange.render_entity(front, text),
                        encoding="utf-8", newline="\n")

    def block(self, story="ST-001", **kwargs):
        kwargs.setdefault("reason", "the spec needs a ruling")
        kwargs.setdefault("resolves", "a ruling in the spec")
        return track.block(self.root, story, transport=self.fake,
                           sleep=self.sleeps.append, **kwargs)

    def assert_track_block(self, result, status):
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts",
                                             "reason"])
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-track")
        self.assertEqual(result["ok"], status != "blocked")
        self.assertNotIn("retry", result)

    def writes(self):
        return [c for c in self.fake.calls if c[0] in ("POST", "PUT")]


class BlockTests(TrackTestCase):
    def test_the_story_and_its_two_dependents_move_and_get_one_comment(self):
        self.depends("ST-002", "ST-001")
        self.depends("ST-003", "ST-001")
        result = self.block()
        self.assert_track_block(result, "complete")
        self.assertEqual([(i["issue"], i["entity"], i["role"],
                           i["transitioned"], i["commented"])
                          for i in result["issues"]],
                         [(f"{KEY}-1", "ST-001", "story", True, True),
                          (f"{KEY}-2", "ST-002", "dependent", True, True),
                          (f"{KEY}-3", "ST-003", "dependent", True, True)])
        self.assertEqual(set(self.fake.status.values()), {BLOCKED})
        self.assertEqual(self.fake.posted, {
            f"{KEY}-1": [body()],
            f"{KEY}-2": [body(blocked_by=f"{KEY}-1")],
            f"{KEY}-3": [body(blocked_by=f"{KEY}-1")]})
        # by name: the transition posted is Blocked - Awaiting User's id
        posts = [c for c in self.writes() if c[1].endswith("/transitions")]
        self.assertEqual(len(posts), 3)
        # nothing local written, nothing else promoted (D9)
        self.assertEqual(result["written"], [])
        self.assertEqual(result["artifacts"], [])
        self.assertFalse([c for c in self.writes()
                          if not re.match(r"^/issue/[^/]+/(transitions|comment)$",
                                          c[1])])
        self.assertNotIn("fake-jira-token", json.dumps(result))

    def test_the_comment_mentions_the_owner_as_the_sync_back_reads_it(self):
        self.block(reason="no token", resolves="TK_X is set")
        (text,) = self.fake.posted[f"{KEY}-1"]
        self.assertEqual(text, f"[~accountid:{OWNER}] Blocked: no token\n"
                               f"Resolves when: TK_X is set")
        import syncback
        self.assertEqual(syncback.MENTION_RE.findall(text), [OWNER])

    def test_a_loop_story_key_maps_by_the_entity_source(self):
        result = self.block("1-2-beta-story")
        self.assert_track_block(result, "complete")
        self.assertEqual(result["issues"][0]["entity"], "ST-002")
        self.assertEqual(self.fake.status[f"{KEY}-2"], BLOCKED)

    def test_no_dependents_by_default(self):
        result = self.block()
        self.assertEqual([i["issue"] for i in result["issues"]], [f"{KEY}-1"])

    def test_re_block_skips_and_names_the_transition_and_the_comment(self):
        # the retry or re-pause inside the sync-back's window: no log yet,
        # the skip reads the issue's comments live
        self.block()
        self.assertFalse((self.root / "_bmad-output" / "tracking").exists())
        writes = len(self.writes())
        result = self.block()
        self.assert_track_block(result, "complete")
        (entry,) = result["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (False, False))
        self.assertEqual(len(entry["skipped"]), 2)
        self.assertTrue(entry["skipped"][0].startswith("transition:"))
        self.assertTrue(entry["skipped"][1].startswith("comment:"))
        self.assertEqual(len(self.writes()), writes)

    def test_a_re_block_after_block_resolved_comments_again(self):
        # block -> the owner moves it to Block Resolved -> the loop pauses
        # again with the same reason: the issue moves back and the owner is
        # mentioned again, though the newest agent body is the same
        self.fake.status[f"{KEY}-1"] = jirabackend.RESOLVED_STATUS
        self.seed_comment(f"{KEY}-1", AGENT, body(), 60)
        result = self.block()
        self.assert_track_block(result, "complete")
        (entry,) = result["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (True, True))
        self.assertNotIn("skipped", entry)
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)
        self.assertEqual(self.fake.posted[f"{KEY}-1"], [body()])

    def test_a_log_less_re_block_whose_live_newest_agent_comment_matches(self):
        # already blocked; the live newest agent comment (an owner reply
        # after it is no agent comment) says this: no comment, GET only
        self.fake.status[f"{KEY}-1"] = BLOCKED
        self.seed_comment(f"{KEY}-1", AGENT, "an older agent note", 90)
        self.seed_comment(f"{KEY}-1", AGENT, body() + "\n", 60)
        self.seed_comment(f"{KEY}-1", OWNER, "looking", 30)
        result = self.block()
        self.assert_track_block(result, "complete")
        (entry,) = result["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (False, False))
        self.assertTrue(entry["skipped"][1].startswith("comment:"))
        self.assertEqual(self.writes(), [])
        self.assertIn(("GET", f"/issue/{KEY}-1/comment"), self.fake.calls)
        self.assertFalse((self.root / "_bmad-output" / "tracking").exists())

    def test_a_log_less_re_block_whose_live_newest_agent_comment_differs(self):
        # the matching body is an older agent comment, or the owner's: the
        # newest agent comment differs, so the block comment is posted
        self.fake.status[f"{KEY}-1"] = BLOCKED
        self.seed_comment(f"{KEY}-1", AGENT, body(), 90)
        self.seed_comment(f"{KEY}-1", AGENT, body(reason="an old reason"), 60)
        self.seed_comment(f"{KEY}-1", OWNER, body(), 30)
        result = self.block()
        self.assert_track_block(result, "complete")
        (entry,) = result["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (False, True))
        self.assertEqual(self.fake.posted[f"{KEY}-1"], [body()])

    def test_not_yet_blocked_makes_no_comment_read(self):
        self.block()
        self.assertNotIn(("GET", f"/issue/{KEY}-1/comment"), self.fake.calls)

    def test_already_in_the_status_with_a_new_reason_comments_only(self):
        self.fake.status[f"{KEY}-1"] = BLOCKED
        result = self.block(reason="another reason")
        (entry,) = result["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (False, True))
        self.assertFalse([c for c in self.writes()
                          if c[1].endswith("/transitions")])

    def test_dry_run_reads_and_writes_nothing(self):
        self.depends("ST-002", "ST-001")
        result = self.block(dry_run=True)
        self.assert_track_block(result, "partial")
        self.assertTrue(result["dry_run"])
        self.assertEqual(self.writes(), [])
        self.assertTrue(any(n.startswith("dry run:") for n in result["notes"]))

    def test_engagement_source_fixes_the_shape(self):
        result = self.block(source="engagement")
        self.assert_track_block(result, "complete")
        self.assertEqual(result["source"], "engagement")


class PartialTests(TrackTestCase):
    def test_a_dependent_whose_transition_is_refused_is_partial(self):
        self.depends("ST-002", "ST-001")
        self.depends("ST-003", "ST-001")
        self.fake.no_blocked.add(f"{KEY}-3")
        result = self.block()
        self.assert_track_block(result, "partial")
        self.assertIn(f"{KEY}-3", result["reason"])
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)
        self.assertEqual(self.fake.status[f"{KEY}-2"], BLOCKED)
        self.assertEqual(self.fake.status[f"{KEY}-3"], "In Progress")
        self.assertNotIn(f"{KEY}-3", self.fake.posted)
        self.assertIn("error", result["issues"][2])

    def test_a_dependent_comment_refused_by_name_keeps_transitioned(self):
        self.depends("ST-002", "ST-001")
        self.fake.force[("POST", f"/issue/{KEY}-2/comment")] = (
            400, {"errorMessages": ["bad body"]})
        result = self.block()
        self.assert_track_block(result, "partial")
        dep = result["issues"][1]
        self.assertEqual((dep["issue"], dep["transitioned"], dep["commented"]),
                         (f"{KEY}-2", True, False))
        self.assertTrue(dep["error"].startswith("block comment refused: "))
        self.assertEqual(self.fake.status[f"{KEY}-2"], BLOCKED)

    def test_a_dependent_never_promoted_is_partial(self):
        self.set_front("ST-003", depends_on=["ST-001"], external=None)
        result = self.block()
        self.assert_track_block(result, "partial")
        self.assertIn("ST-003: never promoted", result["reason"])


class DependentScopeTests(TrackTestCase):
    def test_only_open_story_entities_are_dependents(self):
        # an epic naming the story is no dependent (AC1: dependent stories);
        # a dependent story already done or dropped is skipped with a note
        self.set_front("EP-002", depends_on=["ST-001"])
        self.depends("ST-002", "ST-001")
        self.set_front("ST-003", depends_on=["ST-001"], status="done")
        result = self.block()
        self.assert_track_block(result, "complete")
        self.assertEqual([(i["issue"], i["role"]) for i in result["issues"]],
                         [(f"{KEY}-1", "story"), (f"{KEY}-2", "dependent")])
        self.assertTrue(any(n.startswith("ST-003: a dependent already 'done'")
                            for n in result["notes"]))
        self.assertEqual(self.fake.status[f"{KEY}-3"], "In Progress")
        self.assertNotIn(f"{KEY}-3", self.fake.posted)
        self.set_front("ST-003", status="dropped")
        result = self.block()
        self.assertTrue(any(n.startswith("ST-003: a dependent already "
                                         "'dropped'") for n in result["notes"]))


class TransientTests(TrackTestCase):
    """A temporary failure on the story's own issue is no refusal: it ends
    `partial` with `ok: false` and `retry: true`, so the supervisor calls
    again on its next pass (Settled shape 4)."""

    def assert_retry(self, result):
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts",
                                             "reason"])
        self.assertEqual((result["status"], result["ok"], result["retry"]),
                         ("partial", False, True))
        self.assertTrue(result["reason"].startswith("track retry: "))

    def test_a_5xx_is_retried_not_refused(self):
        self.fake.force[("GET", f"/issue/{KEY}-1")] = (503, "unavailable")
        self.assert_retry(self.block())
        self.assertEqual(self.writes(), [])

    def test_an_exhausted_429_is_retried_not_refused(self):
        self.fake.force[("GET", f"/issue/{KEY}-1")] = (
            429, {}, {"Retry-After": "600"})
        result = self.block()
        self.assert_retry(result)
        self.assertIn("429", result["reason"])

    def test_the_site_unreachable_is_retried_not_refused(self):
        def down(method, url, body):
            raise jirabackend.JiraError("cannot reach api.atlassian.com: "
                                        "timed out")
        result = track.block(self.root, "ST-001", "x", "y", transport=down)
        self.assert_retry(result)

    def test_a_transient_dependent_failure_is_retried(self):
        # the story's issue moved; KEY-2's read answers 503: the rest of the
        # dependents still run, and the answer asks for a retry
        self.depends("ST-002", "ST-001")
        self.depends("ST-003", "ST-001")
        self.fake.force[("GET", f"/issue/{KEY}-2")] = (503, "unavailable")
        result = self.block()
        self.assert_retry(result)
        self.assertIn(f"{KEY}-2", result["reason"])
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)
        self.assertEqual(self.fake.status[f"{KEY}-3"], BLOCKED)
        self.assertEqual([i["issue"] for i in result["issues"]],
                         [f"{KEY}-1", f"{KEY}-2", f"{KEY}-3"])
        self.assertIn("error", result["issues"][1])
        # the retry: the landed issues skip, only KEY-2 moves and comments
        del self.fake.force[("GET", f"/issue/{KEY}-2")]
        result = self.block()
        self.assert_track_block(result, "complete")
        self.assertEqual([(i["transitioned"], i["commented"])
                          for i in result["issues"]],
                         [(False, False), (True, True), (False, False)])
        self.assertEqual({k: len(v) for k, v in self.fake.posted.items()},
                         {f"{KEY}-1": 1, f"{KEY}-2": 1, f"{KEY}-3": 1})

    def test_a_transient_story_comment_failure_is_retried(self):
        self.fake.force[("POST", f"/issue/{KEY}-1/comment")] = (503, "down")
        self.assert_retry(self.block())

    def test_a_story_comment_refused_by_name_is_blocked_and_accurate(self):
        self.fake.force[("POST", f"/issue/{KEY}-1/comment")] = (
            403, {"errorMessages": ["no permission"]})
        result = self.block()
        self.assert_track_block(result, "blocked")
        self.assertIn("block comment refused", result["reason"])
        (entry,) = result["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (True, False))
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)

    def test_a_by_name_refusal_on_the_issue_stays_blocked(self):
        self.fake.force[("GET", f"/issue/{KEY}-1")] = (404, {})
        result = self.block()
        self.assert_track_block(result, "blocked")
        self.assertNotIn("retry", result)

    def test_cli_exits_0_on_a_retry(self):
        self.fake.force[("GET", f"/issue/{KEY}-1")] = (502, "bad gateway")
        out = io.StringIO()
        with unittest.mock.patch.object(jirabackend, "client_for",
                                        _client_with(self.fake)), \
                contextlib.redirect_stdout(out):
            code = track.main(["block", "--directory", str(self.root),
                               "--story", "ST-001", "--reason", "x",
                               "--resolves", "y"])
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out.getvalue())["retry"])


def _client_with(transport):
    real = jirabackend.client_for

    def client_for(settings, _transport=None):
        return real(settings, transport)
    return client_for


class RefusalTests(TrackTestCase):
    def assert_refused(self, result, *names, calls=False):
        self.assert_track_block(result, "blocked")
        for name in names:
            self.assertIn(name, result["reason"])
        if not calls:
            self.assertEqual(self.fake.calls, [])

    def test_no_binding_makes_no_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = track.block(Path(tmp), "ST-001", "x", "y",
                                 transport=self.fake)
        self.assert_refused(result, "planning.jira.project_key",
                            "no Atlassian call made")

    def test_absent_env_is_named_with_no_call(self):
        for name in (jirabackend.AGENT_TOKEN_ENV, jirabackend.AGENT_EMAIL_ENV,
                     jirabackend.CLOUD_ID_ENV):
            with self.subTest(name=name):
                saved = os.environ.pop(name)
                try:
                    result = self.block()
                finally:
                    os.environ[name] = saved
                self.assert_refused(result, name, "no Atlassian call made")

    def test_no_owner_account_id_is_refused(self):
        text = self.config.read_text(encoding="utf-8")
        self.config.write_text(re.sub(r"\n\s*owner_account_id:[^\n]*", "",
                                      text), encoding="utf-8")
        result = self.block()
        self.assert_refused(result, "planning.jira.owner_account_id")

    def test_never_promoted_is_refused(self):
        result = self.block("EP-001")
        self.assert_refused(result, "EP-001 was never promoted",
                            "external.jira.key")

    def test_an_unknown_story_is_refused(self):
        self.assert_refused(self.block("ST-999"), "no plan entity")
        self.assert_refused(self.block("9-9-nothing"), "no plan entity")
        self.assert_refused(self.block("not a key"), "neither an entity id")

    def test_no_transition_reaching_the_status_is_refused_by_name(self):
        self.fake.no_blocked.add(f"{KEY}-1")
        self.depends("ST-002", "ST-001")
        result = self.block()
        self.assert_refused(result, f"{KEY}-1", "'Blocked - Awaiting User'",
                            calls=True)
        self.assertEqual(self.writes(), [])  # no comment, no dependent
        self.assertEqual(self.fake.status[f"{KEY}-2"], "To Do")

    def test_a_bad_source_or_empty_reason_is_refused(self):
        self.assert_refused(self.block(source="chat"), "--source")
        self.assert_refused(self.block(reason="  "), "--reason")

    def test_cli_refusal_exits_2_with_the_block_last(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = track.main(["block", "--directory", tmp, "--story",
                                   "ST-119", "--reason", "x", "--resolves",
                                   "y"])
        self.assertEqual(code, 2)
        result = json.loads(out.getvalue())
        self.assert_track_block(result, "blocked")
        self.assertIn("track refused", result["reason"])


# ------------------------------------------------------------------- reply

RESOLVED = jirabackend.RESOLVED_STATUS
OWNER_ENV = {jirabackend.OWNER_EMAIL_ENV: "owner@example.com",
             jirabackend.OWNER_TOKEN_ENV: "fake-owner-token"}


class ReplyTestCase(TrackTestCase):
    """Story 31.6: `track.reply` posts the owner's comment with the owner
    seat's gateway client, then moves the issue to `Block Resolved` by
    name. The fake answers the comment as the seat whose token posted it
    (`comment_as`)."""

    ENV_KEYS = (*TrackTestCase.ENV_KEYS, *OWNER_ENV)

    def setUp(self):
        super().setUp()
        os.environ.update(OWNER_ENV)
        self.fake.comment_as = OWNER
        self.fake.status[f"{KEY}-1"] = BLOCKED

    def reply(self, issue=f"{KEY}-1", **kwargs):
        if "body" not in kwargs and not kwargs.get("done"):
            kwargs["body"] = "Use the second option."
        return track.reply(self.root, issue, transport=self.fake,
                           sleep=self.sleeps.append, **kwargs)

    def assert_reply_block(self, result, status, ok=None):
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts",
                                             "reason"])
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-track")
        self.assertEqual(result["ok"], status != "blocked" if ok is None
                         else ok)
        for name in ("dry_run", "issue", "commented", "comment_id",
                     "transitioned", "notes", "skipped", "written"):
            self.assertIn(name, result)


class ReplyTests(ReplyTestCase):
    def test_a_reply_comments_as_the_owner_then_moves_to_block_resolved(self):
        result = self.reply()
        self.assert_reply_block(result, "complete")
        self.assertEqual((result["commented"], result["transitioned"]),
                         (True, True))
        self.assertEqual(result["comment_id"], "10001")
        self.assertEqual(self.fake.posted, {f"{KEY}-1":
                                            ["Use the second option."]})
        self.assertEqual(self.fake.status[f"{KEY}-1"], RESOLVED)
        # the comment, then the transition by name; nothing else written
        self.assertEqual([c[1] for c in self.writes()],
                         [f"/issue/{KEY}-1/comment",
                          f"/issue/{KEY}-1/transitions"])
        # the owner seat's gateway, REST v2
        self.assertTrue(all(u.startswith(
            "https://api.atlassian.com/ex/jira/cloud-test/rest/api/2/")
            for u in self.fake.urls))
        self.assertEqual(result["written"], [])
        self.assertFalse((self.root / "_bmad-output" / "tracking").exists())
        self.assertNotIn("fake-owner-token", json.dumps(result))

    def test_done_writes_done_as_the_owner(self):
        result = self.reply(done=True)
        self.assert_reply_block(result, "complete")
        self.assertEqual(self.fake.posted[f"{KEY}-1"], ["Done."])
        self.assertEqual(self.fake.status[f"{KEY}-1"], RESOLVED)

    def test_done_twice_posts_once(self):
        self.assert_reply_block(self.reply(done=True), "complete")
        result = self.reply(done=True)
        self.assert_reply_block(result, "complete")
        self.assertEqual(self.fake.posted[f"{KEY}-1"], ["Done."])
        self.assertTrue(result["commented"])
        self.assertEqual([x.split(":")[0] for x in result["skipped"]],
                         ["comment", "transition"])

    def test_a_reply_to_a_later_block_posts_again(self):
        # Done answered an earlier block; a newer agent block comment
        # follows it: the same Done is a new reply
        self.seed_comment(f"{KEY}-1", OWNER, "Done.", 90)
        self.seed_comment(f"{KEY}-1", AGENT, body(), 30)
        result = self.reply(done=True)
        self.assert_reply_block(result, "complete")
        self.assertEqual(self.fake.posted[f"{KEY}-1"], ["Done."])
        self.assertEqual(result["skipped"], [])

    def test_the_owner_seat_signs_the_requests_never_the_agent(self):
        seen = []
        real = jirabackend.JiraClient.for_owner

        def spy(*args, **kwargs):
            client = real(*args, **kwargs)
            seen.append(client)
            return client
        with unittest.mock.patch.object(jirabackend.JiraClient, "for_owner",
                                        spy):
            self.reply(done=True)
        (client,) = seen
        self.assertEqual(client.token_env, jirabackend.OWNER_TOKEN_ENV)
        import base64
        auth = base64.b64decode(client._headers["Authorization"].split()[1])
        self.assertEqual(auth.decode(), "owner@example.com:fake-owner-token")

    def test_already_resolved_comments_and_skips_the_transition(self):
        self.fake.status[f"{KEY}-1"] = RESOLVED
        result = self.reply()
        self.assert_reply_block(result, "complete")
        self.assertEqual((result["commented"], result["transitioned"]),
                         (True, False))
        self.assertEqual(len(result["skipped"]), 1)
        self.assertTrue(result["skipped"][0].startswith("transition:"))
        self.assertFalse([c for c in self.writes()
                          if c[1].endswith("/transitions")])

    def test_dry_run_reads_and_writes_nothing(self):
        result = self.reply(dry_run=True)
        self.assert_reply_block(result, "partial")
        self.assertTrue(result["dry_run"])
        self.assertEqual(self.writes(), [])
        self.assertTrue(any(n.startswith("dry run:") for n in result["notes"]))
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)

    def test_dry_run_predicts_the_skip_of_a_standing_owner_reply(self):
        # the owner's identical Done already follows the newest agent
        # comment: the dry run names the skip the real run would make
        self.seed_comment(f"{KEY}-1", AGENT, body(), 90)
        self.seed_comment(f"{KEY}-1", OWNER, "Done.", 30)
        result = self.reply(done=True, dry_run=True)
        self.assert_reply_block(result, "partial")
        self.assertEqual(self.writes(), [])
        self.assertEqual(result["commented"], False)
        self.assertEqual(result["comment_id"], None)
        self.assertEqual([x.split(":")[0] for x in result["skipped"]],
                         ["comment"])
        self.assertFalse([n for n in result["notes"]
                          if "owner's comment" in n])
        self.assertTrue(any("would move" in n for n in result["notes"]))
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)

    def test_cli_reads_the_body_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "body.txt"
            path.write_text("from the iPad\nsecond line", encoding="utf-8")
            out = io.StringIO()
            with unittest.mock.patch.object(
                    jirabackend, "owner_client",
                    _owner_client_with(self.fake)), \
                    contextlib.redirect_stdout(out):
                code = track.main(["reply", "--directory", str(self.root),
                                   "--issue", f"{KEY}-1", "--body-file",
                                   str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out.getvalue())
        self.assert_reply_block(result, "complete")
        self.assertEqual(self.fake.posted[f"{KEY}-1"],
                         ["from the iPad\nsecond line"])


def _owner_client_with(transport):
    real = jirabackend.owner_client

    def owner_client(_transport=None, site=None):
        return real(transport, site=site)
    return owner_client


class ReplyRefusalTests(ReplyTestCase):
    def assert_refused(self, result, *names, calls=False):
        self.assert_reply_block(result, "blocked")
        for name in names:
            self.assertIn(name, result["reason"])
        if not calls:
            self.assertEqual(self.fake.calls, [])

    def test_absent_owner_env_is_named_with_no_call(self):
        for name in (jirabackend.OWNER_EMAIL_ENV, jirabackend.OWNER_TOKEN_ENV,
                     jirabackend.CLOUD_ID_ENV):
            with self.subTest(name=name):
                saved = os.environ.pop(name)
                try:
                    result = self.reply(done=True)
                finally:
                    os.environ[name] = saved
                self.assert_refused(result, name, "no Atlassian call made")

    def test_the_agent_token_never_stands_in_for_the_owner(self):
        # the agent seat is fully set (TrackTestCase); the owner's is not
        for name in OWNER_ENV:
            os.environ.pop(name)
        result = self.reply(done=True)
        self.assert_refused(result, jirabackend.OWNER_TOKEN_ENV,
                            jirabackend.OWNER_EMAIL_ENV)

    def test_no_binding_makes_no_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = track.reply(Path(tmp), f"{KEY}-1", done=True,
                                 transport=self.fake)
        self.assert_refused(result, "planning.jira.project_key",
                            "no Atlassian call made")

    def test_no_owner_account_id_is_refused(self):
        text = self.config.read_text(encoding="utf-8")
        self.config.write_text(re.sub(r"\n\s*owner_account_id:[^\n]*", "",
                                      text), encoding="utf-8")
        self.assert_refused(self.reply(), "planning.jira.owner_account_id")

    def test_a_bad_key_or_body_is_refused(self):
        self.assert_refused(self.reply("st-1"), "not a Jira issue key")
        self.assert_refused(self.reply(body="   "), "empty")
        self.assert_refused(self.reply(body="x", done=True), "exactly one")
        self.assert_refused(track.reply(self.root, f"{KEY}-1",
                                        transport=self.fake), "exactly one")

    def test_a_comment_from_another_seat_moves_nothing(self):
        # the owner variables hold the agent's token: the created comment's
        # author is the agent, named; the issue stays where it was
        self.fake.comment_as = AGENT
        result = self.reply()
        self.assert_refused(result, AGENT, OWNER, "nothing moved",
                            jirabackend.OWNER_TOKEN_ENV, calls=True)
        self.assertEqual((result["commented"], result["transitioned"]),
                         (True, False))
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)
        self.assertFalse([c for c in self.writes()
                          if c[1].endswith("/transitions")])

    def test_no_transition_to_block_resolved_keeps_the_comment(self):
        self.fake.no_resolved.add(f"{KEY}-1")
        result = self.reply()
        self.assert_refused(result, f"{KEY}-1", "'Block Resolved'",
                            calls=True)
        self.assertEqual((result["commented"], result["transitioned"]),
                         (True, False))
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)

    def test_cli_no_env_exits_2_with_the_block_last(self):
        for name in OWNER_ENV:
            os.environ.pop(name)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = track.main(["reply", "--directory", str(self.root),
                               "--issue", f"{KEY}-1", "--done"])
        self.assertEqual(code, 2)
        result = json.loads(out.getvalue())
        self.assert_reply_block(result, "blocked")
        self.assertIn("no Atlassian call made", result["reason"])


class ReplyTransientTests(ReplyTestCase):
    def assert_retry(self, result):
        self.assert_reply_block(result, "partial", ok=False)
        self.assertTrue(result["retry"])
        self.assertTrue(result["reason"].startswith("track retry: "))

    def test_a_5xx_is_retried(self):
        self.fake.force[("GET", f"/issue/{KEY}-1")] = (503, "unavailable")
        self.assert_retry(self.reply())
        self.assertEqual(self.writes(), [])

    def test_a_retry_after_a_failed_transition_posts_once(self):
        # the comment landed, the transition read answered 503: the owner
        # presses Send again — the comment is not posted twice
        self.fake.force[("GET", f"/issue/{KEY}-1/transitions")] = (503, "x")
        first = self.reply()
        self.assert_retry(first)
        self.assertTrue(first["commented"])
        del self.fake.force[("GET", f"/issue/{KEY}-1/transitions")]
        result = self.reply()
        self.assert_reply_block(result, "complete")
        self.assertEqual((result["commented"], result["transitioned"]),
                         (True, True))
        self.assertEqual(result["comment_id"], first["comment_id"])
        self.assertTrue(result["skipped"][0].startswith("comment:"))
        self.assertEqual(self.fake.posted[f"{KEY}-1"],
                         ["Use the second option."])
        self.assertEqual(self.fake.status[f"{KEY}-1"], RESOLVED)

    def test_an_exhausted_429_on_the_comment_is_retried(self):
        self.fake.force[("POST", f"/issue/{KEY}-1/comment")] = (
            429, {}, {"Retry-After": "600"})
        result = self.reply()
        self.assert_retry(result)
        self.assertIn("429", result["reason"])
        self.assertFalse(result["commented"])



# ---------------------------------------------------------------- validate

SPEC_TEXT = """---
title: 'Beta'
status: 'in-progress'
---

<intent-contract>

## Intent

Build the beta.

</intent-contract>

## Code Map
"""


class ValidateTestCase(TrackTestCase):
    """Story 31.7: `track.validate` checks a resolution with the agent seat
    only. The issue sits in `Block Resolved` after the owner's transition
    (the fake's changelog), the sync-back's comment log holds the block
    comment and the owner's reply, and `inbox.json` the `resolved` item."""

    ISSUE = f"{KEY}-1"

    def setUp(self):
        super().setUp()
        for name in (jirabackend.OWNER_EMAIL_ENV, jirabackend.OWNER_TOKEN_ENV):
            self.assertNotIn(name, os.environ)
        self.fake.status[self.ISSUE] = RESOLVED
        self.fake.history(self.ISSUE, "h-1", AGENT, BLOCKED, stamp(60))
        self.fake.history(self.ISSUE, "h-2", OWNER, RESOLVED, stamp(20))
        self.log(("c1", "agent", "agent", body(), 60, ["owner"]),
                 ("c0", "owner", "owner", "an older owner note", 90, []),
                 ("c2", "owner", "owner", "Use the second option.", 25, []))
        self.write_inbox("resolved")

    # ---- helpers
    def log(self, *entries):
        path = self.root / "_bmad-output" / "tracking" / self.ISSUE / \
            "comments.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="\n") as fh:
            for cid, author, updater, text, ago, mentions in entries:
                fh.write(json.dumps({
                    "issue": self.ISSUE, "id": cid, "author": author,
                    "update_author": updater, "body": text,
                    "mentions": mentions, "created": stamp(ago),
                    "updated": stamp(ago), "source": "jira"}) + "\n")

    def write_inbox(self, state):
        path = self.root / inbox.INBOX_REL
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "inbox_version": 1, "generated_at": NOW.isoformat(),
            "project_key": KEY, "items": [{
                "issue": self.ISSUE, "entity": "ST-001", "priority": None,
                "blocked_since": stamp(60), "reason_comment": {
                    "id": "c1", "body": body(), "created": stamp(60)},
                "state": state}]}), encoding="utf-8")

    def inbox_state(self):
        return inbox.load(self.root)["items"][0]["state"]

    def validate(self, issue=None, **kwargs):
        return track.validate(self.root, issue or self.ISSUE,
                              transport=self.fake, sleep=self.sleeps.append,
                              now=NOW, **kwargs)

    def lines(self):
        path = self.root / "_bmad-output" / "tracking" / self.ISSUE / \
            "validation.jsonl"
        return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()] \
            if path.is_file() else []

    def spec(self, text=SPEC_TEXT):
        path = self.root / "_bmad-output" / "specs" / "1-2-beta-spec.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        return path

    def assert_validate_block(self, result, status, ok=None):
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts",
                                             "reason"])
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-track")
        self.assertEqual(result["ok"], status != "blocked" if ok is None
                         else ok)
        self.assertEqual(result["artifacts"], result["written"])
        for name in ("dry_run", "issue", "mode", "entity", "story",
                     "owner_resolved", "transition", "reason_comment",
                     "replies", "notes", "written"):
            self.assertIn(name, result)
        self.assertNotIn("fake-jira-token", json.dumps(result))


class ValidateCheckTests(ValidateTestCase):
    def test_owner_resolved_fills_the_check_and_marks_validating(self):
        result = self.validate(check=True)
        self.assert_validate_block(result, "complete")
        self.assertTrue(result["owner_resolved"])
        self.assertEqual(result["transition"], {
            "id": "h-2", "created": stamp(20), "account_id": OWNER})
        self.assertEqual((result["entity"], result["story"], result["mode"]),
                         ("ST-001", "1.1", "check"))
        self.assertEqual(result["reason_comment"],
                         {"id": "c1", "body": body(), "created": stamp(60)})
        # only the owner's comments after the newest agent comment
        self.assertEqual(result["replies"], [
            {"id": "c2", "body": "Use the second option.",
             "created": stamp(25)}])
        self.assertEqual(self.inbox_state(), "validating")
        self.assertEqual(result["written"], ["_bmad-output/tracking/inbox.json"])
        # reads only: the status, then the changelog; nothing written
        self.assertEqual(self.writes(), [])
        self.assertIn(("GET", f"/issue/{self.ISSUE}/changelog"),
                      self.fake.calls)
        self.assertEqual(self.lines(), [])

    def test_an_agent_transition_after_an_older_owner_one_is_not_the_owners(self):
        self.fake.history(self.ISSUE, "h-3", AGENT, RESOLVED, stamp(5))
        result = self.validate(check=True)
        self.assert_validate_block(result, "complete")
        self.assertFalse(result["owner_resolved"])
        self.assertEqual(result["transition"]["account_id"], AGENT)
        self.assertTrue(any("fail path" in n for n in result["notes"]))

    def test_an_empty_or_absent_account_never_matches(self):
        for hid, account in (("h-3", ""), ("h-4", None)):
            with self.subTest(account=account):
                self.fake.history(self.ISSUE, hid, account, RESOLVED,
                                  stamp(4 if account is None else 5))
                result = self.validate(check=True)
                self.assert_validate_block(result, "complete")
                self.assertFalse(result["owner_resolved"])
                self.assertEqual(result["transition"]["id"], hid)

    def test_an_edited_owner_reply_counts_only_when_the_owner_edited_it(self):
        # c3 the owner wrote, the agent edited: not the owner's reply
        self.log(("c3", "owner", "agent", "edited by another", 10, []),
                 ("c4", "owner", "owner", "Done.", 8, []))
        result = self.validate(check=True)
        self.assertEqual([r["id"] for r in result["replies"]], ["c2", "c4"])

    def test_dry_run_marks_nothing(self):
        result = self.validate(check=True, dry_run=True)
        self.assert_validate_block(result, "partial")
        self.assertTrue(result["owner_resolved"])
        self.assertEqual(self.inbox_state(), "resolved")
        self.assertEqual(result["written"], [])

    def test_the_owner_seat_is_never_used(self):
        def boom(*args, **kwargs):
            raise AssertionError("the owner seat was used")
        with unittest.mock.patch.object(jirabackend, "owner_client", boom), \
                unittest.mock.patch.object(jirabackend, "owner_gaps", boom), \
                unittest.mock.patch.object(track, "reply", boom):
            for kwargs in ({"check": True},
                           {"passed": True, "to": "In Progress"}):
                self.assert_validate_block(self.validate(**kwargs),
                                           "complete")
        self.assertTrue(all(u.startswith(
            "https://api.atlassian.com/ex/jira/cloud-test/rest/api/2/")
            for u in self.fake.urls))


class ValidatePassTests(ValidateTestCase):
    def test_a_pass_moves_the_issue_by_name_and_records_the_line(self):
        result = self.validate(passed=True, to="In Progress")
        self.assert_validate_block(result, "complete")
        self.assertEqual(self.fake.status[self.ISSUE], "In Progress")
        posts = [c for c in self.writes() if c[1].endswith("/transitions")]
        self.assertEqual(len(posts), 1)
        self.assertEqual(self.lines(), [{
            "issue": self.ISSUE, "outcome": "pass",
            "at": NOW.isoformat(timespec="seconds"), "transition_id": "h-2",
            "reply_ids": ["c2"], "to": "In Progress"}])
        self.assertEqual(result["written"], [
            f"_bmad-output/tracking/{self.ISSUE}/validation.jsonl"])
        self.assertEqual(result["outcome"]["outcome"], "pass")

    def test_to_do_is_a_target_too_and_lines_append(self):
        self.assert_validate_block(self.validate(passed=True, to="To Do"),
                                   "complete")
        self.assertEqual(self.fake.status[self.ISSUE], "To Do")
        self.fake.status[self.ISSUE] = RESOLVED
        self.assert_validate_block(self.validate(passed=True,
                                                 to="In Progress"),
                                   "complete")
        self.assertEqual([l["to"] for l in self.lines()],
                         ["To Do", "In Progress"])

    def test_no_transition_reaching_the_target_is_refused_by_name(self):
        self.fake.lacking[self.ISSUE] = {"In Progress"}
        result = self.validate(passed=True, to="In Progress")
        self.assert_validate_block(result, "blocked")
        self.assertIn("no transition reaches 'In Progress'", result["reason"])
        self.assertEqual(self.fake.status[self.ISSUE], RESOLVED)
        self.assertEqual(self.lines(), [])

    def test_the_ruling_lands_inside_the_intent_contract(self):
        spec = self.spec()
        result = self.validate(passed=True, to="In Progress",
                               ruling="Use the second option.\n", spec=spec)
        self.assert_validate_block(result, "complete")
        text = spec.read_text(encoding="utf-8")
        line = (f"**Ruling (owner, {self.ISSUE} comment c2, "
                f"{NOW.date().isoformat()}):** Use the second option.")
        self.assertIn(line, text)
        self.assertLess(text.index("Build the beta."), text.index(line))
        self.assertLess(text.index(line), text.index("</intent-contract>"))
        self.assertIn("status: 'in-progress'", text)
        self.assertEqual(text.replace(line + "\n\n", ""), SPEC_TEXT)
        self.assertEqual(self.lines()[0]["ruling"], str(spec))
        self.assertIn(str(spec), result["written"])
        # a retried pass never writes it twice
        self.fake.status[self.ISSUE] = RESOLVED
        self.validate(passed=True, to="In Progress",
                      ruling="Use the second option.", spec=spec)
        self.assertEqual(spec.read_text(encoding="utf-8").count(line), 1)

    def test_else_inside_frozen_after_approval(self):
        spec = self.spec(SPEC_TEXT.replace("intent-contract",
                                           "frozen-after-approval"))
        result = self.validate(passed=True, to="In Progress",
                               ruling="Ship it.", spec=spec)
        self.assert_validate_block(result, "complete")
        text = spec.read_text(encoding="utf-8")
        self.assertLess(text.index("Ship it."),
                        text.index("</frozen-after-approval>"))

    def test_a_tag_named_in_prose_is_never_the_insertion_point(self):
        prose = ("\nThe ruling goes before `</intent-contract>` in a "
                 "spec.\n")
        spec = self.spec(SPEC_TEXT + prose)
        result = self.validate(passed=True, to="In Progress",
                               ruling="Ship it.", spec=spec)
        self.assert_validate_block(result, "complete")
        text = spec.read_text(encoding="utf-8")
        self.assertLess(text.index("Ship it."),
                        text.index("\n</intent-contract>\n"))
        self.assertTrue(text.endswith(prose))
        # a spec whose only closing tag sits in prose has no block
        spec = self.spec("---\nstatus: 'x'\n---\n\nsee </intent-contract>\n")
        self.assert_validate_block(
            self.validate(passed=True, to="In Progress", ruling="x",
                          spec=spec), "blocked")

    def test_no_reachable_target_leaves_the_spec_unchanged(self):
        spec = self.spec()
        self.fake.lacking[self.ISSUE] = {"In Progress"}
        result = self.validate(passed=True, to="In Progress",
                               ruling="Use the second option.", spec=spec)
        self.assert_validate_block(result, "blocked")
        self.assertIn("no transition reaches 'In Progress'", result["reason"])
        self.assertEqual(spec.read_text(encoding="utf-8"), SPEC_TEXT)
        self.assertEqual(self.fake.status[self.ISSUE], RESOLVED)
        self.assertEqual(self.writes(), [])
        self.assertEqual(self.lines(), [])

    def test_a_failed_transition_after_the_ruling_restores_the_spec(self):
        # the pre-check sees the transition; the move then finds none
        spec = self.spec()
        real = track._reaches

        def reaches_then_lost(client, key, name):
            answer = real(client, key, name)
            self.fake.lacking[self.ISSUE] = {name}
            return answer
        with unittest.mock.patch.object(track, "_reaches", reaches_then_lost):
            result = self.validate(passed=True, to="In Progress",
                                   ruling="Use the second option.", spec=spec)
        self.assert_validate_block(result, "blocked")
        self.assertIn("no transition reaches 'In Progress'", result["reason"])
        self.assertEqual(spec.read_bytes(), SPEC_TEXT.encode("utf-8"))
        self.assertNotIn(str(spec), result["written"])
        self.assertEqual(self.fake.status[self.ISSUE], RESOLVED)
        self.assertEqual(self.lines(), [])

    def test_a_refused_move_after_the_ruling_restores_the_spec(self):
        spec = self.spec()
        self.fake.force[("POST", f"/issue/{self.ISSUE}/transitions")] = (
            400, {"errorMessages": ["no"]})
        result = self.validate(passed=True, to="In Progress",
                               ruling="Use the second option.", spec=spec)
        self.assert_validate_block(result, "blocked")
        self.assertEqual(spec.read_bytes(), SPEC_TEXT.encode("utf-8"))
        self.assertEqual(result["written"], [])
        self.assertEqual(self.lines(), [])

    def test_a_pass_refuses_when_the_owner_did_not_resolve(self):
        # the owner's h-2 (20 min ago) stays older under each newer one
        spec = self.spec()
        cases = (("agent", "h-3", AGENT, 5), ("empty account", "h-4", "", 4),
                 ("absent account", "h-5", None, 3),
                 ("another account", "h-6", "someone-else", 2))
        for label, hid, account, ago in cases:
            with self.subTest(label):
                self.fake.history(self.ISSUE, hid, account, RESOLVED,
                                  stamp(ago))
                result = self.validate(passed=True, to="In Progress",
                                       ruling="Ship it.", spec=spec)
                self.assert_validate_block(result, "blocked")
                self.assertIn("owner_resolved", result["reason"])
                self.assertFalse(result["owner_resolved"])
                self.assertEqual(spec.read_text(encoding="utf-8"), SPEC_TEXT)
                self.assertEqual(self.fake.status[self.ISSUE], RESOLVED)
                self.assertEqual(self.writes(), [])
                self.assertEqual(self.lines(), [])
                self.assertEqual(self.inbox_state(), "resolved")

    def test_an_absent_spec_or_block_is_refused_with_no_call(self):
        missing = self.root / "nope.md"
        result = self.validate(passed=True, to="In Progress", ruling="x",
                               spec=missing)
        self.assert_validate_block(result, "blocked")
        self.assertIn("does not exist", result["reason"])
        spec = self.spec("---\nstatus: 'x'\n---\n\nno block\n")
        result = self.validate(passed=True, to="In Progress", ruling="x",
                               spec=spec)
        self.assert_validate_block(result, "blocked")
        self.assertIn("no <intent-contract>", result["reason"])
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.fake.status[self.ISSUE], RESOLVED)


class ValidateFailTests(ValidateTestCase):
    def test_a_fail_re_blocks_with_the_follow_up(self):
        result = self.validate(failed=True,
                               follow_up="The token is still missing.")
        self.assert_validate_block(result, "complete")
        self.assertEqual(self.fake.status[self.ISSUE], BLOCKED)
        (posted,) = self.fake.posted[self.ISSUE]
        self.assertEqual(posted, body(
            reason="The token is still missing.",
            resolves="a reply in the Inbox that answers the follow-up"))
        self.assertTrue(inbox.BLOCK_COMMENT_RE.match(posted))
        (line,) = self.lines()
        self.assertEqual(line["outcome"], "fail")
        self.assertEqual(line["follow_up_comment_id"], "10001")
        self.assertNotIn("to", line)
        self.assertEqual(result["issues"][0]["transitioned"], True)
        self.assertEqual(result["issues"][0]["commented"], True)

    # the same non-owner cases as the pass refusal; a fail moves the issue
    # and writes a line, so each case gets its own fresh fixture (setUp)
    def assert_fail_runs_after_a_non_owner(self, hid, account, ago):
        # the owner's h-2 (20 min ago) stays older under the newer one
        self.assertEqual(self.fake.status[self.ISSUE], RESOLVED)
        self.assertEqual(self.lines(), [])
        self.fake.history(self.ISSUE, hid, account, RESOLVED, stamp(ago))
        result = self.validate(failed=True, follow_up="Still missing.")
        self.assert_validate_block(result, "complete")
        self.assertFalse(result["owner_resolved"])
        self.assertEqual(self.fake.status[self.ISSUE], BLOCKED)
        self.assertEqual([l["outcome"] for l in self.lines()], ["fail"])

    def test_a_fail_still_runs_when_an_agent_resolved(self):
        self.assert_fail_runs_after_a_non_owner("h-3", AGENT, 5)

    def test_a_fail_still_runs_when_the_account_is_empty(self):
        self.assert_fail_runs_after_a_non_owner("h-4", "", 4)

    def test_a_fail_still_runs_when_the_account_is_absent(self):
        self.assert_fail_runs_after_a_non_owner("h-5", None, 3)

    def test_a_fail_still_runs_when_another_account_resolved(self):
        self.assert_fail_runs_after_a_non_owner("h-6", "someone-else", 2)

    def test_dry_run_moves_and_writes_nothing(self):
        result = self.validate(failed=True, follow_up="x", dry_run=True)
        self.assert_validate_block(result, "partial")
        self.assertEqual(self.writes(), [])
        self.assertEqual(self.lines(), [])
        self.assertEqual(self.fake.status[self.ISSUE], RESOLVED)


class ValidateRefusalTests(ValidateTestCase):
    def assert_refused(self, result, *names, calls=False):
        self.assert_validate_block(result, "blocked")
        for name in names:
            self.assertIn(name, result["reason"])
        if not calls:
            self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.lines(), [])

    def test_a_bad_key_or_mode_is_refused_with_no_call(self):
        self.assert_refused(self.validate("st-1", check=True),
                            "not a Jira issue key", "no Atlassian call made")
        self.assert_refused(self.validate(), "exactly one")
        self.assert_refused(self.validate(check=True, failed=True),
                            "exactly one")
        self.assert_refused(self.validate(passed=True, to="Done"), "--to")
        self.assert_refused(self.validate(passed=True, to="To Do",
                                          ruling="x"), "go together")
        self.assert_refused(self.validate(failed=True, follow_up="  "),
                            "--follow-up-file")

    def test_no_binding_makes_no_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = track.validate(Path(tmp), self.ISSUE, check=True,
                                    transport=self.fake)
        self.assert_refused(result, "planning.jira.project_key",
                            "no Atlassian call made")

    def test_an_absent_agent_variable_is_named_before_any_call(self):
        for name in (jirabackend.AGENT_TOKEN_ENV,
                     jirabackend.AGENT_EMAIL_ENV, jirabackend.CLOUD_ID_ENV):
            with self.subTest(name=name):
                saved = os.environ.pop(name)
                try:
                    result = self.validate(check=True)
                finally:
                    os.environ[name] = saved
                self.assert_refused(result, "no Atlassian call made")
        os.environ.pop(jirabackend.AGENT_TOKEN_ENV)
        self.assert_refused(self.validate(check=True),
                            jirabackend.AGENT_TOKEN_ENV)

    def test_no_owner_account_id_is_refused(self):
        text = self.config.read_text(encoding="utf-8")
        self.config.write_text(re.sub(r"\n\s*owner_account_id:[^\n]*", "",
                                      text), encoding="utf-8")
        self.assert_refused(self.validate(check=True),
                            "planning.jira.owner_account_id")

    def test_a_live_status_other_than_block_resolved_is_refused(self):
        self.fake.status[self.ISSUE] = BLOCKED
        for kwargs in ({"check": True}, {"passed": True, "to": "To Do"},
                       {"failed": True, "follow_up": "x"}):
            with self.subTest(**{k: v for k, v in kwargs.items()
                                 if k != "follow_up"}):
                result = self.validate(**kwargs)
                self.assert_refused(result, f"'{BLOCKED}'",
                                    "'Block Resolved'", calls=True)
        self.assertEqual(self.writes(), [])
        self.assertEqual(self.inbox_state(), "resolved")

    def test_cli_no_env_exits_2_with_the_block_last(self):
        for name in jirabackend.AGENT_ENV_NAMES:
            os.environ.pop(name, None)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = track.main(["validate", "--directory", str(self.root),
                               "--issue", self.ISSUE, "--check"])
        self.assertEqual(code, 2)
        result = json.loads(out.getvalue())
        self.assert_validate_block(result, "blocked")
        self.assertIn("no Atlassian call made", result["reason"])


class ValidateTransientTests(ValidateTestCase):
    def assert_retry(self, result):
        self.assert_validate_block(result, "partial", ok=False)
        self.assertTrue(result["retry"])
        self.assertTrue(result["reason"].startswith("track retry: "))
        self.assertEqual(self.lines(), [])

    def test_a_5xx_on_the_changelog_is_retried_and_records_nothing(self):
        self.fake.force[("GET", f"/issue/{self.ISSUE}/changelog")] = (
            503, "unavailable")
        for kwargs in ({"check": True}, {"passed": True, "to": "To Do"},
                       {"failed": True, "follow_up": "x"}):
            self.assert_retry(self.validate(**kwargs))
        self.assertEqual(self.inbox_state(), "resolved")
        self.assertEqual(self.writes(), [])

    def test_an_exhausted_429_on_the_transition_is_retried(self):
        self.fake.force[("POST", f"/issue/{self.ISSUE}/transitions")] = (
            429, {}, {"Retry-After": "600"})
        result = self.validate(passed=True, to="In Progress")
        self.assert_retry(result)
        self.assertIn("429", result["reason"])

    def test_a_5xx_on_the_follow_up_comment_is_retried(self):
        self.fake.force[("POST", f"/issue/{self.ISSUE}/comment")] = (
            502, "bad gateway")
        self.assert_retry(self.validate(failed=True, follow_up="x"))
        # the transition landed; the retry resumes the block, not refuses
        self.assertEqual(self.fake.status[self.ISSUE], BLOCKED)
        del self.fake.force[("POST", f"/issue/{self.ISSUE}/comment")]
        transitions = len([c for c in self.writes()
                           if c[1].endswith("/transitions")])
        result = self.validate(failed=True, follow_up="x")
        self.assert_validate_block(result, "complete")
        self.assertEqual(len([c for c in self.writes()
                              if c[1].endswith("/transitions")]),
                         transitions)
        self.assertEqual(len(self.fake.posted[self.ISSUE]), 1)
        self.assertEqual([l["outcome"] for l in self.lines()], ["fail"])
        self.assertEqual(result["issues"][0]["transitioned"], False)
        self.assertEqual(result["issues"][0]["commented"], True)
        # once posted, a further --fail is refused (no second comment/line)
        again = self.validate(failed=True, follow_up="x")
        self.assert_validate_block(again, "blocked")
        self.assertEqual(len(self.fake.posted[self.ISSUE]), 1)
        self.assertEqual(len(self.lines()), 1)


    def test_a_landed_move_answering_a_5xx_resumes_the_pass(self):
        # the move into --to lands, then answers 502: retry, then the line
        spec = self.spec()
        real = self.fake._jira
        landed = []

        def lands_then_502(method, path, query, body):
            if method == "POST" and path.endswith("/transitions"):
                if not landed:
                    landed.append(real(method, path, query, body))
                return 502, "bad gateway"
            return real(method, path, query, body)
        self.fake._jira = lands_then_502
        self.assert_retry(self.validate(passed=True, to="In Progress",
                                        ruling="Use the second option.",
                                        spec=spec))
        self.assertEqual(self.fake.status[self.ISSUE], "In Progress")
        ruled = spec.read_text(encoding="utf-8")
        self.assertIn("Use the second option.", ruled)  # kept for the retry
        self.fake._jira = real
        transitions = len([c for c in self.writes()
                           if c[1].endswith("/transitions")])
        result = self.validate(passed=True, to="In Progress",
                               ruling="Use the second option.", spec=spec)
        self.assert_validate_block(result, "complete")
        self.assertEqual(len([c for c in self.writes()
                              if c[1].endswith("/transitions")]),
                         transitions)
        self.assertEqual(spec.read_text(encoding="utf-8"), ruled)
        (line,) = self.lines()
        self.assertEqual((line["outcome"], line["to"], line["transition_id"],
                          line["ruling"]),
                         ("pass", "In Progress", "h-2", str(spec)))
        self.assertTrue(any("resuming the pass" in n
                            for n in result["notes"]))

    # a pass retry is refused unless its move into --to is newer than the
    # newest Block Resolved move and that one is the owner's
    def assert_pass_retry_refused(self, *histories):
        for hid, account, status, ago in histories:
            self.fake.history(self.ISSUE, hid, account, status, stamp(ago))
        self.fake.status[self.ISSUE] = "In Progress"
        result = self.validate(passed=True, to="In Progress")
        self.assert_validate_block(result, "blocked")
        self.assertIn("'In Progress', not 'Block Resolved'", result["reason"])
        self.assertEqual(self.writes(), [])
        self.assertEqual(self.lines(), [])

    def test_a_pass_retry_whose_move_predates_the_resolve_is_refused(self):
        self.assert_pass_retry_refused(("h-3", AGENT, "In Progress", 30))

    def test_a_pass_retry_after_a_non_owner_resolve_is_refused(self):
        self.assert_pass_retry_refused(("h-3", AGENT, RESOLVED, 10),
                                       ("h-4", AGENT, "In Progress", 5))


class ValidateCliTests(ValidateTestCase):
    def test_cli_pass_with_a_ruling_file(self):
        spec = self.spec()
        with tempfile.TemporaryDirectory() as tmp:
            ruling = Path(tmp) / "ruling.txt"
            ruling.write_text("Use the second option.", encoding="utf-8")
            out = io.StringIO()
            real = jirabackend.client_for
            with unittest.mock.patch.object(
                    jirabackend, "client_for",
                    lambda settings, transport=None: real(settings,
                                                          self.fake)), \
                    contextlib.redirect_stdout(out):
                code = track.main(["validate", "--directory", str(self.root),
                                   "--issue", self.ISSUE, "--pass", "--to",
                                   "In Progress", "--ruling-file",
                                   str(ruling), "--spec", str(spec)])
        self.assertEqual(code, 0, out.getvalue())
        result = json.loads(out.getvalue())
        self.assert_validate_block(result, "complete")
        self.assertIn("Use the second option.", spec.read_text(encoding="utf-8"))
        self.assertEqual(self.fake.status[self.ISSUE], "In Progress")

    def test_cli_unreadable_follow_up_file_is_refused(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = track.main(["validate", "--directory", str(self.root),
                               "--issue", self.ISSUE, "--fail",
                               "--follow-up-file",
                               str(self.root / "absent.txt")])
        self.assertEqual(code, 2)
        result = json.loads(out.getvalue())
        self.assert_validate_block(result, "blocked")
        self.assertIn("--follow-up-file", result["reason"])


# -------------------------------------------------------------- engagement
# Story 32.3: `block --engagement` and `close --engagement` against the fake
# Atlassian REST (the create, the exact-summary search, the moves by name).

ENG = "ENG-001"
QUESTIONS = [
    {"id": "scope", "text": "How big is the first cut?",
     "options": [{"label": "Small", "default": True}, {"label": "Large"}],
     "impact": "sets the quote"},
    {"id": "db", "text": "Which database?",
     "options": [{"label": "sqlite"}, {"label": "postgres", "default": True}],
     "impact": "the hosting cost"},
]


def engagement_body(questions):
    lines = [f"[~accountid:{OWNER}] Blocked: {ENG} needs {len(questions)} "
             f"answer(s)",
             'Resolves when: reply with one "<id>: <option>" line per '
             'question']
    for q in questions:
        lines += ["", f"{q['id']}: {q['text']}", f"Impact: {q['impact']}"]
        lines += [f"- {o['label']}" + (" (default)" if o.get("default")
                                       else "") for o in q["options"]]
    return "\n".join(lines)


class EngagementTestCase(TrackTestCase):
    def setUp(self):
        super().setUp()
        self.record(QUESTIONS)

    def record(self, questions, **fields):
        path = self.root / "_bmad-output" / "engagements" / ENG \
            / "engagement.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {"shape_version": 1, "id": ENG, "project": "p",
                  "state": "awaiting-answers",
                  "request": "Build the export\nwith CSV",
                  "questions": questions, "assumptions": [], "inputs": []}
        record.update(fields)
        path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    def block_eng(self, **kwargs):
        return track.block_engagement(self.root, ENG, transport=self.fake,
                                      sleep=self.sleeps.append, **kwargs)

    def close_eng(self, **kwargs):
        return track.close_engagement(self.root, ENG, transport=self.fake,
                                      sleep=self.sleeps.append, **kwargs)


class EngagementBlockTests(EngagementTestCase):
    def test_creates_the_task_moves_it_blocked_and_comments_the_questions(self):
        result = self.block_eng()
        self.assert_track_block(result, "complete")
        self.assertEqual((result["story"], result["engagement"],
                          result["source"]), (None, ENG, "engagement"))
        (entry,) = result["issues"]
        key = f"{KEY}-100"
        self.assertEqual(entry, {"issue": key, "created": True,
                                 "transitioned": True, "commented": True})
        self.assertEqual(self.fake.created, [{
            "project": {"key": KEY}, "summary": f"{ENG}: questions",
            "issuetype": {"name": "Task"}, "description": "Build the export",
            "labels": ["tk-studio-engagement"]}])
        self.assertEqual(self.fake.status[key], BLOCKED)
        self.assertEqual(self.fake.posted[key], [engagement_body(QUESTIONS)])
        # the comment is a block comment the inbox reads as the reason
        self.assertTrue(inbox.BLOCK_COMMENT_RE.match(
            self.fake.posted[key][0]))
        self.assertEqual(self.fake.jql, [
            f'project = "{KEY}" AND summary ~ "\\"{ENG}: questions\\""'])
        self.assertEqual(result["written"], [])

    def test_finds_the_existing_issue_by_its_exact_summary(self):
        # a contains-match that is not exact never counts
        self.fake.summaries[f"{KEY}-7"] = f"re: {ENG}: questions (old)"
        self.fake.status[f"{KEY}-7"] = "To Do"
        self.fake.summaries[f"{KEY}-8"] = f"{ENG}: questions"
        self.fake.status[f"{KEY}-8"] = "In Progress"
        result = self.block_eng()
        self.assert_track_block(result, "complete")
        (entry,) = result["issues"]
        self.assertEqual((entry["issue"], entry["created"]),
                         (f"{KEY}-8", False))
        self.assertEqual(self.fake.created, [])
        self.assertEqual(self.fake.status[f"{KEY}-7"], "To Do")

    def test_a_re_block_skips_then_names_only_the_open_questions(self):
        self.block_eng()
        writes = len(self.writes())
        again = self.block_eng()
        self.assert_track_block(again, "complete")
        (entry,) = again["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (False, False))
        self.assertEqual(len(entry["skipped"]), 2)
        self.assertEqual(len(self.writes()), writes)
        # one answer landed: the re-block comments the remaining question
        answered = [dict(QUESTIONS[0], answer="Small"), QUESTIONS[1]]
        self.record(answered)
        third = self.block_eng()
        self.assert_track_block(third, "complete")
        self.assertTrue(third["issues"][0]["commented"])
        self.assertEqual(self.fake.posted[f"{KEY}-100"][-1],
                         engagement_body([QUESTIONS[1]]))

    def test_a_re_block_after_an_owner_reply_that_answered_nothing_comments_again(self):
        self.block_eng()
        key = f"{KEY}-100"
        # the owner replied after the agent's comment; nothing parsed, so the
        # same questions are still open: the comment names them again
        self.fake.comment_store[key].append(
            comment("20001", OWNER, "what do you mean?", 0))
        again = self.block_eng()
        self.assert_track_block(again, "complete")
        (entry,) = again["issues"]
        self.assertEqual((entry["transitioned"], entry["commented"]),
                         (False, True))
        self.assertEqual(self.fake.posted[key],
                         [engagement_body(QUESTIONS)] * 2)
        # with no owner reply since, the skip rule holds again
        third = self.block_eng()
        self.assertFalse(third["issues"][0]["commented"])
        self.assertEqual(len(self.fake.posted[key]), 2)

    def test_a_held_lock_is_a_retry_and_a_stale_one_is_retaken(self):
        lock = (self.root / "_bmad-output" / "engagements" / ENG
                / track.ENGAGEMENT_LOCK)
        lock.write_text("", encoding="utf-8")
        held = self.block_eng()
        self.assertEqual((held["status"], held["ok"], held["retry"]),
                         ("partial", False, True))
        self.assertIn("track.lock is held", held["reason"])
        self.assertEqual(list(held)[-4:], ["status", "intent", "artifacts",
                                           "reason"])
        self.assertEqual(self.fake.created, [])
        self.assertEqual(self.fake.calls, [])
        closed = self.close_eng()
        self.assertEqual((closed["status"], closed["retry"]),
                         ("partial", True))
        self.assertTrue(lock.exists())  # another holder's lock is kept
        # stale (older than the bound): retaken, and released after
        old = lock.stat().st_mtime - track.ENGAGEMENT_LOCK_STALE_S - 5
        os.utime(lock, (old, old))
        result = self.block_eng()
        self.assert_track_block(result, "complete")
        self.assertEqual(len(self.fake.created), 1)
        self.assertFalse(lock.exists())
        self.assertEqual([p.name for p in lock.parent.iterdir()
                          if p.name.startswith(track.ENGAGEMENT_LOCK)], [])

    def test_the_lock_serialises_the_find_or_create(self):
        # a second caller arriving while the first holds the lock (inside its
        # create) gets a retry, never a second issue
        seen = []
        real = track.create_engagement_issue

        def racing(*args, **kwargs):
            seen.append(self.block_eng())
            return real(*args, **kwargs)
        with unittest.mock.patch.object(track, "create_engagement_issue",
                                        racing):
            first = self.block_eng()
        self.assert_track_block(first, "complete")
        self.assertEqual(seen[0]["retry"], True)
        self.assertEqual(len(self.fake.created), 1)
        self.assertEqual(len(self.fake.posted[f"{KEY}-100"]), 1)

    def test_the_refusals_by_name(self):
        self.record([dict(q, answer="x") for q in QUESTIONS])
        result = self.block_eng()
        self.assert_track_block(result, "blocked")
        self.assertIn("NoOpenQuestions", result["reason"])
        self.assertEqual(self.fake.calls, [])
        missing = track.block_engagement(self.root, "ENG-404",
                                         transport=self.fake)
        self.assert_track_block(missing, "blocked")
        self.assertIn("EngagementNotFound", missing["reason"])
        bad = track.block_engagement(self.root, "nope", transport=self.fake)
        self.assertIn("EngagementNotFound", bad["reason"])
        self.assertEqual(self.fake.calls, [])
        self.record(QUESTIONS)
        self.fake.refuse_create = True
        refused = self.block_eng()
        self.assert_track_block(refused, "blocked")
        self.assertIn("IssueCreateRefused", refused["reason"])
        self.assertIn("'Task'", refused["reason"])
        with tempfile.TemporaryDirectory() as tmp:
            unbound = track.block_engagement(Path(tmp), ENG,
                                             transport=self.fake)
        self.assertIn("no Atlassian call made", unbound["reason"])

    def test_a_temporary_failure_is_retried(self):
        self.fake.force[("POST", "/issue")] = (503, "unavailable")
        result = self.block_eng()
        self.assertEqual((result["status"], result["ok"], result["retry"]),
                         ("partial", False, True))

    def test_a_dry_run_creates_nothing(self):
        result = self.block_eng(dry_run=True)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(self.fake.created, [])
        self.assertEqual(self.writes(), [])

    def test_the_cli_takes_engagement_exclusive_with_story(self):
        def run(*argv):
            out = io.StringIO()
            with unittest.mock.patch.object(jirabackend, "client_for",
                                            _client_with(self.fake)), \
                    contextlib.redirect_stdout(out):
                code = track.main(["block", "--directory", str(self.root),
                                   *argv])
            return code, json.loads(out.getvalue())
        code, result = run("--engagement", ENG, "--story", "ST-001")
        self.assertEqual(code, 2)
        self.assertIn("exclusive", result["reason"])
        code, result = run("--engagement", ENG, "--reason", "x")
        self.assertEqual(code, 2)
        code, result = run("--engagement", ENG, "--source", "run")
        self.assertEqual(code, 2)
        self.assertEqual(self.fake.calls, [])
        code, result = run("--engagement", ENG)
        self.assertEqual(code, 0)
        self.assert_track_block(result, "complete")
        self.assertEqual(result["source"], "engagement")


CAP_REASON = ("reached its cap: runs_usd $41.5 of cap $40\nruns_usd: 41.5\n"
              "cap: 40\nband85.usd: 30\nband95.usd: 38")


class EngagementBlockKindTests(EngagementTestCase):
    """Story 32.6: `block --engagement --kind cap|ask --reason`."""

    def test_cap_needs_no_open_question_and_keeps_the_prefix(self):
        self.record([dict(q, answer="x") for q in QUESTIONS],
                    state="partial")
        result = self.block_eng(kind="cap", reason=CAP_REASON)
        self.assert_track_block(result, "complete")
        self.assertEqual(result["kind"], "cap")
        key = f"{KEY}-100"
        self.assertEqual(self.fake.status[key], BLOCKED)
        self.assertEqual(self.fake.created[0]["summary"], f"{ENG}: questions")
        self.assertEqual(self.fake.posted[key], ["\n".join([
            f"[~accountid:{OWNER}] Blocked: {ENG} reached its cap: runs_usd "
            f"$41.5 of cap $40",
            "Resolves when: reply with `go {cap}` from the web or the API, "
            "or `cancel`",
            "", "runs_usd: 41.5", "cap: 40", "band85.usd: 30",
            "band95.usd: 38"])])
        self.assertTrue(inbox.BLOCK_COMMENT_RE.match(self.fake.posted[key][0]))

    def test_ask_blocks_the_same_issue_with_the_landed_story(self):
        self.block_eng()
        result = self.block_eng(kind="ask", reason="landed story 41-1-csv "
                                                   "(spend so far: $3)")
        self.assert_track_block(result, "complete")
        self.assertEqual(result["kind"], "ask")
        key = f"{KEY}-100"
        self.assertEqual(len(self.fake.created), 1)
        self.assertEqual(self.fake.posted[key][-1], "\n".join([
            f"[~accountid:{OWNER}] Blocked: {ENG} landed story 41-1-csv "
            f"(spend so far: $3)",
            "Resolves when: reply `continue` to run the next story"]))
        self.assertEqual(self.block_eng()["kind"], "questions")

    def test_the_kind_refusals_by_name(self):
        unknown = self.block_eng(kind="later", reason="x")
        self.assert_track_block(unknown, "blocked")
        self.assertIn("UnknownKind", unknown["reason"])
        for kind in ("cap", "ask"):
            missing = self.block_eng(kind=kind)
            self.assert_track_block(missing, "blocked")
            self.assertIn("ReasonMissing", missing["reason"])
            self.assertIn("ReasonMissing", self.block_eng(
                kind=kind, reason="  ")["reason"])
        mixed = self.block_eng(kind="questions", reason="x")
        self.assert_track_block(mixed, "blocked")
        self.assertIn("takes no --reason", mixed["reason"])
        self.assertEqual(self.fake.calls, [])

    def test_the_cli_takes_kind_and_reason(self):
        def run(*argv):
            out = io.StringIO()
            with unittest.mock.patch.object(jirabackend, "client_for",
                                            _client_with(self.fake)), \
                    contextlib.redirect_stdout(out):
                code = track.main(["block", "--directory", str(self.root),
                                   *argv])
            return code, json.loads(out.getvalue())
        code, result = run("--engagement", ENG, "--kind", "cap")
        self.assertEqual(code, 2)
        self.assertIn("ReasonMissing", result["reason"])
        code, result = run("--story", "ST-001", "--reason", "r",
                           "--resolves", "s", "--kind", "cap")
        self.assertEqual(code, 2)
        self.assertIn("--kind is --engagement's", result["reason"])
        self.assertEqual(self.fake.calls, [])
        code, result = run("--engagement", ENG, "--kind", "cap",
                           "--reason", CAP_REASON)
        self.assertEqual(code, 0)
        self.assert_track_block(result, "complete")
        self.assertEqual((result["kind"], result["source"]),
                         ("cap", "engagement"))


class EngagementCloseTests(EngagementTestCase):
    def test_close_moves_block_resolved_then_done(self):
        self.block_eng()
        result = self.close_eng()
        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["ok"])
        self.assertEqual((result["issue"], result["moved"], result["skipped"]),
                         (f"{KEY}-100", [jirabackend.RESOLVED_STATUS, "Done"],
                          []))
        self.assertEqual(self.fake.status[f"{KEY}-100"], "Done")
        self.assertEqual(list(result)[-4:], ["status", "intent", "artifacts",
                                             "reason"])

    def test_a_move_already_in_place_is_skipped(self):
        self.block_eng()
        self.fake.status[f"{KEY}-100"] = jirabackend.RESOLVED_STATUS
        result = self.close_eng()
        self.assertEqual(result["moved"], ["Done"])
        self.assertEqual(len(result["skipped"]), 1)
        again = self.close_eng()
        self.assertEqual(again["status"], "complete")
        self.assertEqual(again["moved"], [])
        self.assertEqual(len(again["skipped"]), 2)

    def test_no_issue_is_refused_by_name(self):
        result = self.close_eng()
        self.assertEqual(result["status"], "blocked")
        self.assertIn("NoIssue", result["reason"])

    def test_an_issue_never_blocked_skips_block_resolved_and_closes(self):
        # setup adds only Blocked -> Block Resolved: a To-Do issue (created,
        # never moved to Blocked) whose only transition goes to Done
        key = f"{KEY}-100"
        self.fake.summaries[key] = f"{ENG}: questions"
        self.fake.status[key] = "To Do"
        self.fake.lacking[key] = {"In Progress", BLOCKED,
                                  jirabackend.RESOLVED_STATUS}
        result = self.close_eng()
        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["ok"])
        self.assertEqual((result["issue"], result["moved"]), (key, ["Done"]))
        self.assertEqual(result["skipped"], [
            f"transition: {key} is not blocked (To Do); "
            f"{jirabackend.RESOLVED_STATUS!r} skipped"])
        self.assertEqual(self.fake.status[key], "Done")

    def test_a_blocked_issue_still_needs_block_resolved(self):
        self.block_eng()
        self.fake.no_resolved.add(f"{KEY}-100")
        result = self.close_eng()
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(self.fake.status[f"{KEY}-100"], BLOCKED)
        self.assertEqual(
            result["reason"],
            f"track refused: NoTransition: {KEY}-100: no transition reaches "
            f"{jirabackend.RESOLVED_STATUS!r} from {BLOCKED!r}")

    def test_no_transition_to_done_is_refused_by_name(self):
        self.block_eng()
        self.fake.lacking[f"{KEY}-100"] = {"Done"}
        result = self.close_eng()
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(result["reason"].startswith(
            "track refused: NoTransition: "), result["reason"])
        self.assertIn("'Done'", result["reason"])

    def test_the_cli_close(self):
        self.block_eng()
        out = io.StringIO()
        with unittest.mock.patch.object(jirabackend, "client_for",
                                        _client_with(self.fake)), \
                contextlib.redirect_stdout(out):
            code = track.main(["close", "--directory", str(self.root),
                               "--engagement", ENG])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["moved"],
                         [jirabackend.RESOLVED_STATUS, "Done"])


class UnblockTests(TrackTestCase):
    """Story 36.3 (DW-130, hole 101)."""

    def unblock(self, story="ST-001", **kwargs):
        kwargs.setdefault("reason", "the supervisor resumed the run")
        return track.unblock(self.root, story, transport=self.fake,
                             sleep=self.sleeps.append, **kwargs)

    RESOLVED = "Resolved: the supervisor resumed the run"

    def test_blocked_moves_to_block_resolved_with_the_comment_and_no_mention(self):
        self.block("ST-001")
        result = self.unblock()
        self.assert_track_block(result, "complete")
        self.assertEqual(self.fake.status[f"{KEY}-1"], jirabackend.RESOLVED_STATUS)
        self.assertEqual(self.fake.posted[f"{KEY}-1"][-1], self.RESOLVED)
        self.assertNotIn("accountid", self.fake.posted[f"{KEY}-1"][-1])
        (entry,) = result["issues"]
        self.assertEqual(entry, {"issue": f"{KEY}-1", "entity": "ST-001", "role": "story",
                                 "from": BLOCKED, "to": jirabackend.RESOLVED_STATUS,
                                 "transitioned": True, "commented": True})
        self.assertEqual(result["skipped"], [])

    def test_an_issue_not_blocked_is_skipped_nothing_written(self):
        result = self.unblock()
        self.assert_track_block(result, "complete")
        self.assertEqual(self.writes(), [])
        self.assertEqual(result["skipped"], [f"transition: {KEY}-1 is not blocked (In Progress)"])
        self.assertEqual(result["issues"][0]["to"], None)

    def test_idempotent_a_second_unblock_writes_nothing(self):
        self.block("ST-001")
        self.unblock()
        before = len(self.writes())
        result = self.unblock()
        self.assertEqual(len(self.writes()), before)
        self.assertEqual(len(result["skipped"]), 1)

    def test_dependents_block_moved_move_too(self):
        self.depends("ST-002", "ST-001")
        self.block("ST-001")
        self.assertEqual(self.fake.status[f"{KEY}-2"], BLOCKED)
        result = self.unblock()
        self.assertEqual(self.fake.status[f"{KEY}-2"], jirabackend.RESOLVED_STATUS)
        self.assertEqual([i["role"] for i in result["issues"]], ["story", "dependent"])

    def test_a_dependent_blocked_by_something_else_stays(self):
        self.depends("ST-002", "ST-001")
        self.block("ST-001")
        self.fake.status[f"{KEY}-2"] = BLOCKED
        self.fake.posted[f"{KEY}-2"] = []
        self.seed_comment(f"{KEY}-2", AGENT, "[~accountid:o] Blocked: its own reason", 0)
        result = self.unblock()
        self.assertEqual(self.fake.status[f"{KEY}-2"], BLOCKED)
        self.assertIn("something other", result["skipped"][0])

    def seed_dependent(self, *blockers):
        """ST-002 reads Blocked, its agent comments naming each of `blockers`."""
        self.depends("ST-002", "ST-001")
        self.fake.status[f"{KEY}-2"] = BLOCKED
        for i, blocker in enumerate(blockers):
            self.seed_comment(f"{KEY}-2", AGENT,
                              f"[~accountid:o] Blocked: x\nResolves when: y\nBlocked by: {blocker}",
                              60 - i)

    def test_story_36_3_a_key_that_only_contains_the_story_key_is_no_match(self):
        self.seed_dependent(f"{KEY}-12")
        self.fake.status[f"{KEY}-1"] = BLOCKED
        result = self.unblock()
        self.assertEqual(self.fake.status[f"{KEY}-2"], BLOCKED)
        self.assertIn("something other", result["skipped"][0])

    def test_story_36_3_a_dependent_blocked_by_a_then_b_stays_while_the_other_is_open(self):
        for blockers in ((f"{KEY}-1", f"{KEY}-7"), (f"{KEY}-7", f"{KEY}-1")):
            with self.subTest(blockers=blockers):
                self.fake.comment_store.pop(f"{KEY}-2", None)
                self.seed_dependent(*blockers)
                self.fake.status[f"{KEY}-1"] = BLOCKED
                self.fake.status[f"{KEY}-7"] = BLOCKED
                result = self.unblock()
                self.assertEqual(self.fake.status[f"{KEY}-1"], jirabackend.RESOLVED_STATUS)
                self.assertEqual(self.fake.status[f"{KEY}-2"], BLOCKED)
                self.assertIn(f"still blocked by {KEY}-7", " ".join(result["skipped"]))
                self.assertEqual(result["status"], "complete")

    def test_story_36_3_the_dependent_moves_on_the_last_of_its_blocks(self):
        self.seed_dependent(f"{KEY}-7", f"{KEY}-1")
        self.fake.status[f"{KEY}-1"] = BLOCKED
        self.fake.status[f"{KEY}-7"] = jirabackend.RESOLVED_STATUS
        self.unblock()
        self.assertEqual(self.fake.status[f"{KEY}-2"], jirabackend.RESOLVED_STATUS)

    def test_story_36_3_a_block_before_the_last_resolved_comment_no_longer_holds(self):
        self.seed_dependent(f"{KEY}-7")
        self.seed_comment(f"{KEY}-2", AGENT, "Resolved: an earlier unblock", 30)
        self.seed_comment(f"{KEY}-2", AGENT, f"[~accountid:o] Blocked: x\nBlocked by: {KEY}-1", 20)
        self.fake.status[f"{KEY}-1"] = BLOCKED
        self.fake.status[f"{KEY}-7"] = BLOCKED
        self.unblock()
        self.assertEqual(self.fake.status[f"{KEY}-2"], jirabackend.RESOLVED_STATUS)

    def test_a_temporary_failure_retries_and_the_retry_does_not_post_twice(self):
        self.block("ST-001")
        with unittest.mock.patch.object(jirabackend, "transition_to_name",
                                        side_effect=jirabackend.RateLimited("429")):
            result = self.unblock()
        self.assertFalse(result["ok"])
        self.assertTrue(result["retry"])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(self.fake.status[f"{KEY}-1"], BLOCKED)
        again = self.unblock()
        self.assertEqual(again["status"], "complete")
        self.assertEqual(self.fake.posted[f"{KEY}-1"].count(self.RESOLVED), 1)
        self.assertEqual(self.fake.status[f"{KEY}-1"], jirabackend.RESOLVED_STATUS)

    def test_no_transition_is_refused_by_name(self):
        self.block("ST-001")
        self.fake.no_resolved.add(f"{KEY}-1")
        result = self.unblock()
        self.assertEqual(result["status"], "blocked")
        self.assertIn("NoTransition", result["reason"])

    def test_refusals_before_any_call(self):
        for result in (self.unblock(reason=" "), self.unblock(source="other"),
                       self.unblock(story="nonsense")):
            self.assertEqual(result["status"], "blocked")
        self.assertEqual(self.fake.calls, [])

    def test_dry_run_writes_nothing(self):
        self.block("ST-001")
        before = len(self.writes())
        result = self.unblock(dry_run=True)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(self.writes()), before)

    def test_the_cli(self):
        self.block("ST-001")
        out = io.StringIO()
        with unittest.mock.patch.object(jirabackend, "client_for", _client_with(self.fake)), \
                contextlib.redirect_stdout(out):
            code = track.main(["unblock", "--directory", str(self.root), "--story", "ST-001",
                               "--reason", "resumed", "--source", "run"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["issues"][0]["to"], jirabackend.RESOLVED_STATUS)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = track.main(["unblock", "--directory", str(self.root), "--story", "ST-001",
                               "--engagement", ENG, "--reason", "x"])
        self.assertEqual(code, 2)


class EngagementUnblockTests(EngagementTestCase):
    """Story 36.3 (DW-47): `Block Resolved`, never `Done`."""

    def unblock_eng(self, kind="cap", reason="go by the owner", **kwargs):
        return track.unblock_engagement(self.root, ENG, kind, reason, transport=self.fake,
                                        sleep=self.sleeps.append, **kwargs)

    def test_moves_to_block_resolved_never_done(self):
        self.block_eng(kind="cap", reason="reached its cap")
        result = self.unblock_eng()
        self.assertEqual(result["status"], "complete")
        self.assertEqual((result["engagement"], result["kind"]), (ENG, "cap"))
        self.assertEqual(self.fake.status[f"{KEY}-100"], jirabackend.RESOLVED_STATUS)
        self.assertEqual(self.fake.posted[f"{KEY}-100"][-1], "Resolved: go by the owner")
        self.assertEqual(result["issues"][0]["issue"], f"{KEY}-100")

    def test_not_blocked_is_skipped(self):
        self.block_eng(kind="ask", reason="landed")
        self.fake.status[f"{KEY}-100"] = "In Progress"
        before = len(self.writes())
        result = self.unblock_eng(kind="ask", reason="continue by the owner")
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(self.writes()), before)
        self.assertEqual(len(result["skipped"]), 1)

    def test_refusals_by_name(self):
        self.assertIn("UnknownKind", self.unblock_eng(kind="questions")["reason"])
        self.assertIn("ReasonMissing", self.unblock_eng(reason=" ")["reason"])
        self.assertIn("NoIssue", self.unblock_eng()["reason"])

    def test_the_cli(self):
        self.block_eng(kind="cap", reason="reached its cap")
        out = io.StringIO()
        with unittest.mock.patch.object(jirabackend, "client_for", _client_with(self.fake)), \
                contextlib.redirect_stdout(out):
            code = track.main(["unblock", "--directory", str(self.root), "--engagement", ENG,
                               "--kind", "cap", "--reason", "go by the owner"])
        self.assertEqual(code, 0)
        self.assertEqual(self.fake.status[f"{KEY}-100"], jirabackend.RESOLVED_STATUS)


if __name__ == "__main__":
    unittest.main()
