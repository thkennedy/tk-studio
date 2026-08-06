"""tk-studio measurement push — local ledger -> feature branch -> PR (ST-7.1, AD-12).

The mover half of the measurement membrane: lands the per-user-per-machine
ledger on the shared repo as measurements/<user>-<machine>.jsonl through plain
git governance — feature branch, commit, PR, review as the membrane. This
surface NEVER pushes a base branch and NEVER merges anything; the only ref it
ever pushes is its own measurement branch.

Discipline:
  - Mover, not emitter (AD-12): emits no measurement events of its own — the
    events it moves were emitted by their one named emitter each.
  - Per-user-per-machine: only this machine's file is ever staged; nothing
    else under measurements/ is touched.
  - Sanitization re-check pre-commit: every line about to land is re-checked
    against the shared AD-3 patterns (classify.py); a credential-shaped
    finding blocks the push before any branch or commit exists.
  - Append-only sync: lines already on the shared file are never rewritten or
    deleted; only ledger lines absent from the baseline are appended.
  - Existing open PR: the stable branch name measurements/<user>-<machine>
    makes a repeat push update the same branch (and its open PR) instead of
    stacking duplicates; with an open PR detected, no second PR is opened.

CLI:
  uv run measurepush.py check [--directory DIR]
  uv run measurepush.py push --directory DIR [--base BRANCH] [--dry-run] [--no-pr]

Exit codes: check 0 ok / 1 failure; push 0 ok (incl. clean no-op) / 1 git
failure mid-motion / 2 blocked (not the studio repo, dirty tree, sanitization
finding). Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import classify
import ledger

MEASUREMENTS_DIR = "measurements"


class PushBlocked(Exception):
    """A refusal, not a failure: preflight or sanitization said no."""

    def __init__(self, step: str, error: str, findings: list | None = None):
        super().__init__(error)
        self.step = step
        self.findings = findings or []


# ------------------------------------------------------------------ helpers

def machine_key() -> str:
    """<user>-<machine>, from the one ledger-path authority."""
    return ledger.ledger_path().stem


def branch_name() -> str:
    return f"{MEASUREMENTS_DIR}/{machine_key()}"


def repo_file() -> str:
    return f"{MEASUREMENTS_DIR}/{machine_key()}.jsonl"


def ledger_lines() -> list[str]:
    path = ledger.ledger_path()
    if not path.is_file():
        return []
    return [line for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()]


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


def _file_at_ref(directory: Path, ref: str, path: str) -> list[str]:
    proc = _git(directory, "show", f"{ref}:{path}", check=False)
    if proc.returncode != 0:
        return []
    return [line for line in proc.stdout.splitlines() if line.strip()]


def _is_studio_repo(directory: Path) -> bool:
    return (directory / ".claude-plugin" / "marketplace.json").is_file() and \
        _git(directory, "rev-parse", "--is-inside-work-tree", check=False).stdout.strip() == "true"


def _default_base(directory: Path) -> str:
    head = _git(directory, "symbolic-ref", "refs/remotes/origin/HEAD",
                check=False).stdout.strip()
    return head.rsplit("/", 1)[-1] if head else "main"


def _baseline(directory: Path, base: str) -> tuple[str, list[str]]:
    """Most-advanced already-shared state of this machine's file: the open
    PR branch when one exists, else the base branch."""
    for ref in (f"origin/{branch_name()}", branch_name(),
                f"origin/{base}", base):
        if _ref_exists(directory, ref):
            return ref, _file_at_ref(directory, ref, repo_file())
    return "none", []


# ------------------------------------------------------- sanitization re-check

def _unredacted_credential_keys(value, path: str = "") -> list[str]:
    """Keys matching the credential pattern whose value survived unredacted —
    emission sanitization redacts these wholesale, so a survivor means the
    line never went through the ledger write path."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            where = f"{path}.{key}" if path else key
            if classify.CREDENTIAL_KEY_RE.search(key) and item != classify.REDACTED:
                found.append(where)
            else:
                found.extend(_unredacted_credential_keys(item, where))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            found.extend(_unredacted_credential_keys(item, f"{path}[{i}]"))
    return found


def sanitization_findings(lines: list[str]) -> list[dict]:
    """Re-check every line about to land against the shared AD-3 patterns."""
    findings: list[dict] = []
    for number, line in enumerate(lines, start=1):
        for name in classify.find_credentials(line):
            findings.append({"line": number, "finding": name})
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            findings.append({"line": number,
                             "finding": "not valid JSON — cannot verify, refusing to guess"})
            continue
        for key in _unredacted_credential_keys(parsed):
            findings.append({"line": number,
                             "finding": f"unredacted value under credential-shaped key '{key}'"})
    return findings


# -------------------------------------------------------------------- check

def check(directory: Path | None = None) -> dict:
    """Read-only: unpushed count + sanitization verdict. Never touches git
    state or the network; baseline comes from local refs only."""
    local = ledger_lines()
    result: dict = {
        "ok": True,
        "file": repo_file(),
        "branch": branch_name(),
        "ledger_events": len(local),
    }
    baseline_lines: list[str] = []
    if directory is not None and _is_studio_repo(directory):
        base = _default_base(directory)
        ref, baseline_lines = _baseline(directory, base)
        result["baseline"] = ref
    else:
        result["baseline"] = "none"
        result["note"] = ("directory is not the studio repo — baseline "
                          "unavailable, counting every ledger event as unpushed")
    known = set(baseline_lines)
    unpushed = [line for line in local if line not in known]
    findings = sanitization_findings(baseline_lines + unpushed)
    result["unpushed"] = len(unpushed)
    result["sanitization"] = {"clean": not findings, "findings": findings}
    return result


# --------------------------------------------------------------------- push

def push(directory: Path, base: str | None = None, dry_run: bool = False,
         no_pr: bool = False) -> dict:
    """Ledger -> measurements/<user>-<machine>.jsonl on its feature branch ->
    PR. Raises PushBlocked on refusal; RuntimeError on git failure mid-motion."""
    directory = Path(directory).resolve()
    if not _is_studio_repo(directory):
        raise PushBlocked("preflight",
                          f"{directory} is not the studio repo root "
                          "(needs .claude-plugin/marketplace.json inside a git work tree)")

    local = ledger_lines()
    branch, path = branch_name(), repo_file()
    result: dict = {"ok": True, "branch": branch, "file": path}
    if not local:
        result.update(result_state="no-op", new_events=0,
                      detail="local ledger is empty — nothing to push")
        return result

    # fetch is best-effort: offline still lands the local branch commit
    _git(directory, "fetch", "origin", check=False)
    base = base or _default_base(directory)
    if branch == base:
        raise PushBlocked("preflight",
                          f"measurement branch '{branch}' collides with base "
                          f"'{base}' — a base branch is never pushed")
    baseline_ref, baseline_lines = _baseline(directory, base)
    known = set(baseline_lines)
    new_lines = [line for line in local if line not in known]
    result.update(base=base, baseline=baseline_ref, new_events=len(new_lines))
    if not new_lines:
        result.update(result_state="no-op", detail="no unpushed events")
        return result

    # sanitization re-check pre-commit — before any branch or commit exists
    findings = sanitization_findings(baseline_lines + new_lines)
    if findings:
        raise PushBlocked(
            "sanitization",
            f"{len(findings)} credential-shaped finding(s) in the content "
            "about to land — push blocked (NFR5); fix the ledger, then rerun",
            findings)

    if dry_run:
        result.update(result_state="dry-run", sanitization="clean")
        return result

    if _git(directory, "status", "--porcelain").stdout.strip():
        raise PushBlocked("preflight",
                          "working tree not clean — commit or stash first")
    start_branch = _git(directory, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()

    try:
        # branch to the shared state the baseline named: the open PR branch
        # when it exists (a repeat push updates it), else fresh off base
        if _ref_exists(directory, f"origin/{branch}"):
            _git(directory, "checkout", "-B", branch, f"origin/{branch}")
        elif _ref_exists(directory, branch):
            _git(directory, "checkout", branch)
        else:
            base_ref = f"origin/{base}" if _ref_exists(directory, f"origin/{base}") else base
            if not _ref_exists(directory, base_ref):
                raise PushBlocked("preflight", f"base branch '{base}' not found")
            _git(directory, "checkout", "-b", branch, base_ref)

        target = directory / path
        target.parent.mkdir(parents=True, exist_ok=True)
        content = baseline_lines + new_lines
        target.write_text("\n".join(content) + "\n", encoding="utf-8", newline="\n")
        _git(directory, "add", "--", path)  # this machine's file, nothing else
        _git(directory, "commit", "-q", "-m",
             f"chore(measurements): {machine_key()} ledger push "
             f"(+{len(new_lines)} event{'s' if len(new_lines) != 1 else ''})")

        pushed = _git(directory, "push", "-u", "origin", branch, check=False)
        if pushed.returncode != 0:
            result.update(result_state="committed-local",
                          detail=f"push failed: {pushed.stderr.strip()[:200]} — "
                                 "branch committed locally, rerun when the remote is reachable")
            return result
        result["result_state"] = "pushed"

        if no_pr:
            result["pr"] = {"state": "skipped", "detail": "--no-pr"}
        else:
            result["pr"] = _pr_step(directory, branch, base, len(new_lines))
        return result
    finally:
        _git(directory, "checkout", start_branch, check=False)


def _pr_step(directory: Path, branch: str, base: str, new_count: int) -> dict:
    """Open the membrane PR — or recognize the open one the push just updated.
    Never merges; review is the membrane (AD-12)."""
    listing = _gh(directory, "pr", "list", "--head", branch, "--state", "open",
                  "--json", "number,url")
    if listing.returncode == 0:
        try:
            open_prs = json.loads(listing.stdout or "[]")
        except json.JSONDecodeError:
            open_prs = []
        if open_prs:
            return {"state": "updated-existing",
                    "number": open_prs[0].get("number"),
                    "url": open_prs[0].get("url")}
    body = (
        f"## Measurement push: `{machine_key()}`\n\n"
        f"{new_count} new event(s) appended to `{repo_file()}` — the AD-12 "
        f"membrane PR. Review is the promotion gate; nothing merges "
        f"automatically.\n\n"
        f"- Per-user-per-machine file only; append-only (no line rewritten "
        f"or deleted)\n"
        f"- Sanitization re-checked pre-commit against the shared AD-3 "
        f"patterns\n\n"
        f"🤖 Generated with [Claude Code](https://claude.com/claude-code)\n"
    )
    created = _gh(directory, "pr", "create", "--title",
                  f"chore(measurements): {machine_key()} ledger push",
                  "--body", body, "--base", base, "--head", branch)
    if created.returncode == 0:
        return {"state": "opened", "url": created.stdout.strip()}
    return {"state": "unavailable",
            "detail": f"gh pr create failed: {created.stderr.strip()[:200]} — "
                      "branch is pushed; open the PR manually or rerun"}


# ---------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio measurement push")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("check", help="read-only: unpushed count + sanitization verdict")
    cmd.add_argument("--directory", help="studio repo root (optional)")
    cmd = sub.add_parser("push", help="ledger -> feature branch -> membrane PR")
    cmd.add_argument("--directory", required=True, help="studio repo root")
    cmd.add_argument("--base", help="PR base branch (default: origin/HEAD, else main)")
    cmd.add_argument("--dry-run", action="store_true")
    cmd.add_argument("--no-pr", action="store_true",
                     help="stop after the push; do not touch gh")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            directory = Path(args.directory).resolve() if args.directory else None
            print(json.dumps(check(directory), ensure_ascii=False))
            return 0
        result = push(Path(args.directory), base=args.base,
                      dry_run=args.dry_run, no_pr=args.no_pr)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except PushBlocked as exc:
        print(json.dumps({"ok": False, "step": exc.step, "error": str(exc),
                          "findings": exc.findings}, ensure_ascii=False))
        return 2
    except RuntimeError as exc:
        print(json.dumps({"ok": False, "step": "git", "error": str(exc)},
                         ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
