"""The plugin leg (Story 25.2, AD-21/O5): the skills-dir plugin folder.

Claude Code loads ``<config>/skills/tk-studio/`` in place as
``tk-studio@skills-dir``. This leg writes that folder from the roster's
SHA-256-verified release zip (or links it to a developer checkout), removes
every user-scope marketplace copy that would shadow it, and reports — never
edits — project-scope marketplace entries in other projects.

Stdlib only. ``claude`` is reached through one injectable runner and every
download through one injectable fetcher, so the lib suite runs offline
against a temp ``CLAUDE_CONFIG_DIR``.
"""
from __future__ import annotations

import functools
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Mapping

from tk_studio_cli import roster_guard

PLUGIN_NAME = "tk-studio"
TAG_PREFIX = "tk-studio--v"
FOLDER = "tk-studio"
STAGING = ".tk-studio.new"        # dot-prefixed: Claude Code skips these
PREVIOUS = ".tk-studio.previous"
RETIRED = ".tk-studio.retired"     # old previous, deleted after a swap
NOT_SHIPPED = "not shipped in this channel"
SKILLS_DIR_SUFFIX = "@skills-dir"
DEFAULT_ROSTER_URL = ("https://raw.githubusercontent.com/thkennedy/tk-studio/"
                      "main/tools/installer/rosters/{channel}.json")
CHANNELS = ("stable", "latest")
RUNNER_TIMEOUT = 120              # seconds per `claude plugin …` call

Fetcher = Callable[[str], bytes]
Runner = Callable[[list], "subprocess.CompletedProcess"]


class Refusal(Exception):
    """A named refusal: the verb ends ``blocked`` with ``reason``."""

    def __init__(self, name: str, detail: str):
        super().__init__(f"{name}: {detail}")
        self.name = name
        self.detail = detail

    @property
    def reason(self) -> str:
        return f"{self.name}: {self.detail}"


# --- locations (AD-15: resolved per OS, never hard-coded) -------------------

def config_dir(env: Mapping[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    value = env.get("CLAUDE_CONFIG_DIR")
    return Path(value) if value else Path.home() / ".claude"


def claude_json_path(env: Mapping[str, str] | None = None) -> Path:
    """Claude Code's global state file: inside CLAUDE_CONFIG_DIR when set,
    else ``~/.claude.json`` beside (not inside) ``~/.claude``."""
    env = os.environ if env is None else env
    value = env.get("CLAUDE_CONFIG_DIR")
    return Path(value) / ".claude.json" if value \
        else Path.home() / ".claude.json"


def folder_paths(config: Path) -> tuple[Path, Path, Path]:
    skills = config / "skills"
    return skills / FOLDER, skills / STAGING, skills / PREVIOUS


# --- defaults for the injectables ------------------------------------------

def default_fetch(url: str) -> bytes:
    if not (url.startswith("https://") or url.startswith("file://")):
        raise Refusal("UnsupportedUrl", f"{url!r} is not https:// or file://")
    with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310
        return resp.read()


def default_runner(args: list, env: Mapping[str, str] | None = None
                   ) -> subprocess.CompletedProcess:
    """Raises FileNotFoundError when ``claude`` is not on PATH, and
    subprocess.TimeoutExpired when it stalls (stdin is closed, so a prompt
    cannot wait for input). With ``env``, ``claude`` runs in that
    environment (and is looked up on its PATH), so it acts on the same
    config the leg inspected."""
    if env is not None and env.get("PATH") is not None:
        exe = shutil.which(args[0], path=env.get("PATH"))
    else:
        exe = shutil.which(args[0])
    if exe is None:
        raise FileNotFoundError(args[0])
    return subprocess.run([exe, *args[1:]], capture_output=True, text=True,
                          encoding="utf-8", errors="replace",
                          stdin=subprocess.DEVNULL, timeout=RUNNER_TIMEOUT,
                          env=dict(env) if env is not None else None)


# --- roster -----------------------------------------------------------------

# the guard knows only this CLI's components and schema: an older CLI is
# blocked by a newer roster before its own self-update leg can run
NEWER_ROSTER = ("A roster newer than this CLI needs a newer CLI — re-run the "
                "bootstrap (tools/installer/install.ps1 or install.sh)")


def _newer_roster_problem(problem: str) -> bool:
    """The guard's texts for what a newer roster carries and this CLI does
    not know: an unsupported ``schema`` or an unknown component. A typed
    digest, tag or URL is the roster's fault; a new CLI changes nothing."""
    return problem.startswith("schema: unsupported ") \
        or problem.endswith(": unknown component")


def load_roster(source: str | None, channel: str, fetch: Fetcher) -> dict:
    """The roster, validated by the one guard (``roster_guard``, the
    byte-identical copy of the plugin lib's). Problems confined to
    component entries refuse ``RosterEntryInvalid``; any roster-level
    problem refuses ``RosterInvalid``. Each names every problem."""
    src = source or DEFAULT_ROSTER_URL.format(channel=channel)
    try:
        if "://" in src:
            raw = fetch(src)
        else:
            raw = Path(src).read_bytes()
        roster = json.loads(raw.decode("utf-8"))
    except Refusal:
        raise
    except Exception as exc:  # noqa: BLE001 — any read failure is named
        raise Refusal("RosterUnreadable", f"{src}: {exc}") from None
    problems = roster_guard.roster_problems(roster)
    if problems:
        entry_only = all(p.startswith("components.") for p in problems)
        hint = ". " + NEWER_ROSTER \
            if any(_newer_roster_problem(p) for p in problems) else ""
        raise Refusal("RosterEntryInvalid" if entry_only else "RosterInvalid",
                      f"{src}: " + "; ".join(problems) + hint)
    return roster


def plugin_entry_problems(entry) -> list[str]:
    """The plugin entry's problems, from the guard's own entry check."""
    return roster_guard._release_entry_problems(
        "components.plugin", TAG_PREFIX, entry, None, False)


def check_plugin_entry(entry) -> str:
    """The tag's X.Y.Z, or a RosterEntryInvalid refusal naming each field."""
    problems = plugin_entry_problems(entry)
    if problems:
        raise Refusal("RosterEntryInvalid", "; ".join(problems))
    return entry["tag"][len(TAG_PREFIX):]


# --- links that are never followed when deleting ---------------------------

def is_link(path: Path) -> bool:
    if path.is_symlink():
        return True
    isjunction = getattr(os.path, "isjunction", None)  # 3.12+
    if isjunction is not None:
        return isjunction(path)
    if sys.platform == "win32" and os.path.lexists(path):  # dangling too
        try:
            os.readlink(path)
            return True
        except (OSError, ValueError):
            return False
    return False


def link_target(path: Path) -> str:
    raw = os.readlink(path)
    if raw.startswith("\\\\?\\"):
        raw = raw[4:]
    return raw


def remove_path(path: Path) -> None:
    """Delete ``path`` without ever recursing through a link: a symlink or
    junction is unlinked, only a real directory is rmtree'd."""
    if is_link(path):
        try:
            os.unlink(path)
        except OSError:
            os.rmdir(path)  # a Windows junction / directory symlink
    elif path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def make_link(link: Path, target: Path) -> None:
    if sys.platform == "win32":
        try:
            proc = subprocess.run(["cmd", "/c", "mklink", "/J", str(link),
                                   str(target)], capture_output=True,
                                  text=True)
        except OSError as exc:
            raise Refusal("LinkFailed", f"mklink /J {link} {target}: "
                          f"{exc}") from None
        if proc.returncode != 0:
            raise Refusal("LinkFailed", f"mklink /J {link} {target}: "
                          f"{(proc.stderr or proc.stdout).strip()}")
    else:
        try:
            os.symlink(target, link, target_is_directory=True)
        except OSError as exc:
            raise Refusal("LinkFailed",
                          f"symlink {link} -> {target}: {exc}") from None


def _rename(src: Path, dst: Path) -> None:
    os.rename(src, dst)


def _must_remove(path: Path) -> None:
    """Remove before any change is made; a failure is a named refusal."""
    try:
        remove_path(path)
    except OSError as exc:
        raise Refusal("CleanupFailed", f"could not remove {path}: {exc}") \
            from None


def _try_remove(path: Path) -> str | None:
    """Best-effort removal on an error or after success; the error text
    when it fails, never raised."""
    try:
        remove_path(path)
        return None
    except OSError as exc:
        return f"{path}: {exc}"


def _prepare(target: Path, staging: Path) -> None:
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise Refusal("FolderUnwritable",
                      f"could not create {target.parent}: {exc}") from None
    _must_remove(staging)


def _swap(staging: Path, target: Path, previous: Path) -> dict:
    """Swap the fully built ``staging`` in. When a target is superseded,
    the old previous is set aside as ``.tk-studio.retired`` and deleted only
    once the swap has succeeded, so any failed run leaves target and
    previous as they were; with no target, previous is left alone.
    Returns ``{"had": bool, "retired_left": str|None}``."""
    retired = previous.parent / RETIRED
    if retired.exists() or is_link(retired):
        if previous.exists() or is_link(previous):
            _must_remove(retired)               # stale, from a crashed run
        else:
            # A failed restore left the only previous here: put it back.
            try:
                _rename(retired, previous)
            except OSError as exc:
                raise Refusal("CleanupFailed", f"could not restore {retired} "
                              f"-> {previous}: {exc}") from None
    had = target.exists() or is_link(target)
    old_prev = had and (previous.exists() or is_link(previous))

    def fail(detail: str, steps: list) -> Refusal:
        problems = []
        for src, dst in steps:                  # undo, newest first
            try:
                _rename(src, dst)
            except OSError as exc:
                problems.append(f"could not restore {src} -> {dst}: {exc}")
        _try_remove(staging)
        if problems:
            where = previous if (previous.exists() or is_link(previous)) \
                else retired
            return Refusal("SwapFailed", f"{detail}; " + "; ".join(problems)
                           + f" (target {target}, previous now at {where})")
        return Refusal("SwapFailed", f"{detail} (target and previous "
                       "restored)")

    undo: list = []
    if old_prev:
        try:
            _rename(previous, retired)
        except OSError as exc:
            raise fail(f"could not set {previous} aside: {exc}", undo) \
                from None
        undo.insert(0, (retired, previous))
    if had:
        try:
            _rename(target, previous)
        except OSError as exc:
            raise fail(f"could not move {target} aside: {exc}", undo) \
                from None
        undo.insert(0, (previous, target))
    try:
        _rename(staging, target)
    except OSError as exc:
        raise fail(f"could not rename {staging} over {target}: {exc}",
                   undo) from None
    return {"had": had, "retired_left": _try_remove(retired)}


def _manifest_version(folder: Path) -> str | None:
    try:
        data = json.loads((folder / ".claude-plugin" / "plugin.json")
                          .read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    version = data.get("version") if isinstance(data, dict) else None
    return version if isinstance(version, str) else None


def _unsafe_member(name: str) -> bool:
    n = name.replace("\\", "/")
    return n.startswith("/") or bool(re.match(r"[A-Za-z]:", n)) \
        or ".." in n.split("/")


def _swapped(fields: dict, swap: dict, previous: Path) -> dict:
    fields["previous"] = str(previous) if swap["had"] else None
    if swap["retired_left"]:
        fields["retired_left"] = swap["retired_left"]
    return fields


# --- the two writes ---------------------------------------------------------

def write_from_zip(entry: dict, config: Path, fetch: Fetcher) -> dict:
    version = check_plugin_entry(entry)
    target, staging, previous = folder_paths(config)
    try:
        data = fetch(entry["url"])
    except Refusal:
        raise
    except Exception as exc:  # noqa: BLE001
        raise Refusal("DownloadFailed", f"plugin {entry['url']}: {exc}") \
            from None
    got = hashlib.sha256(data).hexdigest()
    if got != entry["sha256"]:
        raise Refusal("DigestMismatch",
                      f"plugin zip sha256 {got} != roster "
                      f"components.plugin.sha256 {entry['sha256']}")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = zf.namelist()
    except zipfile.BadZipFile as exc:
        raise Refusal("PluginZipInvalid", f"plugin zip: {exc}") from None
    for name in names:
        if _unsafe_member(name):
            raise Refusal("UnsafeZipMember", f"plugin zip member {name!r} "
                          "is absolute or climbs out with '..'")

    _prepare(target, staging)
    try:
        with zf:
            zf.extractall(staging)
    except Exception as exc:  # noqa: BLE001 — zlib.error, encrypted, …
        _try_remove(staging)
        raise Refusal("PluginZipInvalid", f"extract failed: "
                      f"{type(exc).__name__}: {exc}") from None
    found = _manifest_version(staging)
    if found != version:
        _try_remove(staging)
        raise Refusal("PluginVersionMismatch",
                      f"zip's .claude-plugin/plugin.json version {found!r} "
                      f"!= tag {entry['tag']} ({version})")
    swap = _swap(staging, target, previous)
    return _swapped({"plugin": "written", "mode": "written",
                     "version_written": version, "tag": entry["tag"],
                     "folder": str(target)}, swap, previous)


def write_link(checkout: str, config: Path) -> dict:
    source = Path(checkout).resolve() / "plugins" / "tk-studio"
    if not (source / ".claude-plugin" / "plugin.json").is_file():
        raise Refusal("LinkTargetInvalid", f"{source} has no "
                      ".claude-plugin/plugin.json — not a tk-studio checkout")
    target, staging, previous = folder_paths(config)
    _prepare(target, staging)
    make_link(staging, source)
    swap = _swap(staging, target, previous)
    return _swapped({"plugin": "linked", "mode": "link",
                     "link_target": str(source),
                     "version": _manifest_version(source),
                     "folder": str(target)}, swap, previous)


# --- marketplace copies -----------------------------------------------------

def _read_json(path: Path) -> tuple[object, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return None, f"{type(exc).__name__}: {exc}"


def _is_ours(plugin_key) -> bool:
    return isinstance(plugin_key, str) \
        and plugin_key.split("@", 1)[0] == PLUGIN_NAME


def _installed_records(config: Path) -> tuple[dict, str | None]:
    """Our records, and the read error when the file exists but is
    unreadable, invalid JSON or has no ``plugins`` object."""
    path = config / "plugins" / "installed_plugins.json"
    if not path.is_file():
        return {}, None
    data, err = _read_json(path)
    if err:
        return {}, err
    plugins = data.get("plugins") if isinstance(data, dict) else None
    if not isinstance(plugins, dict):
        return {}, 'no "plugins" object'
    return {k: [e for e in v if isinstance(e, dict)]
            for k, v in plugins.items()
            if _is_ours(k) and isinstance(v, list)}, None


def marketplace_cleanup(config: Path, runner: Runner) -> dict:
    """Uninstall every user-scope ``tk-studio@<m>`` and remove the
    ``tk-studio`` marketplace — only through ``claude plugin …``. Read are
    the two record files and the user's ``settings.json`` (whose
    ``extraKnownMarketplaces`` / ``enabledPlugins`` would bring a copy
    back); none is ever edited. A file that exists but cannot be read is a
    failed entry naming the file (a copy may still shadow the folder); the
    other files are still used."""
    uninstall, remove, unreadable = set(), False, []
    records, err = _installed_records(config)
    if err:
        unreadable.append({"command": None, "file": str(
            config / "plugins" / "installed_plugins.json"), "error": err})
    for key, entries in records.items():
        if key.endswith(SKILLS_DIR_SUFFIX):     # the folder itself, not a copy
            continue
        if any(e.get("scope") == "user" for e in entries):
            uninstall.add(key)
    known_file = config / "plugins" / "known_marketplaces.json"
    known, err = _read_json(known_file) if known_file.is_file() \
        else ({}, None)
    if err or not isinstance(known, dict):
        unreadable.append({"command": None, "file": str(known_file),
                           "error": err or "not a JSON object"})
    elif PLUGIN_NAME in known:
        remove = True
    settings_file = config / "settings.json"
    settings, err = _read_json(settings_file) if settings_file.is_file() \
        else ({}, None)
    if err or not isinstance(settings, dict):
        unreadable.append({"command": None, "file": str(settings_file),
                           "error": err or "not a JSON object"})
    else:
        extra = settings.get("extraKnownMarketplaces")
        if isinstance(extra, dict) and PLUGIN_NAME in extra:
            remove = True
        enabled = settings.get("enabledPlugins")
        if isinstance(enabled, dict):
            uninstall.update(k for k in enabled if _is_ours(k)
                             and not k.endswith(SKILLS_DIR_SUFFIX))
    commands = [["claude", "plugin", "uninstall", key, "--scope", "user"]
                for key in sorted(uninstall)]
    if remove:
        commands.append(["claude", "plugin", "marketplace", "remove",
                         PLUGIN_NAME])
    if not commands and not unreadable:
        return {"status": "clean", "removed": []}
    removed, failed = [], list(unreadable)
    for cmd in commands:
        text = " ".join(cmd)
        try:
            proc = runner(cmd)
        except FileNotFoundError:
            skipped = {"status": "skipped", "removed": removed,
                       "reason": "claude not on PATH — marketplace copies "
                                 "left: " + ", ".join(
                                     " ".join(c) for c in commands
                                     if " ".join(c) not in removed)}
            if unreadable:
                skipped["failed"] = unreadable
            return skipped
        except (OSError, subprocess.TimeoutExpired) as exc:
            failed.append({"command": text, "exit": None,
                           "error": f"{type(exc).__name__}: {exc}"})
            continue
        if proc.returncode == 0:
            removed.append(text)
        else:
            failed.append({"command": text, "exit": proc.returncode})
    return {"status": "failed" if failed else "removed", "removed": removed,
            "failed": failed}


def project_entries(config: Path, env: Mapping[str, str] | None = None
                    ) -> list[dict]:
    """Every project-scope marketplace record of tk-studio, reported and
    never edited (other projects' tracked files are theirs)."""
    out: list[dict] = []
    projects: set[str] = set()
    installed_file = config / "plugins" / "installed_plugins.json"
    records, _ = _installed_records(config)   # an unreadable file lists none
    for key, entries in sorted(records.items()):
        if key.endswith(SKILLS_DIR_SUFFIX):     # the folder itself, not a copy
            continue
        for e in entries:
            if e.get("scope") == "user":
                continue
            project = e.get("projectPath")
            out.append({"project": project, "file": str(installed_file),
                        "key": key, "scope": e.get("scope")})
            if isinstance(project, str):
                projects.add(project)
    state_file = claude_json_path(env)
    if state_file.is_file():
        state, err = _read_json(state_file)
        if err:
            out.append({"project": None, "file": str(state_file),
                        "error": err})
        elif isinstance(state, dict) and isinstance(state.get("projects"),
                                                    dict):
            projects.update(k for k in state["projects"] if isinstance(k, str))
    for project in sorted(projects):
        for name in ("settings.json", "settings.local.json"):
            settings = Path(project) / ".claude" / name
            try:
                present = settings.is_file()
            except OSError:
                present = False
            if not present:
                continue
            data, err = _read_json(settings)
            if err or not isinstance(data, dict):
                out.append({"project": project, "file": str(settings),
                            "error": err or "not a JSON object"})
                continue
            enabled = data.get("enabledPlugins")
            if isinstance(enabled, dict):
                for key in sorted(k for k in enabled if _is_ours(k) and
                                  not k.endswith(SKILLS_DIR_SUFFIX)):
                    out.append({"project": project, "file": str(settings),
                                "key": f"enabledPlugins.{key}"})
            extra = data.get("extraKnownMarketplaces")
            if isinstance(extra, dict) and PLUGIN_NAME in extra:
                out.append({"project": project, "file": str(settings),
                            "key": f"extraKnownMarketplaces.{PLUGIN_NAME}"})
    return out


# --- verbs ------------------------------------------------------------------

def _result(verb: str, status: str, reason: str | None = None,
            artifacts: list | None = None, **fields) -> dict:
    return {"status": status, "intent": f"tk-studio-cli-{verb}",
            "artifacts": artifacts or [], "reason": reason, **fields}


def run_leg(verb: str, *, roster: str | None = None, channel: str = "stable",
            link: str | None = None, fetch: Fetcher | None = None,
            runner: Runner | None = None,
            env: Mapping[str, str] | None = None) -> dict:
    fetch = fetch or default_fetch
    if runner is None:
        # claude acts on the config inspected here, not the process's own
        runner = default_runner if env is None \
            else functools.partial(default_runner, env=env)
    config = config_dir(env)
    try:
        if link is not None:
            leg = write_link(link, config)
        else:
            components = load_roster(roster, channel, fetch)["components"]
            if "plugin" not in components:
                leg = {"plugin": NOT_SHIPPED}
            else:
                leg = write_from_zip(components["plugin"], config, fetch)
    except Refusal as refusal:
        return _result(verb, "blocked", refusal.reason)
    target, _, _ = folder_paths(config)
    if target.is_dir():     # follows a live link; False for a dangling one
        market = marketplace_cleanup(config, runner)
    else:
        # Removing the marketplace copy with no loadable folder to replace
        # it would leave no tk-studio at all.
        market = {"status": "skipped", "removed": [],
                  "reason": f"no skills-dir folder at {target} — "
                            "marketplace copies kept"}
    status, reason = "complete", None
    if market.get("failed"):
        status = "partial"
        reason = "MarketplaceRemovalFailed: " + ", ".join(
            f"{f['command'] or 'unreadable ' + f['file']} "
            f"({f.get('error') or 'exit %s' % f.get('exit')})"
            for f in market["failed"])
    artifacts = [leg["folder"]] if "folder" in leg else []
    return _result(verb, status, reason, artifacts, **leg,
                   marketplace=market,
                   project_entries=project_entries(config, env))


def doctor(env: Mapping[str, str] | None = None) -> dict:
    """Minimal, read-only: the folder's mode (25.5 adds the full doctor)."""
    target, _, _ = folder_paths(config_dir(env))
    if is_link(target):
        dest = link_target(target)
        return _result("doctor", "complete", mode="link", link_target=dest,
                       folder=str(target), summary=f"link mode -> {dest}",
                       version=_manifest_version(target))
    if target.is_dir():
        version = _manifest_version(target)
        return _result("doctor", "complete", mode="written", folder=str(target),
                       version=version, summary=f"written folder at {version}")
    return _result("doctor", "complete", mode="missing", folder=str(target),
                   summary="no skills-dir plugin folder — run tk-studio install")
