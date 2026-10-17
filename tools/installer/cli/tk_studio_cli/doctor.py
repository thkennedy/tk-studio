"""``tk-studio doctor`` (Story 25.5): runbook §7's smoke checks, each
reported as ``{check, status: pass|fail|warn|skipped, detail, fix}``.

Read-only: doctor writes, deletes and renames nothing (a leftover
``cli-update.cmd`` is reported, never removed). The only processes it starts
are ``claude --version``, ``sbx daemon status`` and ``git config --global
--get core.longpaths``, each through the injected runner, only when the
executable is on PATH, and each bounded by ``PROCESS_TIMEOUT``. Its only
network calls are the ``/status`` probe (through the injected probe) and the
roster fetch when ``--roster`` is a URL or absent. The cut-over checks
(Story 28.4, Windows only) start nothing: the Startup ``.lnk`` is parsed in
Python and the git top-level is found by walking up for ``.git``.

Doctor's own status is ``complete`` whatever the checks find; ``reason``
names every failing check. Every non-``pass`` check carries a ``fix``.
"""
from __future__ import annotations

import os
import re
import shutil
import ssl
import subprocess
from pathlib import Path
from typing import Mapping

from tk_studio_cli import apps, miniyaml, plugin_leg, skills_plane
from tk_studio_cli.plugin_leg import Refusal

PASS, FAIL, WARN, SKIPPED = "pass", "fail", "warn", "skipped"
PROCESS_TIMEOUT = 30              # seconds per process doctor starts
CERT_LIFE_DAYS = 90
WINDOWS_ONLY = "windows only"
NOTHING_HERE = "nothing to do on this platform"
BLOCK_KEYS = ("status", "intent", "artifacts", "reason")

# the drift check's store plane (drift_check.check_store over
# store.check_store), pinned to it by the lib suite — the CLI cannot import
# either (the wheel is sealed)
STORE_DIRS = ("registry", "projects", "measurements")
REQUIRED_CONFIG_KEYS = ("user_name", "role", "machine_id")
FIX_STORE = ("run the store standup: uv run <plugin>/lib/store.py standup "
             "(idempotent, ST-2.1)")

# PyYAML's YAML-1.1 bool resolver: a plain scalar is a bool only when
# spelled exactly so (Hermes reads its config.yaml with PyYAML)
YAML_TRUE = ("yes", "Yes", "YES", "true", "True", "TRUE", "on", "On", "ON")
YAML_FALSE = ("no", "No", "NO", "false", "False", "FALSE", "off", "Off",
              "OFF")
# git's boolean true spellings (git config --get prints the raw value)
GIT_TRUE = ("true", "yes", "on", "1")

FIX_REBOOTSTRAP = ("rerun the bootstrap (tools/installer/install.ps1 or "
                   "install.sh), then open a new shell")
FIX_SBX = ("start the sbx daemon only through the sign-in task or start.ps1 "
           "(runbook §3.5, §4.3) — any other sbx command auto-starts a "
           "daemon that cannot reach the engine")
FIX_CERT = ("restart the supervisor tab: start.ps1 runs `tailscale cert`, "
            "which renews the certificate (it lives 90 days)")
FIX_START = ("start the supervisor: run the Startup shortcut (tk-studio "
             "supervisor.lnk) or sign out and in")


def _check(name: str, status: str, detail: str, fix: str | None = None,
           **extra) -> dict:
    return {"check": name, "status": status, "detail": detail,
            "fix": fix if status != PASS else None, **extra}


# --- processes (only these three, only through the runner) -----------------

def _path_value(ctx) -> str:
    return ctx.env.get("PATH") or ctx.env.get("Path") or ""


def _found(ctx, name: str) -> bool:
    path = _path_value(ctx)
    return bool(path) and shutil.which(name, path=path) is not None


def _run(ctx, args: list):
    if ctx.runner is apps.default_runner:
        return apps.default_runner(
            args, dict(ctx.env) if ctx.explicit_env else None,
            timeout=PROCESS_TIMEOUT)
    return apps._run(ctx, args)


def _version(text: str) -> tuple[int, ...] | None:
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(int(x) for x in m.groups()) if m else None


def _roster_fix(refusal: Refusal) -> str:
    if refusal.name in ("RosterInvalid", "RosterEntryInvalid"):
        return (f"{refusal.name}: correct the roster problems named in the "
                "detail, or pass --roster/--channel for a valid roster")
    return (f"{refusal.name}: the roster could not be read — check the "
            "network, or pass --roster <path> to a roster file")


def check_claude(ctx, roster: dict | None, refusal: Refusal | None) -> dict:
    name = "claude-code"
    if refusal is not None:
        return _check(name, FAIL, f"no version floor to compare with: "
                      f"{refusal.reason}", _roster_fix(refusal))
    floor_text = roster["requires"]["claude-code"]
    floor = _version(floor_text)
    fix = (f"install or update Claude Code to {floor_text} (stable channel) "
           "and put `claude` on PATH")
    if not _found(ctx, "claude"):
        return _check(name, FAIL, "claude not found on PATH", fix)
    try:
        proc = _run(ctx, ["claude", "--version"])
    except FileNotFoundError:
        return _check(name, FAIL, "claude not found on PATH", fix)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return _check(name, FAIL, f"claude --version failed: "
                      f"{type(exc).__name__}: {exc}", fix)
    out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
    got = _version(proc.stdout) or _version(proc.stderr)
    if proc.returncode != 0 or got is None:
        return _check(name, FAIL, f"claude --version exit {proc.returncode}, "
                      f"no version in its output ({out[:120]!r})", fix)
    shown = ".".join(map(str, got))
    floor_shown = ".".join(map(str, floor))
    if got < floor:
        return _check(name, FAIL, f"{shown} < {floor_shown} (roster floor)",
                      fix)
    return _check(name, PASS, f"{shown} >= {floor_shown}")


# --- the plugin plane --------------------------------------------------------

def check_plugin(ctx, roster: dict | None, refusal: Refusal | None,
                 channel: str) -> dict:
    name = "plugin"
    home = plugin_leg.config_dir(ctx.env)
    if refusal is None:
        entry = roster["components"].get("plugin")
        if entry is None:
            return _check(name, SKIPPED, f"not shipped in {channel}",
                          f"nothing to install: the {channel} roster ships "
                          "no plugin")
        tag = entry["tag"]
        expected = (tag[len(plugin_leg.TAG_PREFIX):], f"{channel} roster {tag}")
    else:
        expected = (None, f"roster not comparable ({refusal.name})")
    plane = skills_plane.skills_dir_check(home, expected, None, channel)
    extra = {"case": plane["case"]} if "case" in plane else {}
    if refusal is not None:
        fix = "; ".join(x for x in (plane.get("fix"), _roster_fix(refusal))
                        if x)
        return _check(name, FAIL, f"{plane['detail']}; {refusal.reason}",
                      fix, **extra)
    if plane["status"] == "ok":
        return _check(name, PASS, plane["detail"], **extra)
    fix = plane.get("fix") or ("repair or remove the unreadable file named "
                               "in the detail (doctor never edits it)")
    return _check(name, FAIL, plane["detail"], fix, **extra)


def check_plugin_leftovers(ctx) -> dict | None:
    skills = plugin_leg.config_dir(ctx.env) / "skills"
    left = [str(skills / n) for n in (plugin_leg.RETIRED, plugin_leg.STAGING)
            if (skills / n).exists() or plugin_leg.is_link(skills / n)]
    if not left:
        return None
    return _check("plugin-leftovers", WARN,
                  f"leftover installer folder(s) from an interrupted write "
                  f"or swap: {', '.join(left)}",
                  "run tk-studio update (the plugin leg clears a stale "
                  "staging or retired folder before it writes); doctor "
                  "never deletes them")


# --- the per-user store ------------------------------------------------------

def store_root(env: Mapping[str, str]) -> Path:
    value = env.get("TK_STUDIO_HOME")
    return Path(value) if value else Path.home() / ".tk-studio"


def store_health(env: Mapping[str, str]) -> dict:
    """store.check_store's fields, read from ``env``."""
    root = store_root(env)
    result = {"root": str(root), "exists": root.is_dir(), "missing_dirs": [],
              "config_present": False,
              "missing_config_keys": list(REQUIRED_CONFIG_KEYS),
              "config_error": None}
    if not result["exists"]:
        result["missing_dirs"] = list(STORE_DIRS)
        result["complete"] = False
        return result
    result["missing_dirs"] = [d for d in STORE_DIRS if not (root / d).is_dir()]
    config = root / "config.yaml"
    result["config_present"] = config.is_file()
    if result["config_present"]:
        try:
            data = miniyaml.loads(config.read_text(encoding="utf-8"))
            result["missing_config_keys"] = [
                k for k in REQUIRED_CONFIG_KEYS if data.get(k) in (None, "")]
        except (miniyaml.MiniYamlError, OSError, UnicodeDecodeError) as exc:
            result["config_error"] = str(exc)
    result["complete"] = (not result["missing_dirs"]
                          and result["config_present"]
                          and not result["missing_config_keys"]
                          and result["config_error"] is None)
    return result


def store_plane(env: Mapping[str, str]) -> dict:
    """drift_check.check_store's verdict, wording and fix."""
    plane = {"plane": "store", "status": "ok", "detail": ""}
    health = store_health(env)
    root = health["root"]
    if not health["exists"]:
        plane.update(status="missing",
                     detail=f"per-user store {root} does not exist",
                     fix=FIX_STORE)
        return plane
    if not health["complete"]:
        problems = []
        if health["missing_dirs"]:
            problems.append(f"missing: {', '.join(health['missing_dirs'])}")
        if not health["config_present"]:
            problems.append("config.yaml absent")
        elif health["config_error"]:
            problems.append(
                f"config.yaml unreadable: {health['config_error']}")
        elif health["missing_config_keys"]:
            problems.append("config.yaml missing keys: "
                            f"{', '.join(health['missing_config_keys'])}")
        plane.update(status="drift",
                     detail=f"store {root} — {'; '.join(problems)}",
                     fix=FIX_STORE)
    else:
        plane["detail"] = f"store {root} skeleton + config complete"
    return plane


def check_store(ctx) -> dict:
    plane = store_plane(ctx.env)
    if plane["status"] == "ok":
        return _check("store", PASS, plane["detail"])
    return _check("store", FAIL, plane["detail"], plane["fix"])


# --- sbx ---------------------------------------------------------------------

def check_sbx(ctx) -> dict:
    name = "sbx-daemon"
    if not _found(ctx, "sbx"):
        return _check(name, SKIPPED, "sbx not on PATH",
                      "install Docker sbx (winget install Docker.sbx) if this "
                      "box runs the sandbox tier; otherwise nothing to do")
    try:
        proc = _run(ctx, ["sbx", "daemon", "status"])
    except FileNotFoundError:
        return _check(name, SKIPPED, "sbx not on PATH",
                      "install Docker sbx if this box runs the sandbox tier")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return _check(name, FAIL, f"sbx daemon status failed: "
                      f"{type(exc).__name__}: {exc}", FIX_SBX)
    out = ((proc.stdout or "") + " " + (proc.stderr or "")).strip()
    if proc.returncode != 0:
        return _check(name, FAIL, f"sbx daemon status exit "
                      f"{proc.returncode}: {out[:200]}", FIX_SBX)
    return _check(name, PASS, f"sbx daemon status: {out[:200] or 'running'}")


# --- folder trust (holes 14 and 15) ------------------------------------------

def _norm(path: str, windows: bool) -> str:
    text = path.replace("\\", "/").rstrip("/")
    return text.casefold() if windows else text


def _accepted(record: object) -> bool:
    return isinstance(record, dict) \
        and record.get("hasTrustDialogAccepted") is True


def _registry_path(ctx) -> Path:
    return store_root(ctx.env) / "registry" / "projects.yaml"


def _read_projects(registry: Path) -> tuple[dict | None, str | None]:
    """The registry's ``projects`` map, or None and why it is unreadable.
    The caller checks ``is_file`` first."""
    try:
        data = miniyaml.loads(registry.read_text(encoding="utf-8"))
    except (miniyaml.MiniYamlError, OSError, UnicodeDecodeError) as exc:
        return None, f"registry {registry} unreadable: {exc}"
    projects = data.get("projects")
    if projects is None:     # miniyaml dumps an empty map as a bare key
        projects = {}
    if not isinstance(projects, dict):
        return None, f"registry {registry} unreadable: 'projects' is not a map"
    return projects, None


def _trusted_roots(ctx) -> tuple[Path, dict[str, object] | None, str | None]:
    """``.claude.json``'s project records keyed by normalized path, or None
    and why the file is unreadable (an absent file is an empty map)."""
    state_file = plugin_leg.claude_json_path(ctx.env)
    trusted: dict[str, object] = {}
    if state_file.is_file():
        state, err = plugin_leg._read_json(state_file)
        if err or not isinstance(state, dict):
            return state_file, None, (f"{state_file} unreadable: "
                                      f"{err or 'not a JSON object'}")
        entries = state.get("projects")
        if isinstance(entries, dict):
            # keys that normalize alike (case, slash direction on Windows)
            # collapse: an accepted record wins over one that is not
            for key, record in entries.items():
                if not isinstance(key, str):
                    continue
                norm = _norm(key, ctx.plat.windows)
                if norm not in trusted or _accepted(record):
                    trusted[norm] = record
    return state_file, trusted, None


def check_folder_trust(ctx) -> list[dict]:
    registry = _registry_path(ctx)
    fix_registry = (f"repair {registry} (tk-studio-onboard writes it); "
                    "doctor never edits it")
    if not registry.is_file():
        return [_check("folder-trust", SKIPPED,
                       f"no registered projects ({registry} absent)",
                       "onboard a project (tk onboard); trust is checked "
                       "for every registered root")]
    projects, why = _read_projects(registry)
    if projects is None:
        return [_check("folder-trust", FAIL, why, fix_registry)]
    if not projects:
        return [_check("folder-trust", SKIPPED,
                       f"registry {registry} has no projects",
                       "onboard a project (tk onboard); trust is checked "
                       "for every registered root")]
    state_file, trusted, why = _trusted_roots(ctx)
    if trusted is None:
        return [_check("folder-trust", FAIL, why,
                       f"repair {state_file} by starting Claude Code "
                       "once; doctor never edits it")]
    out = []
    for pid in sorted(projects):
        entry = projects[pid]
        root = entry.get("root") if isinstance(entry, dict) else None
        name = f"folder-trust:{pid}"
        if not isinstance(root, str) or not root:
            out.append(_check(name, FAIL, f"registry entry {pid} names no "
                              "root", fix_registry))
            continue
        record = trusted.get(_norm(root, ctx.plat.windows))
        if _accepted(record):
            out.append(_check(name, PASS, f"{root} trusted "
                              f"(hasTrustDialogAccepted in {state_file})"))
        else:
            why = "not accepted" if isinstance(record, dict) else \
                f"absent from {state_file}"
            out.append(_check(name, FAIL, f"{root}: trust dialog {why} — "
                              "its project rules are ignored",
                              f"open Claude Code in {root} and accept the "
                              "trust dialog"))
    return out


# --- long paths, the launcher, the certificate ------------------------------

def check_long_paths(ctx) -> dict:
    name = "long-paths"
    if not ctx.plat.windows:
        return _check(name, SKIPPED, WINDOWS_ONLY, NOTHING_HERE)
    problems, fixes = [], []
    value = ctx.hklm(apps.LONG_PATHS_KEY, "LongPathsEnabled")
    if value != 1:
        problems.append(f"HKLM\\{apps.LONG_PATHS_KEY}\\LongPathsEnabled is "
                        f"{value!r} (needs 1)")
        fixes.append(f"set HKLM\\{apps.LONG_PATHS_KEY}\\LongPathsEnabled to "
                     "1 (elevated), then sign out and in")
    git = None
    if _found(ctx, "git"):
        try:
            proc = _run(ctx, ["git", "config", "--global", "--get",
                              "core.longpaths"])
            git = (proc.stdout or "").strip().lower() \
                if proc.returncode == 0 else ""
        except FileNotFoundError:
            git = None
        except (OSError, subprocess.TimeoutExpired) as exc:
            git = f"unreadable ({type(exc).__name__})"
        if git is not None and git not in GIT_TRUE:
            problems.append(f"git core.longpaths is {git or 'unset'} "
                            "(needs true)")
            fixes.append("git config --global core.longpaths true")
    if problems:
        return _check(name, FAIL, "; ".join(problems), "; ".join(fixes))
    if git is None:
        return _check(name, SKIPPED, "LongPathsEnabled = 1; git not on PATH "
                      "— core.longpaths not checked",
                      "install git (winget install Git.Git), then run "
                      "tk-studio doctor again")
    return _check(name, PASS, "LongPathsEnabled = 1; git core.longpaths true")


_expand = apps.expand_vars     # %NAME% from env (ExpandEnvironmentVariables)


def _on_path(value: str | None, folder: Path, windows: bool,
             env: Mapping[str, str] | None = None) -> bool:
    """Whether ``folder`` is an entry of ``value``. On Windows an entry also
    matches once its ``%NAME%`` references are expanded from ``env``: the
    HKCU Path is read raw (REG_EXPAND_SZ unexpanded), and the bootstrap
    accepts and keeps such an entry (install.ps1)."""
    if not value:
        return False
    want = _norm(str(folder), windows)
    sep = ";" if windows else os.pathsep
    for p in value.split(sep):
        entry = p.strip()
        if not entry:
            continue
        if _norm(entry, windows) == want:
            return True
        if windows and env is not None and "%" in entry \
                and _norm(_expand(entry, env).strip(), windows) == want:
            return True
    return False


def check_path_launcher(ctx) -> dict:
    bin_dir = ctx.root / "bin"
    exe = bin_dir / apps._exe(ctx.plat, "tk-studio")
    problems, where = [], []
    if not exe.is_file():
        problems.append(f"no launcher at {exe}")
    if _on_path(_path_value(ctx), bin_dir, ctx.plat.windows, ctx.env):
        where.append("process PATH")
    if ctx.plat.windows and ctx.env_store is not None \
            and _on_path(ctx.env_store.get("Path"), bin_dir, True, ctx.env):
        where.append("HKCU Path")
    if not where:
        problems.append(f"{bin_dir} is not on PATH" + (
            " (process PATH or HKCU Path)" if ctx.plat.windows else ""))
    if problems:
        return _check("path-launcher", FAIL, "; ".join(problems),
                      FIX_REBOOTSTRAP)
    return _check("path-launcher", PASS,
                  f"{exe} on the {' and '.join(where)}")


def _cert_times(path: Path) -> tuple[float | None, float | None]:
    decode = getattr(getattr(ssl, "_ssl", None), "_test_decode_cert", None)
    if decode is None:
        return None, None
    try:
        info = decode(str(path))
        return (ssl.cert_time_to_seconds(info["notBefore"]),
                ssl.cert_time_to_seconds(info["notAfter"]))
    except Exception:  # noqa: BLE001 — unparseable: the file mtime stands in
        return None, None


def check_tailscale_cert(ctx) -> dict:
    name = "tailscale-cert"
    value = apps._var(ctx, "TK_SUPERVISOR_TLS_CERT")
    if not value:
        return _check(name, SKIPPED, "TK_SUPERVISOR_TLS_CERT not set (the "
                      "supervisor serves plain http)",
                      "for https, set the TLS variables "
                      "(tools/agent-pc/set-supervisor-env.ps1 -WithTls); "
                      "nothing to do for http")
    path = Path(value)
    if not path.is_file():
        return _check(name, FAIL, f"TK_SUPERVISOR_TLS_CERT names {path}, "
                      "which does not exist", FIX_CERT)
    not_before, not_after = _cert_times(path)
    source = "notBefore"
    if not_before is None:
        source = "file mtime"
        try:
            not_before = path.stat().st_mtime
        except OSError as exc:
            return _check(name, FAIL, f"{path} unreadable: {exc}", FIX_CERT)
    now = ctx.now()
    age = (now - not_before) / 86400
    expired = not_after is not None and now >= not_after
    detail = (f"{path} is {age:.0f} days old (from its {source}); its life "
              f"is {CERT_LIFE_DAYS} days")
    if expired:
        return _check(name, FAIL, detail + "; expired", FIX_CERT)
    if age >= CERT_LIFE_DAYS:
        return _check(name, FAIL, detail, FIX_CERT)
    return _check(name, PASS, detail)


# --- the supervisor, its slots, studio-web, the helper ----------------------

def _shipped(roster: dict | None, component: str) -> bool | None:
    return None if roster is None else component in roster["components"]


def check_supervisor(ctx, fields: dict, roster: dict | None,
                     channel: str) -> dict:
    name = "supervisor"
    report, probe = fields["supervisor"], fields.get("probe")
    if report["mode"] == apps.NOT_INSTALLED:
        if _shipped(roster, "supervisor") is False:
            return _check(name, SKIPPED, f"not shipped in {channel}",
                          f"nothing to install: the {channel} roster ships "
                          "no supervisor")
        return _check(name, FAIL, f"no supervisor slot under "
                      f"{ctx.root / apps.SUPERVISOR} and no source checkout",
                      "run tk-studio install")
    where = f"source checkout {report['checkout']}" \
        if report["mode"] == "source checkout" \
        else f"slot {report['version']} at {report['path']}"
    if probe and probe["answers"]:
        return _check(name, PASS, f"{where}; {probe['url']} answers")
    url = probe["url"] if probe else apps.probe_url(ctx)
    return _check(name, FAIL, f"{where}; {url} does not answer", FIX_START)


# --- the cut-over (Story 28.4): root, registry, trust, Startup shortcut -----

TARGET = "C:\\GitHub\\tk-studio\\apps\\supervisor"     # runbook §4.3
FIX_SHORTCUT = ("make the Startup shortcut as runbook §4.3 says: Target "
                "wt.exe, Arguments `-w studio nt --title supervisor pwsh "
                f"-NoExit -File {TARGET}\\start.ps1`, Start in {TARGET}")
FIX_RETARGET = ("retarget the Startup shortcut to runbook §4.3's target "
                f"{TARGET}\\start.ps1 (Start in {TARGET})")
FIX_ROOT_FIRST = "retarget the shortcut first (supervisor-root's fix)"
_FILE_ARG = re.compile(r'-File\s+(?:"([^"]+)"|([^\s"]+\.ps1))(?=\s|$)',
                       re.IGNORECASE)
# An unquoted -File path with whitespace in it: pwsh takes only the text up
# to the first space as the file, so it must be quoted.
_UNQUOTED_SPACED = re.compile(r'-File\s+([^"\s][^"]*?\s[^"]*?\.ps1)(?=\s|$)',
                              re.IGNORECASE)


def fix_shortcut(report: dict) -> str:
    """The shortcut fix for this box, by the supervisor's mode: a slot box's
    shortcut is the installer's to write; a source checkout's is §4.3's."""
    mode = report.get("mode")
    if mode == "source checkout":
        return FIX_SHORTCUT
    slot_fix = ("`tk-studio update` rewrites the shortcut at the current "
                "slot's start.ps1 when it installs a slot")
    if mode == "slot" and report.get("path"):
        slot = Path(report["path"])
        return (f"on this slot box {slot_fix}; until then make it as runbook "
                "§4.3 shows, pointed at the slot: Arguments `-w studio nt "
                f"--title supervisor pwsh -NoExit -File "
                f"\"{slot / 'start.ps1'}\"`, Start in {slot}")
    return (f"on a source checkout, {FIX_SHORTCUT}; on a slot box, "
            f"{slot_fix} (tk-studio install or update)")


def _split_path(text: str) -> tuple[str, str]:
    """``(parent, name)`` of a path written with either slash."""
    trimmed = text.rstrip("\\/")
    cut = max(trimmed.rfind("\\"), trimmed.rfind("/"))
    return (trimmed[:cut], trimmed[cut + 1:]) if cut >= 0 else ("", trimmed)


def _join(folder: str, relative: str) -> str:
    """``relative`` (leading ``.\\`` or ``./`` dropped) under ``folder``,
    written with ``folder``'s own slash."""
    rest = re.sub(r"^(?:\.[\\/])+", "", relative)
    sep = "\\" if "\\" in folder else "/"
    rest = rest.replace("/" if sep == "\\" else "\\", sep)
    return folder.rstrip("\\/") + sep + rest


def _project_id(folder: Path) -> str:
    """The nested root's ``project_id`` from its ``.tk-studio/config.yaml``;
    the folder basename when absent (AD-20 default)."""
    config = folder / ".tk-studio" / "config.yaml"
    try:
        data = miniyaml.loads(config.read_text(encoding="utf-8-sig"))
    except (miniyaml.MiniYamlError, OSError, UnicodeDecodeError):
        data = {}
    value = data.get("project_id") if isinstance(data, dict) else None
    return value if isinstance(value, str) and value else folder.name


def _is_file(path: Path) -> bool:
    try:
        return path.is_file()
    except OSError:
        return False


def check_supervisor_root(ctx, checkout: str) -> dict:
    name = "supervisor-root"
    folder = Path(checkout)
    config = folder / ".tk-studio" / "config.yaml"
    try:
        own = (folder / ".git").exists()
    except OSError:
        own = False
    # the old clone holds .git and start.ps1 (and, onboarded, its own
    # .tk-studio/config.yaml): named before the top-level case
    if own and _is_file(folder / "start.ps1"):
        holds = (".git, start.ps1 and .tk-studio/config.yaml"
                 if _is_file(config) else ".git and start.ps1")
        return _check(name, FAIL, f"{folder} is a repository of its own "
                      f"(holds {holds}), not a nested studio root; likely "
                      "the pre-cut-over layout (the old clone)", FIX_RETARGET)
    if own and _is_file(config):
        return _check(name, FAIL, f"{folder} is a repository top level "
                      "(holds .git and .tk-studio/config.yaml), not a nested "
                      "root inside one", FIX_RETARGET)
    if own:
        return _check(name, FAIL, f"{folder} is a repository of its own "
                      "(holds .git), not a nested studio root; likely the "
                      "pre-cut-over layout (the old clone)", FIX_RETARGET)
    top = apps.git_top(folder)
    if top is None:
        return _check(name, FAIL, f"{folder} is in no git checkout",
                      FIX_RETARGET)
    if not _is_file(config):
        return _check(name, FAIL, f"{folder} is inside the checkout {top} "
                      "but holds no .tk-studio/config.yaml (not a nested "
                      "studio project)", FIX_RETARGET)
    if not _is_file(top / ".tk-studio" / "config.yaml"):
        return _check(name, FAIL, f"{folder} is inside the checkout {top}, "
                      "which holds no .tk-studio/config.yaml (not a studio "
                      "project)", FIX_RETARGET)
    if not _is_file(folder / "start.ps1"):
        relative = Path(os.path.relpath(folder, top)).as_posix()
        return _check(name, FAIL, f"{folder} is the nested root inside the "
                      f"checkout {top} but holds no start.ps1",
                      f"restore it (`git -C {top} restore "
                      f"{relative}/start.ps1`), or {FIX_RETARGET}")
    return _check(name, PASS, f"{folder} is the nested root inside the "
                  f"checkout {top} (project {_project_id(folder)})")


def check_supervisor_registry(ctx, checkout: str) -> dict:
    name = "supervisor-registry"
    folder = Path(checkout)
    pid = _project_id(folder)
    registry = _registry_path(ctx)
    register = (f"uv run <plugin>/lib/registry.py register --directory "
                f"{folder} --writer activate --project-id {pid}; doctor never "
                "edits the registry")
    if not registry.is_file():
        return _check(name, FAIL, f"no registry at {registry}: {pid} is not "
                      f"registered at {folder}", register)
    projects, why = _read_projects(registry)
    if projects is None:
        return _check(name, FAIL, why, f"repair {registry} "
                      "(tk-studio-onboard writes it); doctor never edits it")
    entry = projects.get(pid)
    root = entry.get("root") if isinstance(entry, dict) else None
    if not isinstance(root, str) or not root:
        return _check(name, FAIL, f"registry {registry} has no root for "
                      f"{pid} (the supervisor root is {folder})", register)
    if _norm(root, True) != _norm(str(folder), True):
        return _check(name, FAIL, f"registry {registry} names {pid} at "
                      f"{root}; the supervisor root is {folder}",
                      f"uv run <plugin>/lib/registry.py amend --project-id "
                      f"{pid} --writer activate --root {folder}; doctor never "
                      "edits the registry")
    return _check(name, PASS, f"registry {registry} names {pid} at {root}")


def check_supervisor_trust(ctx, checkout: str) -> dict:
    name = "supervisor-trust"
    folder = str(Path(checkout))
    state_file, trusted, why = _trusted_roots(ctx)
    if trusted is None:
        return _check(name, FAIL, why, f"repair {state_file} by starting "
                      "Claude Code once; doctor never edits it")
    if _accepted(trusted.get(_norm(folder, True))):
        return _check(name, PASS, f"{folder} trusted (hasTrustDialogAccepted "
                      f"in {state_file})")
    want = _norm(folder, True)
    parents = sorted(key for key, record in trusted.items()
                     if _accepted(record) and want.startswith(key + "/"))
    detail = f"{folder} is not trusted in {state_file}"
    if parents:
        detail += (f"; its parent {parents[-1]} is, but trust has no "
                   "inheritance (runbook §4.1)")
    return _check(name, FAIL, detail, f"open `claude` in {folder} and accept "
                  "the trust dialog")


def check_startup_shortcut(ctx, report: dict) -> dict:
    name = "startup-shortcut"
    fix = fix_shortcut(report)
    lnk = apps.shortcut_path(ctx)
    if lnk is None:
        return _check(name, FAIL, "APPDATA is unset: no Startup folder to "
                      f"find {apps.SHORTCUT} in", fix)
    strings = apps.read_lnk_strings(lnk)
    if strings is None:
        return _check(name, FAIL, f"{lnk} is absent or not a shell link", fix)
    arguments = strings.get("arguments") or ""
    workdir = _expand(strings.get("working_dir") or "", ctx.env)
    match = _FILE_ARG.search(arguments)
    target = (match.group(1) or match.group(2)) if match else None
    if target is None:
        spaced = _UNQUOTED_SPACED.search(arguments)
        if spaced is not None:
            # plain quotes, not !r: on Windows repr doubles every backslash
            # and the operator would read a path that does not exist
            return _check(name, FAIL, f"{lnk} Arguments name the unquoted "
                          f"-File path '{spaced.group(1)}': a path with a "
                          "space must be quoted, or pwsh takes only "
                          f"'{spaced.group(1).split()[0]}' as the file", fix)
    if target is None or _split_path(target)[1].casefold() != "start.ps1":
        return _check(name, FAIL, f"{lnk} Arguments name no `-File "
                      f"…start.ps1` ({arguments!r})", fix)
    target = _expand(target, ctx.env)
    if not apps.is_absolute(target):
        if not apps.is_absolute(workdir):
            return _check(name, FAIL, f"{lnk} runs the relative {target} "
                          "with no absolute working directory to resolve it "
                          f"against (Start in {workdir!r})", fix)
        target = _join(workdir, target)
    parent = _split_path(target)[0]
    if _norm(parent, True) != _norm(workdir, True):
        return _check(name, FAIL, f"{lnk} runs {target}, outside its "
                      f"working directory {workdir!r}", fix)
    if not Path(target).is_file():
        return _check(name, FAIL, f"{lnk} runs {target}, which does not "
                      "exist", fix)
    if report.get("mode") != "source checkout":
        slot = report.get("path") if report.get("mode") == "slot" else None
        if slot is None or _norm(parent, True) != _norm(str(slot), True):
            current = (f"the current slot is {slot}" if slot is not None
                       else "no current slot is installed")
            return _check(name, FAIL, f"{lnk} runs {target}, which is "
                          f"neither a source checkout nor the current "
                          f"slot; {current}", fix)
    return _check(name, PASS, f"{lnk} runs {target}")


def check_cut_over(ctx, fields: dict, supervisor: dict) -> list[dict]:
    """The four Story 28.4 checks, Windows only (absent elsewhere). The root
    checks run only when the shortcut names a source checkout; registry and
    trust are judged only once ``supervisor-root`` passes (else they would
    name the wrong folder). With no supervisor shipped (``supervisor``
    skipped) the shortcut is skipped too."""
    if not ctx.plat.windows:
        return []
    report = fields["supervisor"]
    out = []
    checkout = report.get("checkout") \
        if report.get("mode") == "source checkout" else None
    if checkout is not None:
        root = check_supervisor_root(ctx, checkout)
        out.append(root)
        if root["status"] == PASS:
            out += [check_supervisor_registry(ctx, checkout),
                    check_supervisor_trust(ctx, checkout)]
        else:
            out += [_check(n, SKIPPED, "not checked: supervisor-root failed",
                           FIX_ROOT_FIRST)
                    for n in ("supervisor-registry", "supervisor-trust")]
    if supervisor["status"] == SKIPPED:
        out.append(_check("startup-shortcut", SKIPPED, supervisor["detail"],
                          supervisor["fix"]))
    else:
        out.append(check_startup_shortcut(ctx, report))
    return out


def check_stale_slots(ctx) -> dict | None:
    stale = [str(p) for app in apps.SLOT_APPS
             for p in apps.stale_slots(ctx.root, app)]
    if not stale:
        return None
    return _check("stale-slots", WARN, f"old slot(s) set aside: "
                  f"{', '.join(stale)}",
                  "the next tk-studio update deletes an old slot once the "
                  "new one has started; doctor never deletes them")


def _is_previous(path: Path) -> bool:
    return any(p.startswith(".") and p.endswith(".previous")
               for p in path.parts)


def check_studio_web(ctx, roster: dict | None, channel: str) -> dict:
    name = "studio-web"
    version, path = apps._current_slot(ctx.root, apps.STUDIO_WEB)
    current = ctx.root / apps.CURRENT
    if path is None:
        if _shipped(roster, apps.STUDIO_WEB) is False:
            return _check(name, SKIPPED, f"not shipped in {channel}",
                          f"nothing to install: the {channel} roster ships "
                          "no studio-web")
        return _check(name, FAIL, f"{current} names no studio-web slot",
                      "run tk-studio install")
    fix = ("run tk-studio update (it repoints studio-web at a live slot and "
           "restarts the supervisor)")
    if _is_previous(path):
        return _check(name, FAIL, f"{current} names studio-web {path}, a "
                      ".previous slot (DW-12)", fix)
    if not path.is_dir():
        return _check(name, FAIL, f"{current} names studio-web {path}, "
                      "which does not exist (DW-12)", fix)
    return _check(name, PASS, f"slot {version} at {path}")


def check_cli_helper(ctx) -> dict | None:
    tools = ctx.root / "tools"
    helper, log = tools / apps.CLI_HELPER, tools / apps.CLI_HELPER_LOG
    found = [p for p in (helper, log) if p.is_file()]
    if not found:
        return None
    detail = "leftover CLI self-update file(s): " \
        + ", ".join(str(p) for p in found)
    if log.is_file():
        try:
            lines = [ln for ln in log.read_text(
                encoding="utf-8", errors="replace").splitlines()
                if ln.strip()][-apps.LOG_TAIL_LINES:]
        except OSError as exc:
            lines = [f"log unreadable: {exc}"]
        if lines:
            detail += "; log tail: " + " | ".join(lines)
    return _check("cli-update-helper", WARN, detail,
                  "the next tk-studio update reports and deletes them once "
                  "the scheduled install has run; if the log tail shows a "
                  "failure, run tk-studio update again (doctor never "
                  "deletes them)")


# --- Hermes ------------------------------------------------------------------

def check_hermes(ctx) -> dict | None:
    local = ctx.env.get("LOCALAPPDATA")
    if not local:
        return None
    home = Path(local) / "hermes"
    if not home.is_dir():
        return None
    name = "hermes-logins"
    config = home / "config.yaml"
    setting = "auth.adopt_external_logins"
    fix = (f"set {setting}: false in {config} and run `hermes gateway "
           "restart`")
    if not config.is_file():
        return _check(name, PASS, f"no {config}: {setting} absent (off)")
    try:
        # utf-8-sig: a BOM (PowerShell 5.1, Notepad) would otherwise make
        # the first key "﻿auth" and hide an enabled setting
        text = config.read_text(encoding="utf-8-sig")
        data = miniyaml.loads(text)
    except (miniyaml.MiniYamlError, OSError, UnicodeDecodeError) as exc:
        return _check(name, WARN, f"{config} unreadable ({exc}); {setting} "
                      "not checked", f"check {setting} in {config} by hand: "
                      "it must be false")
    auth = data.get("auth")
    value = auth.get("adopt_external_logins") if isinstance(auth, dict) \
        else None
    # miniyaml keeps YAML-1.1 spellings (yes, On, TRUE, ...) as strings;
    # Hermes reads them with PyYAML, whose bool resolver takes only these
    # exact spellings — any other string (y, n, nO, oFF) stays a non-empty,
    # truthy string to Hermes, so it falls to "not clearly off" below.
    # miniyaml also strips quotes, but to PyYAML a quoted "false" is a
    # truthy string, never a bool — so a quoted value is no bool word
    quoted = isinstance(value, str) and _hermes_value_quoted(text)
    word = value if isinstance(value, str) and not quoted else None
    if value is True or word in YAML_TRUE:
        return _check(name, WARN, f"{setting} is on in {config}: Hermes "
                      "adopts this box's Claude login (the Claude-login "
                      "risk — a hub on Claude OAuth drains extra-usage "
                      "credits)", fix)
    if value is False or word in YAML_FALSE:
        return _check(name, PASS, f"{setting} is off in {config}")
    if value is None:
        return _check(name, PASS, f"{setting} is absent (off) in {config}")
    shown = f"the quoted string {value!r}" if quoted else repr(value)
    return _check(name, WARN, f"{setting} is {shown} in {config}, not "
                  "clearly off: Hermes may adopt this box's Claude login",
                  fix)


def _hermes_value_quoted(text: str) -> bool:
    """True when the raw adopt_external_logins scalar under the top-level
    auth: block starts with a quote. A targeted line scan, not a parser:
    miniyaml already validated the file, this only recovers the one fact
    it drops (quoted vs plain)."""
    in_auth, child = False, None
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            in_auth = line.split("#", 1)[0].rstrip() == "auth:"
            continue
        if not in_auth:
            continue
        indent = len(line) - len(line.lstrip())
        child = indent if child is None else child
        key, sep, rest = line.strip().partition(":")
        if indent == child and sep and key == "adopt_external_logins":
            return rest.lstrip()[:1] in ("'", '"')
    return False


# --- the verb ----------------------------------------------------------------

def _line(check: dict) -> str:
    text = f"{check['status']:<7} {check['check']}: {check['detail']}"
    return text + (f" — fix: {check['fix']}" if check.get("fix") else "")


def run_doctor(ctx, *, roster: str | None, channel: str, fetch,
               json_only: bool = False) -> dict:
    landed = plugin_leg.doctor(ctx.env)
    fields = apps.doctor_fields(ctx)
    try:
        loaded, refusal = plugin_leg.load_roster(roster, channel, fetch), None
    except Refusal as exc:
        loaded, refusal = None, exc
    if loaded is not None:   # a --roster path names its own channel
        channel = loaded["channel"]
    supervisor = check_supervisor(ctx, fields, loaded, channel)
    checks: list[dict | None] = [
        check_claude(ctx, loaded, refusal),
        check_plugin(ctx, loaded, refusal, channel),
        check_plugin_leftovers(ctx),
        check_store(ctx),
        check_sbx(ctx),
        *check_folder_trust(ctx),
        check_long_paths(ctx),
        check_path_launcher(ctx),
        check_tailscale_cert(ctx),
        supervisor,
        *check_cut_over(ctx, fields, supervisor),
        check_stale_slots(ctx),
        check_studio_web(ctx, loaded, channel),
        check_cli_helper(ctx),
        check_hermes(ctx),
    ]
    done = [c for c in checks if c is not None]
    failing = [c["check"] for c in done if c["status"] == FAIL]
    result = {k: v for k, v in landed.items() if k not in BLOCK_KEYS}
    result.update(fields)
    result["checks"] = done
    if not json_only:
        result["_lines"] = [_line(c) for c in done]
    result.update(status="complete", intent="tk-studio-cli-doctor",
                  artifacts=[],
                  reason=("failing checks: " + ", ".join(failing))
                  if failing else None)
    return result
