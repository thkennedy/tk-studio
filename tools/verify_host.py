"""tk-studio's host verify entry point (supervisor Story 27.4, `verify.host` in .tk-studio/config.yaml).

The supervisor runs one command line on the Windows host in a run's worktree, argv only, never a
shell, so the host gates (the lib suite and the conformance run, in two directories, and the studio
web's build and tests, Story 30.1) live behind this single script. It runs them in turn with
subprocess (argv only), prints each gate's result as it ends, repeats every failing gate's output tail
last, and exits non-zero when any failed.

The studio-web gate (`bun run verify` in apps/studio-web) runs only when apps/studio-web changed
since the merge base with `main` (else `origin/main`), uncommitted and untracked edits included; it prints one skip
line with the reason when unchanged, and runs anyway, saying why, when the base or git is unavailable.

Usage: uv run python tools/verify_host.py [--tail N]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
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


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=GIT_TIMEOUT)


def studio_web_changed() -> tuple[bool, str]:
    """Whether apps/studio-web differs from the merge base with main (else origin/main), working tree
    and untracked files included. Any git failure or no base resolves to (True, "<why>; running anyway"):
    never a silent skip."""
    try:
        base = ""
        for ref in ("main", "origin/main"):
            proc = _git("merge-base", "HEAD", ref)
            if proc.returncode == 0 and proc.stdout.strip():
                base = proc.stdout.strip()
                break
        if not base:
            return True, "no merge base with main or origin/main; running anyway"
        proc = _git("diff", "--name-only", base, "--", "apps/studio-web")
        if proc.returncode != 0:
            why = (proc.stderr or proc.stdout).strip().splitlines()
            return True, f"git diff failed ({why[-1] if why else f'rc={proc.returncode}'}); running anyway"
        changed = proc.stdout.strip()
        # A new, not yet committed file is no diff against the base; count it as a change too.
        proc = _git("ls-files", "--others", "--exclude-standard", "--", "apps/studio-web")
        if proc.returncode != 0:
            return True, f"git ls-files failed (rc={proc.returncode}); running anyway"
        changed += proc.stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        return True, f"git unavailable ({exc}); running anyway"
    if changed:
        return True, f"apps/studio-web changed since {base[:12]}"
    return False, f"apps/studio-web unchanged since {base[:12]}"


def run_gate(name: str, cwd: Path, argv: list[str]) -> tuple[int, str, float]:
    started = time.monotonic()
    try:
        proc = subprocess.run(argv, cwd=str(cwd), capture_output=True, text=True, encoding="utf-8",
                              errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    except FileNotFoundError as exc:
        return 127, f"{name}: cannot start {argv[0]!r}: {exc}", time.monotonic() - started
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out, time.monotonic() - started


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="run tk-studio's host gates (lib suite, conformance, studio-web when changed) with argv only")
    parser.add_argument("--tail", type=int, default=40, help="lines of each failing gate's output to repeat last")
    args = parser.parse_args(argv)
    failures: list[tuple[str, int, str]] = []
    gates = list(GATES)
    web_changed, why = studio_web_changed()
    if web_changed:
        gates.append(STUDIO_WEB_GATE)
    ran: list[str] = []
    for name, cwd, cmd in gates:
        if name == STUDIO_WEB_GATE[0]:
            print(f"== {name}: {why}", flush=True)
        print(f"== {name}: {' '.join(cmd)}  (cwd {cwd.relative_to(ROOT)})", flush=True)
        rc, out, seconds = run_gate(name, cwd, cmd)
        verdict = "ok" if rc == 0 else f"FAILED rc={rc}"
        print(f"== {name}: {verdict} in {seconds:.0f}s", flush=True)
        ran.append(name)
        if rc != 0:
            failures.append((name, rc, out))
    if not web_changed:
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
