"""The skills-dir plugin plane (AD-21): the folder ``<home>/skills/tk-studio/``
against the roster's plugin version (Story 25.3), shared with the meta-CLI's
doctor (Story 25.5).

The plugin is the installer-written folder, which Claude Code loads in place
as ``tk-studio@skills-dir``. The folder's own ``plugin.json`` is the installed
version; the caller passes the expected one (the drift check reads the
checked project's roster file, the CLI its loaded roster). Marketplace
records are read only to find a same-named copy shadowing the folder — the
exact read set of the installer's ``marketplace_cleanup``; none is ever
edited.

Stdlib only: this file is byte-identical in ``plugins/tk-studio/lib/`` and in
the sealed CLI wheel (``tools/installer/cli/tk_studio_cli/``).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

SKILLS_DIR_PLUGIN = "tk-studio"
SKILLS_DIR_SUFFIX = "@skills-dir"
INSTALLER_SIBLINGS = (".tk-studio.new", ".tk-studio.previous",
                      ".tk-studio.retired")
DEFAULT_CHANNEL = "stable"
FIX_UPDATE = ("run tk-studio update (the installer rewrites the skills-dir "
              "plugin folder at the roster's plugin version)")
FIX_INSTALL = ("run tk-studio install (the installer writes the skills-dir "
               "plugin folder <home>/skills/tk-studio/)")
FIX_SHADOWED = "remove the marketplace copy shadowing the skills-dir folder"
_CASE_STATUS = {"ok": "ok", "stale": "drift", "shadowed": "drift",
                "missing": "missing"}
_CASE_ORDER = ("missing", "shadowed", "stale", "ok")


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


def skills_dir_check(home: Path, roster: tuple[str | None, str],
                     catalog: Path | None = None,
                     channel: str = DEFAULT_CHANNEL) -> dict:
    """The folder-and-roster check: one case of ok | stale | missing |
    shadowed (precedence missing > shadowed > stale > ok); the detail names
    every condition found. ``roster`` is ``(expected version or None,
    note)``: the roster plugin version the folder is compared with, and the
    note naming it (or why it is not comparable). ``catalog`` is a developer
    checkout's marketplace.json, or None when there is none to read. An
    unreadable folder plugin.json, record file or developer catalog is
    error, naming the file, and carries no case."""
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
        expected, note = roster
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
    if catalog is not None and catalog.is_file():
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
