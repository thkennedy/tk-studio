"""tk-studio's host verify entry point (supervisor Story 27.4, `verify.host` in .tk-studio/config.yaml).

The supervisor runs one command line on the Windows host in a run's worktree, argv only, never a
shell, so the host gates (the lib suite and the conformance run, in two directories, the supervisor's
suites, Story 33.4, and the studio web's build and tests, Story 30.1) live behind this single script. It
runs them in turn with subprocess (argv only), in the order lib suite, conformance, supervisor,
studio-web, prints each gate's result as it ends, repeats every failing gate's output tail last, and
exits non-zero when any failed.

The supervisor and studio-web gates run only when their app (apps/supervisor, apps/studio-web) changed
since the merge base with `main` (else `origin/main`), uncommitted and untracked edits included; each
prints one skip line with the reason when unchanged, and runs anyway, saying why, when the base or git
is unavailable.

The studio-web gate is `bun run verify` in apps/studio-web. The supervisor gate (holes 51, 56, 63, 64)
runs every apps/supervisor/test/*.test.ts but the e2e suite (command-line.test.ts) in its own
`bun test <file>`, each under a 420 s timeout (the tree killed past it), with every TK_SUPERVISOR_*
variable stripped from the environment and TMPDIR/TEMP/TMP at a per-run folder
`<tempfile.gettempdir()>/tk-verify-supervisor-<UTC stamp>-<pid>/` (the gate's own temp folder, outside
any git checkout: the suites' queues refuse a path inside one, and the gate fails before the first file
when an ancestor of the folder holds `.git`) that it removes afterwards, read-only files included (a
removal that fails fails the gate); then `bunx tsc --noEmit -p apps/supervisor` from the root (`bun x tsc` when bunx
cannot start), which still type-checks the e2e suite, with apps/supervisor/node_modules/.bin first on PATH so
bunx runs the app's own installed TypeScript (the root has no node_modules: bunx would download the latest). It prints one line per file with its pass/fail
counts, the tsc line, and a closing line with the totals and the slowest file. A file that cannot start
counts as failed (rc 127); past its timeout the file's process tree is killed (its process group on
POSIX).

Usage: uv run python tools/verify_host.py [--tail N]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

# The console may be cp1252 (the supervisor's host leg on Windows); bun's output carries arrows and ticks.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "tk-studio"

GATES = (
    ("lib suite", PLUGIN / "lib", ["uv", "run", "python", "-m", "unittest", "discover", "tests"]),
    ("conformance", PLUGIN, ["uv", "run", "python", "contracts/conformance/runner.py", "run"]),
)
STUDIO_WEB = ROOT / "apps" / "studio-web"
STUDIO_WEB_GATE = ("studio-web", STUDIO_WEB, ["bun", "run", "verify"])
GIT_TIMEOUT = 60

SUPERVISOR = ROOT / "apps" / "supervisor"
SUPERVISOR_GATE = "supervisor"
SUPERVISOR_E2E = "command-line.test.ts"  # spawns `bun src/cli.ts`; run by hand, type-checked by tsc
SUPERVISOR_FILE_TIMEOUT = 420
SUPERVISOR_ENV_PREFIX = "TK_SUPERVISOR_"
TEMP_PREFIX = "tk-verify-supervisor"
TSC_ARGV = (["bunx", "tsc", "--noEmit", "-p", "apps/supervisor"], ["bun", "x", "tsc", "--noEmit", "-p", "apps/supervisor"])
REMOVE_TRIES = 3
REMOVE_WAIT_S = 1.0
DRAIN_TIMEOUT = 10  # the bound on reading what a killed tree left in the pipe

_PASS = re.compile(r"^\s*(\d+) pass\s*$", re.MULTILINE)
_FAIL = re.compile(r"^\s*(\d+) fail\s*$", re.MULTILINE)


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=GIT_TIMEOUT)


def app_changed(rel: str) -> tuple[bool, str]:
    """Whether `rel` (e.g. apps/studio-web) differs from the merge base with main (else origin/main),
    working tree and untracked files included. Any git failure or no base resolves to
    (True, "<why>; running anyway"): never a silent skip."""
    try:
        base = ""
        for ref in ("main", "origin/main"):
            proc = _git("merge-base", "HEAD", ref)
            if proc.returncode == 0 and proc.stdout.strip():
                base = proc.stdout.strip()
                break
        if not base:
            return True, "no merge base with main or origin/main; running anyway"
        proc = _git("diff", "--name-only", base, "--", rel)
        if proc.returncode != 0:
            why = (proc.stderr or proc.stdout).strip().splitlines()
            return True, f"git diff failed ({why[-1] if why else f'rc={proc.returncode}'}); running anyway"
        changed = proc.stdout.strip()
        # A new, not yet committed file is no diff against the base; count it as a change too.
        proc = _git("ls-files", "--others", "--exclude-standard", "--", rel)
        if proc.returncode != 0:
            return True, f"git ls-files failed (rc={proc.returncode}); running anyway"
        changed += proc.stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return True, f"git unavailable ({exc}); running anyway"
    if changed:
        return True, f"{rel} changed since {base[:12]}"
    return False, f"{rel} unchanged since {base[:12]}"


def run_gate(name: str, cwd: Path, argv: list[str]) -> tuple[int, str, float]:
    started = time.monotonic()
    try:
        proc = subprocess.run(argv, cwd=str(cwd), capture_output=True, text=True, encoding="utf-8",
                              errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    except FileNotFoundError as exc:
        return 127, f"{name}: cannot start {argv[0]!r}: {exc}", time.monotonic() - started
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out, time.monotonic() - started


# ------------------------------------------------------------ the supervisor gate (Story 33.4)

def supervisor_files() -> list[str]:
    """Every apps/supervisor/test/*.test.ts but the e2e suite, as `test/<name>`, sorted."""
    return sorted(f"test/{p.name}" for p in (SUPERVISOR / "test").glob("*.test.ts") if p.name != SUPERVISOR_E2E)


def supervisor_env(tmp: Path) -> dict[str, str]:
    """The host's environment without any TK_SUPERVISOR_* variable, with TMPDIR/TEMP/TMP at `tmp`
    (TMP too: Windows' GetTempPath reads it first)."""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(SUPERVISOR_ENV_PREFIX)}
    env.update({"PYTHONIOENCODING": "utf-8", "TMPDIR": str(tmp), "TEMP": str(tmp), "TMP": str(tmp)})
    return env


def _kill_tree(proc: subprocess.Popen) -> None:
    if sys.platform == "win32":
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, timeout=GIT_TIMEOUT)
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # the child leads its own session: the whole group
        except OSError:
            pass
    try:
        proc.kill()
    except OSError:
        pass


def spawn(argv: list[str], cwd: Path, env: dict[str, str], timeout: float) -> tuple[int | None, str]:
    """Run `argv` (argv only) with both streams captured; `(None, out)` when it timed out and its tree
    was killed. Raises OSError when the program cannot start. On POSIX the child leads a new session,
    so the kill reaches its grandchildren; reading what is left after the kill is bounded by
    DRAIN_TIMEOUT, so a survivor still holding the pipe cannot hold the gate. Any other exception
    raised while reading (a KeyboardInterrupt) kills the tree the same way and is raised again."""
    proc = subprocess.Popen(argv, cwd=str(cwd), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
                            start_new_session=sys.platform != "win32")
    try:
        out, _ = proc.communicate(timeout=timeout)
        return proc.returncode, out or ""
    except subprocess.TimeoutExpired as exc:
        _kill_tree(proc)
        try:
            out, _ = proc.communicate(timeout=DRAIN_TIMEOUT)
        except subprocess.TimeoutExpired as drained:
            out = drained.output or exc.output or ""
            if isinstance(out, bytes):
                out = out.decode("utf-8", "replace")
        return None, out or ""
    except BaseException:  # a KeyboardInterrupt mid-read: the tree must not outlive the gate's temp folder
        _kill_tree(proc)
        try:
            proc.communicate(timeout=DRAIN_TIMEOUT)
        except subprocess.TimeoutExpired:
            pass
        raise


def bun_counts(out: str) -> tuple[int | None, int | None]:
    """bun's ` <n> pass` / ` <n> fail` summary lines (the last of each); None when absent."""
    p, f = _PASS.findall(out), _FAIL.findall(out)
    return (int(p[-1]) if p else None, int(f[-1]) if f else None)


def temp_base() -> Path:
    """The gate's own temp folder (tempfile.gettempdir(), from this process's TMPDIR/TEMP/TMP, which
    the gate never overrides; only the children's environment points at the per-run folder)."""
    return Path(tempfile.gettempdir())


def git_ancestor(path: Path) -> Path | None:
    """The first of `path` and its ancestors that contains `.git`, else None."""
    resolved = path.resolve()
    for folder in (resolved, *resolved.parents):
        if (folder / ".git").exists():
            return folder
    return None


def _clear_readonly(func, path, exc) -> None:
    """rmtree's error handler: a read-only file (a killed suite's fixture git objects on Windows) gets
    its write bit back and the removal is retried once; anything else is raised again."""
    error = exc[1] if isinstance(exc, tuple) else exc  # onerror passes exc_info, onexc the exception
    if func not in (os.unlink, os.remove, os.rmdir):
        raise error
    os.chmod(path, os.lstat(path).st_mode | stat.S_IWRITE)
    func(path)


def _rmtree(tmp: Path) -> None:
    if sys.version_info >= (3, 12):
        shutil.rmtree(tmp, ignore_errors=False, onexc=_clear_readonly)
    else:
        shutil.rmtree(tmp, ignore_errors=False, onerror=_clear_readonly)


def remove_tmp(tmp: Path) -> str | None:
    """Remove the per-run folder, read-only files included (retried on PermissionError).
    The error text when the folder could not be removed, else None."""
    for attempt in range(REMOVE_TRIES):
        try:
            if tmp.exists():
                _rmtree(tmp)
            return None
        except PermissionError as exc:
            if attempt == REMOVE_TRIES - 1:
                return str(exc)
            time.sleep(REMOVE_WAIT_S)
        except OSError as exc:
            return str(exc)
    return None


def run_supervisor_gate() -> tuple[int, str]:
    """Run the supervisor gate, printing its lines. `(rc, output for the failing tail)`."""
    started = time.monotonic()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    tmp: Path | None = None
    failed = False
    tails: list[str] = []
    timings: list[tuple[str, float]] = []
    total_pass = total_fail = 0
    files = supervisor_files()

    def refuse(message: str) -> None:
        nonlocal failed
        failed = True
        print(message, flush=True)
        tails.append(message)

    try:
        try:
            tmp = temp_base() / f"{TEMP_PREFIX}-{stamp}-{os.getpid()}"
            tmp.mkdir(parents=True)
        except OSError as exc:
            refuse(f"== {SUPERVISOR_GATE}: cannot create the temp folder {tmp or 'under the temp folder'}: {exc}")
            tmp = None
            files = []
        checkout = git_ancestor(tmp) if tmp is not None else None
        if checkout is not None:
            refuse(f"== {SUPERVISOR_GATE}: the temp folder {tmp} is inside a git checkout ({checkout}); "
                   "the suites' queues refuse it, set TMP/TEMP/TMPDIR outside any checkout")
            files = []
        if not failed and not files:  # the folder moved or the glob broke: 0 files is no pass
            refuse(f"== {SUPERVISOR_GATE}: no test/*.test.ts files under {SUPERVISOR / 'test'}")
        env = supervisor_env(tmp) if tmp is not None and not failed else {}
        for rel in files:
            t0 = time.monotonic()
            try:
                rc, out = spawn(["bun", "test", f"./{rel}"], SUPERVISOR, env, SUPERVISOR_FILE_TIMEOUT)
            except OSError as exc:
                rc, out = 127, f"cannot start 'bun': {exc}"
            seconds = time.monotonic() - t0
            timings.append((rel, seconds))
            p, f = bun_counts(out)
            total_pass += p or 0
            total_fail += f or 0
            line = f"== {SUPERVISOR_GATE}: {rel} {'?' if p is None else p} pass, {'?' if f is None else f} fail in {seconds:.0f}s"
            if rc is None:
                line += f" (timed out after {SUPERVISOR_FILE_TIMEOUT}s)"
            elif rc != 0:
                line += f" rc={rc}"
            print(line, flush=True)
            if rc != 0:
                failed = True
                tails.append(f"--- {rel}\n{out.rstrip()}")
        if env:
            t0 = time.monotonic()
            rc, out = 127, ""
            # bunx finds a bin on PATH before it downloads one: the app's own TypeScript, not the latest
            bins = str(SUPERVISOR / "node_modules" / ".bin")
            tsc_env = {**env, "PATH": os.pathsep.join(p for p in (bins, env.get("PATH", "")) if p)}
            for argv in TSC_ARGV:
                try:
                    rc, out = spawn(argv, ROOT, tsc_env, SUPERVISOR_FILE_TIMEOUT)
                    break
                except OSError as exc:
                    rc, out = 127, f"cannot start {argv[0]!r}: {exc}"
            seconds = time.monotonic() - t0
            if rc == 0:
                print(f"== {SUPERVISOR_GATE}: tsc ok in {seconds:.0f}s", flush=True)
            else:
                failed = True
                shown = f"timed out after {SUPERVISOR_FILE_TIMEOUT}s" if rc is None else f"rc={rc}"
                print(f"== {SUPERVISOR_GATE}: tsc FAILED {shown} in {seconds:.0f}s", flush=True)
                tails.append(f"--- tsc\n{out.rstrip()}")
    finally:
        error = remove_tmp(tmp) if tmp is not None else None
        if error is not None:
            failed = True
            message = f"== {SUPERVISOR_GATE}: could not remove {tmp}: {error}"
            print(message, flush=True)
            tails.append(message)
    slowest = max(timings, key=lambda t: t[1]) if timings else None
    slow = f"slowest {slowest[0]} {slowest[1]:.0f}s" if slowest else "slowest none"
    print(f"== {SUPERVISOR_GATE}: {'FAILED' if failed else 'ok'} in {time.monotonic() - started:.0f}s; "
          f"{len(files)} files, {total_pass} pass, {total_fail} fail; {slow}", flush=True)
    return (1 if failed else 0), "\n".join(tails)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="run tk-studio's host gates (lib suite, conformance, supervisor and studio-web when changed) with argv only")
    parser.add_argument("--tail", type=int, default=40, help="lines of each failing gate's output to repeat last")
    args = parser.parse_args(argv)
    failures: list[tuple[str, int, str]] = []
    ran: list[str] = []
    for name, cwd, cmd in GATES:
        print(f"== {name}: {' '.join(cmd)}  (cwd {cwd.relative_to(ROOT)})", flush=True)
        rc, out, seconds = run_gate(name, cwd, cmd)
        verdict = "ok" if rc == 0 else f"FAILED rc={rc}"
        print(f"== {name}: {verdict} in {seconds:.0f}s", flush=True)
        ran.append(name)
        if rc != 0:
            failures.append((name, rc, out))
    sup_changed, sup_why = app_changed("apps/supervisor")
    if sup_changed:
        print(f"== {SUPERVISOR_GATE}: {sup_why}", flush=True)
        rc, out = run_supervisor_gate()
        ran.append(SUPERVISOR_GATE)
        if rc != 0:
            failures.append((SUPERVISOR_GATE, rc, out))
    else:
        print(f"== {SUPERVISOR_GATE}: skipped ({sup_why})", flush=True)
    web_changed, why = app_changed("apps/studio-web")
    if web_changed:
        name, cwd, cmd = STUDIO_WEB_GATE
        print(f"== {name}: {why}", flush=True)
        print(f"== {name}: {' '.join(cmd)}  (cwd {cwd.relative_to(ROOT)})", flush=True)
        rc, out, seconds = run_gate(name, cwd, cmd)
        verdict = "ok" if rc == 0 else f"FAILED rc={rc}"
        print(f"== {name}: {verdict} in {seconds:.0f}s", flush=True)
        ran.append(name)
        if rc != 0:
            failures.append((name, rc, out))
    else:
        print(f"== {STUDIO_WEB_GATE[0]}: skipped ({why})", flush=True)
    if not failures:
        print(f"verify_host: ok ({', '.join(ran)})")
        return 0
    for name, rc, out in failures:
        tail = out.rstrip().splitlines()[-args.tail:]
        print(f"\n== {name} failed (rc={rc}); last {len(tail)} lines:")
        print("\n".join(tail))
    print(f"\nverify_host: FAILED ({', '.join(n for n, _, _ in failures)})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
