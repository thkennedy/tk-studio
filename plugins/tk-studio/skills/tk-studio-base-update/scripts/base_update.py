"""tk-studio-base-update — adopt an upstream BMad release as one reviewable motion (FR5, AD-1).

Flow (all on an isolated feature branch; the starting branch is never touched):
  1. preflight    clean working tree required; record the starting branch
  2. branch       create base-update/<stamp>
  3. bump         edit bmad.lock pins (core and/or per-module), commit the bump
  4. install      run tk-studio-install's script at the new pin (it verifies
                  against the pins and emits the install-outcome event)
  5. sync         refresh lock shas from the freshly installed manifest, commit
                  lockfile + full install diff
  6. pr           push and open the integration PR via gh (skipped with --no-pr)

On installer/verify failure: the working tree is restored (reset --hard to the
lock-bump commit + clean of _bmad strays), the starting branch is checked out
again, and the bump branch is left behind for inspection. Nothing ever merges
automatically.

Usage:
  uv run base_update.py [--core VERSION] [--pin MODULE=TAG ...]
                        [--directory DIR] [--dry-run] [--no-pr] [--timeout SECS]

At least one of --core/--pin is required (same-version re-affirmation runs are
allowed and useful for verifying the motion). Output: one JSON object.
Exit 0 ok; 1 install/verify failure (branch isolated); 2 usage/preflight error.
Stdlib-only (NFR9); no prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import bmadlock  # noqa: E402

LOCK_PATH = PLUGIN_ROOT / "bmad.lock"
INSTALL_SCRIPT = PLUGIN_ROOT / "skills" / "tk-studio-install" / "scripts" / "install_base.py"


def _git(directory: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args], cwd=str(directory), stdin=subprocess.DEVNULL,
        capture_output=True, encoding="utf-8", errors="replace",
    )
    if check and proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()[:300]}")
    return proc


# ------------------------------------------------------------- lock editing

def bump_lock_text(text: str, core: str | None, pins: dict[str, str]) -> str:
    """Rewrite version lines in the lock, scope-aware, preserving everything else."""
    out, scope, module = [], None, None
    remaining = dict(pins)
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^[\w.\-]+:", line):          # top-level key (no indent)
            scope, module = line.split(":")[0], None
        elif scope == "modules" and re.match(r"^  [\w.\-]+:\s*$", line):
            module = stripped[:-1]
        if core and scope == "core" and re.match(r"^\s+version:", line):
            line = re.sub(r"(version:\s*).*", rf"\g<1>{core}", line)
        elif module and module in remaining and re.match(r"^\s+version:", line):
            line = re.sub(r"(version:\s*).*", rf"\g<1>{remaining.pop(module)}", line)
        out.append(line)
    if remaining:
        raise ValueError(f"modules not found in bmad.lock: {', '.join(sorted(remaining))}")
    return "\n".join(out) + "\n"


def sync_shas_text(text: str, shas: dict[str, str]) -> str:
    """Refresh module sha lines from the installed manifest."""
    out, scope, module = [], None, None
    for line in text.splitlines():
        if re.match(r"^[\w.\-]+:", line):
            scope, module = line.split(":")[0], None
        elif scope == "modules" and re.match(r"^  [\w.\-]+:\s*$", line):
            module = line.strip()[:-1]
        if module and module in shas and re.match(r"^\s+sha:", line):
            line = re.sub(r"(sha:\s*).*", rf"\g<1>{shas[module]}", line)
        out.append(line)
    return "\n".join(out) + "\n"


def read_manifest_shas(manifest_path: Path) -> dict[str, str]:
    shas: dict[str, str] = {}
    current = None
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s+-\s+name:\s*(\S+)", raw)
        if m:
            current = m.group(1)
            continue
        m = re.match(r"^\s+sha:\s*(\S+)", raw)
        if m and current:
            shas[current] = m.group(1)
    return shas


# -------------------------------------------------------------------- flow

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--core", help="new core version, e.g. 6.11.0")
    parser.add_argument("--pin", action="append", default=[],
                        metavar="MODULE=TAG", help="new module pin (repeatable)")
    parser.add_argument("--directory", default=".", help="studio repo root")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-pr", action="store_true",
                        help="stop after the commit; do not push or open a PR")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args(argv)

    directory = Path(args.directory).resolve()
    pins: dict[str, str] = {}
    for spec in args.pin:
        if "=" not in spec:
            print(json.dumps({"ok": False, "step": "usage",
                              "error": f"--pin needs MODULE=TAG, got {spec!r}"}))
            return 2
        name, tag = spec.split("=", 1)
        pins[name.strip()] = tag.strip()
    if not args.core and not pins:
        print(json.dumps({"ok": False, "step": "usage",
                          "error": "nothing to bump: pass --core and/or --pin"}))
        return 2
    if not (directory / ".claude-plugin" / "marketplace.json").is_file():
        print(json.dumps({"ok": False, "step": "preflight",
                          "error": f"{directory} is not the studio repo root"}))
        return 2

    try:
        old_lock = LOCK_PATH.read_text(encoding="utf-8")
        new_lock = bump_lock_text(old_lock, args.core, pins)
        old_pins = bmadlock.lock_pins(bmadlock.parse_lock(LOCK_PATH))
    except (ValueError, bmadlock.LockParseError, OSError) as exc:
        print(json.dumps({"ok": False, "step": "bump", "error": str(exc)}))
        return 2

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    branch = f"base-update/{args.core or 'modules'}-{stamp}"
    bump_desc = "; ".join(
        ([f"core {old_pins['core']} -> {args.core}"] if args.core else [])
        + [f"{m} {old_pins.get(m, '?')} -> {t}" for m, t in pins.items()]
    )

    if args.dry_run:
        print(json.dumps({"ok": True, "dry_run": True, "branch": branch,
                          "bump": bump_desc, "lock_diff": new_lock != old_lock}))
        return 0

    # 1-2. preflight + branch
    try:
        if _git(directory, "status", "--porcelain").stdout.strip():
            print(json.dumps({"ok": False, "step": "preflight",
                              "error": "working tree not clean — commit or stash first"}))
            return 2
        start_branch = _git(directory, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        _git(directory, "checkout", "-b", branch)
    except RuntimeError as exc:
        print(json.dumps({"ok": False, "step": "preflight", "error": str(exc)}))
        return 2

    # 3. bump + commit (so a failed install diffs against the bumped lock)
    LOCK_PATH.write_text(new_lock, encoding="utf-8", newline="\n")
    _git(directory, "add", str(LOCK_PATH))
    _git(directory, "commit", "-q", "--allow-empty", "-m",
         f"chore(base-update): bump bmad.lock — {bump_desc}")

    # 4. install at the new pin (install_base verifies + emits install-outcome)
    proc = subprocess.run(
        [sys.executable, str(INSTALL_SCRIPT), "--directory", str(directory),
         "--timeout", str(args.timeout)],
        cwd=str(directory), stdin=subprocess.DEVNULL,
        capture_output=True, encoding="utf-8", errors="replace",
    )
    install_out = (proc.stdout or "").strip().splitlines()
    install_json = {}
    for line in reversed(install_out):
        try:
            install_json = json.loads(line)
            break
        except json.JSONDecodeError:
            continue

    if proc.returncode != 0:
        # branch isolation: restore tree, return to the starting branch,
        # leave the bump branch behind for inspection
        _git(directory, "reset", "--hard", "HEAD", check=False)
        _git(directory, "clean", "-fdq", "--", "_bmad", ".claude/skills", check=False)
        _git(directory, "checkout", start_branch, check=False)
        print(json.dumps({
            "ok": False, "step": "install-at-new-pin",
            "branch_left_for_inspection": branch,
            "restored_to": start_branch,
            "install_result": install_json or {"tail": install_out[-5:]},
        }, ensure_ascii=False))
        return 1

    # 5. sync shas from the fresh manifest, commit the full install diff
    manifest = directory / "_bmad" / "_config" / "manifest.yaml"
    synced = sync_shas_text(LOCK_PATH.read_text(encoding="utf-8"),
                            read_manifest_shas(manifest))
    LOCK_PATH.write_text(synced, encoding="utf-8", newline="\n")
    _git(directory, "add", "-A")
    _git(directory, "commit", "-q", "-m",
         f"chore(base-update): install diff at new pin — {bump_desc}", check=False)

    result = {"ok": True, "branch": branch, "bump": bump_desc,
              "installed": install_json.get("modules", {}),
              "core": install_json.get("core")}

    # 6. PR
    if args.no_pr:
        _git(directory, "checkout", start_branch, check=False)
        result["pr"] = "skipped (--no-pr); branch left with committed bump + install diff"
    else:
        push = _git(directory, "push", "-u", "origin", branch, check=False)
        if push.returncode != 0:
            result.update(ok=True, pr=f"push failed: {push.stderr.strip()[:200]}")
        else:
            body = (
                f"## Base update: {bump_desc}\n\n"
                f"Reviewable upstream diff at the new `bmad.lock` pin — the AD-1 "
                f"integration PR. Nothing merges automatically.\n\n"
                f"- Installer: completed and verified at pin "
                f"(`install-outcome` event emitted)\n"
                f"- Lock shas synced from the installed manifest\n\n"
                f"Review focus: upstream changes under `_bmad/` and `.claude/skills/`.\n\n"
                f"🤖 Generated with [Claude Code](https://claude.com/claude-code)\n"
            )
            pr = subprocess.run(
                ["gh", "pr", "create", "--title",
                 f"chore(base-update): {bump_desc}", "--body", body,
                 "--base", start_branch, "--head", branch],
                cwd=str(directory), stdin=subprocess.DEVNULL,
                capture_output=True, encoding="utf-8", errors="replace",
            )
            result["pr"] = (pr.stdout.strip() if pr.returncode == 0
                            else f"gh pr create failed: {pr.stderr.strip()[:200]}")
        _git(directory, "checkout", start_branch, check=False)

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
