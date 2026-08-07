"""tk-studio-activate — three-way health/drift check (AD-13). Read-only, loud.

Planes checked:
  bmad-base  installed _bmad/_config/manifest.yaml versions vs the bmad.lock pins
  plugin     installed plugin.json version vs the repo marketplace.json entry
             (catalog lockstep), when a marketplace catalog is present — plus
             harness loadability: the harness's own install record
             (installed_plugins.json) must hold the plugin at the repo version,
             or headless /tk-studio:<skill> is 'Unknown command' while the
             repo looks healthy (AD-13)
  store      per-user store presence + skeleton (~/.tk-studio)
  vault      Obsidian vault window links for this project, when registered
             (ST-2.5) — observed state is recorded in the registry entry
             (writer: activate), the one sanctioned bookkeeping write; links
             are never repaired here (fix is the explicit vault link verb)

Per-plane status: ok | drift | missing | error. Overall:
  clean  → exit 0, drift-detection{result: clean}
  drift  → exit 1, drift-detection{result: drift}  (report-only; fixes are guided, never applied)
  error  → exit 2, activation-failure{step, error}  (a check step itself failed)

--guided additionally emits one onboarding-funnel event per plane with timings
(the instrumented onboarding funnel, AD-13). This script mutates nothing, ever.

Usage:
  uv run drift_check.py [--directory DIR] [--guided] [--lock PATH] [--marketplace PATH] [--claude-home DIR]

Stdlib-only (NFR9); no prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import bmadlock  # noqa: E402
import ledger  # noqa: E402
import registry  # noqa: E402
import store  # noqa: E402
import vault  # noqa: E402

FIX_BMAD = "run tk-studio-install (tk install) to reinstall the base at the pin"
FIX_PLUGIN = "run /plugin marketplace update tk-studio, then reinstall/update the tk-studio plugin"
FIX_HARNESS = ("install the plugin into the harness (AD-1 flow): claude plugin "
               "marketplace add <studio repo>, then claude plugin install tk-studio")
FIX_STORE = "run the store standup: uv run <plugin>/lib/store.py standup (idempotent, ST-2.1)"


def check_bmad_base(directory: Path, lock_path: Path) -> dict:
    plane = {"plane": "bmad-base", "status": "ok", "detail": ""}
    manifest = directory / "_bmad" / "_config" / "manifest.yaml"
    if not manifest.is_file():
        plane.update(status="missing",
                     detail=f"no installed base ({manifest} not found)", fix=FIX_BMAD)
        return plane
    try:
        lock = bmadlock.parse_lock(lock_path)
        installed = bmadlock.read_installed_manifest(manifest)
    except bmadlock.LockParseError as exc:
        plane.update(status="error", detail=str(exc))
        return plane
    pins = bmadlock.lock_pins(lock)
    mismatches = []
    for name, want in pins.items():
        got = installed.get(name)
        if got is None:
            mismatches.append(f"{name}: pinned {want}, not installed")
        elif got != want:
            mismatches.append(f"{name}: pinned {want}, installed {got}")
    extra = sorted(set(installed) - set(pins))
    if extra:
        mismatches.append(f"installed but not pinned: {', '.join(extra)}")
    if mismatches:
        plane.update(status="drift", detail="; ".join(mismatches), fix=FIX_BMAD)
    else:
        plane["detail"] = f"{len(pins)} components at pin (core {pins['core']})"
    return plane


def _harness_loadability(name: str, version: str,
                         claude_home: Path | None = None) -> dict:
    """AD-13: catalog lockstep proves the repo and marketplace agree; it says
    nothing about whether the harness can load the plugin at all. An absent
    installed_plugins.json entry means every headless /tk-studio:<skill>
    invocation is 'Unknown command' while the repo looks healthy."""
    home = claude_home or Path(os.environ.get("CLAUDE_CONFIG_DIR")
                               or Path.home() / ".claude")
    record = home / "plugins" / "installed_plugins.json"
    if not record.is_file():
        return {"status": "drift",
                "detail": f"plugin not installed in the harness (no {record})",
                "fix": FIX_HARNESS}
    try:
        data = json.loads(record.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"status": "error",
                "detail": f"harness install record unreadable: {exc}"}
    entries = [e for key, lst in (data.get("plugins") or {}).items()
               if key == name or key.startswith(f"{name}@")
               for e in lst]
    if not entries:
        return {"status": "drift",
                "detail": (f"plugin not installed in the harness ({record.name} "
                           f"has no {name} entry — headless /{name}:<skill> is "
                           "'Unknown command')"),
                "fix": FIX_HARNESS}
    at_version = [e for e in entries if e.get("version") == version]
    if not at_version:
        held = ", ".join(sorted({str(e.get("version")) for e in entries}))
        return {"status": "drift",
                "detail": (f"harness holds v{held} but repo plugin is "
                           f"v{version} (stale harness install)"),
                "fix": FIX_HARNESS}
    if not any(Path(e.get("installPath", "")).is_dir() for e in at_version):
        return {"status": "drift",
                "detail": (f"harness entry v{version} installPath missing "
                           "(cache evicted)"),
                "fix": FIX_HARNESS}
    return {"status": "ok", "detail": f"harness-loadable (v{version} installed)"}


_STATUS_RANK = {"ok": 0, "drift": 1, "missing": 1, "error": 2}


def check_plugin(directory: Path, marketplace_path: Path | None,
                 claude_home: Path | None = None) -> dict:
    plane = {"plane": "plugin", "status": "ok", "detail": ""}
    plugin_json = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"
    try:
        installed = json.loads(plugin_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        plane.update(status="error", detail=f"installed plugin.json unreadable: {exc}")
        return plane
    catalog = marketplace_path or (directory / ".claude-plugin" / "marketplace.json")
    if not catalog.is_file():
        plane["detail"] = (
            f"installed plugin v{installed.get('version')}; no marketplace catalog at "
            f"{catalog} — catalog lockstep not checkable from this project"
        )
    else:
        try:
            market = json.loads(catalog.read_text(encoding="utf-8"))
            entry = next(p for p in market["plugins"] if p["name"] == installed.get("name"))
        except (OSError, json.JSONDecodeError, KeyError, StopIteration) as exc:
            plane.update(status="error",
                         detail=f"marketplace catalog unreadable or missing entry: {exc}")
            return plane
        if entry.get("version") != installed.get("version"):
            plane.update(
                status="drift",
                detail=(f"installed plugin v{installed.get('version')} vs marketplace "
                        f"catalog v{entry.get('version')} (lockstep broken)"),
                fix=FIX_PLUGIN,
            )
        else:
            plane["detail"] = f"plugin v{installed.get('version')} in lockstep with catalog"

    probe = _harness_loadability(installed.get("name"), installed.get("version"),
                                 claude_home)
    if _STATUS_RANK[probe["status"]] > _STATUS_RANK[plane["status"]]:
        plane["status"] = probe["status"]
    plane["detail"] = "; ".join(x for x in (plane["detail"], probe["detail"]) if x)
    if probe.get("fix"):
        plane["fix"] = "; ".join(x for x in (plane.get("fix"), probe["fix"]) if x)
    return plane


def check_store() -> dict:
    plane = {"plane": "store", "status": "ok", "detail": ""}
    health = store.check_store()
    root = health["root"]
    if not health["exists"]:
        plane.update(status="missing", detail=f"per-user store {root} does not exist",
                     fix=FIX_STORE)
        return plane
    if not health["complete"]:
        problems = []
        if health["missing_dirs"]:
            problems.append(f"missing: {', '.join(health['missing_dirs'])}")
        if not health["config_present"]:
            problems.append("config.yaml absent")
        elif health["config_error"]:
            problems.append(f"config.yaml unreadable: {health['config_error']}")
        elif health["missing_config_keys"]:
            problems.append(
                f"config.yaml missing keys: {', '.join(health['missing_config_keys'])}")
        plane.update(status="drift", detail=f"store {root} — {'; '.join(problems)}",
                     fix=FIX_STORE)
    else:
        plane["detail"] = f"store {root} skeleton + config complete"
    return plane


def check_vault(directory: Path) -> dict:
    plane = {"plane": "vault", "status": "ok", "detail": ""}
    try:
        projects = registry.list_projects()
    except registry.RegistryError as exc:
        plane.update(status="error", detail=f"registry unreadable: {exc}")
        return plane
    project_id = next(
        (pid for pid, e in projects.items() if Path(e["root"]) == directory), None)
    if project_id is None:
        plane["detail"] = (f"{directory.name} not registered — vault window "
                           f"not applicable until onboarding registers it")
        return plane
    try:
        result = vault.check_links(project_id, record=True)
    except (vault.VaultError, registry.RegistryError) as exc:
        plane.update(status="error", detail=str(exc))
        return plane
    state = result["state"]
    if state in ("linked", "unconfigured"):
        plane["detail"] = (f"vault window {state} for {project_id}"
                           + (f" ({result.get('detail')})" if state == "unconfigured" else ""))
    else:
        plane.update(status="drift",
                     detail=f"vault window {state} for {project_id}: "
                            f"{result.get('detail', '')}",
                     fix=result.get("fix", ""))
    if result.get("recorded"):
        plane["detail"] += " — state recorded in registry entry"
    return plane


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".")
    parser.add_argument("--guided", action="store_true",
                        help="onboarding mode: also emit onboarding-funnel timings")
    parser.add_argument("--lock", help="override bmad.lock path (tests)")
    parser.add_argument("--marketplace", help="override marketplace.json path (tests)")
    parser.add_argument("--claude-home",
                        help="override the harness config dir (tests; default "
                             "CLAUDE_CONFIG_DIR or ~/.claude)")
    args = parser.parse_args(argv)

    directory = Path(args.directory).resolve()
    lock_path = Path(args.lock) if args.lock else PLUGIN_ROOT / "bmad.lock"
    marketplace_path = Path(args.marketplace) if args.marketplace else None
    claude_home = Path(args.claude_home) if args.claude_home else None

    planes = []
    for check in (
        lambda: check_bmad_base(directory, lock_path),
        lambda: check_plugin(directory, marketplace_path, claude_home),
        check_store,
        lambda: check_vault(directory),
    ):
        started = time.monotonic()
        plane = check()
        plane["elapsed_ms"] = round((time.monotonic() - started) * 1000, 1)
        planes.append(plane)
        if args.guided:
            _emit("onboarding-funnel", {
                "stage": f"drift-check:{plane['plane']}",
                "ok": plane["status"] == "ok",
                "elapsed_ms": plane["elapsed_ms"],
                "detail": plane["detail"][:300],
            })

    errors = [p for p in planes if p["status"] == "error"]
    drifted = [p for p in planes if p["status"] in ("drift", "missing")]
    if errors:
        result, exit_code = "error", 2
        _emit("activation-failure", {
            "step": errors[0]["plane"],
            "error": errors[0]["detail"][:500],
        })
    else:
        result = "drift" if drifted else "clean"
        exit_code = 1 if drifted else 0
        _emit("drift-detection", {
            "result": result,
            "planes": [
                {"plane": p["plane"], "status": p["status"], "detail": p["detail"][:300]}
                for p in planes
            ],
        })

    print(json.dumps({
        "ok": not errors,
        "result": result,
        "planes": planes,
        "fixes": [p["fix"] for p in planes if p.get("fix")],
        "mutated": False,
    }, ensure_ascii=False, indent=2))
    return exit_code


def _emit(event: str, payload: dict) -> None:
    try:
        ledger.emit(event, payload, project=None)
    except Exception as exc:  # measurement must never break the check
        print(f"warning: {event} event not recorded: {exc}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
