"""tk-studio-activate — four-plane health/drift check (AD-13). Read-only, loud.

Planes checked:
  bmad-base  installed _bmad/_config/manifest.yaml versions vs the bmad.lock pins,
             plus the studio's declared base patches (lib/basepatch.py) in place
  plugin     the skills-dir plugin folder (AD-21): <home>/skills/tk-studio/
             (<home> = --claude-home, else CLAUDE_CONFIG_DIR, else ~/.claude),
             its .claude-plugin/plugin.json version vs the configured channel's
             roster plugin entry (--channel, default stable; the project's
             tools/installer/rosters/<channel>.json) and, in a developer
             checkout only (a repo marketplace.json listing tk-studio; one
             that does not is skipped), that entry. One case is named
             (field `case`): ok | stale (tk-studio update, plus --channel
             off the default) | missing
             (tk-studio install) | shadowed (a marketplace copy is installed;
             the fix names each uninstall). installed_plugins.json is read only
             to detect marketplace copies, never for a version or loadability —
             plus the release-discipline guard: skills/ vs released-roster.json,
             the version gate's third file (ST-048) — plus the installer roster
             guard (AD-21): the project's tools/installer/rosters/
             {stable,latest}.json, when present, must be in shape, and
             latest.json's plugin entry at the gate (gate x4 — stable trails
             latest by PR, shape only)
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
  uv run drift_check.py [--directory DIR] [--guided] [--lock PATH] [--marketplace PATH]
                        [--claude-home DIR] [--channel {stable,latest}]

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
FIX_UPDATE = ("run tk-studio update (the installer rewrites the skills-dir "
              "plugin folder at the roster's plugin version)")
FIX_INSTALL = ("run tk-studio install (the installer writes the skills-dir "
               "plugin folder <home>/skills/tk-studio/)")
FIX_SHADOWED = "remove the marketplace copy shadowing the skills-dir folder"
FIX_STORE = "run the store standup: uv run <plugin>/lib/store.py standup (idempotent, ST-2.1)"
FIX_RELEASE = ("run the release motion: bump plugin.json, marketplace.json, and "
               "released-roster.json in lockstep (version gate + skill roster together)")
FIX_INSTALLER_ROSTER = ("run the release motion: uv run tools/release_archive.py "
                        "run --app plugin (records the roster's plugin entry in lockstep "
                        "with released-roster.json); uv/bun pins are read from the "
                        "upstream release, never invented; stable.json trails "
                        "latest.json and is repaired by a promotion PR")


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
# Moved verbatim to lib/roster_guard.py (Story 25.4) so the sealed meta-CLI
# wheel can ship a byte-identical copy; re-exported here so callers of
# drift_check.roster_problems (release_archive.py, the lib suite) still work.
from roster_guard import (  # noqa: E402,F401
    REQUIRED_TOOL_TARGET, RELEASE_COMPONENTS, ROSTER_CHANNELS, ROSTER_SCHEMA,
    TOOL_COMPONENTS, _FLOOR, _HEX64, _PLACEHOLDER_WORDS, _RELEASE_URL, _SEMVER,
    _digest_problem, _is_placeholder_text, _release_entry_problems,
    _tool_entry_problems, _url_repo, roster_problems)


def _installer_roster_check(directory: Path, plugin_root: Path,
                            version: str) -> dict:
    """AD-21 sealing: the rosters are read from the checked project
    directory, never relative to the plugin root (a skills-dir install
    carries no tools/). Absent roster = not checkable, ok. Gate x4 binds
    latest.json only — the channel the release motion writes; stable.json
    trails it by PR and is checked for shape only. The configured channel's
    version comparison is the folder check's (_skills_dir_check, Story 25.3),
    never this guard's."""
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
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            return {"status": "error",
                    "detail": f"installer roster {path} unreadable: {exc}"}
    try:
        record = json.loads((plugin_root / ".claude-plugin" / "released-roster.json")
                            .read_text(encoding="utf-8"))
        archive = record.get("archive") if isinstance(record, dict) else None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        archive = None
    if not isinstance(archive, dict):
        # no archive record to compare against: _released_roster_check and
        # the archive-record pin report the record itself
        archive = None

    def stem_problems(channel: str) -> list[str]:
        # roster_problems stays stem-agnostic; the file stem is the plane's
        # knowledge. An out-of-set channel is already named by the guard.
        declared = rosters[channel].get("channel") \
            if isinstance(rosters[channel], dict) else None
        if declared in ROSTER_CHANNELS and declared != channel:
            return [f"channel: {declared!r} is not the file stem {channel!r}"]
        return []

    problems: list[str] = []
    notes: list[str] = []
    if "stable" in rosters:
        problems += [f"installer roster stable.json: {p}"
                     for p in roster_problems(rosters["stable"])
                     + stem_problems("stable")]
        notes.append("stable.json in shape")
    else:
        notes.append(f"no {paths['stable']} — stable roster not checkable "
                     "from this project")
    if "latest" in rosters:
        latest = rosters["latest"]
        problems += [f"installer roster latest.json: {p}"
                     for p in roster_problems(latest,
                                              released_archive=archive,
                                              plugin_version=version)
                     + stem_problems("latest")]
        components = latest.get("components") if isinstance(latest, dict) else None
        if not (isinstance(components, dict) and "plugin" in components):
            notes.append("latest.json in shape, no plugin entry (gate x4 not "
                         "applicable)")
        elif archive is None:
            notes.append("latest.json in shape, plugin entry at the gate tag "
                         "(gate x4; url/sha256 comparison skipped — no "
                         "released-roster.json archive record)")
        else:
            notes.append("latest.json in shape, plugin entry at the gate "
                         "(gate x4)")
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


# --- skills-dir folder vs roster (AD-21, Story 25.3) -------------------------
# The plugin is the installer-written folder <home>/skills/tk-studio/, which
# Claude Code loads in place as tk-studio@skills-dir. The folder's own
# plugin.json is the installed version; the configured channel's roster
# (read from the checked project, never the network) is the expected one.
# Marketplace records are read only to find a same-named copy shadowing the
# folder — the exact read set of the installer's marketplace_cleanup
# (tools/installer/cli/tk_studio_cli/plugin_leg.py), mirrored, never imported
# (the plugin is sealed).

SKILLS_DIR_PLUGIN = "tk-studio"
SKILLS_DIR_SUFFIX = "@skills-dir"
INSTALLER_SIBLINGS = (".tk-studio.new", ".tk-studio.previous",
                      ".tk-studio.retired")
DEFAULT_CHANNEL = "stable"
_CASE_STATUS = {"ok": "ok", "stale": "drift", "shadowed": "drift",
                "missing": "missing"}
_CASE_ORDER = ("missing", "shadowed", "stale", "ok")


def _claude_home(claude_home: Path | None) -> Path:
    return claude_home or Path(os.environ.get("CLAUDE_CONFIG_DIR")
                               or Path.home() / ".claude")


def _read_json_file(path: Path) -> tuple[object, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return None, f"{type(exc).__name__}: {exc}"


def _is_ours(key) -> bool:
    return isinstance(key, str) and key.split("@", 1)[0] == SKILLS_DIR_PLUGIN


def _marketplace_copies(home: Path) -> tuple[list[str], bool, list[str]]:
    """(copy keys to uninstall, marketplace named, unreadable-file errors).
    Reads what marketplace_cleanup reads and nothing more: user-scope
    tk-studio@<m> records in plugins/installed_plugins.json (never
    @skills-dir — the folder itself), enabledPlugins keys in settings.json,
    and the tk-studio marketplace in known_marketplaces.json or
    extraKnownMarketplaces. No version is ever taken from these."""
    copies: set[str] = set()
    named = False
    errors: list[str] = []
    record = home / "plugins" / "installed_plugins.json"
    if record.is_file():
        data, err = _read_json_file(record)
        plugins = data.get("plugins") if isinstance(data, dict) else None
        if err or not isinstance(plugins, dict):
            errors.append(f"{record} unreadable "
                          f"({err or 'no plugins object'})")
        else:
            for key, entries in plugins.items():
                if not _is_ours(key) or key.endswith(SKILLS_DIR_SUFFIX) \
                        or not isinstance(entries, list):
                    continue
                if any(isinstance(e, dict) and e.get("scope") == "user"
                       for e in entries):
                    copies.add(key)
    known_file = home / "plugins" / "known_marketplaces.json"
    if known_file.is_file():
        known, err = _read_json_file(known_file)
        if err or not isinstance(known, dict):
            errors.append(f"{known_file} unreadable "
                          f"({err or 'not a JSON object'})")
        elif SKILLS_DIR_PLUGIN in known:
            named = True
    settings_file = home / "settings.json"
    if settings_file.is_file():
        settings, err = _read_json_file(settings_file)
        if err or not isinstance(settings, dict):
            errors.append(f"{settings_file} unreadable "
                          f"({err or 'not a JSON object'})")
        else:
            extra = settings.get("extraKnownMarketplaces")
            if isinstance(extra, dict) and SKILLS_DIR_PLUGIN in extra:
                named = True
            enabled = settings.get("enabledPlugins")
            if isinstance(enabled, dict):
                copies.update(k for k in enabled if _is_ours(k)
                              and not k.endswith(SKILLS_DIR_SUFFIX))
    return sorted(copies), named, errors


def _roster_plugin_version(directory: Path, channel: str
                           ) -> tuple[str | None, str]:
    """(expected version or None, note). The roster is the checked
    project's tools/installer/rosters/<channel>.json; the channel is the
    file's stem. Shape problems are the installer roster guard's to report,
    so an unusable roster only notes that it could not be compared."""
    path = directory / "tools" / "installer" / "rosters" / f"{channel}.json"
    if not path.is_file():
        return None, (f"no {channel} roster at {path} — roster version not "
                      "checkable from this project")
    roster, err = _read_json_file(path)
    components = roster.get("components") if isinstance(roster, dict) else None
    if err or not isinstance(components, dict):
        return None, (f"{channel} roster {path.name} not comparable "
                      "(see the installer roster guard)")
    entry = components.get("plugin")
    if entry is None:
        return None, (f"{channel} roster has no plugin entry — not shipped "
                      "in this channel")
    tag = entry.get("tag") if isinstance(entry, dict) else None
    prefix = RELEASE_COMPONENTS["plugin"]
    if not (isinstance(tag, str) and tag.startswith(prefix)
            and _SEMVER.fullmatch(tag[len(prefix):])):
        return None, (f"{channel} roster plugin tag {tag!r} not comparable "
                      "(see the installer roster guard)")
    return tag[len(prefix):], f"{channel} roster {tag}"


def _skills_dir_check(directory: Path, marketplace_path: Path | None,
                      claude_home: Path | None,
                      channel: str = DEFAULT_CHANNEL) -> dict:
    """The folder-and-roster sub-check: one case of ok | stale | missing |
    shadowed (precedence missing > shadowed > stale > ok); the detail names
    every condition found. An unreadable folder plugin.json, record file or
    developer catalog is error, naming the file, and carries no case."""
    home = _claude_home(claude_home)
    skills = home / "skills"
    folder = skills / SKILLS_DIR_PLUGIN
    found: dict[str, list[str]] = {c: [] for c in _CASE_ORDER}
    fixes: dict[str, str] = {}
    errors: list[str] = []
    notes: list[str] = []
    version = None

    # a live link or junction counts as the folder; a dangling one does not,
    # nor does a regular file (or a link to one) at that path
    if not folder.is_dir():
        if not os.path.lexists(folder):
            what = f"no skills-dir plugin folder at {folder}"
        elif not folder.exists():
            what = f"dangling link at {folder} (its target is gone)"
        else:
            what = f"skills-dir plugin path {folder} is not a directory"
        siblings = [n for n in INSTALLER_SIBLINGS if (skills / n).exists()]
        if siblings:
            what += (f"; installer sibling(s) found: {', '.join(siblings)} "
                     "(never the plugin)")
        found["missing"].append(what)
        fixes["missing"] = FIX_INSTALL
    else:
        manifest = folder / ".claude-plugin" / "plugin.json"
        if not manifest.is_file():
            found["missing"].append(
                f"skills-dir folder {folder} has no .claude-plugin/plugin.json")
            fixes["missing"] = FIX_INSTALL
        else:
            data, err = _read_json_file(manifest)
            version = data.get("version") if isinstance(data, dict) else None
            if err or not isinstance(version, str):
                errors.append(f"skills-dir plugin.json {manifest} unreadable "
                              f"({err or 'no version'})")
            else:
                notes.append(f"skills-dir plugin v{version} at {folder}")

    if version is not None:
        expected, note = _roster_plugin_version(directory, channel)
        if expected is not None and expected != version:
            found["stale"].append(f"folder v{version} vs {note} "
                                  f"(channel {channel})")
        else:
            notes.append(note + (f" (channel {channel})" if expected else ""))
    # the developer catalog is validated whenever it is present, even with
    # no folder version to compare: an unreadable catalog is error, never
    # hidden behind a missing folder. A catalog that lists no tk-studio
    # entry is another project's own marketplace, not a developer checkout:
    # the comparison is skipped, never error (as a roster with no plugin
    # entry is never stale)
    catalog = marketplace_path or (directory / ".claude-plugin"
                                   / "marketplace.json")
    if catalog.is_file():
        market, err = _read_json_file(catalog)
        listed = market.get("plugins") if isinstance(market, dict) else None
        entry = next((p for p in listed if isinstance(p, dict)
                      and p.get("name") == SKILLS_DIR_PLUGIN), None) \
            if isinstance(listed, list) else None
        if not isinstance(listed, list):
            errors.append(f"marketplace catalog {catalog} unreadable "
                          f"({err or 'no plugins list'})")
        elif entry is None:
            notes.append(f"marketplace catalog {catalog} has no "
                         f"{SKILLS_DIR_PLUGIN} entry — not a {SKILLS_DIR_PLUGIN}"
                         " developer checkout, catalog comparison skipped")
        elif not isinstance(entry.get("version"), str):
            errors.append(f"marketplace catalog {catalog} unreadable: its "
                          f"{SKILLS_DIR_PLUGIN} entry carries no string "
                          f"version ({entry.get('version')!r})")
        elif version is None:
            pass   # nothing to compare: the folder's own condition is named
        elif entry["version"] != version:
            found["stale"].append(
                f"folder v{version} vs developer catalog "
                f"v{entry['version']} ({catalog})")
        else:
            notes.append(f"in lockstep with the developer catalog "
                         f"v{version}")
    if found["stale"]:
        # the installer's update defaults to stable: off the default the
        # fix must name the channel, or it reinstalls the wrong roster
        fixes["stale"] = FIX_UPDATE if channel == DEFAULT_CHANNEL else (
            f"run tk-studio update --channel {channel} (the installer "
            f"rewrites the skills-dir plugin folder at the {channel} "
            "roster's plugin version)")

    copies, named, unreadable = _marketplace_copies(home)
    errors += unreadable
    if copies:
        found["shadowed"].append(
            "marketplace copy installed beside the folder: "
            + ", ".join(copies))
        commands = [f"claude plugin uninstall {k} --scope user" for k in copies]
        if named:
            commands.append(f"claude plugin marketplace remove "
                            f"{SKILLS_DIR_PLUGIN}")
        fixes["shadowed"] = f"{FIX_SHADOWED}: " + "; ".join(commands)

    conditions = [d for c in _CASE_ORDER for d in found[c]]
    fix = "; ".join(fixes[c] for c in _CASE_ORDER if c in fixes)
    if errors:
        out = {"status": "error",
               "detail": "; ".join(errors + conditions + notes)}
        if fix:
            out["fix"] = fix
        return out
    case = next((c for c in _CASE_ORDER if found[c]), "ok")
    out = {"status": _CASE_STATUS[case], "case": case,
           "detail": "; ".join(conditions + notes)}
    if fix:
        out["fix"] = fix
    return out


_STATUS_RANK = {"ok": 0, "drift": 1, "missing": 1, "error": 2}


def check_plugin(directory: Path, marketplace_path: Path | None,
                 claude_home: Path | None = None,
                 channel: str = DEFAULT_CHANNEL) -> dict:
    plane = {"plane": "plugin", "status": "ok", "detail": ""}
    plugin_json = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"
    try:
        running = json.loads(plugin_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        plane.update(status="error", detail=f"plugin.json of this copy unreadable: {exc}")
        return plane

    folder = _skills_dir_check(directory, marketplace_path, claude_home,
                               channel)
    if "case" in folder:
        plane["case"] = folder["case"]
    # the folder sub-check runs first, so its missing outranks an equal-rank
    # drift from the release guards that follow
    for sub in (
        folder,
        _released_roster_check(PLUGIN_ROOT, running.get("version")),
        _installer_roster_check(directory, PLUGIN_ROOT, running.get("version")),
    ):
        if _STATUS_RANK[sub["status"]] > _STATUS_RANK[plane["status"]]:
            plane["status"] = sub["status"]
        plane["detail"] = "; ".join(x for x in (plane["detail"], sub["detail"]) if x)
        if sub.get("fix"):
            plane["fix"] = "; ".join(x for x in (plane.get("fix"), sub["fix"]) if x)
    # `case` is the folder-and-roster verdict alone: the release guards may
    # raise `status` past it without changing it, but an `error` plane
    # carries no case (driver contract §6)
    if plane["status"] == "error":
        plane.pop("case", None)
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
                             "CLAUDE_CONFIG_DIR or ~/.claude); the plugin "
                             "plane reads <home>/skills/tk-studio/")
    parser.add_argument("--channel", choices=ROSTER_CHANNELS,
                        default=DEFAULT_CHANNEL,
                        help="installer channel whose roster plugin entry the "
                             "skills-dir folder is compared with (default "
                             "stable, the installer's default)")
    args = parser.parse_args(argv)

    directory = Path(args.directory).resolve()
    lock_path = Path(args.lock) if args.lock else PLUGIN_ROOT / "bmad.lock"
    marketplace_path = Path(args.marketplace) if args.marketplace else None
    claude_home = Path(args.claude_home) if args.claude_home else None

    planes = []
    for check in (
        lambda: check_bmad_base(directory, lock_path),
        lambda: check_plugin(directory, marketplace_path, claude_home,
                             args.channel),
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
