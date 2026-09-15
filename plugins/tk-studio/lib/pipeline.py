"""tk-studio execution-pipeline routing — the model and effort each leg of a
bmad-loop run uses (AD-14 applied to the substrate; studio pipeline decision 5).

The engine routes per STAGE (`[adapter.dev|review|triage]` in its policy);
the studio routes per LEG and per STORY, then writes the result where the
engine and the dev session read it. Legs:

  session      the dev session (adapter.dev) — a monitor, never a judge
  implementer  the coding subagent the session launches
  reviewers    the review-hunter subagents
  consult      the top-tier subagent launched on an objective trigger only
  seam         the read-only pre-dispatch check of the next story
  review       bmad-loop's follow-up review session (adapter.review)
  triage       bmad-loop sweep / triage / resolve sessions (adapter.triage)
  supervise    the conditional post-hoc supervisor pass
  planner      the attended planning session (informational; never spawned)

Resolution per leg and field, first hit wins (AD-14: runtime > project >
resource default):

  runtime    --set <leg>.<field>=<value>
  project    <root>/.bmad-loop/routing.toml —
             [stories."<key>"] > first matching [[rules]] (fnmatch on the
             story key) > [defaults]
  resource   skills/tk-studio-launch/customize.toml [pipeline.legs] — the
             shipped, measured defaults (kb/execution-pipeline-model-routing.md)

The consult policy (`triggers`, `scope`, `log`) resolves project `[consult]`
> resource `[pipeline.consult]`, as a unit.

Verbs (all end with JSON on stdout; never prompt — AD-11):
  uv run pipeline.py defaults
  uv run pipeline.py check   --directory DIR
  uv run pipeline.py resolve --directory DIR [--story KEY] [--set leg.field=v ...]
  uv run pipeline.py apply   --directory DIR --story KEY [--set ...] [--dry-run]

`apply` writes exactly three things and nothing else:
  1. the managed block at the end of `.bmad-loop/policy.toml`
     (`[adapter.dev|review|triage]`: model + `--effort`) — refused when the
     policy is absent (`bmad-loop init` creates it; never invented here)
  2. `CLAUDE_CODE_SUBAGENT_MODEL` in `.bmad-loop/profiles/claude.toml`
     (= implementer), only when that tracked profile exists
  3. `.bmad-loop/routing.current.json` — every leg plus the consult policy,
     read by the dev session to pass `model:` explicitly per subagent
`apply` also reports which of those files the project has NOT gitignored:
the engine's preflight refuses a dirty tree, so an unignored write there
would block the very launch it prepares. That is a named warning, not a
guess and not a fix.

Exit codes: 0 verb answered (a `check` with problems answers ok=false and
exits 2); 2 bad invocation or refusal (unknown leg, invalid model or
effort, policy missing, routing.toml unparsable). Stdlib-only (NFR9).
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
import tomllib
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
RESOURCE = "tk-studio-launch"
RESOURCE_TOML = PLUGIN_ROOT / "skills" / RESOURCE / "customize.toml"

LEGS = ("session", "implementer", "reviewers", "consult", "seam",
        "review", "triage", "supervise", "planner")
# legs bmad-loop itself routes, and the stage table each one writes
STAGE_OF = {"session": "dev", "review": "review", "triage": "triage"}
FIELDS = ("model", "effort", "skill", "agent", "note")
MODELS = frozenset({"claude-fable-5-1", "claude-opus-5", "claude-sonnet-5",
                    "claude-haiku-4-5-20251001"})
EFFORTS = frozenset({"low", "medium", "high"})
META_KEYS = ("match", "note")

ROUTING_REL = Path(".bmad-loop") / "routing.toml"
POLICY_REL = Path(".bmad-loop") / "policy.toml"
PROFILE_REL = Path(".bmad-loop") / "profiles" / "claude.toml"
CURRENT_REL = Path(".bmad-loop") / "routing.current.json"

BEGIN = "# >>> routing (managed by tk-studio lib/pipeline.py) — do not edit inside this block"
# the block the project-local applier of the measuring project wrote; the
# same fence text so a project migrating to the studio core keeps one block
LEGACY_BEGIN_RE = r"# >>> routing \(managed by [^)]*\)[^\n]*"
END = "# <<< routing"


class PipelineError(Exception):
    """Bad invocation or refusal; resolution itself always answers."""


# ------------------------------------------------------------- resource tier

def resource_defaults(path: Path = RESOURCE_TOML) -> dict:
    """{'legs': {...}, 'consult': {...}} from the shipped customize.toml."""
    if not path.is_file():
        raise PipelineError(f"resource defaults missing: {path}")
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise PipelineError(f"{path.name} is not valid TOML: {exc}") from exc
    section = data.get("pipeline") or {}
    legs = section.get("legs") or {}
    problems = _validate_legs("resource [pipeline.legs]", legs)
    if problems:
        raise PipelineError("; ".join(problems))
    return {"legs": {k: dict(v) for k, v in legs.items()},
            "consult": dict(section.get("consult") or {})}


# -------------------------------------------------------------- project tier

def load_project_routing(project_root: Path) -> dict:
    """The project's routing.toml, or {} when the project has none."""
    path = Path(project_root) / ROUTING_REL
    if not path.is_file():
        return {}
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise PipelineError(f"{ROUTING_REL.as_posix()}: {exc}") from exc


def _legs(table: dict) -> dict:
    return {k: v for k, v in table.items() if k not in META_KEYS}


def _validate_legs(where: str, legs: dict) -> list[str]:
    problems: list[str] = []
    if not isinstance(legs, dict):
        return [f"{where}: must be a table of legs"]
    for leg, fields in legs.items():
        if leg not in LEGS:
            problems.append(f"{where}: unknown leg {leg!r} (legs: {', '.join(LEGS)})")
            continue
        if not isinstance(fields, dict):
            problems.append(f"{where}.{leg}: must be a table")
            continue
        for field in fields:
            if field not in FIELDS:
                problems.append(f"{where}.{leg}: unknown field {field!r} (fields: {', '.join(FIELDS)})")
        model = fields.get("model")
        if model is not None and model not in MODELS:
            problems.append(f"{where}.{leg}: model {model!r} not in {sorted(MODELS)}")
        effort = fields.get("effort")
        if effort is not None and effort not in EFFORTS:
            problems.append(f"{where}.{leg}: effort {effort!r} not in {sorted(EFFORTS)}")
    return problems


def validate_project(routing: dict) -> list[str]:
    """Problems in a project routing table (empty list = fine, {} = fine)."""
    problems = _validate_legs("defaults", routing.get("defaults", {}))
    rules = routing.get("rules", [])
    if not isinstance(rules, list):
        problems.append("rules: must be an array of tables")
        rules = []
    for i, rule in enumerate(rules):
        if not isinstance(rule, dict) or not isinstance(rule.get("match"), str):
            problems.append(f"rules[{i}]: missing match")
            continue
        problems += _validate_legs(f"rules[{i}]", _legs(rule))
    stories = routing.get("stories", {})
    if not isinstance(stories, dict):
        problems.append("stories: must be a table keyed by story")
        stories = {}
    for key, over in stories.items():
        if not isinstance(over, dict):
            problems.append(f"stories.{key}: must be a table")
            continue
        problems += _validate_legs(f"stories.{key}", _legs(over))
    consult = routing.get("consult")
    if consult is not None:
        if not isinstance(consult, dict):
            problems.append("consult: must be a table")
        elif "triggers" in consult and not (
                isinstance(consult["triggers"], list)
                and all(isinstance(t, str) for t in consult["triggers"])):
            problems.append("consult.triggers: must be an array of strings")
    return problems


# --------------------------------------------------------------- runtime tier

def parse_sets(pairs: list[str]) -> dict:
    """--set leg.field=value pairs into {leg: {field: value}}."""
    runtime: dict = {}
    for pair in pairs:
        key, sep, value = pair.partition("=")
        if not sep or not key or not value:
            raise PipelineError(f"--set expects leg.field=value, got {pair!r}")
        leg, dot, field = key.partition(".")
        if not dot or leg not in LEGS or field not in FIELDS:
            raise PipelineError(f"--set expects <leg>.<field> with leg in {LEGS} "
                                f"and field in {FIELDS}, got {key!r}")
        runtime.setdefault(leg, {})[field] = value
    problems = _validate_legs("runtime", runtime)
    if problems:
        raise PipelineError("; ".join(problems))
    return runtime


# ------------------------------------------------------------------ resolve

def resolve(project_root: Path | None, story: str | None = None,
            runtime: dict | None = None) -> dict:
    """Effective route per leg with the winning tier named per field."""
    shipped = resource_defaults()
    route = {leg: dict(v) for leg, v in shipped["legs"].items()}
    sources = {leg: {f: "resource-default" for f in v} for leg, v in route.items()}
    consult_policy, consult_source = dict(shipped["consult"]), "resource-default"
    matched = None
    override = None

    routing = load_project_routing(project_root) if project_root else {}
    problems = validate_project(routing)
    if problems:
        raise PipelineError("; ".join(problems))

    def overlay(legs: dict, label: str) -> None:
        for leg, fields in legs.items():
            route.setdefault(leg, {}).update(fields)
            sources.setdefault(leg, {}).update({f: label for f in fields})

    overlay(routing.get("defaults", {}), "project-defaults")
    if story is not None:
        for rule in routing.get("rules", []):
            if fnmatch.fnmatchcase(story, rule["match"]):
                matched = rule["match"]
                overlay(_legs(rule), f"project-rule {matched!r}")
                break
        override = routing.get("stories", {}).get(story)
        if override:
            overlay(_legs(override), "project-story")
    if routing.get("consult"):
        consult_policy, consult_source = dict(routing["consult"]), "project"
    if runtime:
        overlay(runtime, "runtime")

    for leg in STAGE_OF:
        if not route.get(leg, {}).get("model"):
            raise PipelineError(f"leg {leg!r} resolved without a model — the "
                                f"engine stage [adapter.{STAGE_OF[leg]}] needs one")
    return {"ok": True, "story": story, "matched_rule": matched,
            "story_override": bool(override),
            "note": (override or {}).get("note"),
            "route": route, "sources": sources,
            "consult_policy": consult_policy, "consult_source": consult_source,
            "project_routing": (project_root / ROUTING_REL).as_posix()
            if project_root and (project_root / ROUTING_REL).is_file() else None}


# -------------------------------------------------------------------- apply

def render_block(route: dict, story: str) -> str:
    lines = [BEGIN, f"# story: {story}"]
    for leg, stage in STAGE_OF.items():
        fields = route.get(leg, {})
        lines.append(f"[adapter.{stage}]")
        lines.append(f'model = "{fields["model"]}"')
        effort = fields.get("effort")
        if effort:
            lines.append('extra_args = ["--permission-mode", "bypassPermissions", '
                         f'"--effort", "{effort}"]')
        lines.append("")
    lines.append(END)
    return "\n".join(lines) + "\n"


def _write(path: Path, old: str, new: str, dry_run: bool) -> str:
    if new == old:
        return "unchanged"
    if not dry_run:
        path.write_text(new, encoding="utf-8", newline="\n")
    return "written"


def write_policy(project_root: Path, route: dict, story: str, dry_run: bool) -> str:
    policy = project_root / POLICY_REL
    if not policy.is_file():
        raise PipelineError(f"policy missing: {POLICY_REL.as_posix()} "
                            "(run `bmad-loop init` first; never invented here)")
    text = policy.read_text(encoding="utf-8")
    block = render_block(route, story)
    pattern = re.compile(LEGACY_BEGIN_RE + r".*?" + re.escape(END) + r"\n?", re.S)
    if pattern.search(text):
        new = pattern.sub(lambda _m: block, text, count=1)
    else:
        new = text.rstrip("\n") + "\n\n" + block
    return _write(policy, text, new, dry_run)


def write_profile(project_root: Path, route: dict, dry_run: bool) -> str:
    model = route.get("implementer", {}).get("model")
    if not model:
        return "skipped (no implementer.model)"
    profile = project_root / PROFILE_REL
    if not profile.is_file():
        return "skipped (no tracked profile)"
    text = profile.read_text(encoding="utf-8")
    line = f'CLAUDE_CODE_SUBAGENT_MODEL = "{model}"'
    if re.search(r"^CLAUDE_CODE_SUBAGENT_MODEL\s*=.*$", text, re.M):
        new = re.sub(r"^CLAUDE_CODE_SUBAGENT_MODEL\s*=.*$", line, text, flags=re.M)
    elif re.search(r"^\[env\]\s*$", text, re.M):
        new = re.sub(r"^\[env\]\s*$", "[env]\n" + line, text, count=1, flags=re.M)
    else:
        new = text.rstrip("\n") + "\n\n[env]\n" + line + "\n"
    return _write(profile, text, new, dry_run)


def current_payload(res: dict, now: datetime | None = None) -> dict:
    route = res["route"]
    payload = {"story": res["story"],
               "written_at": (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")}
    for leg in LEGS:
        payload[leg] = dict(route.get(leg, {}))
    payload["consult_triggers"] = list(res["consult_policy"].get("triggers", []))
    payload["consult_scope"] = res["consult_policy"].get("scope", "")
    payload["matched_rule"] = res["matched_rule"]
    payload["story_override"] = res["story_override"]
    payload["sources"] = res["sources"]
    return payload


def write_current(project_root: Path, res: dict, dry_run: bool) -> str:
    current = project_root / CURRENT_REL
    new = json.dumps(current_payload(res), indent=2, ensure_ascii=False) + "\n"
    old = current.read_text(encoding="utf-8") if current.is_file() else ""

    def strip(s: str) -> str:  # written_at changes every run
        return re.sub(r'"written_at": "[^"]*"', '"written_at": ""', s)

    if strip(old) == strip(new):
        return "unchanged"
    if not dry_run:
        current.parent.mkdir(parents=True, exist_ok=True)
        current.write_text(new, encoding="utf-8", newline="\n")
    return "written"


def unignored_writes(project_root: Path) -> list[str]:
    """Which of the files `apply` writes git does NOT ignore (a dirty-tree
    hazard for the engine's preflight). Empty when git is unavailable or the
    root is not a repository — never a guess."""
    rels = [POLICY_REL.as_posix(), CURRENT_REL.as_posix()]
    try:
        proc = subprocess.run(["git", "check-ignore", "--no-index", *rels],
                              cwd=project_root, capture_output=True, text=True,
                              timeout=30)
    except (OSError, subprocess.SubprocessError):
        return []
    if proc.returncode not in (0, 1):
        return []
    ignored = {line.strip().replace("\\", "/") for line in proc.stdout.splitlines()}
    return [r for r in rels if r not in ignored]


def apply(project_root: Path, story: str, runtime: dict | None = None,
          dry_run: bool = False) -> dict:
    res = resolve(project_root, story, runtime)
    res["writes"] = {
        "policy": write_policy(project_root, res["route"], story, dry_run),
        "profile": write_profile(project_root, res["route"], dry_run),
        "current": write_current(project_root, res, dry_run),
    }
    res["dry_run"] = dry_run
    res["unignored"] = unignored_writes(project_root)
    return res


# ---------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="tk-studio execution-pipeline routing (per leg, per story)")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("defaults", help="the shipped resource-default legs + consult policy")
    p = sub.add_parser("check", help="validate the project's .bmad-loop/routing.toml")
    p.add_argument("--directory", required=True)
    for name, help_text in (("resolve", "the effective route, tier named per field"),
                            ("apply", "resolve and write the route where the engine reads it")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--directory", required=True)
        p.add_argument("--story", required=(name == "apply"), metavar="KEY")
        p.add_argument("--set", dest="sets", action="append", default=[],
                       metavar="LEG.FIELD=VALUE", help="runtime override (repeatable)")
        if name == "apply":
            p.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.command == "defaults":
            shipped = resource_defaults()
            out = {"ok": True, "resource": RESOURCE, "legs": shipped["legs"],
                   "consult": shipped["consult"]}
        elif args.command == "check":
            root = Path(args.directory)
            routing = load_project_routing(root)
            problems = validate_project(routing)
            out = {"ok": not problems, "routing": ROUTING_REL.as_posix(),
                   "present": bool(routing), "problems": problems,
                   "rules": [r["match"] for r in routing.get("rules", [])
                             if isinstance(r, dict) and "match" in r],
                   "story_overrides": sorted(routing.get("stories", {}))
                   if isinstance(routing.get("stories", {}), dict) else []}
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return 0 if not problems else 2
        else:
            root = Path(args.directory)
            runtime = parse_sets(args.sets)
            if args.command == "resolve":
                out = resolve(root, args.story, runtime)
            else:
                out = apply(root, args.story, runtime, args.dry_run)
    except PipelineError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
