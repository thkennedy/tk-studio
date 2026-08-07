"""Jira Cloud backend adapter (ST-8.1, AD-5/AD-6/AD-7).

Promotes canonical entities into a Jira Cloud project and pulls status-class
fields back, with the exact AD-5 semantics the local projection has: promote
is canonical -> backend, pull-back applies **status-class fields only**
(status, assignee) onto canonical files, echo-suppressed via the
`external.jira` snapshot; both-changed entities are human conflicts, never
silently resolved. Jira is a projection of the canonical files, never
authoritative.

Issue-type mapping (AD-6/AD-7 default): epic -> Epic, story -> Story,
task -> Sub-task — confirmed against the org's actual issue-type scheme by
the preflight before any write (name match is case/hyphen-insensitive, so a
scheme naming it "Subtask" confirms too; a scheme missing a target blocks).

Status mapping rides Jira's three fixed **status categories** (new /
indeterminate / done) rather than org-specific status names, which makes it
round-trip stable (AD-5): canonical `review` promotes as a transition into
the in-progress category, and an unchanged backend status on pull-back is an
echo, so the finer local value survives.

Auth (AD-7, legacy-council ISS-008): API token only, never OAuth. The token comes from
the JIRA_API_TOKEN environment variable alone — never any config file
(AD-3); the account email from JIRA_EMAIL or `planning.jira.email`; site and
project key from `planning.jira.site` / `planning.jira.project_key`. The
preflight proves the token AND the org-admin API-token toggle in one probe
(GET /myself succeeds only when both hold); a 401/403 blocks with both
candidate causes named — never a silent 401 (AD-11).

Library only — sequenced by plansync.sync (the adapter front door, AD-4: no
other surface calls the backend). Uses the Jira REST v2 surface deliberately:
v2 accepts plain-text descriptions where v3 demands ADF documents, keeping
the adapter stdlib-only (NFR9). Never prompts (AD-11).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import config as configlib
import interchange

BINDING = "jira"
TOKEN_ENV = "JIRA_API_TOKEN"
EMAIL_ENV = "JIRA_EMAIL"
API_PREFIX = "/rest/api/2"

# Canonical status -> Jira status-category key. Org status *names* vary per
# project scheme; the three categories are platform-fixed, so mapping through
# them is what keeps round trips stable (AD-5).
TO_BACKEND_CATEGORY = {
    "draft": "new", "ready": "new",
    "in-progress": "indeterminate", "blocked": "indeterminate",
    "review": "indeterminate",
    "done": "done",
    # dropped: not promoted (an existing issue is left in place — the
    # projection is never authoritative)
}
FROM_BACKEND_CATEGORY = {
    "new": "ready", "indeterminate": "in-progress", "done": "done",
}

DEFAULT_TYPE_MAPPING = {"epic": "Epic", "story": "Story", "task": "Sub-task"}


class JiraError(Exception):
    """Backend refusal or failure; message is safe to surface as `reason`."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="jr", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _content_hash(*parts: str) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def _load_entities(plan_dir: Path) -> list[tuple[Path, dict, str]]:
    """(path, frontmatter, body) per canonical entity, id order — EP- sorts
    before ST- before TA-, so parents always precede their children."""
    if not plan_dir.is_dir():
        return []
    paths, _ = interchange.scan_entities(plan_dir)
    loaded = []
    for path in paths:
        try:
            front, body = interchange.parse_entity(path)
        except interchange.InterchangeError:
            continue
        if isinstance(front.get("id"), str):
            loaded.append((path, front, body))
    loaded.sort(key=lambda item: item[1]["id"])
    return loaded


def _labels(front: dict) -> list[str]:
    # Jira labels cannot contain whitespace; the canonical id rides first.
    return [front["id"]] + [re.sub(r"\s+", "-", l)
                            for l in front.get("labels") or []]


# ------------------------------------------------------------------- client

class JiraClient:
    """Minimal Jira Cloud REST client, API-token basic auth (AD-7).

    `transport(method, url, body) -> (status, parsed_body)` is injectable so
    the adapter is testable offline; the default is urllib over HTTPS.
    """

    def __init__(self, site: str, email: str, token: str, transport=None):
        self.site = re.sub(r"^https?://", "", site).strip("/")
        self.base = f"https://{self.site}{API_PREFIX}"
        auth = base64.b64encode(f"{email}:{token}".encode("utf-8")).decode()
        self._headers = {"Authorization": f"Basic {auth}",
                         "Accept": "application/json",
                         "Content-Type": "application/json"}
        self._transport = transport or self._http

    def _http(self, method: str, url: str, body: dict | None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=self._headers,
                                     method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, (json.loads(raw) if raw.strip() else None)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = raw
            return exc.code, parsed
        except (urllib.error.URLError, TimeoutError) as exc:
            raise JiraError(f"cannot reach {self.site}: {exc}") from exc

    def request(self, method: str, path: str, body: dict | None = None,
                query: dict | None = None):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        status, data = self._transport(method, url, body)
        if status in (401, 403):
            raise JiraError(
                f"Jira returned {status} for {path}: verify BOTH that the "
                f"{TOKEN_ENV} API token is valid and that the org-admin "
                f"API-token access toggle is enabled for {self.site} (AD-7) "
                f"— an auth failure is a named blocked, never a silent 401 "
                f"(AD-11)")
        return status, data


# ---------------------------------------------------------------- preflight

def _match_issue_type(wanted: str, available: list[str]) -> str | None:
    def norm(name: str) -> str:
        return re.sub(r"[\s_-]", "", name).lower()
    for name in available:
        if norm(name) == norm(wanted):
            return name
    return None


def preflight(client: JiraClient, project_key: str) -> dict:
    """Token + org-toggle probe, then issue-type scheme confirmation.

    GET /myself succeeds only when the token is valid AND the org admin has
    API-token access enabled — one probe proves both; failure names both
    (the 401/403 raise in JiraClient.request). Then the default AD-6 type
    mapping is confirmed against the project's actual scheme; a missing
    target type blocks before any write.
    """
    status, me = client.request("GET", "/myself")
    if status != 200:
        raise JiraError(f"auth preflight failed: GET /myself returned "
                        f"{status} from {client.site}")
    status, proj = client.request("GET", f"/project/{project_key}")
    if status == 404:
        raise JiraError(f"Jira project {project_key!r} not found on "
                        f"{client.site}")
    if status != 200 or not isinstance(proj, dict):
        raise JiraError(f"preflight: GET /project/{project_key} returned "
                        f"{status}")
    available = [t.get("name") for t in proj.get("issueTypes") or []
                 if isinstance(t.get("name"), str)]
    mapping, missing = {}, []
    for kind, wanted in DEFAULT_TYPE_MAPPING.items():
        confirmed = _match_issue_type(wanted, available)
        if confirmed is None:
            missing.append(f"{kind} -> {wanted}")
        else:
            mapping[kind] = confirmed
    if missing:
        raise JiraError(
            f"issue-type scheme for {project_key} on {client.site} lacks: "
            f"{'; '.join(missing)} (available: {', '.join(available) or 'none'}) "
            f"— the AD-6 default mapping must be confirmed at setup (AD-7)")
    return {"account": (me or {}).get("displayName")
            or (me or {}).get("emailAddress") or "unknown",
            "issue_types": available, "mapping": mapping}


# ---------------------------------------------------------------- pull-back

def pull_back(plan_dir: Path, client: JiraClient,
              dry_run: bool = False) -> dict:
    """Apply backend status-class changes onto canonical files (AD-5).

    Echo suppression: a backend value equal to the last-promote snapshot is
    ignored. Both-changed entities are conflicts — reported, never resolved.
    """
    applied, conflicts, notes = [], [], []
    for path, front, body in _load_entities(plan_dir):
        snapshot = (front.get("external") or {}).get(BINDING)
        if not isinstance(snapshot, dict) or not snapshot.get("key"):
            continue
        key = snapshot["key"]
        status, issue = client.request("GET", f"/issue/{key}",
                                       query={"fields": "status,assignee"})
        if status == 404:
            notes.append(f"{front['id']}: {key} not found in Jira — left as-is")
            continue
        if status != 200 or not isinstance(issue, dict):
            raise JiraError(f"pull-back: GET /issue/{key} returned {status}")
        fields = issue.get("fields") or {}
        b_status = (fields.get("status") or {}).get("name")
        b_category = ((fields.get("status") or {}).get("statusCategory")
                      or {}).get("key")
        assignee_obj = fields.get("assignee")
        b_assignee = None
        if isinstance(assignee_obj, dict):
            b_assignee = (assignee_obj.get("emailAddress")
                          or assignee_obj.get("displayName"))
        if b_status is None:
            notes.append(f"{front['id']}: {key} has no readable status")
            continue

        changes: dict[str, object] = {}
        conflict_fields: list[str] = []
        if b_status != snapshot.get("status"):
            mapped = FROM_BACKEND_CATEGORY.get(b_category)
            if mapped is None:
                notes.append(f"{front['id']}: backend status {b_status!r} "
                             f"(category {b_category!r}) has no canonical "
                             f"mapping — left as-is")
            elif front["status"] != snapshot.get("canonical_status") and \
                    front["status"] != mapped:
                conflict_fields.append(
                    f"status: canonical={front['status']!r} "
                    f"backend={b_status!r} "
                    f"(promoted: {snapshot.get('canonical_status')!r})")
            elif front["status"] != mapped:
                changes["status"] = (mapped, b_status)

        snap_assignee = snapshot.get("assignee") or None
        if b_assignee != snap_assignee:
            canonical_now = front.get("assignee") or None
            snap_canonical = snapshot.get("canonical_assignee") or None
            if canonical_now != snap_canonical and canonical_now != b_assignee:
                conflict_fields.append(
                    f"assignee: canonical={front.get('assignee')!r} "
                    f"backend={b_assignee!r}")
            elif canonical_now != b_assignee:
                changes["assignee"] = b_assignee

        if conflict_fields:
            conflicts.append({"id": front["id"], "canonical": str(path),
                              "backend": key, "fields": conflict_fields})
            continue
        if not changes:
            continue
        if "status" in changes:
            mapped, backend_name = changes["status"]
            front["status"] = mapped
            snapshot["status"] = backend_name
            snapshot["canonical_status"] = mapped
        if "assignee" in changes:
            if changes["assignee"] is None:
                front.pop("assignee", None)
            else:
                front["assignee"] = changes["assignee"]
            snapshot["assignee"] = changes["assignee"] or ""
            snapshot["canonical_assignee"] = changes["assignee"] or ""
        front["updated"] = _now_iso()
        snapshot["synced_at"] = _now_iso()
        if not dry_run:
            _atomic_write(path, interchange.render_entity(front, body))
        applied.append({"id": front["id"], "fields": sorted(changes),
                        "path": str(path)})
    return {"applied": applied, "conflicts": conflicts, "notes": notes}


# ------------------------------------------------------------------ promote

def _current_status(client: JiraClient, key: str) -> tuple[str, str]:
    status, issue = client.request("GET", f"/issue/{key}",
                                   query={"fields": "status"})
    if status != 200 or not isinstance(issue, dict):
        raise JiraError(f"promote: GET /issue/{key} returned {status}")
    st = (issue.get("fields") or {}).get("status") or {}
    return st.get("name"), (st.get("statusCategory") or {}).get("key")


def _transition_to_category(client: JiraClient, key: str, target: str,
                            notes: list[str], entity_id: str) -> str | None:
    """Move the issue into the target status category; returns the resulting
    backend status name, or None when no transition reaches the category."""
    status, data = client.request("GET", f"/issue/{key}/transitions")
    if status != 200 or not isinstance(data, dict):
        raise JiraError(f"promote: GET /issue/{key}/transitions returned "
                        f"{status}")
    for tr in data.get("transitions") or []:
        to = tr.get("to") or {}
        if ((to.get("statusCategory") or {}).get("key")) == target:
            posted, _ = client.request("POST", f"/issue/{key}/transitions",
                                       {"transition": {"id": tr.get("id")}})
            if posted not in (200, 204):
                raise JiraError(f"promote: transition on {key} returned "
                                f"{posted}")
            return to.get("name")
    notes.append(f"{entity_id}: {key} has no transition into status "
                 f"category {target!r} — backend status left as-is "
                 f"(the snapshot keeps the round trip stable, AD-5)")
    return None


def _find_account(client: JiraClient, assignee: str, notes: list[str],
                  entity_id: str) -> dict | None:
    status, users = client.request("GET", "/user/search",
                                   query={"query": assignee})
    matches = users if isinstance(users, list) else []
    if status != 200 or len(matches) != 1:
        notes.append(f"{entity_id}: assignee {assignee!r} did not resolve to "
                     f"exactly one Jira account ({len(matches)} matches) — "
                     f"left unassigned in Jira")
        return None
    return matches[0]


def promote(plan_dir: Path, client: JiraClient | None, project_key: str,
            mapping: dict, dry_run: bool = False,
            skip_ids: set[str] | None = None) -> dict:
    """Create/update Jira issues from canonical entities, snapshot on the
    canonical side. With dry_run the backend is never contacted — the plan
    (would-create / would-update) is computed locally from the snapshots.

    `skip_ids` holds this round's pull-back conflicts: a both-changed entity
    is left untouched on BOTH sides until a human picks a side — promoting
    it would silently resolve the conflict in canonical's favor (AD-5)."""
    entities = _load_entities(plan_dir)
    notes, created, updated = [], [], []
    skip_ids = skip_ids or set()
    jira_keys: dict[str, str] = {
        front["id"]: ((front.get("external") or {}).get(BINDING) or {}).get("key")
        for _, front, _ in entities}

    for path, front, body in entities:
        if front["id"] in skip_ids:
            notes.append(f"{front['id']}: pull-back conflict — not promoted "
                         f"until a human picks a side (AD-5)")
            continue
        if front["status"] == "dropped":
            if jira_keys.get(front["id"]):
                notes.append(f"{front['id']}: dropped — existing "
                             f"{jira_keys[front['id']]} left in place (the "
                             f"projection is never authoritative)")
            continue
        snapshot = (front.get("external") or {}).get(BINDING) or {}
        content_hash = _content_hash(
            front["title"], ",".join(_labels(front)),
            front.get("parent") or "", body)
        fields_changed = snapshot.get("content_hash") != content_hash
        status_changed = snapshot.get("canonical_status") != front["status"]
        assignee_changed = (front.get("assignee") or None) != \
            (snapshot.get("canonical_assignee") or None)
        key = snapshot.get("key")
        if key and not (fields_changed or status_changed or assignee_changed):
            continue

        if dry_run:
            (updated if key else created).append(
                {"id": front["id"], "key": key or "(new)"})
            continue

        fields = {"summary": front["title"],
                  "description": body.strip("\n"),
                  "labels": _labels(front)}
        parent_key = jira_keys.get(front.get("parent") or "")
        if not key:
            if front["type"] == "task" and not parent_key:
                notes.append(f"{front['id']}: parent story has no Jira key — "
                             f"Sub-task not created")
                continue
            fields["project"] = {"key": project_key}
            fields["issuetype"] = {"name": mapping[front["type"]]}
            if parent_key and front["type"] in ("story", "task"):
                fields["parent"] = {"key": parent_key}
            posted, resp = client.request("POST", "/issue", {"fields": fields})
            if posted not in (200, 201) or not isinstance(resp, dict) \
                    or not resp.get("key"):
                raise JiraError(f"promote: creating {front['id']} returned "
                                f"{posted}: {resp!r}")
            key = resp["key"]
            jira_keys[front["id"]] = key
            bucket = created
        else:
            if fields_changed:
                put, resp = client.request("PUT", f"/issue/{key}",
                                           {"fields": fields})
                if put not in (200, 204):
                    raise JiraError(f"promote: updating {key} "
                                    f"({front['id']}) returned {put}: {resp!r}")
            bucket = updated

        backend_assignee = snapshot.get("assignee") or None
        if assignee_changed:
            wanted = front.get("assignee") or None
            if wanted is None:
                put, _ = client.request("PUT", f"/issue/{key}/assignee",
                                        {"accountId": None})
                if put not in (200, 204):
                    raise JiraError(f"promote: unassigning {key} returned {put}")
                backend_assignee = None
            else:
                account = _find_account(client, wanted, notes, front["id"])
                if account is not None:
                    put, _ = client.request(
                        "PUT", f"/issue/{key}/assignee",
                        {"accountId": account.get("accountId")})
                    if put not in (200, 204):
                        raise JiraError(f"promote: assigning {key} returned {put}")
                    backend_assignee = (account.get("emailAddress")
                                        or account.get("displayName"))

        backend_status, backend_category = _current_status(client, key)
        target = TO_BACKEND_CATEGORY[front["status"]]
        if backend_category != target:
            moved = _transition_to_category(client, key, target, notes,
                                            front["id"])
            if moved is not None:
                backend_status = moved

        snapshot.update({"key": key, "synced_at": _now_iso(),
                         "content_hash": content_hash,
                         "status": backend_status,
                         "canonical_status": front["status"],
                         "assignee": backend_assignee or "",
                         "canonical_assignee": front.get("assignee") or ""})
        front.setdefault("external", {})[BINDING] = snapshot
        front["updated"] = _now_iso()
        _atomic_write(path, interchange.render_entity(front, body))
        bucket.append({"id": front["id"], "key": key})

    return {"created": created, "updated": updated, "notes": notes,
            "entities": len(entities), "project_key": project_key}


# ------------------------------------------------------------------ project

def _resolve_settings(project_root: Path, runtime: dict | None) -> tuple[dict, list[str]]:
    """(settings, gaps). Site/project key are binding config; the email may
    live in config (identity, not a credential); the token is environment
    only (AD-3 — credentials never in any config file)."""
    settings, gaps = {}, []
    for name, key in (("site", "planning.jira.site"),
                      ("project_key", "planning.jira.project_key")):
        try:
            value, _ = configlib.resolve(key, project_root=project_root,
                                         runtime=runtime)
            settings[name] = str(value)
        except configlib.ConfigError:
            gaps.append(f"{key} is not configured")
    email = os.environ.get(EMAIL_ENV)
    if not email:
        try:
            value, _ = configlib.resolve("planning.jira.email",
                                         project_root=project_root,
                                         runtime=runtime)
            email = str(value)
        except configlib.ConfigError:
            email = None
    if email:
        settings["email"] = email
    else:
        gaps.append(f"account email missing: set {EMAIL_ENV} or "
                    f"planning.jira.email")
    token = os.environ.get(TOKEN_ENV)
    if token:
        settings["token"] = token
    else:
        gaps.append(f"{TOKEN_ENV} is not set (headless Jira auth is "
                    f"API-token, never OAuth — AD-7, legacy-council ISS-008)")
    return settings, gaps


def project(project_root: Path, plan_dir: Path, dry_run: bool = False,
            runtime: dict | None = None,
            client: JiraClient | None = None) -> dict:
    """The full jira projection round for plansync.sync: preflight ->
    pull-back (ingest board edits) -> promote (push canonical state).

    Any config or auth gap returns `blocked` with every gap named (AD-11).
    Dry-run never contacts the backend: binding config must exist, but
    credentials are not required and not verified.
    """
    settings, gaps = _resolve_settings(Path(project_root), runtime)
    config_gaps = [g for g in gaps if g.startswith("planning.jira.")]
    if config_gaps or (not dry_run and gaps):
        return {"binding": BINDING, "blocked": True,
                "reason": "jira binding preflight: " + "; ".join(
                    config_gaps if dry_run else gaps)}

    if dry_run:
        plan = promote(plan_dir, None, settings["project_key"],
                       DEFAULT_TYPE_MAPPING, dry_run=True)
        return {"binding": BINDING, "action": "dry-run", "promote": plan,
                "pull_back": {"applied": [], "conflicts": [], "notes": [
                    "dry-run: backend not contacted — pull-back skipped, "
                    "credentials not verified"]},
                "conflicts": []}

    if client is None:
        client = JiraClient(settings["site"], settings["email"],
                            settings["token"])
    try:
        checked = preflight(client, settings["project_key"])
        pulled = pull_back(plan_dir, client)
        promoted = promote(plan_dir, client, settings["project_key"],
                           checked["mapping"],
                           skip_ids={c["id"] for c in pulled["conflicts"]})
    except JiraError as exc:
        return {"binding": BINDING, "blocked": True, "reason": str(exc)}
    return {"binding": BINDING, "action": "projected",
            "preflight": {"account": checked["account"],
                          "mapping": checked["mapping"]},
            "pull_back": pulled, "promote": promoted,
            "conflicts": pulled["conflicts"]}
