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
its design-page folders; publishing pages is Story 31.3's, not here.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request

import jirabackend

API_PREFIX = "/wiki/api/v2"
TOKEN_ENV = jirabackend.AGENT_CONFLUENCE_TOKEN_ENV
EMAIL_ENV = jirabackend.AGENT_EMAIL_ENV
CLOUD_ID_ENV = jirabackend.CLOUD_ID_ENV
SCOPE_SPACE = "write:space:confluence"
SCOPE_FOLDER = "write:folder:confluence"
MAX_PAGES = 100

# binding key -> folder title, in the template's order
FOLDERS = (("brief", "Brief"), ("gdd", "GDD"),
           ("scope-of-work", "Scope of Work"), ("decisions", "Decisions"),
           ("records", "Records"))


class ConfluenceError(Exception):
    """Backend refusal or failure; message is safe to surface as `reason`."""


def env_gaps() -> list[str]:
    """Each absent variable the gateway client needs, by name."""
    return [f"{name} is not set" for name in (EMAIL_ENV, TOKEN_ENV, CLOUD_ID_ENV)
            if not os.environ.get(name)]


class ConfluenceClient:
    """Minimal Confluence Cloud v2 client through the gateway.

    `transport(method, url, body) -> (status, parsed_body)` is injectable so
    the client is testable offline; the default is urllib over HTTPS.
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
        auth = base64.b64encode(f"{email}:{token}".encode("utf-8")).decode()
        self._headers = {"Authorization": f"Basic {auth}",
                         "Accept": "application/json",
                         "Content-Type": "application/json"}
        self._transport = transport or self._http

    @classmethod
    def from_env(cls, transport=None) -> "ConfluenceClient":
        gaps = env_gaps()
        if gaps:
            raise ConfluenceError("; ".join(gaps))
        return cls(os.environ[CLOUD_ID_ENV], os.environ[EMAIL_ENV],
                   os.environ[TOKEN_ENV], transport,
                   site=os.environ.get(jirabackend.SITE_ENV))

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
                    raise ConfluenceError(jirabackend.non_json_2xx(
                        "Confluence", method, url, resp.status)) from exc
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw)
            except ValueError:
                parsed = raw
            return exc.code, parsed
        except (urllib.error.URLError, OSError) as exc:
            proxied = jirabackend.proxy_refusal("Confluence", method, url,
                                                exc, self.host)
            if proxied:
                raise ConfluenceError(proxied) from exc
            raise ConfluenceError(f"cannot reach {self.host}: {exc}") from exc

    def request(self, method: str, path: str, body: dict | None = None,
                query: dict | None = None, scope: str | None = None):
        url = self.base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        status, data = self._transport(method, url, body)
        reason = jirabackend.auth_failure("Confluence", status, method, path,
                                          data, self.host, TOKEN_ENV,
                                          EMAIL_ENV, scope, site=self.site)
        if reason:
            raise ConfluenceError(reason)
        return status, data


def _refusal(status: int, data) -> str:
    return f"HTTP {status}: {jirabackend._body_text(data)[:300]}"


def _paged_results(client: ConfluenceClient, path: str,
                   query: dict | None = None) -> list[dict]:
    """Every `results[]` entry of a v2 list, following the `_links.next`
    cursor page by page."""
    results: list[dict] = []
    query = dict(query or {})
    for _ in range(MAX_PAGES):
        status, data = client.request("GET", path, query=query or None)
        if status != 200 or not isinstance(data, dict):
            raise ConfluenceError(f"setup: GET {path} returned {status}")
        results += [r for r in data.get("results") or [] if isinstance(r, dict)]
        nxt = (data.get("_links") or {}).get("next")
        if not nxt:
            return results
        cursor = urllib.parse.parse_qs(urllib.parse.urlsplit(nxt).query).get("cursor")
        if not cursor:
            raise ConfluenceError(f"setup: GET {path} gave a next link with "
                                  f"no cursor: {nxt}")
        query["cursor"] = cursor[0]
    raise ConfluenceError(f"setup: GET {path} did not end within {MAX_PAGES} "
                          f"pages")


def find_space(client: ConfluenceClient, key: str) -> dict | None:
    for entry in _paged_results(client, "/spaces", {"keys": key}):
        if entry.get("key") == key:
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


def create_folder(client: ConfluenceClient, space_id: str,
                  title: str) -> tuple[dict | None, str]:
    status, data = client.request("POST", "/folders",
                                  {"spaceId": space_id, "title": title},
                                  scope=SCOPE_FOLDER)
    if status not in (200, 201) or not isinstance(data, dict) \
            or not data.get("id"):
        return None, _refusal(status, data)
    return data, ""
