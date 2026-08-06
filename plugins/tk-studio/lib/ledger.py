"""tk-studio measurement ledger — the one write path for measurement events (AD-12).

Every studio surface emits through this library (import or CLI); nothing else
writes the ledger. One JSON object per line, appended to the per-user-per-machine
file ~/.tk-studio/measurements/<user>-<machine>.jsonl:

    {"ts": ..., "event": ..., "user": ..., "machine": ..., "project"?: ..., "payload": {...}}

Guarantees, in order of application:
  1. Validation — event type and payload shape checked against the shipped
     taxonomy (contracts/events/taxonomy.v1.json). Invalid events never land.
  2. Sanitization at emission — credential-shaped strings and values under
     credential-shaped keys are redacted; non-allowlisted absolute paths are
     masked (NFR5). The line is sanitized before it touches disk.
  3. Atomic append — exclusive OS file lock around a single flushed+fsync'd
     write, so concurrent emitters never interleave or lose lines.

CLI:
  uv run ledger.py emit --event TYPE --payload '{"..."}' [--project KEY] [--dry-run]
  uv run ledger.py validate --event TYPE --payload '{"..."}'

Exit codes: 0 ok; 2 validation error; 1 unexpected failure.
Env: TK_STUDIO_HOME overrides the store root (default ~/.tk-studio) — used by
tests and never by production callers. TK_STUDIO_PATH_ALLOWLIST adds
os.pathsep-separated absolute-path prefixes that are home-relativized instead
of masked.

Stdlib-only (NFR9).
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import classify as _classify
import store as _store

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
TAXONOMY_PATH = PLUGIN_ROOT / "contracts" / "events" / "taxonomy.v1.json"

_TYPE_MAP = {
    "string": str,
    "number": (int, float),
    "boolean": bool,
    "object": dict,
    "array": list,
}

# Patterns live in classify.py (shared with the AD-3 tracked-write guard);
# these aliases are the stable public names for tests and callers.
REDACTED = _classify.REDACTED
MASKED_PATH = _classify.MASKED_PATH
_CREDENTIAL_KEY_RE = _classify.CREDENTIAL_KEY_RE
_CREDENTIAL_VALUE_RES = _classify.CREDENTIAL_VALUE_RES
_ABS_PATH_RE = _classify.ABS_PATH_RE


class LedgerError(Exception):
    """Validation or emission failure; message is safe to surface."""


# ---------------------------------------------------------------- taxonomy

def load_taxonomy(path: Path = TAXONOMY_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate(event: str, payload: dict, taxonomy: dict | None = None) -> None:
    """Raise LedgerError unless payload matches the taxonomy shape for event."""
    tax = taxonomy or load_taxonomy()
    events = tax["events"]
    if event not in events:
        raise LedgerError(
            f"unknown event type '{event}' (taxonomy v{tax['taxonomy_version']}: "
            f"{', '.join(sorted(events))})"
        )
    if not isinstance(payload, dict):
        raise LedgerError("payload must be a JSON object")
    spec = events[event]["payload"]
    for field, rules in spec.items():
        if rules.get("required") and field not in payload:
            raise LedgerError(f"'{event}' payload missing required field '{field}'")
        if field in payload:
            expected = _TYPE_MAP.get(rules.get("type", "string"), str)
            value = payload[field]
            if isinstance(value, bool) and rules.get("type") != "boolean":
                raise LedgerError(f"'{field}' must be {rules.get('type')}, got boolean")
            if not isinstance(value, expected):
                raise LedgerError(
                    f"'{field}' must be {rules.get('type')}, got {type(value).__name__}"
                )
            if "enum" in rules and value not in rules["enum"]:
                raise LedgerError(
                    f"'{field}' must be one of {rules['enum']}, got '{value}'"
                )
    unknown = set(payload) - set(spec)
    if unknown:
        raise LedgerError(
            f"'{event}' payload has fields outside its schema: {', '.join(sorted(unknown))}"
        )


# ------------------------------------------------------------ sanitization

def _path_allowlist() -> list[str]:
    roots = [str(store_root())]
    extra = os.environ.get("TK_STUDIO_PATH_ALLOWLIST", "")
    roots.extend(p for p in extra.split(os.pathsep) if p)
    return roots


def _sanitize_string(value: str) -> str:
    for pattern in _CREDENTIAL_VALUE_RES:
        value = pattern.sub(REDACTED, value)

    home = str(Path.home())
    allowlist = _path_allowlist()

    def _mask_path(match: re.Match) -> str:
        path = match.group(0)
        for root in allowlist:
            if path.replace("/", "\\").lower().startswith(root.replace("/", "\\").lower()) or \
               path.replace("\\", "/").lower().startswith(root.replace("\\", "/").lower()):
                if path.lower().startswith(home.lower()):
                    return "~" + path[len(home):].replace("\\", "/")
                return path
        return MASKED_PATH

    return _ABS_PATH_RE.sub(_mask_path, value)


def sanitize(value):
    """Recursively sanitize a payload value. Returns a new structure."""
    if isinstance(value, str):
        return _sanitize_string(value)
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if _CREDENTIAL_KEY_RE.search(key):
                out[key] = REDACTED
            else:
                out[key] = sanitize(item)
        return out
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


# ---------------------------------------------------------------- emission

def store_root() -> Path:
    return _store.store_root()  # single authority for the store root (ST-2.1)


def _safe_name(name: str) -> str:
    return _store.safe_name(name)


def ledger_path() -> Path:
    user = _safe_name(getpass.getuser())
    machine = _safe_name(platform.node())
    return store_root() / "measurements" / f"{user}-{machine}.jsonl"


def _locked_append(path: Path, line: str) -> None:
    """Append one line under an exclusive OS lock, flushed and fsync'd."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                handle.seek(0, os.SEEK_END)
                handle.write(line)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                handle.write(line)
                handle.flush()
                os.fsync(handle.fileno())
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def emit(event: str, payload: dict, project: str | None = None,
         dry_run: bool = False) -> dict:
    """Validate, sanitize, and append one event. Returns the envelope written."""
    validate(event, payload)
    envelope = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "event": event,
        "user": _safe_name(getpass.getuser()),
        "machine": _safe_name(platform.node()),
    }
    if project:
        envelope["project"] = _sanitize_string(project)
    envelope["payload"] = sanitize(payload)
    if not dry_run:
        _store.ensure_store()  # first surface to need the store stands it up (ST-2.1)
        line = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")) + "\n"
        _locked_append(ledger_path(), line)
    return envelope


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio measurement ledger")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("emit", "validate"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--event", required=True)
        cmd.add_argument("--payload", required=True, help="JSON object")
        if name == "emit":
            cmd.add_argument("--project")
            cmd.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"payload is not valid JSON: {exc}"}))
        return 2

    try:
        if args.command == "validate":
            validate(args.event, payload)
            print(json.dumps({"ok": True, "event": args.event}))
        else:
            envelope = emit(args.event, payload, project=args.project,
                            dry_run=args.dry_run)
            print(json.dumps({
                "ok": True,
                "ledger": str(ledger_path()),
                "dry_run": bool(args.dry_run),
                "envelope": envelope,
            }, ensure_ascii=False))
    except LedgerError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
