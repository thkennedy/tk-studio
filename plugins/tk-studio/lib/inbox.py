"""The inbox, derived by the sync-back (Story 31.5, §6.9 items 1 and 2, AD-22).

`_bmad-output/tracking/inbox.json`, version 1:

    {inbox_version: 1, generated_at, project_key,
     items: [{issue, entity?, title?, priority, blocked_since,
              reason_comment: {id, body, created} | null,
              state: open | resolved | validating}]}

One item per issue whose Jira status, read by name, is one of the two setup
statuses: `Blocked - Awaiting User` is `open`, `Block Resolved` is
`resolved`. `validating` is 31.7's to write; an item already `validating`
keeps it while its status is still `Block Resolved`. Canonical `blocked`
alone never makes an item (both setup statuses map onto it, AD-6).

  reason_comment  the issue's newest comment in its comment log whose
                  `author` is `agent`, whose `mentions` include `owner` and
                  whose body is a block comment (the owner's wiki mention
                  then `Blocked:`, as `tk-studio-track block` posts it):
                  every non-owner account logs as `agent`, so a colleague's
                  plain mention of the owner is never the reason
  blocked_since   that comment's `created`; else the item's previous value;
                  else when the tick first saw the status
  priority        the Jira `priority.name` as pulled; else the canonical
                  `priority` mapped (P0 Highest, P1 High, P2 Medium,
                  P3 Low); else null

Sorted by priority rank (Highest to Lowest, an unknown name after them,
null last), then `blocked_since` ascending. Rebuilt from the tick's one
search — never a second one: an issue the search returned updates (or
drops) its item; an item whose issue was not returned is kept (an unchanged
`updated` means an unchanged status); on a first derive only (no
`inbox.json` on disk yet), a local entity whose recorded
`external.jira.status` is a setup status and that has no item is added from
local data. Once the file exists the snapshot never seeds: the snapshot can
be stale (`apply_statuses` leaves it on a both-changed conflict or an
unmapped status), and it would re-add an item a tick had dropped; every later
move into a setup status changes the issue's `updated`, so the search
returns it. The sync-back calls `derive` only after a non-dry-run tick
that read every page, so a dry-run, `rate-limited`, `error` or `blocked`
tick leaves the previous file untouched. Written atomically and named in
`written[]`. Library only; stdlib-only (NFR9).
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import jirabackend
import syncback

INBOX_VERSION = 1
# syncback imports this module: only its functions are read, at call time
TRACKING_REL = Path("_bmad-output") / "tracking"
INBOX_REL = TRACKING_REL / "inbox.json"
STATES = {jirabackend.BLOCKED_STATUS: "open",
          jirabackend.RESOLVED_STATUS: "resolved"}
PRIORITY_RANK = {"Highest": 0, "High": 1, "Medium": 2, "Low": 3, "Lowest": 4}
# the block comment `track.py` posts: the wiki mention, then `Blocked:`
BLOCK_COMMENT_RE = re.compile(r"^\[~accountid:[^\]]+\]\s*Blocked:")
CANONICAL_PRIORITY = {"P0": "Highest", "P1": "High", "P2": "Medium",
                      "P3": "Low"}


def load(root: Path) -> dict:
    """The current inbox file, or `{}` when absent or unreadable."""
    try:
        data = json.loads((Path(root) / INBOX_REL).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def reason_comment(root: Path, key: str) -> dict | None:
    """The newest agent block comment that @mentions the owner, from the log
    (the last line per comment id: an edit appends)."""
    _, lines = syncback._log_lines(
        Path(root) / TRACKING_REL / key / "comments.jsonl")
    latest: dict[str, dict] = {}
    for entry in lines:
        latest[str(entry.get("id"))] = entry
    best, best_at = None, None
    for entry in latest.values():
        if entry.get("author") != "agent" or \
                "owner" not in (entry.get("mentions") or []) or \
                not BLOCK_COMMENT_RE.match(str(entry.get("body") or "")):
            continue
        at = syncback.parse_time(entry.get("created"))
        if at is not None and (best_at is None or at >= best_at):
            best, best_at = entry, at
    if best is None:
        return None
    return {"id": best.get("id"), "body": best.get("body"),
            "created": best.get("created")}


def _priority(pulled, front: dict | None) -> str | None:
    name = (pulled or {}).get("name") if isinstance(pulled, dict) else None
    if isinstance(name, str) and name:
        return name
    return CANONICAL_PRIORITY.get(str((front or {}).get("priority") or ""))


def sort_key(item: dict) -> tuple:
    priority = item.get("priority")
    rank = (len(PRIORITY_RANK) + 1 if priority is None
            else PRIORITY_RANK.get(priority, len(PRIORITY_RANK)))
    since = syncback.parse_time(item.get("blocked_since"))
    return (rank, since is None, since.timestamp() if since else 0.0,
            str(item.get("issue")))


def _item(root: Path, key: str, status: str, pulled_priority,
          front: dict | None, previous: dict | None, now: datetime) -> dict:
    state = STATES[status]
    if state == "resolved" and (previous or {}).get("state") == "validating":
        state = "validating"
    reason = reason_comment(root, key)
    since = (reason or {}).get("created") or (previous or {}).get(
        "blocked_since") or now.isoformat(timespec="seconds")
    item = {"issue": key}
    if front:
        item["entity"] = front.get("id")
        if front.get("title"):
            item["title"] = front["title"]
    elif previous:
        for k in ("entity", "title"):
            if previous.get(k):
                item[k] = previous[k]
    item.update({"priority": _priority(pulled_priority, front),
                 "blocked_since": since, "reason_comment": reason,
                 "state": state})
    return item


def derive(root: Path, result: dict, project_key: str, plan_dir: Path,
           latest: dict[str, dict], now: datetime) -> dict:
    """Rebuild and land `inbox.json` from the tick's search (`latest`: one
    issue per key); returns the inbox. The caller gates it (see above)."""
    root = Path(root)
    first = not (root / INBOX_REL).exists()
    previous = {str(i.get("issue")): i for i in load(root).get("items") or []
                if isinstance(i, dict) and i.get("issue")}
    fronts: dict[str, dict] = {}
    for _, front, _ in jirabackend._load_entities(plan_dir):
        snapshot = (front.get("external") or {}).get(jirabackend.BINDING)
        if isinstance(snapshot, dict) and snapshot.get("key"):
            fronts[str(snapshot["key"])] = front
    items: dict[str, dict] = {}
    for key, issue in latest.items():
        fields = issue.get("fields") or {}
        name = (fields.get("status") or {}).get("name")
        if name in STATES:
            items[key] = _item(root, key, name, fields.get("priority"),
                               fronts.get(key), previous.get(key), now)
    for key, item in previous.items():
        if key not in latest:
            items[key] = item
    for key, front in (fronts.items() if first else ()):
        if key in items or key in latest:
            continue
        name = ((front.get("external") or {}).get(jirabackend.BINDING)
                or {}).get("status")
        if name in STATES:
            items[key] = _item(root, key, name, None, front, None, now)
    inbox = {"inbox_version": INBOX_VERSION,
             "generated_at": now.isoformat(timespec="seconds"),
             "project_key": project_key,
             "items": sorted(items.values(), key=sort_key)}
    jirabackend._atomic_write(root / INBOX_REL, json.dumps(
        inbox, ensure_ascii=False, indent=2) + "\n")
    result["written"].append(INBOX_REL.as_posix())
    return inbox


def mark_validating(root: Path, key: str) -> bool:
    """Story 31.7: rewrite one item's `state` to `validating` (atomically,
    every other field and item untouched) while `tk-studio-track validate`
    judges its resolution. True when the file was rewritten; False when
    there is no inbox, no item for `key`, or it is already `validating`."""
    root = Path(root)
    inbox = load(root)
    items = inbox.get("items")
    if not isinstance(items, list):
        return False
    hit = next((i for i in items if isinstance(i, dict)
                and str(i.get("issue")) == key), None)
    if hit is None or hit.get("state") == "validating":
        return False
    hit["state"] = "validating"
    jirabackend._atomic_write(root / INBOX_REL, json.dumps(
        inbox, ensure_ascii=False, indent=2) + "\n")
    return True
