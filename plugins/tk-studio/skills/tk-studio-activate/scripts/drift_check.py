"""tk-studio-activate — four-plane health/drift check (AD-13). Read-only, loud.

Planes checked:
  bmad-base  installed _bmad/_config/manifest.yaml versions vs the bmad.lock pins,
             plus the studio's declared base patches (lib/basepatch.py) in place
  plugin     the skills-dir plugin folder (AD-21): <home>/skills/tk-studio/
             (<home> = --claude-home, else CLAUDE_CONFIG_DIR, else ~/.claude),
             its .claude-plugin/plugin.json version vs the configured channel's
             roster plugin entry (--channel, default stable; the project's
             tools/installer/rosters/<channel>.json) and, in a developer
             checkout only, the repo marketplace.json entry. One case is named
             (field `case`): ok | stale (tk-studio update) | missing
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
    # A repeated unit ("0"*64, "ab"*32, "deadbeef"*8) is typed, never hashed.
    for unit in (1, 2, 4, 8, 16, 32):
        if value == value[:unit] * (64 // unit):
            return (f"{where}: placeholder digest ({value[:8]}...) repeats a "
                    f"{unit}-char unit, never a real value")
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
    the roster's home: any other repository must be named in ``source``.
    With no ``plugin`` entry there is no home, so every app entry must name
    its repository in ``source``."""
    if not isinstance(roster, dict):
        return ["roster: not a JSON object"]
    problems: list[str] = []
    if "schema" not in roster:
        problems.append("schema: missing")
    elif type(roster["schema"]) is not int or roster["schema"] != ROSTER_SCHEMA:
        # type() not isinstance: JSON true / 1.0 compare equal to 1
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
    homeless = "plugin" not in components
    for name, entry in components.items():
        where = f"components.{name}"
        if name in RELEASE_COMPONENTS:
            problems.extend(_release_entry_problems(
                where, RELEASE_COMPONENTS[name], entry, home, homeless))
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
                            home: str | None, homeless: bool) -> list[str]:
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
            elif source is None and homeless:
                problems.append(f"{where}.source: missing — the roster's home "
                                "cannot be established without the plugin "
                                f"entry; name {repo} in source")
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
    seen: dict[str, str] = {}
    for target, value in digests.items():
        if not isinstance(target, str) or not target.strip() \
                or _is_placeholder_text(target):
            problems.append(f"{where}.sha256: placeholder platform target "
                            f"{target!r}")
        bad = _digest_problem(f"{where}.sha256.{target}", value)
        if bad:
            problems.append(bad)
        elif value in seen:
            # real upstream assets differ per platform: a shared digest is copied
            problems.append(f"{where}.sha256: {seen[value]} and {target} carry "
                            "the same digest — fabricated, never a real value")
        else:
            seen[value] = target
    return problems


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
        catalog = marketplace_path or (directory / ".claude-plugin"
                                       / "marketplace.json")
        if catalog.is_file():   # a developer checkout only
            market, err = _read_json_file(catalog)
            entry = None
            if not err and isinstance(market, dict) \
                    and isinstance(market.get("plugins"), list):
                entry = next((p for p in market["plugins"]
                              if isinstance(p, dict)
                              and p.get("name") == SKILLS_DIR_PLUGIN), None)
            if entry is None:
                errors.append(f"marketplace catalog {catalog} unreadable or "
                              f"missing the {SKILLS_DIR_PLUGIN} entry"
                              + (f" ({err})" if err else ""))
            elif entry.get("version") != version:
                found["stale"].append(
                    f"folder v{version} vs developer catalog "
                    f"v{entry.get('version')} ({catalog})")
            else:
                notes.append(f"in lockstep with the developer catalog "
                             f"v{version}")
        if found["stale"]:
            fixes["stale"] = FIX_UPDATE

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
