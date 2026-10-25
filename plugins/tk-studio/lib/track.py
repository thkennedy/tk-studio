"""tk-studio-track — the `block` verb (Story 31.5, §6.9 items 1 and 2, §7.4)
and the `reply` verb (Story 31.6).

When the loop cannot progress a story, its Jira issue — and each dependent
story's issue (the canonical story entities whose `depends_on` names it,
AD-6; a dependent already `done` or `dropped` is skipped with a note) —
moves to `Blocked - Awaiting User` with one agent comment that @mentions the
owner, names the reason and says what resolves it:

    [~accountid:<owner>] Blocked: <reason>
    Resolves when: <resolves>
    Blocked by: <story's key>          (a dependent's comment only)

  uv run track.py block --directory ROOT --story <ST-NNN | N-M-slug>
      --reason TEXT --resolves TEXT [--source run|engagement] [--dry-run]

The transition is by the target status's name, never its category, and is
skipped for an issue already in the status; the comment is skipped only when
the issue was already in the status before this run (no transition made)
and its newest agent comment (read live, `GET /issue/<KEY>/comment`; agent
is anyone not the owner) has the same body — a re-block after `Block
Resolved` always comments, so the owner is mentioned again. Every Atlassian write goes through
`jirabackend` (AD-4); nothing else is promoted (D9) and no local file is
written. Refusals end `blocked` (exit 2), each by name: no `planning.jira`
binding or an absent Jira variable (before any call), no recorded
`planning.jira.owner_account_id` (the mention needs it — an absent or empty
accountId never matches), a story with no plan entity or never promoted (no
`external.jira.key`), no transition reaching the status, or the block
comment refused by name after the transition (the entry keeps
`transitioned: true`). A dependent that fails while the story succeeded ends
`partial`. A temporary failure (an exhausted 429, a 5xx, the site
unreachable) on the story's own issue or on a dependent's is no refusal: it
ends `partial` with `ok: false` and `retry: true`, so the caller calls again
on its next pass. Every result ends with the
§3 status block (AD-11). `--source engagement` fixes the shape for the
engagement loop's questions (EP-32); the supervisor's paused-run pass is
the caller today (`--source run`). Stdlib-only (NFR9); never prompts.

The `reply` verb (Story 31.6, §6.9 items 3 and 4) is the owner's answer:

  uv run track.py reply --directory ROOT --issue <KEY>
      (--body-file PATH | --done) [--dry-run]

It posts the comment (`--done` writes `Done.`) with the owner seat's
client (`jirabackend.owner_client`: TK_STUDIO_ATLASSIAN_OWNER_EMAIL and
TK_STUDIO_ATLASSIAN_OWNER_TOKEN through the TK_ATLASSIAN_CLOUD_ID gateway,
REST v2, plain text), then moves the issue by name to `Block Resolved`; an
issue already there skips the transition, named in `skipped[]`. The body
comes from a file, never the command line. Only the supervisor's `POST
/inbox/{key}/reply` calls it, on the host: the owner's variables never
reach the sandbox. Refusals end `blocked` (exit 2), each by name: an absent
owner variable or cloud id, or no `planning.jira` binding (both before any
call, `no Atlassian call made`); no recorded
`planning.jira.owner_account_id`; a created comment whose author is not
the owner (another seat's token: nothing is moved); no transition reaching
`Block Resolved` (the comment stays, `commented: true`). A temporary
failure ends `partial` with `ok: false` and `retry: true`. An owner comment
with the same body after the issue's newest agent comment (read live) is
not posted again — a retry or a second Done — and is named in `skipped[]`
(`commented: true`, its id), and the transition still runs. No local file is
written and nothing else is promoted (D9).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import config as configlib
import jirabackend
import plansync
import syncback

INTENT = "tk-studio-track"
SOURCES = ("run", "engagement")
FINISHED = ("done", "dropped")
ENTITY_ID_RE = re.compile(r"^(EP|ST|TA)-\d{3,}$")
ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]+-\d+$")
DONE_BODY = "Done."
STORY_KEY_RE = re.compile(r"^(\d+)[.-](\d+)(?:-|$)")


def _result(story: str, source: str, dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "story": story, "source": source,
            "issues": [], "notes": [], "written": []}


def _finish(result: dict, status: str, reason: str | None,
            ok: bool | None = None) -> dict:
    result["ok"] = status != "blocked" if ok is None else ok
    result.update({"status": status, "intent": INTENT,
                   "artifacts": list(result["written"]), "reason": reason})
    return result


def transient(exc: Exception) -> bool:
    """A temporary Jira failure, retried on the caller's next pass rather
    than refused: an exhausted 429 (`RateLimited`), a 5xx or the site
    unreachable — the sync-back's own `rate-limited` and `unreachable`
    cases (`syncback.classify`)."""
    return syncback.classify(exc) in ("rate-limited", "unreachable")


def comment_body(owner: str, reason: str, resolves: str,
                 blocked_by: str | None = None) -> str:
    """The block comment: the owner's wiki mention (REST v2), the reason and
    what resolves it; a dependent's names the story's issue."""
    body = (f"[~accountid:{owner}] Blocked: {reason.strip()}\n"
            f"Resolves when: {resolves.strip()}")
    if blocked_by:
        body += f"\nBlocked by: {blocked_by}"
    return body


def newest_agent_body(client, key: str, owner: str) -> str | None:
    """The plain body of the issue's newest agent comment, read live (`GET
    /issue/{key}/comment` through `jirabackend`, never the sync-back's log,
    which only the timer writes): agent is anyone not the owner, as the
    sync-back and the inbox read it. None when there is none."""
    best, best_at = None, None
    for c in jirabackend.issue_comments(client, key):
        author = (c.get("author") or {}).get("accountId")
        if not author or author == owner:
            continue
        at = syncback.parse_time(c.get("created"))
        # Jira lists oldest first: a later equal (or unparsed) stamp wins
        if best is None or at is None or best_at is None or at >= best_at:
            best, best_at = c, at
    body = (best or {}).get("body")
    return body.strip() if isinstance(body, str) else None


def resolve_story(plan_dir: Path, story: str
                  ) -> tuple[dict | None, list[dict], str | None]:
    """(the story's frontmatter, its dependents' frontmatters, refusal). The
    story is an entity id, or a loop story key `N-M-…` matched by the
    entity's `source: epics.md#story-N.M`. Dependents are the story
    entities (`type: story`) whose `depends_on` names it."""
    entities = [front for _, front, _ in jirabackend._load_entities(plan_dir)]
    if ENTITY_ID_RE.match(story):
        hits = [f for f in entities if f["id"] == story]
    else:
        m = STORY_KEY_RE.match(story)
        if not m:
            return None, [], (f"--story {story!r} is neither an entity id "
                              f"(ST-NNN) nor a loop story key (N-M-slug)")
        want = f"epics.md#story-{int(m.group(1))}.{int(m.group(2))}"
        hits = [f for f in entities
                if str(f.get("source") or "").strip() == want]
    if len(hits) != 1:
        return None, [], (f"{'several plan entities' if hits else 'no plan entity'}"
                          f" for story {story!r} under {plan_dir}")
    front = hits[0]
    dependents = [f for f in entities
                  if f.get("type") == "story"
                  and front["id"] in (f.get("depends_on") or [])]
    return front, dependents, None


def _jira_key(front: dict) -> str | None:
    snapshot = (front.get("external") or {}).get(jirabackend.BINDING)
    key = snapshot.get("key") if isinstance(snapshot, dict) else None
    return str(key) if key else None


def _block_issue(client, owner: str, front: dict, key: str, role: str,
                 body: str, dry_run: bool, notes: list[str]) -> dict:
    """Move one issue and post its comment; the issue's entry. A refused
    transition sets `error` (and posts no comment); a comment refused by
    name after the transition sets `error` too, `transitioned` kept true. A
    temporary failure raises (the caller's retry path)."""
    entry = {"issue": key, "entity": front["id"], "role": role,
             "transitioned": False, "commented": False}
    skipped: list[str] = []
    name, _ = jirabackend._current_status(client, key)
    if name == jirabackend.BLOCKED_STATUS:
        skipped.append(f"transition: {key} is already in "
                       f"{jirabackend.BLOCKED_STATUS!r}")
    elif dry_run:
        notes.append(f"dry run: {key} would move from {name!r} to "
                     f"{jirabackend.BLOCKED_STATUS!r}")
    elif jirabackend.transition_to_name(client, key,
                                        jirabackend.BLOCKED_STATUS, notes,
                                        front["id"]) is None:
        entry["error"] = (f"no transition reaches "
                          f"{jirabackend.BLOCKED_STATUS!r} from {name!r}")
        if skipped:
            entry["skipped"] = skipped
        return entry
    else:
        entry["transitioned"] = True
    if name == jirabackend.BLOCKED_STATUS and \
            newest_agent_body(client, key, owner) == body.strip():
        skipped.append(f"comment: {key}'s newest agent comment already "
                       f"says this")
    elif dry_run:
        notes.append(f"dry run: {key} would get the block comment")
    else:
        try:
            jirabackend.add_comment(client, key, body)
        except jirabackend.JiraError as exc:
            if transient(exc):
                raise
            entry["error"] = f"block comment refused: {exc}"
            if skipped:
                entry["skipped"] = skipped
            return entry
        entry["commented"] = True
    if skipped:
        entry["skipped"] = skipped
    return entry


def block(project_root: Path, story: str, reason: str, resolves: str,
          source: str = "run", dry_run: bool = False, transport=None,
          sleep=None) -> dict:
    """The `block` verb (see the module docstring)."""
    root = Path(project_root).resolve()
    result = _result(story, source, dry_run)

    def refuse(why: str) -> dict:
        return _finish(result, "blocked", f"track refused: {why}")

    if source not in SOURCES:
        return refuse(f"--source {source!r} is not one of {', '.join(SOURCES)}")
    if not (reason or "").strip() or not (resolves or "").strip():
        return refuse("--reason and --resolves must both name something")
    if plansync._recorded(root, "planning.jira.project_key") is None:
        return refuse("planning.jira.project_key is not recorded (no "
                      "planning.jira binding) — run `plansync.py setup` "
                      "first; no Atlassian call made")
    settings, gaps = jirabackend._resolve_settings(root, None)
    if not os.environ.get(jirabackend.AGENT_TOKEN_ENV) \
            and not os.environ.get(jirabackend.TOKEN_ENV):
        gaps.insert(0, f"{jirabackend.AGENT_TOKEN_ENV} is not set (the "
                       f"agent seat's Jira token)")
    if gaps:
        return refuse("; ".join(gaps) + " — no Atlassian call made")
    owner = plansync._recorded(root, "planning.jira.owner_account_id")
    if owner is None:
        return refuse("planning.jira.owner_account_id is not recorded — the "
                      "block comment @mentions the owner; rerun `plansync.py "
                      "setup --owner-account-id <id>`; no Atlassian call made")
    front, dependents, gap = resolve_story(plansync.plan_dir(root), story)
    if gap:
        return refuse(gap + "; no Atlassian call made")
    key = _jira_key(front)
    if key is None:
        return refuse(f"{front['id']} was never promoted (no "
                      f"external.jira.key) — run `plansync.py sync` under "
                      f"the jira binding first; no Atlassian call made")

    client = jirabackend.client_for(settings, transport)
    if sleep is not None:
        client.sleep = sleep
    notes = result["notes"]
    try:
        entry = _block_issue(client, owner, front, key, "story",
                             comment_body(owner, reason, resolves), dry_run,
                             notes)
    except jirabackend.JiraError as exc:
        result["issues"].append({"issue": key, "entity": front["id"],
                                 "role": "story", "transitioned": False,
                                 "commented": False, "error": str(exc)})
        if transient(exc):
            result["retry"] = True
            return _finish(result, "partial", f"track retry: {key}: {exc} — "
                           f"a temporary failure; call again on the next "
                           f"pass", ok=False)
        return refuse(f"{key}: {exc}")
    result["issues"].append(entry)
    if "error" in entry:
        return refuse(f"{key} ({front['id']}): {entry['error']}")

    failed, retry = [], []
    for dep in dependents:
        if dep.get("status") in FINISHED:
            notes.append(f"{dep['id']}: a dependent already "
                         f"{dep.get('status')!r} — not blocked")
            continue
        dep_key = _jira_key(dep)
        if dep_key is None:
            result["issues"].append({
                "issue": None, "entity": dep["id"], "role": "dependent",
                "transitioned": False, "commented": False,
                "error": "never promoted (no external.jira.key)"})
            failed.append(f"{dep['id']}: never promoted")
            continue
        try:
            dep_entry = _block_issue(
                client, owner, dep, dep_key, "dependent",
                comment_body(owner, reason, resolves, blocked_by=key),
                dry_run, notes)
        except jirabackend.JiraError as exc:
            dep_entry = {"issue": dep_key, "entity": dep["id"],
                         "role": "dependent", "transitioned": False,
                         "commented": False, "error": str(exc)}
            if transient(exc):
                retry.append(f"{dep_key} ({dep['id']}): {exc}")
        result["issues"].append(dep_entry)
        if "error" in dep_entry:
            failed.append(f"{dep_key} ({dep['id']}): {dep_entry['error']}")
    if retry:
        # the story's issue is blocked, a dependent's failure is temporary:
        # the caller records nothing and calls again (the re-block skips
        # what already landed)
        result["retry"] = True
        return _finish(result, "partial", f"track retry: the story's issue "
                       f"{key} is blocked, but dependent(s) failed ("
                       + "; ".join(failed) + f"), {len(retry)} on a temporary "
                       f"failure — call again on the next pass", ok=False)
    if failed:
        return _finish(result, "partial", "track partial: the story's issue "
                       f"{key} is blocked, but dependent(s) failed: "
                       + "; ".join(failed))
    if dry_run and any(n.startswith("dry run:") for n in notes):
        return _finish(result, "partial", "dry run: nothing written; a real "
                       "run would move or comment as `notes[]` names")
    return _finish(result, "complete", None)


# ------------------------------------------------------------------- reply

def _reply_result(issue: str, dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "issue": issue,
            "commented": False, "comment_id": None, "transitioned": False,
            "notes": [], "skipped": [], "written": []}


def owner_reply_in_place(client, key: str, owner: str,
                         text: str) -> str | None:
    """The id of an owner comment with the same body posted after the
    issue's newest agent comment (read live, `GET /issue/{key}/comment`
    through `jirabackend`), else None — so a retried reply or a second Done
    never posts twice, while a reply to a later block (a newer agent
    comment) still posts."""
    found = None
    for c in jirabackend.issue_comments(client, key):
        author = (c.get("author") or {}).get("accountId")
        if author != owner:
            found = None   # an agent comment after it: a new block cycle
            continue
        body = c.get("body")
        if isinstance(body, str) and body.strip() == text.strip() \
                and c.get("id") is not None:
            found = str(c["id"])
    return found


def reply(project_root: Path, issue: str, body: str | None = None,
          done: bool = False, dry_run: bool = False, transport=None,
          sleep=None) -> dict:
    """The `reply` verb (see the module docstring). `body` is the comment
    text (the CLI reads it from `--body-file`); `done` writes `Done.`."""
    root = Path(project_root).resolve()
    result = _reply_result(issue, dry_run)

    def refuse(why: str) -> dict:
        return _finish(result, "blocked", f"track refused: {why}")

    if not ISSUE_KEY_RE.match(issue or ""):
        return refuse(f"--issue {issue!r} is not a Jira issue key "
                      f"(KEY-123); no Atlassian call made")
    if done == (body is not None):
        return refuse("give exactly one of --body-file and --done; no "
                      "Atlassian call made")
    text = DONE_BODY if done else body.strip()
    if not text:
        return refuse("the reply body is empty; no Atlassian call made")
    gaps = jirabackend.owner_gaps()
    if gaps:
        return refuse("; ".join(gaps) + " — the reply is posted only as the "
                      "owner, never with another identity; no Atlassian "
                      "call made")
    if plansync._recorded(root, "planning.jira.project_key") is None:
        return refuse("planning.jira.project_key is not recorded (no "
                      "planning.jira binding) — run `plansync.py setup` "
                      "first; no Atlassian call made")
    owner = plansync._recorded(root, "planning.jira.owner_account_id")
    if owner is None:
        return refuse("planning.jira.owner_account_id is not recorded — the "
                      "reply's author is checked against it; rerun "
                      "`plansync.py setup --owner-account-id <id>`; no "
                      "Atlassian call made")
    client, gaps = jirabackend.owner_client(
        transport, site=plansync._recorded(root, "planning.jira.site"))
    if client is None:  # pragma: no cover — owner_gaps above
        return refuse("; ".join(gaps) + " — no Atlassian call made")
    if sleep is not None:
        client.sleep = sleep
    notes, skipped = result["notes"], result["skipped"]
    target = jirabackend.RESOLVED_STATUS
    try:
        name, _ = jirabackend._current_status(client, issue)
        if dry_run:
            # the same read-only check the real run makes: a standing
            # identical owner reply is predicted as a skip, never a post
            landed = owner_reply_in_place(client, issue, owner, text)
            if landed is not None:
                skipped.append(f"comment: {issue} already has this owner "
                               f"reply ({landed}) since the newest agent "
                               f"comment")
            else:
                notes.append(f"dry run: {issue} would get the owner's "
                             f"comment ({len(text)} characters)")
            if name == target:
                skipped.append(f"transition: {issue} is already in "
                               f"{target!r}")
            else:
                notes.append(f"dry run: {issue} would move from {name!r} "
                             f"to {target!r}")
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would comment and move as `notes[]` "
                           "names")
        landed = owner_reply_in_place(client, issue, owner, text)
        if landed is not None:
            # a retry after a temporary failure, or Done pressed twice:
            # the owner's identical reply already stands — never twice
            result["commented"] = True
            result["comment_id"] = landed
            skipped.append(f"comment: {issue} already has this owner reply "
                           f"({landed}) since the newest agent comment")
        else:
            created = jirabackend.add_comment(client, issue, text)
            result["commented"] = True
            result["comment_id"] = (str(created["id"]) if created.get("id")
                                    is not None else None)
            author = (created.get("author") or {}).get("accountId")
            if author != owner:
                return refuse(f"{issue}: the comment {result['comment_id']} "
                              f"was posted as {author!r}, not the owner "
                              f"{owner!r} — {jirabackend.OWNER_TOKEN_ENV} is "
                              f"another seat's token; nothing moved")
        if name == target:
            skipped.append(f"transition: {issue} is already in {target!r}")
        elif jirabackend.transition_to_name(client, issue, target, notes,
                                            issue) is None:
            return refuse(f"{issue}: no transition reaches {target!r} from "
                          f"{name!r} — the comment stays (commented: true)")
        else:
            result["transitioned"] = True
    except jirabackend.JiraError as exc:
        if transient(exc):
            result["retry"] = True
            return _finish(result, "partial", f"track retry: {issue}: {exc} "
                           f"— a temporary failure; call again", ok=False)
        return refuse(f"{issue}: {exc}")
    return _finish(result, "complete", None)


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio-track")
    sub = parser.add_subparsers(dest="command", required=True)
    blk = sub.add_parser("block")
    blk.add_argument("--directory", required=True,
                     help="project root (walks up to the nearest)")
    blk.add_argument("--story", required=True,
                     help="entity id (ST-NNN) or loop story key (N-M-slug)")
    blk.add_argument("--reason", required=True)
    blk.add_argument("--resolves", required=True)
    # Validated in code, not argparse choices: a refusal stays JSON (exit 2).
    blk.add_argument("--source", default="run")
    blk.add_argument("--dry-run", action="store_true")
    rep = sub.add_parser("reply")
    rep.add_argument("--directory", required=True,
                     help="project root (walks up to the nearest)")
    rep.add_argument("--issue", required=True, help="the Jira issue key")
    # Exactly one of the two, validated in code: a refusal stays JSON.
    rep.add_argument("--body-file", help="the reply's text, UTF-8 (never "
                                         "the command line)")
    rep.add_argument("--done", action="store_true",
                     help="the reply is `Done.`")
    rep.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    directory = configlib.find_project_root(Path(args.directory))
    if args.command == "reply":
        body = None
        if args.body_file is not None:
            try:
                body = Path(args.body_file).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                result = _finish(_reply_result(args.issue, args.dry_run),
                                 "blocked", f"track refused: cannot read "
                                 f"--body-file: {exc}; no Atlassian call "
                                 f"made")
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 2
        result = reply(directory, args.issue, body, done=args.done,
                       dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get("status") == "blocked" else 0
    result = block(directory, args.story, args.reason, args.resolves,
                   source=args.source, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    # `partial` exits 0 (a temporary failure too: its JSON names `retry`)
    return 2 if result.get("status") == "blocked" else 0


if __name__ == "__main__":
    sys.exit(main())
