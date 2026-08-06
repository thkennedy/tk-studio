"""tk-studio project registry — one schema, one writer (ST-2.3, AD-20).

`~/.tk-studio/registry/projects.yaml` is the canonical cross-project read
path: a map keyed by `project_id` (never a list), validated against
contracts/registry.schema.json. Single-writer discipline: only onboarding and
activation register or amend entries — and only through this module's
register()/amend(), which take the writing surface by name and refuse any
other. Every other surface uses the read API and never writes.

Writes are whole-file atomic (temp + os.replace) under an exclusive OS lock
on a sidecar lock file, so a concurrent register and amend cannot lose each
other's entries. A project whose key (explicit project_id or root basename)
matches an existing entry with a *different root* fails loudly demanding an
explicit project_id — never a silent second identity.

CLI:
  uv run registry.py register --directory DIR --writer onboard|activate [--project-id ID]
  uv run registry.py amend --project-id ID --writer onboard|activate [--vault-link STATE [--detail TEXT]]
  uv run registry.py show [--project-id ID]
  uv run registry.py validate

Exit codes: 0 ok; 2 refusal/validation error; 1 unexpected failure.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import config as configlib
import miniyaml
import store

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contracts" / "registry.schema.json"

REGISTRY_VERSION = 1
WRITERS = ("onboard", "activate")
VCS_VALUES = ("git", "perforce")
BACKEND_VALUES = ("bmad-files", "backlog-md", "jira")
VAULT_LINK_STATES = ("unconfigured", "linked", "broken", "unlinked")

ENTRY_REQUIRED = ("root", "vcs", "planning_backend", "working_set_ref",
                  "vault_link", "registered_at", "updated_at")
WORKING_SET_REF = ".tk-studio/config.yaml#working_set"


class RegistryError(Exception):
    """Refusal or invalid registry state; message is safe to surface."""


def registry_path() -> Path:
    return store.store_root() / "registry" / "projects.yaml"


# ------------------------------------------------------------------ read API

def load_registry() -> dict:
    """The registry mapping; an empty valid registry when the file is absent."""
    path = registry_path()
    if not path.is_file():
        return {"registry_version": REGISTRY_VERSION, "projects": {}}
    try:
        data = miniyaml.load(path)
    except miniyaml.MiniYamlError as exc:
        raise RegistryError(f"registry unreadable: {path}: {exc}") from exc
    validate_registry(data)
    return data


def list_projects() -> dict:
    """project_id -> entry map (the canonical cross-project read, AD-8)."""
    return load_registry()["projects"]


def read_project(project_id: str) -> dict:
    projects = list_projects()
    if project_id not in projects:
        raise RegistryError(f"project '{project_id}' is not registered "
                            f"(known: {', '.join(sorted(projects)) or 'none'})")
    return projects[project_id]


def validate_registry(data: dict) -> None:
    if not isinstance(data, dict):
        raise RegistryError("registry must be a mapping")
    if data.get("registry_version") != REGISTRY_VERSION:
        raise RegistryError(
            f"registry_version must be {REGISTRY_VERSION}, got "
            f"{data.get('registry_version')!r}")
    projects = data.get("projects")
    if not isinstance(projects, dict):
        raise RegistryError("'projects' must be a map keyed by project_id — never a list")
    for key, entry in projects.items():
        if not isinstance(entry, dict):
            raise RegistryError(f"entry '{key}' must be a mapping")
        missing = [f for f in ENTRY_REQUIRED if not entry.get(f)]
        if missing:
            raise RegistryError(f"entry '{key}' missing: {', '.join(missing)}")
        if entry["vcs"] not in VCS_VALUES:
            raise RegistryError(f"entry '{key}': vcs must be one of {VCS_VALUES}")
        if entry["planning_backend"] not in BACKEND_VALUES:
            raise RegistryError(
                f"entry '{key}': planning_backend must be one of {BACKEND_VALUES}")
        if entry["vault_link"] not in VAULT_LINK_STATES:
            raise RegistryError(
                f"entry '{key}': vault_link must be one of {VAULT_LINK_STATES}")


# ----------------------------------------------------------------- write API

@contextmanager
def _write_lock():
    """Exclusive OS lock on a sidecar file; released on close or process death."""
    path = registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(".lock")
    with open(lock_path, "a+b") as handle:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _atomic_replace(data: dict) -> None:
    validate_registry(data)
    path = registry_path()
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix="projects", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(miniyaml.dumps(data))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _check_writer(writer: str) -> None:
    if writer not in WRITERS:
        raise RegistryError(
            f"registry is single-writer (AD-20): only {' / '.join(WRITERS)} may "
            f"write, not '{writer}' — read via load_registry()/read_project()")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def register(project_root: Path, writer: str, project_id: str | None = None) -> dict:
    """Register (or re-affirm) a project. Returns {project_id, entry, action}."""
    _check_writer(writer)
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise RegistryError(f"project root {root} is not a directory")
    key = project_id or root.name

    def _resolved(dotted: str, fallback: str) -> str:
        try:
            return str(configlib.resolve(dotted, project_root=root)[0])
        except configlib.ConfigError:
            return fallback

    with _write_lock():
        data = load_registry()
        existing = data["projects"].get(key)
        same = existing is not None and Path(existing["root"]) == root
        if existing is not None and not same:
            raise RegistryError(
                f"project_id '{key}' is already registered for {existing['root']} — "
                f"one project, one identity (AD-20): re-run with an explicit "
                f"--project-id for {root}")
        entry = {
            "root": str(root),
            "vcs": _resolved("vcs", "git"),
            "planning_backend": _resolved("planning.backend", "bmad-files"),
            "working_set_ref": WORKING_SET_REF,
            "vault_link": existing["vault_link"] if same else "unconfigured",
            "registered_at": existing["registered_at"] if same else _now(),
            "updated_at": _now(),
        }
        if same and existing.get("vault_link_detail"):
            entry["vault_link_detail"] = existing["vault_link_detail"]
        if same and {k: v for k, v in existing.items() if k != "updated_at"} == \
                    {k: v for k, v in entry.items() if k != "updated_at"}:
            return {"project_id": key, "entry": existing, "action": "unchanged"}
        data["projects"][key] = entry
        _atomic_replace(data)
        return {"project_id": key, "entry": entry,
                "action": "amended" if same else "registered"}


def amend(project_id: str, writer: str, vault_link: str | None = None,
          vault_link_detail: str | None = None) -> dict:
    """Amend an existing entry's mutable state (vault-link, currently)."""
    _check_writer(writer)
    with _write_lock():
        data = load_registry()
        if project_id not in data["projects"]:
            raise RegistryError(f"project '{project_id}' is not registered")
        entry = dict(data["projects"][project_id])
        if vault_link is not None:
            if vault_link not in VAULT_LINK_STATES:
                raise RegistryError(
                    f"vault_link must be one of {VAULT_LINK_STATES}, got '{vault_link}'")
            entry["vault_link"] = vault_link
        if vault_link_detail is not None:
            if vault_link_detail:
                entry["vault_link_detail"] = vault_link_detail
            else:
                entry.pop("vault_link_detail", None)
        entry["updated_at"] = _now()
        data["projects"][project_id] = entry
        _atomic_replace(data)
        return {"project_id": project_id, "entry": entry, "action": "amended"}


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio project registry")
    sub = parser.add_subparsers(dest="command", required=True)

    reg = sub.add_parser("register")
    reg.add_argument("--directory", required=True, help="project root")
    reg.add_argument("--writer", required=True,
                     help="writing surface — onboard or activate only (AD-20)")
    reg.add_argument("--project-id", help="explicit stable identity (basename default)")

    amd = sub.add_parser("amend")
    amd.add_argument("--project-id", required=True)
    amd.add_argument("--writer", required=True)
    amd.add_argument("--vault-link", choices=list(VAULT_LINK_STATES))
    amd.add_argument("--detail", help="vault-link detail ('' clears it)")

    show = sub.add_parser("show")
    show.add_argument("--project-id")

    sub.add_parser("validate")

    args = parser.parse_args(argv)
    try:
        if args.command == "register":
            result = register(Path(args.directory), writer=args.writer,
                              project_id=args.project_id)
            print(json.dumps({"ok": True, "registry": str(registry_path()),
                              **result}, ensure_ascii=False, indent=2))
        elif args.command == "amend":
            result = amend(args.project_id, writer=args.writer,
                           vault_link=args.vault_link,
                           vault_link_detail=args.detail)
            print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
        elif args.command == "show":
            if args.project_id:
                print(json.dumps({"ok": True, "project_id": args.project_id,
                                  "entry": read_project(args.project_id)},
                                 ensure_ascii=False, indent=2))
            else:
                print(json.dumps({"ok": True, "registry": str(registry_path()),
                                  "projects": list_projects()},
                                 ensure_ascii=False, indent=2))
        else:
            validate_registry(load_registry())
            print(json.dumps({"ok": True, "registry": str(registry_path()),
                              "valid": True}))
        return 0
    except RegistryError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
