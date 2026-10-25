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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import interchange  # noqa: E402
import jirabackend  # noqa: E402
import plansync  # noqa: E402
import track  # noqa: E402

from test_syncback import (AGENT, KEY, OWNER, FakeSyncBack,  # noqa: E402
                           SyncBackTestCase, comment)

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

    def _jira(self, method, path, query, body):
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
                and m.group(1) in self.no_resolved)]
            if method == "GET":
                return 200, {"transitions": [
                    {"id": str(10 * (WORKFLOW.index(n) + 1)),
                     "to": {"name": n,
                            "statusCategory": {"key": "indeterminate"}}}
                    for n in names]}
            assert set(body) == {"transition"}, body
            self.status[m.group(1)] = WORKFLOW[
                int(body["transition"]["id"]) // 10 - 1]
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


if __name__ == "__main__":
    unittest.main()
