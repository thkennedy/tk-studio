"""The app legs (Story 25.4, AD-21): bun, the supervisor, studio-web and the
meta-CLI's own update, plus ``status`` and the doctor's supervisor report.

Layout under the slot root (AD-15; resolved from ``env`` and an injectable
platform, never hard-coded):

- Windows ``%LOCALAPPDATA%\\tk-studio``; Linux ``$XDG_DATA_HOME/tk-studio``
  (default ``~/.local/share/tk-studio``); macOS
  ``~/Library/Application Support/tk-studio``.
- ``tools/bun-<v>/``, ``tools/uv-<v>/`` (the bootstrap's), ``bin/``.
- ``supervisor/<version>/`` and ``studio-web/<version>/`` slots; an old slot
  is renamed aside to ``<app>/.<version>.previous`` and deleted after the
  next successful start a later run observes (its own start/probe).
- ``current.json``: ``{"supervisor": {version, path}, "studio-web":
  {version, path}}``, one atomic pointer file; the supervisor reads the web
  slot from it.

Every download is SHA-256-checked against the roster before anything is
extracted or installed. Fetch, runner, the detached spawner, probe,
platform, the Windows User environment store, sleep and clock are all
injectable, so the lib suite
runs offline under a temp dir. No credential ever reaches the output: the
environment report carries names only.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import platform as _platform
import re
import secrets
import shutil
import ssl
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping

from tk_studio_cli import __version__
from tk_studio_cli import plugin_leg
from tk_studio_cli.plugin_leg import NOT_SHIPPED, Refusal

ROOT_NAME = "tk-studio"
SUPERVISOR = "supervisor"
STUDIO_WEB = "studio-web"
SLOT_APPS = (SUPERVISOR, STUDIO_WEB)
TAG_PREFIXES = {"plugin": "tk-studio--v", SUPERVISOR: "supervisor--v",
                STUDIO_WEB: "studio-web--v", "cli": "cli--v"}
STATUS_COMPONENTS = ("plugin", SUPERVISOR, STUDIO_WEB, "cli", "uv", "bun")
CURRENT = "current.json"
SHORTCUT = "tk-studio supervisor.lnk"
DEFAULT_PORT = "8787"
START_TIMEOUT = 60.0             # seconds for /status to answer after start
STOP_TIMEOUT = 30.0              # seconds for /status to go quiet after stop
APP_RUNNER_TIMEOUT = 900         # bun install / uv tool install may download
CLI_OLD = ".tk-studio.old"
NOT_INSTALLED = "not installed"
BUN_URL = "https://github.com/oven-sh/bun/releases/download/bun-v{v}/{asset}"
BUN_ASSETS = {"x86_64-pc-windows-msvc": "bun-windows-x64.zip",
              "x86_64-unknown-linux-gnu": "bun-linux-x64.zip",
              "aarch64-unknown-linux-gnu": "bun-linux-aarch64.zip",
              "aarch64-apple-darwin": "bun-darwin-aarch64.zip",
              "x86_64-apple-darwin": "bun-darwin-x64.zip"}
_TARGETS = {("windows", "x86_64"): "x86_64-pc-windows-msvc",
            ("windows", "aarch64"): "aarch64-pc-windows-msvc",
            ("linux", "x86_64"): "x86_64-unknown-linux-gnu",
            ("linux", "aarch64"): "aarch64-unknown-linux-gnu",
            ("darwin", "x86_64"): "x86_64-apple-darwin",
            ("darwin", "aarch64"): "aarch64-apple-darwin"}
_VERSION_DIR = re.compile(r"(uv|bun)-(\d+)\.(\d+)\.(\d+)")
_HERMES_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"
                          r"(.*?)\s*$")


# --- platform and locations ------------------------------------------------

@dataclass(frozen=True)
class Platform:
    system: str     # "windows" | "linux" | "darwin"
    machine: str    # "x86_64" | "aarch64"

    @property
    def windows(self) -> bool:
        return self.system == "windows"

    @property
    def target(self) -> str:
        return _TARGETS.get((self.system, self.machine),
                            f"{self.machine}-{self.system}")


def current_platform() -> Platform:
    system = "windows" if sys.platform == "win32" else \
        "darwin" if sys.platform == "darwin" else "linux"
    machine = _platform.machine().lower()
    machine = {"amd64": "x86_64", "x64": "x86_64",
               "arm64": "aarch64"}.get(machine, machine)
    return Platform(system, machine)


def _home(env: Mapping[str, str]) -> Path:
    value = env.get("HOME")
    return Path(value) if value else Path.home()


def data_root(env: Mapping[str, str], plat: Platform) -> Path:
    if plat.windows:
        base = env.get("LOCALAPPDATA")
        return (Path(base) if base else Path.home() / "AppData" / "Local") \
            / ROOT_NAME
    if plat.system == "darwin":
        return _home(env) / "Library" / "Application Support" / ROOT_NAME
    xdg = env.get("XDG_DATA_HOME")
    return (Path(xdg) if xdg else _home(env) / ".local" / "share") / ROOT_NAME


def _exe(plat: Platform, name: str) -> str:
    return f"{name}.exe" if plat.windows else name


def find_exe(folder: Path, plat: Platform, name: str) -> Path | None:
    """``<folder>/<name>`` or ``<folder>/<one dir>/<name>`` (upstream
    archives nest the binary one folder deep)."""
    exe = _exe(plat, name)
    if (folder / exe).is_file():
        return folder / exe
    if folder.is_dir():
        for child in sorted(folder.iterdir()):
            if child.is_dir() and (child / exe).is_file():
                return child / exe
    return None


# --- injectables ----------------------------------------------------------

def default_runner(args: list, env: Mapping[str, str] | None = None
                   ) -> subprocess.CompletedProcess:
    """plugin_leg.default_runner's contract with a longer bound: ``bun
    install`` and ``uv tool install`` may download."""
    if env is not None and env.get("PATH") is not None:
        exe = shutil.which(args[0], path=env.get("PATH"))
    else:
        exe = shutil.which(args[0])
    if exe is None:
        raise FileNotFoundError(args[0])
    return subprocess.run([exe, *args[1:]], capture_output=True, text=True,
                          encoding="utf-8", errors="replace",
                          stdin=subprocess.DEVNULL, timeout=APP_RUNNER_TIMEOUT,
                          env=dict(env) if env is not None else None)


_DETACHED_PROCESS = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
_NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP",
                             0x00000200)


def default_spawn_detached(args: list, env: Mapping[str, str] | None = None,
                           *, windows: bool | None = None) -> None:
    """Start a process meant to outlive this CLI and never wait for it. No
    stdio is inherited (a capturing pipe would keep this process waiting
    for its EOF while the child waits for this process to exit); on Windows
    it has no console and its own process group."""
    if env is not None and env.get("PATH") is not None:
        exe = shutil.which(args[0], path=env.get("PATH"))
    else:
        exe = shutil.which(args[0])
    if exe is None:
        raise FileNotFoundError(args[0])
    windows = sys.platform == "win32" if windows is None else windows
    extra: dict = {"creationflags": _DETACHED_PROCESS | _NEW_PROCESS_GROUP} \
        if windows else {"start_new_session": True}
    subprocess.Popen([exe, *args[1:]], stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True,
                     env=dict(env) if env is not None else None, **extra)


def default_probe(url: str) -> bool:
    """Any HTTP response (401 included) means the service is up. Liveness
    only: no credential is sent, so the TLS certificate is not verified
    (the bind is an IP, the certificate names the MagicDNS host)."""
    handlers: list = [urllib.request.ProxyHandler({})]
    if url.startswith("https://"):
        handlers.append(urllib.request.HTTPSHandler(
            context=ssl._create_unverified_context()))  # noqa: S323
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(url, timeout=5):
            return True
    except urllib.error.HTTPError:
        return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


class WindowsUserEnv:
    """``HKCU\\Environment`` through winreg, then a WM_SETTINGCHANGE
    broadcast through ctypes, as ``[Environment]::SetEnvironmentVariable(…,
    'User')`` does."""

    def get(self, name: str) -> str | None:
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
                return winreg.QueryValueEx(k, name)[0]
        except OSError:
            return None

    def names(self) -> list[str]:
        import winreg
        found = []
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
                for i in range(winreg.QueryInfoKey(k)[1]):
                    found.append(winreg.EnumValue(k, i)[0])
        except OSError:
            pass
        return found

    def set(self, name: str, value: str) -> None:
        import winreg
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, "Environment", 0,
                                winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, name, 0, winreg.REG_SZ, value)

    def broadcast(self) -> None:
        import ctypes
        from ctypes import wintypes
        result = wintypes.DWORD()
        ctypes.windll.user32.SendMessageTimeoutW(
            0xFFFF, 0x001A, 0, "Environment", 0x0002, 5000,
            ctypes.byref(result))


@dataclass
class Ctx:
    env: Mapping[str, str]
    plat: Platform
    root: Path
    fetch: Callable
    runner: Callable
    probe: Callable
    env_store: object
    sleep: Callable
    clock: Callable
    explicit_env: bool
    spawn_detached: Callable = default_spawn_detached
    cli_version: str = __version__
    start_timeout: float = START_TIMEOUT
    stop_timeout: float = STOP_TIMEOUT


def make_ctx(env: Mapping[str, str] | None = None, *, platform=None,
             fetch=None, runner=None, probe=None, env_store=None, sleep=None,
             clock=None, spawn_detached=None,
             cli_version: str | None = None) -> Ctx:
    plat = platform or current_platform()
    base = os.environ if env is None else env
    if env_store is None and plat.windows and sys.platform == "win32":
        env_store = WindowsUserEnv()
    return Ctx(env=base, plat=plat, root=data_root(base, plat),
               fetch=fetch or plugin_leg.default_fetch,
               runner=runner or default_runner,
               probe=probe or default_probe, env_store=env_store,
               sleep=sleep or time.sleep, clock=clock or time.monotonic,
               explicit_env=env is not None,
               spawn_detached=spawn_detached or default_spawn_detached,
               cli_version=cli_version or __version__)


def _run(ctx: Ctx, args: list, extra: Mapping[str, str] | None = None):
    if extra is None:
        if ctx.explicit_env and ctx.runner is default_runner:
            return ctx.runner(args, dict(ctx.env))
        return ctx.runner(args)
    return ctx.runner(args, {**ctx.env, **extra})


def _powershell(ctx: Ctx, script: str):
    try:
        return _run(ctx, ["pwsh", "-NoProfile", "-NonInteractive",
                          "-Command", script])
    except FileNotFoundError:
        return _run(ctx, ["powershell", "-NoProfile", "-NonInteractive",
                          "-Command", script])


def _ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _wait(ctx: Ctx, check: Callable[[], bool], timeout: float) -> bool:
    deadline = ctx.clock() + timeout
    while True:
        if check():
            return True
        if ctx.clock() >= deadline:
            return False
        ctx.sleep(1.0)


# --- files -----------------------------------------------------------------

def read_current(root: Path) -> dict:
    try:
        data = json.loads((root / CURRENT).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.",
                               suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_current(root: Path, app: str, version: str, path: Path) -> None:
    current = read_current(root)
    current[app] = {"version": version, "path": str(path)}
    try:
        _write_atomic(root / CURRENT, (json.dumps(current, indent=2) + "\n")
                      .encode("utf-8"))
    except OSError as exc:
        raise Refusal("CurrentUnwritable",
                      f"could not write {root / CURRENT}: {exc}") from None


def _current_slot(root: Path, app: str) -> tuple[str | None, Path | None]:
    entry = read_current(root).get(app)
    if not isinstance(entry, dict):
        return None, None
    version, path = entry.get("version"), entry.get("path")
    if not (isinstance(version, str) and isinstance(path, str)):
        return None, None
    return version, Path(path)


def stale_slots(root: Path, app: str) -> list[Path]:
    folder = root / app
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir()
                  if p.name.startswith(".") and p.name.endswith(".previous"))


def _is_under(path: Path, parent: Path) -> bool:
    try:
        Path(os.path.abspath(path)).relative_to(os.path.abspath(parent))
        return True
    except ValueError:
        return False


def _remove(path: Path, name: str = "CleanupFailed") -> None:
    try:
        plugin_leg.remove_path(path)
    except OSError as exc:
        raise Refusal(name, f"could not remove {path}: {exc}") from None


def _version_of(entry: dict, component: str) -> str:
    return entry["tag"][len(TAG_PREFIXES[component]):]


# --- download, verify, unpack ----------------------------------------------

def fetch_verified(ctx: Ctx, component: str, url: str, sha: str,
                   where: str) -> bytes:
    """The bytes at ``url`` once their SHA-256 equals the roster's; nothing
    is extracted or installed before this returns."""
    try:
        data = ctx.fetch(url)
    except Refusal:
        raise
    except Exception as exc:  # noqa: BLE001 — any fetch failure is named
        raise Refusal("DownloadFailed", f"{component} {url}: {exc}") from None
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        raise Refusal("DigestMismatch", f"{component} sha256 {got} != roster "
                      f"{where} {sha}")
    return data


def open_zip(data: bytes, component: str) -> zipfile.ZipFile:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = zf.namelist()
    except zipfile.BadZipFile as exc:
        raise Refusal("ArchiveInvalid", f"{component} zip: {exc}") from None
    for name in names:
        if plugin_leg._unsafe_member(name):
            raise Refusal("UnsafeZipMember", f"{component} zip member "
                          f"{name!r} is absolute or climbs out with '..'")
    return zf


def unpack(zf: zipfile.ZipFile, target: Path, component: str) -> None:
    """Stage then swap: extract to ``.<name>.new`` beside ``target``, then
    rename it in. A leftover ``target`` (never the current slot: callers
    check) is removed first."""
    staging = target.parent / f".{target.name}.new"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise Refusal("FolderUnwritable",
                      f"could not create {target.parent}: {exc}") from None
    _remove(staging)
    try:
        with zf:
            zf.extractall(staging)
    except Exception as exc:  # noqa: BLE001 — zlib.error, encrypted, …
        plugin_leg._try_remove(staging)
        raise Refusal("ArchiveInvalid", f"{component} extract failed: "
                      f"{type(exc).__name__}: {exc}") from None
    _remove(target)
    try:
        os.rename(staging, target)
    except OSError as exc:
        plugin_leg._try_remove(staging)
        raise Refusal("SwapFailed", f"could not rename {staging} -> "
                      f"{target}: {exc}") from None


# --- bun -------------------------------------------------------------------

def bun_leg(ctx: Ctx, entry: dict | None) -> dict:
    if entry is None:
        return {"status": NOT_SHIPPED}
    version, target = entry["version"], ctx.plat.target
    sha = entry["sha256"].get(target)
    asset = BUN_ASSETS.get(target)
    if sha is None or asset is None:
        raise Refusal("PlatformNotPinned",
                      f"components.bun.sha256 has no {target}")
    folder = ctx.root / "tools" / f"bun-{version}"
    exe = find_exe(folder, ctx.plat, "bun")
    if exe is not None:
        return {"status": "unchanged", "version": version,
                "path": str(folder), "exe": str(exe)}
    url = BUN_URL.format(v=version, asset=asset)
    data = fetch_verified(ctx, "bun", url, sha,
                          f"components.bun.sha256.{target}")
    unpack(open_zip(data, "bun"), folder, "bun")
    exe = find_exe(folder, ctx.plat, "bun")
    if exe is None:
        plugin_leg._try_remove(folder)
        raise Refusal("ArchiveInvalid", f"bun zip {url} has no "
                      f"{_exe(ctx.plat, 'bun')}")
    if not ctx.plat.windows:
        exe.chmod(exe.stat().st_mode | 0o755)
    return {"status": "installed", "version": version, "path": str(folder),
            "exe": str(exe), "url": url}


# --- source checkout (the dev box) -----------------------------------------

def read_lnk_working_dir(path: Path) -> str | None:
    """The WorkingDirectory of a Windows shell link (MS-SHLLINK), or None.
    Parsed here (stdlib) so a read-only verb starts no process."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    try:
        if len(data) < 76 or struct.unpack_from("<I", data, 0)[0] != 0x4C:
            return None
        flags = struct.unpack_from("<I", data, 20)[0]
        pos = 76
        if flags & 0x01:                                  # HasLinkTargetIDList
            pos += 2 + struct.unpack_from("<H", data, pos)[0]
        if flags & 0x02:                                  # HasLinkInfo
            pos += struct.unpack_from("<I", data, pos)[0]
        wide = bool(flags & 0x80)                         # IsUnicode
        for bit in (0x04, 0x08, 0x10):        # name, relative path, work dir
            if not flags & bit:
                continue
            count = struct.unpack_from("<H", data, pos)[0]
            pos += 2
            size = count * 2 if wide else count
            raw = data[pos:pos + size]
            pos += size
            if bit == 0x10:
                return raw.decode("utf-16-le" if wide else "latin-1",
                                  errors="replace")
    except struct.error:
        return None
    return None


def shortcut_path(ctx: Ctx) -> Path | None:
    appdata = ctx.env.get("APPDATA")
    if not appdata:
        return None
    return (Path(appdata) / "Microsoft" / "Windows" / "Start Menu"
            / "Programs" / "Startup" / SHORTCUT)


def source_checkout(ctx: Ctx) -> str | None:
    """The git checkout the Startup shortcut runs the supervisor from, when
    it is one (a directory holding ``.git`` outside ``<root>/supervisor``)."""
    if not ctx.plat.windows:
        return None
    lnk = shortcut_path(ctx)
    workdir = read_lnk_working_dir(lnk) if lnk is not None else None
    if not workdir:
        return None
    folder = Path(workdir)
    try:
        if not (folder / ".git").exists():
            return None
    except OSError:
        return None
    if _is_under(folder, ctx.root / SUPERVISOR):
        return None
    return str(folder)


# --- the lifted User environment and shortcut (Windows only) ---------------

def _secret(nbytes: int) -> str:
    return base64.b64encode(secrets.token_bytes(nbytes)).decode("ascii")


def _hermes_pair(ctx: Ctx) -> tuple[str, str] | None:
    local = ctx.env.get("LOCALAPPDATA")
    if not local:
        return None
    try:
        text = (Path(local) / "hermes" / ".env").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    kv: dict[str, str] = {}
    for line in text.splitlines():
        m = _HERMES_LINE.match(line)
        if m:
            kv[m.group(1)] = m.group(2).strip('"').strip("'")
    token = kv.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = kv.get("TELEGRAM_HOME_CHANNEL", "").strip()
    return (token, chat) if token and chat else None


def _tailscale_ip(ctx: Ctx) -> str | None:
    exe = os.path.join(ctx.env.get("ProgramFiles", "C:\\Program Files"),
                       "Tailscale", "tailscale.exe")
    try:
        proc = _run(ctx, [exe, "ip", "-4"])
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    first = (proc.stdout or "").strip().splitlines()
    ip = first[0].strip() if first else ""
    return ip if ip.startswith("100.") else None


def write_supervisor_env(ctx: Ctx) -> dict:
    """``tools/agent-pc/set-supervisor-env.ps1`` lifted: the same variables
    and keep-existing rules. Machine-derived values are set only when their
    source exists; the rest are listed in ``unset``. Names only, never a
    value (NFR5)."""
    if not ctx.plat.windows:
        return {"status": "skipped: windows only"}
    store = ctx.env_store
    if store is None:
        raise Refusal("EnvUnwritable", "no User environment store on this "
                      "platform")
    work = store.get("TK_SUPERVISOR_WORK") or os.path.join(
        ctx.env.get("SystemDrive", "C:") + os.sep, "agent-work")
    for sub in (("supervisor",), ("supervisor", "tls"),
                ("backups", "claude-projects")):
        try:
            Path(work, *sub).mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise Refusal("FolderUnwritable", f"could not create "
                          f"{Path(work, *sub)}: {exc}") from None
    report: dict = {"status": "written", "set": [], "kept": [], "unset": []}

    def put(name: str, value: str | None, keep: bool = False) -> None:
        current = store.get(name)
        if keep and current and current.strip():
            report["kept"].append(name)
        elif value is None:
            report["unset"].append(name)
        else:
            store.set(name, value)
            report["set"].append(name)

    if store.get("TK_STUDIO_ROOT"):
        report["kept"].append("TK_STUDIO_ROOT")
    else:
        report["unset"].append("TK_STUDIO_ROOT")
    put("TK_SUPERVISOR_DB", os.path.join(work, "supervisor", "queue.db"))
    put("TK_SUPERVISOR_BIND", _tailscale_ip(ctx))
    put("TK_SUPERVISOR_TOKEN", _secret(32), keep=True)
    put("TK_SUPERVISOR_SESSION_SECRET", _secret(48), keep=True)
    put("TK_SUPERVISOR_TRANSCRIPT_BACKUP",
        os.path.join(work, "backups", "claude-projects"))
    put("TK_SUPERVISOR_WORK", work)
    pair = _hermes_pair(ctx)

    def has(name: str) -> bool:
        return bool((store.get(name) or "").strip())
    telegram_names = ("TK_SUPERVISOR_NOTIFY", "TK_SUPERVISOR_TELEGRAM_TOKEN",
                      "TK_SUPERVISOR_TELEGRAM_CHAT")
    if pair is None and has(telegram_names[1]) and has(telegram_names[2]) \
            and (store.get(telegram_names[0]) or "").strip() == "telegram":
        # no Hermes .env to read, but a working Telegram setup is already
        # in the User environment: keep it, never move to an ntfy topic
        # nobody subscribed to
        report["kept"].extend(telegram_names)
    else:
        put("TK_SUPERVISOR_NOTIFY", "telegram" if pair else "ntfy")
        put("TK_SUPERVISOR_TELEGRAM_TOKEN", pair[0] if pair else None)
        put("TK_SUPERVISOR_TELEGRAM_CHAT", pair[1] if pair else None)
    put("TK_SUPERVISOR_NTFY_URL", "https://ntfy.sh/tk-supervisor-"
        + secrets.token_hex(12), keep=True)
    try:
        store.broadcast()
    except Exception as exc:  # noqa: BLE001 — the values are written anyway
        report["broadcast_error"] = f"{type(exc).__name__}: {exc}"
    return report


# what the CLI's own start lays over its environment (see ``_start_env``);
# a store that can list its names adds any other TK_SUPERVISOR_*
SUPERVISOR_ENV_NAMES = (
    "TK_STUDIO_ROOT", "TK_SUPERVISOR_DB", "TK_SUPERVISOR_BIND",
    "TK_SUPERVISOR_PORT", "TK_SUPERVISOR_TLS_CERT", "TK_SUPERVISOR_TLS_KEY",
    "TK_SUPERVISOR_TLS_NAME", "TK_SUPERVISOR_TOKEN",
    "TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_TRANSCRIPT_BACKUP",
    "TK_SUPERVISOR_WORK", "TK_SUPERVISOR_CONFIG", "TK_SUPERVISOR_NOTIFY",
    "TK_SUPERVISOR_TELEGRAM_TOKEN", "TK_SUPERVISOR_TELEGRAM_CHAT",
    "TK_SUPERVISOR_NTFY_URL")


def _start_args(slot: Path) -> list[str]:
    """wt.exe's arguments: a tab in the ``studio`` window whose starting
    directory is the slot (``nt`` without ``-d`` uses the profile's)."""
    return ["-w", "studio", "nt", "-d", str(slot), "--title", "supervisor",
            "pwsh", "-NoExit", "-File", str(slot / "start.ps1")]


def write_shortcut(ctx: Ctx, slot: Path) -> dict:
    if not ctx.plat.windows:
        return {"status": "skipped: windows only"}
    paths = (str(slot), str(slot / "start.ps1"))     # may contain spaces
    arguments = " ".join(f'"{a}"' if a in paths else a
                         for a in _start_args(slot))
    script = (
        "$ErrorActionPreference='Stop'; "
        "$wt=(Get-Command wt.exe).Source; "
        "$lnk=Join-Path ([Environment]::GetFolderPath('Startup')) "
        f"{_ps_quote(SHORTCUT)}; "
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); "
        "$s.TargetPath=$wt; "
        f"$s.Arguments={_ps_quote(arguments)}; "
        f"$s.WorkingDirectory={_ps_quote(str(slot))}; "
        "$s.Description='tk-studio supervisor, console-hosted at logon "
        "(runbook section 4.3)'; "
        "$s.Save(); Write-Output $lnk")
    try:
        proc = _powershell(ctx, script)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Refusal("ShortcutFailed", f"{type(exc).__name__}: {exc}") \
            from None
    if proc.returncode != 0:
        raise Refusal("ShortcutFailed", f"exit {proc.returncode}: "
                      f"{(proc.stderr or proc.stdout or '').strip()}")
    return {"status": "written", "path": (proc.stdout or "").strip() or None,
            "working_dir": str(slot)}


# --- stop, start, probe ----------------------------------------------------

def _var(ctx: Ctx, name: str) -> str | None:
    if ctx.plat.windows and ctx.env_store is not None:
        value = ctx.env_store.get(name)
        if value:
            return value
    return ctx.env.get(name) or None


def probe_url(ctx: Ctx) -> str:
    scheme = "https" if _var(ctx, "TK_SUPERVISOR_TLS_CERT") else "http"
    host = _var(ctx, "TK_SUPERVISOR_BIND") or "127.0.0.1"
    port = _var(ctx, "TK_SUPERVISOR_PORT") or DEFAULT_PORT
    return f"{scheme}://{host}:{port}/status"


# the slot path ends at a separator, a quote, whitespace or the end of the
# command line: ``…\supervisor\0.1.1`` never matches ``…\0.1.10\…``
_SLOT_END = r"(?=[\\/\"'\s]|$)"


def _slot_pids(ctx: Ctx, slot: Path) -> list[int]:
    """Processes whose command line names the slot path (bounded, see
    ``_SLOT_END``) — never a match by process name, never the query's own
    process."""
    needle = str(slot)
    try:
        if ctx.plat.windows:
            # -match is case-insensitive; $PID is the querying pwsh, whose
            # own command line carries the needle
            proc = _powershell(ctx, (
                f"$n=[regex]::Escape({_ps_quote(needle)})"
                f"+{_ps_quote(_SLOT_END)}; "
                "Get-CimInstance Win32_Process | Where-Object { "
                "$_.ProcessId -ne $PID -and $_.CommandLine -and "
                "$_.CommandLine -match $n } | "
                "ForEach-Object { $_.ProcessId }"))
            lines = (proc.stdout or "").split()
            pids = [int(x) for x in lines if x.isdigit()]
        else:
            pattern = re.compile(re.escape(needle) + _SLOT_END)
            proc = _run(ctx, ["ps", "-eo", "pid=,args="])
            pids = []
            for line in (proc.stdout or "").splitlines():
                pid, _, args = line.strip().partition(" ")
                if pid.isdigit() and pattern.search(args):
                    pids.append(int(pid))
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [p for p in pids if p != os.getpid()]


def stop_slot(ctx: Ctx, slot: Path, urls: list[str] | None = None
              ) -> list[int]:
    """Stop ``slot``'s processes, then wait until none of ``urls`` (default:
    the store's probe URL) answers. A caller that rewrote the env passes
    the URL read before the write too: the old service listens there."""
    pids = _slot_pids(ctx, slot)
    for pid in pids:
        args = ["taskkill", "/PID", str(pid), "/T", "/F"] if ctx.plat.windows \
            else ["kill", str(pid)]
        try:
            _run(ctx, args)
        except (OSError, subprocess.TimeoutExpired):
            pass                       # the probe decides
    urls = list(dict.fromkeys(urls or [probe_url(ctx)]))
    if not _wait(ctx, lambda: not any(ctx.probe(u) for u in urls),
                 ctx.stop_timeout):
        answering = [u for u in urls if ctx.probe(u)] or urls
        raise Refusal("ServiceStillRunning",
                      f"{', '.join(answering)} still answers after stopping "
                      f"{len(pids)} process(es) whose command line names "
                      f"{slot} — nothing renamed or repointed")
    return pids


def _start_env(ctx: Ctx) -> dict[str, str] | None:
    """Windows: the User environment's ``TK_SUPERVISOR_*`` (and
    ``TK_STUDIO_ROOT``) laid over this process's, whose block predates
    ``write_supervisor_env``. Only names are ever reported (NFR5)."""
    store = ctx.env_store
    if not ctx.plat.windows or store is None:
        return None
    names = list(SUPERVISOR_ENV_NAMES)
    lister = getattr(store, "names", None)
    if callable(lister):
        names += [n for n in lister() if n.upper().startswith("TK_SUPERVISOR_")]
    overlay = {}
    for name in dict.fromkeys(names):
        value = store.get(name)
        if value:
            overlay[name] = value
    return overlay


def start_slot(ctx: Ctx, slot: Path) -> list[str]:
    """The shortcut's command, detached: wt.exe returns once the tab is
    open; elsewhere a backgrounded shell."""
    if ctx.plat.windows:
        args = ["wt.exe", *_start_args(slot)]
    else:
        args = ["sh", "-c", 'cd "$1" && nohup pwsh -NoProfile -File '
                '"$1/start.ps1" >/dev/null 2>&1 &', "sh", str(slot)]
    try:
        proc = _run(ctx, args, _start_env(ctx))
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Refusal("SupervisorStartFailed", f"{args[0]}: "
                      f"{type(exc).__name__}: {exc}") from None
    if proc.returncode != 0:
        raise Refusal("SupervisorStartFailed", f"{args[0]} exit "
                      f"{proc.returncode}: {(proc.stderr or '').strip()}")
    return args


# --- the supervisor and studio-web legs -------------------------------------
#
# One update moves through four phases so the service is down for as short a
# time as possible and a refusal never leaves it down or half-pointed:
#   plan     - what changes (``unchanged`` / not shipped / source checkout)
#   prepare  - download + verify, unpack into the new slots, bun install, env
#              (no stop: a refusal here removes the new slots, nothing else)
#   commit   - stop the live slot, rename old slots aside, repoint
#              current.json (studio-web first), then write the shortcut
#   start    - start the supervisor and wait for /status
# A refusal after the stop rolls the renames and current.json back and
# restarts the old slot (best effort). Stale ``.previous`` slots are deleted
# only after a start this run observed.

@dataclass
class Plan:
    app: str
    entry: dict
    version: str
    new_slot: Path
    old_version: str | None
    old_slot: Path | None          # the live old slot: a dir, != new_slot
    previous: Path | None = None   # where old_slot was renamed aside


def _plan(ctx: Ctx, app: str, entry: dict) -> tuple[dict, Plan | None]:
    version = _version_of(entry, app)
    new_slot = ctx.root / app / version
    fields = {"version": version, "slot": str(new_slot), "url": entry["url"],
              "source": entry.get("source")}
    old_version, old_slot = _current_slot(ctx.root, app)
    if old_version == version and old_slot is not None and old_slot.is_dir():
        return {"status": "unchanged", **fields}, None
    live = old_slot is not None and old_slot.is_dir() and old_slot != new_slot
    return dict(fields), Plan(app, entry, version, new_slot,
                              old_version if live else None,
                              old_slot if live else None)


def plan_supervisor(ctx: Ctx, entry: dict | None, bun: dict
                    ) -> tuple[dict, Plan | None]:
    if entry is None:
        return {"status": NOT_SHIPPED}, None
    checkout = source_checkout(ctx)
    if checkout is not None:
        return {"status": "reported", "mode": "source checkout",
                "checkout": checkout,
                "detail": f"the supervisor runs from the git checkout "
                          f"{checkout} — reported, nothing replaced"}, None
    if not bun.get("exe"):
        return {"status": "skipped",
                "reason": "bun not shipped in this channel — the supervisor "
                          "needs the roster's pinned bun; nothing changed"}, None
    return _plan(ctx, SUPERVISOR, entry)


def plan_web(ctx: Ctx, entry: dict | None) -> tuple[dict, Plan | None]:
    if entry is None:
        return {"status": NOT_SHIPPED}, None
    return _plan(ctx, STUDIO_WEB, entry)


def fetch_and_unpack(ctx: Ctx, plan: Plan) -> None:
    data = fetch_verified(ctx, plan.app, plan.entry["url"],
                          plan.entry["sha256"], f"components.{plan.app}.sha256")
    unpack(open_zip(data, plan.app), plan.new_slot, plan.app)


def bun_install(ctx: Ctx, plan: Plan, bun_exe: str) -> None:
    cmd = [bun_exe, "install", "--frozen-lockfile", "--cwd", str(plan.new_slot)]
    try:
        proc = _run(ctx, cmd)
        failed = None if proc.returncode == 0 else \
            f"exit {proc.returncode}: {(proc.stderr or '').strip()[-400:]}"
    except (OSError, subprocess.TimeoutExpired) as exc:
        failed = f"{type(exc).__name__}: {exc}"
    if failed:
        kept = f"; the current slot {plan.old_slot} is untouched (not " \
            "stopped)" if plan.old_slot else ""
        raise Refusal("BunInstallFailed", f"bun install --frozen-lockfile in "
                      f"{plan.new_slot}: {failed}{kept}")


def swap(ctx: Ctx, plan: Plan) -> None:
    """Rename the live old slot aside, then repoint current.json; on a
    current.json failure the rename is undone."""
    if plan.old_slot is not None:
        previous = plan.old_slot.parent / f".{plan.old_version}.previous"
        _remove(previous)
        try:
            os.rename(plan.old_slot, previous)
        except OSError as exc:
            raise Refusal("SwapFailed", f"could not rename {plan.old_slot} -> "
                          f"{previous}: {exc}") from None
        plan.previous = previous
    try:
        write_current(ctx.root, plan.app, plan.version, plan.new_slot)
    except Refusal:
        if plan.previous is not None:
            try:
                os.rename(plan.previous, plan.old_slot)
                plan.previous = None
            except OSError:
                pass
        raise


def _read_current_bytes(root: Path) -> bytes | None:
    try:
        return (root / CURRENT).read_bytes()
    except OSError:
        return None


def rollback(ctx: Ctx, swapped: list[Plan], snapshot: bytes | None) -> str:
    """Undo this run's renames and restore current.json byte for byte; the
    text says what was restored (and what could not be)."""
    notes = []
    for plan in reversed(swapped):
        if plan.previous is None:
            continue
        try:
            os.rename(plan.previous, plan.old_slot)
            notes.append(f"{plan.app} slot {plan.old_slot} renamed back")
            plan.previous = None
        except OSError as exc:
            notes.append(f"{plan.app} slot still at {plan.previous} "
                         f"(rename back failed: {exc})")
    try:
        if snapshot is None:
            (ctx.root / CURRENT).unlink(missing_ok=True)
        else:
            _write_atomic(ctx.root / CURRENT, snapshot)
        notes.append(f"{ctx.root / CURRENT} restored")
    except OSError as exc:
        notes.append(f"{ctx.root / CURRENT} not restored: {exc}")
    return "; ".join(notes)


def discard_slots(plans: list[Plan]) -> str:
    """After a rollback: remove this run's new slots that never ran; the
    text names each, and any that could not be removed."""
    notes = []
    for plan in plans:
        if plan.new_slot == plan.old_slot or not (
                plan.new_slot.exists() or plugin_leg.is_link(plan.new_slot)):
            continue
        err = plugin_leg._try_remove(plan.new_slot)
        notes.append(f"new {plan.app} slot {plan.new_slot} removed"
                     if err is None else
                     f"new {plan.app} slot {plan.new_slot} could not be "
                     f"removed ({err})")
    return "; ".join(notes)


def kill_slot(ctx: Ctx, slot: Path) -> None:
    """Best effort: the processes whose command line names ``slot``."""
    for pid in _slot_pids(ctx, slot):
        args = ["taskkill", "/PID", str(pid), "/T", "/F"] if ctx.plat.windows \
            else ["kill", str(pid)]
        try:
            _run(ctx, args)
        except (OSError, subprocess.TimeoutExpired):
            pass


def start_and_probe(ctx: Ctx, slot: Path) -> str | None:
    """Start ``slot`` and wait for /status; the failure text, else None."""
    try:
        start_slot(ctx, slot)
    except Refusal as refusal:
        return refusal.detail
    url = probe_url(ctx)
    if not _wait(ctx, lambda: ctx.probe(url), ctx.start_timeout):
        return f"{slot} did not answer {url} within {ctx.start_timeout:g}s"
    return None


_UNREAD = object()      # the shortcut existed but could not be read


def read_shortcut(ctx: Ctx):
    """The Startup shortcut's bytes before this run writes it: None when
    there is none, ``_UNREAD`` when it exists but cannot be read."""
    lnk = shortcut_path(ctx)
    if lnk is None:
        return _UNREAD
    try:
        return lnk.read_bytes()
    except FileNotFoundError:
        return None
    except OSError:
        return _UNREAD


def restore_shortcut(ctx: Ctx, before) -> str:
    """Undo this run's shortcut write when no earlier slot exists to point
    it back at: restore the earlier bytes, or remove the one this run
    wrote. The text says which (or why neither)."""
    lnk = shortcut_path(ctx)
    if lnk is None:
        return "Startup shortcut not removed (APPDATA is not set)"
    if before is _UNREAD:
        return (f"Startup shortcut {lnk} not restored (its earlier contents "
                "could not be read)")
    try:
        if before is None:
            lnk.unlink(missing_ok=True)
            return f"Startup shortcut {lnk} removed"
        _write_atomic(lnk, before)
        return f"Startup shortcut {lnk} restored to its earlier contents"
    except OSError as exc:
        return f"Startup shortcut {lnk} not restored ({exc})"


def restart_old(ctx: Ctx, slot: Path | None, shortcut_moved: bool,
                shortcut_before=_UNREAD) -> str:
    if slot is None:
        if shortcut_moved:
            return (f"{restore_shortcut(ctx, shortcut_before)}; no earlier "
                    "slot to restart")
        return "no earlier slot to restart"
    notes = []
    if shortcut_moved:
        try:
            write_shortcut(ctx, slot)
            notes.append(f"Startup shortcut pointed back at {slot}")
        except Refusal as refusal:
            notes.append(f"Startup shortcut not restored ({refusal.reason})")
    failed = start_and_probe(ctx, slot)
    notes.append(f"old slot {slot} restarted and answering" if failed is None
                 else f"old slot {slot} restart failed ({failed})")
    return "; ".join(notes)


def apply_slots(ctx: Ctx, sup: dict, sup_plan: Plan | None, web: dict,
                web_plan: Plan | None, bun: dict, live_sup: Path | None
                ) -> bool:
    """Prepare, commit and start; fills ``sup`` / ``web`` and returns
    whether this run observed a successful start."""
    # read before write_supervisor_env may move the bind (or TLS / port):
    # the running service still listens where it started
    live_url = probe_url(ctx)
    if sup_plan is not None and sup_plan.old_slot is None:
        url = live_url
        if ctx.probe(url):
            raise Refusal("ServiceAlreadyRunning", f"{url} already answers "
                          "but no installed supervisor slot is live "
                          "(current.json names none) — stop whatever serves "
                          "it first; nothing changed")
    plans = [p for p in (sup_plan, web_plan) if p is not None]
    prepared: list[Path] = []
    env_report = None
    try:
        for plan in plans:
            fetch_and_unpack(ctx, plan)
            prepared.append(plan.new_slot)
        if sup_plan is not None:
            bun_install(ctx, sup_plan, bun["exe"])
            env_report = write_supervisor_env(ctx)
    except Refusal:
        for path in prepared:
            plugin_leg._try_remove(path)
        raise
    # the supervisor (re)starts when it changed, or when only studio-web
    # changed under a live slot-installed supervisor (it serves the new slot)
    restart = sup_plan.old_slot if sup_plan is not None else \
        (live_sup if web_plan is not None else None)
    must_start = sup_plan is not None or restart is not None
    stopped: list[int] = []
    if restart is not None:
        try:
            stopped = stop_slot(ctx, restart, [live_url, probe_url(ctx)])
        except Refusal:
            for path in prepared:
                plugin_leg._try_remove(path)
            raise
    snapshot = _read_current_bytes(ctx.root)
    swapped: list[Plan] = []
    shortcut = None
    shortcut_moved = False
    shortcut_before = _UNREAD
    try:
        for plan in (web_plan, sup_plan):     # studio-web first: the
            if plan is not None:              # supervisor reads it at start
                swap(ctx, plan)
                swapped.append(plan)
        if sup_plan is not None:
            if ctx.plat.windows and restart is None:
                # no earlier slot to point it back at: keep its bytes
                shortcut_before = read_shortcut(ctx)
            shortcut = write_shortcut(ctx, sup_plan.new_slot)
            shortcut_moved = ctx.plat.windows
    except Refusal as refusal:
        restored = rollback(ctx, swapped, snapshot)
        restarted = restart_old(ctx, restart, False)
        discarded = discard_slots(plans)          # none of them ever ran
        raise Refusal(refusal.name, f"{refusal.detail}; rolled back: "
                      f"{restored}; {restarted}"
                      + (f"; {discarded}" if discarded else "")) from None
    if not must_start:
        if web_plan is not None:
            web.update(status="installed", previous=str(web_plan.previous)
                       if web_plan.previous else None)
        return False
    target = sup_plan.new_slot if sup_plan is not None else restart
    failed = start_and_probe(ctx, target)
    if failed is not None:
        kill_slot(ctx, target)
        restored = rollback(ctx, swapped, snapshot)
        restarted = restart_old(ctx, restart, shortcut_moved, shortcut_before)
        # the failed supervisor slot stays; studio-web's new slot never ran
        discarded = discard_slots([web_plan] if web_plan is not None else [])
        raise Refusal("SupervisorStartFailed", f"{failed}; the failed slot "
                      f"{target} is left for inspection; rolled back: "
                      f"{restored}; {restarted}"
                      + (f"; {discarded}" if discarded else ""))
    url = probe_url(ctx)
    if sup_plan is not None:
        sup.update(status="installed", previous=str(sup_plan.previous)
                   if sup_plan.previous else None, stopped=stopped,
                   env=env_report, shortcut=shortcut, probe=url)
    else:
        sup.update(status="restarted", stopped=stopped, probe=url,
                   reason=f"studio-web changed: restarted {restart} to serve "
                          f"{web_plan.new_slot}")
    if web_plan is not None:
        web.update(status="installed", previous=str(web_plan.previous)
                   if web_plan.previous else None)
    return True


# --- the meta-CLI's own update ----------------------------------------------

def uv_exe(ctx: Ctx, uv_entry: dict | None) -> Path | None:
    tools = ctx.root / "tools"
    if uv_entry is not None:
        found = find_exe(tools / f"uv-{uv_entry['version']}", ctx.plat, "uv")
        if found is not None:
            return found
    for version in reversed(_tool_versions(ctx, "uv")):
        found = find_exe(tools / f"uv-{version}", ctx.plat, "uv")
        if found is not None:
            return found
    return None


def remove_old_cli(ctx: Ctx) -> dict | None:
    """``bin/.tk-studio.old``, left by the previous run's self-update, is
    deleted on the next run (Windows will not delete a running exe)."""
    old = ctx.root / "bin" / CLI_OLD
    if not (old.exists() or plugin_leg.is_link(old)):
        return None
    err = plugin_leg._try_remove(old)
    return {"path": str(old), "deleted": err is None,
            **({"error": err} if err else {})}


CLI_HELPER = "cli-update.cmd"
CLI_HELPER_LOG = "cli-update.log"
LOG_TAIL_LINES = 8


def remove_cli_helper(ctx: Ctx) -> dict | None:
    """``tools/cli-update.cmd`` (and its log), left by a previous run's
    Windows self-update, is reported and deleted on the next run. The log's
    last lines are reported so a failed scheduled install is visible; the
    log is kept while the running CLI is not yet the wheel's version. A
    helper that waits for this very process (scheduled by this run) or that
    has not run yet (no log while the versions still differ) is kept."""
    tools = ctx.root / "tools"
    helper, log = tools / CLI_HELPER, tools / CLI_HELPER_LOG
    if not helper.is_file():
        return None
    try:
        text = helper.read_text(encoding="utf-8", errors="replace")
    except OSError:
        text = ""
    if f'"PID eq {os.getpid()}"' in text:
        return None
    wheels = re.findall(r'([^"\\/]+\.whl)"', text)
    wheel = wheels[-1] if wheels else None
    wheel_version = wheel.split("-")[1] if wheel and wheel.count("-") >= 2 \
        else None
    installed = wheel_version is not None and wheel_version == ctx.cli_version
    report = {"path": str(helper), "wheel": wheel,
              "wheel_version": wheel_version, "installed": ctx.cli_version,
              "log": str(log) if log.is_file() else None, "log_tail": []}
    if log.is_file():
        try:
            lines = log.read_text(encoding="utf-8",
                                  errors="replace").splitlines()
            report["log_tail"] = [ln for ln in lines if ln.strip()][
                -LOG_TAIL_LINES:]
        except OSError as exc:
            report["log_tail"] = [f"unreadable: {exc}"]
    elif not installed:
        report.update(deleted=False, detail="the scheduled install has not "
                      "run yet (no log); kept")
        return report
    err = plugin_leg._try_remove(helper)
    report.update(deleted=err is None, **({"error": err} if err else {}))
    if log.is_file():
        if installed:
            log_err = plugin_leg._try_remove(log)
            report["log_kept"] = log_err is not None
            if log_err:
                report["log_error"] = log_err
        else:
            report["log_kept"] = True
    return report


def _cmd_quote(value: str) -> str:
    return '"' + value.replace('"', '') + '"'


def schedule_cli_install(ctx: Ctx, cmd: list[str], extra: Mapping[str, str],
                         wheel: Path) -> dict:
    """Windows: ``uv tool install --force`` replaces the tool environment
    whose python.exe runs this CLI (locked while it runs). A detached helper
    waits for this process to exit, then installs the verified wheel."""
    pid = os.getpid()
    tools = ctx.root / "tools"
    helper = tools / CLI_HELPER
    log = tools / CLI_HELPER_LOG
    # cmd.exe decodes each batch line in the console's code page as it reads
    # it (OEM by default): the helper is UTF-8, so the code page becomes
    # 65001 before the first line that carries a path (``C:\Users\José``).
    # ``start`` gives the helper its own console, so nothing else sees it.
    lines = ["@echo off", "chcp 65001 >nul", "setlocal",
             *(f'set "{k}={v}"' for k, v in extra.items()),
             "set /a tries=0", ":wait",
             f'tasklist /FI "PID eq {pid}" /NH 2>nul | find " {pid} " >nul',
             "if errorlevel 1 goto install",
             "set /a tries+=1",
             "if %tries% geq 120 goto install",
             "timeout /t 1 /nobreak >nul", "goto wait", ":install",
             " ".join(_cmd_quote(a) for a in cmd) + f" > {_cmd_quote(str(log))}"
             " 2>&1", ""]
    try:
        _write_atomic(helper, "\r\n".join(lines).encode("utf-8"))
    except OSError as exc:
        raise Refusal("FolderUnwritable", f"could not write {helper}: {exc}") \
            from None
    launch = ["cmd", "/c", "start", "tk-studio cli update", "/min", "cmd",
              "/c", str(helper)]
    # never through the capturing runner: the helper would inherit its pipes
    # and this process would wait for their EOF while the helper waits for
    # this process to exit
    failed = None
    try:
        ctx.spawn_detached(launch, dict(ctx.env) if ctx.explicit_env
                           else None)
    except (OSError, ValueError) as exc:
        failed = f"{type(exc).__name__}: {exc}"
    if failed:
        raise Refusal("CliUpdateFailed", f"could not launch {helper}: "
                      f"{failed}; the wheel {wheel} is verified — run "
                      f"{' '.join(cmd)} after this CLI exits")
    return {"wheel": str(wheel), "helper": str(helper), "log": str(log),
            "command": cmd, "waits_for_pid": pid,
            "detail": "installs once this process exits (Windows locks the "
                      "running tool environment)"}


def cli_leg(ctx: Ctx, entry: dict | None, uv_entry: dict | None) -> dict:
    if entry is None:
        return {"status": NOT_SHIPPED}
    version = _version_of(entry, "cli")
    fields = {"version": version, "installed": ctx.cli_version,
              "url": entry["url"], "source": entry.get("source")}
    if version == ctx.cli_version:
        return {"status": "unchanged", **fields}
    uv = uv_exe(ctx, uv_entry)
    if uv is None:
        raise Refusal("UvNotInstalled", f"no uv under {ctx.root / 'tools'} — "
                      "re-run the bootstrap (tools/installer/install.ps1 or "
                      "install.sh)")
    data = fetch_verified(ctx, "cli", entry["url"], entry["sha256"],
                          "components.cli.sha256")
    wheel = ctx.root / "tools" / "wheels" / entry["url"].rsplit("/", 1)[1]
    try:
        _write_atomic(wheel, data)
    except OSError as exc:
        raise Refusal("FolderUnwritable", f"could not write {wheel}: {exc}") \
            from None
    bin_dir = ctx.root / "bin"
    cmd = [str(uv), "tool", "install", "--force", str(wheel)]
    extra = {"UV_TOOL_BIN_DIR": str(bin_dir),
             "UV_TOOL_DIR": str(ctx.root / "tools" / "uv-tools")}
    if ctx.plat.windows:
        return {"status": "scheduled", **fields,
                **schedule_cli_install(ctx, cmd, extra, wheel)}
    exe = bin_dir / _exe(ctx.plat, "tk-studio")
    old = bin_dir / CLI_OLD
    moved = False
    if exe.exists():
        _remove(old)
        try:
            os.rename(exe, old)
            moved = True
        except OSError as exc:
            raise Refusal("CliUpdateFailed", f"could not rename {exe} -> "
                          f"{old}: {exc}") from None
    try:
        proc = _run(ctx, cmd, extra)
        failed = None if proc.returncode == 0 else \
            f"exit {proc.returncode}: {(proc.stderr or '').strip()[-400:]}"
    except (OSError, subprocess.TimeoutExpired) as exc:
        failed = f"{type(exc).__name__}: {exc}"
    if failed:
        if moved and not exe.exists():
            try:
                os.rename(old, exe)
            except OSError:
                pass
        raise Refusal("CliUpdateFailed", f"uv tool install --force {wheel}: "
                      f"{failed}")
    return {"status": "updated", **fields, "wheel": str(wheel),
            "old_exe": str(old) if moved else None}


# --- install / update orchestration -----------------------------------------

def blocked_reason(refusal: str, earlier: list[str]) -> str:
    """A blocked verb's reason: the refusal that ended it first (so the
    reason's ``<Name>:`` is the blocking one), then the reasons collected
    before it (e.g. the plugin leg's ``MarketplaceRemovalFailed``)."""
    return "; ".join([refusal, *[r for r in earlier if r]])


def run_legs(verb: str, result: dict, components: dict, ctx: Ctx) -> dict:
    """Legs 2-5 after the plugin leg's ``result``: bun (only with a
    supervisor), supervisor and studio-web (prepared, then committed
    together: studio-web is repointed before the supervisor starts), and on
    ``update`` the CLI itself. The first refusal ends the verb ``blocked``;
    later legs do not run."""
    out = dict(result)
    reasons = [result["reason"]] if result.get("reason") else []
    status = result["status"]
    artifacts = list(result.get("artifacts") or [])
    stale = {app: stale_slots(ctx.root, app) for app in SLOT_APPS}
    old_cli = remove_old_cli(ctx)
    # before cli_leg: a helper scheduled by this run is never touched
    cli_helper = remove_cli_helper(ctx)
    try:
        sup_entry = components.get(SUPERVISOR)
        checkout = source_checkout(ctx) if sup_entry is not None else None
        if sup_entry is None:
            out["bun"] = {"status": "skipped",
                          "reason": "no supervisor in this channel"}
        elif checkout is not None:
            # nothing is replaced on the dev box: no bun download to fail
            out["bun"] = {"status": "skipped",
                          "reason": f"the supervisor runs from the source "
                                    f"checkout {checkout} — bun not needed"}
        else:
            out["bun"] = bun_leg(ctx, components.get("bun"))
        sup, sup_plan = plan_supervisor(ctx, sup_entry, out["bun"])
        out["supervisor"] = sup
        web, web_plan = plan_web(ctx, components.get(STUDIO_WEB))
        out["studio_web"] = web               # kept on a refusal below too
        live_sup = None
        if sup.get("status") == "unchanged":
            live_sup = Path(sup["slot"])
        started = apply_slots(ctx, sup, sup_plan, web, web_plan, out["bun"],
                              live_sup)
        if sup.get("status") == "installed":
            artifacts.append(sup["slot"])
        if web.get("status") == "installed":
            artifacts.append(web["slot"])
        keep = {str(p.previous) for p in (sup_plan, web_plan)
                if p is not None and p.previous is not None}
        if started:
            deleted, failed = [], []
            for app in SLOT_APPS:
                for path in stale[app]:
                    if str(path) in keep or not path.exists():
                        continue
                    err = plugin_leg._try_remove(path)
                    (failed if err else deleted).append(err or str(path))
            sup["deleted_stale"] = deleted
            if failed:
                status = "partial" if status == "complete" else status
                reasons.append("StaleSlotDeleteFailed: " + "; ".join(failed))
        else:
            # no start observed this run: nothing is deleted, all listed
            for app, leg in ((SUPERVISOR, sup), (STUDIO_WEB, web)):
                left = stale_slots(ctx.root, app)
                if left:
                    leg["stale"] = [str(p) for p in left]
        if verb == "update":
            cli = out["cli"] = cli_leg(ctx, components.get("cli"),
                                       components.get("uv"))
            if old_cli:
                cli["old_removed"] = old_cli
            if cli_helper:
                cli["update_helper"] = cli_helper
        elif cli_helper:
            out["cli_update_helper"] = cli_helper
    except Refusal as refusal:
        out.update(status="blocked", reason=blocked_reason(refusal.reason,
                                                           reasons),
                   artifacts=artifacts)
        return out
    out.update(status=status, reason="; ".join(reasons) or None,
               artifacts=artifacts)
    return out


def link_skipped(verb: str, result: dict) -> dict:
    """``install --link`` is the developer path: it links the plugin only."""
    out = dict(result)
    note = {"status": "skipped", "reason": "--link links the plugin only"}
    for key in ("bun", "supervisor", "studio_web"):
        out[key] = dict(note)
    return out


# --- doctor and status -------------------------------------------------------

def _slot_report(ctx: Ctx, app: str) -> dict:
    version, path = _current_slot(ctx.root, app)
    if version is not None and path is not None and path.is_dir():
        return {"mode": "slot", "version": version, "path": str(path)}
    return {"mode": NOT_INSTALLED}


def supervisor_report(ctx: Ctx) -> dict:
    checkout = source_checkout(ctx)
    if checkout is not None:
        return {"mode": "source checkout", "checkout": checkout,
                "summary": f"source checkout {checkout} — tk-studio update "
                           "reports, never replaces"}
    report = _slot_report(ctx, SUPERVISOR)
    stale = stale_slots(ctx.root, SUPERVISOR)
    if stale:
        report["stale"] = [str(p) for p in stale]
    return report


def doctor_fields(ctx: Ctx) -> dict:
    return {"root": str(ctx.root), "supervisor": supervisor_report(ctx),
            "studio_web": _slot_report(ctx, STUDIO_WEB)}


def _tool_versions(ctx: Ctx, name: str) -> list[str]:
    tools = ctx.root / "tools"
    found = []
    if tools.is_dir():
        for child in tools.iterdir():
            m = _VERSION_DIR.fullmatch(child.name)
            if m and m.group(1) == name and find_exe(child, ctx.plat, name):
                found.append(tuple(int(x) for x in m.groups()[1:]))
    return [".".join(map(str, v)) for v in sorted(found)]


def _plugin_installed(env: Mapping[str, str] | None) -> str:
    report = plugin_leg.doctor(env)
    if report["mode"] == "link":
        return f"link {report.get('link_target')}"
    if report["mode"] == "written":
        return report.get("version") or "unknown version"
    return NOT_INSTALLED


def status(ctx: Ctx, components: dict, env: Mapping[str, str] | None) -> dict:
    """Installed vs roster for every component; read-only."""
    table: dict[str, dict] = {}
    for name in STATUS_COMPONENTS:
        entry = components.get(name)
        if entry is None:
            roster = "not shipped"
        elif name in TAG_PREFIXES:
            roster = _version_of(entry, name)
        else:
            roster = entry["version"]
        if name == "plugin":
            installed = _plugin_installed(env)
        elif name == SUPERVISOR:
            report = supervisor_report(ctx)
            installed = f"source checkout {report['checkout']}" \
                if report["mode"] == "source checkout" \
                else report.get("version", NOT_INSTALLED)
        elif name == STUDIO_WEB:
            installed = _slot_report(ctx, STUDIO_WEB).get("version",
                                                         NOT_INSTALLED)
        elif name == "cli":
            installed = ctx.cli_version
        else:
            versions = _tool_versions(ctx, name)
            installed = roster if roster in versions else \
                (versions[-1] if versions else NOT_INSTALLED)
        table[name] = {"installed": installed, "roster": roster}
    lines = [f"{name:<11} installed {row['installed']:<24} roster "
             f"{row['roster']}" for name, row in table.items()]
    return {"status": "complete", "intent": "tk-studio-cli-status",
            "artifacts": [], "reason": None, "root": str(ctx.root),
            "components": table, "_lines": lines}
