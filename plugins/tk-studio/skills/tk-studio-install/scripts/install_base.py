"""tk-studio-install — run the upstream BMad installer at the bmad.lock pin (FR3, AD-1).

Never forks, never vendors: builds the exact non-interactive `npx
bmad-method@<pin> install` invocation from the committed lock, runs it, then
verifies the resulting _bmad/_config/manifest.yaml against the pins and emits
one install-outcome measurement event.

Usage:
  uv run install_base.py [--directory DIR] [--modules a,b,c] [--dry-run] [--timeout SECS]

  --directory  project root to install into (default: cwd)
  --modules    subset of the lock's module set (default: all pinned modules)
  --dry-run    print the command and verification plan without running anything
               (no event is emitted)

Output: one JSON object on stdout. Exit 0 = installed and verified at pin;
2 = usage/lock error; 1 = install or verification failure.
Stdlib-only (NFR9); no prompts ever (AD-11) — stdin is closed for the child.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import bmadlock  # noqa: E402
import ledger  # noqa: E402

LOCK_PATH = PLUGIN_ROOT / "bmad.lock"


def build_command(lock: dict, directory: Path, modules: list[str]) -> list[str]:
    core = lock["core"]
    npx = shutil.which("npx")
    if not npx:
        raise bmadlock.LockParseError("npx not found on PATH — Node.js is required")
    cmd = [
        npx, "--yes", f"{core['package']}@{core['version']}", "install",
        "--directory", str(directory),
        "--modules", ",".join(modules),
        "--tools", ",".join(lock["install"].get("tools", ["claude-code"])),
    ]
    cmd += lock["install"].get("flags", [])
    for name in modules:
        spec = lock["modules"][name]
        if isinstance(spec, dict) and spec.get("source") == "external":
            cmd += ["--pin", f"{name}={spec['version']}"]
    return cmd


def verify_installed(directory: Path, lock: dict, modules: list[str]) -> list[str]:
    """Return a list of mismatch descriptions (empty = verified at pin)."""
    installed = bmadlock.read_installed_manifest(
        directory / "_bmad" / "_config" / "manifest.yaml"
    )
    pins = bmadlock.lock_pins(lock)
    problems = []
    for name in ["core", *modules]:
        want = pins.get(name)
        got = installed.get(name)
        if got is None:
            problems.append(f"{name}: pinned {want} but not present after install")
        elif got != want:
            problems.append(f"{name}: pinned {want} but installed {got}")
    return problems


def emit_outcome(outcome: str, lock: dict, modules: list[str],
                 step: str | None = None, detail: str | None = None) -> None:
    payload = {
        "outcome": outcome,
        "core_version": lock["core"]["version"],
        "modules": {m: bmadlock.lock_pins(lock)[m] for m in modules},
    }
    if step:
        payload["step"] = step
    if detail:
        payload["detail"] = detail[-800:]
    try:
        ledger.emit("install-outcome", payload)
    except Exception as exc:  # measurement must never break the install verb
        print(f"warning: install-outcome event not recorded: {exc}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".")
    parser.add_argument("--modules", help="comma-separated subset of the lock's modules")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args(argv)

    directory = Path(args.directory).resolve()
    try:
        lock = bmadlock.parse_lock(LOCK_PATH)
        all_modules = list(lock.get("modules", {}))
        modules = [m.strip() for m in args.modules.split(",")] if args.modules else all_modules
        unknown = sorted(set(modules) - set(all_modules))
        if unknown:
            raise bmadlock.LockParseError(
                f"modules not in bmad.lock: {', '.join(unknown)}"
            )
        cmd = build_command(lock, directory, modules)
    except bmadlock.LockParseError as exc:
        print(json.dumps({"ok": False, "step": "read-lock", "error": str(exc)}))
        return 2

    if args.dry_run:
        print(json.dumps({
            "ok": True, "dry_run": True, "command": cmd,
            "verify": f"compare {directory / '_bmad/_config/manifest.yaml'} against lock pins",
        }))
        return 0

    try:
        proc = subprocess.run(
            cmd, cwd=str(directory), stdin=subprocess.DEVNULL,
            capture_output=True, encoding="utf-8", errors="replace",
            timeout=args.timeout,
        )
    except subprocess.TimeoutExpired as exc:
        detail = f"installer exceeded {args.timeout}s"
        emit_outcome("failure", lock, modules, step="upstream-installer", detail=detail)
        print(json.dumps({"ok": False, "step": "upstream-installer", "error": detail}))
        return 1
    tail = "\n".join(
        ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip().splitlines()[-15:]
    )
    if proc.returncode != 0:
        emit_outcome("failure", lock, modules, step="upstream-installer", detail=tail)
        print(json.dumps({"ok": False, "step": "upstream-installer",
                          "exit": proc.returncode, "tail": tail}))
        return 1

    try:
        problems = verify_installed(directory, lock, modules)
    except bmadlock.LockParseError as exc:
        problems = [str(exc)]
    if problems:
        emit_outcome("failure", lock, modules, step="verify-at-pin",
                     detail="; ".join(problems))
        print(json.dumps({"ok": False, "step": "verify-at-pin", "problems": problems}))
        return 1

    emit_outcome("success", lock, modules)
    print(json.dumps({
        "ok": True,
        "core": lock["core"]["version"],
        "modules": {m: bmadlock.lock_pins(lock)[m] for m in modules},
        "directory": str(directory),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
