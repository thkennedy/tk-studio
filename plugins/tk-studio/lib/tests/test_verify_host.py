"""tools/verify_host.py, the host verify leg (Story 27.4; the supervisor gate, Story 33.4).

The script is loaded by path. git, the gates' subprocesses and the clock are faked: no bun, no uv,
no real suite runs here (one real `spawn` of the running Python pins the timeout kill).
"""
from __future__ import annotations

import importlib.util
import io
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPT = REPO_ROOT / "tools" / "verify_host.py"
BASE = "119dc2a371d9f43ce563f4eb7fbc5d9df2f2ae0a"


def load():
    spec = importlib.util.spec_from_file_location("verify_host_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


vh = load()


def fake_git(changed: dict[str, str], fail: bool = False):
    """`git` answering a merge base, and `changed[rel]` for diff (empty when absent)."""
    def git(*args):
        if fail:
            return subprocess.CompletedProcess(["git", *args], 128, "", "fatal: not a git repository\n")
        if args[0] == "merge-base":
            return subprocess.CompletedProcess(["git", *args], 0, BASE + "\n", "")
        if args[0] == "diff":
            return subprocess.CompletedProcess(["git", *args], 0, changed.get(args[-1], ""), "")
        return subprocess.CompletedProcess(["git", *args], 0, "", "")
    return git


def bun_out(p: int, f: int) -> str:
    return f"bun test v1.4.3\n\n {p} pass\n {f} fail\n {p * 2} expect() calls\nRan {p + f} tests across 1 file. [10ms]\n"


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class VerifyHostCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.sup = self.root / "apps" / "supervisor"
        (self.sup / "test").mkdir(parents=True)
        for name in ("api.test.ts", "queue.test.ts", "command-line.test.ts", "fakes.ts", "tmp.ts"):
            (self.sup / "test" / name).write_text("// fixture\n", encoding="utf-8")
        (self.sup / "node_modules").mkdir()  # hole 80: the dependencies are present unless a test removes them
        self.base = self.root / "temp"  # the gate's own temp folder, outside any checkout
        self.base.mkdir()
        self.calls: list[tuple] = []  # every gate run and spawn, in order
        self.clock = Clock()
        for target, value in (("SUPERVISOR", self.sup), ("temp_base", lambda: self.base)):
            patcher = mock.patch.object(vh, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(vh.time, "monotonic", self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(vh.time, "sleep", lambda s: None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake_run_gate(self, name, cwd, argv):
        self.calls.append(("gate", name))
        return 0, f"{name} output\n", 3.0

    def run_main(self, changed: dict[str, str], spawn=None, fail_git: bool = False) -> tuple[int, str]:
        out = io.StringIO()
        with mock.patch.object(vh, "_git", fake_git(changed, fail_git)), \
                mock.patch.object(vh, "run_gate", self.fake_run_gate), \
                mock.patch.object(vh, "spawn", spawn or self.spawn_ok), \
                mock.patch.dict(os.environ, {"TK_SUPERVISOR_NOTIFY": "telegram", "TK_SUPERVISOR_DB": "/x/q.db", "KEEP_ME": "1"}), \
                redirect_stdout(out):
            rc = vh.main([])
        return rc, out.getvalue()

    def spawn_ok(self, argv, cwd, env, timeout):
        """Each file passes in 5 s, queue.test.ts in 30 s; tsc passes in 9 s."""
        self.calls.append(("spawn", tuple(argv), cwd, dict(env), timeout, Path(env["TMPDIR"]).is_dir()))
        if argv[:2] == ["bun", "test"]:
            self.clock.now += 30 if argv[2].endswith("queue.test.ts") else 5
            return 0, bun_out(97, 0)
        self.clock.now += 9
        return 0, ""

    def spawns(self):
        return [c for c in self.calls if c[0] == "spawn"]


class TestSkipAndStudioWeb(VerifyHostCase):
    def test_unchanged_supervisor_is_skipped_and_studio_web_lines_are_unchanged(self):
        rc, out = self.run_main({})
        self.assertEqual(rc, 0)
        self.assertEqual(self.spawns(), [])
        lines = out.splitlines()
        self.assertIn(f"== supervisor: skipped (apps/supervisor unchanged since {BASE[:12]})", lines)
        self.assertIn(f"== studio-web: skipped (apps/studio-web unchanged since {BASE[:12]})", lines)
        self.assertLess(lines.index(f"== supervisor: skipped (apps/supervisor unchanged since {BASE[:12]})"),
                        lines.index(f"== studio-web: skipped (apps/studio-web unchanged since {BASE[:12]})"))
        self.assertEqual(lines[-1], "verify_host: ok (lib suite, conformance)")

    def test_studio_web_changed_prints_its_lines_word_for_word(self):
        rc, out = self.run_main({"apps/studio-web": "apps/studio-web/src/app.ts\n"})
        self.assertEqual(rc, 0)
        lines = out.splitlines()
        i = lines.index(f"== studio-web: apps/studio-web changed since {BASE[:12]}")
        self.assertEqual(lines[i + 1], f"== studio-web: bun run verify  (cwd {Path('apps/studio-web')})")
        self.assertEqual(lines[i + 2], "== studio-web: ok in 3s")
        self.assertEqual(lines[-1], "verify_host: ok (lib suite, conformance, studio-web)")

    def test_git_failure_runs_both_apps_saying_why(self):
        rc, out = self.run_main({}, fail_git=True)
        self.assertEqual(rc, 0)
        self.assertIn("== supervisor: no merge base with main or origin/main; running anyway", out)
        self.assertIn("== studio-web: no merge base with main or origin/main; running anyway", out)
        self.assertEqual(out.splitlines()[-1], "verify_host: ok (lib suite, conformance, supervisor, studio-web)")

    def test_untracked_file_counts_as_a_change(self):
        def git(*args):
            if args[0] == "merge-base":
                return subprocess.CompletedProcess(args, 0, BASE, "")
            if args[0] == "ls-files" and args[-1] == "apps/supervisor":
                return subprocess.CompletedProcess(args, 0, "apps/supervisor/test/new.test.ts\n", "")
            return subprocess.CompletedProcess(args, 0, "", "")
        with mock.patch.object(vh, "_git", git):
            self.assertEqual(vh.app_changed("apps/supervisor"), (True, f"apps/supervisor changed since {BASE[:12]}"))
            self.assertEqual(vh.app_changed("apps/studio-web"), (False, f"apps/studio-web unchanged since {BASE[:12]}"))


class TestSupervisorGate(VerifyHostCase):
    CHANGED = {"apps/supervisor": "apps/supervisor/src/queue.ts\n"}

    def test_runs_after_conformance_each_file_but_the_e2e_then_tsc(self):
        rc, out = self.run_main({**self.CHANGED, "apps/studio-web": "apps/studio-web/x\n"})
        self.assertEqual(rc, 0)
        order = [c[1] for c in self.calls]
        self.assertEqual(order, [
            "lib suite", "conformance",
            ("bun", "test", "./test/api.test.ts"), ("bun", "test", "./test/queue.test.ts"),
            ("bunx", "tsc", "--noEmit", "-p", "apps/supervisor"),
            "studio-web",
        ])
        for call in self.spawns()[:2]:
            self.assertEqual(call[2], self.sup)
        self.assertEqual(self.spawns()[2][2], vh.ROOT)
        # bunx resolves the app's own installed TypeScript (on PATH first), never a downloaded latest
        tsc_path = self.spawns()[2][3]["PATH"].split(os.pathsep)
        self.assertEqual(tsc_path[0], str(self.sup / "node_modules" / ".bin"))
        self.assertEqual(tsc_path[1:], os.environ.get("PATH", "").split(os.pathsep))
        for call in self.spawns()[:2]:
            self.assertNotIn(str(self.sup / "node_modules" / ".bin"), call[3].get("PATH", ""))
        self.assertNotIn("command-line", out)
        self.assertEqual(out.splitlines()[-1], "verify_host: ok (lib suite, conformance, supervisor, studio-web)")

    def test_each_file_under_420s_with_no_tk_supervisor_vars_and_the_per_run_temp(self):
        self.run_main(self.CHANGED)
        temps = set()
        for _, argv, _, env, timeout, existed in self.spawns():
            self.assertEqual(timeout, 420)
            self.assertFalse([k for k in env if k.upper().startswith("TK_SUPERVISOR_")])
            self.assertEqual(env["KEEP_ME"], "1")
            self.assertEqual(env["TK_STUDIO_ROOT"], str(vh.ROOT))  # hole 82: the suites use this repo's plugin
            self.assertEqual(env["TMPDIR"], env["TEMP"])
            self.assertEqual(env["TMPDIR"], env["TMP"])
            self.assertTrue(existed, "the per-run folder exists while the files run")
            temps.add(env["TMPDIR"])
        self.assertEqual(len(temps), 1)
        tmp = Path(temps.pop())
        self.assertEqual(tmp.parent, self.base)
        self.assertRegex(tmp.name, rf"^tk-verify-supervisor-\d{{8}}T\d{{6}}Z-{os.getpid()}$")
        self.assertFalse(tmp.exists())
        self.assertEqual(list(self.base.iterdir()), [], "nothing is left in the temp folder")

    def test_the_folder_is_under_the_gates_own_temp_folder(self):
        # the real temp_base (a fresh load: setUp patched this one) is tempfile.gettempdir(), read
        # from the gate's own environment; only the children's TMPDIR/TEMP/TMP point at the run folder
        self.assertEqual(load().temp_base(), Path(tempfile.gettempdir()))

    def test_a_temp_folder_inside_a_git_checkout_fails_the_gate_before_any_file(self):
        checkout = self.root / "checkout"
        (checkout / ".git").mkdir(parents=True)
        self.base = checkout / "sub" / "temp"
        self.base.mkdir(parents=True)
        rc, out = self.run_main(self.CHANGED)
        self.assertEqual(rc, 1)
        self.assertEqual(self.spawns(), [], "no file and no tsc runs")
        self.assertRegex(out, r"== supervisor: the temp folder .*tk-verify-supervisor-\S+ is inside a git checkout "
                              r"\(.*checkout\)")
        self.assertIn("== supervisor: FAILED in", out)
        self.assertEqual(list(self.base.iterdir()), [], "the folder is still removed")
        self.assertEqual(out.splitlines()[-1], "verify_host: FAILED (supervisor)")

    def test_no_test_files_fails_the_gate_before_any_spawn(self):
        for p in (self.sup / "test").glob("*.test.ts"):
            p.unlink()
        rc, out = self.run_main(self.CHANGED)
        self.assertEqual(rc, 1)
        self.assertEqual(self.spawns(), [], "no file and no tsc runs")
        self.assertIn(f"== supervisor: no test/*.test.ts files under {self.sup / 'test'}", out)
        self.assertIn("== supervisor: FAILED in 0s; 0 files, 0 pass, 0 fail; slowest none", out)
        self.assertEqual(list(self.base.iterdir()), [], "the folder is still removed")
        self.assertEqual(out.splitlines()[-1], "verify_host: FAILED (supervisor)")

    def test_git_ancestor(self):
        (self.root / "repo" / ".git").mkdir(parents=True)
        (self.root / "repo" / "a" / "b").mkdir(parents=True)
        self.assertEqual(vh.git_ancestor(self.root / "repo" / "a" / "b"), (self.root / "repo").resolve())
        self.assertIsNone(vh.git_ancestor(self.base))

    def test_lines_name_counts_tsc_and_the_slowest_file(self):
        rc, out = self.run_main(self.CHANGED)
        lines = [l for l in out.splitlines() if l.startswith("== supervisor:")]
        self.assertEqual(lines, [
            f"== supervisor: apps/supervisor changed since {BASE[:12]}",
            "== supervisor: test/api.test.ts 97 pass, 0 fail in 5s",
            "== supervisor: test/queue.test.ts 97 pass, 0 fail in 30s",
            "== supervisor: tsc ok in 9s",
            "== supervisor: ok in 44s; 2 files, 194 pass, 0 fail; slowest test/queue.test.ts 30s",
        ])

    def test_a_failing_file_fails_the_gate_and_its_tail_is_repeated(self):
        def spawn(argv, cwd, env, timeout):
            self.clock.now += 2
            if argv[-1].endswith("queue.test.ts"):
                return 1, "(fail) queue > EBUSY on rmdir\n" + bun_out(96, 1)
            return 0, bun_out(10, 0) if argv[1] == "test" else ""
        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertEqual(rc, 1)
        self.assertIn("== supervisor: test/queue.test.ts 96 pass, 1 fail in 2s rc=1", out)
        self.assertIn("== supervisor: FAILED in 6s; 2 files, 106 pass, 1 fail; slowest test/api.test.ts 2s", out)
        self.assertIn("== supervisor failed (rc=1)", out)
        self.assertIn("(fail) queue > EBUSY on rmdir", out.split("== supervisor failed")[1])
        self.assertEqual(out.splitlines()[-1], "verify_host: FAILED (supervisor)")

    def test_a_timeout_is_named_and_counts_as_a_fail(self):
        def spawn(argv, cwd, env, timeout):
            if argv[-1].endswith("api.test.ts"):
                self.clock.now += 420
                return None, "partial output before the hang\n"
            self.clock.now += 1
            return 0, bun_out(5, 0) if argv[1] == "test" else ""
        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertEqual(rc, 1)
        self.assertIn("== supervisor: test/api.test.ts ? pass, ? fail in 420s (timed out after 420s)", out)
        self.assertIn("slowest test/api.test.ts 420s", out)
        self.assertIn("partial output before the hang", out.split("== supervisor failed")[1])
        self.assertEqual(list(self.base.iterdir()), [])

    def test_unparseable_output_is_judged_by_the_exit_code(self):
        def spawn(argv, cwd, env, timeout):
            return 0, "no summary here\n"
        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertEqual(rc, 0)
        self.assertIn("== supervisor: test/api.test.ts ? pass, ? fail in 0s", out)
        self.assertIn("== supervisor: ok in 0s; 2 files, 0 pass, 0 fail;", out)

    def test_tsc_failure_fails_the_gate(self):
        def spawn(argv, cwd, env, timeout):
            if argv[1] == "test":
                return 0, bun_out(1, 0)
            return 2, "test/x.ts(1,1): error TS2322\n"
        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertEqual(rc, 1)
        self.assertIn("== supervisor: tsc FAILED rc=2 in 0s", out)
        self.assertIn("error TS2322", out.split("== supervisor failed")[1])

    def test_bun_x_when_bunx_cannot_start(self):
        seen = []

        def spawn(argv, cwd, env, timeout):
            seen.append(argv[:2])
            if argv[0] == "bunx":
                raise FileNotFoundError("bunx")
            return 0, bun_out(1, 0) if argv[1] == "test" else ""
        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertEqual(rc, 0)
        self.assertEqual(seen[-2:], [["bunx", "tsc"], ["bun", "x"]])
        self.assertIn("== supervisor: tsc ok in 0s", out)

    def test_a_file_that_cannot_start_fails_with_rc_127_and_the_gate_still_closes(self):
        def spawn(argv, cwd, env, timeout):
            if argv[-1].endswith("api.test.ts"):
                raise PermissionError(13, "Access is denied", "bun")  # e.g. Smart App Control
            return 0, bun_out(1, 0) if argv[1] == "test" else ""
        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertEqual(rc, 1)
        self.assertIn("== supervisor: test/api.test.ts ? pass, ? fail in 0s rc=127", out)
        self.assertIn("== supervisor: test/queue.test.ts 1 pass, 0 fail in 0s", out)
        self.assertIn("cannot start 'bun'", out.split("== supervisor failed")[1])
        self.assertIn("== supervisor: FAILED in 0s; 2 files, 1 pass, 0 fail;", out)
        self.assertEqual(out.splitlines()[-1], "verify_host: FAILED (supervisor)")

    def test_tsc_that_cannot_start_either_way_fails_the_gate(self):
        def spawn(argv, cwd, env, timeout):
            if argv[1] == "test":
                return 0, bun_out(1, 0)
            raise OSError(1455, "The paging file is too small")
        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertEqual(rc, 1)
        self.assertIn("== supervisor: tsc FAILED rc=127 in 0s", out)
        self.assertIn("cannot start 'bun'", out.split("== supervisor failed")[1])

    def test_a_temp_folder_that_cannot_be_created_fails_the_gate_with_a_line(self):
        self.base = self.root / "a-file"
        self.base.write_text("not a folder", encoding="utf-8")
        rc, out = self.run_main(self.CHANGED)
        self.assertEqual(rc, 1)
        self.assertEqual(self.spawns(), [])
        self.assertRegex(out, r"== supervisor: cannot create the temp folder .*tk-verify-supervisor-\S+: ")
        self.assertIn("== supervisor: FAILED in 0s; 0 files, 0 pass, 0 fail; slowest none", out)
        self.assertEqual(out.splitlines()[-1], "verify_host: FAILED (supervisor)")

    def test_an_unusable_temp_base_fails_the_gate_with_a_line(self):
        def no_temp():
            raise FileNotFoundError(2, "No usable temporary directory found")
        with mock.patch.object(vh, "temp_base", no_temp):
            rc, out = self.run_main(self.CHANGED)
        self.assertEqual(rc, 1)
        self.assertIn("== supervisor: cannot create the temp folder under the temp folder: ", out)
        self.assertEqual(out.splitlines()[-1], "verify_host: FAILED (supervisor)")

    def test_a_failed_removal_is_printed_and_fails_the_gate(self):
        tries = []

        def rmtree(path, ignore_errors=False, **handler):
            tries.append(path)
            raise PermissionError(13, "Access is denied", str(path))
        with mock.patch.object(vh.shutil, "rmtree", rmtree):
            rc, out = self.run_main(self.CHANGED)
        self.assertEqual(rc, 1)
        self.assertEqual(len(tries), 3)
        self.assertRegex(out, r"== supervisor: could not remove .*supervisor-\d{8}T\d{6}Z-\d+: .*Access is denied")
        self.assertIn("== supervisor: FAILED in", out)
        self.assertEqual(out.splitlines()[-1], "verify_host: FAILED (supervisor)")


class TestRemoveTmp(unittest.TestCase):
    def test_a_read_only_file_is_removed(self):
        with tempfile.TemporaryDirectory() as base:
            tmp = Path(base) / "tk-verify-supervisor-x"
            objects = tmp / "repo" / ".git" / "objects" / "ab"
            objects.mkdir(parents=True)
            blob = objects / "cdef"
            blob.write_text("blob", encoding="utf-8")
            os.chmod(blob, stat.S_IREAD)
            self.assertIsNone(vh.remove_tmp(tmp))
            self.assertFalse(tmp.exists())

    def test_the_handler_clears_the_read_only_bit_and_retries(self):
        with tempfile.TemporaryDirectory() as base:
            blob = Path(base) / "cdef"
            blob.write_text("blob", encoding="utf-8")
            os.chmod(blob, stat.S_IREAD)
            vh._clear_readonly(os.unlink, str(blob), PermissionError(13, "Access is denied"))
            self.assertFalse(blob.exists())
            for exc in (OSError("scandir failed"), (OSError, OSError("scandir failed"), None)):
                with self.assertRaisesRegex(OSError, "scandir failed"):
                    vh._clear_readonly(os.scandir, base, exc)

    def test_a_missing_folder_is_no_error(self):
        self.assertIsNone(vh.remove_tmp(Path(tempfile.gettempdir()) / "tk-verify-supervisor-never-made"))


class TestSpawn(unittest.TestCase):
    def test_a_child_past_its_timeout_is_killed(self):
        rc, out = vh.spawn([sys.executable, "-c", "import time; print('started', flush=True); time.sleep(30)"],
                           Path.cwd(), dict(os.environ), 1)
        self.assertIsNone(rc)
        self.assertIn("started", out)

    @unittest.skipIf(sys.platform == "win32", "POSIX: the process group (taskkill /T on Windows)")
    def test_a_grandchild_holding_the_pipe_is_killed_with_the_group(self):
        code = ("import subprocess, sys, time; "
                "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
                "print('started', flush=True); time.sleep(60)")
        t0 = time.monotonic()
        rc, out = vh.spawn([sys.executable, "-c", code], Path.cwd(), dict(os.environ), 1)
        self.assertIsNone(rc)
        self.assertIn("started", out)
        self.assertLess(time.monotonic() - t0, vh.DRAIN_TIMEOUT, "the group kill closed the pipe")

    def test_a_child_in_time_returns_its_code_and_output(self):
        rc, out = vh.spawn([sys.executable, "-c", "import sys; print('hi'); sys.exit(3)"], Path.cwd(), dict(os.environ), 30)
        self.assertEqual((rc, out.strip()), (3, "hi"))

    def test_an_interrupt_while_reading_kills_the_tree_and_is_raised_again(self):
        proc = mock.Mock(pid=4321)
        proc.communicate.side_effect = [KeyboardInterrupt(), subprocess.TimeoutExpired("bun", vh.DRAIN_TIMEOUT)]
        with mock.patch.object(vh.subprocess, "Popen", return_value=proc), \
                mock.patch.object(vh, "_kill_tree") as kill:
            with self.assertRaises(KeyboardInterrupt):
                vh.spawn(["bun", "test", "./test/api.test.ts"], Path.cwd(), dict(os.environ), 420)
        kill.assert_called_once_with(proc)
        self.assertEqual(proc.communicate.call_args_list[-1], mock.call(timeout=vh.DRAIN_TIMEOUT))

    def test_bun_counts(self):
        self.assertEqual(vh.bun_counts(bun_out(12, 3)), (12, 3))
        self.assertEqual(vh.bun_counts(" 4 pass\n 1 skip\n 0 fail\n"), (4, 0))
        self.assertEqual(vh.bun_counts("error: crashed\n"), (None, None))


if __name__ == "__main__":
    unittest.main()


class TestDependencyInstall(VerifyHostCase):
    """Hole 80: a fresh worktree has no node_modules; the gate installs from the lockfile before the suites."""
    CHANGED = {"apps/supervisor": "apps/supervisor/src/queue.ts\n"}

    def test_node_modules_absent_installs_first_then_runs_the_suites(self):
        (self.sup / "node_modules").rmdir()
        rc, out = self.run_main(self.CHANGED)
        self.assertEqual(rc, 0, out)
        spawns = self.spawns()
        self.assertEqual(spawns[0][1], ("bun", "install", "--frozen-lockfile"))
        self.assertEqual(spawns[0][2], self.sup)
        self.assertEqual(spawns[0][4], vh.SUPERVISOR_INSTALL_TIMEOUT)
        self.assertNotIn("TK_SUPERVISOR_NOTIFY", spawns[0][3])  # the stripped gate env, as every suite gets
        self.assertTrue(all(s[1][:2] == ("bun", "test") for s in spawns[1:-1]), spawns)
        self.assertIn("== supervisor: bun install (node_modules absent) ok in", out)

    def test_node_modules_present_installs_nothing(self):
        rc, out = self.run_main(self.CHANGED)
        self.assertEqual(rc, 0, out)
        self.assertFalse([s for s in self.spawns() if s[1][:2] == ("bun", "install")])
        self.assertNotIn("bun install", out)

    def test_failed_install_fails_the_gate_and_runs_no_suite(self):
        (self.sup / "node_modules").rmdir()

        def spawn(argv, cwd, env, timeout):
            self.calls.append(("spawn", tuple(argv), cwd, dict(env), timeout, True))
            return (1, "error: lockfile had changes, but lockfile is frozen\n") if argv[1] == "install" else (0, bun_out(1, 0))

        rc, out = self.run_main(self.CHANGED, spawn=spawn)
        self.assertNotEqual(rc, 0)
        self.assertEqual(len(self.spawns()), 1)
        self.assertIn("== supervisor: bun install (node_modules absent) FAILED rc=1", out)
        self.assertIn("lockfile is frozen", out)
