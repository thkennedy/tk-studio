"""The installer roster guard (AD-21, Story 25.1; moved here by Story 25.4).

One pure, stdlib-only validator for ``tools/installer/rosters/<channel>.json``.
This file ships twice, byte-identical: ``plugins/tk-studio/lib/roster_guard.py``
(the drift check imports it and re-exports its names) and
``tools/installer/cli/tk_studio_cli/roster_guard.py`` (the sealed meta-CLI
wheel reads every roster through it). The lib suite pins the identity and
the stdlib-only imports; edit both copies together.
"""
from __future__ import annotations

import re

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
