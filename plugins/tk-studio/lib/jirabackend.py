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
the environment alone — never any config file (AD-3). Two paths (Story 31.2,
kb/atlassian-free-tier.md §2 Q3):

  - gateway (when TK_ATLASSIAN_AGENT_TOKEN is set): the agent seat's scoped
    token works only through https://api.atlassian.com/ex/jira/<cloud id>, so
    the base is built from TK_ATLASSIAN_CLOUD_ID and the email is
    TK_ATLASSIAN_AGENT_EMAIL. Either agent token set without the cloud id
    refuses by name — never a fallback to the site URL.
  - legacy (TK_ATLASSIAN_AGENT_TOKEN unset): JIRA_API_TOKEN plus JIRA_EMAIL
    or `planning.jira.email` against the site URL, as before.

Site and project key come from `planning.jira.site` /
`planning.jira.project_key` on both paths. The preflight proves the token
AND the org-admin API-token toggle in one probe (GET /myself succeeds only
when both hold). A 401 names the token, its email, its expiry and the org
toggle — never a scope; a 403 whose body is the sandbox proxy's `Approval
required for <host>:443` names the network approval step; any other 403
names the missing scope and asks for a new token — never a silent 401
(AD-11). The REST surface stays /rest/api/2 through the gateway too.

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

# The agent seat's variables (kb/atlassian-free-tier.md §1 step 7). The
# owner seat's TK_STUDIO_ATLASSIAN_OWNER_* names are host-only: never read.
SITE_ENV = "TK_ATLASSIAN_SITE"
AGENT_EMAIL_ENV = "TK_ATLASSIAN_AGENT_EMAIL"
AGENT_TOKEN_ENV = "TK_ATLASSIAN_AGENT_TOKEN"
AGENT_CONFLUENCE_TOKEN_ENV = "TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN"
CLOUD_ID_ENV = "TK_ATLASSIAN_CLOUD_ID"
AGENT_ENV_NAMES = (SITE_ENV, AGENT_EMAIL_ENV, AGENT_TOKEN_ENV,
                   AGENT_CONFLUENCE_TOKEN_ENV, CLOUD_ID_ENV)
GATEWAY_HOST = "api.atlassian.com"
PROXY_APPROVAL_MARK = "Approval required for"

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

def _body_text(data) -> str:
    if isinstance(data, str):
        return data
    try:
        return json.dumps(data)
    except (TypeError, ValueError):
        return str(data)


def auth_failure(app: str, status: int, method: str, path: str, data,
                 host: str, token_env: str, email_env: str,
                 scope: str | None = None,
                 site: str | None = None) -> str | None:
    """The named reason for a 401/403, or None for any other status.

    401: the token, its email, its expiry or the org toggle — never a scope
    (kb §1 step 4). The toggle belongs to the org/site, so it names `site`
    (the TK_ATLASSIAN_SITE host when known), never the gateway `host`. 403 with the proxy's `Approval required for <host>:443`
    body: the sandbox network approval (kb §1 step 8). Any other 403: the
    missing scope, and a new token (scopes are fixed after creation)."""
    if status == 401:
        where = (f"the site {site}" if site and site != GATEWAY_HOST
                 else f"the Atlassian site ({SITE_ENV})")
        return (f"{app} returned 401 for {method} {path}: check the "
                f"{token_env} API token, its account email ({email_env}), "
                f"its expiry, and that the org-admin API-token access toggle "
                f"is enabled for {where} (AD-7) — an auth failure is a named "
                f"blocked, never a silent 401 (AD-11)")
    if status != 403:
        return None
    text = _body_text(data)
    if PROXY_APPROVAL_MARK in text:
        match = re.search(r"Approval required for ([^\s\"']+)", text)
        target = match.group(1) if match else f"{host}:443"
        return (f"{app} call {method} {path} was stopped by the sandbox "
                f"network proxy ({PROXY_APPROVAL_MARK} {target}): the network "
                f"approval step — on the host run `sbx policy approval ls` and "
                f"approve {target} (kb/atlassian-free-tier.md §1 step 8), "
                f"then rerun")
    needed = scope or "the scope this call needs"
    return (f"{app} returned 403 for {method} {path}: the {token_env} token "
            f"lacks {needed} — create a new scoped token with it (scopes are "
            f"fixed after creation, kb/atlassian-free-tier.md §1 step 5) and "
            f"set {token_env} to it")


def proxy_refusal(app: str, method: str, url: str, exc: BaseException,
                  host: str) -> str | None:
    """The network-approval reason when a transport error carries the
    sandbox proxy's `Approval required for <host>:443` (a refused HTTPS
    CONNECT surfaces as URLError/OSError, not as an HTTP 403), else None."""
    text = f"{exc} {getattr(exc, 'reason', '')}"
    if PROXY_APPROVAL_MARK not in text:
        return None
    path = urllib.parse.urlsplit(url).path
    return auth_failure(app, 403, method, path, text, host, "", "")


def non_json_2xx(app: str, method: str, url: str, status: int) -> str:
    """The named reason for a 2xx whose body is not JSON (an HTML proxy
    page, a truncated answer): method and path only — never the body or
    the request's headers."""
    path = urllib.parse.urlsplit(url).path
    return (f"{app} answered {method} {path} with HTTP {status} and a "
            f"non-JSON 2xx body — a proxy page or a truncated answer; rerun "
            f"once the network path to the site is clean")


class JiraClient:
    """Minimal Jira Cloud REST client, API-token basic auth (AD-7).

    `transport(method, url, body) -> (status, parsed_body)` is injectable so
    the adapter is testable offline; the default is urllib over HTTPS. The
    constructor is the legacy site-URL path; `for_gateway` builds the
    api.atlassian.com base a scoped agent token needs (Story 31.2).
    """

    def __init__(self, site: str, email: str, token: str, transport=None,
                 *, base: str | None = None, token_env: str = TOKEN_ENV,
                 email_env: str = EMAIL_ENV, toggle_site: str | None = None):
        self.site = re.sub(r"^https?://", "", site).strip("/")
        # the org/site whose API-token toggle a 401 names (never the gateway)
        self.toggle_site = (re.sub(r"^https?://", "", toggle_site).strip("/")
                            if toggle_site else
                            (None if self.site == GATEWAY_HOST else self.site))
        self.base = base or f"https://{self.site}{API_PREFIX}"
        self.token_env = token_env
        self.email_env = email_env
        auth = base64.b64encode(f"{email}:{token}".encode("utf-8")).decode()
        self._headers = {"Authorization": f"Basic {auth}",
                         "Accept": "application/json",
                         "Content-Type": "application/json"}
        self._transport = transport or self._http

    @classmethod
    def for_gateway(cls, cloud_id: str, email: str, token: str,
                    transport=None, site: str | None = None) -> "JiraClient":
        """The agent seat's client: https://api.atlassian.com/ex/jira/<cloud
        id>/rest/api/2 (kb §2 Q3 — a scoped token fails on the site URL).
        `site` (the TK_ATLASSIAN_SITE host) is named by a 401's toggle
        clause only; no call goes to it."""
        return cls(GATEWAY_HOST, email, token, transport,
                   base=f"https://{GATEWAY_HOST}/ex/jira/{cloud_id}{API_PREFIX}",
                   token_env=AGENT_TOKEN_ENV, email_env=AGENT_EMAIL_ENV,
                   toggle_site=site)

    def _http(self, method: str, url: str, body: dict | None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=self._headers,
                                     method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                try:
                    return resp.status, (json.loads(raw) if raw.strip()
                                         else None)
                except ValueError as exc:
                    raise JiraError(non_json_2xx("Jira", method, url,
                                                 resp.status)) from exc
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = raw
            return exc.code, parsed
        except (urllib.error.URLError, OSError) as exc:
            proxied = proxy_refusal("Jira", method, url, exc, self.site)
            if proxied:
                raise JiraError(proxied) from exc
            raise JiraError(f"cannot reach {self.site}: {exc}") from exc

    def request(self, method: str, path: str, body: dict | None = None,
                query: dict | None = None, scope: str | None = None):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        status, data = self._transport(method, url, body)
        reason = auth_failure("Jira", status, method, path, data, self.site,
                              self.token_env, self.email_env, scope,
                              site=self.toggle_site)
        if reason:
            raise JiraError(reason)
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
            "account_id": (me or {}).get("accountId"),
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
                {"id": front["id"], "key": key or "(new)",
                 "path": str(path)})
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
        bucket.append({"id": front["id"], "key": key, "path": str(path)})

    return {"created": created, "updated": updated, "notes": notes,
            "entities": len(entities), "project_key": project_key}


# ------------------------------------------------------------------ project

def gateway_gaps() -> list[str]:
    """Named refusals of the agent-seat gateway path: either agent token set
    without TK_ATLASSIAN_CLOUD_ID — a scoped token never falls back to the
    site URL (kb §2 Q3)."""
    tokens = [n for n in (AGENT_TOKEN_ENV, AGENT_CONFLUENCE_TOKEN_ENV)
              if os.environ.get(n)]
    if tokens and not os.environ.get(CLOUD_ID_ENV):
        return [f"{CLOUD_ID_ENV} is not set but {' and '.join(tokens)} "
                f"{'is' if len(tokens) == 1 else 'are'} — a scoped agent "
                f"token works only through the {GATEWAY_HOST} gateway, never "
                f"the site URL (kb/atlassian-free-tier.md §1 step 6)"]
    return []


def _resolve_settings(project_root: Path, runtime: dict | None) -> tuple[dict, list[str]]:
    """(settings, gaps). Site/project key are binding config; the email may
    live in config (identity, not a credential); the token is environment
    only (AD-3 — credentials never in any config file). With
    TK_ATLASSIAN_AGENT_TOKEN set the gateway path applies (`cloud_id` in
    settings); otherwise the legacy JIRA_* names, unchanged."""
    settings, gaps = {}, []
    for name, key in (("site", "planning.jira.site"),
                      ("project_key", "planning.jira.project_key")):
        try:
            value, _ = configlib.resolve(key, project_root=project_root,
                                         runtime=runtime)
            settings[name] = str(value)
        except configlib.ConfigError:
            gaps.append(f"{key} is not configured")
    gaps += gateway_gaps()
    if os.environ.get(AGENT_TOKEN_ENV):
        settings["token"] = os.environ[AGENT_TOKEN_ENV]
        if os.environ.get(CLOUD_ID_ENV):
            settings["cloud_id"] = os.environ[CLOUD_ID_ENV]
        email = os.environ.get(AGENT_EMAIL_ENV)
        if email:
            settings["email"] = email
        else:
            gaps.append(f"{AGENT_EMAIL_ENV} is not set (the agent seat's "
                        f"account email for {AGENT_TOKEN_ENV})")
        return settings, gaps
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


def client_for(settings: dict, transport=None) -> JiraClient:
    """The gateway client when the settings carry a cloud id, else the
    legacy site-URL client."""
    if settings.get("cloud_id"):
        return JiraClient.for_gateway(settings["cloud_id"], settings["email"],
                                      settings["token"], transport,
                                      site=settings.get("site"))
    return JiraClient(settings["site"], settings["email"], settings["token"],
                      transport)


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
        client = client_for(settings)
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


# -------------------------------------------------------------------- setup
#
# The Jira half of the studio template (Story 31.2, §6.8 a). Sequenced by
# plansync.setup (AD-4). Every helper recognises by key or name first and
# creates only when absent. The create shapes are ungraded (kb §2 Q1, grade
# C): a refusal other than 401/403 comes back as `None` plus the detail, and
# the caller turns it into the owner's numbered browser steps.

BLOCKED_STATUS = "Blocked - Awaiting User"
RESOLVED_STATUS = "Block Resolved"
SETUP_STATUSES = (BLOCKED_STATUS, RESOLVED_STATUS)
TEMPLATE_STATUSES = ("To Do", "In Progress", BLOCKED_STATUS, RESOLVED_STATUS,
                     "Done")
SETUP_ISSUE_TYPES = ("Epic", "Story")
NEEDS_YOU_FILTER = "Needs you"
NEEDS_YOU_JQL = ('status = "Blocked - Awaiting User" '
                 'ORDER BY priority DESC, updated ASC')
PROJECT_TYPE = "software"
PROJECT_TEMPLATE = "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic"
WORKFLOW_NAME = "Software Simplified Workflow for Project {key}"
SCOPE_PROJECT = "manage:jira-project"
SCOPE_CONFIGURATION = "manage:jira-configuration"
SCOPE_WORK = "write:jira-work"
SCOPE_READ = "read:jira-work"
SCOPE_USER = "read:jira-user"
MAX_PAGES = 100


def project_key_for(project_id: str) -> str | None:
    """Uppercase alphanumerics, starting with a letter, 2-10 characters:
    `tk-studio` -> `TKSTUDIO`. None when fewer than 2 characters are left
    (Jira and Confluence refuse a one-character key)."""
    key = re.sub(r"[^A-Za-z0-9]", "", project_id or "").upper()
    key = re.sub(r"^[^A-Z]+", "", key)[:10]
    return key if len(key) >= 2 else None


def _refusal(status: int, data) -> str:
    text = _body_text(data)
    return f"HTTP {status}: {text[:300]}"


def _paged_values(client: JiraClient, path: str, query: dict,
                  scope: str | None = None) -> list[dict]:
    """Every `values[]` entry of a Jira paged list (startAt / isLast)."""
    values: list[dict] = []
    start = 0
    for _ in range(MAX_PAGES):
        status, data = client.request("GET", path,
                                      query={**query, "startAt": start},
                                      scope=scope)
        if status != 200 or not isinstance(data, dict):
            raise JiraError(f"setup: GET {path} returned {status}")
        page = [v for v in data.get("values") or [] if isinstance(v, dict)]
        values += page
        start += len(page)
        if data.get("isLast", True) or not page:
            return values
    raise JiraError(f"setup: GET {path} did not end within {MAX_PAGES} pages")


def get_project(client: JiraClient, key: str) -> dict | None:
    status, proj = client.request("GET", f"/project/{key}")
    if status == 404:
        return None
    if status != 200 or not isinstance(proj, dict):
        raise JiraError(f"setup: GET /project/{key} returned {status}")
    return proj


def is_team_managed(proj: dict) -> bool:
    return proj.get("simplified") is True or proj.get("style") == "next-gen"


def create_project(client: JiraClient, key: str, name: str,
                   lead_account_id: str | None) -> tuple[dict | None, str]:
    """POST /project, company-managed software from the kanban template."""
    body = {"key": key, "name": name, "projectTypeKey": PROJECT_TYPE,
            "projectTemplateKey": PROJECT_TEMPLATE,
            "assigneeType": "UNASSIGNED"}
    if lead_account_id:
        body["leadAccountId"] = lead_account_id
    status, data = client.request("POST", "/project", body,
                                  scope=SCOPE_PROJECT)
    if status not in (200, 201) or not isinstance(data, dict):
        return None, _refusal(status, data)
    return data, ""


def confirm_issue_types(proj: dict) -> tuple[list[str], list[str]]:
    """(found, missing) of the template's issue types on the project."""
    available = [t.get("name") for t in proj.get("issueTypes") or []
                 if isinstance(t.get("name"), str)]
    found, missing = [], []
    for wanted in SETUP_ISSUE_TYPES:
        (found if _match_issue_type(wanted, available) else missing).append(wanted)
    return found, missing


def lookup_owner(client: JiraClient, email: str) -> tuple[str | None, str]:
    """(accountId, note) for the owner seat by email (`read:jira-user`)."""
    status, users = client.request("GET", "/user/search",
                                   query={"query": email}, scope=SCOPE_USER)
    matches = [u for u in users if isinstance(u, dict)] \
        if status == 200 and isinstance(users, list) else []
    if len(matches) == 1 and matches[0].get("accountId"):
        return str(matches[0]["accountId"]), ""
    return None, (f"owner email {email!r} matched {len(matches)} Jira "
                  f"accounts (GET /user/search returned {status}) — the "
                  f"owner seat accountId is not recorded")


def _in_scope(entry: dict, project_id: str, team_managed: bool = False) -> bool:
    """A PROJECT-scoped status counts for its own project only; a GLOBAL
    (or unscoped) one only on a company-managed project — a team-managed
    project cannot use global statuses."""
    scope = entry.get("scope") or {}
    if scope.get("type") == "PROJECT":
        return str((scope.get("project") or {}).get("id")) == str(project_id)
    return not team_managed  # GLOBAL (or unscoped)


def find_statuses(client: JiraClient, project_id: str,
                  project_key: str,
                  team_managed: bool = False) -> dict[str, dict]:
    """name -> status for the five template statuses on the project.

    One read for all five (kb §2 Q1's verification): the project-scoped
    `GET statuses/search?projectId=`, the site's statuses from `GET
    statuses/search` (a company-managed project's statuses are GLOBAL, so
    the projectId search may not return them) and the statuses the
    project's workflows use (`GET /project/<key>/statuses`). The two new
    statuses count when any read has them; the three template statuses only
    when the project itself has them (a global `To Do` elsewhere on the site
    is not this project's). On a team-managed project only its own
    PROJECT-scoped statuses and its in-use list count: a GLOBAL status of
    the same name is another project's and cannot be on this one."""
    scoped = _paged_values(client, "/statuses/search",
                           {"projectId": project_id}, scope=SCOPE_READ)
    site = _paged_values(client, "/statuses/search", {}, scope=SCOPE_READ)
    status, by_type = client.request("GET", f"/project/{project_key}/statuses",
                                     scope=SCOPE_READ)
    if status != 200 or not isinstance(by_type, list):
        raise JiraError(f"setup: GET /project/{project_key}/statuses "
                        f"returned {status}")
    in_use = [st for it in by_type if isinstance(it, dict)
              for st in it.get("statuses") or [] if isinstance(st, dict)]
    have: dict[str, dict] = {}
    for entry in in_use + [e for e in scoped
                           if _in_scope(e, project_id, team_managed)]:
        if entry.get("name") in TEMPLATE_STATUSES:
            have.setdefault(entry["name"], entry)
    for entry in site:
        if entry.get("name") in SETUP_STATUSES \
                and _in_scope(entry, project_id, team_managed):
            have.setdefault(entry["name"], entry)
    return have


def create_statuses(client: JiraClient, project_id: str,
                    names: list[str]) -> tuple[list[dict] | None, str]:
    """POST /statuses on a company-managed project: scope GLOBAL (kb §2
    Q1 — PROJECT is the team-managed scope), category In Progress. Jira has
    three categories (To Do, In Progress, Done) and both statuses are In
    Progress, so the unchanged pull-back maps them onto canonical
    `in-progress` by category; mapping them onto canonical `blocked` is
    left to Stories 31.5/31.7. Only the returned entries that carry a
    requested name count as created."""
    body = {"scope": {"type": "GLOBAL"},
            "statuses": [{"name": n, "statusCategory": "IN_PROGRESS",
                          "description": "tk-studio template status"}
                         for n in names]}
    status, data = client.request("POST", "/statuses", body,
                                  scope=SCOPE_CONFIGURATION)
    if status not in (200, 201) or not isinstance(data, list):
        return None, _refusal(status, data)
    return [e for e in data if isinstance(e, dict) and e.get("name") in names
            and e.get("id")], ""


def find_workflow(client: JiraClient, project_key: str) -> tuple[dict | None, str]:
    """(workflow, note): the one workflow named exactly as the template
    names this project's (`Software Simplified Workflow for Project
    <KEY>`). The search is a substring match, so another project's workflow
    can come back too: none or several exact matches select nothing."""
    wanted = WORKFLOW_NAME.format(key=project_key)
    values = _paged_values(client, "/workflow/search",
                           {"queryString": project_key,
                            "expand": "statuses,transitions"},
                           scope=SCOPE_READ)
    exact = [w for w in values if (w.get("id") or {}).get("name") == wanted]
    if len(exact) == 1:
        return exact[0], ""
    return None, (f"{len(exact)} workflows are named exactly {wanted!r} "
                  f"(of {len(values)} the search returned) — none updated")


def has_resolution_transition(workflow: dict, blocked_id: str,
                              resolved_id: str) -> bool:
    for tr in workflow.get("transitions") or []:
        sources = [str(s) for s in tr.get("from") or []]
        if str(tr.get("to")) == str(resolved_id) and str(blocked_id) in sources:
            return True
    return False


def add_resolution_transition(client: JiraClient, workflow: dict,
                              blocked_id: str,
                              resolved_id: str) -> tuple[bool, str]:
    """The workflow update: both statuses on the workflow and the
    `Blocked - Awaiting User` -> `Block Resolved` transition."""
    ident = workflow.get("id") or {}
    on_flow = {str(s.get("id")) for s in workflow.get("statuses") or []}
    statuses = [{"statusReference": sid}
                for sid in sorted(on_flow | {str(blocked_id), str(resolved_id)})]
    body = {"workflows": [{
        "id": ident.get("entityId"), "version": workflow.get("version"),
        "statuses": statuses,
        "transitions": list(workflow.get("transitions") or []) + [{
            "name": RESOLVED_STATUS, "type": "DIRECTED",
            "from": [str(blocked_id)], "to": str(resolved_id)}]}]}
    status, data = client.request("POST", "/workflows/update", body,
                                  scope=SCOPE_CONFIGURATION)
    if status not in (200, 201, 204):
        return False, _refusal(status, data)
    return True, ""


def find_filter(client: JiraClient, agent_account_id: str | None) -> dict | None:
    """The "Needs you" filter: the exact name AND the template's JQL; one
    owned by the agent seat is preferred. A same-named filter with other
    JQL is never adopted."""
    values = _paged_values(client, "/filter/search",
                           {"filterName": NEEDS_YOU_FILTER,
                            "expand": "jql,owner"}, scope=SCOPE_READ)
    matches = [v for v in values if v.get("name") == NEEDS_YOU_FILTER
               and " ".join(str(v.get("jql") or "").split()) == NEEDS_YOU_JQL]
    owned = [v for v in matches
             if (v.get("owner") or {}).get("accountId") == agent_account_id]
    return (owned or matches or [None])[0]


def create_filter(client: JiraClient,
                  project_id: str) -> tuple[dict | None, str]:
    """POST /filter, shared with the project so the owner seat sees the
    agent seat's "Needs you" filter (Stories 31.5/31.7 read it)."""
    body = {"name": NEEDS_YOU_FILTER, "jql": NEEDS_YOU_JQL,
            "description": "tk-studio: issues blocked on the owner",
            "sharePermissions": [{"type": "project",
                                  "project": {"id": str(project_id)}}]}
    status, data = client.request("POST", "/filter", body, scope=SCOPE_WORK)
    if status not in (200, 201) or not isinstance(data, dict) \
            or not data.get("id"):
        return None, _refusal(status, data)
    return data, ""
