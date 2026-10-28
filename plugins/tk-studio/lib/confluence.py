"""Confluence Cloud client for the studio template (Story 31.2, AD-4/AD-22).

Gateway only: the agent seat's scoped Confluence token works only through
https://api.atlassian.com/ex/confluence/<cloud id>/wiki/api/v2 (kb/atlassian-
free-tier.md §2 Q3), so this client never builds a site URL. Auth is Basic
`TK_ATLASSIAN_AGENT_EMAIL:TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`, environment
only (AD-3). A 401/403 is split exactly as the Jira adapter splits it
(`jirabackend.auth_failure`): token/email/expiry/toggle, the proxy's network
approval, or a missing scope.

Library only — sequenced by plansync.setup (the adapter front door, AD-4).
Holds the transport seam and the find-or-create helpers for the space and
its design-page folders, and (Story 31.3, sequenced by plansync.publish) the
page find/get/create/update calls (v2) and the attachment list (v2) and
upload (v1 `PUT …/wiki/rest/api/content/{id}/child/attachment`, multipart:
v2 has no upload endpoint; `PUT` creates or replaces the file, where `POST`
refuses a filename the page already holds, so a changed image could never
be re-uploaded) — every call through the one transport callable.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import jirabackend

API_PREFIX = "/wiki/api/v2"
V1_PREFIX = "/wiki/rest/api"
TOKEN_ENV = jirabackend.AGENT_CONFLUENCE_TOKEN_ENV
EMAIL_ENV = jirabackend.AGENT_EMAIL_ENV
CLOUD_ID_ENV = jirabackend.CLOUD_ID_ENV
SCOPE_SPACE = "write:space:confluence"
SCOPE_FOLDER = "write:folder:confluence"
SCOPE_PAGE = "write:page:confluence"
SCOPE_ATTACHMENT = "write:attachment:confluence"
MAX_PAGES = 100

# binding key -> folder title, in the template's order
FOLDERS = (("brief", "Brief"), ("gdd", "GDD"),
           ("scope-of-work", "Scope of Work"), ("decisions", "Decisions"),
           ("records", "Records"))


class ConfluenceError(Exception):
    """Backend refusal or failure; message is safe to surface as `reason`."""


class RateLimited(ConfluenceError):
    """A 429 still answered after every retry (Story 31.4); `reason` is the
    response's `RateLimit-Reason`, or None when the header was absent."""

    def __init__(self, message: str, reason: str | None = None):
        super().__init__(message)
        self.reason = reason


class Multipart:
    """A multipart/form-data request body for the transport seam: the one
    file part plus plain fields. The default transport sends `data` with
    `content_type` and `X-Atlassian-Token: no-check`; a fake reads the
    parts it carries (`filename`, `content`, `fields`)."""

    def __init__(self, filename: str, content: bytes, fields: dict[str, str]):
        self.filename = filename
        self.content = content
        self.fields = dict(fields)
        self.boundary = "tkstudio" + hashlib.sha256(content).hexdigest()[:24]
        self.content_type = f"multipart/form-data; boundary={self.boundary}"
        parts = []
        for name, value in self.fields.items():
            parts.append((f'--{self.boundary}\r\nContent-Disposition: form-data; '
                          f'name="{name}"\r\n\r\n{value}\r\n').encode("utf-8"))
        safe = filename.replace('"', "_").replace("\r", "_").replace("\n", "_")
        parts.append((f'--{self.boundary}\r\nContent-Disposition: form-data; '
                      f'name="file"; filename="{safe}"\r\nContent-Type: '
                      f'application/octet-stream\r\n\r\n').encode("utf-8")
                     + content + b"\r\n")
        parts.append(f"--{self.boundary}--\r\n".encode("utf-8"))
        self.data = b"".join(parts)


def env_gaps() -> list[str]:
    """Each absent variable the gateway client needs, by name."""
    return [f"{name} is not set" for name in (EMAIL_ENV, TOKEN_ENV, CLOUD_ID_ENV)
            if not os.environ.get(name)]


class ConfluenceClient:
    """Minimal Confluence Cloud v2 client through the gateway.

    `transport(method, url, body) -> (status, parsed_body)` is injectable so
    the client is testable offline; the default is urllib over HTTPS. A
    transport may answer `(status, parsed_body, headers)` too, and a 429 is
    retried as the Jira client retries it (Story 31.4,
    `jirabackend.send_with_retry`, the same capped `Retry-After` and wait
    budget); `sleep` is the backoff's wait.
    """

    def __init__(self, cloud_id: str, email: str, token: str, transport=None,
                 site: str | None = None):
        if not cloud_id:
            raise ConfluenceError(f"{CLOUD_ID_ENV} is not set — Confluence is "
                                  f"reached only through the gateway, never "
                                  f"the site URL")
        self.host = jirabackend.GATEWAY_HOST
        # the org/site whose API-token toggle a 401 names (never the gateway)
        self.site = (site or "").replace("https://", "").replace(
            "http://", "").strip("/") or None
        self.base = (f"https://{self.host}/ex/confluence/{cloud_id}"
                     f"{API_PREFIX}")
        self.v1_base = (f"https://{self.host}/ex/confluence/{cloud_id}"
                        f"{V1_PREFIX}")
        auth = base64.b64encode(f"{email}:{token}".encode("utf-8")).decode()
        self._headers = {"Authorization": f"Basic {auth}",
                         "Accept": "application/json",
                         "Content-Type": "application/json"}
        self._transport = transport or self._http
        self.sleep = time.sleep
        self.rate_limit = jirabackend.new_rate_limit_record()
        self.retry_budget = jirabackend.new_retry_budget()

    @classmethod
    def from_env(cls, transport=None) -> "ConfluenceClient":
        gaps = env_gaps()
        if gaps:
            raise ConfluenceError("; ".join(gaps))
        return cls(os.environ[CLOUD_ID_ENV], os.environ[EMAIL_ENV],
                   os.environ[TOKEN_ENV], transport,
                   site=os.environ.get(jirabackend.SITE_ENV))

    def _http(self, method: str, url: str, body):
        headers = dict(self._headers)
        if isinstance(body, Multipart):
            data = body.data
            headers["Content-Type"] = body.content_type
            headers["X-Atlassian-Token"] = "no-check"
        else:
            data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers,
                                     method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                try:
                    return resp.status, (json.loads(raw) if raw.strip()
                                         else None), \
                        jirabackend._lower_headers(resp.headers)
                except ValueError as exc:
                    raise ConfluenceError(jirabackend.non_json_2xx(
                        "Confluence", method, url, resp.status)) from exc
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = raw
            return exc.code, parsed, jirabackend._lower_headers(exc.headers)
        except (urllib.error.URLError, OSError) as exc:
            proxied = jirabackend.proxy_refusal("Confluence", method, url,
                                                exc, self.host)
            if proxied:
                raise ConfluenceError(proxied) from exc
            raise ConfluenceError(f"cannot reach {self.host}: {exc}") from exc

    def request(self, method: str, path: str, body=None,
                query: dict | None = None, scope: str | None = None,
                v1: bool = False):
        url = (self.v1_base if v1 else self.base) + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        status, data = jirabackend.send_with_retry(
            "Confluence", self._transport, method, url, body,
            self.rate_limit, self.sleep, RateLimited, self.retry_budget)
        reason = jirabackend.auth_failure("Confluence", status, method, path,
                                          data, self.host, TOKEN_ENV,
                                          EMAIL_ENV, scope, site=self.site)
        if reason:
            raise ConfluenceError(reason)
        return status, data


def _refusal(status: int, data) -> str:
    return f"HTTP {status}: {jirabackend._body_text(data)[:300]}"


def _paged_results(client: ConfluenceClient, path: str,
                   query: dict | None = None,
                   prefix: str = "setup") -> list[dict]:
    """Every `results[]` entry of a v2 list, following the `_links.next`
    cursor page by page; errors read `<prefix>: …`."""
    results: list[dict] = []
    query = dict(query or {})
    for _ in range(MAX_PAGES):
        status, data = client.request("GET", path, query=query or None)
        if status != 200 or not isinstance(data, dict):
            raise ConfluenceError(f"{prefix}: GET {path} returned {status}")
        results += [r for r in data.get("results") or [] if isinstance(r, dict)]
        nxt = (data.get("_links") or {}).get("next")
        if not nxt:
            return results
        cursor = urllib.parse.parse_qs(urllib.parse.urlsplit(nxt).query).get("cursor")
        if not cursor:
            raise ConfluenceError(f"{prefix}: GET {path} gave a next link with "
                                  f"no cursor: {nxt}")
        query["cursor"] = cursor[0]
    raise ConfluenceError(f"{prefix}: GET {path} did not end within {MAX_PAGES} "
                          f"pages")


def find_space(client: ConfluenceClient, key: str) -> dict | None:
    for entry in _paged_results(client, "/spaces", {"keys": key}):
        if str(entry.get("key", "")).lower() == key.lower():  # Confluence keys are unique case-insensitively (a created key may come back lowercase)
            return entry
    return None


def create_space(client: ConfluenceClient, key: str,
                 name: str) -> tuple[dict | None, str]:
    status, data = client.request("POST", "/spaces",
                                  {"key": key, "name": name},
                                  scope=SCOPE_SPACE)
    if status not in (200, 201) or not isinstance(data, dict) \
            or not data.get("id"):
        return None, _refusal(status, data)
    return data, ""


def find_folders(client: ConfluenceClient, space_id: str) -> dict[str, str]:
    """title -> folder id for the space's top-level folders, every page."""
    return {entry["title"]: str(entry.get("id"))
            for entry in _paged_results(client,
                                        f"/spaces/{space_id}/direct-children")
            if entry.get("type") == "folder"
            and isinstance(entry.get("title"), str)}


def create_folder(client: ConfluenceClient, space_id: str, title: str,
                  parent_id: str | None = None) -> tuple[dict | None, str]:
    """Create a folder at the space's top level, or (Story 32.4) inside the
    folder `parent_id` (sent as `parentId`)."""
    body = {"spaceId": space_id, "title": title}
    if parent_id is not None:
        body["parentId"] = parent_id
    status, data = client.request("POST", "/folders", body,
                                  scope=SCOPE_FOLDER)
    if status not in (200, 201) or not isinstance(data, dict) \
            or not data.get("id"):
        return None, _refusal(status, data)
    return data, ""


def find_child_folder(client: ConfluenceClient, folder_id: str,
                      title: str) -> str | None:
    """The id of the folder titled `title` directly under the folder
    `folder_id` (Story 32.4: `Engagements/ENG-NNN`), every page."""
    for entry in _paged_results(client, f"/folders/{folder_id}/direct-children",
                                prefix="publish"):
        if entry.get("type") == "folder" and entry.get("title") == title:
            return str(entry.get("id"))
    return None


# ------------------------------------------------- design pages (Story 31.3)
# The page and attachment request shapes are ungraded on the live site
# (plans/31-3.md): they are pinned in the publish tests' fake.

def find_page(client: ConfluenceClient, folder_id: str,
              title: str) -> str | None:
    """The id of the page titled `title` directly under the folder."""
    for entry in _paged_results(client, f"/folders/{folder_id}/direct-children",
                                prefix="publish"):
        if entry.get("type") == "page" and entry.get("title") == title:
            return str(entry.get("id"))
    return None


def get_page(client: ConfluenceClient, page_id: str) -> dict:
    """The page with its storage body (the version number, the footer)."""
    status, data = client.request("GET", f"/pages/{page_id}",
                                  query={"body-format": "storage"})
    if status != 200 or not isinstance(data, dict):
        raise ConfluenceError(f"publish: GET /pages/{page_id} returned "
                              f"{status}")
    return data


def page_body(page: dict) -> str:
    return str(((page.get("body") or {}).get("storage") or {}).get("value")
               or "")


def page_version(page: dict) -> int:
    try:
        return int((page.get("version") or {}).get("number") or 0)
    except (TypeError, ValueError):
        return 0


def create_page(client: ConfluenceClient, space_id: str, folder_id: str,
                title: str, storage: str) -> tuple[dict | None, str]:
    status, data = client.request(
        "POST", "/pages",
        {"spaceId": space_id, "status": "current", "title": title,
         "parentId": folder_id,
         "body": {"representation": "storage", "value": storage}},
        scope=SCOPE_PAGE)
    if status not in (200, 201) or not isinstance(data, dict) \
            or not data.get("id"):
        return None, _refusal(status, data)
    return data, ""


def update_page(client: ConfluenceClient, page_id: str, title: str,
                storage: str, version: int) -> tuple[dict | None, str]:
    status, data = client.request(
        "PUT", f"/pages/{page_id}",
        {"id": page_id, "status": "current", "title": title,
         "body": {"representation": "storage", "value": storage},
         "version": {"number": version}},
        scope=SCOPE_PAGE)
    if status not in (200, 201) or not isinstance(data, dict):
        return None, _refusal(status, data)
    return data, ""


def list_space_pages(client: ConfluenceClient, space_id: str) -> list[dict]:
    """Every page of the space with its storage body (Story 31.4, the
    owner-page mirror): `GET /spaces/{id}/pages?body-format=storage&limit=250`,
    each entry reduced to `{id, title, author_id, version, body, webui}`.
    The `authorId` reading is ungraded on the live site (pinned in the
    sync-back tests' fake)."""
    pages = []
    for entry in _paged_results(client, f"/spaces/{space_id}/pages",
                                {"body-format": "storage", "limit": 250},
                                prefix="sync-back"):
        if entry.get("id") is None:
            continue
        pages.append({"id": str(entry["id"]),
                      "title": str(entry.get("title") or ""),
                      "author_id": entry.get("authorId"),
                      "version": page_version(entry),
                      "body": page_body(entry),
                      "webui": (entry.get("_links") or {}).get("webui")})
    return pages


def list_attachments(client: ConfluenceClient, page_id: str) -> list[dict]:
    return _paged_results(client, f"/pages/{page_id}/attachments",
                          prefix="publish")


def upload_attachment(client: ConfluenceClient, page_id: str, filename: str,
                      content: bytes, comment: str) -> tuple[bool, str]:
    """Create or replace the page's attachment `filename` (v1 PUT on the
    child collection), its `comment` carrying `sha256:<hex>`."""
    body = Multipart(filename, content, {"comment": comment,
                                         "minorEdit": "true"})
    status, data = client.request(
        "PUT", f"/content/{page_id}/child/attachment", body,
        scope=SCOPE_ATTACHMENT, v1=True)
    if status not in (200, 201):
        return False, _refusal(status, data)
    return True, ""
