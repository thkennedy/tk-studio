"""Churn normalization after an upstream BMad reinstall (EP-011 D2, ISS-001).

The upstream installer's --yes reinstall rewrites files it did not change:
line endings, config values re-serialized (lists become quoted JSON strings),
comment timestamps and key order shuffled, manifest lastUpdated stamps, and
*.bak copies of files it judged modified. A file is reverted only when
old ≡ new under one of the named, provable equivalences below (the
2026-08-08 full no-op signature ruling); a file carrying any real change
stays fully untouched, and unknown churn is never guessed at — it shows in
the diff.

Shared by tk-studio-install (a same-pin install over a matching committed
tree ends with an empty diff) and tk-studio-base-update (step 4.5, before
the integration diff commits). Reverting to the committed blob is not a
hand edit of _bmad/ (NFR1): every revert restores bytes upstream itself
wrote, proven equivalent to what it just wrote again. Stdlib-only (NFR9).
"""
from __future__ import annotations

import csv
import io
import json
import re
import subprocess
import tomllib
from pathlib import Path

import miniyaml

CHURN_ROOTS = ("_bmad", ".claude/skills")
_CONFIG_YAML = re.compile(r"_bmad/(?:[\w.\-]+/)?config\.yaml$")
_CONFIG_TOML = ("_bmad/config.toml", "_bmad/config.user.toml")
_FILES_MANIFEST = "_bmad/_config/files-manifest.csv"
_MODULE_MANIFEST = "_bmad/_config/manifest.yaml"
_TS_LINE = re.compile(rb"(?m)^(\s*lastUpdated:).*$")


def _git(directory: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=str(directory), stdin=subprocess.DEVNULL,
        capture_output=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {proc.stderr.strip()[:300]}")
    return proc.stdout


def _norm_eol(data: bytes) -> bytes:
    return data.replace(b"\r\n", b"\n")


def _git_show(directory: Path, path: str) -> bytes | None:
    """The committed bytes of *path* (HEAD blob), or None if not in HEAD."""
    proc = subprocess.run(
        ["git", "show", f"HEAD:{path}"], cwd=str(directory),
        stdin=subprocess.DEVNULL, capture_output=True,
    )
    return proc.stdout if proc.returncode == 0 else None


def unavailable_reason(directory: Path) -> str | None:
    """Why *directory* cannot be normalized, or None when it can. Status
    paths are repo-root-relative and the churn classes name `_bmad/...`
    paths, so the project root must be the git top-level itself."""
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], cwd=str(directory),
            stdin=subprocess.DEVNULL, capture_output=True,
            encoding="utf-8", errors="replace",
        )
    except OSError:
        return "git unavailable"
    if proc.returncode != 0:
        return "not a git work tree"
    if Path(proc.stdout.strip()).resolve() != Path(directory).resolve():
        return "project root is not the git top-level"
    return None


def _status_entries(directory: Path) -> list[tuple[str, str]]:
    """(code, path) for every porcelain -z entry under the churn roots."""
    status = _git(directory, "status", "--porcelain", "-z", "--", *CHURN_ROOTS)
    return [(e[:2], e[3:]) for e in status.split("\0") if len(e) > 3]


def dirty_paths(directory: Path) -> frozenset[str]:
    """Every path under the churn roots that differs from HEAD right now —
    snapshot before an install so normalization never touches what the
    install did not dirty."""
    return frozenset(path for _, path in _status_entries(directory))


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


def normalize_churn(directory: Path, preserve: frozenset[str] = frozenset()) -> dict:
    """Revert churn-only files and delete installer backup drops under the
    churn roots. Paths in *preserve* (dirty before the install ran) are never
    touched. Returns {"reverted", "backups_dropped", "by_class", "remaining"}
    — remaining counts the entries still differing from HEAD afterwards,
    preserved ones excluded. Only single-field ` M`/`??` records are acted on;
    staged entries, renames, and any other code are left untouched."""
    modified, baks = [], []
    for code, path in _status_entries(directory):
        if path in preserve:
            continue
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
    # status-dirty (endings-only files are exactly that case). Batch by
    # batch, so a failing checkout strands at most one batch as deleted.
    for i in range(0, len(reverted), 50):
        batch = reverted[i:i + 50]
        for path in batch:
            (directory / path).unlink(missing_ok=True)
        _git(directory, "checkout", "--", *batch)

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

    remaining = sum(1 for _, p in _status_entries(directory) if p not in preserve)
    return {"reverted": len(reverted), "backups_dropped": dropped,
            "by_class": by_class, "remaining": remaining}
