"""Tests for tracking setup from the studio template (Story 31.2).

`plansync.setup` sequences jirabackend and confluence (AD-4) through the
agent seat's gateway tokens. A fake Atlassian REST stands in for both apps
behind the transport seam: no test makes a network call. Covered: the
template, the binding written, the idempotent re-run, every refusal (with no
call made), the 401 / proxy 403 / scope 403 split, the `partial` paths with
numbered owner steps, the owner accountId paths and the dry run.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import unittest
import urllib.parse
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import config as configlib  # noqa: E402
import confluence  # noqa: E402
import jirabackend  # noqa: E402
import miniyaml  # noqa: E402
import plansync  # noqa: E402
import registry  # noqa: E402

from test_jirabackend import FakeJira  # noqa: E402

CLOUD = "cloud-test"
SITE = "example.atlassian.net"
AGENT_ENV = {
    jirabackend.SITE_ENV: SITE,
    jirabackend.AGENT_EMAIL_ENV: "agent@example.com",
    jirabackend.AGENT_TOKEN_ENV: "fake-jira-token",
    jirabackend.AGENT_CONFLUENCE_TOKEN_ENV: "fake-confluence-token",
    jirabackend.CLOUD_ID_ENV: CLOUD,
}
JIRA_BASE = f"https://api.atlassian.com/ex/jira/{CLOUD}/rest/api/2"
CONF_BASE = f"https://api.atlassian.com/ex/confluence/{CLOUD}/wiki/api/v2"
FOLDER_TITLES = ["Brief", "GDD", "Scope of Work", "Decisions", "Records"]


class FakeAtlassian(FakeJira):
    """FakeJira plus the setup routes and the Confluence v2 routes. The
    create shapes are ungraded on the live site, so they are pinned here.
    Every list it serves is paged (`page_size`), as the live site pages.
    DW-107: each status has its category; the legacy `/workflow/search`
    spells transition types lowercase and carries no version, which only
    `/workflows/search` serves; `/workflows/update` refuses a lowercase
    type or a stale version, as the live site did."""

    CATEGORIES = {"To Do": "TODO", "Backlog": "TODO",
                  "Selected for Development": "TODO",
                  "Done": "DONE", "DNI": "DONE"}
    _CATEGORY_KEYS = {"TODO": "new", "IN_PROGRESS": "indeterminate",
                      "DONE": "done"}

    def __init__(self):
        super().__init__()
        self.users.append({"accountId": "acc-owner", "displayName": "Owner",
                           "emailAddress": "owner@example.com"})
        self.team_managed = False
        self.template_statuses = ["To Do", "In Progress", "Done"]
        self.project_issue_types = ["Epic", "Story", "Sub-task"]
        self.page_size = 50
        self.project = None          # the Jira project, once it exists
        self.project_body = None     # the POST /project body
        self.filter_body = None      # the POST /filter body
        self.statuses: list[dict] = []   # every status on the site
        self.in_use: set[str] = set()    # status ids the project's flow uses
        self.workflows: list[dict] = []
        self.update_bodies: list[dict] = []   # every POST /workflows/update
        self.filters: list[dict] = []
        self.spaces: dict[str, dict] = {}
        self.folders: dict[str, list[dict]] = {}
        self.force: dict[tuple[str, str], tuple[int, object]] = {}
        self.urls: list[str] = []
        self._ids = 0

    def _id(self, base: int) -> str:
        self._ids += 1
        return str(base + self._ids)

    def status(self, name):
        return next((e for e in self.statuses if e["name"] == name), None)

    def _new_status(self, name, project_scoped, category=None):
        scope = ({"type": "PROJECT", "project": {"id": self.project["id"]}}
                 if project_scoped else {"type": "GLOBAL"})
        entry = {"id": self._id(20000), "name": name,
                 "statusCategory": category
                 or self.CATEGORIES.get(name, "IN_PROGRESS"),
                 "scope": scope}
        self.statuses.append(entry)
        return entry

    @property
    def workflow(self):
        return next((w for w in self.workflows
                     if w["id"]["entityId"] == "wf-1"), None)

    # ---- the owner, working in the browser
    def add_project(self, key="TKSTUDIO"):
        self.project = {"id": "10000", "key": key,
                        "style": "next-gen" if self.team_managed else "classic",
                        "simplified": self.team_managed,
                        "issueTypes": [{"name": n}
                                       for n in self.project_issue_types]}
        ids = []
        for name in self.template_statuses:
            entry = (None if self.team_managed else self.status(name)) \
                or self._new_status(name, self.team_managed)
            ids.append(entry["id"])
        self.in_use |= set(ids)
        if not self.team_managed:
            self.workflows.append({
                "id": {"name": f"Software Simplified Workflow for Project {key}",
                       "entityId": "wf-1"},
                "version": {"versionNumber": 1, "id": "v1"},
                "statuses": [{"id": i} for i in ids],
                "transitions": [{"id": "11", "name": "Create", "from": [],
                                 "to": ids[0], "type": "INITIAL"}]})

    def add_status(self, name):
        """The owner's browser steps: the status lands on the project's
        workflow (GLOBAL on company-managed, PROJECT on team-managed)."""
        entry = self._new_status(name, self.team_managed)
        self.in_use.add(entry["id"])
        if self.workflow:
            self.workflow["statuses"].append({"id": entry["id"]})
        return entry

    def _page(self, values, q):
        start = int(q.get("startAt", 0))
        page = values[start:start + self.page_size]
        return {"values": page, "startAt": start,
                "isLast": start + len(page) >= len(values)}

    def __call__(self, method, url, body):
        self.urls.append(url)
        if "/ex/confluence/" in url:
            path, _, query = url.split(confluence.API_PREFIX, 1)[1].partition("?")
            self.calls.append((method, "confluence:" + path))
            forced = self.force.get((method, "confluence:" + path))
            return forced if forced else self._confluence(method, path, query, body)
        path, _, query = url.split(jirabackend.API_PREFIX, 1)[1].partition("?")
        forced = self.force.get((method, path))
        if forced:
            self.calls.append((method, path))
            return forced
        if self.fail_auth:
            self.calls.append((method, path))
            return 401, {"errorMessages": ["Unauthorized"]}
        handled = self._jira(method, path, query, body)
        if handled is not None:
            self.calls.append((method, path))
            return handled
        return super().__call__(method, url, body)

    def _jira(self, method, path, query, body):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        if method == "GET" and path == "/myself":
            return 200, {"accountId": "acc-agent", "displayName": "Agent",
                         "emailAddress": "agent@example.com"}
        m = re.match(r"^/project/([^/]+)/statuses$", path)
        if method == "GET" and m:
            if not self.project or m.group(1) != self.project["key"]:
                return 404, {"errorMessages": ["No project"]}
            used = [{"id": e["id"], "name": e["name"],
                     "statusCategory": {
                         "key": self._CATEGORY_KEYS[e["statusCategory"]]}}
                    for e in self.statuses if e["id"] in self.in_use]
            return 200, [{"name": "Story", "statuses": used},
                         {"name": "Epic", "statuses": used}]
        if method == "GET" and path.startswith("/project/"):
            if self.project and path.rsplit("/", 1)[1] == self.project["key"]:
                return 200, self.project
            return 404, {"errorMessages": ["No project"]}
        if method == "POST" and path == "/project":
            self.project_body = body
            self.add_project(body["key"])
            return 201, {"id": self.project["id"], "key": body["key"]}
        if method == "GET" and path == "/statuses/search":
            if "projectId" in q:
                values = [e for e in self.statuses
                          if e["scope"]["type"] == "PROJECT"
                          and e["scope"]["project"]["id"] == q["projectId"]]
            else:
                values = list(self.statuses)
            return 200, self._page(values, q)
        if method == "POST" and path == "/statuses":
            assert body["scope"] == {"type": "GLOBAL"}, body["scope"]
            return 200, [self._new_status(e["name"], False,
                                          e["statusCategory"])
                         for e in body["statuses"]]
        if method == "GET" and path == "/workflow/search":
            # the legacy shape: lowercase types, no version
            legacy = [{"id": w["id"], "statuses": w["statuses"],
                       "transitions": [
                           {**t, "type": t["type"].lower()} if t.get("type")
                           else t for t in w["transitions"]]}
                      for w in self.workflows
                      if q.get("queryString", "") in w["id"]["name"]]
            return 200, self._page(legacy, q)
        if method == "GET" and path == "/workflows/search":
            return 200, self._page([
                {"id": w["id"]["entityId"], "name": w["id"]["name"],
                 "version": w["version"]} for w in self.workflows
                if q.get("queryString", "") in w["id"]["name"]], q)
        if method == "POST" and path == "/workflows/update":
            self.update_bodies.append(body)
            flow = body["workflows"][0]
            target = next(w for w in self.workflows
                          if w["id"]["entityId"] == flow["id"])
            if flow.get("version") != target["version"]:
                return 400, {"errorMessages": ["version is required"]}
            if any(t.get("type") != str(t.get("type")).upper()
                   for t in flow["transitions"]):
                return 400, {"errorMessages": ["bad transition type"]}
            target["version"] = {
                "versionNumber": target["version"]["versionNumber"] + 1,
                "id": f"v{target['version']['versionNumber'] + 1}"}
            target["statuses"] = [{"id": s["statusReference"]}
                                  for s in flow["statuses"]]
            target["transitions"] = flow["transitions"]
            if flow["id"] == "wf-1":
                self.in_use |= {s["statusReference"] for s in flow["statuses"]}
            return 200, {}
        if method == "GET" and path == "/filter/search":
            return 200, self._page([f for f in self.filters
                                    if q.get("filterName", "") in f["name"]], q)
        if method == "POST" and path == "/filter":
            self.filter_body = body
            entry = {"id": self._id(30000), "name": body["name"],
                     "jql": body["jql"], "owner": {"accountId": "acc-agent"}}
            self.filters.append(entry)
            return 200, entry
        return None

    def _cursor_page(self, path, values, q):
        start = int(q.get("cursor", 0))
        page = values[start:start + self.page_size]
        data = {"results": page, "_links": {}}
        if start + len(page) < len(values):
            data["_links"]["next"] = (f"{confluence.API_PREFIX}{path}"
                                      f"?cursor={start + len(page)}")
        return 200, data

    def _confluence(self, method, path, query, body):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        if method == "GET" and path == "/spaces":
            space = self.spaces.get(q.get("keys"))
            return self._cursor_page(path, [space] if space else [], q)
        if method == "POST" and path == "/spaces":
            space = {"id": self._id(40000), "key": body["key"],
                     "name": body["name"]}
            self.spaces[body["key"]] = space
            self.folders[space["id"]] = []
            return 200, space
        m = re.match(r"^/spaces/([^/]+)/direct-children$", path)
        if method == "GET" and m:
            return self._cursor_page(
                path, [{"id": "home", "type": "page", "title": "Overview"}]
                + self.folders.get(m.group(1), []), q)
        if method == "POST" and path == "/folders":
            entry = {"id": self._id(50000), "type": "folder",
                     "title": body["title"]}
            self.folders[body["spaceId"]].append(entry)
            return 200, entry
        return 400, {"message": f"unhandled {method} {path}"}

    def writes(self):
        return [c for c in self.calls if c[0] in ("POST", "PUT")]


class SetupTestCase(unittest.TestCase):
    ENV_KEYS = ("TK_STUDIO_HOME", jirabackend.TOKEN_ENV, jirabackend.EMAIL_ENV,
                *jirabackend.AGENT_ENV_NAMES)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._saved_env = {k: os.environ.get(k) for k in self.ENV_KEYS}
        for key in self.ENV_KEYS:
            os.environ.pop(key, None)
        os.environ["TK_STUDIO_HOME"] = str(Path(self._tmp.name) / "store")
        os.environ.update(AGENT_ENV)
        self.root = Path(self._tmp.name) / "proj"
        self.root.mkdir()
        configlib.standup_project_config(self.root, project_id="tk-studio")
        registry.register(self.root, writer="onboard")
        self.config = self.root / ".tk-studio" / "config.yaml"
        self.fake = FakeAtlassian()

    def tearDown(self):
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def _setup(self, **kwargs):
        return plansync.setup(self.root, transport=self.fake, **kwargs)

    def _binding(self) -> dict:
        return miniyaml.load(self.config)["planning"]

    def assert_block_last(self, result, status):
        self.assertEqual(list(result)[-4:], list(plansync.SETUP_BLOCK_KEYS))
        self.assertEqual(result["status"], status)
        self.assertEqual(result["intent"], "tk-studio-plan-sync")


class TemplateTests(SetupTestCase):
    def test_project_key_derivation(self):
        self.assertEqual(jirabackend.project_key_for("tk-studio"), "TKSTUDIO")
        self.assertEqual(jirabackend.project_key_for("9lives-app-extra-long"),
                         "LIVESAPPEX")
        self.assertIsNone(jirabackend.project_key_for("123-456"))

    def test_first_setup_creates_the_template_and_writes_the_binding(self):
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "complete")
        self.assertIsNone(result["reason"])
        self.assertEqual(result["owner_steps"], [])
        self.assertEqual(result["project_key"], "TKSTUDIO")
        # the project: company-managed software, the owner leads it
        body = self.fake.project_body
        self.assertEqual(body["key"], "TKSTUDIO")
        self.assertEqual(body["projectTypeKey"], "software")
        self.assertEqual(body["projectTemplateKey"],
                         jirabackend.PROJECT_TEMPLATE)
        self.assertEqual(body["leadAccountId"], "acc-owner")
        self.assertIn("issue type Epic", result["found"])
        self.assertIn("issue type Story", result["found"])
        # the two statuses, DNI (DW-95) and their transitions
        self.assertEqual(sorted(e["name"] for e in self.fake.statuses),
                         sorted(jirabackend.TEMPLATE_STATUSES + ("DNI",)))
        for name in ("To Do", "In Progress", "Done"):
            self.assertIn(f"status {name}", result["found"])
        blocked = self.fake.status("Blocked - Awaiting User")["id"]
        resolved = self.fake.status("Block Resolved")["id"]
        self.assertTrue(jirabackend.has_resolution_transition(
            self.fake.workflow, blocked, resolved))
        # the filter, JQL verbatim, shared with the project
        self.assertEqual(self.fake.filter_body["sharePermissions"],
                         [{"type": "project", "project": {"id": "10000"}}])
        self.assertEqual(self.fake.filters[0]["name"], "Needs you")
        self.assertEqual(self.fake.filters[0]["jql"],
                         'status = "Blocked - Awaiting User" '
                         'ORDER BY priority DESC, updated ASC')
        # the space and its five folders
        space = self.fake.spaces["TKSTUDIO"]
        self.assertEqual([f["title"] for f in self.fake.folders[space["id"]]],
                         FOLDER_TITLES)
        for item in ("Jira project TKSTUDIO", "status Blocked - Awaiting User",
                     "status Block Resolved",
                     "transition Blocked - Awaiting User -> Block Resolved",
                     "filter Needs you", "Confluence space TKSTUDIO",
                     *(f"folder {t}" for t in FOLDER_TITLES)):
            self.assertIn(item, result["created"])
        # the binding (Settled shape 1)
        self.assertEqual(result["written"], [".tk-studio/config.yaml"])
        self.assertEqual(result["artifacts"], [".tk-studio/config.yaml"])
        binding = self._binding()
        self.assertEqual(binding["jira"], {
            "site": SITE, "project_key": "TKSTUDIO", "project_id": "10000",
            "filter_id": self.fake.filters[0]["id"],
            "owner_account_id": "acc-owner", "agent_account_id": "acc-agent"})
        folders = {f["title"]: f["id"] for f in self.fake.folders[space["id"]]}
        self.assertEqual(binding["confluence"], {
            "space_key": "TKSTUDIO", "space_id": space["id"],
            "folders": {"brief": folders["Brief"], "gdd": folders["GDD"],
                        "scope-of-work": folders["Scope of Work"],
                        "decisions": folders["Decisions"],
                        "records": folders["Records"]}})
        # the tracked template's comments survive the text edit
        self.assertIn("# tk-studio project configuration",
                      self.config.read_text(encoding="utf-8"))
        # every call went through the gateway, never the site URL
        for url in self.fake.urls:
            self.assertTrue(url.startswith((JIRA_BASE, CONF_BASE)), url)
            self.assertNotIn(SITE, url)

    def test_rerun_is_idempotent_and_names_what_it_found(self):
        self._setup(owner_account_id="acc-owner")
        before = self.config.read_text(encoding="utf-8")
        writes_before = len(self.fake.writes())
        result = self._setup()
        self.assert_block_last(result, "complete")
        self.assertEqual(result["created"], [])
        self.assertEqual(len(self.fake.writes()), writes_before)
        for item in ("Jira project TKSTUDIO", "status Blocked - Awaiting User",
                     "status Block Resolved",
                     "transition Blocked - Awaiting User -> Block Resolved",
                     "filter Needs you", "Confluence space TKSTUDIO",
                     "owner seat accountId (recorded)",
                     *(f"folder {t}" for t in FOLDER_TITLES)):
            self.assertIn(item, result["found"])
        self.assertEqual(result["written"], [])
        self.assertEqual(self.config.read_text(encoding="utf-8"), before)

    def test_binding_edit_keeps_existing_planning_keys(self):
        self.config.write_text(
            self.config.read_text(encoding="utf-8")
            + "\nplanning:\n  backend: jira  # chosen by hand\n  jira:\n"
              "    site: example.atlassian.net\n    email: tim@example.com\n",
            encoding="utf-8", newline="\n")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "complete")
        text = self.config.read_text(encoding="utf-8")
        self.assertIn("  backend: jira  # chosen by hand", text)
        self.assertIn("    site: example.atlassian.net\n", text)
        binding = self._binding()
        self.assertEqual(binding["jira"]["email"], "tim@example.com")
        self.assertEqual(binding["jira"]["project_key"], "TKSTUDIO")

    def test_dry_run_writes_nothing(self):
        before = self.config.read_text(encoding="utf-8")
        result = self._setup(dry_run=True, owner_account_id="acc-owner")
        self.assertTrue(result["dry_run"])
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual(result["written"], [])
        self.assertEqual(self.config.read_text(encoding="utf-8"), before)
        self.assertEqual(result["created"], [])
        self.assertIn("Jira project TKSTUDIO", result["would_create"])
        self.assertIn("Confluence space TKSTUDIO", result["would_create"])
        # a dry run that would create anything is never `complete`
        self.assert_block_last(result, "partial")
        self.assertIn("would create Jira project TKSTUDIO", result["reason"])
        self.assertEqual(result["owner_steps"], [])

    def test_dry_run_after_setup_finds_everything_and_is_complete(self):
        self._setup(owner_account_id="acc-owner")
        writes = len(self.fake.writes())
        result = self._setup(dry_run=True)
        self.assert_block_last(result, "complete")
        self.assertEqual(result["would_create"], [])
        self.assertEqual(len(self.fake.writes()), writes)


class PartialTests(SetupTestCase):
    def _assert_numbered(self, result):
        self.assert_block_last(result, "partial")
        self.assertTrue(result["owner_steps"])
        for i, step in enumerate(result["owner_steps"], 1):
            self.assertTrue(step.startswith(f"{i}. "), step)
            self.assertIn(step, result["reason"])
        self.assertIn("Rerun", result["owner_steps"][-1])

    def test_team_managed_prints_browser_steps_and_verifies_by_search(self):
        self.fake.team_managed = True
        result = self._setup(owner_account_id="acc-owner")
        self._assert_numbered(result)
        steps = " ".join(result["owner_steps"])
        self.assertIn("Project settings > Issue types > Story", steps)
        self.assertIn("Blocked - Awaiting User", steps)
        self.assertIn("Block Resolved", steps)
        self.assertNotIn(("POST", "/statuses"), self.fake.calls)
        self.assertIn(("GET", "/statuses/search"), self.fake.calls)
        # the owner follows the steps; the rerun verifies them by search
        self.fake.add_status("Blocked - Awaiting User")
        self.fake.add_status("Block Resolved")
        self.fake.add_status("DNI")
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertIn("status Block Resolved", again["found"])
        self.assertIn("status DNI", again["found"])

    def test_refused_status_create_prints_company_managed_steps(self):
        self.fake.force[("POST", "/statuses")] = (400, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self._assert_numbered(result)
        steps = " ".join(result["owner_steps"])
        self.assertIn("Settings > Work items > Workflows", steps)
        self.assertIn("Add a transition from `Blocked - Awaiting User` to "
                      "`Block Resolved`", steps)
        self.assertNotIn(("POST", "/workflows/update"), self.fake.calls)

    def test_refused_transition_prints_company_managed_steps(self):
        self.fake.force[("POST", "/workflows/update")] = (400, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self._assert_numbered(result)
        self.assertIn("Settings > Work items > Workflows",
                      " ".join(result["owner_steps"]))

    def test_refused_project_create_then_owner_made_project_is_adopted(self):
        self.fake.force[("POST", "/project")] = (400, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self._assert_numbered(result)
        self.assertIn("Company-managed", " ".join(result["owner_steps"]))
        self.assertIn("set the key to `TKSTUDIO`", " ".join(result["owner_steps"]))
        self.assertEqual(self._binding()["jira"]["project_key"], "TKSTUDIO")
        # the owner creates it in the browser; the rerun recognises it
        del self.fake.force[("POST", "/project")]
        self.fake.add_project()
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertIn("Jira project TKSTUDIO", again["found"])
        self.assertEqual(self._binding()["jira"]["project_id"], "10000")

    def test_refused_space_and_folder_creates_are_owner_steps(self):
        self.fake.force[("POST", "confluence:/spaces")] = (400, {"message": "no"})
        result = self._setup(owner_account_id="acc-owner")
        self._assert_numbered(result)
        self.assertIn("space key to `TKSTUDIO`", " ".join(result["owner_steps"]))
        del self.fake.force[("POST", "confluence:/spaces")]
        self.fake.force[("POST", "confluence:/folders")] = (400, {"message": "no"})
        again = self._setup()
        self._assert_numbered(again)
        self.assertIn("`Brief`, `GDD`, `Scope of Work`, `Decisions`, `Records`",
                      " ".join(again["owner_steps"]))


class OwnerIdTests(SetupTestCase):
    def test_recorded_value_wins(self):
        self._setup(owner_account_id="acc-owner")
        result = self._setup(owner_account_id="acc-other",
                             owner_email="tim@example.com")
        self.assertIn("owner seat accountId (recorded)", result["found"])
        self.assertEqual(self._binding()["jira"]["owner_account_id"], "acc-owner")
        self.assertNotIn(("GET", "/user/search"), self.fake.calls)

    def test_flag_wins_over_email(self):
        result = self._setup(owner_account_id="acc-flag",
                             owner_email="owner@example.com")
        self.assertIn("owner seat accountId (--owner-account-id)", result["found"])
        self.assertEqual(self._binding()["jira"]["owner_account_id"], "acc-flag")
        self.assertNotIn(("GET", "/user/search"), self.fake.calls)

    def test_email_lookup(self):
        result = self._setup(owner_email="owner@example.com")
        self.assert_block_last(result, "complete")
        self.assertIn("owner seat accountId (looked up by --owner-email)",
                      result["found"])
        self.assertEqual(self._binding()["jira"]["owner_account_id"], "acc-owner")
        self.assertEqual(self.fake.project_body["leadAccountId"], "acc-owner")

    def test_email_lookup_miss_is_an_owner_step(self):
        result = self._setup(owner_email="nobody@example.com")
        self.assert_block_last(result, "partial")
        self.assertIn("--owner-account-id", result["owner_steps"][0])
        self.assertNotIn("owner_account_id", self._binding()["jira"])

    def test_unknown_owner_is_an_owner_step_and_the_agent_leads(self):
        result = self._setup()
        self.assert_block_last(result, "partial")
        self.assertTrue(result["owner_steps"][0].startswith("1. "))
        self.assertIn("accountId", result["owner_steps"][0])
        self.assertIn("--owner-account-id", result["reason"])
        self.assertEqual(self.fake.project_body["leadAccountId"], "acc-agent")


class RefusalTests(SetupTestCase):
    def _assert_refused(self, result, *names):
        self.assert_block_last(result, "blocked")
        self.assertFalse(result["ok"])
        for name in names:
            self.assertIn(name, result["reason"])
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.fake.urls, [])

    def test_unregistered_project(self):
        other = Path(self._tmp.name) / "other"
        other.mkdir()
        result = plansync.setup(other, transport=self.fake)
        self._assert_refused(result, "'other' is not registered")

    def test_each_absent_agent_variable_is_named(self):
        for name in jirabackend.AGENT_ENV_NAMES:
            os.environ.pop(name, None)
        result = self._setup()
        self._assert_refused(result, *jirabackend.AGENT_ENV_NAMES)

    def test_each_variable_alone(self):
        for name in (jirabackend.AGENT_EMAIL_ENV, jirabackend.AGENT_TOKEN_ENV,
                     jirabackend.AGENT_CONFLUENCE_TOKEN_ENV,
                     jirabackend.SITE_ENV):
            with self.subTest(name=name):
                os.environ.update(AGENT_ENV)
                os.environ.pop(name)
                self._assert_refused(self._setup(), f"{name} is not set")

    def test_cloud_id_absent_with_a_token_set(self):
        os.environ.pop(jirabackend.CLOUD_ID_ENV)
        result = self._setup()
        self._assert_refused(result, jirabackend.CLOUD_ID_ENV, "gateway",
                             "never the site URL")

    def test_site_needed_only_on_first_setup(self):
        self._setup(owner_account_id="acc-owner")
        os.environ.pop(jirabackend.SITE_ENV)
        result = self._setup()
        self.assert_block_last(result, "complete")

    def test_owner_seat_variables_are_never_read(self):
        # the agent seat's five variables are set (setUp) beside the owner
        # seat's, so a full setup runs and any read of the owner's would show
        owner = {"TK_STUDIO_ATLASSIAN_OWNER_EMAIL": "owner-seat@example.invalid",
                 "TK_STUDIO_ATLASSIAN_OWNER_TOKEN": "fake-owner-seat-token"}
        fake = self.fake
        seen: list[str] = []

        def transport(client, method, url, body):
            seen.append(client._headers["Authorization"])
            return fake(method, url, body)
        try:
            os.environ.update(owner)
            out = io.StringIO()
            with mock.patch.object(jirabackend.JiraClient, "_http", transport), \
                    mock.patch.object(confluence.ConfluenceClient, "_http",
                                      transport), \
                    contextlib.redirect_stdout(out):
                code = plansync.main(["setup", "--directory", str(self.root),
                                      "--owner-account-id", "acc-owner"])
        finally:
            for name in owner:
                os.environ.pop(name, None)
        self.assertEqual(code, 0)
        parsed = json.loads(out.getvalue())
        self.assert_block_last(parsed, "complete")
        self.assertTrue(seen)
        agent = {base64.b64encode(
            f"{AGENT_ENV[jirabackend.AGENT_EMAIL_ENV]}:{token}".encode()).decode()
            for token in (AGENT_ENV[jirabackend.AGENT_TOKEN_ENV],
                          AGENT_ENV[jirabackend.AGENT_CONFLUENCE_TOKEN_ENV])}
        for header in seen:
            self.assertIn(header.removeprefix("Basic "), agent)
            decoded = base64.b64decode(header.removeprefix("Basic ")).decode()
            for value in owner.values():
                self.assertNotIn(value, decoded)
        for value in owner.values():
            self.assertNotIn(value, out.getvalue())
        self.assertNotIn("owner-seat", self.config.read_text(encoding="utf-8"))

    def test_key_collision_with_a_project_setup_did_not_create(self):
        self.fake.add_project()
        before = self.config.read_text(encoding="utf-8")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn("Jira project TKSTUDIO already exists", result["reason"])
        self.assertEqual(self.fake.writes(), [])
        self.assertEqual(self.config.read_text(encoding="utf-8"), before)

    def test_space_key_collision_with_a_space_setup_did_not_create(self):
        self.fake.spaces["TKSTUDIO"] = {"id": "49999", "key": "TKSTUDIO",
                                        "name": "someone else's"}
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn("Confluence space TKSTUDIO already exists",
                      result["reason"])
        self.assertIn("record planning.confluence.space_key: TKSTUDIO to "
                      "adopt it", result["reason"])
        self.assertNotIn(("POST", "confluence:/spaces"), self.fake.calls)
        self.assertNotIn(("POST", "confluence:/folders"), self.fake.calls)
        # the Jira project this run made is recorded; the space is not
        self.assertEqual(self._binding()["jira"]["project_key"], "TKSTUDIO")
        self.assertNotIn("confluence", self._binding())

    def test_cli_refusal_exits_2_with_the_block_last(self):
        for name in jirabackend.AGENT_ENV_NAMES:
            os.environ.pop(name, None)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = plansync.main(["setup", "--directory", str(self.root)])
        self.assertEqual(code, 2)
        parsed = json.loads(out.getvalue())
        self.assertEqual(list(parsed)[-4:], list(plansync.SETUP_BLOCK_KEYS))
        self.assertEqual(parsed["status"], "blocked")
        for name in jirabackend.AGENT_ENV_NAMES:
            self.assertIn(name, parsed["reason"])


class AuthSplitTests(SetupTestCase):
    def test_401_names_token_email_expiry_and_toggle_never_scope(self):
        self.fake.fail_auth = True
        result = self._setup()
        self.assert_block_last(result, "blocked")
        reason = result["reason"]
        for phrase in ("401", jirabackend.AGENT_TOKEN_ENV,
                       jirabackend.AGENT_EMAIL_ENV, "expiry", "org-admin"):
            self.assertIn(phrase, reason)
        self.assertNotIn("scope", reason.lower())
        self.assertEqual(self.fake.writes(), [])

    def test_confluence_401_names_the_confluence_token(self):
        self.fake.force[("GET", "confluence:/spaces")] = (401, "Unauthorized")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn(jirabackend.AGENT_CONFLUENCE_TOKEN_ENV, result["reason"])
        self.assertNotIn("scope", result["reason"].lower())
        # what this run created is recorded, so the rerun recognises it
        self.assertEqual(result["written"], [".tk-studio/config.yaml"])
        self.assertEqual(self._binding()["jira"]["project_id"], "10000")

    def test_proxy_403_is_the_network_approval_step(self):
        self.fake.force[("GET", "/myself")] = (
            403, "Approval required for api.atlassian.com:443")
        result = self._setup()
        self.assert_block_last(result, "blocked")
        self.assertIn("network approval", result["reason"])
        self.assertIn("sbx policy approval ls", result["reason"])
        self.assertIn("api.atlassian.com:443", result["reason"])
        self.assertNotIn("scope", result["reason"].lower())

    def test_scope_403_on_a_create_names_the_scope(self):
        self.fake.force[("POST", "/project")] = (
            403, {"errorMessages": ["Unauthorized; scope does not match"]})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn("manage:jira-project", result["reason"])
        self.assertIn("new scoped token", result["reason"])
        self.assertIn(jirabackend.AGENT_TOKEN_ENV, result["reason"])

    def test_scope_403_on_a_status_create(self):
        self.fake.force[("POST", "/statuses")] = (403, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn("manage:jira-configuration", result["reason"])


class ReviewFindingTests(SetupTestCase):
    """The review pass on Story 31.2 (findings 1-12)."""

    def _steps(self, result):
        return " ".join(result["owner_steps"])

    # 1. the five-status workflow is verified on the project
    def test_template_without_to_do_ends_partial_naming_it(self):
        # DW-107: no status of the To Do category at all (a `Backlog` would
        # fill the slot — DW107SetupTests)
        self.fake.template_statuses = ["In Progress", "Done"]
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertIn("Add status `To Do` in the To Do category",
                      self._steps(result))
        self.assertIn("`To Do`", result["reason"])
        self.assertNotIn("Add status `Done`", self._steps(result))

    # 2. GLOBAL on company-managed; owner-made and agent-made globals found
    def test_rerun_finds_owner_made_global_statuses_without_recreating(self):
        self.fake.force[("POST", "/statuses")] = (400, {"errorMessages": ["no"]})
        self.assert_block_last(self._setup(owner_account_id="acc-owner"),
                               "partial")
        del self.fake.force[("POST", "/statuses")]
        blocked = self.fake.add_status("Blocked - Awaiting User")
        resolved = self.fake.add_status("Block Resolved")
        dni = self.fake.add_status("DNI")
        todo = self.fake.status("To Do")
        self.fake.workflow["transitions"].append(
            {"id": "99", "name": "Block Resolved", "from": [blocked["id"]],
             "to": resolved["id"], "type": "DIRECTED"})
        # the owner's steps also tick the three global transitions (DW-107)
        for i, entry in enumerate((todo, blocked, dni)):
            self.fake.workflow["transitions"].append(
                {"id": str(100 + i), "name": entry["name"], "from": [],
                 "to": entry["id"], "type": "GLOBAL"})
        self.assertEqual(blocked["scope"], {"type": "GLOBAL"})
        calls = len(self.fake.calls)
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertNotIn(("POST", "/statuses"), self.fake.calls[calls:])
        self.assertIn("status Blocked - Awaiting User", again["found"])
        self.assertIn("transition Blocked - Awaiting User -> Block Resolved",
                      again["found"])

    def test_agent_made_global_statuses_off_the_workflow_are_found(self):
        self.fake.force[("POST", "/workflows/update")] = (400, {"errorMessages": ["no"]})
        first = self._setup(owner_account_id="acc-owner")
        self.assertIn("status Block Resolved", first["created"])
        del self.fake.force[("POST", "/workflows/update")]
        calls = len(self.fake.calls)
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertNotIn(("POST", "/statuses"), self.fake.calls[calls:])
        self.assertIn("transition Blocked - Awaiting User -> Block Resolved",
                      again["created"])

    # 3. only the workflow named exactly for this project is updated
    def _rename_workflows(self, keep_exact):
        original = self.fake.add_project

        def add_project(key="TKSTUDIO"):
            original(key)
            if not keep_exact:
                self.fake.workflows[0]["id"]["name"] = (
                    f"Software Simplified Workflow for Project {key}X")
            self.fake.workflows.append({
                "id": {"name": f"{key} legacy flow", "entityId": "wf-2"},
                "version": {"versionNumber": 3, "id": "v3"},
                "statuses": [], "transitions": []})
        self.fake.add_project = add_project

    def test_no_exact_workflow_match_writes_nothing_and_is_partial(self):
        self._rename_workflows(keep_exact=False)
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertNotIn(("POST", "/workflows/update"), self.fake.calls)
        self.assertIn("Add a transition from `Blocked - Awaiting User`",
                      self._steps(result))

    def test_exact_workflow_is_chosen_beside_a_decoy(self):
        self._rename_workflows(keep_exact=True)
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "complete")
        decoy = next(w for w in self.fake.workflows
                     if w["id"]["entityId"] == "wf-2")
        self.assertEqual(decoy["transitions"], [])

    # 4. a binding that cannot be written still ends with the block
    def test_unwritable_binding_ends_blocked_naming_the_ids(self):
        with mock.patch.object(configlib, "assert_tracked_safe",
                               side_effect=configlib.ClassificationError("refused")):
            result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn("the binding was not written", result["reason"])
        self.assertIn("planning.jira.project_id: 10000", result["reason"])
        self.assertIn("planning.confluence.folders.brief", result["reason"])
        self.assertEqual(result["written"], [])

    def test_binding_edit_error_ends_blocked_through_the_cli(self):
        fake = self.fake

        def transport(_client, method, url, body):
            return fake(method, url, body)
        out = io.StringIO()
        with mock.patch.object(plansync, "write_binding",
                               side_effect=plansync.PlanSyncError("bad edit")), \
                mock.patch.object(jirabackend.JiraClient, "_http", transport), \
                mock.patch.object(confluence.ConfluenceClient, "_http", transport), \
                contextlib.redirect_stdout(out):
            code = plansync.main(["setup", "--directory", str(self.root),
                                  "--owner-account-id", "acc-owner"])
        self.assertEqual(code, 2)
        parsed = json.loads(out.getvalue())
        self.assert_block_last(parsed, "blocked")
        self.assertIn("bad edit", parsed["reason"])
        self.assertIn("Jira project TKSTUDIO", parsed["reason"])
        self.assertIn("planning.jira.project_id: 10000", parsed["reason"])

    def test_planning_block_indented_otherwise_is_refused_before_any_call(self):
        self.config.write_text(
            self.config.read_text(encoding="utf-8")
            + "\nplanning:\n    backend: jira\n    jira:\n"
              "        site: example.atlassian.net\n",
            encoding="utf-8", newline="\n")
        before = self.config.read_text(encoding="utf-8")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn("two-space", result["reason"])
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.config.read_text(encoding="utf-8"), before)

    # 6. every paged list is followed to its end
    def test_paged_lists_are_followed_on_the_rerun(self):
        self._setup(owner_account_id="acc-owner")
        self.fake.filters.insert(0, {"id": "1", "name": "Needs you (old)",
                                     "jql": "x"})
        self.fake.page_size = 1
        writes = len(self.fake.writes())
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertEqual(again["created"], [])
        self.assertEqual(len(self.fake.writes()), writes)
        for title in FOLDER_TITLES:
            self.assertIn(f"folder {title}", again["found"])

    # 9. the filter is recognised by name AND JQL; the agent's is preferred
    def test_same_named_filter_with_other_jql_is_not_adopted(self):
        self.fake.filters.append({"id": "777", "name": "Needs you",
                                  "jql": "status = Done",
                                  "owner": {"accountId": "acc-agent"}})
        result = self._setup(owner_account_id="acc-owner")
        self.assertIn("filter Needs you", result["created"])
        self.assertNotEqual(self._binding()["jira"]["filter_id"], "777")

    def test_agent_owned_filter_is_preferred(self):
        jql = jirabackend.NEEDS_YOU_JQL
        self.fake.filters += [
            {"id": "801", "name": "Needs you", "jql": jql,
             "owner": {"accountId": "acc-owner"}},
            {"id": "802", "name": "Needs you", "jql": jql,
             "owner": {"accountId": "acc-agent"}}]
        result = self._setup(owner_account_id="acc-owner")
        self.assertIn("filter Needs you", result["found"])
        self.assertEqual(self._binding()["jira"]["filter_id"], "802")

    # 10. the owner lookup names its scope and its own note
    def test_owner_lookup_403_names_read_jira_user(self):
        self.fake.force[("GET", "/user/search")] = (403, {"errorMessages": ["no"]})
        result = self._setup(owner_email="owner@example.com")
        self.assert_block_last(result, "blocked")
        self.assertIn("read:jira-user", result["reason"])

    def test_owner_lookup_miss_has_a_setup_note(self):
        result = self._setup(owner_email="nobody@example.com")
        self.assertTrue(any("owner seat accountId is not recorded" in n
                            for n in result["notes"]))
        self.assertFalse(any("unassigned" in n for n in result["notes"]))

    # 11. the refused filter and the missing issue types
    def test_refused_filter_create_is_an_owner_step(self):
        self.fake.force[("POST", "/filter")] = (400, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertIn("Save filter as `Needs you`", self._steps(result))
        self.assertIn(jirabackend.NEEDS_YOU_JQL, self._steps(result))

    def test_missing_issue_types_are_owner_steps(self):
        self.fake.project_issue_types = ["Task", "Sub-task"]
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertIn("Issue types and add `Epic`, `Story`", self._steps(result))

    # 12. a create that answers without the names is not a create
    def test_status_create_without_the_names_is_an_owner_step(self):
        self.fake.force[("POST", "/statuses")] = (200, [])
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertNotIn("status Block Resolved", result["created"])
        self.assertIn("Settings > Work items > Workflows", self._steps(result))
        self.assertNotIn(("POST", "/workflows/update"), self.fake.calls)



class SecondReviewTests(SetupTestCase):
    """The second review pass on Story 31.2 (patches 1-12)."""

    def _steps(self, result):
        return " ".join(result["owner_steps"])

    # 1. a team-managed project cannot use the site's GLOBAL statuses
    def test_team_managed_ignores_site_global_statuses(self):
        self.fake.team_managed = True
        for name in jirabackend.SETUP_STATUSES:   # another project's globals
            self.fake.statuses.append({
                "id": self.fake._id(60000), "name": name,
                "statusCategory": "IN_PROGRESS", "scope": {"type": "GLOBAL"}})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertIn("Project settings > Issue types > Story",
                      self._steps(result))
        self.assertNotIn("status Blocked - Awaiting User", result["found"])
        self.assertNotIn(("POST", "/statuses"), self.fake.calls)

    def test_in_scope_rules(self):
        glob = {"scope": {"type": "GLOBAL"}}
        mine = {"scope": {"type": "PROJECT", "project": {"id": "10000"}}}
        other = {"scope": {"type": "PROJECT", "project": {"id": "10001"}}}
        self.assertTrue(jirabackend._in_scope(glob, "10000"))
        self.assertFalse(jirabackend._in_scope(glob, "10000", True))
        self.assertTrue(jirabackend._in_scope(mine, "10000", True))
        self.assertFalse(jirabackend._in_scope(other, "10000", True))

    # 2. the refused filter step shares it with the project
    def test_refused_filter_step_shares_it_with_the_project(self):
        self.fake.force[("POST", "/filter")] = (400, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertIn("share `Needs you` with project `TKSTUDIO`",
                      self._steps(result))

    def test_filter_waits_for_the_project_it_is_shared_with(self):
        self.fake.force[("POST", "/project")] = (400, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertNotIn(("POST", "/filter"), self.fake.calls)
        del self.fake.force[("POST", "/project")]
        self.fake.add_project()
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertIn("filter Needs you", again["created"])
        self.assertEqual(self.fake.filter_body["sharePermissions"],
                         [{"type": "project", "project": {"id": "10000"}}])

    # 3. an error after refused steps still carries the steps
    def test_blocked_after_owner_steps_keeps_them(self):
        self.fake.force[("POST", "/filter")] = (400, {"errorMessages": ["no"]})
        self.fake.force[("GET", "confluence:/spaces")] = (401, "Unauthorized")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertTrue(result["owner_steps"])
        self.assertIn("Save filter as `Needs you`", self._steps(result))
        for i, step in enumerate(result["owner_steps"], 1):
            self.assertTrue(step.startswith(f"{i}. "), step)
            self.assertIn(step, result["reason"])
        self.assertLess(result["reason"].index("401"),
                        result["reason"].index(result["owner_steps"][0]))

    # 4. on Free, roles and space permissions cannot be customised (kb §2
    # Q2, Q4): the project and space steps are the create steps only
    def test_project_and_space_steps_are_create_steps_only(self):
        self.fake.force[("POST", "/project")] = (400, {"errorMessages": ["no"]})
        self.fake.force[("POST", "confluence:/spaces")] = (400, {"message": "no"})
        result = self._setup(owner_account_id="acc-owner")
        steps = self._steps(result)
        self.assertNotIn("Administrators role", steps)
        self.assertNotIn("space admin permission", steps)
        self.assertNotIn("agent@example.com", steps)
        # project create, space create, rerun (the filter waits)
        self.assertEqual(len(result["owner_steps"]), 3)
        self.assertIn("set the key to `TKSTUDIO`", result["owner_steps"][0])
        self.assertIn("space key to `TKSTUDIO`", result["owner_steps"][1])
        self.assertIn("Rerun", result["owner_steps"][2])

    # 5. an existing status is added to the workflow, not created
    def test_existing_statuses_are_added_not_created(self):
        self.fake.force[("POST", "/workflows/update")] = (400, {"errorMessages": ["no"]})
        steps = self._steps(self._setup(owner_account_id="acc-owner"))
        self.assertIn("add the existing status `Blocked - Awaiting User`", steps)
        self.assertIn("add the existing status `Block Resolved`", steps)
        self.assertNotIn("create `Block", steps)

    def test_absent_statuses_are_created(self):
        self.fake.force[("POST", "/statuses")] = (400, {"errorMessages": ["no"]})
        steps = self._steps(self._setup(owner_account_id="acc-owner"))
        self.assertIn("create `Blocked - Awaiting User`", steps)
        self.assertNotIn("existing status", steps)

    # 7. the 401 toggle names the site, not the gateway
    def test_401_toggle_names_the_site(self):
        self.fake.fail_auth = True
        reason = self._setup()["reason"]
        self.assertIn(f"enabled for the site {SITE}", reason)
        self.assertNotIn("enabled for api.atlassian.com", reason)
        self.assertNotIn("scope", reason.lower())

    def test_confluence_401_toggle_names_the_site(self):
        self.fake.force[("GET", "confluence:/spaces")] = (401, "Unauthorized")
        reason = self._setup(owner_account_id="acc-owner")["reason"]
        self.assertIn(f"enabled for the site {SITE}", reason)
        self.assertNotIn("enabled for api.atlassian.com", reason)

    def test_gateway_401_without_a_site_names_the_variable(self):
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake-agent-token",
            lambda m, u, b: (401, "Unauthorized"))
        with self.assertRaises(jirabackend.JiraError) as caught:
            client.request("GET", "/myself")
        self.assertIn(f"the Atlassian site ({jirabackend.SITE_ENV})",
                      str(caught.exception))
        self.assertNotIn("enabled for api.atlassian.com", str(caught.exception))

    # 8. both owner flags are a named refusal before any call
    def test_both_owner_flags_are_refused(self):
        fake = self.fake

        def transport(_client, method, url, body):
            return fake(method, url, body)
        out = io.StringIO()
        with mock.patch.object(jirabackend.JiraClient, "_http", transport), \
                mock.patch.object(confluence.ConfluenceClient, "_http", transport), \
                contextlib.redirect_stdout(out):
            code = plansync.main(["setup", "--directory", str(self.root),
                                  "--owner-account-id", "acc-owner",
                                  "--owner-email", "owner@example.com"])
        self.assertEqual(code, 2)
        parsed = json.loads(out.getvalue())
        self.assert_block_last(parsed, "blocked")
        self.assertIn("--owner-account-id", parsed["reason"])
        self.assertIn("--owner-email", parsed["reason"])
        self.assertEqual(fake.calls, [])
        self.assertEqual(fake.urls, [])

    # 11. a non-JSON 2xx is a named error, never a traceback
    def _html_response(self):
        resp = mock.MagicMock()
        resp.status = 200
        resp.read.return_value = b"<html>tunnel interstitial</html>"
        resp.__enter__.return_value = resp
        return resp

    def test_non_json_2xx_is_a_named_jira_error(self):
        client = jirabackend.JiraClient.for_gateway(
            "cloud-test", "agent@example.com", "fake-agent-token")
        with mock.patch("urllib.request.urlopen",
                        return_value=self._html_response()):
            with self.assertRaises(jirabackend.JiraError) as caught:
                client.request("GET", "/myself")
        reason = str(caught.exception)
        self.assertIn("non-JSON 2xx body", reason)
        self.assertIn("GET /ex/jira/cloud-test/rest/api/2/myself", reason)
        self.assertNotIn("Basic", reason)
        self.assertNotIn("interstitial", reason)

    def test_non_json_2xx_is_a_named_confluence_error(self):
        client = confluence.ConfluenceClient(
            "cloud-test", "agent@example.com", "fake-confluence-token")
        with mock.patch("urllib.request.urlopen",
                        return_value=self._html_response()):
            with self.assertRaises(confluence.ConfluenceError) as caught:
                client.request("GET", "/spaces")
        self.assertIn("non-JSON 2xx body", str(caught.exception))
        self.assertIn("GET /ex/confluence/cloud-test/wiki/api/v2/spaces",
                      str(caught.exception))

    def test_non_json_2xx_mid_setup_ends_blocked_with_the_ids(self):
        fake = self.fake
        html = self._html_response()
        real_http = confluence.ConfluenceClient._http

        def transport(client, method, url, body):
            if "/ex/confluence/" in url:
                with mock.patch("urllib.request.urlopen", return_value=html):
                    return real_http(client, method, url, body)
            return fake(method, url, body)
        out = io.StringIO()
        with mock.patch.object(jirabackend.JiraClient, "_http", transport), \
                mock.patch.object(confluence.ConfluenceClient, "_http", transport), \
                contextlib.redirect_stdout(out):
            code = plansync.main(["setup", "--directory", str(self.root),
                                  "--owner-account-id", "acc-owner"])
        self.assertEqual(code, 2)
        parsed = json.loads(out.getvalue())
        self.assert_block_last(parsed, "blocked")
        self.assertIn("non-JSON 2xx body", parsed["reason"])
        self.assertEqual(parsed["written"], [".tk-studio/config.yaml"])
        self.assertEqual(self._binding()["jira"]["project_id"], "10000")

    # 12. a one-character key is refused
    def test_one_character_key_is_none(self):
        for project_id in ("x", "9-x", "123-456"):
            self.assertIsNone(jirabackend.project_key_for(project_id))
        self.assertEqual(jirabackend.project_key_for("ab"), "AB")


class ThirdReviewTests(SetupTestCase):
    """The third review's findings: a key is recorded only for an item
    found, created or handed to the owner; a blocked run that handed the
    owner a keyed create still records it; comment lines inside the
    planning: block."""

    # 1. an error before the space is looked at records no space key
    def test_space_key_unrecorded_when_the_space_lookup_errors(self):
        self.fake.force[("GET", "confluence:/spaces")] = (401, "Unauthorized")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIn("Jira project TKSTUDIO", result["created"])
        binding = self._binding()
        self.assertEqual(binding["jira"]["project_key"], "TKSTUDIO")
        self.assertNotIn("confluence", binding)
        # a same-keyed space someone else made is refused on the rerun
        del self.fake.force[("GET", "confluence:/spaces")]
        self.fake.spaces["TKSTUDIO"] = {"id": "49999", "key": "TKSTUDIO",
                                        "name": "someone else's"}
        again = self._setup()
        self.assert_block_last(again, "blocked")
        self.assertIn("Confluence space TKSTUDIO already exists",
                      again["reason"])
        self.assertNotIn(("POST", "confluence:/folders"), self.fake.calls)

    def test_project_key_unrecorded_on_a_collision(self):
        self.fake.add_project()
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertIsNone(result["binding"]["jira"]["project_key"])
        self.assertIsNone(result["binding"]["confluence"]["space_key"])

    # 2. a blocked run that handed the owner the project still records it
    def test_blocked_run_records_the_project_handed_to_the_owner(self):
        self.fake.force[("POST", "/project")] = (400, {"errorMessages": ["no"]})
        self.fake.force[("GET", "confluence:/spaces")] = (401, "Unauthorized")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "blocked")
        self.assertEqual(result["created"], [])
        self.assertIn("set the key to `TKSTUDIO`", " ".join(result["owner_steps"]))
        self.assertEqual(result["written"], [".tk-studio/config.yaml"])
        binding = self._binding()
        self.assertEqual(binding["jira"]["project_key"], "TKSTUDIO")
        self.assertNotIn("confluence", binding)
        # the owner follows the steps; the rerun adopts, never refuses
        del self.fake.force[("POST", "/project")]
        del self.fake.force[("GET", "confluence:/spaces")]
        self.fake.add_project()
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertIn("Jira project TKSTUDIO", again["found"])
        self.assertEqual(self._binding()["jira"]["project_id"], "10000")

    # 4. a column-0 comment inside planning: does not end the block
    def test_column_zero_comment_inside_planning_keeps_one_jira_mapping(self):
        self.config.write_text(
            self.config.read_text(encoding="utf-8")
            + "\nplanning:\n  backend: jira\n"
              "#   # jira binding config (AD-7) — keys and ids only\n"
              "  jira:\n    site: example.atlassian.net\n",
            encoding="utf-8", newline="\n")
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "complete")
        text = self.config.read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r"^  jira:", text, re.M)), 1)
        self.assertIn("#   # jira binding config (AD-7)", text)
        binding = self._binding()
        self.assertEqual(binding["jira"]["project_key"], "TKSTUDIO")
        self.assertEqual(binding["jira"]["site"], "example.atlassian.net")
        self.assertEqual(binding["backend"], "jira")


class DW107SetupTests(SetupTestCase):
    """DW-95 / DW-107 (hole 92): setup accepts any To Do-category status,
    creates `DNI` in the Done category, and sends a workflow update whose
    body fixes the type case (uppercase) and the `/workflows/search`
    version; the rest of its shape, the GLOBAL transitions included, is
    ungraded (kb §2 Q1) until the operator's attended rerun."""

    def _steps(self, result):
        return " ".join(result["owner_steps"])

    def _globals(self, body):
        return [t for t in body["workflows"][0]["transitions"]
                if t["type"] == "GLOBAL"]

    def test_backlog_fills_the_to_do_slot_and_the_update_is_complete(self):
        self.fake.template_statuses = ["Backlog", "In Progress", "Done"]
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "complete")
        self.assertIn("status To Do (satisfied by Backlog)", result["found"])
        self.assertNotIn("`To Do`", self._steps(result))
        self.assertNotIn("To Do", result["reason"] or "")
        # DNI created in the Done category beside the two setup statuses
        self.assertEqual(self.fake.status("DNI")["statusCategory"], "DONE")
        for name in ("Blocked - Awaiting User", "Block Resolved"):
            self.assertEqual(self.fake.status(name)["statusCategory"],
                             "IN_PROGRESS")
        self.assertIn("status DNI", result["created"])
        # the single update, with a GLOBAL transition into Backlog
        self.assertEqual(len(self.fake.update_bodies), 1)
        backlog = self.fake.status("Backlog")["id"]
        self.assertIn(backlog, [t["to"] for t in
                                self._globals(self.fake.update_bodies[0])])
        self.assertIn("global transition -> Backlog", result["created"])
        # the rerun is complete with no further writes
        writes = len(self.fake.writes())
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertEqual(again["created"], [])
        self.assertEqual(len(self.fake.writes()), writes)
        self.assertIn("global transition -> Backlog", again["found"])

    def test_dni_create_refused_names_dni_in_company_steps(self):
        self.fake.force[("POST", "/statuses")] = (400, {"errorMessages": ["no"]})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        steps = self._steps(result)
        self.assertIn("create `DNI` in the Done category", steps)
        self.assertIn("create `Block Resolved` in the In Progress category",
                      steps)
        self.assertIn("`To Do`, `Blocked - Awaiting User` and `DNI`", steps)
        self.assertTrue(any("status create refused" in n
                            for n in result["notes"]))

    def test_team_managed_steps_ask_for_dni_with_a_global_transition(self):
        self.fake.team_managed = True
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        steps = self._steps(result)
        self.assertIn("Add status `DNI` in the Done category.", steps)
        # the same three global transitions the company steps ask for
        self.assertIn("On each of `To Do`, `Blocked - Awaiting User` and "
                      "`DNI`, tick Allow all statuses to transition to this "
                      "one", steps)
        self.assertNotIn(("POST", "/statuses"), self.fake.calls)

    def test_to_do_slot_status_off_the_workflow_is_in_the_update(self):
        # the project's only To Do-category status is a PROJECT-scoped
        # `Backlog` that is not on the workflow: the GLOBAL transition into
        # it needs it among the update's statuses
        self.fake.template_statuses = ["In Progress", "Done"]
        original = self.fake.add_project

        def add_project(key="TKSTUDIO"):
            original(key)
            entry = self.fake._new_status("Backlog", True)
            self.assertNotIn({"id": entry["id"]},
                             self.fake.workflow["statuses"])
        self.fake.add_project = add_project
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "complete")
        self.assertIn("status To Do (satisfied by Backlog)", result["found"])
        backlog = self.fake.status("Backlog")["id"]
        flow = self.fake.update_bodies[0]["workflows"][0]
        self.assertIn({"statusReference": backlog}, flow["statuses"])
        self.assertIn(backlog, [t["to"] for t in self._globals(
            self.fake.update_bodies[0])])

    def test_workflow_update_body(self):
        # the owner already made one GLOBAL transition into To Do: it is
        # kept, never duplicated
        original = self.fake.add_project

        def add_project(key="TKSTUDIO"):
            original(key)
            todo = self.fake.status("To Do")["id"]
            self.fake.workflow["transitions"].append(
                {"id": "12", "name": "To Do", "from": [], "to": todo,
                 "type": "GLOBAL"})
        self.fake.add_project = add_project
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "complete")
        self.assertEqual(len(self.fake.update_bodies), 1)
        flow = self.fake.update_bodies[0]["workflows"][0]
        self.assertEqual(flow["id"], "wf-1")
        self.assertEqual(flow["version"], {"versionNumber": 1, "id": "v1"})
        types = [t["type"] for t in flow["transitions"]]
        self.assertEqual(types, [t.upper() for t in types])
        self.assertIn("INITIAL", types)   # the legacy `initial`, uppercased
        ids = {n: self.fake.status(n)["id"]
               for n in ("To Do", "Blocked - Awaiting User", "Block Resolved",
                         "DNI")}
        self.assertIn({"statusReference": ids["DNI"]}, flow["statuses"])
        directed = [t for t in flow["transitions"] if t["type"] == "DIRECTED"]
        self.assertEqual([(t["from"], t["to"]) for t in directed],
                         [([ids["Blocked - Awaiting User"]],
                           ids["Block Resolved"])])
        into = sorted(t["to"] for t in flow["transitions"]
                      if t["type"] == "GLOBAL")
        self.assertEqual(into, sorted([ids["To Do"],
                                       ids["Blocked - Awaiting User"],
                                       ids["DNI"]]))
        for t in flow["transitions"]:
            if t["type"] == "GLOBAL":
                self.assertEqual(t["from"], [])
        self.assertIn("global transition -> To Do", result["found"])
        self.assertIn("global transition -> DNI", result["created"])

    def test_no_exact_name_in_workflows_search_writes_nothing(self):
        self.fake.force[("GET", "/workflows/search")] = (200, {
            "values": [{"id": "wf-1", "name": "TKSTUDIO other flow",
                        "version": {"versionNumber": 1, "id": "v1"}}],
            "startAt": 0, "isLast": True})
        result = self._setup(owner_account_id="acc-owner")
        self.assert_block_last(result, "partial")
        self.assertNotIn(("POST", "/workflows/update"), self.fake.calls)
        self.assertTrue(any("/workflows/search" in n for n in result["notes"]))
        self.assertIn("Settings > Work items > Workflows", self._steps(result))

    def test_rerun_of_a_complete_workflow_is_found_without_an_update(self):
        self._setup(owner_account_id="acc-owner")
        calls = len(self.fake.calls)
        again = self._setup()
        self.assert_block_last(again, "complete")
        self.assertNotIn(("POST", "/workflows/update"),
                         self.fake.calls[calls:])
        for label in ("transition Blocked - Awaiting User -> Block Resolved",
                      "global transition -> To Do",
                      "global transition -> Blocked - Awaiting User",
                      "global transition -> DNI", "status DNI"):
            self.assertIn(label, again["found"])

    def test_dry_run_names_dni_and_the_global_transitions(self):
        result = self._setup(dry_run=True, owner_account_id="acc-owner")
        self.assertEqual(self.fake.writes(), [])
        for label in ("status DNI", "global transition -> DNI",
                      "global transition -> Blocked - Awaiting User"):
            self.assertIn(label, result["would_create"])


if __name__ == "__main__":
    unittest.main()
