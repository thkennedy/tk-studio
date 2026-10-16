"""Rehearse the supervisor's move into apps/supervisor (AD-21, ADR section 5) on throwaway clones.

The real cut-over must be a replay of a passed rehearsal, never an improvisation. This script clones
both repositories into a scratch folder it creates, rewrites the supervisor clone's history under
apps/supervisor/ with git filter-repo, merges the rewrite into the tk-studio clone on branch
restructure/supervisor-into-monorepo, runs the ADR's checks on the merged clone and writes a report
in ADR section 5 order (steps 1 to 5, then unverifiable-here) ending in one verdict line.

Safety: stdlib only; every subprocess is an argv list (never a shell); every git command runs with
its cwd inside the scratch folder; the only remote ever added is the local `svc` remote inside the
scratch clone; origin is removed from both clones; nothing is pushed; global git config is read,
never set; hook commands are never executed. The sources are only ever read by `git clone`.
drift_check emits its own drift/activation measurement event to the per-user store (~/.tk-studio); this is the check's own measurement, not a rehearsal write.

Exit status: 0 rehearsal passed, 1 a step or check failed, 2 refused before starting.

Usage: uv run python tools/restructure/rehearse.py --supervisor C:\\GitHub\\tk-studio-supervisor
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
PREFIX = "apps/supervisor"
BRANCH = "restructure/supervisor-into-monorepo"
# The supervisor's release tags (ADR section 6: `supervisor--vX.Y.Z`, cut 2026-10-15 for 0.1.0).
# filter-repo rewrites them onto the rewritten commits; the merge carries them into the clone,
# and the real cut-over pushes them so the monorepo resolves the same tags. Any other tag fails.
RELEASE_TAG_RE = re.compile(r"^supervisor--v\d+\.\d+\.\d+$")
IDENTITY = ["-c", "user.name=rehearse", "-c", "user.email=rehearse@localhost"]
# C:\GitHub\tk-studio and C:\GitHub\tk-studio-supervisor, in the form _norm produces
LIVE_ROOTS = ("/c/github/tk-studio", "/c/github/tk-studio-supervisor")
EXPECTED_HOOKS = 4
DEFAULT_TIMEOUT = 1800
AGENT_PC_NESTED = r"C:\GitHub\tk-studio\apps\supervisor"
STRIPPED_ENV = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
                "GIT_OBJECT_DIRECTORY", "CLAUDE_PROJECT_DIR")
DRIFT_NOTE = ("drift_check emits its own drift/activation measurement event to the per-user store "
              "(~/.tk-studio); this is the check's own measurement, not a rehearsal write.")
_PROJECT_DIR = re.compile(r"\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR")
_PLACEHOLDER = "\x01CLAUDE_PROJECT_DIR\x01"

STEP_TITLES = (
    "Step 1 — Freeze",
    "Step 2 — Rewrite",
    "Step 3 — Merge",
    "Step 4 — Nested studio project",
    "Step 5 — Sandboxes",
)


@dataclass
class Check:
    name: str
    status: str  # pass | fail | info | unverifiable
    command: str = ""
    cwd: str = ""
    rc: int | None = None
    seconds: float | None = None
    tail: str = ""
    note: str = ""
    label: str = ""  # the verdict's name for this check when it fails
    agent_pc: str = ""  # exact, runnable agent-PC command, for unverifiable checks


@dataclass
class Step:
    title: str
    checks: list[Check] = field(default_factory=list)
    not_run: str = ""

    @property
    def short(self) -> str:
        return self.title.split(" — ")[0]

    @property
    def failed(self) -> Check | None:
        return next((c for c in self.checks if c.status == "fail"), None)


class Refused(Exception):
    pass


# --- paths and the guard ----------------------------------------------------------------------

def _norm(path: str) -> str:
    s = path.replace("\\", "/").rstrip("/").lower()
    m = re.match(r"^([a-z]):(/|$)", s)
    if m:
        s = f"/{m.group(1)}" + s[2:]
    return s


def _inside(child: str, parent: str) -> bool:
    c, p = _norm(child), _norm(parent)
    return c == p or c.startswith(p + "/")


def _local_source(src: str, allow_remote: bool) -> Path | None:
    """The local path of a source (plain path or file:// URL), None for an allowed remote URL."""
    if src.startswith("file://"):
        raw = unquote(urlparse(src).path)
        if re.match(r"^/[A-Za-z]:", raw):
            raw = raw[1:]
        return Path(raw).resolve()
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", src) or re.match(r"^[^/\\:]+@[^:]+:", src):
        if not allow_remote:
            raise Refused(f"source {src!r} is not a local path or file:// URL "
                          "(pass --allow-remote-source to clone it)")
        return None
    path = Path(src).resolve()
    if not path.exists():
        raise Refused(f"source {src!r} does not exist")
    return path


def guard(args: argparse.Namespace) -> tuple[Path | None, Path | None, Path | None, Path]:
    """Resolve and vet every path before anything is written. Raises Refused."""
    sup = _local_source(args.supervisor, args.allow_remote_source)
    tks = _local_source(args.tk_studio, args.allow_remote_source)
    sources = [p for p in (sup, tks) if p is not None]
    if sup is not None and tks is not None and _norm(str(sup)) == _norm(str(tks)):
        raise Refused("--supervisor and --tk-studio are the same repository")
    scratch = Path(args.scratch).resolve() if args.scratch else None
    if scratch is not None:
        for src in sources:
            if _inside(str(scratch), str(src)):
                raise Refused(f"--scratch {scratch} is inside the source {src}")
        for live in LIVE_ROOTS:
            if _inside(str(scratch), live) or _inside(args.scratch, live):
                raise Refused(f"--scratch {scratch} is inside the live checkout {live}")
        if scratch.exists() and (not scratch.is_dir() or any(scratch.iterdir())):
            raise Refused(f"--scratch {scratch} exists and is not an empty folder")
    report = Path(args.report).resolve() if args.report else default_report()
    if report.is_dir():
        raise Refused(f"--report {report} is a folder")
    if scratch is not None and _inside(str(report), str(scratch)):
        raise Refused(f"--report {report} is inside the scratch folder {scratch}")
    if sup is not None and _inside(str(report), str(sup)):
        raise Refused(f"--report {report} is inside the supervisor source {sup}")
    if tks is not None and _inside(str(report), str(tks)):
        allowed = tks / "_bmad-output" / "implementation-artifacts"
        if not _inside(str(report.parent), str(allowed)):
            raise Refused(f"--report {report} is inside the tk-studio source {tks} "
                          f"outside {allowed}")
    _vet_report_live(report, args.report)
    return sup, tks, scratch, report


def _vet_report_live(report: Path, raw: str | None) -> None:
    """The report never lands in a live checkout, except tk-studio's implementation-artifacts (AC4)."""
    live_tks, live_sup = LIVE_ROOTS
    for form in [str(report)] + ([raw] if raw else []):
        if _inside(form, live_sup):
            raise Refused(f"--report {form} is inside the live checkout {live_sup}")
        if _inside(form, live_tks):
            parent = _norm(form).rsplit("/", 1)[0]
            allowed = f"{live_tks}/_bmad-output/implementation-artifacts"
            if not _inside(parent, allowed):
                raise Refused(f"--report {form} is inside the live checkout {live_tks} "
                              f"outside {allowed}")


def default_report() -> Path:
    day = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")
    return ROOT / "_bmad-output" / "implementation-artifacts" / f"restructure-rehearsal-{day}.md"


# --- running commands -------------------------------------------------------------------------

def child_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in STRIPPED_ENV}
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _kill_tree(proc: subprocess.Popen) -> None:
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        proc.kill()
    except OSError:
        pass


class Runner:
    def __init__(self, scratch: Path, tail: int, timeout: float) -> None:
        self.scratch = scratch
        self.tail = tail
        self.timeout = timeout
        self.size_check: Check | None = None

    def rel(self, cwd: Path) -> str:
        rel = Path(cwd).resolve().relative_to(self.scratch)
        return rel.as_posix() or "."

    def run(self, argv: list[str], cwd: Path) -> tuple[int, str, float, bool]:
        """(rc, output, seconds, timed_out); never raises for a missing executable or a timeout."""
        cwd = Path(cwd).resolve()
        if not _inside(str(cwd), str(self.scratch)):
            raise RuntimeError(f"refusing to run {argv[0]!r} outside the scratch folder: {cwd}")
        group = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt"
                 else {"start_new_session": True})
        started = time.monotonic()
        try:
            proc = subprocess.Popen(argv, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    stdin=subprocess.DEVNULL, text=True, encoding="utf-8",
                                    errors="replace", env=child_env(), **group)
        except OSError as exc:
            rc = 127 if isinstance(exc, FileNotFoundError) else 126
            return rc, f"cannot start {argv[0]!r}: {exc}", time.monotonic() - started, False
        try:
            out, err = proc.communicate(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
            try:
                out, err = proc.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                out, err = "", ""
            text = (out or "") + (err or "") + f"\ntimed out after {self.timeout:g}s"
            return 124, text, time.monotonic() - started, True
        return proc.returncode, (out or "") + (err or ""), time.monotonic() - started, False

    def git(self, args: list[str], cwd: Path) -> tuple[int, str, float, bool]:
        return self.run(["git", *IDENTITY, *args], cwd)

    def check(self, name: str, argv: list[str], cwd: Path, label: str = "",
              ok=None, note: str = "") -> tuple[Check, str]:
        """Run argv and record it; ok(rc, out) -> (passed, note) refines the pass rule."""
        rc, out, secs, timed_out = self.run(argv, cwd)
        passed, extra = (rc == 0, "") if ok is None else ok(rc, out)
        label = label or name
        if timed_out:
            passed, extra = False, f"timed out after {self.timeout:g}s"
            label = f"{label} timed out after {self.timeout:g}s"
        c = Check(name=name, status="pass" if passed else "fail", command=shlex.join(argv),
                  cwd=self.rel(cwd), rc=rc, seconds=secs, tail=self.cut(out.replace("\0", "\n")),
                  note="; ".join(x for x in (note, extra) if x), label=label)
        return c, out

    def gitcheck(self, name: str, args: list[str], cwd: Path, label: str = "",
                 ok=None) -> tuple[Check, str]:
        return self.check(name, ["git", *IDENTITY, *args], cwd, label=label, ok=ok)

    def cut(self, out: str) -> str:
        lines = out.rstrip().splitlines()
        return "\n".join(lines[-self.tail:]) if self.tail > 0 else ""


def ls_tree_args(ref: str) -> list[str]:
    return ["-c", "core.quotePath=false", "ls-tree", "-r", "-z", "--name-only", ref]


def _z_paths(out: str) -> list[str]:
    return [p for p in out.split("\0") if p.strip()]


def resolve_filter_repo(flag: str | None) -> list[str] | None:
    if flag:
        return [sys.executable, flag] if flag.endswith(".py") else [flag]
    found = shutil.which("git-filter-repo")
    if found:
        return [found]
    if shutil.which("uvx"):
        return ["uvx", "git-filter-repo"]
    if shutil.which("uv"):
        return ["uv", "tool", "run", "git-filter-repo"]
    return None


def _tree_bytes(path: Path, skip_git: bool) -> int:
    total = 0
    for dirpath, dirnames, filenames in os.walk(path):
        if skip_git and Path(dirpath) == path and ".git" in dirnames:
            dirnames.remove(".git")
        for name in filenames:
            try:
                total += os.lstat(os.path.join(dirpath, name)).st_size
            except OSError:
                pass
    return total


def _parse_json(out: str):
    """The JSON value in out: the whole text, else the first value that decodes from a `{` or `[`
    (a leading banner and trailing text, e.g. stderr, are ignored)."""
    try:
        return json.loads(out)
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for m in re.finditer(r"[{\[]", out):
        try:
            value, _end = decoder.raw_decode(out, m.start())
        except ValueError:
            continue
        return value
    return None


SIGNATURE_HEADERS = ("gpgsig", "gpgsig-sha256", "mergetag")


def signature_headers(raw_log: str) -> dict[str, int]:
    """Commits carrying each signature header, from `git log --format=raw` output (headers sit at
    column 0; continuation lines and the message are indented)."""
    counts: dict[str, int] = {}
    seen: set[str] = set()
    for line in raw_log.splitlines():
        if line.startswith("commit "):
            seen = set()
            continue
        kind = line.split(" ", 1)[0]
        if kind in SIGNATURE_HEADERS and line.startswith(kind + " ") and kind not in seen:
            seen.add(kind)
            counts[kind] = counts.get(kind, 0) + 1
    return counts


def bmad_loop_listed(nested: Path):
    """Pass rule for `bmad-loop list --json` at the nested root: rc 0, a JSON object with a runs
    list, and the run workspace <nested>/.bmad-loop exists (list alone answers in any folder)."""
    def ok(rc, out):
        data = _parse_json(out)
        if rc != 0:
            return False, f"exit code {rc}"
        if not isinstance(data, dict) or not isinstance(data.get("runs"), list):
            return False, "no JSON object with a runs list"
        if not (nested / ".bmad-loop").is_dir():
            return False, f"workspace {PREFIX}/.bmad-loop missing"
        return True, f"workspace {PREFIX}/.bmad-loop; {len(data['runs'])} runs"
    return ok


# --- the steps --------------------------------------------------------------------------------

def unverifiable(name: str, why: str, agent_pc: str) -> Check:
    return Check(name=name, status="unverifiable", note=why, agent_pc=agent_pc)


def computed(name: str, started: float, passed: bool, note: str, label: str = "") -> Check:
    """A check the script computes itself (no command); its duration is the computation's."""
    return Check(name=name, status="pass" if passed else "fail", seconds=time.monotonic() - started,
                 note=note, label=label or name)


def step_freeze(s: Step, r: Runner, args, svc: Path, tkc: Path) -> Step:
    """Step 1. When it fails after the supervisor clone exists, origin is removed from that clone
    here (Step 2, which otherwise removes it after filter-repo, never runs)."""
    finished = False
    try:
        _freeze(s, r, args, svc, tkc)
        finished = s.failed is None
    finally:
        if not finished and (svc / ".git").exists():
            _drop_origin(s, r, svc)
    return s


def _drop_origin(s: Step, r: Runner, svc: Path) -> None:
    _rc, out, _secs, _ = r.git(["remote"], svc)
    if "origin" in out.split():
        c, _ = r.gitcheck("remove origin (rewrite clone)", ["remote", "remove", "origin"], svc)
        s.checks.append(c)


def _freeze(s: Step, r: Runner, args, svc: Path, tkc: Path) -> None:
    for name, src, dst in (("clone supervisor (--no-local)", args.supervisor_src, svc),
                           ("clone tk-studio (--no-local)", args.tk_studio_src, tkc)):
        c, _ = r.gitcheck(name, ["clone", "--no-local", src, dst.name], r.scratch)
        c.note = "; ".join(x for x in ("fresh clone into a folder this run created", c.note) if x)
        s.checks.append(c)
        if c.status == "fail":
            return
    c, _ = r.gitcheck("remove origin (tk-studio clone)", ["remote", "remove", "origin"], tkc)
    s.checks.append(c)
    rc, out, secs, _ = r.git(["config", "--get", "core.longpaths"], svc)
    value = out.strip()
    if value.lower() == "true":
        s.checks.append(Check("core.longpaths", "pass", "git config --get core.longpaths",
                              r.rel(svc), rc, secs, r.cut(out), note="read, never set"))
    elif os.name == "nt":
        s.checks.append(Check("core.longpaths", "fail", "git config --get core.longpaths",
                              r.rel(svc), rc, secs, r.cut(out),
                              note="not true on the box; run git config --global core.longpaths true",
                              label="core.longpaths not set"))
    else:
        s.checks.append(unverifiable(
            "core.longpaths", f"read {value or 'unset'} on a non-Windows host; it matters only "
            "on the agent PC (read, never set)", "git config --global core.longpaths true"))
    s.checks.append(unverifiable(
        "freeze (no loop run in flight, PRs merged, supervisor tab stopped)",
        "operator actions on the agent PC: confirm no run is in flight and no PR is open, "
        "then stop the supervisor tab from the console",
        r"cd C:\GitHub\tk-studio-supervisor; bmad-loop list --json; "
        "gh pr list --repo thkennedy/tk-studio-supervisor --state open; "
        "gh pr list --repo thkennedy/tk-studio --state open"))


def step_rewrite(s: Step, r: Runner, args, svc: Path) -> Step:
    """Step 2. origin is removed from the rewrite clone on every exit path, early failures included
    (after filter-repo when it runs, so its fresh-clone sanity check sees the clone as cloned)."""
    try:
        _rewrite(s, r, args, svc)
    finally:
        _drop_origin(s, r, svc)
    return s


def release_tags(out: str) -> tuple[list[str], list[str]]:
    """Split a `git tag --list` listing into (release tags, every other tag)."""
    tags = [t for t in out.split() if t]
    return ([t for t in tags if RELEASE_TAG_RE.match(t)],
            [t for t in tags if not RELEASE_TAG_RE.match(t)])


def _rewrite(s: Step, r: Runner, args, svc: Path) -> None:
    # 2026-10-16: the ADR's "no tags to rename and no signed commits" was written before the
    # supervisor's first release (supervisor--v0.1.0, 2026-10-15) and before GitHub's web merges
    # signed the merge commits. Release tags are carried (filter-repo rewrites them, Step 3 fetches
    # them, the cut-over pushes them); any other tag still fails. Signatures do not survive a
    # rewrite (the rewritten commits are new objects) and the archived repository keeps the
    # signed originals, so they are recorded, never a failure.
    carried: list[str] = []

    def only_release_tags(rc, out):
        if rc != 0:
            return False, "git tag failed"
        release, other = release_tags(out)
        carried.extend(release)
        if other:
            return False, f"tags present (not release tags): {', '.join(other[:5])}"
        if release:
            return True, (f"release tags carried by the rewrite: {', '.join(release)} — pushed "
                          "after the real merge (git push origin <tag>)")
        return True, "no tags"

    c, _ = r.gitcheck("tags are release tags (carried)", ["tag", "--list"], svc,
                      label="tags present", ok=only_release_tags)
    s.checks.append(c)
    if c.status == "fail":
        return

    def signatures(rc, out):
        counts = signature_headers(out)
        if rc != 0:
            return False, "git log failed"
        if counts:
            return True, ("signature headers: " + ", ".join(
                f"{kind} in {n} commit{'s' if n != 1 else ''}" for kind, n in sorted(counts.items()))
                + " — dropped by the rewrite (rewritten commits are new objects); the archived "
                  "repository keeps the signed originals")
        commits = sum(1 for line in out.splitlines() if line.startswith("commit "))
        return True, f"no {'/'.join(SIGNATURE_HEADERS)} header in {commits} commits (raw headers)"

    # raw headers, not %G?: an SSH signature with no allowedSignersFile, and a mergetag, read as N
    c, out = r.gitcheck("signed commits (informational)",
                        ["log", "--all", "--no-show-signature", "--format=raw"], svc,
                        label="git log failed", ok=signatures)
    c.tail = r.cut("\n".join(line for line in out.splitlines()
                             if line.startswith(("commit ", *(k + " " for k in SIGNATURE_HEADERS)))))
    if c.status == "pass" and signature_headers(out):
        c.status = "info"
    s.checks.append(c)
    if c.status == "fail":
        return

    argv = resolve_filter_repo(args.filter_repo)
    if argv is None:
        s.checks.append(computed("filter-repo", time.monotonic(), False,
                                 "no git-filter-repo, uvx or uv on PATH", "filter-repo unavailable"))
        return
    c, _ = r.check("filter-repo", [*argv, "--to-subdirectory-filter", PREFIX], svc,
                   note=f"ran {shlex.join(argv)}")
    s.checks.append(c)
    if c.status == "fail":
        return

    def no_node_modules(rc, out):
        paths = set(_z_paths(out))
        hits = sorted(p for p in paths if "node_modules" in p.split("/"))
        return rc == 0 and not hits, (f"node_modules paths: {', '.join(hits[:5])}" if hits else
                                      f"none of the {len(paths)} paths any commit touched "
                                      "(log --all -m --name-only, merges included)")

    c, _ = r.gitcheck("no node_modules in history",
                      ["-c", "core.quotePath=false", "-c", "log.showRoot=true", "log", "--all", "-m",
                       "--no-renames", "--name-only", "--format=", "-z"],
                      svc, label="node_modules in history", ok=no_node_modules)
    s.checks.append(c)
    if c.status == "fail":
        return

    c, _ = r.gitcheck("node_modules ignored",
                      ["check-ignore", "-v", "--no-index", f"{PREFIX}/node_modules/x.js"], svc,
                      label="node_modules not ignored")
    s.checks.append(c)
    if c.status == "fail":
        return

    def under_prefix(rc, out):
        if rc != 0:
            return False, "ls-tree failed"
        paths = _z_paths(out)
        outside = [p for p in paths if not p.startswith(PREFIX + "/")]
        if not paths:
            return False, "no paths listed"
        return not outside, (f"{len(paths)} paths"
                             + (f", outside {PREFIX}/: {', '.join(outside[:5])}" if outside else ""))

    c, _ = r.gitcheck(f"every path under {PREFIX}/", ls_tree_args("HEAD"), svc,
                      label=f"paths outside {PREFIX}/", ok=under_prefix)
    s.checks.append(c)


def step_merge(s: Step, r: Runner, args, svc: Path, tkc: Path) -> Step:
    ref = f"svc/{args.supervisor_branch}"
    before_rc, before, _secs, _ = r.git(ls_tree_args("HEAD"), tkc)
    c, _ = r.gitcheck(f"branch {BRANCH}", ["checkout", "-b", BRANCH], tkc)
    s.checks.append(c)
    if c.status == "fail":
        return s
    c, _ = r.gitcheck("add local remote svc", ["remote", "add", "svc", str(svc)], tkc)
    s.checks.append(c)
    if c.status == "fail":
        return s
    try:
        # --tags: the supervisor's release tags (rewritten by filter-repo in Step 2) ride along,
        # so the merged clone resolves `supervisor--vX.Y.Z` as the old repository did
        c, _ = r.gitcheck("fetch svc (with tags)", ["fetch", "--tags", "svc"], tkc)
        s.checks.append(c)
        if c.status == "fail":
            return s
        _rc, listed, _secs, _ = r.git(["tag", "--list"], svc)
        carried, _other = release_tags(listed)

        def tags_carried(rc, out):
            if rc != 0:
                return False, "git tag failed"
            present = set(out.split())
            missing = [t for t in carried if t not in present]
            if missing:
                return False, f"release tags missing in the merged clone: {', '.join(missing)}"
            if carried:
                return True, (f"{len(carried)} release tag(s) in the merged clone: {', '.join(carried)}"
                              " — after the real merge: git push origin " + " ".join(carried))
            return True, "no release tags to carry"

        c, _ = r.gitcheck("release tags carried into the clone", ["tag", "--list"], tkc,
                          label="release tags lost", ok=tags_carried)
        s.checks.append(c)
        if c.status == "fail":
            return s
        c, _ = r.gitcheck(f"{ref} exists", ["rev-parse", "--verify", "--quiet", f"refs/remotes/{ref}^{{commit}}"],
                          tkc, label="supervisor branch missing")
        s.checks.append(c)
        if c.status == "fail":
            return s
        # per-command: an operator's global commit.gpgsign or merge.ff=only must not fail the merge
        c, _ = r.gitcheck("merge", ["-c", "commit.gpgsign=false", "-c", "merge.ff=true", "merge",
                                    "--allow-unrelated-histories", "--no-edit", ref], tkc)
        s.checks.append(c)

        def no_unmerged(rc, out):
            return rc == 0 and not out.strip(), ""

        u, unmerged = r.gitcheck("no conflict", ["diff", "--name-only", "--diff-filter=U"], tkc,
                                 label="merge conflict", ok=no_unmerged)
        s.checks.append(u)
        if c.status == "fail":
            # a conflict only when unmerged paths are listed; any other non-zero merge is a failure
            c.label = "merge conflict" if unmerged.strip() else "merge failed"
        if c.status == "fail" or u.status == "fail":
            return s

        started = time.monotonic()
        merged_rc, merged, _secs, _ = r.git(ls_tree_args(ref), tkc)
        existing, incoming = _z_paths(before), _z_paths(merged)
        if before_rc != 0 or merged_rc != 0:
            side = "tk-studio HEAD" if before_rc != 0 else ref
            check = computed("every path is new", started, False, f"ls-tree of {side} failed",
                             "paths not new: ls-tree failed")
        elif not existing or not incoming:
            side = "tk-studio HEAD" if not existing else ref
            check = computed("every path is new", started, False, f"ls-tree of {side} listed no paths",
                             "paths not new: empty listing")
        else:
            folded = {p.casefold() for p in existing}
            overlap = sorted(p for p in incoming if p.casefold() in folded)
            check = computed("every path is new", started, not overlap,
                             (f"already in tk-studio (case-insensitive): {', '.join(overlap[:5])}"
                              if overlap else f"none of the {len(incoming)} paths of {ref} existed "
                              "in tk-studio (case-insensitive)"), "paths not new")
        s.checks.append(check)
        if check.status == "pass":
            r.size_check = measure_size(r, tkc)
    finally:
        c, _ = r.gitcheck("remove remote svc", ["remote", "remove", "svc"], tkc)
        s.checks.append(c)
    return s


def measure_size(r: Runner, tkc: Path) -> Check:
    rc, out, secs, _ = r.git(["count-objects", "-vH"], tkc)
    work, dotgit = _tree_bytes(tkc, skip_git=True), _tree_bytes(tkc / ".git", skip_git=False)
    return Check("clone size after merge", "info", "git count-objects -vH", r.rel(tkc), rc, secs,
                 r.cut(out), note=f"measured right after the merge, before the Step 4 checks; "
                 f"working tree {work} bytes (excluding .git); .git {dotgit} bytes")


def _hooks(settings: Path) -> list[tuple[str, str]]:
    data = json.loads(settings.read_text(encoding="utf-8"))
    out = []
    for event, groups in (data.get("hooks") or {}).items():
        for group in groups or []:
            for hook in (group or {}).get("hooks") or []:
                if hook.get("type", "command") == "command":
                    out.append((event, str(hook.get("command", ""))))
    return out


def hook_paths(command: str, root: str) -> list[str]:
    """Tokens of a hook command that resolve under $CLAUDE_PROJECT_DIR = root.

    The variable is split as one word and substituted afterwards, so a root with spaces never
    breaks the split."""
    marked = _PROJECT_DIR.sub(lambda _m: _PLACEHOLDER, command)
    try:
        tokens = shlex.split(marked, posix=True)
    except ValueError:
        tokens = marked.split()
    return [t.replace(_PLACEHOLDER, root) for t in tokens
            if _PLACEHOLDER in t and t.replace(_PLACEHOLDER, "").strip("/\\")]


def _shown(path: str, nested: Path) -> str:
    """A hook path for the report: relative to the nested root when it is under it, else as-is
    (a token like --script=$CLAUDE_PROJECT_DIR/x.py does not start at the root)."""
    try:
        return Path(path).relative_to(nested).as_posix()
    except ValueError:
        return path


def check_hooks(r: Runner, nested: Path) -> list[Check]:
    started = time.monotonic()
    settings = nested / ".claude" / "settings.json"
    rel = f"{PREFIX}/.claude/settings.json"
    if not settings.is_file():
        return [computed("hooks", started, False, f"{rel} missing", "hooks: settings.json missing")]
    try:
        hooks = _hooks(settings)
    except (ValueError, AttributeError, TypeError) as exc:
        return [computed("hooks", started, False, f"{rel} unreadable: {exc}",
                         "hooks: settings.json unreadable")]
    names = [event for event, _ in hooks]
    checks = [computed(f"hooks declared ({len(hooks)})", started, len(hooks) == EXPECTED_HOOKS,
                       f"{', '.join(names) or 'none'} (expected {EXPECTED_HOOKS})",
                       f"hooks count {len(hooks)}, expected {EXPECTED_HOOKS}")]
    root = str(nested).replace("\\", "/")
    for event, command in hooks:
        started = time.monotonic()
        paths = hook_paths(command, root)
        missing = [p for p in paths if not Path(p).exists()]
        if not paths:
            passed, note = False, "no script path under $CLAUDE_PROJECT_DIR to resolve"
        elif missing:
            passed, note = False, "missing: " + ", ".join(_shown(p, nested) for p in missing)
        else:
            passed, note = True, "resolves: " + ", ".join(_shown(p, nested) for p in paths)
        c = computed(f"hook {event} script path", started, passed,
                     f"$CLAUDE_PROJECT_DIR = {PREFIX}; {note} (static, never executed)")
        c.command, c.cwd = command, r.rel(nested)
        checks.append(c)
    checks.append(unverifiable(
        "hooks fire live with $CLAUDE_PROJECT_DIR = nested root",
        "needs a Claude session; hook commands are never executed here. Start claude there, trust "
        f"the folder, run one prompt, and confirm each of {', '.join(names) or 'the hooks'} wrote "
        f"its marker/log under {AGENT_PC_NESTED}\\.bmad-loop",
        rf"cd {AGENT_PC_NESTED}; claude"))
    return checks


def step_nested(s: Step, r: Runner, args, tkc: Path) -> Step:
    nested = tkc / PREFIX

    # tk activate from the nested root, the merged clone's own plugin entry point
    plugin = tkc / "plugins" / "tk-studio"
    script = plugin / "skills" / "tk-studio-activate" / "scripts" / "drift_check.py"

    def clean(rc, out):
        data = _parse_json(out)
        if not isinstance(data, dict):
            return False, "no JSON result"
        result, fixes = data.get("result"), data.get("fixes") or []
        note = f"result={result}; fixes={json.dumps(fixes, ensure_ascii=False)}"
        return rc == 0 and result == "clean", note

    if script.is_file() and plugin.is_dir():
        c, _ = r.check("tk activate", ["uv", "run", str(script), "--directory", str(nested)], plugin,
                       ok=clean, note=DRIFT_NOTE)
    else:
        c = computed("tk activate", time.monotonic(), False,
                     "plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py missing")
    s.checks.append(c)

    # bmad-loop finds its run workspace from the nested root
    if shutil.which("bmad-loop"):
        c, _ = r.check("bmad-loop list", ["bmad-loop", "list", "--json"], nested,
                       ok=bmad_loop_listed(nested))
        s.checks.append(c)
        c, _ = r.check("bmad-loop validate", ["bmad-loop", "validate", "--project", str(nested), "--json"], nested)
        c.status = "info"
        c.note = "informational (a dirty tree in a scratch clone is expected)"
        s.checks.append(c)
    else:
        s.checks.append(unverifiable("bmad-loop list", "bmad-loop is not on this host's PATH",
                                     rf"cd {AGENT_PC_NESTED}; bmad-loop list --json"))

    # the supervisor's bun test
    if shutil.which("bun"):
        c, _ = r.check("bun install", ["bun", "install", "--frozen-lockfile"], nested)
        s.checks.append(c)
        if c.status == "pass":
            c, _ = r.check("bun test", ["bun", "test"], nested)
            s.checks.append(c)
    else:
        s.checks.append(unverifiable("bun test", "bun is not on this host's PATH",
                                     rf"cd {AGENT_PC_NESTED}; bun install --frozen-lockfile; bun test"))

    # tk-studio's host gates from the repository root
    c, _ = r.check("verify_host", ["uv", "run", "python", "tools/verify_host.py"], tkc)
    s.checks.append(c)

    s.checks.extend(check_hooks(r, nested))

    s.checks.append(unverifiable(
        "nested folder trusted",
        "folder trust is per folder on the Windows box (runbook 4.1); accept the trust dialog when "
        "claude starts there",
        rf"cd {AGENT_PC_NESTED}; claude"))

    # clone size, measured in Step 3 right after the merge (recorded, never pass/fail)
    if r.size_check is not None:
        s.checks.append(r.size_check)
    return s


def step_sandboxes(s: Step) -> Step:
    s.checks.append(unverifiable(
        "one sandbox serves both loops", "sandbox provisioning runs on the agent PC (runbook 3.8, 4)",
        r"cd $HOME; sbx create --skills readonly --name claude-tk-studio claude C:\GitHub\tk-studio; "
        "sbx exec claude-tk-studio bash -lc 'cd /c/GitHub/tk-studio/apps/supervisor && "
        "bun install --frozen-lockfile && bun test && cd /c/GitHub/tk-studio/plugins/tk-studio/lib && "
        "uv run python ../contracts/conformance/runner.py run'"))
    return s


# --- the report -------------------------------------------------------------------------------

def verdict(steps: list[Step]) -> str:
    for s in steps:
        bad = s.failed
        if bad:
            return f"Verdict: failed at {s.short} — {bad.label or bad.name}"
    return "Verdict: rehearsal passed"


def render(steps: list[Step], meta: dict[str, str]) -> str:
    lines = [f"# Restructure rehearsal — {meta['date']}", ""]
    lines += [f"- {k}: `{v}`" for k, v in meta.items() if k != "date"]
    lines.append("")
    unver: list[tuple[str, Check]] = []
    for s in steps:
        lines += [f"## {s.title}", ""]
        if s.not_run:
            lines += [f"not run ({s.not_run})", ""]
            continue
        for c in s.checks:
            if c.status == "unverifiable":
                unver.append((s.short, c))
                lines += [f"### {c.name} — unverifiable-here", "", f"- note: {c.note}", ""]
                continue
            lines += [f"### {c.name} — {c.status}", ""]
            if c.command:
                lines.append(f"- command: `{c.command}`")
            if c.cwd:
                lines.append(f"- cwd: `{c.cwd}`")
            if c.rc is not None:
                lines.append(f"- exit code: {c.rc}")
            if c.seconds is not None:
                lines.append(f"- duration: {c.seconds:.2f}s")
            if c.note:
                lines.append(f"- note: {c.note}")
            lines.append("")
            if c.tail or c.rc is not None:  # every command run records its output tail (AC2)
                lines += ["```text", c.tail.replace("```", "'''") or "(no output)", "```", ""]
    lines += ["## unverifiable-here", ""]
    if unver:
        for step, c in unver:
            lines.append(f"- **{c.name}** ({step}): {c.note}. Agent PC: `{c.agent_pc}`")
    else:
        lines.append("- none")
    lines += ["", verdict(steps)]
    return "\n".join(lines) + "\n"


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# --- main -------------------------------------------------------------------------------------

def rehearse(args: argparse.Namespace, scratch: Path, report: Path) -> tuple[int, str]:
    r = Runner(scratch, args.tail, args.timeout)
    svc, tkc = scratch / "svc-rewrite", scratch / "tk-studio"
    stages = (lambda s: step_freeze(s, r, args, svc, tkc),
              lambda s: step_rewrite(s, r, args, svc),
              lambda s: step_merge(s, r, args, svc, tkc),
              lambda s: step_nested(s, r, args, tkc),
              step_sandboxes)
    steps: list[Step] = []
    stopped = ""
    for index, stage in enumerate(stages):
        if stopped:
            steps.append(Step(STEP_TITLES[index], not_run=stopped))
            continue
        step = Step(STEP_TITLES[index])
        started = time.monotonic()
        try:
            stage(step)
        except Refused:
            raise
        except Exception as exc:  # AC4: whatever happens inside a step, the report and verdict follow
            text = " ".join(f"{type(exc).__name__}: {exc}".split())  # one-line verdict (AC4)
            step.checks.append(computed("unexpected error", started, False, text,
                                        f"unexpected error ({text})"))
        steps.append(step)
        if step.failed is not None and index < 3:  # a Step 1, 2 or 3 failure stops later steps
            stopped = f"{step.short} failed"
        elif any(c.name == "unexpected error" for c in step.checks):
            stopped = f"{step.short} raised an unexpected error"
    meta = {"date": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d"),
            "supervisor": args.supervisor_src, "tk-studio": args.tk_studio_src, "scratch": str(scratch),
            "supervisor branch": args.supervisor_branch,
            "filter-repo": shlex.join(resolve_filter_repo(args.filter_repo) or ["(none found)"]),
            "timeout per check": f"{args.timeout:g}s"}
    write_atomic(report, render(steps, meta))
    last = verdict(steps)
    return (0 if last == "Verdict: rehearsal passed" else 1), last


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="rehearse the supervisor's move into apps/supervisor "
                                                 "on throwaway clones and write a report")
    parser.add_argument("--supervisor", required=True, help="supervisor repository (path or file:// URL)")
    parser.add_argument("--tk-studio", default=str(ROOT), help="tk-studio repository (default: this one, cloned)")
    parser.add_argument("--scratch", help="new or empty scratch folder (default: a new temp folder)")
    parser.add_argument("--report", help="report path (default: _bmad-output/implementation-artifacts/"
                                         "restructure-rehearsal-<UTC date>.md)")
    parser.add_argument("--supervisor-branch", default="main", help="the rewrite's branch to merge")
    parser.add_argument("--filter-repo", help="argv0 of git-filter-repo (a .py runs with this Python)")
    parser.add_argument("--allow-remote-source", action="store_true", help="allow cloning non-local sources")
    parser.add_argument("--tail", type=int, default=20, help="last output lines recorded per check")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT,
                        help=f"seconds per command before it is a failed check (default {DEFAULT_TIMEOUT})")
    parser.add_argument("--keep", action=argparse.BooleanOptionalAction, default=True,
                        help="keep the scratch folder for inspection (default: keep)")
    args = parser.parse_args(argv)
    try:
        sup, tks, scratch, report = guard(args)
    except Refused as exc:
        print(f"rehearse: refused: {exc}", file=sys.stderr)
        return 2
    # clone from the resolved local path (a relative source means the caller's cwd); URLs as given
    args.supervisor_src = str(sup) if sup is not None else args.supervisor
    args.tk_studio_src = str(tks) if tks is not None else args.tk_studio
    if scratch is None:
        scratch = Path(tempfile.mkdtemp(prefix="tk-rehearse-")).resolve()
    else:
        scratch.mkdir(parents=True, exist_ok=True)
    code, last = rehearse(args, scratch, report)
    print(f"rehearse: report {report}")
    if args.keep:
        print(f"rehearse: scratch kept at {scratch}")
    else:
        shutil.rmtree(scratch, ignore_errors=True)
    print(last)
    return code


if __name__ == "__main__":
    sys.exit(main())
