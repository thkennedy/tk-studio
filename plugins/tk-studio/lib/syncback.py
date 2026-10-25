"""The sync-back tick (Story 31.4, §6.8 c and e, D9, AD-5, AD-22).

Pulls the project's Atlassian state into local memory so that no agent
queries Atlassian live for context:

  - each tracked issue's status, mapped onto the canonical enum by
    `jirabackend.canonical_status` (name first, then category) and applied
    through `jirabackend.apply_statuses` (echo suppression, conflicts), the
    Jira original kept under `external.jira`;
  - its comments, append-only into
    `_bmad-output/tracking/<KEY>/comments.jsonl`, one line per new
    `(id, updated)` pair (an edit appends a line; readers take the last line
    per `id`);
  - its attachments as links, append-only into
    `_bmad-output/tracking/<KEY>/attachments.jsonl` (no download, never an
    upload);
  - every owner-authored page of `planning.confluence.space_id` into
    `kb/confluence/<slug>.md`, storage XHTML verbatim under a provenance
    header; a local edit is overwritten and reported in `overwritten[]`.
  - the inbox (Story 31.5): `_bmad-output/tracking/inbox.json`, derived
    by `inbox.derive` from the tick's search and the comment logs, only
    after a non-dry-run tick that read every page.

One paged JQL search per tick (`GET /rest/api/2/search/jql`), never a GET
per issue; the bound is relative (`updated >= -<n>m`, n = the minutes since
the cursor rounded up plus a five-minute overlap) so no time zone is needed,
ordered `updated ASC` and de-duplicated by key and `updated`. The cursor is
the largest issue `updated` seen and moves only after every page of the
tick was read and logged; an interrupted tick or an unrecorded owner
accountId leaves it where it was. Nothing local
is promoted back, and no entity field other than `status` (with its
`updated` stamp) and the `external.jira` snapshot changes (AD-5).

Library only — sequenced by `plansync.sync_back` (the adapter front door,
AD-4), which owns the refusals and the §3 block. Stdlib-only (NFR9).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import confluence
import inbox
import jirabackend

TRACKING_REL = Path("_bmad-output") / "tracking"
STATE_REL = TRACKING_REL / "sync-state.json"
MIRROR_REL = Path("kb") / "confluence"
OVERLAP_MINUTES = 5
# Story 32.3: `summary` names an engagement issue (`ENG-NNN: questions`)
SEARCH_FIELDS = "status,updated,comment,attachment,priority,summary"
KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*-\d+$")
MENTION_RE = re.compile(r"\[~accountid:([^\]\s]+)\]")
HEADER_HASH_RE = re.compile(r"^content_hash: sha256:([0-9a-f]{64})$",
                            re.MULTILINE)
# a run's `case`, most telling first: the plane reports the named states;
# `error` (a non-network request error) and `rate-limited` (an exhausted
# 429) are run cases the plane reads by age and status, not plane cases
CASE_RANK = ("token-missing", "auth", "deactivated", "unreachable",
             "error", "rate-limited", "ok")
# a tick in either case leaves `inbox.json` untouched (Story 31.5)
INBOX_HOLD_CASES = ("rate-limited", "error")
UNREACHABLE_RE = re.compile(r"\bcannot reach\b|\breturned 5\d\d\b")
SIGN_IN_FIX = ("the owner signs in to the site and opens a Jira issue and a "
               "Confluence page (kb/atlassian-free-tier.md §1 step 10) — the "
               "loop never relies on its own API traffic to keep a Free site "
               "active")


def new_result(dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "case": None,
            "counts": {"issues": 0, "statuses_applied": 0, "conflicts": 0,
                       "comments_seen": 0, "comments_appended": 0,
                       "attachments_appended": 0, "pages_mirrored": 0,
                       "pages_unchanged": 0, "pages_overwritten": 0},
            "newest_comment": None, "applied": [], "conflicts": [],
            "overwritten": [], "rate_limit": {}, "notes": [], "written": []}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value) -> datetime | None:
    """A Jira/ISO timestamp (`2026-10-24T10:00:00.000+0000`) as an aware
    datetime, or None."""
    if not isinstance(value, str) or not value:
        return None
    for parse in (datetime.fromisoformat,
                  lambda v: datetime.strptime(v, "%Y-%m-%dT%H:%M:%S.%f%z"),
                  lambda v: datetime.strptime(v, "%Y-%m-%dT%H:%M:%S%z")):
        try:
            parsed = parse(value)
        except ValueError:
            continue
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def jql_for(project_key: str, cursor: str | None, now: datetime) -> str:
    """The tick's one search: the project, bounded relatively from the
    cursor with the overlap (none on the first tick), oldest first."""
    clause = f'project = "{project_key}"'
    since = parse_time(cursor)
    if since is not None:
        minutes = math.ceil(max((now - since).total_seconds(), 0) / 60)
        clause += f" AND updated >= -{minutes + OVERLAP_MINUTES}m"
    return clause + " ORDER BY updated ASC"


def load_state(root: Path) -> dict:
    try:
        data = json.loads((root / STATE_REL).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _rel(root: Path, path: Path | str) -> str:
    try:
        return Path(path).resolve().relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _read_text(path: Path) -> str | None:
    """The file's text with its line endings untouched, or None."""
    try:
        return path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _who(account_id, owner: str, agent: str | None) -> str:
    """`owner` only for the recorded, non-empty owner accountId; else
    `agent` (the AC's two values)."""
    return "owner" if owner and account_id == owner else "agent"


def _mention(account_id: str, owner: str, agent: str | None) -> str:
    if owner and account_id == owner:
        return "owner"
    if agent and account_id == agent:
        return "agent"
    return account_id


def _set_case(result: dict, case: str) -> None:
    current = result.get("case") or "ok"
    if CASE_RANK.index(case) < CASE_RANK.index(current):
        result["case"] = case
    else:
        result["case"] = current


def classify(exc: Exception) -> str:
    """The run case of a client error: the 401/403 split (and the proxy's
    network approval) is `auth`; a connection error or a 5xx is
    `unreachable` (Settled shape 4); any other request error (a 400 on the
    search, another 4xx, a pager that never ended) is `error`."""
    text = str(exc)
    if isinstance(exc, (jirabackend.RateLimited, confluence.RateLimited)):
        return "rate-limited"
    if any(mark in text for mark in ("returned 401", "returned 403",
                                     "network proxy")):
        return "auth"
    if UNREACHABLE_RE.search(text):
        return "unreachable"
    return "error"


# ------------------------------------------------------------------ state

def write_state(root: Path, result: dict, state: dict, status: str,
                reason: str | None, now: datetime) -> None:
    """Land `sync-state.json` with this run's `last_run` (never on a dry
    run); the path joins `written[]`. A run that read no comment (a
    refusal, a failed preflight) carries the previous `newest_comment`
    forward."""
    if result["newest_comment"] is None:
        result["newest_comment"] = (state.get("last_run") or {}).get(
            "newest_comment")
    if result["dry_run"]:
        return
    state = dict(state)
    state["last_run"] = {"at": now.isoformat(timespec="seconds"),
                         "status": status, "case": result.get("case") or "ok",
                         "counts": dict(result["counts"]),
                         "newest_comment": result["newest_comment"],
                         "reason": reason}
    if result["rate_limit"]:
        state["rate_limit"] = result["rate_limit"]
    state.setdefault("cursor", None)
    state.setdefault("pages", {})
    jirabackend._atomic_write(root / STATE_REL, json.dumps(
        state, ensure_ascii=False, indent=2) + "\n")
    result["written"].append(STATE_REL.as_posix())


def record_refusal(root: Path, result: dict, case: str, reason: str,
                   now: datetime | None = None) -> None:
    """A bound project's refusal (an absent variable) is still the last
    run, so the drift plane names it (Settled shape 4)."""
    result["case"] = case
    write_state(root, result, load_state(root), "blocked", reason,
                now or _now())


# ---------------------------------------------------------------- the logs

def _log_lines(path: Path) -> tuple[str, list[dict]]:
    text = _read_text(path) or ""
    lines = []
    for raw in text.splitlines():
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        if isinstance(entry, dict):
            lines.append(entry)
    return text, lines


def _append(root: Path, result: dict, path: Path, text: str,
            new: list[dict]) -> None:
    if not new or result["dry_run"]:
        return
    if text and not text.endswith("\n"):
        text += "\n"
    text += "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in new)
    jirabackend._atomic_write(path, text)
    result["written"].append(_rel(root, path))


def log_comments(root: Path, result: dict, key: str, comments: list[dict],
                 owner: str, agent: str | None) -> list[dict]:
    """Append each comment whose `(id, updated)` pair is new; return the
    log lines this tick saw (for the newest comment)."""
    path = root / TRACKING_REL / key / "comments.jsonl"
    text, lines = _log_lines(path)
    seen = {(str(e.get("id")), e.get("updated")) for e in lines}
    new, observed = [], []
    for comment in comments:
        if comment.get("id") is None:
            continue
        body = comment.get("body")
        body = body if isinstance(body, str) else json.dumps(body)
        entry = {"issue": key, "id": str(comment["id"]),
                 "author": _who((comment.get("author") or {}).get("accountId"),
                                owner, agent),
                 # Story 31.5 (additive): the owner's reply is the owner's
                 # only when both author and updateAuthor are the owner
                 "update_author": _who(
                     (comment.get("updateAuthor") or {}).get("accountId"),
                     owner, agent),
                 "body": body,
                 "mentions": [_mention(m, owner, agent)
                              for m in MENTION_RE.findall(body)],
                 "created": comment.get("created"),
                 "updated": comment.get("updated") or comment.get("created"),
                 "source": "jira"}
        observed.append(entry)
        pair = (entry["id"], entry["updated"])
        if pair in seen:
            continue
        seen.add(pair)
        new.append(entry)
    result["counts"]["comments_seen"] += len(observed)
    result["counts"]["comments_appended"] += len(new)
    _append(root, result, path, text, new)
    return observed


def log_attachments(root: Path, result: dict, key: str,
                    attachments: list[dict], owner: str,
                    agent: str | None) -> None:
    """Append each attachment with a new `id`, as a link only."""
    path = root / TRACKING_REL / key / "attachments.jsonl"
    text, lines = _log_lines(path)
    seen = {str(e.get("id")) for e in lines}
    new = []
    for att in attachments:
        if att.get("id") is None or str(att["id"]) in seen:
            continue
        seen.add(str(att["id"]))
        new.append({"issue": key, "id": str(att["id"]),
                    "filename": att.get("filename"),
                    "mime": att.get("mimeType"), "size": att.get("size"),
                    "author": _who((att.get("author") or {}).get("accountId"),
                                   owner, agent),
                    "created": att.get("created"), "url": att.get("content"),
                    "source": "jira"})
    result["counts"]["attachments_appended"] += len(new)
    _append(root, result, path, text, new)


def _newest(entries: list[dict], previous: dict | None) -> dict | None:
    best, best_at = None, None
    for entry in ([previous] if isinstance(previous, dict) else []) + entries:
        at = parse_time(entry.get("created"))
        if at is not None and (best_at is None or at > best_at):
            best_at = at
            best = {k: entry.get(k) for k in ("issue", "id", "author",
                                              "created", "updated")}
    return best


# --------------------------------------------------------------- the mirror

def slug_for(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "page"


def _header(page: dict, space_key: str | None, site: str | None,
            synced_at: str, digest: str) -> str:
    webui = page.get("webui") or ""
    url = f"https://{site}/wiki{webui}" if site and webui else webui
    lines = ["---", "source: confluence",
             f"page_id: {json.dumps(page['id'])}",
             f"title: {json.dumps(page['title'], ensure_ascii=False)}",
             f"space_key: {json.dumps(space_key or '')}",
             "author: owner", f"version: {int(page['version'])}",
             f"url: {json.dumps(url, ensure_ascii=False)}",
             f"synced_at: {json.dumps(synced_at)}", "read_only: true",
             f"content_hash: sha256:{digest}", "---", ""]
    return "\n".join(lines)


def _split_mirror(text: str) -> tuple[str | None, str, str]:
    """(header hash, body, header) of a mirror file; (None, text, "") when
    no header."""
    if not text.startswith("---\n"):
        return None, text, ""
    end = text.find("\n---\n", 3)
    if end < 0:
        return None, text, ""
    header, body = text[:end], text[end + len("\n---\n"):]
    found = HEADER_HASH_RE.search(header)
    return (found.group(1) if found else None), body, header


def _header_lines(header: str, skip: set[str]) -> list[str]:
    """The header's lines (no `---`), minus those whose key is in `skip`."""
    return [line for line in header.split("\n")[1:]
            if line.split(":", 1)[0] not in skip]


def _mirror_edited(local: str, page: dict, known, space_key: str | None,
                   site: str | None) -> tuple[bool, str | None]:
    """(edited, header hash) of a local mirror file. Unedited means the body
    matches the header's `content_hash` and the provenance header, its
    `synced_at` aside, is the one `_header` writes for that digest. A file
    checked out with CRLF line endings is read LF-normalized too. When the
    page has a new version since the last mirror, its title and url may
    have moved remotely, so those two are not compared. With no recorded
    entry for the page (sync-state.json lost, unreadable or never naming
    it) the mirrored version is unknown, so `version`, `title` and `url`
    are none of them compared: the body hash and the other lines decide."""
    candidates = [local]
    if "\r\n" in local:
        candidates.append(local.replace("\r\n", "\n"))
    first_hash = None
    for index, text in enumerate(candidates):
        header_hash, body, header = _split_mirror(text)
        if index == 0:
            first_hash = header_hash
        if header_hash is None or header_hash != _sha(body):
            continue
        skip = {"synced_at"}
        version = page["version"]
        if not isinstance(known, dict):
            skip |= {"version", "title", "url"}
        elif known.get("version") is not None:
            if known.get("version") != page["version"]:
                skip |= {"title", "url"}
            version = known["version"]
        try:
            expected = _header({**page, "version": version}, space_key, site,
                               "", header_hash)
        except (TypeError, ValueError):
            continue
        if _header_lines(header, skip) == _header_lines(
                expected[:expected.rfind("\n---\n")], skip):
            return False, header_hash
    return True, first_hash


def mirror_pages(root: Path, result: dict, state: dict, conf, space_id: str,
                 space_key: str | None, owner: str, site: str | None,
                 excluded: set[str], now: datetime) -> None:
    """Mirror every owner-authored page of the space (not one tk-studio
    published) into `kb/confluence/`; overwrite and report a local edit;
    leave an unchanged page alone; name a page gone or no longer the
    owner's in `notes[]`, leaving its file on disk."""
    pages_state = state.setdefault("pages", {})
    pages = [p for p in confluence.list_space_pages(conf, space_id)
             if p["author_id"] and p["author_id"] == owner
             and p["id"] not in excluded]
    taken = {v.get("path"): pid for pid, v in pages_state.items()
             if isinstance(v, dict)}
    synced_at = now.isoformat(timespec="seconds")
    for page in pages:
        known = pages_state.get(page["id"])
        rel = known.get("path") if isinstance(known, dict) else None
        if not rel:
            slug = slug_for(page["title"])
            rel = (MIRROR_REL / f"{slug}.md").as_posix()
            if taken.get(rel, page["id"]) != page["id"]:
                rel = (MIRROR_REL / f"{slug}-{page['id']}.md").as_posix()
        taken[rel] = page["id"]
        path = root / rel
        digest = _sha(page["body"])
        local = _read_text(path)
        edited, header_hash = (
            _mirror_edited(local, page, known, space_key, site)
            if local is not None else (False, None))
        if isinstance(known, dict) and not edited and local is not None \
                and known.get("version") == page["version"] \
                and known.get("content_hash") == f"sha256:{header_hash}":
            result["counts"]["pages_unchanged"] += 1
            continue
        if edited:
            result["overwritten"].append(rel)
            result["counts"]["pages_overwritten"] += 1
        result["counts"]["pages_mirrored"] += 1
        pages_state[page["id"]] = {"path": rel, "version": page["version"],
                                   "content_hash": f"sha256:{digest}"}
        if result["dry_run"]:
            continue
        jirabackend._atomic_write(path, _header(page, space_key, site,
                                                synced_at, digest)
                                  + page["body"])
        result["written"].append(rel)
    current = {p["id"] for p in pages}
    for page_id, entry in sorted(pages_state.items()):
        if page_id not in current and isinstance(entry, dict):
            result["notes"].append(
                f"Confluence page {page_id} is gone or no longer the "
                f"owner's — {entry.get('path')} left on disk")
    if excluded:
        result["notes"].append(f"{len(excluded)} page(s) tk-studio published "
                               f"(.tk-studio/confluence-pages.json) are not "
                               f"mirrored")


# ----------------------------------------------------------------- the tick

def _latest(issues: list[dict]) -> dict[str, dict]:
    """One issue per key — the largest `updated` — over every page."""
    latest: dict[str, dict] = {}
    for issue in issues:
        key = issue.get("key")
        if not isinstance(key, str):
            continue
        at = parse_time((issue.get("fields") or {}).get("updated"))
        prior = latest.get(key)
        prior_at = parse_time(((prior or {}).get("fields") or {}).get("updated"))
        if prior is None or (at is not None and
                             (prior_at is None or at >= prior_at)):
            latest[key] = issue
    return latest


def tick(root: Path, result: dict, binding: dict, plan_dir: Path, jira,
         conf, conf_gaps: list[str], now: datetime | None = None
         ) -> tuple[str, str | None]:
    """One sync-back tick into `result`; returns (status, reason).

    `binding` carries the recorded `project_key`, `owner_account_id`,
    `agent_account_id`, `site`, `space_id`, `space_key` and the
    `published` page ids to exclude. `conf` is None when `conf_gaps`
    names an absent Confluence variable: the Jira half still runs and the
    run is `partial` with case `token-missing`."""
    now = now or _now()
    root = Path(root)
    dry_run = result["dry_run"]
    state = load_state(root)
    notes, partial = result["notes"], []
    owner = binding.get("owner_account_id") or ""
    result["case"] = "ok"

    def rate_limits() -> dict:
        record = {"jira": jira.rate_limit}
        if conf is not None:
            record["confluence"] = conf.rate_limit
        return record

    # 1. preflight: GET /myself (the token and the org toggle in one probe)
    reason = None
    try:
        status, me = jira.request("GET", "/myself")
    except jirabackend.JiraError as exc:
        status, me = None, None
        reason = f"sync-back preflight: {exc}"
        result["case"] = classify(exc)
    if reason is None and status in (404, 410):
        result["case"] = "deactivated"
        reason = (f"sync-back preflight: GET /myself returned {status} — the "
                  f"site looks deactivated (Free products are deactivated "
                  f"after 120 days without a person's activity): "
                  f"{SIGN_IN_FIX}")
    elif reason is None and status != 200 and \
            isinstance(status, int) and status >= 500:
        result["case"] = "unreachable"
        reason = (f"sync-back preflight: GET /myself returned {status} — the "
                  f"site is unreachable; rerun once it answers")
    elif reason is None and status != 200:
        result["case"] = "error"
        reason = (f"sync-back preflight: GET /myself returned {status} — "
                  f"not a reachability failure; check the request and rerun")
    if reason is not None:
        result["rate_limit"] = rate_limits()
        if result["case"] == "rate-limited":
            write_state(root, result, state, "partial", reason, now)
            return "partial", reason
        write_state(root, result, state, "blocked", reason, now)
        return "blocked", reason
    agent = binding.get("agent_account_id") or (me or {}).get("accountId")

    # 2. the one paged search
    jql = jql_for(binding["project_key"], state.get("cursor"), now)
    issues = None
    try:
        issues = jirabackend.search_jql(jira, jql, SEARCH_FIELDS)
    except jirabackend.JiraError as exc:
        _set_case(result, classify(exc))
        partial.append(f"search interrupted ({exc}) — cursor unchanged")
    complete_read = issues is not None
    had_cursor, prior_cursor = "cursor" in state, state.get("cursor")
    observed: list[dict] = []
    latest: dict[str, dict] = {}
    if issues is not None:
        latest = _latest(issues)
        result["counts"]["issues"] = len(latest)
        statuses = {}
        for key, issue in latest.items():
            st = (issue.get("fields") or {}).get("status") or {}
            statuses[key] = (st.get("name"),
                             (st.get("statusCategory") or {}).get("key"))
        applied = jirabackend.apply_statuses(plan_dir, statuses, dry_run)
        result["applied"] += [{**a, "path": _rel(root, a["path"])}
                              for a in applied["applied"]]
        result["conflicts"] += [{**c, "canonical": _rel(root, c["canonical"])}
                                for c in applied["conflicts"]]
        notes += applied["notes"]
        # a snapshot-only refresh (`external.jira.status`) changed no
        # canonical status, so it stays in applied[] but is not counted
        result["counts"]["statuses_applied"] = sum(
            1 for a in applied["applied"] if "status" in a["fields"])
        result["counts"]["conflicts"] = len(applied["conflicts"])
        if not dry_run:
            result["written"] += [a["path"] for a in result["applied"]]
        if applied["conflicts"]:
            partial.append("both-changed status conflict(s): " + ", ".join(
                c["id"] for c in applied["conflicts"]))
        if not owner:
            # the cursor stays put: once the owner is recorded the next
            # tick re-reads these issues and logs what was skipped
            complete_read = False
            partial.append(
                "planning.jira.owner_account_id is not recorded — comments, "
                "attachments and the owner-page mirror skipped (an "
                "append-only log never misattributes an author), cursor "
                "unchanged; rerun `plansync.py setup --owner-account-id <id>`")
        for key in sorted(latest) if owner else []:
            if not KEY_RE.match(key):
                notes.append(f"issue key {key!r} is not a Jira key — its "
                             f"comments and attachments were not logged")
                continue
            fields = latest[key].get("fields") or {}
            block = fields.get("comment") or {}
            comments = [c for c in block.get("comments") or []
                        if isinstance(c, dict)]
            total = block.get("total")
            if isinstance(total, int) and total > len(comments):
                try:
                    comments = jirabackend.issue_comments(jira, key)
                except jirabackend.JiraError as exc:
                    _set_case(result, classify(exc))
                    partial.append(f"{key}: comment overflow read "
                                   f"interrupted ({exc}) — cursor unchanged")
                    complete_read = False
            observed += log_comments(root, result, key, comments, owner,
                                     agent)
            log_attachments(root, result, key,
                            [a for a in fields.get("attachment") or []
                             if isinstance(a, dict)], owner, agent)
        if complete_read:
            stamps = [(parse_time((i.get("fields") or {}).get("updated")),
                       (i.get("fields") or {}).get("updated"))
                      for i in latest.values()]
            stamps = [s for s in stamps if s[0] is not None]
            if state.get("cursor"):
                prior = parse_time(state["cursor"])
                if prior is not None:
                    stamps.append((prior, state["cursor"]))
            if stamps:
                state["cursor"] = max(stamps, key=lambda s: s[0])[1]
    previous = (state.get("last_run") or {}).get("newest_comment")
    result["newest_comment"] = _newest(observed, previous)

    # 3. the owner-page mirror (Confluence token, recorded space, owner)
    if not owner:
        pass  # named above
    elif conf is None:
        _set_case(result, "token-missing")
        partial.append("owner-page mirror skipped: " + "; ".join(conf_gaps)
                       + " (kb/atlassian-free-tier.md §1 step 7)")
    elif not binding.get("space_id"):
        partial.append("owner-page mirror skipped: "
                       "planning.confluence.space_id is not recorded — run "
                       "`plansync.py setup` first")
    else:
        try:
            mirror_pages(root, result, state, conf, binding["space_id"],
                         binding.get("space_key"), owner, binding.get("site"),
                         set(binding.get("published") or ()), now)
        except confluence.ConfluenceError as exc:
            _set_case(result, classify(exc))
            partial.append(f"owner-page mirror interrupted ({exc})")

    # 4. the inbox (Story 31.5): only from a non-dry-run tick whose search
    # read every page (no second search: `inbox` merges with the last file).
    # Every case is settled by here (the mirror ran above) and a `blocked`
    # tick returned early, so a `rate-limited` or `error` case — a later
    # page-mirror 429 or error included — leaves the previous file as it is
    if complete_read and not dry_run and \
            result.get("case") not in INBOX_HOLD_CASES:
        inbox.derive(root, result, binding["project_key"], plan_dir, latest,
                     now)
    elif complete_read and not dry_run:
        # the inbox is held, so the cursor must not pass the issues this
        # tick read: an issue that left `Blocked - Awaiting User` here would
        # otherwise never be re-read and keep its open item. Re-reading is
        # safe — the logs append once per (id, updated) / id and a status
        # already applied changes nothing
        if had_cursor:
            state["cursor"] = prior_cursor
        else:
            state.pop("cursor", None)
        partial.append(f"inbox held (case {result.get('case')!r}) — cursor "
                       f"unchanged, so the next tick re-reads these issues")

    result["rate_limit"] = rate_limits()
    for name, record in result["rate_limit"].items():
        for hit in record["throttled"]:
            notes.append(f"{name} 429 on {hit['method']} {hit['path']} "
                         f"(RateLimit-Reason: {hit['reason'] or 'not given'}, "
                         f"Retry-After: {hit['retry_after'] or 'absent'})")
    if dry_run:
        notes.append("dry run: nothing written — no status applied, no log "
                     "appended, no page mirrored, the cursor not moved")
    status = "partial" if partial else "complete"
    reason = ("sync-back partial: " + "; ".join(partial)) if partial else None
    write_state(root, result, state, status, reason, now)
    return status, reason
