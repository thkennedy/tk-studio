"""The meta-CLI's app legs (Story 25.4, AD-21): bun, the supervisor,
studio-web, the CLI's own update, ``status`` and ``doctor``.

One test per row of the story's I/O matrix and per verb. Offline by
construction: a fake release host serves bytes from memory, one fake runner
stands in for ``claude``, ``bun``, ``uv``, ``ps``/``kill``, ``pwsh``,
``wt.exe`` and ``tailscale``, the probe and clock are fakes, every path
lives under a temp dir, and a socket guard fails any connection attempt.
Every fixture roster passes the one roster guard.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import socket
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"))
import drift_check  # noqa: E402

CLI_ROOT = REPO_ROOT / "tools" / "installer" / "cli"
sys.path.insert(0, str(CLI_ROOT))
from tk_studio_cli import apps, plugin_leg  # noqa: E402  (repo-side)
from tk_studio_cli import main as cli_main  # noqa: E402
from tk_studio_cli import roster_guard as cli_guard  # noqa: E402

ROSTERS = REPO_ROOT / "tools" / "installer" / "rosters"
HOME = "thkennedy/tk-studio"
LINUX = apps.Platform("linux", "x86_64")
WINDOWS = apps.Platform("windows", "x86_64")
BUN_VERSION = "1.4.3"
UV_VERSION = "0.13.1"
NOT_SHIPPED = "not shipped in this channel"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, body in files.items():
            zf.writestr(name, body)
    return buf.getvalue()


def release_url(component: str, version: str, asset: str,
                repo: str = HOME) -> str:
    tag = f"{apps.TAG_PREFIXES[component]}{version}"
    return f"https://github.com/{repo}/releases/download/{tag}/{asset}"


def lnk_bytes(workdir: str, *, extras: bool = False) -> bytes:
    """A minimal MS-SHLLINK file whose StringData carries WorkingDirectory."""
    flags = 0x10 | 0x80
    tail = b""
    if extras:     # an IDList, a LinkInfo and a NAME_STRING before it
        flags |= 0x01 | 0x02 | 0x04
        tail += struct.pack("<H", 4) + b"\x01\x02\x03\x04"
        tail += struct.pack("<I", 8) + b"\x00" * 4
        name = "tk-studio supervisor"
        tail += struct.pack("<H", len(name)) + name.encode("utf-16-le")
    header = bytearray(76)
    struct.pack_into("<I", header, 0, 0x4C)
    struct.pack_into("<I", header, 20, flags)
    return bytes(header) + tail + struct.pack("<H", len(workdir)) \
        + workdir.encode("utf-16-le")


class FakeFetch:
    def __init__(self):
        self.blobs: dict[str, bytes] = {}
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url not in self.blobs:
            raise OSError(f"404 {url}")
        return self.blobs[url]


class FakeStore:
    """The Windows User environment (HKCU\\Environment)."""

    def __init__(self, values: dict | None = None):
        self.values = dict(values or {})
        self.broadcasts = 0

    def get(self, name):
        return self.values.get(name)

    def set(self, name, value):
        self.values[name] = value

    def broadcast(self):
        self.broadcasts += 1


class FakeSpawn:
    """The detached spawner: records each launch, never runs anything."""

    def __init__(self):
        self.calls: list[tuple[list[str], dict | None]] = []
        self.error: Exception | None = None

    def __call__(self, args, env=None):
        self.calls.append(([str(a) for a in args],
                           dict(env) if env is not None else None))
        if self.error is not None:
            raise self.error


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


def done(args, rc=0, out="", err=""):
    return subprocess.CompletedProcess(args, rc, out, err)


class FakeHost:
    """Every process the legs start, plus the service's /status."""

    def __init__(self):
        self.calls: list[tuple[list[str], dict | None]] = []
        self.procs: dict[int, str] = {}
        self.up = False
        self.sticky = False          # the service survives the kill
        self.fail_start = False
        self.fail_slots: set[str] = set()   # starts of these slots fail
        self.root: Path | None = None
        self.starts: list[tuple[str, dict | None]] = []  # slot, current.json
        self.bun_rc = 0
        self.uv_rc = 0
        self.tailscale: str | None = "100.64.0.5"
        self.next_pid = 4000
        self.probes: list[str] = []
        self.answering: set[str] = set()    # URLs that answer regardless
        self.fail_shortcut_slots: set[str] = set()
        self.query_pid = 7777               # the Get-CimInstance pwsh
        self.startup_lnk: Path | None = None  # CreateShortcut writes it
        self.claude_rc = 0

    def probe(self, url: str) -> bool:
        self.probes.append(url)
        return self.up or url in self.answering

    def names(self) -> list[str]:
        return [Path(a[0]).name for a, _ in self.calls]

    def __call__(self, args, env=None):
        args = [str(a) for a in args]
        self.calls.append((args, dict(env) if env is not None else None))
        name = Path(args[0]).name
        if name in ("bun", "bun.exe"):
            slot = Path(args[args.index("--cwd") + 1])
            (slot / "node_modules").mkdir()
            return done(args, self.bun_rc, err="lockfile drift"
                        if self.bun_rc else "")
        if name == "ps":
            return done(args, 0, "\n".join(f"{p} {c}" for p, c
                                           in self.procs.items()))
        if name in ("kill", "taskkill"):
            pid = int(args[1] if name == "kill" else args[2])
            self.procs.pop(pid, None)
            if not self.sticky:
                self.up = False
            return done(args)
        if name in ("sh", "wt.exe"):
            slot = args[-1] if name == "sh" else str(Path(args[-1]).parent)
            current = self.root / "current.json" if self.root else None
            self.starts.append((slot, json.loads(current.read_text())
                                if current and current.exists() else None))
            if not self.fail_start and slot not in self.fail_slots:
                self.up = True
                self.procs[self.next_pid] = f"pwsh -File {slot}/start.ps1"
                self.next_pid += 1
            return done(args)
        if name in ("pwsh", "powershell"):
            script = args[-1]
            if "CreateShortcut" in script:
                workdir = re.search(r"WorkingDirectory='([^']*)'",
                                    script).group(1)
                if workdir in self.fail_shortcut_slots:
                    return done(args, 1, err="COM error")
                if self.startup_lnk is not None:
                    self.startup_lnk.parent.mkdir(parents=True, exist_ok=True)
                    self.startup_lnk.write_bytes(lnk_bytes(workdir))
                return done(args, 0, "C:\\Startup\\tk-studio supervisor.lnk\n")
            if "Get-CimInstance" in script:
                # the query's own pwsh names the needle; only an explicit
                # $PID exclusion keeps it out
                needle = re.search(r"\[regex\]::Escape\('((?:[^']|'')*)'\)",
                                   script).group(1).replace("''", "'")
                bounded = re.compile(re.escape(needle) + apps._SLOT_END,
                                     re.IGNORECASE)
                table = dict(self.procs)
                table[self.query_pid] = f"pwsh -Command {script}"
                if "$_.ProcessId -ne $PID" in script:
                    del table[self.query_pid]
                return done(args, 0, "\n".join(
                    str(p) for p, c in table.items() if bounded.search(c)))
            raise AssertionError(f"unexpected script {script}")
        if name == "tailscale.exe":
            if self.tailscale is None:
                raise FileNotFoundError(args[0])
            return done(args, 0, self.tailscale + "\n")
        if name in ("uv", "uv.exe"):
            bin_dir = Path(env["UV_TOOL_BIN_DIR"])
            bin_dir.mkdir(parents=True, exist_ok=True)
            if not self.uv_rc:
                (bin_dir / ("tk-studio.exe" if name.endswith(".exe")
                            else "tk-studio")).write_text("new cli")
            return done(args, self.uv_rc)
        if name == "claude":
            return done(args, self.claude_rc,
                        err="marketplace busy" if self.claude_rc else "")
        if name == "cmd":
            raise AssertionError("a detached launch went through the "
                                 f"capturing runner: {args}")
        raise AssertionError(f"unexpected command {args}")


class AppsCase(unittest.TestCase):
    plat = LINUX

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.config = self.tmp / "config"
        self.config.mkdir()
        if self.plat.windows:
            self.env = {"CLAUDE_CONFIG_DIR": str(self.config),
                        "LOCALAPPDATA": str(self.tmp / "local"),
                        "APPDATA": str(self.tmp / "roaming"),
                        "SystemDrive": str(self.tmp / "drive"),
                        "ProgramFiles": str(self.tmp / "pf")}
            self.root = self.tmp / "local" / "tk-studio"
        else:
            self.env = {"CLAUDE_CONFIG_DIR": str(self.config),
                        "XDG_DATA_HOME": str(self.tmp / "data"),
                        "HOME": str(self.tmp / "home")}
            self.root = self.tmp / "data" / "tk-studio"
        self.fetch = FakeFetch()
        self.host = FakeHost()
        self.host.root = self.root
        self.spawn = FakeSpawn()
        self.store = FakeStore()
        self.clock = FakeClock()
        self.cli_version = "0.1.0"
        patcher = mock.patch.object(Path, "home",
                                    return_value=self.tmp / "home")
        patcher.start()
        self.addCleanup(patcher.stop)
        self._no_network()

    def _no_network(self):
        def refuse(*a, **kw):
            raise AssertionError(f"network call attempted: {a!r}")
        for target, attr in ((socket.socket, "connect"),
                             (socket.socket, "connect_ex"),
                             (socket, "create_connection"),
                             (socket, "getaddrinfo")):
            patcher = mock.patch.object(target, attr, side_effect=refuse)
            patcher.start()
            self.addCleanup(patcher.stop)

    # --- the fake release host -------------------------------------------

    def plugin(self, version="0.2.16") -> dict:
        data = make_zip({".claude-plugin/plugin.json": json.dumps(
            {"name": "tk-studio", "version": version}),
            "skills/tk-studio-activate/SKILL.md": f"# v{version}\n"})
        url = release_url("plugin", version, f"tk-studio-{version}.zip")
        self.fetch.blobs[url] = data
        return {"tag": f"tk-studio--v{version}", "url": url,
                "sha256": sha(data)}

    def supervisor(self, version="0.1.0", repo=HOME) -> dict:
        data = make_zip({"start.ps1": f"# supervisor {version}\n",
                         "package.json": json.dumps({"version": version}),
                         "bun.lock": "{}\n", "src/server.ts": "// v\n"})
        url = release_url("supervisor", version, f"supervisor-{version}.zip",
                          repo)
        self.fetch.blobs[url] = data
        entry = {"tag": f"supervisor--v{version}", "url": url,
                 "sha256": sha(data)}
        if repo != HOME:
            entry["source"] = repo
        return entry

    def web(self, version="0.1.0") -> dict:
        data = make_zip({"index.html": f"<p>web {version}</p>",
                         "_next/app.js": "//\n"})
        url = release_url("studio-web", version, f"studio-web-{version}.zip")
        self.fetch.blobs[url] = data
        return {"tag": f"studio-web--v{version}", "url": url,
                "sha256": sha(data)}

    def bun(self) -> dict:
        digests = {}
        for target, asset in (("x86_64-unknown-linux-gnu", "bun-linux-x64"),
                              ("x86_64-pc-windows-msvc", "bun-windows-x64")):
            exe = "bun.exe" if "windows" in target else "bun"
            data = make_zip({f"{asset}/{exe}": f"bun {target}"})
            self.fetch.blobs[apps.BUN_URL.format(
                v=BUN_VERSION, asset=f"{asset}.zip")] = data
            digests[target] = sha(data)
        digests["aarch64-apple-darwin"] = sha(b"darwin bun, never served")
        return {"version": BUN_VERSION, "sha256": digests}

    def uv(self) -> dict:
        return {"version": UV_VERSION, "sha256": {
            "x86_64-pc-windows-msvc": sha(b"uv windows"),
            "x86_64-unknown-linux-gnu": sha(b"uv linux")}}

    def cli(self, version="0.2.0") -> dict:
        data = b"PK wheel " + version.encode()
        url = release_url("cli", version,
                          f"tk_studio_cli-{version}-py3-none-any.whl")
        self.fetch.blobs[url] = data
        return {"tag": f"cli--v{version}", "url": url, "sha256": sha(data)}

    def roster(self, **components) -> Path:
        roster = {"schema": 1, "channel": "stable",
                  "requires": {"claude-code": ">=2.1.224"},
                  "components": {k.replace("_", "-"): v
                                 for k, v in components.items()}}
        self.assertEqual(drift_check.roster_problems(roster), [],
                         "fixture roster must pass the roster guard")
        self.assertEqual(cli_guard.roster_problems(roster), [])
        path = self.tmp / f"roster-{len(list(self.tmp.glob('roster-*')))}.json"
        path.write_text(json.dumps(roster), encoding="utf-8")
        return path

    def full_roster(self, sup="0.1.0", web="0.1.0", **extra) -> Path:
        parts = dict(plugin=self.plugin(), supervisor=self.supervisor(sup),
                     studio_web=self.web(web), bun=self.bun(), uv=self.uv())
        parts.update(extra)
        return self.roster(**{k: v for k, v in parts.items() if v is not None})

    def seed_uv(self):
        uv = self.root / "tools" / f"uv-{UV_VERSION}"
        uv.mkdir(parents=True)
        (uv / "uv").write_text("uv")
        (self.root / "bin").mkdir()
        (self.root / "bin" / "tk-studio").write_text("old")

    # --- running ------------------------------------------------------------

    def tamper(self, url):
        self.fetch.blobs[url] = self.fetch.blobs[url] + b"tampered"

    def run_cli(self, argv, **kw):
        params = dict(fetch=self.fetch, runner=self.host, env=self.env,
                      platform=self.plat, probe=self.host.probe,
                      env_store=self.store, sleep=self.clock.sleep,
                      clock=self.clock.now, spawn_detached=self.spawn,
                      cli_version=self.cli_version)
        params.update(kw)
        return cli_main.run(argv, **params)

    def main_out(self, argv) -> tuple[list[str], dict, int]:
        out = io.StringIO()
        with redirect_stdout(out):
            code = cli_main.main(argv, fetch=self.fetch, runner=self.host,
                                 env=self.env, platform=self.plat,
                                 probe=self.host.probe, env_store=self.store,
                                 sleep=self.clock.sleep, clock=self.clock.now,
                                 spawn_detached=self.spawn,
                                 cli_version=self.cli_version)
        lines = out.getvalue().strip().splitlines()
        return lines[:-1], json.loads(lines[-1]), code

    def current(self) -> dict:
        return json.loads((self.root / "current.json")
                          .read_text(encoding="utf-8"))

    def slot(self, app, version) -> Path:
        return self.root / app / version

    def tree(self) -> list[str]:
        return sorted(str(p.relative_to(self.root))
                      for p in self.root.rglob("*")) \
            if self.root.exists() else []


class FreshInstall(AppsCase):
    def test_fresh_install_runs_every_leg_in_order(self):
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        # the plugin leg still runs inside install, its fields top-level
        self.assertEqual(result["version_written"], "0.2.16")
        self.assertTrue((self.config / "skills" / "tk-studio").is_dir())
        # bun unpacked to tools/bun-<v>/
        self.assertEqual(result["bun"]["status"], "installed")
        bun = self.root / "tools" / f"bun-{BUN_VERSION}"
        self.assertTrue((bun / "bun-linux-x64" / "bun").is_file())
        # the supervisor slot unpacked, bun install run there
        sup = result["supervisor"]
        self.assertEqual(sup["status"], "installed")
        slot = self.slot("supervisor", "0.1.0")
        self.assertTrue((slot / "start.ps1").is_file())
        self.assertTrue((slot / "node_modules").is_dir())
        bun_calls = [a for a, _ in self.host.calls if Path(a[0]).name == "bun"]
        self.assertEqual(bun_calls, [[str(bun / "bun-linux-x64" / "bun"),
                                      "install", "--frozen-lockfile",
                                      "--cwd", str(slot)]])
        self.assertEqual(sup["env"], {"status": "skipped: windows only"})
        self.assertEqual(sup["shortcut"], {"status": "skipped: windows only"})
        # started and /status answered
        self.assertTrue(self.host.up)
        self.assertEqual(sup["probe"], "http://127.0.0.1:8787/status")
        # studio-web in its own slot; current.json names both
        self.assertEqual(result["studio_web"]["status"], "installed")
        self.assertTrue((self.slot("studio-web", "0.1.0") / "index.html")
                        .is_file())
        self.assertEqual(self.current(), {
            "supervisor": {"version": "0.1.0", "path": str(slot)},
            "studio-web": {"version": "0.1.0",
                           "path": str(self.slot("studio-web", "0.1.0"))}})
        self.assertNotIn("cli", result, "install never self-updates")
        self.assertIn(str(slot), result["artifacts"])
        # the order: bun install → start (the plugin leg ran first)
        names = self.host.names()
        self.assertLess(names.index("bun"), names.index("sh"))
        self.assertFalse(any(p.name.endswith(".new")
                             for p in self.root.rglob("*")))

    def test_main_ends_with_one_json_line(self):
        lines, last, code = self.main_out(["install", "--roster",
                                           str(self.full_roster())])
        self.assertEqual((code, last["status"]), (0, "complete"))
        self.assertEqual(last["intent"], "tk-studio-cli-install")
        self.assertEqual(lines, [])

    def test_same_version_is_unchanged(self):
        roster = str(self.full_roster())
        self.run_cli(["install", "--roster", roster])
        calls = len(self.host.calls)
        before = self.tree()
        result, code = self.run_cli(["update", "--roster", roster])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        for leg in ("bun", "supervisor", "studio_web"):
            self.assertEqual(result[leg]["status"], "unchanged", leg)
        self.assertEqual(self.host.calls[calls:], [], "nothing stopped")
        self.assertEqual(self.tree(), before, "nothing renamed")

    def test_not_shipped_legs_change_nothing(self):
        roster = self.roster(plugin=self.plugin())
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(result["supervisor"], {"status": NOT_SHIPPED})
        self.assertEqual(result["studio_web"], {"status": NOT_SHIPPED})
        self.assertEqual(result["cli"], {"status": NOT_SHIPPED})
        self.assertEqual(result["bun"]["status"], "skipped")
        self.assertFalse(self.root.exists())
        self.assertEqual(self.host.calls, [])

    def test_supervisor_without_bun_changes_nothing(self):
        roster = self.roster(plugin=self.plugin(),
                             supervisor=self.supervisor())
        result, code = self.run_cli(["install", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["bun"], {"status": NOT_SHIPPED})
        self.assertEqual(result["supervisor"]["status"], "skipped")
        self.assertIn("bun not shipped", result["supervisor"]["reason"])
        self.assertFalse((self.root / "supervisor").exists())

    def test_foreign_source_downloads_from_entry_url(self):
        entry = self.supervisor(repo="thkennedy/tk-studio-supervisor")
        roster = self.roster(plugin=self.plugin(), supervisor=entry,
                             bun=self.bun())
        result, code = self.run_cli(["install", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertIn(entry["url"], self.fetch.calls)
        self.assertEqual(result["supervisor"]["source"],
                         "thkennedy/tk-studio-supervisor")

    def test_link_mode_links_the_plugin_only(self):
        checkout = self.tmp / "co"
        manifest = checkout / "plugins" / "tk-studio" / ".claude-plugin"
        manifest.mkdir(parents=True)
        (manifest / "plugin.json").write_text('{"version": "9.9.9"}')
        result, code = self.run_cli(["install", "--link", str(checkout)])
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["mode"], "link")
        self.assertEqual(result["supervisor"]["status"], "skipped")
        self.assertEqual(self.fetch.calls, [])


class Update(AppsCase):
    def install_v1(self):
        result, _ = self.run_cli(["install", "--roster",
                                  str(self.full_roster())])
        self.assertEqual(result["status"], "complete", result)
        self.host.procs[999] = "bun run /elsewhere/other-app/server.ts"
        self.calls_before = len(self.host.calls)

    def update_v2(self):
        return self.run_cli(["update", "--roster",
                             str(self.full_roster("0.2.0", "0.2.0"))])

    def test_update_stops_swaps_and_starts(self):
        self.install_v1()
        old = self.slot("supervisor", "0.1.0")
        result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        sup = result["supervisor"]
        self.assertEqual(sup["status"], "installed")
        # stopped only the processes whose command line names the old slot
        kills = [a for a, _ in self.host.calls[self.calls_before:]
                 if a[0] == "kill"]
        self.assertEqual(len(kills), 1)
        self.assertEqual(sup["stopped"], [4000])
        self.assertIn(999, self.host.procs, "never a match by name")
        # old slot aside, current.json moved, new slot answering
        aside = self.root / "supervisor" / ".0.1.0.previous"
        self.assertTrue(aside.is_dir())
        self.assertFalse(old.exists())
        self.assertEqual(sup["previous"], str(aside))
        self.assertEqual(self.current()["supervisor"]["version"], "0.2.0")
        self.assertEqual(self.current()["studio-web"]["version"], "0.2.0")
        self.assertTrue((self.root / "studio-web" / ".0.1.0.previous")
                        .is_dir())
        self.assertTrue(self.host.up)
        # order: bun install (service still up) → ps → kill → start
        names = self.host.names()[self.calls_before:]
        self.assertEqual([n for n in names if n != "claude"],
                         ["bun", "ps", "kill", "sh"])

    def test_service_still_running_renames_nothing(self):
        self.install_v1()
        self.host.sticky = True
        before = self.tree()
        result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("ServiceStillRunning:"),
                        result["reason"])
        self.assertEqual(self.tree(), before)
        self.assertEqual(self.current()["supervisor"]["version"], "0.1.0")
        # the leg dict it had is kept; it never reached ``installed``
        self.assertEqual(result["studio_web"]["version"], "0.2.0")
        self.assertNotIn("status", result["studio_web"])

    def test_stale_slot_deleted_after_successful_start(self):
        self.install_v1()
        stale_sup = self.root / "supervisor" / ".0.0.9.previous"
        stale_web = self.root / "studio-web" / ".0.0.9.previous"
        for path in (stale_sup, stale_web):
            path.mkdir()
            (path / "f").write_text("x")
        result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(sorted(result["supervisor"]["deleted_stale"]),
                         sorted([str(stale_sup), str(stale_web)]))
        self.assertFalse(stale_sup.exists() or stale_web.exists())
        self.assertTrue((self.root / "supervisor" / ".0.1.0.previous")
                        .is_dir(), "this run's previous is kept")

    def test_stale_delete_failure_is_partial_naming_path(self):
        self.install_v1()
        stale = self.root / "supervisor" / ".0.0.9.previous"
        stale.mkdir()
        real = plugin_leg.remove_path

        def remove(path):
            if Path(path) == stale:
                raise PermissionError("in use")
            return real(path)
        with mock.patch.object(plugin_leg, "remove_path", side_effect=remove):
            result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (0, "partial"))
        self.assertTrue(result["reason"].startswith("StaleSlotDeleteFailed:"))
        self.assertIn(str(stale), result["reason"])
        self.assertEqual(self.current()["supervisor"]["version"], "0.2.0")

    def test_stale_slot_kept_when_nothing_starts(self):
        self.install_v1()
        stale = self.root / "supervisor" / ".0.0.9.previous"
        stale.mkdir()
        result, _ = self.run_cli(["update", "--roster",
                                  str(self.full_roster())])
        self.assertEqual(result["supervisor"]["status"], "unchanged")
        self.assertEqual(result["supervisor"]["stale"], [str(stale)])
        self.assertTrue(stale.is_dir())

    def test_start_failure_rolls_back_and_restarts_old_slot(self):
        self.install_v1()
        new = self.slot("supervisor", "0.2.0")
        self.host.fail_slots.add(str(new))
        result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (1, "blocked"))
        reason = result["reason"]
        self.assertTrue(reason.startswith("SupervisorStartFailed:"), reason)
        self.assertIn(str(new), reason)
        self.assertIn("renamed back", reason)
        self.assertIn("restarted and answering", reason)
        old = self.slot("supervisor", "0.1.0")
        self.assertTrue(old.is_dir())
        self.assertFalse((self.root / "supervisor" / ".0.1.0.previous")
                         .exists())
        self.assertTrue(self.slot("studio-web", "0.1.0").is_dir())
        self.assertTrue(new.is_dir(), "the failed slot is left for inspection")
        web_new = self.slot("studio-web", "0.2.0")
        self.assertFalse(web_new.exists())
        self.assertIn(f"new studio-web slot {web_new} removed", reason)
        self.assertEqual(self.current()["supervisor"],
                         {"version": "0.1.0", "path": str(old)})
        self.assertEqual(self.current()["studio-web"]["version"], "0.1.0")
        self.assertEqual(self.host.starts[-1][0], str(old))
        self.assertTrue(self.host.up)
        self.assertGreaterEqual(self.clock.t, apps.START_TIMEOUT)
        # the next update retries instead of reading "unchanged"
        self.host.fail_slots.clear()
        result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(result["supervisor"]["status"], "installed")
        self.assertEqual(self.current()["supervisor"]["version"], "0.2.0")

    def test_start_failure_on_fresh_install_restores_current(self):
        self.host.fail_start = True
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("SupervisorStartFailed:"))
        self.assertIn("no earlier slot to restart", result["reason"])
        self.assertFalse((self.root / "current.json").exists())

    def test_missing_slot_dir_is_not_unchanged(self):
        self.install_v1()
        slot = self.slot("supervisor", "0.1.0")
        plugin_leg.remove_path(slot)
        self.host.up = False
        result, code = self.run_cli(["update", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(result["supervisor"]["status"], "installed")
        self.assertTrue((slot / "start.ps1").is_file())

    def test_fresh_install_refuses_when_something_already_answers(self):
        self.host.up = True
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("ServiceAlreadyRunning:"),
                        result["reason"])
        self.assertIn("http://127.0.0.1:8787/status", result["reason"])
        self.assertFalse((self.root / "supervisor").exists())
        self.assertFalse((self.root / "studio-web").exists())
        self.assertFalse((self.root / "current.json").exists())
        self.assertNotIn("sh", self.host.names())

    def test_web_repointed_before_supervisor_starts(self):
        self.install_v1()
        result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        slot, current = self.host.starts[-1]
        self.assertEqual(slot, str(self.slot("supervisor", "0.2.0")))
        web = self.slot("studio-web", "0.2.0")
        self.assertEqual(current["studio-web"],
                         {"version": "0.2.0", "path": str(web)})
        self.assertTrue(web.is_dir())

    def test_web_only_update_restarts_live_supervisor(self):
        self.install_v1()
        stale_web = self.root / "studio-web" / ".0.0.9.previous"
        stale_web.mkdir()
        result, code = self.run_cli(["update", "--roster", str(
            self.full_roster("0.1.0", "0.2.0"))])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        sup = result["supervisor"]
        self.assertEqual(sup["status"], "restarted")
        self.assertEqual(sup["stopped"], [4000])
        names = [n for n in self.host.names()[self.calls_before:]
                 if n != "claude"]
        self.assertEqual(names, ["ps", "kill", "sh"])
        slot, current = self.host.starts[-1]
        self.assertEqual(slot, str(self.slot("supervisor", "0.1.0")))
        self.assertEqual(current["studio-web"]["version"], "0.2.0")
        self.assertEqual(result["studio_web"]["status"], "installed")
        # a start was observed: the stale web slot goes, this run's stays
        self.assertEqual(sup["deleted_stale"], [str(stale_web)])
        self.assertTrue((self.root / "studio-web" / ".0.1.0.previous")
                        .is_dir())
        self.assertTrue(self.host.up)

    def test_web_only_without_supervisor_keeps_previous_slots(self):
        roster = self.roster(plugin=self.plugin(), studio_web=self.web())
        self.run_cli(["install", "--roster", str(roster)])
        stale = self.root / "studio-web" / ".0.0.9.previous"
        stale.mkdir()
        result, code = self.run_cli(["update", "--roster", str(self.roster(
            plugin=self.plugin(), studio_web=self.web("0.2.0")))])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        web = result["studio_web"]
        self.assertEqual(web["status"], "installed")
        aside = self.root / "studio-web" / ".0.1.0.previous"
        self.assertEqual(web["stale"], sorted([str(stale), str(aside)]))
        self.assertTrue(stale.is_dir() and aside.is_dir())
        self.assertNotIn("sh", self.host.names())

    def test_swap_failure_restarts_old_slot(self):
        self.install_v1()
        old = self.slot("supervisor", "0.1.0")
        real = apps.os.rename

        def rename(src, dst):
            if Path(src) == old:
                raise PermissionError("in use")
            return real(src, dst)
        with mock.patch.object(apps.os, "rename", side_effect=rename):
            result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("SwapFailed:"),
                        result["reason"])
        self.assertIn("restarted and answering", result["reason"])
        self.assertEqual(self.current()["supervisor"]["version"], "0.1.0")
        self.assertEqual(self.current()["studio-web"]["version"], "0.1.0")
        self.assertTrue(self.slot("studio-web", "0.1.0").is_dir())
        self.assertEqual(self.host.starts[-1][0], str(old))
        self.assertTrue(self.host.up)
        for app in ("supervisor", "studio-web"):
            new = self.slot(app, "0.2.0")
            self.assertFalse(new.exists(), app)
            self.assertIn(f"new {app} slot {new} removed", result["reason"])
        self.assertEqual(result["studio_web"]["version"], "0.2.0")

    def test_unremovable_new_slot_is_named(self):
        self.install_v1()
        old = self.slot("supervisor", "0.1.0")
        web_new = self.slot("studio-web", "0.2.0")
        real_rename, real_remove = apps.os.rename, plugin_leg.remove_path
        swap_failed = []

        def rename(src, dst):
            if Path(src) == old:
                swap_failed.append(src)
                raise PermissionError("in use")
            return real_rename(src, dst)

        def remove(path):    # only the rollback's removal fails
            if swap_failed and Path(path) == web_new:
                raise PermissionError("locked")
            return real_remove(path)
        with mock.patch.object(apps.os, "rename", side_effect=rename), \
                mock.patch.object(plugin_leg, "remove_path",
                                  side_effect=remove):
            result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertIn(f"new studio-web slot {web_new} could not be removed",
                      result["reason"])
        self.assertIn("locked", result["reason"])
        self.assertTrue(web_new.is_dir())
        self.assertFalse(self.slot("supervisor", "0.2.0").exists())

    def test_current_unwritable_rolls_back_and_restarts_old_slot(self):
        self.install_v1()
        old = self.slot("supervisor", "0.1.0")
        before = self.current()
        real = apps._write_atomic

        def write(path, data):    # the supervisor's repoint fails
            if Path(path).name == "current.json" and \
                    json.loads(data)["supervisor"]["version"] == "0.2.0":
                raise PermissionError("read-only")
            return real(path, data)
        with mock.patch.object(apps, "_write_atomic", side_effect=write):
            result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (1, "blocked"))
        reason = result["reason"]
        self.assertTrue(reason.startswith("CurrentUnwritable:"), reason)
        self.assertIn("studio-web slot", reason)
        self.assertIn("renamed back", reason)
        self.assertIn("restored", reason)
        self.assertIn("restarted and answering", reason)
        self.assertEqual(self.current(), before)
        self.assertTrue(old.is_dir())
        self.assertTrue(self.slot("studio-web", "0.1.0").is_dir())
        for app in ("supervisor", "studio-web"):
            self.assertFalse((self.root / app / ".0.1.0.previous").exists())
            self.assertFalse(self.slot(app, "0.2.0").exists(), app)
        self.assertEqual(self.host.starts[-1][0], str(old))
        self.assertTrue(self.host.up)

    def test_bun_install_failure_removes_new_slot(self):
        self.install_v1()
        self.host.bun_rc = 1
        result, code = self.update_v2()
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("BunInstallFailed:"))
        self.assertFalse(self.slot("supervisor", "0.2.0").exists())
        self.assertFalse(self.slot("studio-web", "0.2.0").exists())
        self.assertEqual(self.current()["supervisor"]["version"], "0.1.0")
        # prepared before the stop: the service never went down
        self.assertNotIn("kill", self.host.names()[self.calls_before:])
        self.assertTrue(self.host.up)


class Digests(AppsCase):

    def seed_marketplace(self):
        plugins = self.config / "plugins"
        plugins.mkdir()
        (plugins / "installed_plugins.json").write_text(json.dumps(
            {"version": 2, "plugins": {"tk-studio@tk-studio": [
                {"scope": "user", "version": "0.2.16"}]}}), encoding="utf-8")
        (plugins / "known_marketplaces.json").write_text(json.dumps(
            {"tk-studio": {"source": {"source": "directory"}}}),
            encoding="utf-8")
        self.host.claude_rc = 3

    def test_refusal_keeps_the_plugin_legs_partial_reason(self):
        self.seed_marketplace()
        roster = self.full_roster()
        entry = json.loads(roster.read_text())["components"]["supervisor"]
        self.tamper(entry["url"])
        result, code = self.run_cli(["install", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        reason = result["reason"]
        self.assertTrue(reason.startswith("DigestMismatch:"), reason)
        self.assertIn("; MarketplaceRemovalFailed: ", reason)
        self.assertIn("claude plugin marketplace remove tk-studio", reason)
        self.assertEqual(result["version_written"], "0.2.16")

    def test_second_roster_read_refusal_keeps_the_partial_reason(self):
        self.seed_marketplace()
        path = self.roster(plugin=self.plugin())
        real = plugin_leg.load_roster
        reads = []

        def load(source, channel, fetch):
            reads.append(source)
            if len(reads) == 2:      # the file changed between the reads
                path.write_text(json.dumps({"schema": 1}), encoding="utf-8")
            return real(source, channel, fetch)
        with mock.patch.object(plugin_leg, "load_roster", side_effect=load):
            result, code = self.run_cli(["install", "--roster", str(path)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("RosterInvalid: "),
                        result["reason"])
        self.assertIn("; MarketplaceRemovalFailed: ", result["reason"])

    def test_supervisor_zip_mismatch(self):
        roster = self.full_roster()
        entry = json.loads(roster.read_text())["components"]["supervisor"]
        self.tamper(entry["url"])
        result, code = self.run_cli(["install", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("DigestMismatch:"))
        self.assertIn("supervisor", result["reason"])
        self.assertFalse((self.root / "supervisor").exists())
        self.assertFalse((self.root / "current.json").exists())
        self.assertNotIn("sh", self.host.names())

    def test_studio_web_zip_mismatch(self):
        roster = self.full_roster()
        entry = json.loads(roster.read_text())["components"]["studio-web"]
        self.tamper(entry["url"])
        result, code = self.run_cli(["install", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("DigestMismatch:"))
        self.assertIn("studio-web", result["reason"])
        self.assertFalse((self.root / "studio-web").exists())
        self.assertFalse(self.slot("supervisor", "0.1.0").exists(),
                         "the prepared supervisor slot is removed too")
        self.assertFalse((self.root / "current.json").exists())

    def test_bun_archive_mismatch(self):
        roster = self.full_roster()
        self.tamper(apps.BUN_URL.format(v=BUN_VERSION,
                                        asset="bun-linux-x64.zip"))
        result, code = self.run_cli(["install", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("DigestMismatch:"))
        self.assertIn("bun", result["reason"])
        self.assertEqual(self.tree(), [] if not (self.root / "tools").exists()
                         else ["tools"])
        self.assertNotIn("supervisor", result, "later legs do not run")

    def test_cli_wheel_mismatch(self):
        cli = self.cli()
        roster = self.roster(plugin=self.plugin(), uv=self.uv(), cli=cli)
        self.seed_uv()
        self.tamper(cli["url"])
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("DigestMismatch:"))
        self.assertIn("cli", result["reason"])
        self.assertFalse((self.root / "tools" / "wheels").exists())
        self.assertEqual((self.root / "bin" / "tk-studio").read_text(), "old")

    def test_platform_not_pinned(self):
        roster = self.full_roster()
        result, code = self.run_cli(["install", "--roster", str(roster)],
                                    platform=apps.Platform("darwin",
                                                           "x86_64"))
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertEqual(result["reason"], "PlatformNotPinned: "
                         "components.bun.sha256 has no x86_64-apple-darwin")

    def test_invalid_roster_refused_before_any_leg(self):
        path = self.tmp / "bad.json"
        path.write_text(json.dumps({"schema": 1, "channel": "stable",
                                    "components": {}}), encoding="utf-8")
        for verb in ("install", "update", "status"):
            with self.subTest(verb=verb):
                result, code = self.run_cli([verb, "--roster", str(path)])
                self.assertEqual((code, result["status"]), (1, "blocked"))
                self.assertTrue(result["reason"].startswith("RosterInvalid:"))
                self.assertIn("requires", result["reason"])
        self.assertEqual(self.fetch.calls, [])


class CliSelfUpdate(AppsCase):
    def test_update_renames_running_exe_and_installs_verified_wheel(self):
        cli = self.cli("0.2.0")
        roster = self.roster(plugin=self.plugin(), uv=self.uv(), cli=cli)
        self.seed_uv()
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(result["cli"]["status"], "updated")
        old = self.root / "bin" / ".tk-studio.old"
        self.assertEqual(old.read_text(), "old")
        self.assertEqual((self.root / "bin" / "tk-studio").read_text(),
                         "new cli")
        wheel = self.root / "tools" / "wheels" / cli["url"].rsplit("/", 1)[1]
        self.assertEqual(sha(wheel.read_bytes()), cli["sha256"])
        (args, env), = [c for c in self.host.calls
                        if Path(c[0][0]).name == "uv"]
        self.assertEqual(args, [str(self.root / "tools" / f"uv-{UV_VERSION}"
                                    / "uv"), "tool", "install", "--force",
                                str(wheel)])
        self.assertEqual(env["UV_TOOL_BIN_DIR"], str(self.root / "bin"))
        self.assertEqual(env["UV_TOOL_DIR"],
                         str(self.root / "tools" / "uv-tools"))
        # the next run deletes .old
        self.cli_version = "0.2.0"
        result, _ = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual(result["cli"]["status"], "unchanged")
        self.assertEqual(result["cli"]["old_removed"]["deleted"], True)
        self.assertFalse(old.exists())

    def test_install_never_self_updates(self):
        roster = self.roster(plugin=self.plugin(), uv=self.uv(),
                             cli=self.cli())
        self.seed_uv()
        result, _ = self.run_cli(["install", "--roster", str(roster)])
        self.assertNotIn("cli", result)
        self.assertNotIn("uv", self.host.names())

    def test_failed_install_restores_exe(self):
        roster = self.roster(plugin=self.plugin(), uv=self.uv(),
                             cli=self.cli())
        self.seed_uv()
        self.host.uv_rc = 2
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("CliUpdateFailed:"))
        self.assertEqual((self.root / "bin" / "tk-studio").read_text(), "old")

    def test_no_uv_is_named(self):
        roster = self.roster(plugin=self.plugin(), uv=self.uv(),
                             cli=self.cli())
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("UvNotInstalled:"))


class WindowsLegs(AppsCase):
    plat = WINDOWS

    def hermes(self):
        env = self.tmp / "local" / "hermes" / ".env"
        env.parent.mkdir(parents=True)
        env.write_text('TELEGRAM_BOT_TOKEN="bot-secret-123"\n'
                       "export TELEGRAM_HOME_CHANNEL=4242\n", encoding="utf-8")

    def test_fresh_install_writes_env_and_shortcut(self):
        self.hermes()
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        slot = self.slot("supervisor", "0.1.0")
        self.assertTrue((self.root / "tools" / f"bun-{BUN_VERSION}"
                         / "bun-windows-x64" / "bun.exe").is_file())
        v = self.store.values
        # built the way the code builds it: SystemDrive + os.sep, joined
        work = os.path.join(str(self.tmp / "drive") + os.sep, "agent-work")
        self.assertEqual(v["TK_SUPERVISOR_WORK"], work)
        self.assertTrue(Path(work, "backups", "claude-projects").is_dir())
        self.assertEqual(v["TK_SUPERVISOR_DB"],
                         str(Path(work, "supervisor", "queue.db")))
        self.assertEqual(v["TK_SUPERVISOR_BIND"], "100.64.0.5")
        self.assertEqual(len(v["TK_SUPERVISOR_TOKEN"]), 44)           # 32 B
        self.assertEqual(len(v["TK_SUPERVISOR_SESSION_SECRET"]), 64)  # 48 B
        self.assertRegex(v["TK_SUPERVISOR_NTFY_URL"],
                         r"^https://ntfy\.sh/tk-supervisor-[0-9a-f]{24}$")
        self.assertEqual(v["TK_SUPERVISOR_NOTIFY"], "telegram")
        self.assertEqual(v["TK_SUPERVISOR_TELEGRAM_TOKEN"], "bot-secret-123")
        self.assertEqual(v["TK_SUPERVISOR_TELEGRAM_CHAT"], "4242")
        self.assertNotIn("TK_STUDIO_ROOT", v)
        self.assertEqual(self.store.broadcasts, 1)
        env = result["supervisor"]["env"]
        self.assertEqual(env["unset"], ["TK_STUDIO_ROOT"])
        self.assertIn("TK_SUPERVISOR_TOKEN", env["set"])
        # NFR5: no credential in the output
        text = json.dumps(result)
        for name in ("TK_SUPERVISOR_TOKEN", "TK_SUPERVISOR_SESSION_SECRET",
                     "TK_SUPERVISOR_TELEGRAM_TOKEN", "TK_SUPERVISOR_NTFY_URL"):
            self.assertNotIn(v[name], text, name)
        for args, _ in self.host.calls:
            self.assertNotIn(v["TK_SUPERVISOR_TOKEN"], " ".join(args))
        # the shortcut is the script's, pointed at <slot>\start.ps1
        script = next(a[-1] for a, _ in self.host.calls
                      if "CreateShortcut" in a[-1])
        self.assertIn("'tk-studio supervisor.lnk'", script)
        self.assertIn(f"-w studio nt -d \"{slot}\" --title supervisor pwsh "
                      f"-NoExit -File \"{slot / 'start.ps1'}\"", script)
        self.assertIn(f"$s.WorkingDirectory='{slot}'", script)
        start, start_env = next((a, e) for a, e in self.host.calls
                                if a[0] == "wt.exe")
        self.assertEqual(start, ["wt.exe", "-w", "studio", "nt", "-d",
                                 str(slot), "--title", "supervisor", "pwsh",
                                 "-NoExit", "-File", str(slot / "start.ps1")])
        # the start sees the User environment just written, not the CLI's
        # older block (the values reach the runner only, never the output)
        for name in ("TK_SUPERVISOR_TOKEN", "TK_SUPERVISOR_BIND",
                     "TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_DB"):
            self.assertEqual(start_env[name], v[name], name)
        self.assertEqual(start_env["CLAUDE_CONFIG_DIR"], str(self.config))
        self.assertNotIn("TK_STUDIO_ROOT", start_env)
        self.assertEqual(result["supervisor"]["probe"],
                         "http://100.64.0.5:8787/status")

    def test_secrets_kept_and_missing_sources_unset(self):
        self.store.values.update({
            "TK_SUPERVISOR_TOKEN": "keep-token",
            "TK_SUPERVISOR_SESSION_SECRET": "keep-session",
            "TK_SUPERVISOR_NTFY_URL": "https://ntfy.sh/tk-supervisor-keep",
            "TK_STUDIO_ROOT": "C:\\GitHub\\tk-studio"})
        self.host.tailscale = None
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        env = result["supervisor"]["env"]
        self.assertEqual(sorted(env["kept"]), sorted([
            "TK_STUDIO_ROOT", "TK_SUPERVISOR_TOKEN",
            "TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_NTFY_URL"]))
        self.assertEqual(sorted(env["unset"]), sorted([
            "TK_SUPERVISOR_BIND", "TK_SUPERVISOR_TELEGRAM_TOKEN",
            "TK_SUPERVISOR_TELEGRAM_CHAT"]))
        self.assertEqual(self.store.values["TK_SUPERVISOR_TOKEN"], "keep-token")
        self.assertEqual(self.store.values["TK_SUPERVISOR_NOTIFY"], "ntfy")
        text = json.dumps(result)
        for secret in ("keep-token", "keep-session", "tk-supervisor-keep"):
            self.assertNotIn(secret, text)

    def test_no_hermes_keeps_a_working_telegram_setup(self):
        self.store.values.update({
            "TK_SUPERVISOR_NOTIFY": "telegram",
            "TK_SUPERVISOR_TELEGRAM_TOKEN": "tg-token-kept",
            "TK_SUPERVISOR_TELEGRAM_CHAT": "tg-chat-kept"})
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        v = self.store.values
        self.assertEqual((v["TK_SUPERVISOR_NOTIFY"],
                          v["TK_SUPERVISOR_TELEGRAM_TOKEN"],
                          v["TK_SUPERVISOR_TELEGRAM_CHAT"]),
                         ("telegram", "tg-token-kept", "tg-chat-kept"))
        env = result["supervisor"]["env"]
        names = ("TK_SUPERVISOR_NOTIFY", "TK_SUPERVISOR_TELEGRAM_TOKEN",
                 "TK_SUPERVISOR_TELEGRAM_CHAT")
        for name in names:
            with self.subTest(name=name):
                self.assertIn(name, env["kept"])
                self.assertNotIn(name, env["set"])
                self.assertNotIn(name, env["unset"])
        text = json.dumps(result)
        for secret in ("tg-token-kept", "tg-chat-kept"):
            self.assertNotIn(secret, text)

    def test_no_hermes_and_half_a_telegram_setup_notifies_by_ntfy(self):
        self.store.values.update({"TK_SUPERVISOR_NOTIFY": "telegram",
                                  "TK_SUPERVISOR_TELEGRAM_TOKEN": "tg-token"})
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(self.store.values["TK_SUPERVISOR_NOTIFY"], "ntfy")
        env = result["supervisor"]["env"]
        self.assertIn("TK_SUPERVISOR_NOTIFY", env["set"])
        self.assertIn("TK_SUPERVISOR_TELEGRAM_CHAT", env["unset"])
        self.assertNotIn("tg-token", json.dumps(result))

    def test_update_stops_by_slot_command_line(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        self.host.procs[999] = "bun.exe run c:\\elsewhere\\server.ts"
        result, code = self.run_cli(["update", "--roster",
                                     str(self.full_roster("0.2.0"))])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        kills = [a for a, _ in self.host.calls if a[0] == "taskkill"]
        self.assertEqual(kills, [["taskkill", "/PID", "4000", "/T", "/F"]])
        self.assertIn(999, self.host.procs)

    def test_bind_change_old_address_still_answering_renames_nothing(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        old_url = "http://100.64.0.5:8787/status"
        self.host.answering.add(old_url)     # the old service, old address
        self.host.tailscale = "100.64.0.9"   # prepare rewrites the bind
        before = self.tree()
        result, code = self.run_cli(["update", "--roster",
                                     str(self.full_roster("0.2.0", "0.2.0"))])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("ServiceStillRunning:"),
                        result["reason"])
        self.assertIn(old_url, result["reason"])
        self.assertEqual(self.store.values["TK_SUPERVISOR_BIND"], "100.64.0.9")
        self.assertEqual(self.tree(), before, "nothing renamed")
        self.assertEqual(self.current()["supervisor"]["version"], "0.1.0")
        self.assertEqual(self.current()["studio-web"]["version"], "0.1.0")

    def test_bind_change_stop_waits_on_old_and_new_address(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        self.host.tailscale = "100.64.0.9"
        probes = len(self.host.probes)
        result, code = self.run_cli(["update", "--roster",
                                     str(self.full_roster("0.2.0"))])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertIn("http://100.64.0.5:8787/status",
                      self.host.probes[probes:])
        self.assertEqual(result["supervisor"]["probe"],
                         "http://100.64.0.9:8787/status")

    def test_start_env_overlays_the_user_environment(self):
        class ListingStore(FakeStore):
            def names(self):
                return list(self.values)
        self.store = ListingStore({
            "TK_STUDIO_ROOT": "C:\\GitHub\\tk-studio",
            "TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_ID": "client-id",
            "UNRELATED": "x"})
        self.env["TK_SUPERVISOR_BIND"] = "10.0.0.1"   # the CLI's stale block
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        env = next(e for a, e in self.host.calls if a[0] == "wt.exe")
        self.assertEqual(env["TK_SUPERVISOR_BIND"], "100.64.0.5")
        self.assertEqual(env["TK_STUDIO_ROOT"], "C:\\GitHub\\tk-studio")
        self.assertEqual(env["TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_ID"],
                         "client-id")
        self.assertNotIn("UNRELATED", env)
        self.assertNotIn("client-id", json.dumps(result))


class WindowsRollback(AppsCase):
    plat = WINDOWS

    def shortcut_dirs(self) -> list[str]:
        return [re.search(r"WorkingDirectory='([^']*)'", a[-1]).group(1)
                for a, _ in self.host.calls if "CreateShortcut" in a[-1]]

    def test_swap_failure_never_points_shortcut_at_new_slot(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        old = self.slot("supervisor", "0.1.0")
        real = apps.os.rename

        def rename(src, dst):
            if Path(src) == old:
                raise PermissionError("in use")
            return real(src, dst)
        with mock.patch.object(apps.os, "rename", side_effect=rename):
            result, code = self.run_cli(["update", "--roster",
                                         str(self.full_roster("0.2.0"))])
        self.assertTrue(result["reason"].startswith("SwapFailed:"))
        self.assertEqual(self.shortcut_dirs(), [str(old)])
        self.assertTrue(self.host.up)

    def test_start_failure_points_shortcut_back(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        old, new = self.slot("supervisor", "0.1.0"), \
            self.slot("supervisor", "0.2.0")
        self.host.fail_slots.add(str(new))
        result, code = self.run_cli(["update", "--roster",
                                     str(self.full_roster("0.2.0"))])
        self.assertTrue(result["reason"].startswith("SupervisorStartFailed:"))
        self.assertIn("Startup shortcut pointed back", result["reason"])
        self.assertEqual(self.shortcut_dirs(), [str(old), str(new), str(old)])
        self.assertEqual(self.current()["supervisor"]["version"], "0.1.0")

    def startup_lnk(self) -> Path:
        lnk = (self.tmp / "roaming" / "Microsoft" / "Windows" / "Start Menu"
               / "Programs" / "Startup" / "tk-studio supervisor.lnk")
        self.host.startup_lnk = lnk
        return lnk

    def test_first_install_start_failure_removes_the_shortcut(self):
        lnk = self.startup_lnk()
        self.host.fail_start = True
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        reason = result["reason"]
        self.assertTrue(reason.startswith("SupervisorStartFailed:"), reason)
        self.assertIn(f"Startup shortcut {lnk} removed; no earlier slot to "
                      "restart", reason)
        failed = self.slot("supervisor", "0.1.0")
        self.assertEqual(self.shortcut_dirs(), [str(failed)])
        self.assertFalse(lnk.exists(), "logon must not launch the failed slot")
        self.assertFalse((self.root / "current.json").exists())
        # the next install starts clean instead of ServiceAlreadyRunning
        self.host.fail_start = False
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(apps.read_lnk_working_dir(lnk), str(failed))

    def test_first_install_start_failure_restores_an_earlier_shortcut(self):
        lnk = self.startup_lnk()
        elsewhere = self.tmp / "elsewhere"
        elsewhere.mkdir()
        lnk.parent.mkdir(parents=True)
        earlier = lnk_bytes(str(elsewhere), extras=True)
        lnk.write_bytes(earlier)
        self.host.fail_start = True
        result, code = self.run_cli(["install", "--roster",
                                     str(self.full_roster())])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertIn(f"Startup shortcut {lnk} restored to its earlier "
                      "contents", result["reason"])
        self.assertEqual(lnk.read_bytes(), earlier)

    def test_cli_helper_survives_a_non_ascii_profile(self):
        local = self.tmp / "Users" / "Jos\u00e9" / "AppData" / "Local"
        self.env["LOCALAPPDATA"] = str(local)
        self.root = local / "tk-studio"
        cli = self.cli("0.2.0")
        roster = self.roster(plugin=self.plugin(), uv=self.uv(), cli=cli)
        uv = self.root / "tools" / f"uv-{UV_VERSION}" / "uv.exe"
        uv.parent.mkdir(parents=True)
        uv.write_text("uv")
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        raw = Path(result["cli"]["helper"]).read_bytes()
        lines = raw.split(b"\r\n")
        # cmd.exe reads each line in the console code page: it is UTF-8
        # (65001) before the first line that carries a path
        self.assertEqual(lines[:2], [b"@echo off", b"chcp 65001 >nul"])
        root = str(self.root).encode("utf-8")
        self.assertIn("\u00e9".encode("utf-8"), root)
        first_path = next(i for i, ln in enumerate(lines) if root in ln)
        self.assertGreater(first_path, 1)
        for ln in lines[:first_path]:
            self.assertTrue(ln.isascii(), ln)
        text = raw.decode("utf-8")
        self.assertIn(f'"{uv}" "tool" "install" "--force"', text)
        self.assertIn(f'> "{self.root / "tools" / "cli-update.log"}" 2>&1',
                      text)
        self.assertIn(f'set "UV_TOOL_BIN_DIR={self.root / "bin"}"', text)

    def test_shortcut_failure_rolls_back_and_restarts_old_slot(self):
        self.run_cli(["install", "--roster", str(self.full_roster())])
        old, new = self.slot("supervisor", "0.1.0"), \
            self.slot("supervisor", "0.2.0")
        before = self.current()
        self.host.fail_shortcut_slots.add(str(new))
        result, code = self.run_cli(["update", "--roster",
                                     str(self.full_roster("0.2.0", "0.2.0"))])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        reason = result["reason"]
        self.assertTrue(reason.startswith("ShortcutFailed:"), reason)
        self.assertIn("renamed back", reason)
        self.assertIn("restarted and answering", reason)
        self.assertEqual(self.current(), before)
        self.assertTrue(old.is_dir())
        self.assertTrue(self.slot("studio-web", "0.1.0").is_dir())
        for app in ("supervisor", "studio-web"):
            self.assertFalse((self.root / app / ".0.1.0.previous").exists())
            self.assertFalse(self.slot(app, "0.2.0").exists(), app)
        self.assertEqual(self.host.starts[-1][0], str(old))
        self.assertTrue(self.host.up)
        self.assertEqual(self.shortcut_dirs(), [str(old), str(new)])

    def test_cli_launch_failure_refuses_with_guidance(self):
        cli = self.cli("0.2.0")
        roster = self.roster(plugin=self.plugin(), uv=self.uv(), cli=cli)
        uv = self.root / "tools" / f"uv-{UV_VERSION}" / "uv.exe"
        uv.parent.mkdir(parents=True)
        uv.write_text("uv")
        self.spawn.error = FileNotFoundError("cmd")
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        reason = result["reason"]
        self.assertTrue(reason.startswith("CliUpdateFailed: could not launch "),
                        reason)
        wheel = self.root / "tools" / "wheels" / cli["url"].rsplit("/", 1)[1]
        self.assertIn(f"the wheel {wheel} is verified — run {uv} tool install "
                      f"--force {wheel} after this CLI exits", reason)
        self.assertEqual(len(self.spawn.calls), 1)
        self.assertNotIn("cmd", self.host.names())

    def test_cli_update_is_scheduled_after_exit(self):
        cli = self.cli("0.2.0")
        roster = self.roster(plugin=self.plugin(), uv=self.uv(), cli=cli)
        uv = self.root / "tools" / f"uv-{UV_VERSION}" / "uv.exe"
        uv.parent.mkdir(parents=True)
        uv.write_text("uv")
        exe = self.root / "bin" / "tk-studio.exe"
        exe.parent.mkdir()
        exe.write_text("old")
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        leg = result["cli"]
        self.assertEqual(leg["status"], "scheduled")
        wheel = self.root / "tools" / "wheels" / cli["url"].rsplit("/", 1)[1]
        self.assertEqual(leg["wheel"], str(wheel))
        self.assertEqual(sha(wheel.read_bytes()), cli["sha256"])
        self.assertEqual(leg["command"], [str(uv), "tool", "install",
                                          "--force", str(wheel)])
        self.assertNotIn("uv.exe", self.host.names(), "not run in-process")
        self.assertEqual(exe.read_text(), "old")
        self.assertNotIn("cmd", self.host.names(), "never the runner")
        launch = [a for a, _ in self.spawn.calls]
        self.assertEqual(launch, [["cmd", "/c", "start", "tk-studio cli "
                                   "update", "/min", "cmd", "/c",
                                   leg["helper"]]])
        helper = Path(leg["helper"]).read_text(encoding="utf-8")
        self.assertIn(f'"PID eq {leg["waits_for_pid"]}"', helper)
        self.assertIn(f'"{uv}" "tool" "install" "--force" "{wheel}"', helper)
        self.assertIn(f'set "UV_TOOL_BIN_DIR={self.root / "bin"}"', helper)
        self.assertIn(f'set "UV_TOOL_DIR={self.root / "tools" / "uv-tools"}"',
                      helper)
        self.assertLess(helper.index(":wait"), helper.index('"tool"'))

        # the helper installs the already-verified local wheel, never a URL
        self.assertNotIn(cli["url"], helper)
        self.assertNotIn("://", helper)
        self.assertTrue(wheel.is_file())

    def schedule(self, version="0.2.0", pid=111):
        cli = self.cli(version)
        roster = self.roster(plugin=self.plugin(), uv=self.uv(), cli=cli)
        uv = self.root / "tools" / f"uv-{UV_VERSION}" / "uv.exe"
        if not uv.exists():
            uv.parent.mkdir(parents=True)
            uv.write_text("uv")
            (self.root / "bin").mkdir()
            (self.root / "bin" / "tk-studio.exe").write_text("old")
        with mock.patch.object(apps.os, "getpid", return_value=pid):
            result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        return roster, result["cli"]

    def test_same_run_helper_is_kept(self):
        _, leg = self.schedule()
        self.assertEqual(leg["status"], "scheduled")
        self.assertNotIn("update_helper", leg)
        self.assertTrue(Path(leg["helper"]).is_file())
        # a direct call in the scheduling process keeps it too
        with mock.patch.object(apps.os, "getpid", return_value=111):
            ctx = apps.make_ctx(self.env, platform=self.plat,
                                cli_version=self.cli_version)
            self.assertIsNone(apps.remove_cli_helper(ctx))
        self.assertTrue(Path(leg["helper"]).is_file())

    def test_leftover_helper_reported_and_deleted_next_run(self):
        roster, leg = self.schedule()
        helper, log = Path(leg["helper"]), Path(leg["log"])
        log.write_text("Resolved 1 package\nerror: wheel is locked\n",
                       encoding="utf-8")
        self.cli_version = "0.2.0"          # the scheduled install landed
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(result["cli"]["status"], "unchanged")
        rep = result["cli"]["update_helper"]
        self.assertEqual((rep["path"], rep["deleted"], rep["log_kept"]),
                         (str(helper), True, False))
        self.assertEqual(rep["wheel_version"], "0.2.0")
        self.assertEqual(rep["log_tail"][-1], "error: wheel is locked")
        self.assertFalse(helper.exists())
        self.assertFalse(log.exists())
        # nothing left: the run after that reports nothing
        result, _ = self.run_cli(["update", "--roster", str(roster)])
        self.assertNotIn("update_helper", result["cli"])

    def test_failed_scheduled_install_keeps_log_and_reports_tail(self):
        roster, leg = self.schedule()
        helper, log = Path(leg["helper"]), Path(leg["log"])
        log.write_text("error: Failed to install tk_studio_cli\n",
                       encoding="utf-8")
        # still 0.1.0: the install failed; an install run does not re-schedule
        result, code = self.run_cli(["install", "--roster", str(roster)])
        self.assertEqual(code, 0, result)
        rep = result["cli_update_helper"]
        self.assertEqual((rep["deleted"], rep["log_kept"]), (True, True))
        self.assertEqual(rep["log_tail"],
                         ["error: Failed to install tk_studio_cli"])
        self.assertFalse(helper.exists())
        self.assertTrue(log.exists())

    def test_helper_not_yet_run_is_kept(self):
        roster, leg = self.schedule()
        result, _ = self.run_cli(["install", "--roster", str(roster)])
        rep = result["cli_update_helper"]
        self.assertFalse(rep["deleted"])
        self.assertTrue(Path(leg["helper"]).is_file())


class SourceCheckout(AppsCase):
    plat = WINDOWS

    def point_shortcut(self, workdir: Path, *, extras=False):
        lnk = (self.tmp / "roaming" / "Microsoft" / "Windows" / "Start Menu"
               / "Programs" / "Startup" / "tk-studio supervisor.lnk")
        lnk.parent.mkdir(parents=True, exist_ok=True)
        lnk.write_bytes(lnk_bytes(str(workdir), extras=extras))

    def checkout(self) -> Path:
        co = self.tmp / "GitHub" / "tk-studio-supervisor"
        (co / ".git").mkdir(parents=True)
        return co

    def test_update_reports_and_replaces_nothing(self):
        co = self.checkout()
        self.point_shortcut(co)
        roster = self.full_roster()
        sup_url = json.loads(roster.read_text())["components"]["supervisor"][
            "url"]
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(result["supervisor"]["mode"], "source checkout")
        self.assertEqual(result["supervisor"]["checkout"], str(co))
        self.assertNotIn(sup_url, self.fetch.calls)
        self.assertFalse((self.root / "supervisor").exists())
        self.assertNotIn("CreateShortcut", " ".join(
            a[-1] for a, _ in self.host.calls))
        self.assertNotIn("wt.exe", self.host.names())
        self.assertEqual(self.store.values, {})

    def test_dev_box_update_fetches_no_bun(self):
        co = self.checkout()
        self.point_shortcut(co)
        roster = self.full_roster()
        components = json.loads(roster.read_text())["components"]
        bun_url = apps.BUN_URL.format(v=BUN_VERSION,
                                      asset="bun-windows-x64.zip")
        del self.fetch.blobs[bun_url]          # it would fail if fetched
        result, code = self.run_cli(["update", "--roster", str(roster)])
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        self.assertEqual(result["bun"], {
            "status": "skipped",
            "reason": f"the supervisor runs from the source checkout {co} — "
                      "bun not needed"})
        self.assertEqual(result["supervisor"]["status"], "reported")
        self.assertEqual(result["supervisor"]["checkout"], str(co))
        self.assertNotIn(bun_url, self.fetch.calls)
        self.assertNotIn(components["supervisor"]["url"], self.fetch.calls)
        self.assertFalse((self.root / "tools").exists())
        self.assertNotIn("bun.exe", self.host.names())

    def test_doctor_and_status_name_the_checkout(self):
        co = self.checkout()
        self.point_shortcut(co, extras=True)
        result, code = self.run_cli(["doctor"])
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["supervisor"]["mode"], "source checkout")
        self.assertEqual(result["supervisor"]["checkout"], str(co))
        self.assertEqual(result["mode"], "missing", "plugin fields kept")
        result, _ = self.run_cli(["status", "--roster",
                                  str(self.full_roster())])
        self.assertEqual(result["components"]["supervisor"]["installed"],
                         f"source checkout {co}")
        self.assertEqual(self.host.calls, [], "read-only, no process")

    def test_shortcut_into_a_slot_is_not_a_checkout(self):
        slot = self.root / "supervisor" / "0.1.0"
        (slot / ".git").mkdir(parents=True)
        self.point_shortcut(slot)
        result, _ = self.run_cli(["doctor"])
        self.assertEqual(result["supervisor"]["mode"], "not installed")

    def test_lnk_parser(self):
        path = self.tmp / "x.lnk"
        for extras in (False, True):
            path.write_bytes(lnk_bytes("C:\\GitHub\\tk-studio", extras=extras))
            self.assertEqual(apps.read_lnk_working_dir(path),
                             "C:\\GitHub\\tk-studio")
        path.write_bytes(b"not a link")
        self.assertIsNone(apps.read_lnk_working_dir(path))
        self.assertIsNone(apps.read_lnk_working_dir(self.tmp / "absent.lnk"))


class Doctor(AppsCase):
    def test_doctor_reports_slots_read_only(self):
        result, code = self.run_cli(["doctor"])
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assertEqual(result["supervisor"], {"mode": "not installed"})
        self.run_cli(["install", "--roster", str(self.full_roster())])
        before, calls = self.tree(), len(self.host.calls)
        result, _ = self.run_cli(["doctor"])
        self.assertEqual(result["supervisor"], {
            "mode": "slot", "version": "0.1.0",
            "path": str(self.slot("supervisor", "0.1.0"))})
        self.assertEqual(result["studio_web"]["version"], "0.1.0")
        self.assertEqual(self.tree(), before)
        self.assertEqual(len(self.host.calls), calls)


class Status(AppsCase):
    def test_one_line_per_component_then_json(self):
        roster = self.full_roster(cli=self.cli("0.2.0"))
        self.run_cli(["install", "--roster", str(roster)])
        lines, last, code = self.main_out(["status", "--roster", str(roster)])
        self.assertEqual((code, last["status"]), (0, "complete"))
        self.assertEqual(last["intent"], "tk-studio-cli-status")
        self.assertEqual([ln.split()[0] for ln in lines],
                         ["plugin", "supervisor", "studio-web", "cli", "uv",
                          "bun"])
        self.assertEqual(last["components"], {
            "plugin": {"installed": "0.2.16", "roster": "0.2.16"},
            "supervisor": {"installed": "0.1.0", "roster": "0.1.0"},
            "studio-web": {"installed": "0.1.0", "roster": "0.1.0"},
            "cli": {"installed": "0.1.0", "roster": "0.2.0"},
            "uv": {"installed": "not installed", "roster": UV_VERSION},
            "bun": {"installed": BUN_VERSION, "roster": BUN_VERSION}})
        self.assertNotIn("_lines", last)

    def test_committed_roster_reads_not_shipped(self):
        # The committed roster's component set is evidence, not an invariant
        # (25.1 ruling): a component absent from it reads "not shipped", a
        # present one reads its tag's version. The supervisor shipped on
        # 2026-10-15; studio-web and cli follow later.
        committed = json.loads(
            (ROSTERS / "latest.json").read_text(encoding="utf-8"))
        lines, last, code = self.main_out(
            ["status", "--roster", str(ROSTERS / "latest.json")])
        self.assertEqual((code, last["status"]), (0, "complete"))
        self.assertEqual(len(lines), 6)
        for name in ("supervisor", "studio-web", "cli"):
            entry = committed["components"].get(name)
            expected = ("not shipped" if entry is None
                        else entry["tag"].rsplit("--v", 1)[1])
            self.assertEqual(last["components"][name]["roster"], expected,
                             name)
        self.assertEqual(last["components"]["supervisor"]["installed"],
                         "not installed")
        self.assertEqual(self.fetch.calls, [])

    def test_unreadable_roster_blocks(self):
        result, code = self.run_cli(["status", "--roster",
                                     str(self.tmp / "absent.json")])
        self.assertEqual((code, result["status"]), (1, "blocked"))
        self.assertTrue(result["reason"].startswith("RosterUnreadable:"))


class AppZipRefusals(AppsCase):
    """An unsafe or unreadable app zip extracts nothing and changes
    nothing, on either app leg."""

    def bad_entry(self, app: str, data: bytes) -> dict:
        version = "0.2.0"
        url = release_url(app, version, f"{app}-{version}.zip")
        self.fetch.blobs[url] = data
        return {"tag": f"{apps.TAG_PREFIXES[app]}{version}", "url": url,
                "sha256": sha(data)}

    def test_unsafe_member_and_invalid_archive(self):
        cases = {"UnsafeZipMember": make_zip({"start.ps1": "#\n",
                                              "../escaped.txt": "x"}),
                 "ArchiveInvalid": b"not a zip at all"}
        self.run_cli(["install", "--roster", str(self.full_roster())])
        for app, key in (("supervisor", "supervisor"),
                         ("studio-web", "studio_web")):
            for name, data in cases.items():
                with self.subTest(app=app, refusal=name):
                    before, current = self.tree(), self.current()
                    calls = len(self.host.calls)
                    roster = self.full_roster(**{key: self.bad_entry(app,
                                                                     data)})
                    result, code = self.run_cli(["update", "--roster",
                                                 str(roster)])
                    self.assertEqual((code, result["status"]), (1, "blocked"))
                    self.assertTrue(result["reason"].startswith(f"{name}:"),
                                    result["reason"])
                    self.assertIn(app, result["reason"])
                    self.assertEqual(self.tree(), before)
                    self.assertEqual(self.current(), current)
                    self.assertFalse(list(self.tmp.rglob("escaped.txt")))
                    self.assertNotIn("kill", self.host.names()[calls:])
                    self.assertTrue(self.host.up)


class RosterRefusals(AppsCase):
    def test_newer_roster_names_the_bootstrap(self):
        newer = {"schema": 2, "channel": "stable",
                 "requires": {"claude-code": ">=2.1.224"}, "components": {}}
        unknown = {"schema": 1, "channel": "stable",
                   "requires": {"claude-code": ">=2.1.224"},
                   "components": {"plugin": self.plugin(),
                                  "future-app": {"version": "1.0.0"}}}
        for name, roster in (("RosterInvalid", newer),
                             ("RosterEntryInvalid", unknown)):
            with self.subTest(refusal=name):
                path = self.tmp / f"{name}.json"
                path.write_text(json.dumps(roster), encoding="utf-8")
                result, code = self.run_cli(["update", "--roster", str(path)])
                self.assertEqual((code, result["status"]), (1, "blocked"))
                self.assertTrue(result["reason"].startswith(f"{name}: "),
                                result["reason"])
                self.assertTrue(result["reason"].endswith(
                    ". A roster newer than this CLI needs a newer CLI — "
                    "re-run the bootstrap (tools/installer/install.ps1 or "
                    "install.sh)"), result["reason"])

    def test_a_typed_roster_mistake_never_names_the_bootstrap(self):
        plugin = self.plugin()
        typo = dict(plugin, sha256=plugin["sha256"][:-1] + "Z")
        tag = dict(plugin, tag="tk-studio--vTBD")
        base = {"schema": 1, "channel": "stable",
                "requires": {"claude-code": ">=2.1.224"}}
        for name, refusal, roster in (
                ("digest", "RosterEntryInvalid",
                 dict(base, components={"plugin": typo})),
                ("tag", "RosterEntryInvalid",
                 dict(base, components={"plugin": tag})),
                ("channel", "RosterInvalid",
                 dict(base, channel="nightly", components={"plugin": plugin}))):
            with self.subTest(case=name):
                path = self.tmp / f"typo-{name}.json"
                path.write_text(json.dumps(roster), encoding="utf-8")
                result, code = self.run_cli(["update", "--roster", str(path)])
                self.assertEqual((code, result["status"]), (1, "blocked"))
                self.assertTrue(result["reason"].startswith(f"{refusal}: "),
                                result["reason"])
                self.assertNotIn("re-run the bootstrap", result["reason"])
                self.assertNotIn(plugin_leg.NEWER_ROSTER, result["reason"])

    def test_newer_kind_anywhere_names_the_bootstrap(self):
        plugin = self.plugin()
        roster = {"schema": 1, "channel": "stable",
                  "requires": {"claude-code": ">=2.1.224"},
                  "components": {"plugin": dict(plugin, sha256="xyz"),
                                 "future-app": {"version": "1.0.0"}}}
        path = self.tmp / "mixed.json"
        path.write_text(json.dumps(roster), encoding="utf-8")
        result, _ = self.run_cli(["update", "--roster", str(path)])
        self.assertTrue(result["reason"].startswith("RosterEntryInvalid: "))
        self.assertIn("components.plugin.sha256", result["reason"])
        self.assertTrue(result["reason"].endswith(
            ". " + plugin_leg.NEWER_ROSTER), result["reason"])

    def test_second_roster_read_refusal_is_blocked_not_unexpected(self):
        path = self.roster(plugin=self.plugin())
        real = plugin_leg.load_roster
        reads = []

        def load(source, channel, fetch):
            reads.append(source)
            if len(reads) == 2:      # the file changed between the reads
                path.write_text(json.dumps({"schema": 1}), encoding="utf-8")
            return real(source, channel, fetch)
        with mock.patch.object(plugin_leg, "load_roster", side_effect=load):
            lines, last, code = self.main_out(["update", "--roster",
                                               str(path)])
        self.assertEqual(len(reads), 2)
        self.assertEqual((code, last["status"]), (1, "blocked"))
        self.assertTrue(last["reason"].startswith("RosterInvalid: "),
                        last["reason"])
        self.assertEqual(last["intent"], "tk-studio-cli-update")
        self.assertEqual(last["version_written"], "0.2.16",
                         "the plugin leg's fields are kept")
        self.assertNotIn("supervisor", last)


class SlotPids(AppsCase):
    """Stop targets only command lines naming the slot path itself."""

    def pids(self, plat) -> tuple[list[int], Path]:
        ctx = apps.make_ctx(self.env, platform=plat, runner=self.host,
                            env_store=self.store)
        slot = ctx.root / "supervisor" / "0.1.1"
        self.host.procs.update({
            1: f"pwsh -File {ctx.root}/supervisor/0.1.10/start.ps1",
            2: f"pwsh -File {slot}/start.ps1",
            3: f'wt.exe -d "{slot}" --title supervisor',
            4: f"bun run --cwd {slot}",
            5: f"bun {slot}-old/server.ts",
            6: f"PWSH -FILE {str(slot).upper()}/START.PS1"})
        return apps._slot_pids(ctx, slot), slot

    def test_linux_bounded_match(self):
        pids, _ = self.pids(LINUX)
        self.assertEqual(sorted(pids), [2, 3, 4])

    def test_windows_bounded_case_insensitive_never_itself(self):
        pids, _ = self.pids(WINDOWS)
        self.assertEqual(sorted(pids), [2, 3, 4, 6])
        self.assertNotIn(self.host.query_pid, pids)
        script = next(a[-1] for a, _ in self.host.calls
                      if "Get-CimInstance" in a[-1])
        self.assertIn("$_.ProcessId -ne $PID", script)


class DetachedSpawner(unittest.TestCase):
    def spawn(self, windows: bool):
        with mock.patch.object(apps.shutil, "which",
                               return_value="/bin/cmd") as which, \
                mock.patch.object(apps.subprocess, "Popen") as popen:
            self.assertIsNone(apps.default_spawn_detached(
                ["cmd", "/c", "x"], {"PATH": "/bin"}, windows=windows))
        which.assert_called_once_with("cmd", path="/bin")
        (args,), kwargs = popen.call_args
        self.assertEqual(args, ["/bin/cmd", "/c", "x"])
        for stream in ("stdin", "stdout", "stderr"):
            self.assertIs(kwargs[stream], subprocess.DEVNULL, stream)
        self.assertTrue(kwargs["close_fds"])
        self.assertEqual(popen.return_value.method_calls, [], "never waits")
        return kwargs

    def test_windows_detached_new_group_no_inherited_stdio(self):
        kwargs = self.spawn(windows=True)
        self.assertEqual(kwargs["creationflags"], 0x00000008 | 0x00000200)

    def test_posix_new_session(self):
        kwargs = self.spawn(windows=False)
        self.assertTrue(kwargs["start_new_session"])
        self.assertNotIn("creationflags", kwargs)

    def test_ctx_defaults_to_it(self):
        ctx = apps.make_ctx({}, platform=WINDOWS)
        self.assertIs(ctx.spawn_detached, apps.default_spawn_detached)
        self.assertIs(ctx.runner, apps.default_runner)


class Locations(unittest.TestCase):
    def test_slot_root_per_platform(self):
        self.assertEqual(apps.data_root({"LOCALAPPDATA": "/L"}, WINDOWS),
                         Path("/L/tk-studio"))
        self.assertEqual(apps.data_root({"XDG_DATA_HOME": "/X", "HOME": "/H"},
                                        LINUX), Path("/X/tk-studio"))
        self.assertEqual(apps.data_root({"HOME": "/H"}, LINUX),
                         Path("/H/.local/share/tk-studio"))
        self.assertEqual(apps.data_root({"HOME": "/H"},
                                        apps.Platform("darwin", "aarch64")),
                         Path("/H/Library/Application Support/tk-studio"))

    def test_probe_url_reads_bind_port_and_tls(self):
        ctx = apps.make_ctx({"TK_SUPERVISOR_BIND": "100.1.2.3",
                             "TK_SUPERVISOR_PORT": "9000",
                             "TK_SUPERVISOR_TLS_CERT": "c.crt"},
                            platform=LINUX)
        self.assertEqual(apps.probe_url(ctx), "https://100.1.2.3:9000/status")
        ctx = apps.make_ctx({}, platform=LINUX)
        self.assertEqual(apps.probe_url(ctx), "http://127.0.0.1:8787/status")

    def test_targets(self):
        self.assertEqual(WINDOWS.target, "x86_64-pc-windows-msvc")
        self.assertEqual(LINUX.target, "x86_64-unknown-linux-gnu")
        self.assertEqual(apps.Platform("darwin", "aarch64").target,
                         "aarch64-apple-darwin")


if __name__ == "__main__":
    unittest.main()
