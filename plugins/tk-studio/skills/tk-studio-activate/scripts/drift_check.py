"""tk-studio-activate — four-plane health/drift check (AD-13). Read-only, loud.

Planes checked:
  bmad-base  installed _bmad/_config/manifest.yaml versions vs the bmad.lock pins,
             plus the studio's declared base patches (lib/basepatch.py) in place
  plugin     installed plugin.json version vs the repo marketplace.json entry
             (catalog lockstep), when a marketplace catalog is present — plus
             the release-discipline guard: skills/ vs released-roster.json,
             the version gate's third file (ST-048) — plus
             harness loadability: the harness's own install record
             (installed_plugins.json) must hold the plugin at the repo version,
             or headless /tk-studio:<skill> is 'Unknown command' while the
             repo looks healthy (AD-13) — plus the installer roster guard
             (AD-21): the project's tools/installer/rosters/{stable,latest}.json,
             when present, must be in shape, and latest.json's plugin entry at
             the gate (gate x4 — stable trails latest by PR, shape only)
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
import re
import sys
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import basepatch  # noqa: E402
import bmadlock  # noqa: E402
import ledger  # noqa: E402
import registry  # noqa: E402
import store  # noqa: E402
import vault  # noqa: E402

FIX_BMAD = "run tk-studio-install (tk install) to reinstall the base at the pin"
FIX_PATCH_STALE = ("re-verify the base patch's upstream issue: retire the patch if it is "
                   "fixed at the pin, else re-pin its find text and applies_to_core "
                   "(plugins/tk-studio/base-patches/patches.json)")
FIX_PLUGIN = "run /plugin marketplace update tk-studio, then reinstall/update the tk-studio plugin"
FIX_HARNESS = ("install the plugin into the harness (AD-1 flow): claude plugin "
               "marketplace add <studio repo>, then claude plugin install tk-studio")
FIX_STORE = "run the store standup: uv run <plugin>/lib/store.py standup (idempotent, ST-2.1)"
FIX_RELEASE = ("run the release motion: bump plugin.json, marketplace.json, and "
               "released-roster.json in lockstep (version gate + skill roster together)")
FIX_INSTALLER_ROSTER = ("run the release motion: uv run tools/release_archive.py "
                        "run --app plugin (records the roster's plugin entry in lockstep "
                        "with released-roster.json); uv/bun pins are read from the "
                        "upstream release, never invented")


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
        return plane
    plane["detail"] = f"{len(pins)} components at pin (core {pins['core']})"
    try:
        rows = basepatch.check(directory, pins["core"])
    except basepatch.PatchError as exc:
        plane.update(status="error", detail=f"{plane['detail']}; {exc}")
        return plane
    bad = [r for r in rows if r["status"] not in basepatch.GOOD]
    if not bad:
        applied = [r for r in rows if r["status"] in ("applied", "patched")]
        if applied:
            plane["detail"] += f"; {len(applied)} base patch(es) applied"
        return plane
    stale = [r for r in bad if r["status"] in ("stale", "unverified-core")]
    plane.update(status="drift",
                 detail=plane["detail"] + "; " + "; ".join(
                     f"base patch {r['id']} {r['status']} ({r['upstream_issue']})" for r in bad),
                 fix=FIX_PATCH_STALE if stale else FIX_BMAD)
    return plane


def _harness_loadability(name: str, version: str,
                         claude_home: Path | None = None,
                         directory: Path | None = None) -> dict:
    """AD-13: catalog lockstep proves the repo and marketplace agree; it says
    nothing about whether the harness can load the plugin at all. An absent
    installed_plugins.json entry means every headless /tk-studio:<skill>
    invocation is 'Unknown command' while the repo looks healthy.

    The record is an externally-owned file — only its v2 shape
    ({"plugins": {"<name>@<marketplace>": [entries]}}) is understood; any
    other shape is an error, never a crash. The comparison baseline is the
    plugin.json of the copy running this script, so a harness-cache
    invocation compares against itself and only a studio-repo checkout can
    surface staleness."""
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
    plugins = data.get("plugins") if isinstance(data, dict) else None
    if not isinstance(plugins, dict) or not all(
            isinstance(lst, list) and all(isinstance(e, dict) for e in lst)
            for lst in plugins.values()):
        return {"status": "error",
                "detail": (f"harness install record {record} is not the v2 "
                           "shape this probe understands — cannot judge "
                           "loadability")}
    matched = {key: lst for key, lst in plugins.items()
               if key == name or key.startswith(f"{name}@")}
    entries = [e for lst in matched.values() for e in lst]
    # only entries loadable from the checked project count: user scope
    # (or unscoped) always, project scope only for this directory
    def _loadable_here(e: dict) -> bool:
        if e.get("scope", "user") != "project":
            return True
        project = e.get("projectPath")
        return bool(project and directory
                    and Path(project).resolve() == Path(directory).resolve())
    entries = [e for e in entries if _loadable_here(e)]
    if not entries:
        return {"status": "drift",
                "detail": (f"plugin not installed in the harness ({record.name} "
                           f"has no {name} entry loadable from this project — "
                           f"headless /{name}:<skill> is 'Unknown command')"),
                "fix": FIX_HARNESS}
    at_version = [e for e in entries if e.get("version") == version]
    if not at_version:
        held = ", ".join(sorted({"v" + str(e.get("version"))
                                 for e in entries}))
        return {"status": "drift",
                "detail": (f"harness holds {held}, repo plugin is v{version} "
                           "(harness and repo out of step)"),
                "fix": FIX_PLUGIN}
    if not any(e.get("installPath") and Path(e["installPath"]).is_dir()
               for e in at_version):
        markets = [key.split("@", 1)[1] for key in matched if "@" in key]
        served = _directory_source_serves(name, version, home, markets)
        if served:
            return {"status": "ok", "detail": served}
        return {"status": "drift",
                "detail": (f"harness entry v{version} installPath missing "
                           "(cache evicted)"),
                "fix": FIX_PLUGIN}
    return {"status": "ok", "detail": f"harness-loadable (v{version} installed)"}


def _released_roster_check(plugin_root: Path, version: str) -> dict:
    """ST-048 release-discipline guard: the skill roster must never outrun
    the version gate. released-roster.json is the gate's third file — the
    skill list delivered at the recorded version, bumped in lockstep with
    plugin.json and marketplace.json by the release motion. A repo whose
    skills/ disagrees with the record at an unchanged version is exactly the
    EP-012 gap (shipped surfaces the installed plugin never delivered)."""
    record_path = plugin_root / ".claude-plugin" / "released-roster.json"
    if not record_path.is_file():
        return {"status": "drift",
                "detail": ("released-roster.json missing — the version "
                           "gate's third file (skill roster unguarded)"),
                "fix": FIX_RELEASE}
    try:
        record = json.loads(record_path.read_text(encoding="utf-8"))
        recorded_version = record["version"]
        recorded = set(record["skills"])
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        return {"status": "error",
                "detail": f"released-roster.json unreadable: {exc}"}
    skills_dir = plugin_root / "skills"
    actual = {p.name for p in skills_dir.iterdir()
              if p.is_dir() and (p / "SKILL.md").is_file()} \
        if skills_dir.is_dir() else set()
    if recorded_version != version:
        return {"status": "drift",
                "detail": (f"released-roster.json records v{recorded_version} "
                           f"but the version gate is v{version} (gate's third "
                           "file out of lockstep)"),
                "fix": FIX_RELEASE}
    if actual != recorded:
        grew = ", ".join(f"+{s}" for s in sorted(actual - recorded))
        shrank = ", ".join(f"-{s}" for s in sorted(recorded - actual))
        delta = ", ".join(x for x in (grew, shrank) if x)
        return {"status": "drift",
                "detail": (f"skill roster outran the version gate: {delta} at "
                           f"unchanged v{version} (the EP-012 gap shape — "
                           "shipped surfaces the gate never delivered)"),
                "fix": FIX_RELEASE}
    return {"status": "ok",
            "detail": f"released roster {len(recorded)} skills at the gate"}


# --- installer roster guard (AD-21, Story 25.1) ----------------------------
# One pure validator for tools/installer/rosters/<channel>.json, shared by
# the lib suite and the plugin plane. Every component is optional per
# channel (absent = "not shipped in this channel"); a present entry must be
# complete, real and well-formed — never a placeholder.

ROSTER_SCHEMA = 1
ROSTER_CHANNELS = ("stable", "latest")
RELEASE_COMPONENTS = {"plugin": "tk-studio--v", "supervisor": "supervisor--v",
                      "studio-web": "studio-web--v", "cli": "cli--v"}
TOOL_COMPONENTS = ("uv", "bun")
REQUIRED_TOOL_TARGET = "x86_64-pc-windows-msvc"
_HEX64 = re.compile(r"[0-9a-f]{64}")
_SEMVER = re.compile(r"\d+\.\d+\.\d+")
_FLOOR = re.compile(r">=\d+\.\d+\.\d+")
_RELEASE_URL = re.compile(
    r"https://github\.com/([^/]+)/([^/]+)/releases/download/([^/]+)/([^/]+)")
_PLACEHOLDER_WORDS = ("tbd", "placeholder", "pending")


def _is_placeholder_text(value: str) -> bool:
    low = value.lower()
    return any(w in low for w in _PLACEHOLDER_WORDS) or "<" in value or ">" in value


def _digest_problem(where: str, value) -> str | None:
    if not isinstance(value, str) or not _HEX64.fullmatch(value):
        return f"{where}: not a 64-lowercase-hex sha256 ({value!r})"
    if len(set(value)) == 1:
        return f"{where}: placeholder digest ({value[:8]}...), never a real value"
    return None


def _url_repo(url) -> str | None:
    m = _RELEASE_URL.fullmatch(url) if isinstance(url, str) else None
    return f"{m.group(1)}/{m.group(2)}" if m else None


def roster_problems(roster, *, released_archive: dict | None = None,
                    plugin_version: str | None = None) -> list[str]:
    """Shape problems in an installer roster, [] when well-formed. Each
    problem names the component and field. ``released_archive`` (the
    released-roster.json ``archive`` record) and ``plugin_version`` (the
    plugin.json version) turn on gate x4 for a present ``plugin`` entry;
    None skips that comparison. The ``plugin`` entry's URL repository is
    the roster's home: any other repository must be named in ``source``."""
    if not isinstance(roster, dict):
        return ["roster: not a JSON object"]
    problems: list[str] = []
    if "schema" not in roster:
        problems.append("schema: missing")
    elif roster["schema"] != ROSTER_SCHEMA:
        problems.append(f"schema: unsupported {roster['schema']!r} "
                        f"(expected {ROSTER_SCHEMA})")
    if "channel" not in roster:
        problems.append("channel: missing")
    elif roster["channel"] not in ROSTER_CHANNELS:
        problems.append(f"channel: {roster['channel']!r} is not one of "
                        f"{', '.join(ROSTER_CHANNELS)}")
    requires = roster.get("requires")
    if not isinstance(requires, dict):
        problems.append("requires: missing (needs requires.claude-code)")
    elif "claude-code" not in requires:
        problems.append("requires.claude-code: missing")
    elif not (isinstance(requires["claude-code"], str)
              and _FLOOR.fullmatch(requires["claude-code"])):
        problems.append(f"requires.claude-code: not a >=X.Y.Z version floor "
                        f"({requires['claude-code']!r})")
    components = roster.get("components")
    if not isinstance(components, dict):
        problems.append("components: missing")
        return problems

    plugin = components.get("plugin")
    home = _url_repo(plugin.get("url")) if isinstance(plugin, dict) else None
    for name, entry in components.items():
        where = f"components.{name}"
        if name in RELEASE_COMPONENTS:
            problems.extend(_release_entry_problems(
                where, RELEASE_COMPONENTS[name], entry, home))
        elif name in TOOL_COMPONENTS:
            problems.extend(_tool_entry_problems(where, entry))
        else:
            problems.append(f"{where}: unknown component")

    if isinstance(plugin, dict):
        if plugin_version is not None \
                and plugin.get("tag") != f"tk-studio--v{plugin_version}":
            problems.append(
                f"components.plugin.tag: {plugin.get('tag')!r} is not the gate's "
                f"tk-studio--v{plugin_version} (plugin.json) — gate x4 broken")
        if released_archive is not None:
            for field in ("url", "sha256"):
                if plugin.get(field) != released_archive.get(field):
                    problems.append(
                        f"components.plugin.{field}: {plugin.get(field)!r} does "
                        f"not match released-roster.json archive.{field} "
                        f"{released_archive.get(field)!r} — gate x4 broken")
    return problems


def _release_entry_problems(where: str, prefix: str, entry,
                            home: str | None) -> list[str]:
    if not isinstance(entry, dict):
        return [f"{where}: not an object {{tag, url, sha256}}"]
    problems = [f"{where}.{field}: missing" for field in ("tag", "url", "sha256")
                if field not in entry]
    for field in ("tag", "url", "source"):
        value = entry.get(field)
        if isinstance(value, str) and _is_placeholder_text(value):
            problems.append(f"{where}.{field}: placeholder value {value!r}")
    if "sha256" in entry:
        bad = _digest_problem(f"{where}.sha256", entry["sha256"])
        if bad:
            problems.append(bad)
    tag = entry.get("tag")
    if "tag" in entry and not (isinstance(tag, str) and tag.startswith(prefix)
                               and _SEMVER.fullmatch(tag[len(prefix):])):
        problems.append(f"{where}.tag: {tag!r} is not {prefix}X.Y.Z")
    if "url" in entry:
        url = entry["url"]
        m = _RELEASE_URL.fullmatch(url) if isinstance(url, str) else None
        if not m:
            problems.append(f"{where}.url: {url!r} is not https://github.com/"
                            "<owner>/<repo>/releases/download/<tag>/<asset>")
        elif m.group(3) != tag:
            problems.append(f"{where}.url: names tag {m.group(3)!r}, "
                            f"entry tag is {tag!r}")
        else:
            repo = f"{m.group(1)}/{m.group(2)}"
            source = entry.get("source")
            if source is not None and source != repo:
                problems.append(f"{where}.source: {source!r} does not match "
                                f"its URL's repository {repo!r}")
            elif source is None and home is not None and repo != home:
                problems.append(f"{where}.source: URL is on {repo}, not the "
                                f"roster's home {home} — name it in source")
    return problems


def _tool_entry_problems(where: str, entry) -> list[str]:
    if not isinstance(entry, dict):
        return [f"{where}: not an object {{version, sha256: {{target: hex}}}}"]
    problems: list[str] = []
    version = entry.get("version")
    if "version" not in entry:
        problems.append(f"{where}.version: missing")
    elif isinstance(version, str) and _is_placeholder_text(version):
        problems.append(f"{where}.version: placeholder value {version!r}")
    elif not (isinstance(version, str) and _SEMVER.fullmatch(version)):
        problems.append(f"{where}.version: {version!r} is not X.Y.Z")
    digests = entry.get("sha256")
    if not isinstance(digests, dict) or not digests:
        problems.append(f"{where}.sha256: not a non-empty "
                        "{<platform target>: <hex>} map")
        return problems
    if REQUIRED_TOOL_TARGET not in digests:
        problems.append(f"{where}.sha256: no {REQUIRED_TOOL_TARGET} digest "
                        "(Windows x64 is required)")
    for target, value in digests.items():
        bad = _digest_problem(f"{where}.sha256.{target}", value)
        if bad:
            problems.append(bad)
    return problems


def _installer_roster_check(directory: Path, plugin_root: Path,
                            version: str) -> dict:
    """AD-21 sealing: the rosters are read from the checked project
    directory, never relative to the plugin root (a skills-dir install
    carries no tools/). Absent roster = not checkable, ok. Gate x4 binds
    latest.json only — the channel the release motion writes; stable.json
    trails it by PR and is checked for shape only. Story 25.3 wires the
    configured channel."""
    rosters_dir = directory / "tools" / "installer" / "rosters"
    paths = {"stable": rosters_dir / "stable.json",
             "latest": rosters_dir / "latest.json"}
    if not any(p.is_file() for p in paths.values()):
        return {"status": "ok",
                "detail": (f"no installer roster at {rosters_dir} — roster not "
                           "checkable from this project")}
    rosters: dict = {}
    for channel, path in paths.items():
        if not path.is_file():
            continue
        try:
            rosters[channel] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            return {"status": "error",
                    "detail": f"installer roster {path} unreadable: {exc}"}
    try:
        record = json.loads((plugin_root / ".claude-plugin" / "released-roster.json")
                            .read_text(encoding="utf-8"))
        archive = record.get("archive") if isinstance(record, dict) else None
    except (OSError, json.JSONDecodeError):
        archive = None
    if not isinstance(archive, dict):
        # no archive record to compare against: _released_roster_check and
        # the archive-record pin report the record itself
        archive = None

    problems: list[str] = []
    notes: list[str] = []
    if "stable" in rosters:
        problems += [f"installer roster stable.json: {p}"
                     for p in roster_problems(rosters["stable"])]
        notes.append("stable.json in shape")
    else:
        notes.append(f"no {paths['stable']} — stable roster not checkable "
                     "from this project")
    if "latest" in rosters:
        problems += [f"installer roster latest.json: {p}"
                     for p in roster_problems(rosters["latest"],
                                              released_archive=archive,
                                              plugin_version=version)]
        notes.append("latest.json in shape, plugin entry at the gate (gate x4)")
    else:
        notes.append(f"no {paths['latest']} — gate x4 not checkable from "
                     "this project")
    if problems:
        return {"status": "drift", "detail": "; ".join(problems),
                "fix": FIX_INSTALLER_ROSTER}
    shipped = "; ".join(
        f"{ch}: {', '.join(sorted(r['components'])) or 'none'}"
        for ch, r in rosters.items())
    return {"status": "ok",
            "detail": f"installer roster {', '.join(notes)} (components {shipped})"}


def _directory_source_serves(name: str, version: str, home: Path,
                             marketplaces: list[str]) -> str | None:
    """A dangling installPath is not drift when the harness serves the plugin
    straight from a directory-source marketplace carrying it at the checked
    version — the 2.1.201 marketplace-update path records a cache path it
    never materializes while every skill loads from the source directory
    (PROP-017, studio-side half). A genuine eviction — no directory source,
    or the source no longer at this version — still drifts. Every record
    read here is externally owned: unreadable or unexpected shapes mean the
    fallback simply does not apply, never an error."""
    record = home / "plugins" / "known_marketplaces.json"
    try:
        known = json.loads(record.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(known, dict):
        return None
    for market in marketplaces:
        entry = known.get(market)
        if not isinstance(entry, dict):
            continue
        source = entry.get("source")
        if not isinstance(source, dict) or source.get("source") != "directory":
            continue
        root = source.get("path")
        if not root:
            continue
        catalog = Path(root) / ".claude-plugin" / "marketplace.json"
        try:
            market_doc = json.loads(catalog.read_text(encoding="utf-8"))
            plug = next(p for p in market_doc["plugins"]
                        if isinstance(p, dict) and p.get("name") == name)
            plugin_dir = Path(root) / plug["source"]
            manifest = json.loads(
                (plugin_dir / ".claude-plugin" / "plugin.json")
                .read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, TypeError, KeyError,
                StopIteration):
            continue
        if manifest.get("version") == version:
            return (f"harness-loadable (v{version} served from "
                    f"directory-source marketplace {market}; recorded "
                    "installPath unmaterialized)")
    return None


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
            # a broken catalog is an error but not a reason to skip the
            # harness probe — the two concerns are independent
            plane.update(status="error",
                         detail=f"marketplace catalog unreadable or missing entry: {exc}")
        else:
            if entry.get("version") != installed.get("version"):
                plane.update(
                    status="drift",
                    detail=(f"installed plugin v{installed.get('version')} vs marketplace "
                            f"catalog v{entry.get('version')} (lockstep broken)"),
                    fix=FIX_PLUGIN,
                )
            else:
                plane["detail"] = f"plugin v{installed.get('version')} in lockstep with catalog"

    for sub in (
        _released_roster_check(PLUGIN_ROOT, installed.get("version")),
        _installer_roster_check(directory, PLUGIN_ROOT, installed.get("version")),
        _harness_loadability(installed.get("name"), installed.get("version"),
                             claude_home, directory),
    ):
        if _STATUS_RANK[sub["status"]] > _STATUS_RANK[plane["status"]]:
            plane["status"] = sub["status"]
        plane["detail"] = "; ".join(x for x in (plane["detail"], sub["detail"]) if x)
        if sub.get("fix"):
            plane["fix"] = "; ".join(x for x in (plane.get("fix"), sub["fix"]) if x)
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
