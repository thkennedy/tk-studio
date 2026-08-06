"""tk-studio Obsidian vault window — per-project links, view-only (ST-2.5).

`<vault>/projects/<project_id>/` holds per-category links into the project:

    kb       -> {project-root}/kb/
    backlog  -> the bound planning folder (backlog-md: backlog/; else _bmad-output/)

The vault is a view, never a dependency: with no `obsidian_vault` in the user
config every verb skips cleanly and everything else proceeds. Windows links
are directory junctions (no admin rights, NFR4); macOS/Linux use symlinks.

Verbs:
  link   — the explicit onboarding/fix motion (mutating): creates the project
           folder and links; replaces a link that is dangling or points at the
           wrong target; REFUSES to touch a path that is a real directory or
           file (never deletes content). Records the resulting state in the
           registry entry (writer: onboard).
  check  — read-only verification for activation: reports per-link state and
           the guided fix; with --record, the observed state is recorded in
           the registry entry (writer: activate) — state bookkeeping in the
           per-user store, never a machine mutation (AD-13 posture).

States (registry vault_link enum): unconfigured | unlinked | linked | broken.

CLI:
  uv run vault.py link --project-id ID [--writer onboard]
  uv run vault.py check --project-id ID [--record]

Exit codes: 0 ok (incl. clean skip); 1 broken/unlinked reported by check; 2 refusal.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import registry
import store

LINK_NAMES = ("kb", "backlog")

FIX_LINK = ("run: uv run <plugin>/lib/vault.py link --project-id {project_id} "
            "(explicit fix — links are never recreated silently)")
FIX_VAULT_CONFIG = ("set obsidian_vault in ~/.tk-studio/config.yaml to enable "
                    "the vault window (optional — the vault is a view)")


class VaultError(Exception):
    """Refusal; message is safe to surface."""


def vault_root() -> Path | None:
    value = store.read_config().get("obsidian_vault")
    return Path(str(value)) if value else None


def planning_folder(project_root: Path, backend: str) -> Path:
    if backend == "backlog-md":
        return Path(project_root) / "backlog"
    # bmad-files and jira: the canonical local planning representation (AD-4).
    return Path(project_root) / "_bmad-output"


def project_targets(entry: dict) -> dict[str, Path]:
    root = Path(entry["root"])
    return {
        "kb": root / "kb",
        "backlog": planning_folder(root, entry["planning_backend"]),
    }


def _is_link(path: Path) -> bool:
    return path.is_symlink() or (os.name == "nt" and path.is_junction())


def _make_link(target: Path, link: Path) -> None:
    if os.name == "nt":
        try:
            import _winapi

            _winapi.CreateJunction(str(target), str(link))  # no admin needed
            return
        except (ImportError, OSError) as exc:
            raise VaultError(f"junction {link} -> {target} failed: {exc}") from exc
    os.symlink(target, link, target_is_directory=True)


def _remove_link(link: Path) -> None:
    """Remove a link/junction only — never a real directory."""
    if not _is_link(link):
        raise VaultError(f"{link} is not a link — refusing to remove real content")
    if link.is_symlink():
        link.unlink()
    else:
        os.rmdir(link)  # junction: removes the link only, never the target


def _link_status(link: Path, target: Path) -> str:
    """missing | linked | wrong-target | dangling | not-a-link"""
    if not link.exists() and not _is_link(link):
        return "missing"
    if not _is_link(link):
        return "not-a-link"
    try:
        if not link.exists():
            return "dangling"
        if link.resolve() == target.resolve():
            return "linked"
    except OSError:
        return "dangling"
    return "wrong-target"


# ------------------------------------------------------------------- verbs

def check_links(project_id: str, record: bool = False) -> dict:
    """Read-only per-link verification; optionally record state in registry."""
    entry = registry.read_project(project_id)
    root = vault_root()
    result: dict = {"project_id": project_id, "vault": str(root) if root else None,
                    "links": [], "mutated_machine": False}
    if root is None:
        result.update(state="unconfigured", detail="no obsidian_vault in user config",
                      fix=FIX_VAULT_CONFIG)
    elif not root.is_dir():
        result.update(state="broken",
                      detail=f"configured vault {root} does not exist",
                      fix=FIX_VAULT_CONFIG)
    else:
        folder = root / "projects" / project_id
        statuses = {}
        for name, target in project_targets(entry).items():
            status = _link_status(folder / name, target)
            statuses[name] = status
            result["links"].append({"name": name, "link": str(folder / name),
                                    "target": str(target), "status": status})
        if all(s == "linked" for s in statuses.values()):
            result["state"] = "linked"
        elif all(s == "missing" for s in statuses.values()):
            result.update(state="unlinked",
                          detail=f"no links under {folder}",
                          fix=FIX_LINK.format(project_id=project_id))
        else:
            bad = {n: s for n, s in statuses.items() if s != "linked"}
            result.update(state="broken",
                          detail="; ".join(f"{n}: {s}" for n, s in bad.items()),
                          fix=FIX_LINK.format(project_id=project_id))
    if record and entry["vault_link"] != result["state"]:
        registry.amend(project_id, writer="activate", vault_link=result["state"],
                       vault_link_detail=result.get("detail", ""))
        result["recorded"] = True
    return result


def link_project(project_id: str, writer: str = "onboard") -> dict:
    """Create/repair the vault window for one project (explicit motion)."""
    entry = registry.read_project(project_id)
    root = vault_root()
    if root is None:
        # Vault is a view, never a dependency — skip cleanly (AC 3).
        registry.amend(project_id, writer=writer, vault_link="unconfigured",
                       vault_link_detail="")
        return {"project_id": project_id, "state": "unconfigured",
                "skipped": True, "detail": "no obsidian_vault in user config",
                "links": []}
    if not root.is_dir():
        raise VaultError(f"configured vault {root} does not exist — fix "
                         f"obsidian_vault in ~/.tk-studio/config.yaml")

    folder = root / "projects" / project_id
    folder.mkdir(parents=True, exist_ok=True)
    actions = []
    for name, target in project_targets(entry).items():
        link = folder / name
        status = _link_status(link, target)
        if status == "linked":
            actions.append({"name": name, "action": "unchanged"})
        elif status == "not-a-link":
            actions.append({"name": name, "action": "refused",
                            "detail": f"{link} is real content, not a link — "
                                      f"move it aside and rerun"})
        elif not target.is_dir():
            actions.append({"name": name, "action": "skipped",
                            "detail": f"target {target} does not exist — stand it "
                                      f"up first (kb standup / planning binding)"})
        else:
            if status in ("wrong-target", "dangling"):
                _remove_link(link)
            _make_link(target, link)
            actions.append({"name": name, "action": "repaired"
                            if status != "missing" else "created"})

    outcome = check_links(project_id, record=False)
    registry.amend(project_id, writer=writer, vault_link=outcome["state"],
                   vault_link_detail=outcome.get("detail", ""))
    return {"project_id": project_id, "state": outcome["state"], "skipped": False,
            "folder": str(folder), "actions": actions, "links": outcome["links"]}


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio vault window")
    sub = parser.add_subparsers(dest="command", required=True)

    link = sub.add_parser("link")
    link.add_argument("--project-id", required=True)
    link.add_argument("--writer", default="onboard",
                      help="registry-writing surface (onboard/activate)")

    chk = sub.add_parser("check")
    chk.add_argument("--project-id", required=True)
    chk.add_argument("--record", action="store_true",
                     help="record observed state in the registry (activation)")

    args = parser.parse_args(argv)
    try:
        if args.command == "link":
            result = link_project(args.project_id, writer=args.writer)
            print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
            return 0
        result = check_links(args.project_id, record=args.record)
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
        return 0 if result["state"] in ("linked", "unconfigured") else 1
    except (VaultError, registry.RegistryError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
