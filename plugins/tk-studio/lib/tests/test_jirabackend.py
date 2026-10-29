"""Tests for the Jira Cloud backend adapter (ST-8.1 acceptance criteria).

A fake transport stands in for Atlassian Cloud — the adapter's transport
seam exists exactly so these tests prove the AD-5/AD-7 semantics offline:
default-mapping promote, status-class pull-back with echo suppression and
both-changed conflicts identical to the local projection, category-based
round-trip stability, and the named-blocked auth preflight (never a
silent 401).
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import interchange  # noqa: E402
import jirabackend  # noqa: E402
import plansync  # noqa: E402

from test_plansync import EPICS_DOC  # noqa: E402

RUNTIME = {"planning": {"backend": "jira"}}
BINDING_CONFIG = """\
planning:
  backend: jira
  jira:
    site: example.atlassian.net
    project_key: TKS
"""


class FakeJira:
    """Minimal Jira Cloud state machine behind the transport seam."""

    STATUSES = {"To Do": "new", "In Progress": "indeterminate", "Done": "done"}

    def __init__(self, issue_types=("Epic", "Story", "Sub-task", "Task")):
        self.issue_types = list(issue_types)
        self.issues: dict[str, dict] = {}
        self.counter = 0
        self.calls: list[tuple[str, str]] = []
        self.fail_auth = False
        self.users = [{"accountId": "acc-tim", "displayName": "Tim",
                       "emailAddress": "tim@example.com"}]
        # Story 31.7: each issue's histories, oldest first, served by the
        # pinned `GET /issue/{key}/changelog` shape (two per page)
        self.changelogs: dict[str, list[dict]] = {}

    def history(self, key, hid, account_id, to_name, created,
                field="status"):
        """Append one changelog history moving `key` into `to_name`;
        `account_id` None leaves the author out, "" leaves it empty."""
        entry = {"id": hid, "created": created,
                 "items": [{"field": field, "fieldtype": "jira",
                            "fromString": "x", "toString": to_name}]}
        if account_id is not None:
            entry["author"] = {"accountId": account_id}
        self.changelogs.setdefault(key, []).append(entry)
        return entry

    def __call__(self, method, url, body):
        path, _, query = url.split(jirabackend.API_PREFIX, 1)[1].partition("?")
        self.calls.append((method, path))
        if self.fail_auth:
            return 401, {"errorMessages": ["Unauthorized"]}
        log_m = re.match(r"^/issue/([^/]+)/changelog$", path)
        if log_m and method == "GET":
            q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
            values = self.changelogs.get(log_m.group(1), [])
            start = int(q.get("startAt", 0))
            page = values[start:start + 2]
            return 200, {"values": page, "startAt": start, "maxResults": 2,
                         "total": len(values),
                         "isLast": start + len(page) >= len(values)}
        if method == "GET" and path == "/myself":
            return 200, {"displayName": "Tim",
                         "emailAddress": "tim@example.com"}
        if method == "GET" and path.startswith("/project/"):
            if path.rsplit("/", 1)[1] != "TKS":
                return 404, {"errorMessages": ["No project"]}
            return 200, {"key": "TKS",
                         "issueTypes": [{"name": n} for n in self.issue_types]}
        if method == "GET" and path == "/user/search":
            q = urllib.parse.parse_qs(query).get("query", [""])[0].lower()
            return 200, [u for u in self.users
                         if q in u["displayName"].lower()
                         or q in u["emailAddress"].lower()]
        if method == "POST" and path == "/issue":
            self.counter += 1
            key = f"TKS-{self.counter}"
            self.issues[key] = {"fields": dict(body["fields"]),
                                "status": "To Do", "assignee": None}
            return 201, {"id": str(1000 + self.counter), "key": key}
        issue_m = re.match(r"^/issue/([^/]+)$", path)
        if issue_m:
            key = issue_m.group(1)
            if key not in self.issues:
                return 404, {"errorMessages": ["No issue"]}
            issue = self.issues[key]
            if method == "PUT":
                issue["fields"].update(body["fields"])
                return 204, None
            name = issue["status"]
            return 200, {"key": key, "fields": {
                "status": {"name": name,
                           "statusCategory": {"key": self.STATUSES[name]}},
                "assignee": issue["assignee"],
                "summary": issue["fields"].get("summary"),
                "labels": issue["fields"].get("labels") or []}}
        assign_m = re.match(r"^/issue/([^/]+)/assignee$", path)
        if assign_m and method == "PUT":
            account_id = body.get("accountId")
            if account_id is None:
                self.issues[assign_m.group(1)]["assignee"] = None
            else:
                user = next(u for u in self.users
                            if u["accountId"] == account_id)
                self.issues[assign_m.group(1)]["assignee"] = {
                    "displayName": user["displayName"],
                    "emailAddress": user["emailAddress"]}
            return 204, None
        trans_m = re.match(r"^/issue/([^/]+)/transitions$", path)
        if trans_m:
            names = list(self.STATUSES)
            if method == "GET":
                return 200, {"transitions": [
                    {"id": str(i + 1),
                     "to": {"name": name,
                            "statusCategory": {"key": self.STATUSES[name]}}}
                    for i, name in enumerate(names)]}
            target = names[int(body["transition"]["id"]) - 1]
            self.issues[trans_m.group(1)]["status"] = target
            return 204, None
        return 400, {"errorMessages": [f"unhandled {method} {path}"]}

    def writes(self) -> list[tuple[str, str]]:
        return [c for c in self.calls if c[0] in ("POST", "PUT")]


class JiraTestCase(unittest.TestCase):
    # the five agent-seat names too: the sandbox exports real values, and
    # a set TK_ATLASSIAN_AGENT_TOKEN would move these tests off the
    # legacy JIRA_* path (Story 31.2)
    ENV_KEYS = ("TK_STUDIO_HOME", jirabackend.TOKEN_ENV, jirabackend.EMAIL_ENV,
                *jirabackend.AGENT_ENV_NAMES)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._saved_env = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for key in jirabackend.AGENT_ENV_NAMES:
            os.environ.pop(key, None)
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")
        os.environ[jirabackend.TOKEN_ENV] = "fake-token"
        os.environ[jirabackend.EMAIL_ENV] = "tim@example.com"
        self.root = Path(self._tmp.name) / "proj"
        planning = self.root / "_bmad-output" / "planning-artifacts"
        planning.mkdir(parents=True)
        (planning / "epics.md").write_text(EPICS_DOC, encoding="utf-8",
                                           newline="\n")
        conf_dir = self.root / ".tk-studio"
        conf_dir.mkdir()
        (conf_dir / "config.yaml").write_text(BINDING_CONFIG, encoding="utf-8",
                                              newline="\n")
        self.fake = FakeJira()
        self.client = jirabackend.JiraClient(
            "example.atlassian.net", "tim@example.com", "fake-token",
            transport=self.fake)
        plansync.normalize(self.root)

    def tearDown(self):
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def _project(self, dry_run=False):
        return jirabackend.project(self.root, plansync.plan_dir(self.root),
                                   dry_run=dry_run, client=self.client)

    def _canonical(self, entity_id: str) -> tuple[Path, dict, str]:
        path = plansync.plan_dir(self.root) / f"{entity_id}.md"
        front, body = interchange.parse_entity(path)
        return path, front, body

    def _set_canonical(self, entity_id: str, **updates):
        path, front, body = self._canonical(entity_id)
        for key, value in updates.items():
            if value is None:
                front.pop(key, None)
            else:
                front[key] = value
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")

    def _jira_key(self, entity_id: str) -> str:
        _, front, _ = self._canonical(entity_id)
        return front["external"]["jira"]["key"]


class BlockedPreflightTests(JiraTestCase):
    def test_sync_blocked_without_binding_config(self):
        (self.root / ".tk-studio" / "config.yaml").write_text(
            "vcs: git\n", encoding="utf-8", newline="\n")
        os.environ.pop(jirabackend.TOKEN_ENV, None)
        result = plansync.sync(self.root, runtime=RUNTIME)
        self.assertTrue(result.get("blocked"))
        self.assertIn("planning.jira.site", result["reason"])
        self.assertIn("planning.jira.project_key", result["reason"])

    def test_sync_blocked_without_token_names_the_gap(self):
        os.environ.pop(jirabackend.TOKEN_ENV, None)
        result = plansync.sync(self.root, runtime=RUNTIME)
        self.assertTrue(result.get("blocked"))
        self.assertIn(jirabackend.TOKEN_ENV, result["reason"])
        self.assertIn("OAuth", result["reason"])

    def test_auth_failure_names_token_and_org_toggle(self):
        self.fake.fail_auth = True
        result = self._project()
        self.assertTrue(result.get("blocked"))
        self.assertIn("401", result["reason"])
        self.assertIn(jirabackend.TOKEN_ENV, result["reason"])
        self.assertIn("org-admin", result["reason"])
        self.assertEqual(self.fake.issues, {})

    def test_missing_issue_type_blocks_before_any_write(self):
        self.fake.issue_types = ["Epic", "Story"]
        result = self._project()
        self.assertTrue(result.get("blocked"))
        self.assertIn("Sub-task", result["reason"])
        self.assertEqual(self.fake.writes(), [])

    def test_scheme_variant_name_confirms_the_mapping(self):
        self.fake.issue_types = ["Epic", "Story", "Subtask"]
        result = self._project()
        self.assertEqual(result["action"], "projected")
        self.assertEqual(result["preflight"]["mapping"]["task"], "Subtask")


class PromoteTests(JiraTestCase):
    def test_promote_creates_per_default_mapping(self):
        result = self._project()
        self.assertEqual(result["action"], "projected")
        self.assertEqual(len(result["promote"]["created"]), 5)
        # EP-017: every promote entry names the canonical file it rewrote
        # (external snapshot) so sync's written[] roll-up can carry it.
        for entry in result["promote"]["created"]:
            self.assertTrue(entry.get("path", "").endswith(f"{entry['id']}.md"))
        epic = self.fake.issues[self._jira_key("EP-001")]
        self.assertEqual(epic["fields"]["issuetype"], {"name": "Epic"})
        self.assertEqual(epic["fields"]["summary"], "First Epic")
        story = self.fake.issues[self._jira_key("ST-001")]
        self.assertEqual(story["fields"]["issuetype"], {"name": "Story"})
        self.assertEqual(story["fields"]["parent"],
                         {"key": self._jira_key("EP-001")})
        self.assertEqual(story["fields"]["labels"][0], "ST-001")
        _, front, _ = self._canonical("ST-001")
        snapshot = front["external"]["jira"]
        for key in ("key", "synced_at", "content_hash", "status",
                    "canonical_status"):
            self.assertIn(key, snapshot)
        self.assertEqual(snapshot["status"], "To Do")
        self.assertEqual(snapshot["canonical_status"], "draft")

    def test_task_promotes_as_subtask_under_its_story(self):
        self._project()
        now = "2026-08-06T00:00:00+00:00"
        entity = {"shape_version": 1, "id": "TA-001", "type": "task",
                  "title": "A Task", "status": "draft", "created": now,
                  "updated": now, "parent": "ST-001"}
        (plansync.plan_dir(self.root) / "TA-001.md").write_text(
            interchange.render_entity(entity, "\nTask body.\n"),
            encoding="utf-8", newline="\n")
        self._project()
        task = self.fake.issues[self._jira_key("TA-001")]
        self.assertEqual(task["fields"]["issuetype"], {"name": "Sub-task"})
        self.assertEqual(task["fields"]["parent"],
                         {"key": self._jira_key("ST-001")})

    def test_second_projection_is_idempotent(self):
        self._project()
        self.fake.calls.clear()
        result = self._project()
        self.assertEqual(result["promote"]["created"], [])
        self.assertEqual(result["promote"]["updated"], [])
        self.assertEqual(result["pull_back"]["applied"], [])
        self.assertEqual(self.fake.writes(), [])

    def test_status_change_promotes_via_transition(self):
        self._project()
        self._set_canonical("ST-001", status="in-progress")
        self._project()
        key = self._jira_key("ST-001")
        self.assertEqual(self.fake.issues[key]["status"], "In Progress")
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["external"]["jira"]["canonical_status"],
                         "in-progress")

    def test_dropped_entity_is_not_promoted(self):
        self._set_canonical("ST-003", status="dropped")
        self._project()
        summaries = [i["fields"]["summary"] for i in self.fake.issues.values()]
        self.assertNotIn("Gamma Story", summaries)

    def test_assignee_promotes_via_user_search(self):
        self._set_canonical("ST-001", assignee="tim")
        self._project()
        key = self._jira_key("ST-001")
        self.assertEqual(self.fake.issues[key]["assignee"]["emailAddress"],
                         "tim@example.com")
        _, front, _ = self._canonical("ST-001")
        snapshot = front["external"]["jira"]
        self.assertEqual(snapshot["assignee"], "tim@example.com")
        self.assertEqual(snapshot["canonical_assignee"], "tim")
        self.fake.calls.clear()
        self._project()  # the resolved account must not re-sync forever
        self.assertEqual(self.fake.writes(), [])


class RoundTripTests(JiraTestCase):
    def test_unrepresentable_status_survives_round_trip(self):
        self._project()
        self._set_canonical("ST-001", status="review")
        self._project()
        key = self._jira_key("ST-001")
        self.assertEqual(self.fake.issues[key]["status"], "In Progress")
        result = self._project()  # unchanged backend: echo must not clobber
        self.assertEqual(result["pull_back"]["applied"], [])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "review")


class PullBackTests(JiraTestCase):
    def test_backend_status_change_updates_canonical_only(self):
        self._project()
        _, before, body_before = self._canonical("ST-001")
        self.fake.issues[self._jira_key("ST-001")]["status"] = "Done"
        result = self._project()
        applied = result["pull_back"]["applied"]
        self.assertEqual([a["id"] for a in applied], ["ST-001"])
        self.assertEqual(applied[0]["fields"], ["status"])
        _, front, body = self._canonical("ST-001")
        self.assertEqual(front["status"], "done")
        self.assertEqual(body, body_before)
        self.assertEqual(front["title"], before["title"])

    def test_both_changed_is_a_conflict_never_resolved(self):
        self._project()
        self._set_canonical("ST-001", status="blocked")
        self.fake.issues[self._jira_key("ST-001")]["status"] = "Done"
        result = self._project()
        conflicts = result["conflicts"]
        self.assertEqual([c["id"] for c in conflicts], ["ST-001"])
        self.assertTrue(any("status" in f for f in conflicts[0]["fields"]))
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "blocked")
        # neither side resolved: the backend edit survives too (AD-5)
        self.assertEqual(self.fake.issues[self._jira_key("ST-001")]["status"],
                         "Done")

    def test_assignee_pulls_back(self):
        self._project()
        self.fake.issues[self._jira_key("ST-001")]["assignee"] = {
            "displayName": "Sam"}
        result = self._project()
        applied = result["pull_back"]["applied"]
        self.assertEqual(applied[0]["fields"], ["assignee"])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["assignee"], "Sam")

    def test_backend_unassign_pulls_back(self):
        self._set_canonical("ST-001", assignee="tim")
        self._project()
        self.fake.issues[self._jira_key("ST-001")]["assignee"] = None
        self._project()
        _, front, _ = self._canonical("ST-001")
        self.assertNotIn("assignee", front)

    def test_epic_status_pulls_back_too(self):
        self._project()
        self.fake.issues[self._jira_key("EP-001")]["status"] = "In Progress"
        self._project()
        _, front, _ = self._canonical("EP-001")
        self.assertEqual(front["status"], "in-progress")


class SetupStatusMappingTests(JiraTestCase):
    """Story 31.4: the two template statuses map onto canonical `blocked` by
    name (AD-22, AD-6); every other status keeps the category mapping, and
    `sync` and `sync-back` share it so neither flips an entity."""

    def setUp(self):
        super().setUp()
        self.fake.STATUSES = {**FakeJira.STATUSES,
                              jirabackend.BLOCKED_STATUS: "indeterminate",
                              jirabackend.RESOLVED_STATUS: "indeterminate"}

    def test_canonical_status_by_name_then_category(self):
        self.assertEqual(jirabackend.canonical_status(
            "Blocked - Awaiting User", "indeterminate"), "blocked")
        self.assertEqual(jirabackend.canonical_status(
            "Block Resolved", "indeterminate"), "blocked")
        self.assertEqual(jirabackend.canonical_status(
            "In Progress", "indeterminate"), "in-progress")
        self.assertEqual(jirabackend.canonical_status("To Do", "new"), "ready")
        self.assertEqual(jirabackend.canonical_status("Done", "done"), "done")
        self.assertIsNone(jirabackend.canonical_status("Odd", "weird"))

    def test_pull_back_maps_both_setup_statuses_to_blocked(self):
        self._project()
        key = self._jira_key("ST-001")
        self.fake.issues[key]["status"] = jirabackend.BLOCKED_STATUS
        self._project()
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "blocked")
        self.assertEqual(front["external"]["jira"]["status"],
                         "Blocked - Awaiting User")
        self.fake.issues[key]["status"] = jirabackend.RESOLVED_STATUS
        result = self._project()
        self.assertEqual(result["conflicts"], [])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "blocked")
        self.assertEqual(front["external"]["jira"]["status"], "Block Resolved")

    def test_promote_leaves_a_blocked_entity_untouched(self):
        self._project()
        key = self._jira_key("ST-001")
        self.fake.issues[key]["status"] = jirabackend.BLOCKED_STATUS
        self._project()  # pull-back makes it blocked
        self.fake.calls.clear()
        result = self._project()
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual(result["pull_back"]["applied"], [])
        self.assertEqual(self.fake.issues[key]["status"],
                         "Blocked - Awaiting User")
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "blocked")

    def test_jira_catching_up_refreshes_a_stale_snapshot(self):
        # local `blocked` was never promoted (snapshot still `in-progress`);
        # Jira then moves to the blocked status: the snapshot follows, so
        # promote has nothing to push (AD-5 round trip)
        self._project()
        key = self._jira_key("ST-001")
        self._set_canonical("ST-001", status="in-progress")
        self._project()
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["external"]["jira"]["canonical_status"],
                         "in-progress")
        self._set_canonical("ST-001", status="blocked")
        self.fake.issues[key]["status"] = jirabackend.BLOCKED_STATUS
        self.fake.calls.clear()
        result = self._project()
        self.assertEqual(result["conflicts"], [])
        self.assertEqual(result["promote"]["updated"], [])
        self.assertEqual(self.fake.writes(), [])
        self.assertFalse(any(path.endswith("/transitions")
                             for _, path in self.fake.calls))
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "blocked")
        self.assertEqual(front["external"]["jira"]["status"],
                         jirabackend.BLOCKED_STATUS)
        self.assertEqual(front["external"]["jira"]["canonical_status"],
                         "blocked")

    def _legacy_snapshot(self, local_status):
        # a pre-31.4 pull-back mapped `Blocked - Awaiting User` by category
        # only: the snapshot holds the Jira name and `in-progress`
        self._project()
        key = self._jira_key("ST-001")
        path, front, body = self._canonical("ST-001")
        front["status"] = local_status
        front["external"]["jira"]["status"] = jirabackend.BLOCKED_STATUS
        front["external"]["jira"]["canonical_status"] = "in-progress"
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")
        return key

    def test_a_legacy_snapshot_re_maps_to_blocked(self):
        key = self._legacy_snapshot("in-progress")
        result = jirabackend.apply_statuses(
            plansync.plan_dir(self.root),
            {key: (jirabackend.BLOCKED_STATUS, "indeterminate")})
        self.assertEqual(result["conflicts"], [])
        self.assertEqual([(a["id"], a["fields"]) for a in result["applied"]],
                         [("ST-001", ["status"])])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "blocked")
        self.assertEqual(front["external"]["jira"]["status"],
                         jirabackend.BLOCKED_STATUS)
        self.assertEqual(front["external"]["jira"]["canonical_status"],
                         "blocked")
        # once re-mapped it is echo-suppressed again
        again = jirabackend.apply_statuses(
            plansync.plan_dir(self.root),
            {key: (jirabackend.BLOCKED_STATUS, "indeterminate")})
        self.assertEqual(again["applied"], [])

    def test_a_legacy_snapshot_with_a_pending_local_change_is_untouched(self):
        key = self._legacy_snapshot("done")
        before_text = (plansync.plan_dir(self.root) / "ST-001.md").read_text(
            "utf-8")
        result = jirabackend.apply_statuses(
            plansync.plan_dir(self.root),
            {key: (jirabackend.BLOCKED_STATUS, "indeterminate")})
        self.assertEqual(result["conflicts"], [])
        self.assertEqual(result["applied"], [])
        self.assertEqual((plansync.plan_dir(self.root) / "ST-001.md")
                         .read_text("utf-8"), before_text)
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "done")


class RateLimitTests(unittest.TestCase):
    """Story 31.4: a transport may answer a 3-tuple with headers; a 429 waits
    `Retry-After`, else 1, 2, 4, 8, 16 s, then raises `RateLimited`."""

    def client(self, answers):
        calls = []

        def transport(method, url, body):
            calls.append(url)
            return answers.pop(0) if answers else (200, {"ok": True})
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake", transport)
        sleeps = []
        client.sleep = sleeps.append
        return client, calls, sleeps

    def test_two_tuple_transports_keep_working(self):
        client, _, sleeps = self.client([(200, {"a": 1})])
        self.assertEqual(client.request("GET", "/myself"), (200, {"a": 1}))
        self.assertEqual(sleeps, [])
        self.assertEqual(client.rate_limit["headers"], {})

    def test_headers_are_recorded(self):
        client, _, _ = self.client([(200, {}, {"X-RateLimit-Remaining": "9",
                                                "RateLimit-Policy": "p",
                                                "Content-Type": "json"})])
        client.request("GET", "/myself")
        self.assertEqual(client.rate_limit["headers"],
                         {"x-ratelimit-remaining": "9",
                          "ratelimit-policy": "p"})

    def test_retry_after_is_honoured(self):
        client, calls, sleeps = self.client(
            [(429, {}, {"Retry-After": "7"}), (200, {"done": True})])
        self.assertEqual(client.request("GET", "/myself"),
                         (200, {"done": True}))
        self.assertEqual(sleeps, [7.0])
        self.assertEqual(len(calls), 2)

    def test_exhausted_backoff_raises_with_the_reason(self):
        answers = [(429, {}, {"RateLimit-Reason": "jira-per-issue-on-write"})
                   for _ in range(6)]
        client, calls, sleeps = self.client(answers)
        with self.assertRaises(jirabackend.RateLimited) as caught:
            client.request("GET", "/myself")
        self.assertEqual(sleeps, [1, 2, 4, 8, 16])
        self.assertEqual(len(calls), 6)
        self.assertEqual(caught.exception.reason, "jira-per-issue-on-write")
        self.assertIn("jira-per-issue-on-write", str(caught.exception))
        self.assertEqual(len(client.rate_limit["throttled"]), 6)

    def test_retry_after_past_the_cap_raises_without_waiting(self):
        client, calls, sleeps = self.client(
            [(429, {}, {"Retry-After": str(jirabackend.RETRY_AFTER_CAP + 1),
                        "RateLimit-Reason": "jira-quota-global-based"})])
        with self.assertRaises(jirabackend.RateLimited) as caught:
            client.request("GET", "/myself")
        self.assertEqual(sleeps, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(caught.exception.reason, "jira-quota-global-based")
        self.assertEqual(len(client.rate_limit["throttled"]), 1)

    def test_the_wait_budget_spans_the_client_and_raises_at_once(self):
        # each wait under the cap, but their total would pass the budget —
        # across two requests of one client (one tick)
        wait = jirabackend.RETRY_AFTER_CAP
        n = int(jirabackend.RETRY_WAIT_BUDGET // wait)
        answers = ([(429, {}, {"Retry-After": str(wait)})] * (n - 1)
                   + [(200, {})]
                   + [(429, {}, {"Retry-After": str(wait),
                                 "RateLimit-Reason": "burst"})] * 3)
        client, _, sleeps = self.client(answers)
        self.assertEqual(client.request("GET", "/myself")[0], 200)
        with self.assertRaises(jirabackend.RateLimited) as caught:
            client.request("GET", "/myself")
        self.assertEqual(sleeps, [float(wait)] * n)
        self.assertLessEqual(sum(sleeps), jirabackend.RETRY_WAIT_BUDGET)
        self.assertEqual(caught.exception.reason, "burst")
        self.assertIn("retry budget", str(caught.exception))

    def test_the_budget_sits_well_under_the_job_guard(self):
        job = json.loads((Path(__file__).resolve().parents[2] / "jobs" /
                          "atlassian-sync-back.json").read_text("utf-8"))
        guard = job["guards"]["max_wall_clock_seconds"]
        # two clients (Jira, Confluence) per tick
        self.assertLess(2 * jirabackend.RETRY_WAIT_BUDGET, guard * 0.75)

    def test_confluence_bounds_its_waits_too(self):
        import confluence
        answers = [(429, {}, {"Retry-After": "600",
                              "RateLimit-Reason": "confluence-burst"})]
        client = confluence.ConfluenceClient(
            "cloud-test", "agent@example.com", "fake",
            lambda m, u, b: answers.pop(0))
        sleeps = []
        client.sleep = sleeps.append
        with self.assertRaises(confluence.RateLimited) as caught:
            client.request("GET", "/spaces")
        self.assertEqual(sleeps, [])
        self.assertEqual(caught.exception.reason, "confluence-burst")

    def test_confluence_retries_the_same_way(self):
        import confluence
        answers = [(429, {}, {"Retry-After": "2"}),
                   (200, {"results": []}, {"X-RateLimit-Limit": "350"})]
        client = confluence.ConfluenceClient(
            "cloud-test", "agent@example.com", "fake",
            lambda m, u, b: answers.pop(0))
        sleeps = []
        client.sleep = sleeps.append
        self.assertEqual(client.request("GET", "/spaces")[0], 200)
        self.assertEqual(sleeps, [2.0])
        self.assertEqual(client.rate_limit["headers"],
                         {"x-ratelimit-limit": "350"})


class DryRunTests(JiraTestCase):
    def test_dry_run_never_contacts_the_backend(self):
        result = self._project(dry_run=True)
        self.assertEqual(result["action"], "dry-run")
        self.assertEqual(len(result["promote"]["created"]), 5)
        self.assertEqual(self.fake.calls, [])
        # EP-017: dry-run entries name the would-rewritten canonical file
        # too — "the same lists name what the run would write".
        for entry in result["promote"]["created"]:
            self.assertTrue(entry.get("path", "").endswith(f"{entry['id']}.md"))

    def test_dry_run_without_credentials_still_plans(self):
        os.environ.pop(jirabackend.TOKEN_ENV, None)
        os.environ.pop(jirabackend.EMAIL_ENV, None)
        result = plansync.sync(self.root, dry_run=True, runtime=RUNTIME)
        self.assertTrue(result["ok"])
        self.assertEqual(result["projection"]["action"], "dry-run")


class DroppedPullBackTests(JiraTestCase):
    """DW-95 / DW-114: `DNI` pulls back as canonical `dropped` by name, and
    a landed issue in a Done-category status other than `Done` is never a
    silent `done`."""

    def setUp(self):
        super().setUp()
        self.fake.STATUSES = {"To Do": "new", "In Progress": "indeterminate",
                              "Done": "done", "DNI": "done",
                              "Closed": "done"}

    def _landed(self):
        self._project()
        key = self._jira_key("ST-001")
        self.fake.issues[key]["status"] = "Done"
        self._project()
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "done")
        return key

    def test_canonical_status_maps_dni_to_dropped(self):
        self.assertEqual(jirabackend.canonical_status("DNI", "done"),
                         "dropped")
        self.assertEqual(jirabackend.canonical_status("Closed", "done"),
                         "done")

    def test_dni_pulls_back_as_dropped(self):
        key = self._landed()
        self.fake.issues[key]["status"] = "DNI"
        result = self._project()
        self.assertEqual(result["conflicts"], [])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "dropped")
        self.assertEqual(front["external"]["jira"]["status"], "DNI")
        self.assertEqual(front["external"]["jira"]["canonical_status"],
                         "dropped")
        # promote never moves a dropped entity back out of DNI
        self._project()
        self.assertEqual(self.fake.issues[key]["status"], "DNI")

    def _legacy_dni_snapshot(self, local_status):
        # hole 100: a pull-back mapped `DNI` by category, as `done`
        key = self._landed()
        path, front, body = self._canonical("ST-001")
        front["status"] = local_status
        front["external"]["jira"]["status"] = "DNI"
        front["external"]["jira"]["canonical_status"] = "done"
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")
        return key

    def test_a_legacy_dni_snapshot_re_maps_to_dropped(self):
        key = self._legacy_dni_snapshot("done")
        result = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                            {key: ("DNI", "done")})
        self.assertEqual([(a["id"], a["fields"]) for a in result["applied"]],
                         [("ST-001", ["status"])])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "dropped")
        self.assertEqual(front["external"]["jira"]["canonical_status"],
                         "dropped")

    def test_a_legacy_dni_snapshot_with_a_local_change_is_untouched(self):
        key = self._legacy_dni_snapshot("in-progress")
        path = plansync.plan_dir(self.root) / "ST-001.md"
        before = path.read_text("utf-8")
        result = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                            {key: ("DNI", "done")})
        self.assertEqual(result["applied"], [])
        self.assertEqual(path.read_text("utf-8"), before)

    def test_a_non_canonical_landed_name_is_a_loud_note(self):
        key = self._landed()
        self.fake.issues[key]["status"] = "Closed"
        result = self._project()
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "done")
        snap = front["external"]["jira"]
        self.assertEqual(snap["status"], "Closed")
        self.assertIn("'Closed'", snap["status_note"])
        self.assertIn("'Done'", snap["status_note"])
        notes = [n for n in result["pull_back"]["notes"] if "'Closed'" in n]
        self.assertEqual(len(notes), 1)
        for part in ("ST-001", key, "'Done'"):
            self.assertIn(part, notes[0])
        # the note repeats while the name stays; nothing is rewritten
        again = self._project()
        self.assertTrue(any("'Closed'" in n for n in again["pull_back"]["notes"]))
        self.assertEqual(again["pull_back"]["applied"], [])

    def test_the_canonical_done_name_clears_the_note(self):
        key = self._landed()
        self.fake.issues[key]["status"] = "Closed"
        self._project()
        self.fake.issues[key]["status"] = "Done"
        result = self._project()
        self.assertFalse(any("'Closed'" in n or "DW-114" in n
                             for n in result["pull_back"]["notes"]))
        _, front, _ = self._canonical("ST-001")
        self.assertNotIn("status_note", front["external"]["jira"])
        self.assertEqual(front["external"]["jira"]["status"], "Done")
        self.assertEqual(front["status"], "done")

    def test_the_sync_back_shares_the_note(self):
        key = self._landed()
        result = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                            {key: ("Closed", "done")})
        self.assertTrue(any("'Closed'" in n for n in result["notes"]))
        _, front, _ = self._canonical("ST-001")
        self.assertIn("status_note", front["external"]["jira"])

    def _dw114(self, notes):
        return [n for n in notes if "DW-114" in n]

    def _edit_landed(self, local_status, snap_status, status_note=None):
        key = self._landed()
        path, front, body = self._canonical("ST-001")
        front["status"] = local_status
        snap = front["external"]["jira"]
        snap["status"] = snap_status
        snap["canonical_status"] = "done"
        if status_note is None:
            snap.pop("status_note", None)
        else:
            snap["status_note"] = status_note
        path.write_text(interchange.render_entity(front, body),
                        encoding="utf-8", newline="\n")
        return key, path

    def test_closed_over_an_unpromoted_change_is_a_conflict_without_the_note(self):
        # Jira moves to `Closed` while a local `in-progress` is unpromoted:
        # a conflict, never "kept as `done`"
        key, path = self._edit_landed("in-progress", "Done")
        before = path.read_text("utf-8")
        result = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                            {key: ("Closed", "done")})
        self.assertEqual([c["id"] for c in result["conflicts"]], ["ST-001"])
        self.assertEqual(self._dw114(result["notes"]), [])
        self.assertEqual(result["applied"], [])
        self.assertEqual(path.read_text("utf-8"), before)

    def test_closed_under_an_unpromoted_review_claims_no_done(self):
        # Jira stays `Closed` while a local `review` is unpromoted: no note
        # line, and the stale `status_note` is removed once, not rewritten
        key, path = self._edit_landed(
            "review", "Closed",
            status_note=jirabackend._landed_status_note("Closed", "done"))
        result = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                            {key: ("Closed", "done")})
        self.assertEqual(result["conflicts"], [])
        self.assertEqual(self._dw114(result["notes"]), [])
        self.assertEqual([(a["id"], a["fields"]) for a in result["applied"]],
                         [("ST-001", ["external.jira.status_note"])])
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "review")
        self.assertNotIn("status_note", front["external"]["jira"])
        before = path.read_text("utf-8")
        again = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                           {key: ("Closed", "done")})
        self.assertEqual(self._dw114(again["notes"]), [])
        self.assertEqual(again["applied"], [])
        self.assertEqual(path.read_text("utf-8"), before)

    def test_a_missing_note_alone_is_written(self):
        # a snapshot already on `Closed` (canonical `done`) but without its
        # `status_note`: the pull-back writes the note and nothing else
        key, path = self._edit_landed("done", "Closed")
        result = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                            {key: ("Closed", "done")})
        self.assertEqual([(a["id"], a["fields"]) for a in result["applied"]],
                         [("ST-001", ["external.jira.status_note"])])
        self.assertEqual(len(self._dw114(result["notes"])), 1)
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["status"], "done")
        self.assertEqual(front["external"]["jira"]["status_note"],
                         jirabackend._landed_status_note("Closed", "done"))
        # the second pass repeats the note line but writes nothing
        before = path.read_text("utf-8")
        again = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                           {key: ("Closed", "done")})
        self.assertEqual(again["applied"], [])
        self.assertEqual(len(self._dw114(again["notes"])), 1)
        self.assertEqual(path.read_text("utf-8"), before)

    def test_a_conflict_over_an_existing_note_leaves_the_file_byte_identical(self):
        # a snapshot on `Closed` carrying its `status_note`, a local
        # `in-progress` unpromoted, and Jira moves on to `Done`: a conflict,
        # and the entity file (note included) is not rewritten by one byte
        key, path = self._edit_landed(
            "in-progress", "Closed",
            status_note=jirabackend._landed_status_note("Closed", "done"))
        before = path.read_bytes()
        result = jirabackend.apply_statuses(plansync.plan_dir(self.root),
                                            {key: ("Done", "done")})
        self.assertEqual([c["id"] for c in result["conflicts"]], ["ST-001"])
        self.assertEqual(result["applied"], [])
        self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()


class GatewayTests(JiraTestCase):
    """Story 31.2: the agent seat's gateway path, its refusals by name, the
    legacy fallback and the 401 / proxy 403 / scope 403 split."""

    def _gateway_env(self):
        os.environ.pop(jirabackend.TOKEN_ENV, None)
        os.environ.pop(jirabackend.EMAIL_ENV, None)
        os.environ[jirabackend.AGENT_TOKEN_ENV] = "fake-agent-token"
        os.environ[jirabackend.AGENT_EMAIL_ENV] = "agent@example.com"
        os.environ[jirabackend.CLOUD_ID_ENV] = "cloud-test"

    def test_gateway_url_keeps_rest_api_2(self):
        urls = []

        def transport(method, url, body):
            urls.append(url)
            return 200, {"accountId": "acc-agent"}
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake-agent-token", transport)
        client.request("GET", "/myself")
        self.assertEqual(urls, ["https://api.atlassian.com/ex/jira/cloud-test"
                                "/rest/api/2/myself"])

    def test_agent_token_selects_the_gateway(self):
        self._gateway_env()
        settings, gaps = jirabackend._resolve_settings(self.root, RUNTIME)
        self.assertEqual(gaps, [])
        self.assertEqual(settings["email"], "agent@example.com")
        client = jirabackend.client_for(settings, transport=self.fake)
        self.assertEqual(client.base, "https://api.atlassian.com/ex/jira/"
                                      "cloud-test/rest/api/2")
        self.assertEqual(client.token_env, jirabackend.AGENT_TOKEN_ENV)
        # the site stays binding config, never read from TK_ATLASSIAN_SITE
        self.assertEqual(settings["site"], "example.atlassian.net")

    def test_preflight_captures_the_agent_account_id(self):
        def transport(method, url, body):
            if url.endswith("/myself"):
                return 200, {"accountId": "acc-agent", "displayName": "Agent"}
            return self.fake(method, url, body)
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake-agent-token", transport)
        checked = jirabackend.preflight(client, "TKS")
        self.assertEqual(checked["account_id"], "acc-agent")

    def test_agent_token_without_cloud_id_refuses_by_name(self):
        self._gateway_env()
        os.environ.pop(jirabackend.CLOUD_ID_ENV)
        result = plansync.sync(self.root, runtime=RUNTIME)
        self.assertTrue(result.get("blocked"))
        self.assertIn(jirabackend.CLOUD_ID_ENV, result["reason"])
        self.assertIn("never the site URL", result["reason"])
        self.assertEqual(self.fake.calls, [])

    def test_confluence_token_without_cloud_id_refuses_by_name(self):
        os.environ[jirabackend.AGENT_CONFLUENCE_TOKEN_ENV] = "fake-conf-token"
        settings, gaps = jirabackend._resolve_settings(self.root, RUNTIME)
        self.assertTrue(any(jirabackend.CLOUD_ID_ENV in g and
                            jirabackend.AGENT_CONFLUENCE_TOKEN_ENV in g
                            for g in gaps), gaps)

    def test_agent_email_missing_is_named(self):
        self._gateway_env()
        os.environ.pop(jirabackend.AGENT_EMAIL_ENV)
        _, gaps = jirabackend._resolve_settings(self.root, RUNTIME)
        self.assertTrue(any(jirabackend.AGENT_EMAIL_ENV in g for g in gaps))

    def test_legacy_path_without_the_agent_token(self):
        settings, gaps = jirabackend._resolve_settings(self.root, RUNTIME)
        self.assertEqual(gaps, [])
        self.assertNotIn("cloud_id", settings)
        client = jirabackend.client_for(settings)
        self.assertEqual(client.base, "https://example.atlassian.net/rest/api/2")
        self.assertEqual(client.token_env, jirabackend.TOKEN_ENV)

    def test_sync_does_not_fall_back_to_the_site_variable(self):
        self._gateway_env()
        os.environ[jirabackend.SITE_ENV] = "example.atlassian.net"
        (self.root / ".tk-studio" / "config.yaml").write_text(
            "planning:\n  backend: jira\n", encoding="utf-8", newline="\n")
        result = plansync.sync(self.root, runtime=RUNTIME)
        self.assertTrue(result.get("blocked"))
        self.assertIn("planning.jira.site", result["reason"])

    def _raise_for(self, status, body, method="GET", scope=None):
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake-agent-token",
            lambda m, u, b: (status, body))
        with self.assertRaises(jirabackend.JiraError) as caught:
            client.request(method, "/project", {} if method == "POST" else None,
                           scope=scope)
        return str(caught.exception)

    def test_401_names_token_email_expiry_and_toggle_never_scope(self):
        reason = self._raise_for(401, {"errorMessages": ["Unauthorized"]})
        for phrase in ("401", jirabackend.AGENT_TOKEN_ENV,
                       jirabackend.AGENT_EMAIL_ENV, "expiry", "org-admin"):
            self.assertIn(phrase, reason)
        self.assertNotIn("scope", reason.lower())

    def test_proxy_403_is_the_network_approval_step(self):
        reason = self._raise_for(403, "Approval required for api.atlassian.com:443")
        self.assertIn("network approval", reason)
        self.assertIn("api.atlassian.com:443", reason)
        self.assertNotIn("scope", reason.lower())

    def test_other_403_names_the_scope_and_asks_for_a_new_token(self):
        reason = self._raise_for(403, {"errorMessages": ["forbidden"]},
                                 method="POST",
                                 scope=jirabackend.SCOPE_PROJECT)
        self.assertIn("manage:jira-project", reason)
        self.assertIn("new scoped token", reason)


class OwnerSeatTests(JiraTestCase):
    """Story 31.6: the owner seat's client, read only by `tk-studio-track
    reply` on the host — its env names, its gaps by name, and a 401 that
    names the owner's variables, never the agent's."""

    ENV_KEYS = (*JiraTestCase.ENV_KEYS, *jirabackend.OWNER_ENV_NAMES)

    def _owner_env(self):
        os.environ[jirabackend.OWNER_EMAIL_ENV] = "owner@example.com"
        os.environ[jirabackend.OWNER_TOKEN_ENV] = "fake-owner-token"
        os.environ[jirabackend.CLOUD_ID_ENV] = "cloud-test"

    def test_the_owner_names_sit_outside_the_sandbox_prefix(self):
        self.assertEqual(jirabackend.OWNER_ENV_NAMES,
                         ("TK_STUDIO_ATLASSIAN_OWNER_EMAIL",
                          "TK_STUDIO_ATLASSIAN_OWNER_TOKEN",
                          "TK_ATLASSIAN_CLOUD_ID"))
        for name in (jirabackend.OWNER_EMAIL_ENV, jirabackend.OWNER_TOKEN_ENV):
            self.assertFalse(name.startswith("TK_ATLASSIAN_"))
            self.assertNotIn(name, jirabackend.AGENT_ENV_NAMES)

    def test_each_absent_variable_is_a_named_gap(self):
        for name in jirabackend.OWNER_ENV_NAMES:
            os.environ.pop(name, None)
        client, gaps = jirabackend.owner_client(self.fake)
        self.assertIsNone(client)
        self.assertEqual(len(gaps), 3)
        for name, gap in zip(jirabackend.OWNER_ENV_NAMES, gaps):
            self.assertTrue(gap.startswith(name + " is not set"), gap)
        self._owner_env()
        for name in jirabackend.OWNER_ENV_NAMES:
            with self.subTest(name=name):
                saved = os.environ.pop(name)
                try:
                    client, gaps = jirabackend.owner_client(self.fake)
                finally:
                    os.environ[name] = saved
                self.assertIsNone(client)
                self.assertEqual(len(gaps), 1)
                self.assertIn(name, gaps[0])
        self.assertEqual(self.fake.calls, [])

    def test_the_agent_seat_never_stands_in(self):
        os.environ[jirabackend.AGENT_TOKEN_ENV] = "fake-agent-token"
        os.environ[jirabackend.AGENT_EMAIL_ENV] = "agent@example.com"
        os.environ[jirabackend.CLOUD_ID_ENV] = "cloud-test"
        client, gaps = jirabackend.owner_client(self.fake)
        self.assertIsNone(client)
        self.assertEqual(len(gaps), 2)

    def test_the_owner_client_is_the_gateway_with_the_owner_names(self):
        self._owner_env()
        urls = []

        def transport(method, url, body):
            urls.append(url)
            return 200, {"accountId": "acc-owner"}
        client, gaps = jirabackend.owner_client(transport,
                                                site="example.atlassian.net")
        self.assertEqual(gaps, [])
        self.assertEqual(client.base, "https://api.atlassian.com/ex/jira/"
                                      "cloud-test/rest/api/2")
        self.assertEqual(client.token_env, jirabackend.OWNER_TOKEN_ENV)
        self.assertEqual(client.email_env, jirabackend.OWNER_EMAIL_ENV)
        auth = base64.b64decode(client._headers["Authorization"].split()[1])
        self.assertEqual(auth.decode(), "owner@example.com:fake-owner-token")
        client.request("GET", "/myself")
        self.assertEqual(urls, ["https://api.atlassian.com/ex/jira/cloud-test"
                                "/rest/api/2/myself"])

    def test_a_401_names_the_owner_variables(self):
        self._owner_env()
        client, _ = jirabackend.owner_client(
            lambda m, u, b: (401, {"errorMessages": ["Unauthorized"]}),
            site="example.atlassian.net")
        with self.assertRaises(jirabackend.JiraError) as caught:
            client.request("POST", "/issue/TKS-1/comment", {"body": "x"})
        reason = str(caught.exception)
        self.assertIn(jirabackend.OWNER_TOKEN_ENV, reason)
        self.assertIn(jirabackend.OWNER_EMAIL_ENV, reason)
        self.assertNotIn(jirabackend.AGENT_TOKEN_ENV, reason)
        self.assertIn("example.atlassian.net", reason)


class DesignPagesLinkTests(JiraTestCase):
    """Story 31.3: the page index publish writes becomes the last line of
    every epic's and story's description, inside the content hash."""

    INDEX = {"pages": [
        {"category": "brief", "source": "a/brief.md", "title": "Brief: b1",
         "page_id": "601", "webui": "/spaces/TKS/pages/601"},
        {"category": "decisions", "source": "d/decisions.md",
         "title": "Decisions: decisions", "page_id": "602",
         "webui": "/spaces/TKS/pages/602"}]}
    LINE = ("Design pages: [Brief: b1|https://example.atlassian.net/wiki"
            "/spaces/TKS/pages/601], [Decisions: decisions|https://"
            "example.atlassian.net/wiki/spaces/TKS/pages/602]")

    def _write_index(self):
        (self.root / ".tk-studio" / "confluence-pages.json").write_text(
            json.dumps(self.INDEX), encoding="utf-8")

    def _hashes(self):
        out = {}
        for path in sorted(plansync.plan_dir(self.root).glob("*-*.md")):
            front, _ = interchange.parse_entity(path)
            out[front["id"]] = front["external"]["jira"]["content_hash"]
        return out

    def test_without_the_index_descriptions_and_hashes_are_unchanged(self):
        self._project()
        for issue in self.fake.issues.values():
            self.assertNotIn("Design pages", issue["fields"]["description"])
        for entity_id in ("EP-001", "ST-001"):
            _, front, body = self._canonical(entity_id)
            self.assertEqual(
                front["external"]["jira"]["content_hash"],
                jirabackend._content_hash(
                    front["title"], ",".join(jirabackend._labels(front)),
                    front.get("parent") or "", body))

    def test_index_adds_the_line_and_moves_each_hash_once(self):
        self._project()
        before = self._hashes()
        self._write_index()
        result = self._project()
        self.assertEqual(sorted(u["id"] for u in result["promote"]["updated"]),
                         sorted(before))
        after = self._hashes()
        for entity_id in before:
            self.assertNotEqual(before[entity_id], after[entity_id])
        for issue in self.fake.issues.values():
            self.assertTrue(issue["fields"]["description"].endswith(
                "\n\n" + self.LINE), issue["fields"]["description"])
        # AD-5: the appended line never reads back as a remote edit — a
        # conflict would also land in skip_ids and produce no update
        self.assertEqual(result["pull_back"]["conflicts"], [])
        self.assertEqual(result["pull_back"]["applied"], [])
        bodies = {entity_id: self._canonical(entity_id)[1:]
                  for entity_id in before}
        self.fake.calls.clear()
        again = self._project()
        self.assertEqual(again["pull_back"]["conflicts"], [])
        self.assertEqual(again["pull_back"]["applied"], [])
        self.assertEqual(again["conflicts"], [])
        self.assertEqual(again["promote"]["updated"], [])
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual(self._hashes(), after)
        for entity_id, (front, body) in bodies.items():
            self.assertEqual(self._canonical(entity_id)[1:], (front, body))
            self.assertNotIn("Design pages", body)

    def test_first_promote_with_the_index_carries_the_line(self):
        self._write_index()
        self._project()
        epic = self.fake.issues[self._jira_key("EP-001")]
        self.assertTrue(epic["fields"]["description"].endswith(self.LINE))

    def test_line_reads_the_index_in_order(self):
        self._write_index()
        self.assertEqual(jirabackend.design_pages_line(
            self.root, "https://example.atlassian.net/"), self.LINE)
        self.assertIsNone(jirabackend.design_pages_line(self.root, None))
        (self.root / ".tk-studio" / "confluence-pages.json").write_text(
            "not json", encoding="utf-8")
        self.assertIsNone(jirabackend.design_pages_line(
            self.root, "example.atlassian.net"))


class ProxyConnectRefusalTests(unittest.TestCase):
    """Story 31.2 review 5: a refused HTTPS CONNECT reaches urllib as a
    URLError, not an HTTP 403 — it is still the network approval step."""

    ERROR = urllib.error.URLError(
        "Tunnel connection failed: 403 Approval required for "
        "api.atlassian.com:443")

    def test_jira_connect_refusal_is_the_network_approval_step(self):
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake-agent-token")
        with mock.patch("urllib.request.urlopen", side_effect=self.ERROR):
            with self.assertRaises(jirabackend.JiraError) as caught:
                client.request("GET", "/myself")
        reason = str(caught.exception)
        self.assertIn("network approval", reason)
        self.assertIn("api.atlassian.com:443", reason)
        self.assertNotIn("cannot reach", reason)

    def test_confluence_connect_refusal_is_the_network_approval_step(self):
        import confluence
        client = confluence.ConfluenceClient(
            "cloud-test", "agent@example.com", "fake-confluence-token")
        with mock.patch("urllib.request.urlopen", side_effect=self.ERROR):
            with self.assertRaises(confluence.ConfluenceError) as caught:
                client.request("GET", "/spaces")
        self.assertIn("network approval", str(caught.exception))
        self.assertNotIn("cannot reach", str(caught.exception))

    def test_other_connect_failure_still_cannot_reach(self):
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake-agent-token")
        with mock.patch("urllib.request.urlopen",
                        side_effect=urllib.error.URLError("Name or service not known")):
            with self.assertRaises(jirabackend.JiraError) as caught:
                client.request("GET", "/myself")
        self.assertIn("cannot reach", str(caught.exception))


class BlockWriteTests(unittest.TestCase):
    """Story 31.5: `transition_to_name` and `add_comment`, the two writes
    `tk-studio-track block` makes. Both request shapes are ungraded on the
    live site, so they are pinned here."""

    def setUp(self):
        self.calls: list[tuple[str, str, object]] = []
        self.transitions = [
            {"id": "11", "to": {"name": "In Progress",
                                "statusCategory": {"key": "indeterminate"}}},
            {"id": "21", "to": {"name": jirabackend.RESOLVED_STATUS,
                                "statusCategory": {"key": "indeterminate"}}},
            {"id": "31", "to": {"name": jirabackend.BLOCKED_STATUS,
                                "statusCategory": {"key": "indeterminate"}}}]

        def transport(method, url, body):
            path = url.split(jirabackend.API_PREFIX, 1)[1]
            self.calls.append((method, path, body))
            if method == "GET" and path == "/issue/TKS-1/transitions":
                return 200, {"transitions": self.transitions}
            if method == "POST" and path == "/issue/TKS-1/transitions":
                return 204, None
            if method == "POST" and path == "/issue/TKS-1/comment":
                return 201, {"id": "10001", "body": body["body"],
                             "created": "2026-10-24T12:00:00.000+0000"}
            return 400, {"errorMessages": ["unhandled"]}

        self.client = jirabackend.JiraClient("example.atlassian.net",
                                             "a@example.com", "fake-token",
                                             transport=transport)

    def test_transition_by_name_never_by_category(self):
        notes: list[str] = []
        got = jirabackend.transition_to_name(
            self.client, "TKS-1", jirabackend.BLOCKED_STATUS, notes, "ST-001")
        self.assertEqual(got, jirabackend.BLOCKED_STATUS)
        self.assertEqual(notes, [])
        # the two setup statuses share a category: the name picks id 31
        self.assertEqual(self.calls[-1], ("POST", "/issue/TKS-1/transitions",
                                          {"transition": {"id": "31"}}))

    def test_no_transition_reaching_the_name_refuses_by_name(self):
        self.transitions.pop()
        notes: list[str] = []
        got = jirabackend.transition_to_name(
            self.client, "TKS-1", jirabackend.BLOCKED_STATUS, notes, "ST-001")
        self.assertIsNone(got)
        self.assertEqual(len(notes), 1)
        self.assertIn("'Blocked - Awaiting User'", notes[0])
        self.assertIn("TKS-1", notes[0])
        self.assertFalse([c for c in self.calls if c[0] == "POST"])

    def test_add_comment_posts_a_v2_plain_body_with_the_wiki_mention(self):
        body = "[~accountid:acc-owner] Blocked: x\nResolves when: y"
        created = jirabackend.add_comment(self.client, "TKS-1", body)
        self.assertEqual(self.calls, [("POST", "/issue/TKS-1/comment",
                                       {"body": body})])
        self.assertEqual(created["id"], "10001")

    def test_add_comment_refused_raises(self):
        with self.assertRaises(jirabackend.JiraError) as caught:
            jirabackend.add_comment(self.client, "TKS-9", "x")
        self.assertIn("POST /issue/TKS-9/comment returned 400",
                      str(caught.exception))


class ChangelogReadTests(unittest.TestCase):
    """Story 31.7: `issue_changelog` (paged, read-only) and the pure
    `last_transition_into`, the owner check of `tk-studio-track validate`.
    The REST shape is ungraded on the live site and pinned in FakeJira."""

    RESOLVED = jirabackend.RESOLVED_STATUS

    def setUp(self):
        self.fake = FakeJira()
        self.client = jirabackend.JiraClient("example.atlassian.net",
                                             "a@example.com", "fake-token",
                                             transport=self.fake)

    def test_every_page_is_read_and_nothing_is_written(self):
        for n in range(5):
            self.fake.history("TKS-1", str(n), "acc-x", "In Progress",
                              f"2026-10-24T10:0{n}:00.000+0000")
        got = jirabackend.issue_changelog(self.client, "TKS-1")
        self.assertEqual([h["id"] for h in got], ["0", "1", "2", "3", "4"])
        self.assertEqual(self.fake.calls,
                         [("GET", "/issue/TKS-1/changelog")] * 3)
        self.assertEqual(self.fake.writes(), [])

    def test_a_refused_page_raises(self):
        def transport(method, url, body):
            return 404, {"errorMessages": ["nope"]}
        client = jirabackend.JiraClient("example.atlassian.net",
                                        "a@example.com", "fake-token",
                                        transport=transport)
        with self.assertRaises(jirabackend.JiraError) as caught:
            jirabackend.issue_changelog(client, "TKS-9")
        self.assertIn("GET /issue/TKS-9/changelog returned 404",
                      str(caught.exception))

    def test_the_newest_transition_into_the_name_wins(self):
        f = self.fake
        f.history("K-1", "1", "acc-owner", self.RESOLVED,
                  "2026-10-24T10:00:00.000+0000")
        f.history("K-1", "2", "acc-agent", jirabackend.BLOCKED_STATUS,
                  "2026-10-24T10:05:00.000+0000")
        f.history("K-1", "3", "acc-agent", self.RESOLVED,
                  "2026-10-24T10:10:00.000+0000")
        f.history("K-1", "4", "acc-owner", "Block Resolved-ish",
                  "2026-10-24T10:20:00.000+0000")
        f.history("K-1", "5", "acc-owner", self.RESOLVED,
                  "2026-10-24T10:30:00.000+0000", field="resolution")
        got = jirabackend.last_transition_into(f.changelogs["K-1"],
                                               self.RESOLVED)
        # an older owner transition never validates a later one; only a
        # `status` item by its exact name counts
        self.assertEqual(got, {"id": "3",
                               "created": "2026-10-24T10:10:00.000+0000",
                               "account_id": "acc-agent"})

    def test_an_absent_or_empty_author_is_an_empty_account(self):
        f = self.fake
        f.history("K-2", "1", None, self.RESOLVED,
                  "2026-10-24T10:00:00.000+0000")
        self.assertEqual(jirabackend.last_transition_into(
            f.changelogs["K-2"], self.RESOLVED)["account_id"], "")
        f.history("K-2", "2", "", self.RESOLVED,
                  "2026-10-24T10:01:00.000+0000")
        got = jirabackend.last_transition_into(f.changelogs["K-2"],
                                               self.RESOLVED)
        self.assertEqual((got["id"], got["account_id"]), ("2", ""))

    def test_no_transition_into_the_name_is_none(self):
        self.fake.history("K-3", "1", "acc-owner", "Done",
                          "2026-10-24T10:00:00.000+0000")
        self.assertIsNone(jirabackend.last_transition_into(
            self.fake.changelogs["K-3"], self.RESOLVED))
        self.assertIsNone(jirabackend.last_transition_into([], self.RESOLVED))

class DroppedStatusPickTests(JiraTestCase):
    """Hole 100: the owner's `DNI` status sits in the Done category (DW-95)
    and, as a global transition, came first in the transition list, so a
    promote into `done` landed in `DNI`. The picker skips the dropped
    status names whatever their position."""

    def test_done_never_promotes_into_a_dropped_status(self):
        self.fake.STATUSES = {"To Do": "new", "In Progress": "indeterminate",
                              "DNI": "done", "Done": "done"}
        self._project()
        self._set_canonical("ST-001", status="done")
        self._project()
        key = self._jira_key("ST-001")
        self.assertEqual(self.fake.issues[key]["status"], "Done")
        _, front, _ = self._canonical("ST-001")
        self.assertEqual(front["external"]["jira"]["status"], "Done")
        self.assertEqual(front["external"]["jira"]["canonical_status"], "done")

    def test_only_a_dropped_route_into_the_category_is_a_note_not_a_move(self):
        self.fake.STATUSES = {"To Do": "new", "In Progress": "indeterminate",
                              "DNI": "done"}
        self._project()
        self._set_canonical("ST-001", status="done")
        result = self._project()
        key = self._jira_key("ST-001")
        self.assertEqual(self.fake.issues[key]["status"], "To Do")
        self.assertIn("dropped status 'DNI'", json.dumps(result))

