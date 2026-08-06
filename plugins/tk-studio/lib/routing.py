"""tk-studio model/effort routing — deliberate escalation only (ST-6.5, AD-14).

Every shipped resource declares a conservative default in its
customize.toml ([model] default/effort). Effective values resolve through
exactly the three tiers AD-14 names, first hit wins:

  runtime override   --set model.default=... / a job definition's own
                     model/effort fields (driver-contract §5)
  project config     model.default / model.effort in .tk-studio/
                     config.local.yaml then config.yaml
  resource default   the resource's customize.toml [model] section

User and studio config scopes deliberately carry no routing keys — AD-14 is
a three-tier precedence, and a per-user "always max" would be exactly the
accidental escalation it forbids. A resource that declares nothing gets the
conservative studio floor, loudly sourced as `studio-floor` — never a
silently inherited larger value. Each resource resolves independently: in a
job or convene spanning several resources, nothing inherits a more
expensive neighbor (resolve_many).

CLI:
  uv run routing.py resolve --resource NAME [--resource NAME ...]
                            [--directory DIR] [--set k=v ...]

Exit codes: 0 ok; 2 bad invocation. Stdlib-only (NFR9); never prompts.
"""
from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

import config as configlib

PLUGIN_ROOT = Path(__file__).resolve().parents[1]

# The conservative floor for a resource with no declaration (AD-14): cheap
# enough that forgetting a customize.toml can never burn budget.
STUDIO_FLOOR = {"default": "claude-sonnet-5", "effort": "low"}

_ROUTING_SCOPES = ("runtime", "project-local", "project-tracked")


class RoutingError(Exception):
    """Bad invocation; resolution itself always answers."""


def resource_default(resource: str) -> tuple[dict, str | None]:
    """The [model] section of the resource's shipped customize.toml."""
    path = PLUGIN_ROOT / "skills" / resource / "customize.toml"
    if path.is_file():
        try:
            section = tomllib.loads(
                path.read_text(encoding="utf-8")).get("model") or {}
        except tomllib.TOMLDecodeError as exc:
            raise RoutingError(f"{path.name} for '{resource}' is not valid "
                               f"TOML: {exc}") from exc
        if section:
            return section, "resource-default"
    return {}, None


def resolve_routing(resource: str, project_root: Path | None = None,
                    runtime: dict | None = None) -> dict:
    """One resource's effective model/effort with the winning tier named."""
    model = effort = None
    model_source = effort_source = None
    for name, mapping in configlib.scopes(project_root, runtime):
        if name not in _ROUTING_SCOPES:
            continue
        if model is None:
            found, value = configlib._dig(mapping, "model.default")
            if found and value is not None:
                model, model_source = value, name
        if effort is None:
            found, value = configlib._dig(mapping, "model.effort")
            if found and value is not None:
                effort, effort_source = value, name
    if model is None or effort is None:
        declared, source = resource_default(resource)
        if model is None and declared.get("default"):
            model, model_source = declared["default"], source
        if effort is None and declared.get("effort"):
            effort, effort_source = declared["effort"], source
    if model is None:
        model, model_source = STUDIO_FLOOR["default"], "studio-floor"
    if effort is None:
        effort, effort_source = STUDIO_FLOOR["effort"], "studio-floor"
    return {"resource": resource,
            "model": model, "model_source": model_source,
            "effort": effort, "effort_source": effort_source}


def resolve_many(resources: list[str], project_root: Path | None = None,
                 runtime: dict | None = None) -> list[dict]:
    """Each resource independently — no silent inheritance across a span."""
    return [resolve_routing(r, project_root, runtime) for r in resources]


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio model/effort routing (AD-14)")
    sub = parser.add_subparsers(dest="command", required=True)
    res = sub.add_parser("resolve")
    res.add_argument("--resource", action="append", required=True,
                     dest="resources", metavar="NAME")
    res.add_argument("--directory", help="project root")
    res.add_argument("--set", dest="sets", action="append", default=[],
                     metavar="KEY=VALUE", help="runtime override (repeatable)")
    args = parser.parse_args(argv)
    try:
        runtime = configlib._parse_runtime_sets(args.sets)
        root = Path(args.directory) if args.directory else None
        routed = resolve_many(args.resources, project_root=root,
                              runtime=runtime)
    except (RoutingError, configlib.ConfigError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, "routing": routed}, ensure_ascii=False,
                     indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
