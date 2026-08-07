"""tk-studio knowledge promotion — routing doc -> drafted kb/ -> PR membrane
(ST-9.5, Epic 9; D3/D4 ruled).

The gate half of the Research→Knowledge Lifecycle port: corrections that
reached the per-project reconciliation queue (ST-9.4) cross to the project's
canonical `kb/` ONLY as a drafted ordinary kb file on a feature branch
behind PR review — the studio's proven membrane (AD-12). Nothing
auto-applies: this surface never pushes a base branch, never merges, never
closes or approves the PR; a human merging the PR is the one canonical
write (D3).

  check   read-only: routing-doc presence, queue counts, the promoted
          baseline, and the unpromoted-correction count. Touches no git
          state and no network.
  draft   the promote-draft verb. Refuses without a rendered routing doc —
          the human's promotion-decision surface; a promotion drafted from
          data no routing doc has rendered is not a gated promotion.
          Collects the queue's valid corrections, drops those already
          recorded as drafted (delta_key baseline — --redraft overrides),
          sanitization-scans what would cross (NFR5), renders them as ONE
          NEW dated kb file (ordinary frontmatter — no new keys; `scope:`
          stays reserved, AD-8), regenerates kb/index.md (a foreign index
          is skipped, never clobbered), lands it on the stable branch
          knowledge/<user>-<machine>, pushes, opens the membrane PR — or
          recognizes the open one the draft just updated — and records the
          draft in the per-user promotions record.

Append-only everywhere: a draft never edits or deletes an existing kb file
(each draft is a new dated file), never rewrites the queue, and the
promotions record only grows. Provisional knowledge (spine/seed/queue/
routing doc/promotions record) stays in the per-user store (AD-3); the
drafted kb file is the one thing that crosses, through the PR.

Measurement (D4): the `knowledge-promotion` taxonomy event — sole emitter
this skill — lands with contract 1.7.0 (ST-9.6): extending the taxonomy is
a contract-visible MINOR change, and lib/ledger.py refuses un-rowed event
types by construction, so emission cannot precede the row. Until then a
draft emits nothing (this module is a mover, AD-12). The promotions record
written here is the exactly-once baseline 9.6 emission reconciles against
(one merged promotion PR, one event).

CLI:
  uv run promote.py check --directory DIR
  uv run promote.py draft --directory DIR [--base BRANCH] [--dry-run]
                          [--no-pr] [--redraft]

Exit codes: 0 ok (incl. clean no-op) / 1 git failure mid-motion / 2 blocked
(no routing doc, not a git work tree, dirty tree, sanitization finding).
`draft --dry-run` walks the data gates (routing doc, queue, baseline,
sanitization) and stops before any git check — it needs no repo, which is
also how the conformance sandbox drives it. Env: TK_STUDIO_HOME overrides
the store root (tests). Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import classify
import kb as kblib
import job as joblib
import knowledge
import ledger
import reconcile as reconcilelib

RECORD_NAME = "promotions.jsonl"


class PromoteBlocked(Exception):
    """A refusal, not a failure: a gate said no. Message is safe to surface."""

    def __init__(self, step: str, error: str, findings: list | None = None):
        super().__init__(error)
        self.step = step
        self.findings = findings or []


# ------------------------------------------------------------------ helpers

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def machine_key() -> str:
    """<user>-<machine>, from the one ledger-path authority (measurepush's
    rule): the promotion branch is per-user-per-machine like the ledger."""
    return ledger.ledger_path().stem


def branch_name() -> str:
    return f"knowledge/{machine_key()}"


def record_path(key: str) -> Path:
    return reconcilelib.knowledge_dir(key) / RECORD_NAME


def _locked_append(path: Path, text: str) -> None:
    """Append under an exclusive OS lock, flushed and fsync'd — the same
    append discipline as the queue and the ledger (AD-12 pattern)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                handle.seek(0, os.SEEK_END)
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _git(directory: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args], cwd=str(directory), stdin=subprocess.DEVNULL,
        capture_output=True, encoding="utf-8", errors="replace",
    )
    if check and proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()[:300]}")
    return proc


def _gh(directory: Path, *args: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["gh", *args], cwd=str(directory), stdin=subprocess.DEVNULL,
            capture_output=True, encoding="utf-8", errors="replace",
        )
    except OSError as exc:
        return subprocess.CompletedProcess(
            args=["gh", *args], returncode=127, stdout="", stderr=f"gh unavailable: {exc}")


def _ref_exists(directory: Path, ref: str) -> bool:
    return _git(directory, "rev-parse", "--verify", "--quiet", ref,
                check=False).returncode == 0


def _default_base(directory: Path) -> str:
    head = _git(directory, "symbolic-ref", "refs/remotes/origin/HEAD",
                check=False).stdout.strip()
    return head.rsplit("/", 1)[-1] if head else "main"


# ----------------------------------------------------- the promotions record

def read_record(key: str) -> dict:
    """The promotions record as data: {path, drafts[], invalid[], keys} —
    keys is the promoted baseline (every drafted correction's delta_key).
    Tolerant read: an unparseable line is reported, never dropped or
    repaired (append-only, like the queue); a line whose `type` is not
    `draft` is a forward-compatible other kind (9.6 adds emission marking),
    counted but never invalid."""
    path = record_path(key)
    result: dict = {"path": str(path), "drafts": [], "invalid": [],
                    "other": 0, "keys": set()}
    if not path.is_file():
        if path.exists():
            # a directory (or other non-file) at the record path is broken
            # store state, never "empty" — an empty baseline would silently
            # re-draft everything (same posture as reconcile.read_queue)
            raise PromoteBlocked("record", f"{RECORD_NAME} path exists but "
                                           f"is not a file: {path}")
        return result
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise PromoteBlocked("record", f"{RECORD_NAME} unreadable: {exc}") from exc
    # split on \n ONLY — never splitlines() (U+2028-class shear, see
    # knowledge.schema.json queue_line)
    for number, text in enumerate(raw.split("\n"), start=1):
        if not text.strip():
            continue
        try:
            line = json.loads(text)
        except json.JSONDecodeError as exc:
            result["invalid"].append({"line": number,
                                      "error": f"not valid JSON: {exc}"})
            continue
        if not isinstance(line, dict) or not isinstance(line.get("type"), str):
            result["invalid"].append({"line": number,
                                      "error": "record line has no type"})
            continue
        if line["type"] != "draft":
            result["other"] += 1
            continue
        if not isinstance(line.get("keys"), list):
            result["invalid"].append({"line": number,
                                      "error": "draft record has no keys list"})
            continue
        if not all(isinstance(entry, list) and len(entry) == 4
                   and all(isinstance(item, str) for item in entry)
                   for entry in line["keys"]):
            # a malformed key entry invalidates its whole line, reported —
            # excluding it from the baseline re-drafts those corrections
            # (duplicate-over-loss, visible in review); tolerating it here
            # keeps one corrupt line from bricking the surface (a nested
            # list would make tuple() unhashable — adversarial-review
            # finding, ST-9.5)
            result["invalid"].append({"line": number,
                                      "error": "draft record carries "
                                               "malformed key entries"})
            continue
        result["drafts"].append(line)
        for entry in line["keys"]:
            result["keys"].add(tuple(entry))
    return result


def _record_draft(key: str, drafted_at: str, branch: str, base: str,
                  file_rel: str, keys: list[tuple]) -> None:
    line = {"type": "draft", "drafted_at": drafted_at, "branch": branch,
            "base": base, "file": file_rel,
            "keys": [list(k) for k in keys]}
    _locked_append(record_path(key),
                   json.dumps(line, ensure_ascii=False,
                              separators=(",", ":")) + "\n")


# ------------------------------------------------------------------- shared

def _corrections(key: str, redraft: bool) -> dict:
    """Queue + record read into the draft's working set: deduped corrections
    (delta_key -> its queue lines) and the unpromoted subset."""
    queue = reconcilelib.read_queue(key)
    record = read_record(key)
    deduped: dict[tuple, list[dict]] = {}
    for line in queue["lines"]:
        deduped.setdefault(knowledge.delta_key(line), []).append(line)
    unpromoted = [k for k in deduped
                  if redraft or k not in record["keys"]]
    return {"queue": queue, "record": record, "deduped": deduped,
            "unpromoted": unpromoted}


# -------------------------------------------------------------------- check

def check(project_root: Path) -> dict:
    """Read-only: routing-doc presence, queue counts, promoted baseline,
    unpromoted count. Never touches git state or the network."""
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise PromoteBlocked("preflight",
                             f"project root {root} is not a directory")
    key = joblib.project_key(root)
    state = _corrections(key, redraft=False)
    routing = reconcilelib.routing_path(key)
    return {
        "ok": True,
        "project": key,
        "branch": branch_name(),
        "routing": {"present": routing.is_file(), "path": str(routing)},
        "queue": {"path": state["queue"]["path"],
                  "valid": len(state["queue"]["lines"]),
                  "invalid": len(state["queue"]["invalid"])},
        "corrections": {
            "deduped": len(state["deduped"]),
            "promoted": len(state["deduped"]) - len(state["unpromoted"]),
            "unpromoted": len(state["unpromoted"]),
        },
        "record": state["record"]["path"],
    }


# -------------------------------------------------------------------- draft

def draft(project_root: Path, base: str | None = None, dry_run: bool = False,
          no_pr: bool = False, redraft: bool = False) -> dict:
    """Routing doc -> ONE new kb file on the promotion branch -> membrane PR.
    Raises PromoteBlocked on refusal; RuntimeError on git failure mid-motion."""
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise PromoteBlocked("preflight",
                             f"project root {root} is not a directory")
    key = joblib.project_key(root)

    # Gate 1 — the routing doc is the human's promotion-decision surface
    # (ST-9.5's named rejection): no routing doc, no promotion.
    routing = reconcilelib.routing_path(key)
    if not routing.is_file():
        raise PromoteBlocked(
            "routing",
            f"no routing doc for project '{key}' — render it first "
            "(reconcile.py route); the routing doc is the human's "
            "promotion-decision surface, and a promotion drafted from data "
            "no human has seen is not a gated promotion")

    state = _corrections(key, redraft)
    branch = branch_name()
    result: dict = {"ok": True, "project": key, "branch": branch,
                    "corrections": len(state["unpromoted"])}
    if state["queue"]["invalid"]:
        result["queue_invalid"] = state["queue"]["invalid"]
    if state["record"]["invalid"]:
        result["record_invalid"] = state["record"]["invalid"]
    if not state["unpromoted"]:
        result.update(result_state="no-op",
                      detail=("every queued correction is already drafted — "
                              "nothing to promote (--redraft overrides)"
                              if state["deduped"] else
                              "the reconciliation queue holds no valid "
                              "corrections — nothing to promote"))
        if not dry_run:
            # a committed-local draft leaves the promotion branch ahead of
            # origin; the natural retry is re-running this verb, so a no-op
            # run completes the interrupted push instead of stranding it
            # (adversarial-review finding, ST-9.5)
            flushed = _flush_waiting(root, key, no_pr)
            if flushed:
                result.update(flushed)
        return result

    lines = [line for k in state["unpromoted"] for line in state["deduped"][k]]
    entries = knowledge.promotion_entries(lines)

    # Sanitization pre-commit (NFR5): the draft crosses to the project VCS —
    # a credential-shaped string blocks before any branch or commit exists.
    # The queue is append-only, so the guidance is to resolve the flagged
    # correction by hand, never to repair the queue in place silently.
    findings = [
        {"anchor": entry.get("anchor"), "finding": name}
        for entry in entries
        for name in classify.find_credentials(
            json.dumps(entry, ensure_ascii=False))
    ]
    if findings:
        raise PromoteBlocked(
            "sanitization",
            f"{len(findings)} credential-shaped finding(s) in the "
            "corrections about to cross to the project VCS — promotion "
            "blocked (NFR5); resolve the flagged correction, then re-draft",
            findings)

    if dry_run:
        result.update(
            result_state="dry-run", sanitization="clean",
            entries=[{"anchor": e["anchor"], "verdict": e["verdict"],
                      "tier": e["tier"]} for e in entries])
        return result

    # Git membrane motion (the measurepush shape, proven ST-7.1 — with the
    # branch-selection logic hardened: promote's dedupe baseline is the
    # local promotions record, not remote file content, so a reset that
    # orphans an unpushed commit would strand recorded corrections forever)
    if _git(root, "rev-parse", "--is-inside-work-tree",
            check=False).stdout.strip() != "true":
        raise PromoteBlocked(
            "preflight",
            f"{root} is not a git work tree — the promotion membrane is a "
            "git branch + PR (AD-12)")
    if _git(root, "status", "--porcelain").stdout.strip():
        raise PromoteBlocked("preflight",
                             "working tree not clean — commit or stash first")
    # prune so a remote branch deleted post-merge does not linger as a
    # stale base for the next draft; best-effort: offline still commits
    _git(root, "fetch", "--prune", "origin", check=False)
    base = base or _default_base(root)
    if branch == base:
        raise PromoteBlocked(
            "preflight",
            f"promotion branch '{branch}' collides with base '{base}' — a "
            "base branch is never pushed")
    result["base"] = base
    start_branch = _git(root, "rev-parse", "--abbrev-ref",
                        "HEAD").stdout.strip()
    if start_branch == "HEAD":
        raise PromoteBlocked(
            "preflight",
            "repository is in a detached-HEAD state — check out a branch "
            "first (the draft motion must restore your checkout when it "
            "finishes)")

    try:
        _checkout_promotion_branch(root, branch, base)

        # ONE new dated file — never an edit or delete of existing kb content
        drafted_at = _now()
        date = drafted_at[:10]
        kb_root = kblib.kb_dir(root)
        kb_root.mkdir(parents=True, exist_ok=True)
        stem, serial = f"reconciliation-{date}", 1
        while (kb_root / f"{stem}.md").exists():
            serial += 1
            stem = f"reconciliation-{date}-{serial}"
        label = date if serial == 1 else f"{date} ({serial})"
        file_rel = f"kb/{stem}.md"
        drafted_path = kb_root / f"{stem}.md"
        try:
            content = knowledge.render_promotion(entries, key, label)
            drafted_path.write_text(content, encoding="utf-8", newline="\n")
            result["file"] = file_rel

            staged = [file_rel]
            try:
                index = kblib.generate_index(root)
                result["index"] = {"state": ("regenerated" if index["changed"]
                                             else "unchanged")}
                if index["changed"]:
                    staged.append("kb/index.md")
            except kblib.KbError as exc:
                # a foreign (hand-authored) index is surfaced, never
                # clobbered and never a gate — the draft still lands
                result["index"] = {"state": "skipped", "detail": str(exc)}

            _git(root, "add", "--", *staged)  # the draft (+ index), nothing else
            _git(root, "commit", "-q", "-m",
                 f"docs(kb): promotion draft — {len(entries)} "
                 f"correction{'s' if len(entries) != 1 else ''} from the "
                 "reconciliation queue")
        except BaseException:
            # a failure between the write and the commit must leave the
            # tree as found — the tree was clean at entry and these writes
            # were the only changes, so a hard reset plus removing the
            # untracked draft restores it (the finally below restores the
            # start branch)
            drafted_path.unlink(missing_ok=True)
            _git(root, "reset", "--hard", check=False)
            raise
        try:
            _record_draft(key, drafted_at, branch, base, file_rel,
                          [knowledge.delta_key(entry) for entry in entries])
        except OSError as exc:
            # a locked/unwritable record after a landed commit is a warning,
            # not a refusal: the motion continues, and the next draft
            # re-drafts these corrections into a new file on the same PR —
            # duplicate-over-loss, visible in review
            result["record_warning"] = ("promotions record append failed: "
                                        f"{exc}")

        pushed = _git(root, "push", "-u", "origin", branch, check=False)
        if pushed.returncode != 0:
            result.update(
                result_state="committed-local",
                detail=f"push failed: {pushed.stderr.strip()[:200]} — draft "
                       f"committed on '{branch}' and recorded; rerun the "
                       "verb when the remote is reachable (a no-op run "
                       "pushes the waiting branch)")
            return result
        result["result_state"] = "pushed"

        if no_pr:
            result["pr"] = {"state": "skipped", "detail": "--no-pr"}
        else:
            result["pr"] = _pr_step(root, branch, base, key, len(entries))
        return result
    finally:
        _git(root, "checkout", start_branch, check=False)


def _checkout_promotion_branch(root: Path, branch: str, base: str) -> None:
    """Move to the promotion branch without ever orphaning a recorded
    draft. A local branch ahead of origin carries a committed-local draft
    the record already lists — resetting onto origin would strand those
    corrections forever (the baseline blocks a re-draft), so the local
    branch wins and the push fast-forwards origin. A genuine divergence is
    a named refusal, never a silent reset; a fully-merged local leftover
    (its remote deleted post-merge) restarts from base."""
    origin_ref = f"origin/{branch}"
    base_ref = f"origin/{base}" if _ref_exists(root, f"origin/{base}") else base
    if _ref_exists(root, origin_ref):
        if _ref_exists(root, branch):
            ahead = _git(root, "merge-base", "--is-ancestor", origin_ref,
                         branch, check=False).returncode == 0
            behind = _git(root, "merge-base", "--is-ancestor", branch,
                          origin_ref, check=False).returncode == 0
            if ahead and not behind:
                _git(root, "checkout", branch)
                return
            if not ahead and not behind:
                raise PromoteBlocked(
                    "preflight",
                    f"local branch '{branch}' and '{origin_ref}' have "
                    "diverged — reconcile them by hand before drafting "
                    "(neither side is reset silently)")
        _git(root, "checkout", "-B", branch, origin_ref)
        return
    if _ref_exists(root, branch):
        if _ref_exists(root, base_ref) and _git(
                root, "merge-base", "--is-ancestor", branch, base_ref,
                check=False).returncode == 0:
            # fully merged into base and its remote is gone — restart
            # fresh; a branch carrying unpushed work never reaches here
            # (it is not an ancestor of base)
            _git(root, "checkout", "-B", branch, base_ref)
        else:
            _git(root, "checkout", branch)
        return
    if not _ref_exists(root, base_ref):
        raise PromoteBlocked("preflight", f"base branch '{base}' not found")
    _git(root, "checkout", "-b", branch, base_ref)


def _flush_waiting(root: Path, key: str, no_pr: bool) -> dict | None:
    """Complete an interrupted committed-local draft: with nothing new to
    draft, a promotion branch still ahead of origin is pushed and its PR
    opened or recognized — re-running the verb finishes the motion instead
    of stranding it behind a no-op. Returns None when nothing is waiting.
    Push-only: no checkout, no tree requirements."""
    if _git(root, "rev-parse", "--is-inside-work-tree",
            check=False).stdout.strip() != "true":
        return None
    branch = branch_name()
    if not _ref_exists(root, branch):
        return None
    base = _default_base(root)
    base_ref = f"origin/{base}" if _ref_exists(root, f"origin/{base}") else base
    if _ref_exists(root, base_ref) and _git(
            root, "merge-base", "--is-ancestor", branch, base_ref,
            check=False).returncode == 0:
        return None  # fully merged leftover — nothing waiting
    origin_ref = f"origin/{branch}"
    if _ref_exists(root, origin_ref):
        same = (_git(root, "rev-parse", branch).stdout.strip()
                == _git(root, "rev-parse", origin_ref).stdout.strip())
        ahead = _git(root, "merge-base", "--is-ancestor", origin_ref, branch,
                     check=False).returncode == 0
        if same or not ahead:
            return None
    pushed = _git(root, "push", "-u", "origin", branch, check=False)
    if pushed.returncode != 0:
        return {"result_state": "committed-local",
                "detail": "a drafted branch is still waiting and the push "
                          f"failed again: {pushed.stderr.strip()[:200]}"}
    flushed: dict = {
        "result_state": "pushed",
        "detail": "no new corrections; pushed the waiting draft branch"}
    if no_pr:
        flushed["pr"] = {"state": "skipped", "detail": "--no-pr"}
    else:
        flushed["pr"] = _pr_step(root, branch, base, key, None)
    return flushed


def _pr_step(directory: Path, branch: str, base: str, key: str,
             count: int | None) -> dict:
    """Open the membrane PR — or recognize the open one the draft just
    updated. Never merges; review is the gate (D3, AD-12). count is None
    when flushing a waiting branch (the correction count rode the
    interrupted draft's result, not this one)."""
    listing = _gh(directory, "pr", "list", "--head", branch, "--state",
                  "open", "--json", "number,url")
    if listing.returncode == 0:
        try:
            open_prs = json.loads(listing.stdout or "[]")
        except json.JSONDecodeError:
            open_prs = []
        if open_prs:
            return {"state": "updated-existing",
                    "number": open_prs[0].get("number"),
                    "url": open_prs[0].get("url")}
    drafted = (f"{count} correction(s) drafted" if count is not None
               else "Correction draft(s) pushed")
    body = (
        f"## Knowledge promotion draft: `{key}`\n\n"
        f"{drafted} from the reconciliation queue into "
        f"`kb/` — the AD-12 membrane PR. Review is the gate (D3): nothing "
        f"auto-applies, and merging this PR is the one canonical write.\n\n"
        f"- The drafted file is ordinary kb markdown — edit it freely on "
        f"this branch before merging\n"
        f"- Provisional knowledge (spine/seed/queue) stays in the per-user "
        f"store; only this draft crosses\n"
        f"- Sanitization-scanned pre-commit against the shared AD-3 "
        f"patterns\n\n"
        f"🤖 Generated with [Claude Code](https://claude.com/claude-code)\n"
    )
    created = _gh(directory, "pr", "create", "--title",
                  f"docs(kb): knowledge promotion draft ({key})",
                  "--body", body, "--base", base, "--head", branch)
    if created.returncode == 0:
        return {"state": "opened", "url": created.stdout.strip()}
    return {"state": "unavailable",
            "detail": f"gh pr create failed: {created.stderr.strip()[:200]} "
                      "— branch is pushed; open the PR manually or re-draft"}


# ---------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio knowledge promotion (routing doc -> drafted "
                    "kb/ -> membrane PR; review is the gate)")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("check", help="read-only: routing/queue/baseline "
                                       "state and the unpromoted count")
    cmd.add_argument("--directory", required=True, help="project root")
    cmd = sub.add_parser("draft", help="the promote-draft verb: draft "
                                       "unpromoted corrections into kb/ on "
                                       "the promotion branch, open the PR")
    cmd.add_argument("--directory", required=True, help="project root")
    cmd.add_argument("--base", help="PR base branch (default: origin/HEAD, "
                                    "else main)")
    cmd.add_argument("--dry-run", action="store_true",
                     help="walk the data gates only; no git, no writes")
    cmd.add_argument("--no-pr", action="store_true",
                     help="stop after the push; do not touch gh")
    cmd.add_argument("--redraft", action="store_true",
                     help="ignore the promoted baseline and draft every "
                          "valid correction")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            result = check(Path(args.directory))
        else:
            result = draft(Path(args.directory), base=args.base,
                           dry_run=args.dry_run, no_pr=args.no_pr,
                           redraft=args.redraft)
    except PromoteBlocked as exc:
        print(json.dumps({"ok": False, "step": exc.step, "error": str(exc),
                          "findings": exc.findings}, ensure_ascii=False))
        return 2
    except (reconcilelib.ReconcileError, joblib.JobError, OSError,
            UnicodeDecodeError) as exc:
        # OSError: an unreadable/locked store refuses named, never a
        # traceback (AD-11)
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    except RuntimeError as exc:
        print(json.dumps({"ok": False, "step": "git", "error": str(exc)},
                         ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
