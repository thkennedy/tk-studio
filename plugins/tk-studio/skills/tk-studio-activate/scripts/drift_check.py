"""tk-studio-activate — three-way health/drift check (AD-13). Read-only, loud.

Planes checked:
  bmad-base  installed _bmad/_config/manifest.yaml versions vs the bmad.lock pins
  plugin     installed plugin.json version vs the repo marketplace.json entry
             (catalog lockstep), when a marketplace catalog is present
  store      per-user store presence + skeleton (~/.tk-studio)

Per-plane status: ok | drift | missing | error. Overall:
  clean  → exit 0, drift-detection{result: clean}
  drift  → exit 1, drift-detection{result: drift}  (report-only; fixes are guided, never applied)
  error  → exit 2, activation-failure{step, error}  (a check step itself failed)

--guided additionally emits one onboarding-funnel event per plane with timings
(the instrumented onboarding funnel, AD-13). This script mutates nothing, ever.

Usage:
  uv run drift_check.py [--directory DIR] [--guided] [--lock PATH] [--marketplace PATH]

Stdlib-only (NFR9); no prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import bmadlock  # noqa: E402
import ledger  # noqa: E402

FIX_BMAD = "run tk-studio-install (tk install) to reinstall the base at the pin"
FIX_PLUGIN = "run /plugin marketplace update tk-studio, then reinstall/update the tk-studio plugin"
FIX_STORE = "run tk-studio onboarding to stand up the per-user store (Epic 2)"

STORE_SKELETON = ["config.yaml", "registry", "projects", "measurements"]


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


def check_plugin(directory: Path, marketplace_path: Path | None) -> dict:
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
        return plane
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
    return plane


def check_store() -> dict:
    plane = {"plane": "store", "status": "ok", "detail": ""}
    root = ledger.store_root()
    if not root.is_dir():
        plane.update(status="missing", detail=f"per-user store {root} does not exist",
                     fix=FIX_STORE)
        return plane
    absent = [n for n in STORE_SKELETON if not (root / n).exists()]
    if absent:
        plane.update(status="drift",
                     detail=f"store {root} missing: {', '.join(absent)}", fix=FIX_STORE)
    else:
        plane["detail"] = f"store {root} skeleton complete (junction checks arrive with Epic 2)"
    return plane


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".")
    parser.add_argument("--guided", action="store_true",
                        help="onboarding mode: also emit onboarding-funnel timings")
    parser.add_argument("--lock", help="override bmad.lock path (tests)")
    parser.add_argument("--marketplace", help="override marketplace.json path (tests)")
    args = parser.parse_args(argv)

    directory = Path(args.directory).resolve()
    lock_path = Path(args.lock) if args.lock else PLUGIN_ROOT / "bmad.lock"
    marketplace_path = Path(args.marketplace) if args.marketplace else None

    planes = []
    for check in (
        lambda: check_bmad_base(directory, lock_path),
        lambda: check_plugin(directory, marketplace_path),
        check_store,
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
