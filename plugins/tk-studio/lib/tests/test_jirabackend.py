"""Tests for the Jira Cloud backend adapter (ST-8.1 acceptance criteria).

A fake transport stands in for Atlassian Cloud — the adapter's transport
seam exists exactly so these tests prove the AD-5/AD-7 semantics offline:
default-mapping promote, status-class pull-back with echo suppression and
both-changed conflicts identical to the local projection, category-based
round-trip stability, and the named-blocked auth preflight (never a
silent 401).
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
import unittest
import urllib.parse
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

    def __call__(self, method, url, body):
        path, _, query = url.split(jirabackend.API_PREFIX, 1)[1].partition("?")
        self.calls.append((method, path))
        if self.fail_auth:
            return 401, {"errorMessages": ["Unauthorized"]}
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
    ENV_KEYS = ("TK_STUDIO_HOME", jirabackend.TOKEN_ENV, jirabackend.EMAIL_ENV)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._saved_env = {k: os.environ.get(k) for k in self.ENV_KEYS}
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


if __name__ == "__main__":
    unittest.main()
