"""tk-studio orchestrator core — stateless role-aware routing (ST-5.1, AD-9, AD-17).

The front door resolves *who you are* before *what you need* (AD-17), then
routes by name — one deterministic pass, no session state, no persona:

  role          per-user store config (runtime --role overrides)
  working set   tracked project config working_set.<role> (recorded only by
                explicit confirmation through recommend.record — this module
                never writes it, never widens it, never invents it)
  routes        each confirmed resource resolved against the inventory
                (ST-4.1) into name-based handoff targets; a module expands
                to its installed skills, stock BMad skills included

Statelessness is literal (AD-9, O5 ruling): resolve() is a pure read of the
store + project planes and its output carries no timestamps — the same inputs
produce byte-identical output every call. The council persona shell (ST-5.2)
is data layered on top in attended sessions only; headless bypasses it and
gets identical routing because routing lives here, not in the shell.

Outcomes:
  ready             role and confirmed working set resolved; routes listed
  needs-onboarding  role missing or working_set.<role> unconfirmed — gaps[]
                    names exactly what is missing. The caller routes into
                    onboarding (attended) or halts blocked (headless); a
                    working set is never invented (never a silent guess).

CLI:
  uv run orchestrate.py resolve --directory DIR [--role ROLE] [--lock PATH]

Exit codes: 0 ok (any outcome — needs-onboarding is a result, not an error);
2 bad invocation. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import config as configlib
import inventory as inventorylib
import recommend as recommendlib
import routing as routinglib
import store as storelib

ORCHESTRATE_VERSION = 1

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SHELL_DIR = PLUGIN_ROOT / "skills" / "tk-studio-orchestrator" / "council"

OUTCOME_READY = "ready"
OUTCOME_NEEDS_ONBOARDING = "needs-onboarding"

ONBOARDING_SURFACE = "tk-studio-onboard"

_ROLE_TOKEN_RE = re.compile(r"^[a-z][a-z0-9-]*$")

# Per-role session framing (the AC's "right workflows from the same door").
# Framing shapes how the session is offered, never what is routable — routes
# come only from the confirmed working set. New roles are configuration, not
# architecture (AD-17): an unlisted role gets the generic posture below.
ROLE_FRAMING = {
    "developer": {
        "posture": "execute",
        "framing": "Execution session: pick up planned work and drive it to "
                   "done — implement, test, review, report.",
        "offers": ["implement the next story", "run a code review",
                   "check sprint status", "fix or extend code directly"],
    },
    "direction-giver": {
        "posture": "delegate-and-synthesize",
        "framing": "Direction session: frame the problem, convene "
                   "perspectives, delegate execution, synthesize decisions.",
        "offers": ["shape requirements and plans", "convene the council for "
                   "multi-perspective deliberation", "delegate execution work",
                   "review and synthesize outcomes"],
    },
}

_GENERIC_FRAMING = {
    "posture": "route-only",
    "framing": "No shipped framing for this role — routing strictly by its "
               "confirmed working set (new roles are configuration, AD-17).",
    "offers": [],
}


class OrchestrateError(Exception):
    """Bad invocation; resolution outcomes are results, never exceptions."""


def role_framing(role: str) -> dict:
    return ROLE_FRAMING.get(role, _GENERIC_FRAMING)


def _resolve_routes(project_root: Path, working_set: list[str],
                    lock_path: Path | None) -> tuple[list[dict], list[str]]:
    """Working-set names → name-based handoff targets, via the inventory.

    A module expands to its installed skills (stock BMad skills included —
    handoff is by skill name, zero forks). A name the inventory cannot place
    routes as missing with a note: the confirmed set stays authoritative,
    drift is surfaced, nothing is silently dropped or substituted.
    """
    inv = inventorylib.scan(project_root, lock_path=lock_path)
    by_name: dict[str, dict] = {}
    module_skills: dict[str, list[str]] = {}
    for resource in inv["resources"]:
        by_name.setdefault(resource["name"], resource)
        if resource["kind"] == "skill" and resource.get("module"):
            module_skills.setdefault(resource["module"], []).append(resource["name"])

    routes: list[dict] = []
    notes: list[str] = []
    for name in working_set:
        resource = by_name.get(name)
        if resource is None:
            routes.append({"name": name, "kind": "unknown", "status": "missing"})
            notes.append(f"confirmed resource '{name}' is not in the inventory "
                         "— re-run onboarding or install it (routing keeps the "
                         "entry visible, never drops it)")
            continue
        route = {"name": name, "kind": resource["kind"],
                 "status": resource["status"]}
        if resource["kind"] == "module":
            route["skills"] = sorted(module_skills.get(name, []))
            if resource["status"] != "installed":
                notes.append(f"module '{name}' is in the confirmed set but not "
                             "installed — tk install adds it at the bmad.lock pin")
        else:
            if resource.get("path"):
                route["path"] = resource["path"]
            if resource.get("description"):
                route["description"] = resource["description"]
            # budget visibility (AD-14, ST-6.5): each routed resource keeps
            # its own resolved model/effort — never a neighbor's
            route["routing"] = routinglib.resolve_routing(name, project_root)
        routes.append(route)
    return routes, notes


def resolve(project_root: Path, role: str | None = None,
            lock_path: Path | None = None) -> dict:
    """One stateless pass: role → working_set.<role> → routes. Pure read."""
    root = Path(project_root).resolve()
    if not root.is_dir():
        raise OrchestrateError(f"project root {root} is not a directory")

    role_source = "override"
    if role is None:
        role = storelib.read_config().get("role") or None
        role_source = "user-store" if role else None
    if role is not None and not _ROLE_TOKEN_RE.match(role):
        raise OrchestrateError(f"role '{role}' is not a valid role token")

    gaps: list[str] = []
    if role is None:
        gaps.append("role")
        working_set = None
    else:
        working_set = recommendlib.read_working_set(root).get(role) or None
        if not working_set:
            gaps.append(f"working_set.{role}")

    result = {
        "orchestrate_version": ORCHESTRATE_VERSION,
        "project_root": str(root),
        "role": role,
        "role_source": role_source,
        "working_set": working_set,
        "framing": role_framing(role) if role else None,
        "outcome": OUTCOME_NEEDS_ONBOARDING if gaps else OUTCOME_READY,
        "gaps": gaps,
        "routes": [],
        "notes": [],
    }

    if gaps:
        result["next"] = {
            "attended": f"route into {ONBOARDING_SURFACE} to close: "
                        + ", ".join(gaps),
            "headless": "halt blocked naming: " + ", ".join(gaps),
        }
        return result

    routes, notes = _resolve_routes(root, working_set, lock_path)
    result["routes"] = routes
    result["notes"] = notes
    return result


# ------------------------------------------------------------------- shell

def load_shell(shell_dir: Path | None = None) -> dict:
    """The council persona shell — presentation data, attended only (ST-5.2).

    A pure read of the markdown data assets under the orchestrator skill's
    council/ directory. resolve() never consults this and this never
    consults resolve(): the shell cannot influence routing, and loading it
    (or not) is the entire attended/headless difference (AD-9, AD-11).
    """
    directory = Path(shell_dir) if shell_dir else SHELL_DIR
    if not directory.is_dir():
        raise OrchestrateError(f"council shell assets missing at {directory}")
    assets = {path.stem: path.read_text(encoding="utf-8")
              for path in sorted(directory.glob("*.md"))}
    if not assets:
        raise OrchestrateError(f"no shell data assets under {directory}")
    return {"shell_version": 1, "source": str(directory), "assets": assets}


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio orchestrator core (stateless, read-only)")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("resolve", help="role → working set → routes")
    cmd.add_argument("--directory", required=True, help="project root")
    cmd.add_argument("--role", help="override the per-user store role")
    cmd.add_argument("--lock", help="module-registry path (tests)")
    sub.add_parser("shell",
                   help="load the council persona shell (attended only)")
    args = parser.parse_args(argv)

    try:
        if args.command == "shell":
            result = load_shell()
        else:
            result = resolve(Path(args.directory), role=args.role,
                             lock_path=args.lock)
    except (OrchestrateError, inventorylib.InventoryError,
            configlib.ConfigError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
