"""tk-studio-base-update — adopt an upstream BMad release as one reviewable motion (FR5, AD-1).

Flow (all on an isolated feature branch; the starting branch is never touched):
  1. preflight    clean working tree required; record the starting branch
  2. branch       create base-update/<stamp>
  3. bump         edit bmad.lock pins (core and/or per-module), commit the bump
  4. install      run tk-studio-install's script at the new pin (it verifies
                  against the pins and emits the install-outcome event)
  4.5 normalize   revert provably churn-only files the installer rewrote
                  (EP-011 D2): every revert requires old ≡ new under a named
                  equivalence — line endings, config values (list values
                  re-serialized as JSON strings parse back equal), manifest
                  lastUpdated stamps, derivative files-manifest hash rows,
                  dropped *.bak copies of pre-install files. Real changes and
                  unknown churn stay untouched and show in the diff.
  5. sync         refresh lock shas from the freshly installed manifest, commit
                  lockfile + churn-normalized install diff. A same-version
                  re-affirmation whose diff is empty after normalization ends
                  complete reporting the verified no-op — no branch pushed,
                  no PR opened (EP-011 D3).
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
import csv
import io
import json
import re
import subprocess
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import bmadlock  # noqa: E402
import miniyaml  # noqa: E402

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


# ------------------------------------------- churn normalization (step 4.5)
#
# The upstream installer's --yes reinstall rewrites files it did not change
# (ISS-001): LF line endings everywhere, config values re-serialized (lists
# become quoted JSON strings), comment timestamps and key order shuffled,
# manifest lastUpdated stamps, and *.bak copies of the pre-install files.
# Step 4.5 reverts a file only when old ≡ new under one of the named,
# provable equivalences below (EP-011 D2 — full no-op signature, ruled
# 2026-08-08); a file carrying any real change stays fully untouched, and
# unknown churn is never guessed at — it shows in the integration diff.

CHURN_ROOTS = ("_bmad", ".claude/skills")
_CONFIG_YAML = re.compile(r"_bmad/(?:[\w.\-]+/)?config\.yaml$")
_CONFIG_TOML = ("_bmad/config.toml", "_bmad/config.user.toml")
_FILES_MANIFEST = "_bmad/_config/files-manifest.csv"
_MODULE_MANIFEST = "_bmad/_config/manifest.yaml"
_TS_LINE = re.compile(rb"(?m)^(\s*lastUpdated:).*$")


def _norm_eol(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def _git_show(directory: Path, path: str) -> bytes | None:
    """The pre-install bytes of *path* (HEAD blob), or None if not in HEAD."""
    proc = subprocess.run(
        ["git", "show", f"HEAD:{path}"], cwd=str(directory),
        stdin=subprocess.DEVNULL, capture_output=True,
    )
    return proc.stdout if proc.returncode == 0 else None


def _values_equal_with_list_coercion(old: object, new: object) -> bool:
    """Equal values, allowing new to be old's list re-serialized as a JSON
    string (the ISS-001 defect: [a, b] becomes '["a", "b"]'). Scalars must
    match type exactly — `true` never equals `1`, so a genuine type change
    in a config value always shows in the diff (D2)."""
    if isinstance(old, dict) and isinstance(new, dict):
        return old.keys() == new.keys() and all(
            _values_equal_with_list_coercion(old[k], new[k]) for k in old
        )
    if isinstance(old, list):
        if isinstance(new, str):
            try:
                parsed = json.loads(new)
            except ValueError:
                return False
            return isinstance(parsed, list) and _values_equal_with_list_coercion(old, parsed)
        if isinstance(new, list):
            return len(old) == len(new) and all(
                _values_equal_with_list_coercion(o, n) for o, n in zip(old, new)
            )
        return False
    if isinstance(old, bool) or isinstance(new, bool):
        return isinstance(old, bool) and isinstance(new, bool) and old == new
    return type(old) is type(new) and old == new


def churn_class(path: str, old: bytes, new: bytes) -> str | None:
    """Name the provable churn class making old ≡ new, or None (real change /
    unknown churn — the file stays). files-manifest.csv is classified
    separately (it is derivative of the other reverts)."""
    if _norm_eol(old) == _norm_eol(new):
        return "line-endings-only"
    if _CONFIG_YAML.search(path):
        try:
            o = miniyaml.loads(old.decode("utf-8"))
            n = miniyaml.loads(new.decode("utf-8"))
        except (miniyaml.MiniYamlError, UnicodeDecodeError):
            return None
        # value-level equality per the 2026-08-08 ruling: comments and key
        # order in these installer-GENERATED files are serialization
        # artifacts, ignored entirely. Known trade-off: on a real core bump
        # with unchanged values, the regenerated `# Version:` header comment
        # is also reverted, leaving the old provenance comment in the tree.
        return "config-values-unchanged" if _values_equal_with_list_coercion(o, n) else None
    if path in _CONFIG_TOML:
        try:
            o = tomllib.loads(old.decode("utf-8"))
            n = tomllib.loads(new.decode("utf-8"))
        except (tomllib.TOMLDecodeError, UnicodeDecodeError):
            return None
        return "config-values-unchanged" if _values_equal_with_list_coercion(o, n) else None
    if path == _MODULE_MANIFEST:
        if _TS_LINE.sub(rb"\1", _norm_eol(old)) == _TS_LINE.sub(rb"\1", _norm_eol(new)):
            return "manifest-timestamps-only"
        return None
    return None


def _files_manifest_derivative(old: bytes, new: bytes, reverted: set[str]) -> bool:
    """True when every changed row differs only in its hash column and names a
    path that was itself reverted — the csv change is then pure derivative."""
    old_lines = _norm_eol(old).decode("utf-8", "replace").splitlines()
    new_lines = _norm_eol(new).decode("utf-8", "replace").splitlines()
    if len(old_lines) != len(new_lines):
        return False  # rows added or removed — real change
    for o, n in zip(old_lines, new_lines):
        if o == n:
            continue
        try:
            ro = next(csv.reader(io.StringIO(o)))
            rn = next(csv.reader(io.StringIO(n)))
        except (csv.Error, StopIteration):
            return False
        # row shape: type,name,module,path,hash — only the hash may differ
        if len(ro) != 5 or len(rn) != 5 or ro[:4] != rn[:4]:
            return False
        if f"_bmad/{ro[3]}" not in reverted:
            return False
    return True


def normalize_churn(directory: Path) -> dict:
    """Step 4.5: revert churn-only files, delete installer backup drops.
    Returns {"reverted": N, "backups_dropped": M, "by_class": {...}} for the
    result JSON. Precondition: nothing is staged (step 3 committed the bump
    and nothing runs `git add` before this step), so porcelain -z entries are
    single-field ` M`/`??`/` D` records — rename/copy two-field records
    cannot occur. Anything with an unexpected code is left untouched."""
    status = _git(directory, "status", "--porcelain", "-z", "--", *CHURN_ROOTS).stdout
    modified, baks = [], []
    for entry in (e for e in status.split("\0") if len(e) > 3):
        code, path = entry[:2], entry[3:]
        if code == " M":
            modified.append(path)
        elif code == "??" and path.endswith(".bak"):
            baks.append(path)

    by_class: dict[str, int] = {}
    reverted: list[str] = []
    for path in modified:
        if path == _FILES_MANIFEST:
            continue  # classified last — derivative of the other reverts
        old = _git_show(directory, path)
        if old is None:
            continue
        cls = churn_class(path, old, (directory / path).read_bytes())
        if cls:
            reverted.append(path)
            by_class[cls] = by_class.get(cls, 0) + 1
    if _FILES_MANIFEST in modified:
        old = _git_show(directory, _FILES_MANIFEST)
        if old is not None and _files_manifest_derivative(
            old, (directory / _FILES_MANIFEST).read_bytes(), set(reverted)
        ):
            reverted.append(_FILES_MANIFEST)
            by_class["files-manifest-derivative"] = 1

    # unlink before checkout so git always rewrites the working-tree file —
    # under core.autocrlf a bare checkout can no-op and leave the file
    # status-dirty (endings-only files are exactly that case)
    for path in reverted:
        (directory / path).unlink(missing_ok=True)
    for i in range(0, len(reverted), 50):
        _git(directory, "checkout", "--", *reverted[i:i + 50])

    dropped = 0
    for path in baks:
        head = _git_show(directory, path[:-len(".bak")])
        try:
            if head is not None and _norm_eol(head) == _norm_eol((directory / path).read_bytes()):
                (directory / path).unlink()
                dropped += 1
        except OSError:
            pass  # unreadable/locked backup stays; it shows as untracked
    if dropped:
        by_class["installer-backup-dropped"] = dropped

    return {"reverted": len(reverted), "backups_dropped": dropped,
            "by_class": by_class}


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

    # 4.5 revert provable no-op churn before the diff commits (EP-011 D2).
    # Same failure posture as step 4: a crash mid-revert (a locked file, an
    # unreadable path) must not leave a mutilated tree or a dead process
    # with no JSON — restore, return to the starting branch, report.
    try:
        normalized = normalize_churn(directory)
    except (RuntimeError, OSError) as exc:
        _git(directory, "reset", "--hard", "HEAD", check=False)
        _git(directory, "clean", "-fdq", "--", *CHURN_ROOTS, check=False)
        _git(directory, "checkout", start_branch, check=False)
        print(json.dumps({
            "ok": False, "step": "normalize-churn",
            "branch_left_for_inspection": branch,
            "restored_to": start_branch, "error": str(exc)[:300],
        }, ensure_ascii=False))
        return 1

    # 5. sync shas from the fresh manifest, commit the churn-normalized diff
    manifest = directory / "_bmad" / "_config" / "manifest.yaml"
    synced = sync_shas_text(LOCK_PATH.read_text(encoding="utf-8"),
                            read_manifest_shas(manifest))
    LOCK_PATH.write_text(synced, encoding="utf-8", newline="\n")
    _git(directory, "add", "-A")

    # D3: a same-version re-affirmation whose install diff is empty after
    # normalization ends complete reporting the verified no-op — no branch
    # pushed, no PR opened; the bump branch (one empty commit) is dropped.
    # Both legs are required: an empty status only proves the tree matches
    # the BUMP commit — the lock must also be byte-identical to its
    # pre-bump text, or the run carried a real pin change (e.g. repairing
    # committed drift) and must land its PR like any other.
    if synced == old_lock and not _git(directory, "status", "--porcelain").stdout.strip():
        back = _git(directory, "checkout", start_branch, check=False)
        result = {
            "ok": True, "outcome": "verified-no-op", "bump": bump_desc,
            "normalized": normalized,
            "installed": install_json.get("modules", {}),
            "core": install_json.get("core"), "branch": None,
            "pr": "none (verified no-op — empty install diff after churn "
                  "normalization; no branch pushed)",
        }
        if back.returncode == 0:
            _git(directory, "branch", "-D", branch, check=False)
        else:
            result["branch"] = branch
            result["warning"] = (f"checkout back to {start_branch} failed; "
                                 f"branch {branch} left checked out")
        print(json.dumps(result, ensure_ascii=False))
        return 0

    _git(directory, "commit", "-q", "-m",
         f"chore(base-update): install diff at new pin — {bump_desc}", check=False)

    result = {"ok": True, "branch": branch, "bump": bump_desc,
              "normalized": normalized,
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
