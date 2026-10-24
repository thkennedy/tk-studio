"""tk-studio configuration — three scopes, one resolution order (ST-2.2, AD-15).

Scopes, highest precedence first:

  runtime          --set key=value overrides on the invocation
  project local    {project-root}/.tk-studio/config.local.yaml   (per-dev, ignored)
  project tracked  {project-root}/.tk-studio/config.yaml         (team, on VCS)
  user             ~/.tk-studio/config.yaml                      (per-user store)
  studio           <plugin>/defaults.yaml                        (shipped defaults)

Every surface resolves keys through this library — two skills never resolve
the same key differently. Keys are dotted paths ("planning.backend"); the
first scope where the exact path exists wins (no cross-scope merging — a
scope that sets a key owns it).

Tracked writes are classified first (AD-3): content carrying an absolute
machine path or credential-shaped value is refused with a classification
error, never written. The local overlay is exactly where machine paths
belong, so it is exempt from the path check (credentials are refused
everywhere — they live in the OS credential store or environment, only).

CLI:
  uv run config.py resolve --key planning.backend [--directory DIR] [--set k=v ...]
  uv run config.py standup --directory DIR [--vcs git|perforce] [--project-id ID]
  uv run config.py root [--directory DIR]

Project root (AD-21, driver contract 0.1.22): the nearest ancestor-or-self
holding .tk-studio/config.yaml — a nested studio project (apps/supervisor)
wins over the outer one. A folder with no config anywhere above resolves to
itself. `resolve --directory` and `root` walk up; `standup` takes its
--directory literally (a creation verb never walks up). The studio root is
$TK_STUDIO_ROOT, else the nearest ancestor holding plugins/tk-studio/, else
none — never the plugin's own folder.

Exit codes: 0 ok; 2 key not found / classification refusal; 1 unexpected failure.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import classify
import miniyaml
import store

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
STUDIO_DEFAULTS_PATH = PLUGIN_ROOT / "defaults.yaml"

TRACKED_NAME = "config.yaml"
LOCAL_NAME = "config.local.yaml"

P4IGNORE_GUIDANCE = (
    "Perforce project: add '.tk-studio/config.local.yaml' to your P4IGNORE file "
    "(the ignore is hygiene — the off-repo per-user store is the safety mechanism, AD-15)."
)


class ClassificationError(Exception):
    """AD-3 refusal: content does not belong in a tracked file."""


class ConfigError(Exception):
    """Config file unreadable or key missing."""


# ------------------------------------------------------------ classification

def assert_tracked_safe(text: str, label: str) -> None:
    """Refuse tracked-file content carrying machine paths or credentials (AD-3)."""
    problems = classify.find_credentials(text)
    paths = classify.find_machine_paths(text)
    if paths:
        problems.append(f"absolute machine path(s): {', '.join(paths[:5])}")
    if problems:
        raise ClassificationError(
            f"refusing to write {label}: {'; '.join(problems)} — machine paths "
            f"belong in {LOCAL_NAME} or the per-user store; credentials belong "
            f"in the OS credential store or environment (AD-3)"
        )


def assert_local_safe(text: str, label: str) -> None:
    """The local overlay may hold machine paths, never credentials."""
    problems = classify.find_credentials(text)
    if problems:
        raise ClassificationError(
            f"refusing to write {label}: {'; '.join(problems)} — credentials "
            f"never land in any config file (AD-3)"
        )


# ---------------------------------------------------------------- resolution

def _load_yaml(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return miniyaml.load(path)
    except miniyaml.MiniYamlError as exc:
        raise ConfigError(f"{path}: {exc}") from exc


def _dig(mapping: dict, dotted: str):
    """(found, value) for a dotted path in nested mappings."""
    node = mapping
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return False, None
        node = node[part]
    return True, node


def scopes(project_root: Path | None = None,
           runtime: dict | None = None) -> list[tuple[str, dict]]:
    """All scopes as (name, mapping), highest precedence first."""
    layers: list[tuple[str, dict]] = [("runtime", runtime or {})]
    if project_root is not None:
        conf_dir = Path(project_root) / ".tk-studio"
        layers.append(("project-local", _load_yaml(conf_dir / LOCAL_NAME)))
        layers.append(("project-tracked", _load_yaml(conf_dir / TRACKED_NAME)))
    layers.append(("user", _load_yaml(store.config_path())))
    layers.append(("studio", _load_yaml(STUDIO_DEFAULTS_PATH)))
    return layers


def resolve(key: str, project_root: Path | None = None,
            runtime: dict | None = None) -> tuple[object, str]:
    """(value, scope-name) for a dotted key; ConfigError if no scope has it."""
    for name, mapping in scopes(project_root, runtime):
        found, value = _dig(mapping, key)
        if found:
            return value, name
    raise ConfigError(f"key '{key}' is not defined in any scope")


def _parse_runtime_sets(pairs: list[str]) -> dict:
    """--set a.b=c pairs into a nested runtime-scope mapping."""
    runtime: dict = {}
    for pair in pairs:
        key, sep, raw = pair.partition("=")
        if not sep or not key:
            raise ConfigError(f"--set expects key=value, got '{pair}'")
        node = runtime
        parts = key.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
            if not isinstance(node, dict):
                raise ConfigError(f"--set path conflict at '{part}' in '{key}'")
        node[parts[-1]] = miniyaml.loads(f"v: {raw}")["v"] if raw else None
    return runtime


# -------------------------------------------------------------- project root

def _store_roots() -> list[Path]:
    """Every folder the per-user store can live in: the configured root
    ($TK_STUDIO_HOME, set by tests and by workers) and the default
    ~/.tk-studio, which stays on disk when the override points elsewhere. On
    Windows %TEMP% and every project under the profile sit below ~, so an
    exclusion of the configured root alone made C:\\Users\\<user> a project
    root for all of them (found by the host gate on 2026-10-16; the Linux
    engine never sees it because /tmp is outside $HOME)."""
    return [store.store_root(), Path.home() / ".tk-studio"]


# Folders only a per-user store holds (AD-3: working data never on VCS), so a
# .tk-studio/ carrying any of them is a store wherever it lives — the rule that
# needs no environment to be right (a redirected home still leaves the real
# store on disk, above every project under the profile on Windows).
STORE_ONLY_DIRS = ("registry", "measurements", "projects")


def _is_store(marker: Path) -> bool:
    """True when `marker` (a .tk-studio/ folder) is a per-user store: it is a
    configured or default store root (`_store_roots`), or it holds a
    store-only folder (`STORE_ONLY_DIRS`)."""
    if any((marker / name).is_dir() for name in STORE_ONLY_DIRS):
        return True
    try:
        resolved = marker.resolve()
    except OSError:
        return False
    for root in _store_roots():
        try:
            if resolved == root.resolve():
                return True
        except OSError:
            continue
    return False


def _holds_config(directory: Path) -> bool:
    """True when `directory` is a studio project root: it holds
    .tk-studio/config.yaml and that .tk-studio/ is not a per-user store
    (`_is_store`), whose config.yaml would otherwise make $HOME a project
    root."""
    marker = directory / ".tk-studio"
    if not (marker / TRACKED_NAME).is_file():
        return False
    return not _is_store(marker)


def find_project_root(start: Path) -> Path:
    """The nearest ancestor-or-self of `start` holding .tk-studio/config.yaml;
    `start` itself (resolved) when none does — today's behaviour for a folder
    not yet onboarded. A `start` that is not an existing directory is taken
    literally (resolved, no walk-up), so a missing or mistyped nested path
    never lands in an enclosing project."""
    start = Path(start).resolve()
    if not start.is_dir():
        return start
    for candidate in (start, *start.parents):
        if _holds_config(candidate):
            return candidate
    return start


def studio_root(project_root: Path) -> Path | None:
    """The outer repository root, the plugin's home: $TK_STUDIO_ROOT when set;
    else the nearest ancestor-or-self of the project root holding
    plugins/tk-studio/; else None. Never PLUGIN_ROOT (a skills-dir install is
    not a checkout)."""
    env = os.environ.get("TK_STUDIO_ROOT")
    if env:
        return Path(env).resolve()
    root = Path(project_root).resolve()
    for candidate in (root, *root.parents):
        if (candidate / "plugins" / "tk-studio").is_dir():
            return candidate
    return None


def tracked_project_id(project_root: Path) -> str | None:
    """The explicit project_id in the root's tracked config, or None."""
    tracked = Path(project_root) / ".tk-studio" / TRACKED_NAME
    if not tracked.is_file():
        return None
    try:
        pid = miniyaml.load(tracked).get("project_id")
    except (miniyaml.MiniYamlError, OSError, UnicodeDecodeError):
        # unreadable or not UTF-8: no explicit id, so callers (drift_check's
        # project_info) still end with their JSON block (AD-11)
        return None
    return str(pid) if pid else None


def project_key(project_root: Path) -> str:
    """The project's one identity (AD-20): explicit project_id from tracked
    config, else the root basename — same rule as the registry."""
    root = Path(project_root).resolve()
    pid = tracked_project_id(root)
    return store.safe_name(pid if pid else root.name)


def in_project(start: Path) -> bool:
    """True when `start` sits inside (or is) an onboarded studio project."""
    return _holds_config(find_project_root(start))


def project_info(start: Path) -> dict:
    """{project_root, studio_root, nested, project_id} for `start`. `nested`
    is true when a strict ancestor of the project root also holds a
    .tk-studio/config.yaml."""
    root = find_project_root(start)
    nested = _holds_config(root) and any(_holds_config(p) for p in root.parents)
    studio = studio_root(root)
    return {"project_root": str(root),
            "studio_root": str(studio) if studio is not None else None,
            "nested": nested,
            "project_id": project_key(root)}


# ------------------------------------------------------------------ standup

_TRACKED_TEMPLATE = """\
# tk-studio project configuration — tracked, shared with the team (AD-15).
# Machine paths and credentials never land here (AD-3); per-dev values go in
# config.local.yaml (ignored). Resolution: runtime > config.local.yaml > this
# file > ~/.tk-studio/config.yaml > studio defaults shipped with the plugin.

# Stable project identity for the registry (AD-20); defaults to the repo
# basename. Required explicitly when two projects would share a basename.
{project_id_line}

# Version control this project's team-shared data binds to (AD-18): git | perforce
vcs: {vcs}

# planning:
#   # Planning backend binding (AD-4): bmad-files | backlog-md | jira.
#   # Unset, the studio default applies (backlog-md).
#   backend: backlog-md
#   # jira binding config (AD-7) — keys and ids only, team-shared. The agent
#   # seat's scoped tokens ride the environment only, never any config file
#   # (AD-3): TK_ATLASSIAN_AGENT_EMAIL, TK_ATLASSIAN_AGENT_TOKEN (Jira),
#   # TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN and TK_ATLASSIAN_CLOUD_ID, through
#   # the api.atlassian.com gateway; TK_ATLASSIAN_SITE seeds `site` on the
#   # first `plansync.py setup`. Legacy: JIRA_EMAIL (or planning.jira.email)
#   # and JIRA_API_TOKEN against the site URL when TK_ATLASSIAN_AGENT_TOKEN
#   # is unset. `plansync.py setup` records the keys and ids below.
#   jira:
#     site: myorg.atlassian.net
#     project_key: PROJ
#     project_id: "10000"
#     filter_id: "10001"
#     owner_account_id: "<owner seat accountId>"
#     agent_account_id: "<agent seat accountId>"
#   confluence:
#     space_key: PROJ
#     space_id: "98305"
#     folders:
#       brief: "98306"
#       gdd: "98307"
#       scope-of-work: "98308"
#       decisions: "98309"
#       records: "98310"

# Role-keyed working sets (AD-17) — recorded only on explicit confirmation
# by tk-studio-onboard (ST-4.3); no role's entry overwrites another's.
# working_set:
#   developer:
#     - resource-name

# Per-project job instances (AD-10, ST-6.1): a list of job ids, each naming a
# definition at .tk-studio/jobs/<id>.json (contracts/job.schema.json) or a
# generic type shipped with the plugin — always scalar refs, never inline jobs.
# jobs:
#   - maintenance-conformance
"""

_LOCAL_TEMPLATE = """\
# tk-studio per-developer overrides — NEVER on VCS (git-ignored; P4IGNORE on
# Perforce projects). Same schema as config.yaml; a key here overrides the
# tracked value (AD-15). Machine paths belong here or in the per-user store;
# credentials belong in the OS credential store or environment, never in any
# config file (AD-3).
"""

GITIGNORE_LINE = ".tk-studio/config.local.yaml"


def standup_project_config(project_root: Path, vcs: str = "git",
                           project_id: str | None = None) -> dict:
    """Create .tk-studio/config.yaml + config.local.yaml; idempotent,
    preservation-first (existing files are never touched)."""
    project_root = Path(project_root).resolve()
    if not project_root.is_dir():
        raise ConfigError(f"project root {project_root} is not a directory")
    conf_dir = project_root / ".tk-studio"
    created: list[str] = []
    guidance: list[str] = []

    tracked = conf_dir / TRACKED_NAME
    local = conf_dir / LOCAL_NAME

    if not tracked.exists():
        project_id_line = (f"project_id: {project_id}" if project_id
                           else "# project_id: my-project")
        content = _TRACKED_TEMPLATE.format(project_id_line=project_id_line, vcs=vcs)
        assert_tracked_safe(content, str(tracked))
        conf_dir.mkdir(parents=True, exist_ok=True)
        tracked.write_text(content, encoding="utf-8", newline="\n")
        created.append(TRACKED_NAME)
    if not local.exists():
        conf_dir.mkdir(parents=True, exist_ok=True)
        local.write_text(_LOCAL_TEMPLATE, encoding="utf-8", newline="\n")
        created.append(LOCAL_NAME)

    if vcs == "git":
        gitignore = project_root / ".gitignore"
        lines = (gitignore.read_text(encoding="utf-8").splitlines()
                 if gitignore.is_file() else [])
        if GITIGNORE_LINE not in lines:
            text = "\n".join(lines + [GITIGNORE_LINE]) + "\n"
            gitignore.write_text(text, encoding="utf-8", newline="\n")
            created.append(".gitignore (+ local-overlay ignore line)")
    else:
        guidance.append(P4IGNORE_GUIDANCE)

    return {"project_root": str(project_root), "created": created,
            "guidance": guidance}


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio config resolution")
    sub = parser.add_subparsers(dest="command", required=True)

    res = sub.add_parser("resolve")
    res.add_argument("--key", required=True, help="dotted path, e.g. planning.backend")
    res.add_argument("--directory", help="start folder; walks up to the nearest project root (omit for no project scopes)")
    res.add_argument("--set", dest="sets", action="append", default=[],
                     metavar="KEY=VALUE", help="runtime override (repeatable)")

    stand = sub.add_parser("standup")
    stand.add_argument("--directory", required=True, help="project root")
    stand.add_argument("--vcs", choices=["git", "perforce"], default="git")
    stand.add_argument("--project-id", help="explicit stable project identity (AD-20)")

    rootp = sub.add_parser("root")
    rootp.add_argument("--directory", default=".",
                       help="start folder; walks up to the nearest project root")

    args = parser.parse_args(argv)
    try:
        if args.command == "root":
            print(json.dumps({"ok": True, **project_info(Path(args.directory))},
                             ensure_ascii=False, indent=2))
        elif args.command == "resolve":
            runtime = _parse_runtime_sets(args.sets)
            root = (find_project_root(Path(args.directory))
                    if args.directory else None)
            value, scope = resolve(args.key, project_root=root, runtime=runtime)
            print(json.dumps({"ok": True, "key": args.key, "value": value,
                              "scope": scope}, ensure_ascii=False))
        else:
            result = standup_project_config(Path(args.directory), vcs=args.vcs,
                                            project_id=args.project_id)
            print(json.dumps({"ok": True, "mutated": bool(result["created"]),
                              **result}, ensure_ascii=False, indent=2))
        return 0
    except (ConfigError, ClassificationError, miniyaml.MiniYamlError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
