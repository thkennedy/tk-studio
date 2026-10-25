"""tk-studio-track — the `block` verb (Story 31.5, §6.9 items 1 and 2, §7.4),
the `reply` verb (Story 31.6) and the `validate` verb (Story 31.7).

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
the `--story` caller (`--source run`), and its questions pass
(`apps/supervisor/src/questions.ts`, Story 32.3) the `--engagement` one
(below). Stdlib-only (NFR9); never prompts.

The engagement's questions (Story 32.3, user flow F2 step 2) block one
issue per engagement instead of a story's:

  uv run track.py block --directory ROOT --engagement ENG-NNN [--dry-run]

(`--engagement` is exclusive with `--story`, implies `--source engagement`
and takes no `--reason` or `--resolves`). The issue is found by its exact
summary `ENG-NNN: questions` in `planning.jira.project_key` (`GET
/search/jql`, the summary matched exactly in code) and created when absent
(`POST /issue`, type `Task`, label `tk-studio-engagement`, the request's
first line as its description). It moves to `Blocked - Awaiting User` by
name with the `_block_issue` skip rules (but an owner comment newer than
the newest agent comment, a reply that answered nothing, gets the comment
again, naming what is still open), its comment the open questions of the
record (`_bmad-output/engagements/<id>/engagement.yaml`, JSON text):

    [~accountid:<owner>] Blocked: ENG-NNN needs <n> answer(s)
    Resolves when: reply with one "<id>: <option>" line per question

    <id>: <text>
    Impact: <impact>
    - <label> (default)
    - <label>

The result is `{ok, dry_run, story: null, engagement, source: "engagement",
issues: [{issue, created, transitioned, commented, skipped?}], notes,
written: []}`. Its refusals besides the binding, variable and owner ones:
`EngagementNotFound`, `NoOpenQuestions`, `IssueCreateRefused` (a 400 on
the create, e.g. no `Task` type) and `EngagementLockUnwritable`. The
find-or-create and the comment (and `close`'s moves) run holding
`_bmad-output/engagements/<id>/track.lock` (exclusive create, stale after
300 s and retaken; never waited on): a lock held is `partial` with `ok:
false` and `retry: true`, so two callers never create two issues or post
one comment twice. A dry run takes no lock.

  uv run track.py close --directory ROOT --engagement ENG-NNN [--dry-run]

moves that issue (agent seat) by name to `Block Resolved` (unless it is
there or at `Done`), then to `Done`; a move already in place is named in
`skipped[]`, and so is `Block Resolved` for an issue never blocked (not in
`Blocked - Awaiting User`, e.g. `To Do`) that no transition takes there;
an absent issue is `NoIssue`, an absent engagement directory
`EngagementNotFound`, a move no transition makes `NoTransition`. The result is `{ok, dry_run,
engagement, issue, moved[], skipped[], notes, written: []}`.

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

The `validate` verb (Story 31.7, §6.9 items 4 and 5) checks a resolution
before the story continues; the shipped `validate-resolution` job's session
calls it, with the agent seat only (`client_for`, never the owner's
variables):

  uv run track.py validate --directory ROOT --issue <KEY>
      (--check | --pass --to "To Do"|"In Progress"
                 [--ruling-file PATH --spec PATH]
               | --fail --follow-up-file PATH) [--dry-run]

Shared refusals end `blocked` (exit 2), each by name: a bad key; no
`planning.jira` binding or an absent agent variable (before any call, `no
Atlassian call made`); no recorded `planning.jira.owner_account_id`; an
issue whose live status is not `Block Resolved`. `--check` reads the
changelog (`GET /issue/<KEY>/changelog`): `owner_resolved` is true only when
the newest transition into `Block Resolved` carries the owner's non-empty
accountId (an older owner transition never validates a later one). It reads
`reason_comment` (`inbox.reason_comment`) and `replies[]` (the
`comments.jsonl` lines whose `author` and `update_author` are both `owner`,
created after the newest agent comment) from local memory only, and marks
the inbox item `validating`. `owner_resolved: false` is a `complete`
result; the session takes the fail path. `--pass` refuses by name when
`owner_resolved` is false (before any write); it then checks that a
transition reaches `--to` (none is refused by name, the spec untouched),
writes the ruling (when given: `**Ruling (owner, <KEY> comment <id>,
<date>):** <text>` just before the spec's `</intent-contract>`, else
`</frozen-after-approval>` — the closing tag on a line of its own; never
`status:`; an absent spec or block is refused by name), then moves the
issue by name to `--to`. `--fail` (allowed whatever `owner_resolved` says)
re-blocks the issue through the `block` internals with the follow-up as the
reason — a new `Blocked:` agent comment, a new cycle. A `--fail` retry whose
move into `Blocked - Awaiting User` landed (newer than the newest move into
`Block Resolved`) but whose comment did not resumes: it posts the comment
and writes the line, with no transition. A `--pass` retry whose move into
`--to` landed but answered a temporary failure resumes the same way (live
status `--to`, its newest move newer than the newest move into `Block
Resolved`, and that one the owner's): the ruling (idempotent) and the line,
with no transition. A ruling this run wrote is taken back out (atomically)
when the pass then ends refused; a temporary failure keeps it. Each
outcome appends one line to `_bmad-output/tracking/<KEY>/validation.jsonl`
(`{issue, outcome, at, transition_id, reply_ids[], to?, ruling?,
follow_up_comment_id?}`, atomic, local memory, never promoted). A temporary
failure ends `partial` with `ok: false` and `retry: true` and appends no
line.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import config as configlib
import inbox
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


def newest_agent_comment(client, key: str, owner: str) -> dict | None:
    """The issue's newest agent comment, read live (`GET
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
    return best


def owner_after_agent(client, key: str, owner: str) -> bool:
    """Whether an owner comment is newer than the issue's newest agent
    comment (both read live, Jira listing oldest first): the owner replied
    since the agent last spoke."""
    newest = newest_agent_comment(client, key, owner)
    if newest is None:
        return False
    seen = False
    for c in jirabackend.issue_comments(client, key):
        if c is newest or (c.get("id") is not None
                           and c.get("id") == newest.get("id")):
            seen = True
        elif seen and (c.get("author") or {}).get("accountId") == owner:
            return True
    return False


def newest_agent_body(client, key: str, owner: str) -> str | None:
    """The plain body of the issue's newest agent comment (see
    `newest_agent_comment`). None when there is none."""
    body = (newest_agent_comment(client, key, owner) or {}).get("body")
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
                 body: str, dry_run: bool, notes: list[str],
                 repost_after_owner: bool = False) -> dict:
    """Move one issue and post its comment; the issue's entry. A refused
    transition sets `error` (and posts no comment); a comment refused by
    name after the transition sets `error` too, `transitioned` kept true. A
    temporary failure raises (the caller's retry path). With
    `repost_after_owner` (the engagement's re-block, Settled shape 4) the
    same body is posted again when an owner comment is newer than the
    newest agent comment: the reply answered nothing, and the comment names
    what is still open."""
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
            newest_agent_body(client, key, owner) == body.strip() and \
            not (repost_after_owner
                 and owner_after_agent(client, key, owner)):
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


# -------------------------------------------------------------- engagement

ENGAGEMENT_ID_RE = re.compile(r"^ENG-\d{3,}$")
ENGAGEMENT_ISSUE_TYPE = "Task"
ENGAGEMENT_LABEL = "tk-studio-engagement"
ENGAGEMENTS_REL = Path("_bmad-output") / "engagements"
DONE_STATUS = "Done"
ANSWER_RESOLVES = 'reply with one "<id>: <option>" line per question'


ENGAGEMENT_LOCK = "track.lock"
ENGAGEMENT_LOCK_STALE_S = 300.0  # past the supervisor's 120 s call bound


class EngagementBusy(Exception):
    pass


def _take_engagement_lock(root: Path, engagement: str,
                          clock=time.time) -> Path:
    """Take `_bmad-output/engagements/<id>/track.lock` (exclusive create;
    older than ENGAGEMENT_LOCK_STALE_S it is stale and retaken, the
    `engage.py` `chat.lock` precedent: renamed aside, so of two takers one
    wins). Held, it is EngagementBusy at once (the caller's retry); never
    waited on. The lock serialises the find-or-create and the comment of
    `block`/`close --engagement` across processes."""
    lock = Path(root) / ENGAGEMENTS_REL / engagement / ENGAGEMENT_LOCK
    for _ in range(3):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                if clock() - lock.stat().st_mtime <= ENGAGEMENT_LOCK_STALE_S:
                    raise EngagementBusy(
                        f"_bmad-output/engagements/{engagement}/"
                        f"{ENGAGEMENT_LOCK} is held") from None
            except FileNotFoundError:
                continue
            aside = lock.with_name(f"{lock.name}.stale-{os.getpid()}-"
                                   f"{os.urandom(4).hex()}")
            try:
                os.rename(lock, aside)
            except FileNotFoundError:
                continue
            try:
                if clock() - aside.stat().st_mtime <= ENGAGEMENT_LOCK_STALE_S:
                    try:  # retaken meanwhile: put back, never over a lock
                        os.link(aside, lock)
                    except OSError:
                        pass
            finally:
                try:
                    aside.unlink()
                except FileNotFoundError:
                    pass
            continue
        os.close(fd)
        return lock
    raise EngagementBusy(f"_bmad-output/engagements/{engagement}/"
                         f"{ENGAGEMENT_LOCK} is contended")


def _release_engagement_lock(lock: Path) -> None:
    try:
        lock.unlink()
    except FileNotFoundError:
        pass


def _locked(root: Path, engagement: str, result: dict, dry_run: bool, fn):
    """Run `fn` holding the engagement's `track.lock` (a dry run writes
    nothing and takes none). Held: `partial`, `ok: false`, `retry: true`;
    the OS refusing the lock: EngagementLockUnwritable, `blocked`."""
    if dry_run:
        return fn()
    try:
        lock = _take_engagement_lock(root, engagement)
    except EngagementBusy as exc:
        result["retry"] = True
        return _finish(result, "partial", f"track retry: {exc} — another "
                       f"block or close of {engagement} is running; call "
                       f"again on the next pass", ok=False)
    except OSError as exc:
        return _finish(result, "blocked", f"track refused: "
                       f"EngagementLockUnwritable: {exc}; no Atlassian call "
                       f"made")
    try:
        return fn()
    finally:
        _release_engagement_lock(lock)


def engagement_summary(engagement: str) -> str:
    return f"{engagement}: questions"


def _answered(question: dict) -> bool:
    answer = question.get("answer")
    return answer is not None and answer != ""


def read_engagement(root: Path, engagement: str) -> dict | None:
    """The engagement record (JSON text, Story 32.2), or None when it is
    absent, unreadable or not this engagement's."""
    path = Path(root) / ENGAGEMENTS_REL / engagement / "engagement.yaml"
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    if not isinstance(record, dict) or record.get("id") != engagement:
        return None
    return record


def open_questions(record: dict) -> list[dict]:
    return [q for q in record.get("questions") or []
            if isinstance(q, dict) and q.get("id") and not _answered(q)]


def engagement_comment(owner: str, engagement: str,
                       questions: list[dict]) -> str:
    """The engagement's block comment (Settled shape 2): the owner's
    mention, then one block per open question with its options."""
    lines = [f"[~accountid:{owner}] Blocked: {engagement} needs "
             f"{len(questions)} answer(s)",
             f"Resolves when: {ANSWER_RESOLVES}"]
    for q in questions:
        lines += ["", f"{q.get('id')}: {str(q.get('text') or '').strip()}",
                  f"Impact: {str(q.get('impact') or '').strip()}"]
        for option in q.get("options") or []:
            if isinstance(option, dict):
                label = str(option.get("label") or "").strip()
                default = option.get("default") is True
            else:
                label, default = str(option).strip(), False
            lines.append(f"- {label}" + (" (default)" if default else ""))
    return "\n".join(lines)


def find_engagement_issue(client, project_key: str,
                          engagement: str) -> str | None:
    """The key of the issue whose summary is exactly `ENG-NNN: questions`
    in the project (`GET /search/jql`, then an exact match in code; the
    lowest key number wins), else None."""
    summary = engagement_summary(engagement)
    jql = (f'project = "{project_key}" AND summary ~ "\\"{summary}\\""')
    hits = []
    for issue in jirabackend.search_jql(client, jql, "summary,status"):
        fields = issue.get("fields") or {}
        if str(fields.get("summary") or "").strip() == summary \
                and issue.get("key"):
            hits.append(str(issue["key"]))

    def number(key: str) -> int:
        tail = key.rsplit("-", 1)[-1]
        return int(tail) if tail.isdigit() else 0
    return min(hits, key=number) if hits else None


class IssueCreateRefused(Exception):
    pass


def create_engagement_issue(client, project_key: str, engagement: str,
                            description: str) -> str:
    """`POST /issue` (the pattern inline in `jirabackend.promote`): a Task
    labelled `tk-studio-engagement`. A 400 is IssueCreateRefused; any other
    failure a JiraError (a 5xx is temporary)."""
    fields = {"project": {"key": project_key},
              "summary": engagement_summary(engagement),
              "issuetype": {"name": ENGAGEMENT_ISSUE_TYPE},
              "description": description,
              "labels": [ENGAGEMENT_LABEL]}
    posted, resp = client.request("POST", "/issue", {"fields": fields},
                                  scope=jirabackend.SCOPE_WORK)
    if posted == 400:
        raise IssueCreateRefused(
            f"creating {engagement_summary(engagement)!r} (issue type "
            f"{ENGAGEMENT_ISSUE_TYPE!r}) returned "
            f"{jirabackend._refusal(posted, resp)}")
    if posted not in (200, 201) or not isinstance(resp, dict) \
            or not resp.get("key"):
        raise jirabackend.JiraError(f"track: POST /issue returned {posted}")
    return str(resp["key"])


def _agent_seat(root: Path) -> tuple[dict | None, str | None, str | None]:
    """(settings, owner accountId, refusal) for the engagement verbs: the
    binding, the agent seat's variables and the recorded owner, each
    refused before any call."""
    if plansync._recorded(root, "planning.jira.project_key") is None:
        return None, None, ("planning.jira.project_key is not recorded (no "
                            "planning.jira binding) — run `plansync.py "
                            "setup` first; no Atlassian call made")
    settings, gaps = jirabackend._resolve_settings(root, None)
    if not os.environ.get(jirabackend.AGENT_TOKEN_ENV) \
            and not os.environ.get(jirabackend.TOKEN_ENV):
        gaps.insert(0, f"{jirabackend.AGENT_TOKEN_ENV} is not set (the "
                       f"agent seat's Jira token)")
    if gaps:
        return None, None, "; ".join(gaps) + " — no Atlassian call made"
    owner = plansync._recorded(root, "planning.jira.owner_account_id")
    if owner is None:
        return None, None, ("planning.jira.owner_account_id is not recorded "
                            "— the block comment @mentions the owner; rerun "
                            "`plansync.py setup --owner-account-id <id>`; no "
                            "Atlassian call made")
    return settings, owner, None


def _first_line(text) -> str:
    for line in str(text or "").splitlines():
        if line.strip():
            return line.strip()
    return ""


def block_engagement(project_root: Path, engagement: str,
                     dry_run: bool = False, transport=None,
                     sleep=None) -> dict:
    """`block --engagement` (see the module docstring)."""
    root = Path(project_root).resolve()
    result = _result(None, "engagement", dry_run)
    result["engagement"] = engagement

    def refuse(why: str) -> dict:
        return _finish(result, "blocked", f"track refused: {why}")

    if not ENGAGEMENT_ID_RE.match(engagement or ""):
        return refuse(f"EngagementNotFound: --engagement {engagement!r} is "
                      f"not an engagement id (ENG-001); no Atlassian call "
                      f"made")
    settings, owner, gap = _agent_seat(root)
    if gap:
        return refuse(gap)
    record = read_engagement(root, engagement)
    if record is None:
        return refuse(f"EngagementNotFound: no readable record at "
                      f"_bmad-output/engagements/{engagement}/engagement.yaml"
                      f"; no Atlassian call made")
    asked = open_questions(record)
    if not asked:
        return refuse(f"NoOpenQuestions: {engagement} has no unanswered "
                      f"question; no Atlassian call made")

    def run() -> dict:
        project_key = str(plansync._recorded(root,
                                             "planning.jira.project_key"))
        client = jirabackend.client_for(settings, transport)
        if sleep is not None:
            client.sleep = sleep
        notes = result["notes"]
        key = None
        try:
            key = find_engagement_issue(client, project_key, engagement)
            created = False
            if key is None:
                if dry_run:
                    notes.append(f"dry run: "
                                 f"{engagement_summary(engagement)!r} would "
                                 f"be created ({ENGAGEMENT_ISSUE_TYPE}) and "
                                 f"moved to {jirabackend.BLOCKED_STATUS!r}")
                    result["issues"].append({"issue": None, "created": False,
                                             "transitioned": False,
                                             "commented": False})
                    return _finish(result, "partial", "dry run: nothing "
                                   "written; a real run would create, move "
                                   "and comment as `notes[]` names")
                key = create_engagement_issue(
                    client, project_key, engagement,
                    _first_line(record.get("request"))
                    or engagement_summary(engagement))
                created = True
            moved = _block_issue(client, owner, {"id": engagement}, key,
                                 "engagement",
                                 engagement_comment(owner, engagement, asked),
                                 dry_run, notes, repost_after_owner=True)
        except IssueCreateRefused as exc:
            return refuse(f"IssueCreateRefused: {exc}")
        except jirabackend.JiraError as exc:
            result["issues"].append({"issue": key, "created": False,
                                     "transitioned": False,
                                     "commented": False, "error": str(exc)})
            if transient(exc):
                result["retry"] = True
                return _finish(result, "partial", f"track retry: "
                               f"{engagement}: {exc} — a temporary failure; "
                               f"call again on the next pass", ok=False)
            return refuse(f"{engagement}: {exc}")
        entry = {"issue": key, "created": created,
                 "transitioned": moved["transitioned"],
                 "commented": moved["commented"]}
        for name in ("skipped", "error"):
            if name in moved:
                entry[name] = moved[name]
        result["issues"].append(entry)
        if "error" in entry:
            return refuse(f"{key} ({engagement}): {entry['error']}")
        if dry_run and any(n.startswith("dry run:") for n in notes):
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would move or comment as `notes[]` "
                           "names")
        return _finish(result, "complete", None)

    return _locked(root, engagement, result, dry_run, run)


def close_engagement(project_root: Path, engagement: str,
                     dry_run: bool = False, transport=None,
                     sleep=None) -> dict:
    """The `close` verb (see the module docstring)."""
    root = Path(project_root).resolve()
    result = {"ok": False, "dry_run": dry_run, "engagement": engagement,
              "issue": None, "moved": [], "skipped": [], "notes": [],
              "written": []}

    def refuse(why: str) -> dict:
        return _finish(result, "blocked", f"track refused: {why}")

    if not ENGAGEMENT_ID_RE.match(engagement or ""):
        return refuse(f"EngagementNotFound: --engagement {engagement!r} is "
                      f"not an engagement id (ENG-001); no Atlassian call "
                      f"made")
    settings, _owner, gap = _agent_seat(root)
    if gap:
        return refuse(gap)
    if not (root / ENGAGEMENTS_REL / engagement).is_dir():
        return refuse(f"EngagementNotFound: no _bmad-output/engagements/"
                      f"{engagement}/; no Atlassian call made")

    def run() -> dict:
        project_key = str(plansync._recorded(root,
                                             "planning.jira.project_key"))
        client = jirabackend.client_for(settings, transport)
        if sleep is not None:
            client.sleep = sleep
        notes, skipped = result["notes"], result["skipped"]
        try:
            key = find_engagement_issue(client, project_key, engagement)
            if key is None:
                return refuse(f"NoIssue: no issue "
                              f"{engagement_summary(engagement)!r} in "
                              f"{project_key}")
            result["issue"] = key
            name, _ = jirabackend._current_status(client, key)
            for target in (jirabackend.RESOLVED_STATUS, DONE_STATUS):
                if name == target or (target == jirabackend.RESOLVED_STATUS
                                      and name == DONE_STATUS):
                    skipped.append(f"transition: {key} is already "
                                   f"{'in' if name == target else 'past'} "
                                   f"{target!r}")
                    continue
                if dry_run:
                    notes.append(f"dry run: {key} would move from "
                                 f"{name!r} to {target!r}")
                    name = target
                    continue
                # setup adds only `Blocked - Awaiting User -> Block
                # Resolved`: an issue never blocked (e.g. `To Do`) skips
                # `Block Resolved` when no transition reaches it
                optional = (target == jirabackend.RESOLVED_STATUS
                            and name != jirabackend.BLOCKED_STATUS)
                tried: list[str] = []
                if jirabackend.transition_to_name(client, key, target,
                                                  tried, engagement) is None:
                    if optional:
                        skipped.append(f"transition: {key} is not blocked "
                                       f"({name}); {target!r} skipped")
                        continue
                    notes.extend(tried)
                    return refuse(f"NoTransition: {key}: no transition "
                                  f"reaches {target!r} from {name!r}")
                notes.extend(tried)
                result["moved"].append(target)
                name = target
        except jirabackend.JiraError as exc:
            if transient(exc):
                result["retry"] = True
                return _finish(result, "partial", f"track retry: "
                               f"{engagement}: {exc} — a temporary failure; "
                               f"call again", ok=False)
            return refuse(f"{engagement}: {exc}")
        if dry_run and any(n.startswith("dry run:") for n in notes):
            return _finish(result, "partial", "dry run: nothing written; a "
                           "real run would move as `notes[]` names")
        return _finish(result, "complete", None)

    return _locked(root, engagement, result, dry_run, run)


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


# ---------------------------------------------------------------- validate

VALIDATE_TARGETS = ("To Do", "In Progress")
FOLLOW_UP_RESOLVES = "a reply in the Inbox that answers the follow-up"
VALIDATION_NAME = "validation.jsonl"
SOURCE_STORY_RE = re.compile(r"^epics\.md#story-(\d+)\.(\d+)$")
RULING_CLOSERS = ("</intent-contract>", "</frozen-after-approval>")
# a closing tag counts only on a line of its own: the tag named in prose
# elsewhere in the spec is never the insertion point
RULING_CLOSER_RES = tuple(re.compile(rf"(?m)^{re.escape(c)}[ \t]*\r?$")
                          for c in RULING_CLOSERS)


def _ruling_closer(text: str):
    """The whole-line match of `</intent-contract>`, else of
    `</frozen-after-approval>`, else None."""
    for pattern in RULING_CLOSER_RES:
        m = pattern.search(text)
        if m:
            return m
    return None


def _validate_result(issue: str, mode: str | None, dry_run: bool) -> dict:
    return {"ok": False, "dry_run": dry_run, "issue": issue, "mode": mode,
            "entity": None, "story": None, "owner_resolved": None,
            "transition": None, "reason_comment": None, "replies": [],
            "notes": [], "written": []}


def _entity_for_issue(plan_dir: Path, key: str) -> dict | None:
    """The plan entity whose `external.jira.key` is `key`, else None."""
    for _, front, _ in jirabackend._load_entities(plan_dir):
        if _jira_key(front) == key:
            return front
    return None


def owner_replies(root: Path, key: str) -> list[dict]:
    """The owner's reply, from local memory only: the `comments.jsonl` lines
    (the last line per id: an edit appends) whose `author` and
    `update_author` are both `owner`, created after the newest agent
    comment, oldest first. `Done.` is a valid answer."""
    _, lines = syncback._log_lines(
        Path(root) / inbox.TRACKING_REL / key / "comments.jsonl")
    latest: dict[str, dict] = {}
    for entry in lines:
        latest[str(entry.get("id"))] = entry
    newest_agent = None
    for entry in latest.values():
        if entry.get("author") == "agent":
            at = syncback.parse_time(entry.get("created"))
            if at is not None and (newest_agent is None or at > newest_agent):
                newest_agent = at
    replies = []
    for entry in latest.values():
        if entry.get("author") != "owner" or \
                entry.get("update_author") != "owner":
            continue
        at = syncback.parse_time(entry.get("created"))
        if newest_agent is not None and (at is None or at <= newest_agent):
            continue
        replies.append((at, {"id": entry.get("id"), "body": entry.get("body"),
                             "created": entry.get("created")}))
    replies.sort(key=lambda pair: (pair[0] is None,
                                   pair[0].timestamp() if pair[0] else 0.0))
    return [reply for _, reply in replies]


def ruling_line(key: str, comment_id, date: str, text: str) -> str:
    return (f"**Ruling (owner, {key} comment {comment_id}, {date}):** "
            f"{text.strip()}")


def _ruling_target(spec: Path) -> tuple[str | None, str | None]:
    """(the spec's text, refusal): the block the ruling goes into must
    exist — `<intent-contract>`, else `<frozen-after-approval>`."""
    try:
        text = spec.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return None, f"the paused spec {spec} cannot be read: {exc}"
    if _ruling_closer(text) is None:
        return None, (f"the paused spec {spec} has no <intent-contract> or "
                      f"<frozen-after-approval> block to hold the ruling")
    return text, None


def write_ruling(spec: Path, text: str, line: str) -> bool:
    """Insert the ruling line just before the closing tag of the spec's
    `<intent-contract>` block (else `<frozen-after-approval>`); nothing
    else changes (never `status:`). False when the line already stands (a
    retried pass), True when written (atomically)."""
    if line in text:
        return False
    at = _ruling_closer(text).start()
    head = text[:at]
    if head and not head.endswith("\n"):
        head += "\n"
    if head and not head.endswith("\n\n"):
        head += "\n"
    jirabackend._atomic_write(spec, head + line + "\n\n" + text[at:])
    return True


def _reaches(client, key: str, name: str) -> bool:
    """Whether a transition on `key` reaches the status named `name` (`GET
    /issue/{key}/transitions`, matched by name the way
    `jirabackend.transition_to_name` matches): read before anything is
    written, so a refusal leaves the spec unchanged."""
    status, data = client.request("GET", f"/issue/{key}/transitions",
                                  scope=jirabackend.SCOPE_READ)
    if status != 200 or not isinstance(data, dict):
        raise jirabackend.JiraError(f"track: GET /issue/{key}/transitions "
                                    f"returned {status}")
    return any(isinstance(tr, dict)
               and (tr.get("to") or {}).get("name") == name
               for tr in data.get("transitions") or [])


def append_validation(root: Path, key: str, line: dict) -> str:
    """Append one outcome line to `_bmad-output/tracking/<KEY>/
    validation.jsonl` (atomically); returns its relative path."""
    rel = inbox.TRACKING_REL / key / VALIDATION_NAME
    path = Path(root) / rel
    text, _ = syncback._log_lines(path)
    if text and not text.endswith("\n"):
        text += "\n"
    jirabackend._atomic_write(path, text + json.dumps(
        line, ensure_ascii=False) + "\n")
    return rel.as_posix()


def validate(project_root: Path, issue: str, check: bool = False,
             passed: bool = False, failed: bool = False,
             to: str | None = None, ruling: str | None = None,
             spec: str | Path | None = None, follow_up: str | None = None,
             dry_run: bool = False, transport=None, sleep=None,
             now=None) -> dict:
    """The `validate` verb (see the module docstring). `ruling` and
    `follow_up` are texts (the CLI reads them from `--ruling-file` and
    `--follow-up-file`); `spec` is the paused story's spec path."""
    root = Path(project_root).resolve()
    modes = [m for m, on in (("check", check), ("pass", passed),
                             ("fail", failed)) if on]
    result = _validate_result(issue, modes[0] if len(modes) == 1 else None,
                              dry_run)

    def refuse(why: str) -> dict:
        return _finish(result, "blocked", f"track refused: {why}")

    if not ISSUE_KEY_RE.match(issue or ""):
        return refuse(f"--issue {issue!r} is not a Jira issue key "
                      f"(KEY-123); no Atlassian call made")
    if len(modes) != 1:
        return refuse("give exactly one of --check, --pass and --fail; no "
                      "Atlassian call made")
    mode = modes[0]
    spec_path = None
    if mode == "pass":
        if to not in VALIDATE_TARGETS:
            return refuse(f"--pass needs --to naming one of "
                          f"{', '.join(map(repr, VALIDATE_TARGETS))} (got "
                          f"{to!r}); no Atlassian call made")
        if (ruling is None) != (spec is None):
            return refuse("--ruling-file and --spec go together; no "
                          "Atlassian call made")
        if ruling is not None and not ruling.strip():
            return refuse("the ruling is empty; no Atlassian call made")
        if spec is not None:
            spec_path = Path(spec)
            if not spec_path.is_absolute():
                spec_path = root / spec_path
            if not spec_path.is_file():
                return refuse(f"the paused spec {spec_path} does not exist; "
                              f"no Atlassian call made")
            _, gap = _ruling_target(spec_path)
            if gap:
                return refuse(gap + "; no Atlassian call made")
    if mode == "fail" and not (follow_up or "").strip():
        return refuse("--fail needs a non-empty --follow-up-file; no "
                      "Atlassian call made")
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
        return refuse("planning.jira.owner_account_id is not recorded — "
                      "only the owner's transition into "
                      f"{jirabackend.RESOLVED_STATUS!r} validates; rerun "
                      "`plansync.py setup --owner-account-id <id>`; no "
                      "Atlassian call made")
    front = _entity_for_issue(plansync.plan_dir(root), issue)
    if front is not None:
        result["entity"] = front.get("id")
        m = SOURCE_STORY_RE.match(str(front.get("source") or "").strip())
        if m:
            result["story"] = f"{int(m.group(1))}.{int(m.group(2))}"
    result["reason_comment"] = inbox.reason_comment(root, issue)
    replies = owner_replies(root, issue)
    result["replies"] = replies
    now = now or datetime.now(timezone.utc)

    client = jirabackend.client_for(settings, transport)
    if sleep is not None:
        client.sleep = sleep
    notes = result["notes"]
    target = jirabackend.RESOLVED_STATUS
    follow_body = (comment_body(owner, follow_up, FOLLOW_UP_RESOLVES)
                   if mode == "fail" else None)
    pass_resumed = False
    # the spec's text before this run's ruling, restored when the pass then
    # ends refused (a temporary failure keeps it: the retry finds it standing)
    ruled: str | None = None

    def unrule() -> None:
        nonlocal ruled
        if ruled is None:
            return
        jirabackend._atomic_write(spec_path, ruled)
        ruled = None
        if str(spec_path) in result["written"]:
            result["written"].remove(str(spec_path))
        notes.append(f"the pass was refused: the ruling was taken back out "
                     f"of {spec_path}")

    try:
        name, _ = jirabackend._current_status(client, issue)
        histories = None
        if name != target:
            # a `--fail` retry whose move from Block Resolved to Blocked
            # landed but whose follow-up comment did not: resume the block
            # (post the comment, write the line, skip the transition). Only
            # when the changelog's newest move into Blocked is newer than
            # its newest move into Block Resolved, and the newest agent
            # comment is not this follow-up. A `--pass` retry whose move
            # into `--to` landed but answered a temporary failure resumes
            # the same way (the ruling, idempotent, then the line; no
            # transition): only when the newest move into `--to` is newer
            # than the newest move into Block Resolved, and that one is
            # still the owner's (the owner_resolved rule).
            resumed = False
            if mode == "pass" and name == to:
                histories = jirabackend.issue_changelog(client, issue)
                into_to = jirabackend.last_transition_into(histories, to)
                into_resolved = jirabackend.last_transition_into(
                    histories, target)
                t_at = jirabackend._parse_stamp(
                    (into_to or {}).get("created"))
                r_at = jirabackend._parse_stamp(
                    (into_resolved or {}).get("created"))
                resumed = (t_at is not None and r_at is not None
                           and t_at > r_at
                           and bool(into_resolved.get("account_id"))
                           and into_resolved["account_id"] == owner)
                pass_resumed = resumed
            if mode == "fail" and name == jirabackend.BLOCKED_STATUS:
                histories = jirabackend.issue_changelog(client, issue)
                into_blocked = jirabackend.last_transition_into(
                    histories, jirabackend.BLOCKED_STATUS)
                into_resolved = jirabackend.last_transition_into(
                    histories, target)
                b_at = jirabackend._parse_stamp(
                    (into_blocked or {}).get("created"))
                r_at = jirabackend._parse_stamp(
                    (into_resolved or {}).get("created"))
                resumed = (b_at is not None and r_at is not None
                           and b_at > r_at
                           and newest_agent_body(client, issue, owner)
                           != follow_body.strip())
            if not resumed:
                return refuse(f"{issue}'s live status is {name!r}, not "
                              f"{target!r} — there is no resolution to "
                              f"validate")
            if pass_resumed:
                notes.append(f"{issue} already moved from {target!r} to "
                             f"{to!r} — resuming the pass (no transition)")
            else:
                notes.append(f"{issue} already moved from {target!r} to "
                             f"{jirabackend.BLOCKED_STATUS!r} without this "
                             f"follow-up — resuming the fail (comment "
                             f"only)")
        if histories is None:
            histories = jirabackend.issue_changelog(client, issue)
        transition = jirabackend.last_transition_into(histories, target)
        result["transition"] = transition
        result["owner_resolved"] = bool(
            transition and transition.get("account_id")
            and transition["account_id"] == owner)
        if mode == "pass" and not result["owner_resolved"]:
            return refuse(f"{issue}: the newest transition into {target!r} "
                          f"is not the owner's (owner_resolved is false) — "
                          f"a pass is refused; take the fail path")
        if mode == "check":
            if not result["owner_resolved"]:
                notes.append(f"{issue}: the newest transition into "
                             f"{target!r} is not the owner's — take the "
                             f"fail path")
            if dry_run:
                notes.append(f"dry run: {issue}'s inbox item would be "
                             f"marked 'validating'")
            elif inbox.mark_validating(root, issue):
                result["written"].append(inbox.INBOX_REL.as_posix())
            else:
                notes.append(f"{issue}: no inbox item to mark 'validating' "
                             f"(absent or already validating)")
        line = {"issue": issue, "outcome": mode,
                "at": now.isoformat(timespec="seconds"),
                "transition_id": (transition or {}).get("id"),
                "reply_ids": [r.get("id") for r in replies]}
        if mode == "pass":
            line["to"] = to
            if not pass_resumed and not _reaches(client, issue, to):
                notes.append(f"{result['entity'] or issue}: {issue} has no "
                             f"transition into {to!r}")
                return refuse(f"{issue}: no transition reaches {to!r} from "
                              f"{name!r}")
            if ruling is not None:
                if not replies:
                    return refuse(f"{issue} has no owner reply after the "
                                  f"newest agent comment to cite for the "
                                  f"ruling")
                cited = replies[-1]
                at = syncback.parse_time(cited.get("created"))
                stamp = (at or now).date().isoformat()
                text, gap = _ruling_target(spec_path)
                if gap:
                    return refuse(gap)
                rline = ruling_line(issue, cited.get("id"), stamp, ruling)
                if dry_run:
                    notes.append(f"dry run: the ruling would be written "
                                 f"into {spec_path}")
                elif write_ruling(spec_path, text, rline):
                    ruled = text
                    result["written"].append(str(spec_path))
                else:
                    notes.append(f"the ruling already stands in "
                                 f"{spec_path}")
                line["ruling"] = str(spec_path)
            if pass_resumed:
                pass  # the move into --to landed on the earlier call
            elif dry_run:
                notes.append(f"dry run: {issue} would move from {name!r} "
                             f"to {to!r}")
            elif jirabackend.transition_to_name(client, issue, to, notes,
                                                issue) is None:
                unrule()
                return refuse(f"{issue}: no transition reaches {to!r} from "
                              f"{name!r}")
        elif mode == "fail":
            entry = _block_issue(
                client, owner, front or {"id": issue}, issue, "story",
                follow_body, dry_run, notes)
            result["issues"] = [entry]
            if "error" in entry:
                return refuse(f"{issue}: {entry['error']}")
            if not dry_run:
                posted = newest_agent_comment(client, issue, owner)
                line["follow_up_comment_id"] = (
                    None if posted is None or posted.get("id") is None
                    else str(posted["id"]))
    except jirabackend.JiraError as exc:
        if transient(exc):
            result["retry"] = True
            return _finish(result, "partial", f"track retry: {issue}: {exc} "
                           f"— a temporary failure; call again", ok=False)
        unrule()
        return refuse(f"{issue}: {exc}")
    if mode != "check":
        result["outcome"] = line
        if not dry_run:
            result["written"].append(append_validation(root, issue, line))
    if dry_run:
        return _finish(result, "partial", "dry run: nothing written; a real "
                       "run would act as `notes[]` names")
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
    # Exactly one of --story and --engagement, validated in code: a refusal
    # stays JSON (exit 2).
    blk.add_argument("--story",
                     help="entity id (ST-NNN) or loop story key (N-M-slug)")
    blk.add_argument("--engagement", help="ENG-NNN (Story 32.3: the "
                                          "engagement's questions)")
    blk.add_argument("--reason")
    blk.add_argument("--resolves")
    # Validated in code, not argparse choices: a refusal stays JSON (exit 2).
    blk.add_argument("--source")
    blk.add_argument("--dry-run", action="store_true")
    cls = sub.add_parser("close")
    cls.add_argument("--directory", required=True,
                     help="project root (walks up to the nearest)")
    cls.add_argument("--engagement", required=True, help="ENG-NNN")
    cls.add_argument("--dry-run", action="store_true")
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
    val = sub.add_parser("validate")
    val.add_argument("--directory", required=True,
                     help="project root (walks up to the nearest)")
    val.add_argument("--issue", required=True, help="the Jira issue key")
    # Exactly one of the three, validated in code: a refusal stays JSON.
    val.add_argument("--check", action="store_true")
    val.add_argument("--pass", dest="passed", action="store_true")
    val.add_argument("--fail", dest="failed", action="store_true")
    val.add_argument("--to", help='"To Do" or "In Progress" (--pass)')
    val.add_argument("--ruling-file", help="the owner's ruling, UTF-8 "
                                           "(--pass, with --spec)")
    val.add_argument("--spec", help="the paused story's spec (--pass)")
    val.add_argument("--follow-up-file", help="what is still missing, "
                                              "UTF-8 (--fail)")
    val.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    directory = configlib.find_project_root(Path(args.directory))
    if args.command == "validate":
        texts = {}
        for name in ("ruling_file", "follow_up_file"):
            value = getattr(args, name)
            if value is None:
                continue
            try:
                texts[name] = Path(value).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                mode = ("check" if args.check else "pass" if args.passed
                        else "fail" if args.failed else None)
                result = _finish(_validate_result(args.issue, mode,
                                                  args.dry_run),
                                 "blocked", f"track refused: cannot read "
                                 f"--{name.replace('_', '-')}: {exc}; no "
                                 f"Atlassian call made")
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 2
        result = validate(directory, args.issue, check=args.check,
                          passed=args.passed, failed=args.failed, to=args.to,
                          ruling=texts.get("ruling_file"),
                          spec=(str(Path(args.spec).resolve()) if args.spec
                                else None),
                          follow_up=texts.get("follow_up_file"),
                          dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get("status") == "blocked" else 0
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
    if args.command == "close":
        result = close_engagement(directory, args.engagement,
                                  dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get("status") == "blocked" else 0
    if args.engagement is not None:
        if args.story is not None or args.reason is not None \
                or args.resolves is not None or args.source not in (
                    None, "engagement"):
            result = _finish(_result(None, "engagement", args.dry_run),
                             "blocked", "track refused: --engagement is "
                             "exclusive with --story, takes no --reason or "
                             "--resolves and implies --source engagement; no "
                             "Atlassian call made")
            result["engagement"] = args.engagement
        else:
            result = block_engagement(directory, args.engagement,
                                      dry_run=args.dry_run)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get("status") == "blocked" else 0
    if args.story is None or args.reason is None or args.resolves is None:
        result = _finish(_result(args.story, args.source or "run",
                                 args.dry_run), "blocked",
                         "track refused: give --story with --reason and "
                         "--resolves, or --engagement; no Atlassian call made")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2
    result = block(directory, args.story, args.reason, args.resolves,
                   source=args.source or "run", dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    # `partial` exits 0 (a temporary failure too: its JSON names `retry`)
    return 2 if result.get("status") == "blocked" else 0


if __name__ == "__main__":
    sys.exit(main())
