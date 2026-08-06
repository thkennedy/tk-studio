"""tk-studio per-user store — root authority and idempotent standup (ST-2.1, AD-3).

The store is working data, never on any VCS:

    ~/.tk-studio/                (%USERPROFILE%\\.tk-studio\\ on Windows)
      config.yaml                user_name, role, machine_id, obsidian_vault?
      registry/                  projects.yaml — canonical cross-project read path (ST-2.3)
      projects/<key>/            per-project working state: runs/, scratch/
      measurements/<user>-<machine>.jsonl

This module is the one authority for the store root and skeleton. Any studio
surface that first needs the store calls ensure_store(); the ledger library
routes every emit through it, so the skeleton exists from the first event.

Standup is idempotent and preservation-first: existing files are never
overwritten or rewritten. A pre-existing config.yaml keeps its content and
comments byte-for-byte; only *missing required keys* are appended (with their
schema comments) under the same locked-append discipline the ledger uses.

CLI:
  uv run store.py standup    # create/complete the skeleton (mutating, idempotent)
  uv run store.py check      # read-only skeleton + config-key health

Exit codes: standup 0 ok / 1 failure; check 0 complete / 1 incomplete.
Env: TK_STUDIO_HOME overrides the store root (tests only).
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
import re
import sys
import tempfile
from pathlib import Path

import miniyaml

STORE_DIRS = ("registry", "projects", "measurements")

ROLES = ("direction-giver", "developer")
DEFAULT_ROLE = "developer"

# Required config keys with the comment block written above each on standup.
_CONFIG_KEY_LINES = {
    "user_name": [
        "# Who you are to the studio (ledger envelopes, registry entries).",
        "user_name: {user_name}",
    ],
    "role": [
        "# Your role — resolved before routing (AD-17). v1: direction-giver | developer.",
        "role: {role}",
    ],
    "machine_id": [
        "# This machine's identity in the per-user-per-machine measurement key.",
        "machine_id: {machine_id}",
    ],
}
REQUIRED_CONFIG_KEYS = tuple(_CONFIG_KEY_LINES)

_CONFIG_HEADER = [
    "# tk-studio per-user store configuration — working data, never on any VCS (AD-3).",
    "# Resolution order: runtime > project local > project tracked > user (this file) > studio default.",
]

_CONFIG_OPTIONAL_LINES = [
    "# Optional: absolute path to your Obsidian vault root — enables the vault window (ST-2.5).",
    "# obsidian_vault: C:/path/to/vault",
]


def safe_name(name: str) -> str:
    """Filesystem/measurement-key-safe identity token."""
    return re.sub(r"[^A-Za-z0-9._\-]", "_", name) or "unknown"


def store_root() -> Path:
    override = os.environ.get("TK_STUDIO_HOME")
    return Path(override) if override else Path.home() / ".tk-studio"


def config_path() -> Path:
    return store_root() / "config.yaml"


def read_config() -> dict:
    """Parsed user config; {} when the file does not exist."""
    path = config_path()
    if not path.is_file():
        return {}
    return miniyaml.load(path)


def default_config_values() -> dict:
    return {
        "user_name": safe_name(getpass.getuser()),
        "role": DEFAULT_ROLE,
        "machine_id": safe_name(platform.node()),
    }


def _render_key_lines(key: str, values: dict) -> list[str]:
    return [line.format(**values) for line in _CONFIG_KEY_LINES[key]]


def _render_full_config(values: dict) -> str:
    lines = list(_CONFIG_HEADER) + [""]
    for key in REQUIRED_CONFIG_KEYS:
        lines.extend(_render_key_lines(key, values))
    lines.extend(_CONFIG_OPTIONAL_LINES)
    return "\n".join(lines) + "\n"


def _atomic_write_new(path: Path, content: str) -> bool:
    """Write content to path only if absent; atomic; True if this call created it."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if path.exists():
            return False
        os.replace(tmp, path)  # a concurrent racer's full template is equivalent
        return True
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _locked_append(path: Path, text: str) -> None:
    """Append under an exclusive OS lock (same discipline as ledger appends)."""
    with open(path, "a", encoding="utf-8", newline="\n") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                handle.seek(0, os.SEEK_END)
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                handle.write(text)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def check_store() -> dict:
    """Read-only skeleton + config health. Never mutates (AD-13 store plane)."""
    root = store_root()
    result = {
        "root": str(root),
        "exists": root.is_dir(),
        "missing_dirs": [],
        "config_present": False,
        "missing_config_keys": list(REQUIRED_CONFIG_KEYS),
        "config_error": None,
    }
    if not result["exists"]:
        result["missing_dirs"] = list(STORE_DIRS)
        result["complete"] = False
        return result
    result["missing_dirs"] = [d for d in STORE_DIRS if not (root / d).is_dir()]
    result["config_present"] = config_path().is_file()
    if result["config_present"]:
        try:
            config = read_config()
            result["missing_config_keys"] = [
                k for k in REQUIRED_CONFIG_KEYS if config.get(k) in (None, "")
            ]
        except miniyaml.MiniYamlError as exc:
            result["config_error"] = str(exc)
    result["complete"] = (
        not result["missing_dirs"]
        and result["config_present"]
        and not result["missing_config_keys"]
        and result["config_error"] is None
    )
    return result


def ensure_store() -> dict:
    """Idempotent standup: create what's missing, never touch what exists.

    Returns {root, created[], appended_keys[], complete} — empty created/
    appended on a healthy store (the no-op path is cheap: four stats and,
    when config.yaml exists, one small parse).
    """
    root = store_root()
    created: list[str] = []
    appended: list[str] = []

    if not root.is_dir():
        root.mkdir(parents=True, exist_ok=True)
        created.append(str(root))
    for name in STORE_DIRS:
        sub = root / name
        if not sub.is_dir():
            sub.mkdir(parents=True, exist_ok=True)
            created.append(name)

    values = default_config_values()
    path = config_path()
    if not path.exists():
        if _atomic_write_new(path, _render_full_config(values)):
            created.append("config.yaml")
    else:
        try:
            config = miniyaml.load(path)
        except miniyaml.MiniYamlError:
            config = None  # unreadable → report via check_store, never rewrite
        if config is not None:
            missing = [k for k in REQUIRED_CONFIG_KEYS if config.get(k) in (None, "")]
            if missing:
                existing = path.read_text(encoding="utf-8")
                block = "" if existing.endswith("\n") or not existing else "\n"
                for key in missing:
                    block += "\n".join(_render_key_lines(key, values)) + "\n"
                _locked_append(path, block)
                appended = missing

    return {
        "root": str(root),
        "created": created,
        "appended_keys": appended,
        "complete": check_store()["complete"],
    }


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio per-user store")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("standup", help="create/complete the store skeleton (idempotent)")
    sub.add_parser("check", help="read-only skeleton + config health")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            result = check_store()
            print(json.dumps({"ok": True, "mutated": False, **result},
                             ensure_ascii=False, indent=2))
            return 0 if result["complete"] else 1
        result = ensure_store()
        print(json.dumps({"ok": True, "mutated": bool(result["created"] or result["appended_keys"]),
                          **result}, ensure_ascii=False, indent=2))
        return 0 if result["complete"] else 1
    except OSError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
