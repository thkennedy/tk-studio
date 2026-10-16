"""tk-studio's host verify entry point (supervisor Story 27.4, `verify.host` in .tk-studio/config.yaml).

The supervisor runs one command line on the Windows host in a run's worktree, argv only, never a
shell, so the two host gates (the lib suite and the conformance run, in two directories) live behind
this single script. It runs both in turn with subprocess (argv only), prints each gate's result as it
ends, repeats every failing gate's output tail last, and exits non-zero when either failed.

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
    parser = argparse.ArgumentParser(description="run tk-studio's host gates (lib suite, conformance) with argv only")
    parser.add_argument("--tail", type=int, default=40, help="lines of each failing gate's output to repeat last")
    args = parser.parse_args(argv)
    failures: list[tuple[str, int, str]] = []
    for name, cwd, cmd in GATES:
        print(f"== {name}: {' '.join(cmd)}  (cwd {cwd.relative_to(ROOT)})", flush=True)
        rc, out, seconds = run_gate(name, cwd, cmd)
        verdict = "ok" if rc == 0 else f"FAILED rc={rc}"
        print(f"== {name}: {verdict} in {seconds:.0f}s", flush=True)
        if rc != 0:
            failures.append((name, rc, out))
    if not failures:
        print("verify_host: ok (lib suite, conformance)")
        return 0
    for name, rc, out in failures:
        tail = out.rstrip().splitlines()[-args.tail:]
        print(f"\n== {name} failed (rc={rc}); last {len(tail)} lines:")
        print("\n".join(tail))
    print(f"\nverify_host: FAILED ({', '.join(n for n, _, _ in failures)})")
    return 1


if __name__ == "__main__":
    sys.exit(main())
