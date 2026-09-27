"""tk-studio-install — run the upstream BMad installer at the bmad.lock pin (FR3, AD-1).

Never forks, never vendors: builds the exact non-interactive `npx
bmad-method@<pin> install` invocation from the committed lock, runs it, then
verifies the resulting _bmad/_config/manifest.yaml against the pins and emits
one install-outcome measurement event.

A verified install then normalizes the reinstall's no-op churn (EP-011 D2,
lib/bmadchurn.py) when the project root is a git top-level: files upstream
rewrote to something provably equivalent to the committed blob are restored,
and its *.bak copies of committed files are dropped — so installing at the
pin over a tree committed at that pin leaves `git status` clean. Paths that
were already dirty before the run are never touched; real changes stay and
are counted in `normalized.remaining`.

Usage:
  uv run install_base.py [--directory DIR] [--modules a,b,c] [--dry-run]
                         [--timeout SECS] [--no-normalize]

  --directory     project root to install into (default: cwd)
  --modules       subset of the lock's module set (default: all pinned modules)
  --dry-run       print the command and verification plan without running
                  anything (no event is emitted)
  --no-normalize  leave the upstream installer's output exactly as written

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

import bmadchurn  # noqa: E402
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
    # With an existing _bmad tree, the upstream installer defaults --yes runs
    # to its quick-update action, which ignores --modules and --pin entirely
    # (upstream ui.js: only --custom-source forces the full path). Name the
    # action explicitly so the pinned invocation stays pinned on reinstalls.
    if (directory / "_bmad").is_dir():
        cmd += ["--action", "update"]
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


def pre_install_snapshot(directory: Path) -> tuple[frozenset[str] | None, str | None]:
    """(paths already dirty under the churn roots, None) when normalization
    can run after the install, else (None, reason it cannot)."""
    reason = bmadchurn.unavailable_reason(directory)
    if reason:
        return None, reason
    try:
        return bmadchurn.dirty_paths(directory), None
    except RuntimeError as exc:
        return None, str(exc)[:200]


def normalize_after_install(directory: Path, preserve: frozenset[str]) -> dict:
    """Normalize a verified install. A failure here never fails the install
    (it is verified at pin already); it is reported with the one recovery
    step, since a stop mid-checkout can leave its batch of files deleted."""
    try:
        result = bmadchurn.normalize_churn(directory, preserve)
    except (RuntimeError, OSError) as exc:
        return {"error": f"normalization stopped: {str(exc)[:300]}",
                "recover": "files shown deleted by `git status` were being "
                           "restored to their committed copy — `git restore` "
                           "them to finish"}
    if preserve:
        result["preserved"] = len(preserve)
    return result


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
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".")
    parser.add_argument("--modules", help="comma-separated subset of the lock's modules")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--no-normalize", action="store_true",
                        help="leave the upstream installer's output exactly as written")
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
        skip = "--no-normalize" if args.no_normalize else bmadchurn.unavailable_reason(directory)
        print(json.dumps({
            "ok": True, "dry_run": True, "command": cmd,
            "verify": f"compare {directory / '_bmad/_config/manifest.yaml'} against lock pins",
            "normalize": (f"skipped: {skip}" if skip else
                          f"revert provable churn under {', '.join(bmadchurn.CHURN_ROOTS)}"),
        }))
        return 0

    if args.no_normalize:
        preserve, skip = None, "--no-normalize"
    else:
        preserve, skip = pre_install_snapshot(directory)

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
    normalized = ({"skipped": skip} if preserve is None
                  else normalize_after_install(directory, preserve))
    print(json.dumps({
        "ok": True,
        "core": lock["core"]["version"],
        "modules": {m: bmadlock.lock_pins(lock)[m] for m in modules},
        "directory": str(directory),
        "normalized": normalized,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
