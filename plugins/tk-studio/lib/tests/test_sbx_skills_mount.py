"""The engine sandbox's read-only skills-mount check (Story 25.6, AC1).

Drives ``tools/sbx-engine/check-skills-mount.sh`` with a fake mounts file,
a temp skills folder and a fake ``claude`` on PATH, one test per row of the
spec's I/O matrix: ok, absent mount, rw mount, empty mount, not loaded,
loaded from another path than the mount, and shadowed (the shadow check
runs before the loaded check, any ``tk-studio@<m>`` but skills-dir is a
copy, and the listing runs from ``PROJECT_DIR`` so a project-scope copy is
seen), plus a failing and a stalled ``claude plugin list``. Every failure
exits non-zero and names the mount path. Then the static half: ``provision-engine.sh`` no longer installs the
plugin per sandbox and does run the check, and the check never runs an
uninstall or ``sbx``. No network, no real ``claude``. Story 28.3 adds the
one-mount ``claude-tk-studio`` sandbox: the listing from a nested project
dir, the launch/resume scripts' two ROOT values and their named refusal of a
ROOT that is no project, and the provisioning's one-mount usage.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
SBX = REPO_ROOT / "tools" / "sbx-engine"
CHECK = SBX / "check-skills-mount.sh"
PROVISION = SBX / "provision-engine.sh"
LAUNCH = SBX / "launch-epic.sh"
RESUME = SBX / "resume-run.sh"

LOADED = """Installed plugins:

  ❯ some-other@market
    Version: 1.0.0
    Scope: user
    Status: ✔ enabled

Skills-directory plugins (.claude/skills/*):

  ❯ tk-studio@skills-dir
    Version: 0.2.16
    Scope: user
    Path: {mount}/tk-studio
    Status: ✔ loaded
"""
NOT_LOADED = """Installed plugins:

  ❯ some-other@market
    Version: 1.0.0
    Scope: user
    Status: ✔ enabled
"""
MARKETPLACE_COPY = """
  ❯ tk-studio@tk-studio
    Version: 0.2.16
    Read from: /c/GitHub/tk-studio/plugins/tk-studio
    Scope: user
    Status: ✔ enabled
"""
OTHER_MARKET_COPY = MARKETPLACE_COPY.replace("tk-studio@tk-studio",
                                             "tk-studio@other-market")


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class SkillsMountCheckTests(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = Path(self._tmp.name)
        self.mount = root / "home" / "agent" / ".claude" / "skills"
        self.mount.mkdir(parents=True)
        self.mounts_file = root / "mounts"
        self.bin = root / "bin"
        self.bin.mkdir()
        self.listing = root / "listing.txt"
        self.project = root / "project"
        self.project.mkdir()

    def _mounts(self, options: str | None) -> None:
        rows = ["proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
                "host /c/GitHub/tk-studio virtiofs ro,relatime 0 0"]
        if options is not None:
            rows.append(f"host {self.mount} virtiofs {options} 0 0")
        self.mounts_file.write_text("\n".join(rows) + "\n", encoding="utf-8")

    def _plugin_folder(self) -> None:
        manifest = self.mount / "tk-studio" / ".claude-plugin"
        manifest.mkdir(parents=True)
        (manifest / "plugin.json").write_text(
            '{"name": "tk-studio", "version": "0.2.16"}', encoding="utf-8")

    def _fake_claude(self, listing: str) -> None:
        self.listing.write_text(listing.format(mount=self.mount),
                                encoding="utf-8")
        fake = self.bin / "claude"
        fake.write_text(
            "#!/usr/bin/env bash\n"
            '[ "$1 $2" = "plugin list" ] || { echo "unexpected: $*" >&2; exit 9; }\n'
            f'cat "{self.listing}"\n', encoding="utf-8")
        fake.chmod(0o755)

    def _fake_claude_failing(self) -> None:
        """A ``claude plugin list`` that fails (auth, crash): exit 3."""
        fake = self.bin / "claude"
        fake.write_text(
            "#!/usr/bin/env bash\n"
            'echo "Error: not authenticated" >&2\n'
            'echo "second line" >&2\n'
            "exit 3\n", encoding="utf-8")
        fake.chmod(0o755)

    def _fake_claude_stalled(self) -> None:
        """A ``claude plugin list`` that never returns (a blocked network
        refresh, a prompt): exec, so the killed process holds the pipe."""
        fake = self.bin / "claude"
        fake.write_text("#!/usr/bin/env bash\nexec sleep 30\n",
                        encoding="utf-8")
        fake.chmod(0o755)

    def _fake_claude_project_copy(self, project: Path) -> None:
        """List the marketplace copy only when run from ``project``, as a
        project-scope install in its .claude/settings.json would be."""
        self.listing.write_text(LOADED.format(mount=self.mount),
                                encoding="utf-8")
        fake = self.bin / "claude"
        fake.write_text(
            "#!/usr/bin/env bash\n"
            '[ "$1 $2" = "plugin list" ] || { echo "unexpected: $*" >&2; exit 9; }\n'
            # Compare physical paths from bash's own view: on Windows (Git Bash)
            # `pwd -P` prints an MSYS path while Path.resolve() prints a drive
            # path, so a string comparison never matched there.
            f"if [ \"$(pwd -P)\" = \"$(cd '{project.resolve()}' 2>/dev/null && pwd -P)\" ]; then\n"
            f"  cat <<'EOF'\n{MARKETPLACE_COPY}EOF\n"
            "fi\n"
            f'cat "{self.listing}"\n', encoding="utf-8")
        fake.chmod(0o755)

    def _run(self, project: Path | None = None,
             **extra: str) -> subprocess.CompletedProcess:
        env = dict(os.environ,
                   SKILLS_MOUNT=str(self.mount),
                   PROC_MOUNTS=str(self.mounts_file),
                   PATH=f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}",
                   LC_ALL="C.UTF-8")
        env.pop("PROJECT_DIR", None)
        env.pop("LIST_TIMEOUT", None)
        env.update(extra)
        if project is not None:
            env["PROJECT_DIR"] = str(project)
        return subprocess.run(["bash", str(CHECK)], env=env,
                              cwd=str(Path(self._tmp.name)),
                              capture_output=True, text=True,
                              encoding="utf-8", timeout=30)

    def _assert_fails(self, result, *needles: str) -> str:
        self.assertNotEqual(result.returncode, 0, result.stdout)
        out = result.stdout + result.stderr
        lines = [line for line in out.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, out)
        self.assertIn(str(self.mount), out)
        for needle in needles:
            self.assertIn(needle, out)
        return out

    def test_ok(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(LOADED)
        result = self._run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, result.stdout)
        self.assertIn("ok", lines[0])

    def test_absent_mount(self):
        self._mounts(None)
        self._plugin_folder()
        self._fake_claude(LOADED)
        self._assert_fails(self._run(), "not mounted", "sbx create",
                           "--skills readonly")

    def test_rw_mount(self):
        self._mounts("rw,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(LOADED)
        self._assert_fails(self._run(), "read-write", "--skills readonly")

    def test_empty_mount(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._fake_claude(LOADED)
        self._assert_fails(self._run(), "tk-studio install",
                           "sbx skills import")

    def test_not_loaded(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(NOT_LOADED)
        self._assert_fails(self._run(), "tk-studio@skills-dir")

    def test_skills_dir_listed_but_not_loaded(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(LOADED.replace("✔ loaded", "✘ failed to load"))
        self._assert_fails(self._run(), "tk-studio@skills-dir")

    def test_skills_dir_loaded_from_another_path(self):
        # A project (or other) .claude/skills/tk-studio loads as
        # tk-studio@skills-dir while nothing loads from the read-only mount.
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        other = self.project / ".claude" / "skills"
        self._fake_claude(LOADED.replace("{mount}", str(other)))
        out = self._assert_fails(self._run(), "tk-studio@skills-dir",
                                 f"from {other}/tk-studio",
                                 "not from the mount")
        self.assertNotIn("validate", out)

    def test_shadowed(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(MARKETPLACE_COPY + LOADED)
        result = self._run()
        self._assert_fails(
            result,
            "claude plugin uninstall tk-studio@tk-studio --scope user",
            "--scope project", "--scope local")
        # The fake claude prints "unexpected" on anything but `plugin list`:
        # the check never ran the uninstall it names.
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("unexpected", result.stderr)
        self.assertIn("claude plugin marketplace remove tk-studio", result.stderr)

    def test_shadowed_and_skills_dir_not_loaded(self):
        # A real shadow likely keeps the skills-dir entry from loading: the
        # check must still name the uninstall, not the validate/settings fix.
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(MARKETPLACE_COPY + NOT_LOADED)
        out = self._assert_fails(
            self._run(),
            "claude plugin uninstall tk-studio@tk-studio --scope user")
        self.assertNotIn("validate", out)

    def test_shadowed_by_another_marketplace(self):
        # Contract §6: any tk-studio@<m> but skills-dir is a shadowing copy;
        # the marketplace removal is named only for the tk-studio one.
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(OTHER_MARKET_COPY + LOADED)
        out = self._assert_fails(
            self._run(),
            "claude plugin uninstall tk-studio@other-market --scope user",
            "--scope project")
        self.assertNotIn("marketplace remove tk-studio", out)
        self.assertNotIn("tk-studio@tk-studio", out)

    def test_shadowed_by_two_marketplaces(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude(OTHER_MARKET_COPY + MARKETPLACE_COPY + LOADED)
        self._assert_fails(
            self._run(),
            "claude plugin uninstall tk-studio@other-market --scope user",
            "claude plugin uninstall tk-studio@tk-studio --scope user",
            "claude plugin marketplace remove tk-studio")

    def test_plugin_list_fails(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude_failing()
        out = self._assert_fails(self._run(), "claude plugin list failed",
                                 "Error: not authenticated")
        self.assertNotIn("validate", out)
        self.assertNotIn("second line", out)

    @unittest.skipUnless(shutil.which("timeout"), "timeout is required")
    def test_plugin_list_times_out(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude_stalled()
        started = time.monotonic()
        out = self._assert_fails(self._run(LIST_TIMEOUT="1"), "timed out",
                                 "claude plugin list")
        self.assertLess(time.monotonic() - started, 20)
        self.assertNotIn("validate", out)

    # --- the `--skills readonly` form proved on the box (2026-10-15): the store is
    # mounted read-only elsewhere and each entry is a symlink in the skills dir.

    def _store_link(self, options: str) -> Path:
        """A store mounted at <root>/run/sbx/skills-shared with the plugin
        folder in it, and $MOUNT/tk-studio a symlink into it."""
        store = Path(self._tmp.name) / "run" / "sbx" / "skills-shared"
        manifest = store / "tk-studio" / ".claude-plugin"
        manifest.mkdir(parents=True)
        (manifest / "plugin.json").write_text(
            '{"name": "tk-studio", "version": "0.3.0"}', encoding="utf-8")
        link = self.mount / "tk-studio"
        try:
            os.symlink(store / "tk-studio", link, target_is_directory=True)
        except OSError as exc:  # Windows without the symlink privilege
            self.skipTest(f"symlinks cannot be created here: {exc}")
        rows = ["proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
                "host /c/GitHub/tk-studio virtiofs ro,relatime 0 0",
                f"host {store} virtiofs {options} 0 0"]
        self.mounts_file.write_text("\n".join(rows) + "\n", encoding="utf-8")
        return store

    def test_linked_readonly_store_passes(self):
        self._store_link("ro,nosuid,nodev,relatime")
        self._fake_claude(LOADED)
        result = self._run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("read-only (linked)", result.stdout)

    def test_linked_readwrite_store_fails(self):
        self._store_link("rw,nosuid,nodev,relatime")
        self._fake_claude(LOADED)
        self._assert_fails(self._run(), "linked read-write",
                           "sbx create --skills readonly")

    def test_path_with_tilde_counts_as_the_mount(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        home = self.mount.parent.parent  # <root>/home/agent
        self._fake_claude(LOADED.replace("{mount}", "~/.claude/skills"))
        result = self._run(HOME=str(home))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_listing_runs_from_project_dir(self):
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        self._fake_claude_project_copy(self.project)
        # Without PROJECT_DIR the cwd is the temp root: no copy listed.
        result = self._run()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # With PROJECT_DIR the fake claude sees the project as its cwd.
        self._assert_fails(
            self._run(self.project),
            "claude plugin uninstall tk-studio@tk-studio --scope user")

    def test_listing_runs_from_nested_project_dir(self):
        # Story 28.3: in the one-mount sandbox the supervisor's project is
        # nested (apps/supervisor); its project-scope copy counts when
        # PROJECT_DIR is the nested root, and is not seen from the outer one.
        self._mounts("ro,nosuid,nodev,relatime")
        self._plugin_folder()
        nested = self.project / "apps" / "supervisor"
        nested.mkdir(parents=True)
        self._fake_claude_project_copy(nested)
        result = self._run(self.project)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self._assert_fails(
            self._run(nested),
            "claude plugin uninstall tk-studio@tk-studio --scope user")


_SBX_TOKEN = re.compile(r"(^|[\s;|&(])sbx\s")
_DQ_STRING = re.compile(r'"(?:[^"\\]|\\.)*"')


def _substitutions(line: str) -> list[str]:
    """The bodies of every ``$(...)`` (parentheses balanced) and backtick
    substitution in ``line``: these run even inside double quotes."""
    bodies = re.findall(r"`([^`]*)`", line)
    start = line.find("$(")
    while start != -1:
        depth, i = 0, start + 1
        while i < len(line):
            depth += {"(": 1, ")": -1}.get(line[i], 0)
            if depth == 0:
                break
            i += 1
        bodies.append(line[start + 2:i])
        start = line.find("$(", start + 2)
    return bodies


def _runs_forbidden(line: str) -> bool:
    """True when a shell line could run an uninstall or ``sbx``: in its text
    outside double-quoted literals (message text is data), or in a command
    substitution, which runs even inside quotes."""
    for code in [_DQ_STRING.sub('""', line), *_substitutions(line)]:
        if "uninstall" in code or _SBX_TOKEN.search(code):
            return True
    return False


class ProvisionScriptTests(unittest.TestCase):

    def test_no_per_sandbox_plugin_install(self):
        text = PROVISION.read_text(encoding="utf-8")
        self.assertNotIn("claude plugin install", text)
        self.assertNotIn("marketplace add", text)
        self.assertNotIn("claude plugin update", text)

    def test_runs_the_check_and_exits_on_failure(self):
        text = PROVISION.read_text(encoding="utf-8")
        self.assertIn("step skills-mount", text)
        self.assertIn(
            'PROJECT_DIR="$PROJ" bash "$HERE/check-skills-mount.sh" || exit 1',
            text)

    def test_runs_the_check_from_the_nested_supervisor_too(self):
        # Story 28.3 (AC2): a shadowing copy under apps/supervisor/.claude is
        # seen only from the nested dir (test_listing_runs_from_nested_
        # project_dir), so provisioning checks from there as well, when the
        # nested project exists, and fails the same way.
        text = PROVISION.read_text(encoding="utf-8")
        outer = text.index(
            'PROJECT_DIR="$PROJ" bash "$HERE/check-skills-mount.sh" || exit 1')
        guard = text.index(
            'if [ -f "$PROJ/apps/supervisor/.tk-studio/config.yaml" ]; then')
        nested = text.index(
            'PROJECT_DIR="$PROJ/apps/supervisor" bash '
            '"$HERE/check-skills-mount.sh" || exit 1')
        self.assertLess(outer, guard)
        self.assertLess(guard, nested)
        self.assertLess(nested, text.index("step claude-flags"))

    def test_usage_names_the_one_mount_layout(self):
        # Story 28.3: claude-tk-studio mounts the repository once; both
        # arguments are that path, bun is provisioned for apps/supervisor, and
        # TK_STUDIO_ROOT stays the outer root (the studio mount).
        text = PROVISION.read_text(encoding="utf-8")
        header = text.split("\nset -u", 1)[0]
        self.assertIn("WITH_BUN=1 bash <this> /c/GitHub/tk-studio "
                      "/c/GitHub/tk-studio", header)
        self.assertIn("two-mount form", header)
        self.assertIn('PROJ="$1"; STUDIO="$2"', text)
        self.assertIn('echo "export TK_STUDIO_ROOT=$STUDIO" >> ~/.profile',
                      text)

    def test_check_never_uninstalls_or_calls_sbx(self):
        # The guard itself: a call chained after a message, or hidden in a
        # quoted substitution, is flagged; a fix named in a message is not.
        self.assertTrue(_runs_forbidden('fail "is shadowed"; sbx rm x'))
        self.assertTrue(_runs_forbidden('x="$(cd /p && sbx ls 2>&1)"'))
        self.assertTrue(_runs_forbidden(
            'y="$(claude plugin uninstall tk-studio@tk-studio)"'))
        self.assertFalse(_runs_forbidden(
            'fail "run claude plugin uninstall x, then sbx rm <sandbox>"'))
        code = [line for line in CHECK.read_text(encoding="utf-8").splitlines()
                if not line.lstrip().startswith("#")]
        for line in code:
            self.assertFalse(_runs_forbidden(line), line)


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class EngineRootTests(unittest.TestCase):
    """Story 28.3 (AC2): launch-epic.sh and resume-run.sh take ROOT, the
    nested supervisor or the repository root; a ROOT that is neither a studio
    project root nor holds .bmad-loop/ is refused by name, exit 2, before
    anything is written or run."""

    SCRIPTS = ((LAUNCH, "launch-epic", "42"), (RESUME, "resume-run", "r-1"))

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.marker = self.root / "ran"
        # Anything the scripts would run past the refusal leaves a marker.
        for tool in ("claude", "bmad-loop"):
            fake = self.bin / tool
            fake.write_text(f'#!/usr/bin/env bash\ntouch "{self.marker}"\n',
                            encoding="utf-8")
            fake.chmod(0o755)
        # Past the refusal the payload settles (sleep 20) and holds while
        # pgrep finds an engine: stub both so an accepted ROOT ends at once
        # and never sees a real engine on this host.
        for tool, body in (("sleep", "exit 0"), ("pgrep", "exit 1")):
            fake = self.bin / tool
            fake.write_text(f"#!/usr/bin/env bash\n{body}\n", encoding="utf-8")
            fake.chmod(0o755)

    def _run(self, script: Path, arg: str, root: Path):
        env = dict(os.environ, ROOT=str(root), HOME=str(self.root),
                   PATH=f"{self.bin}{os.pathsep}{os.environ.get('PATH', '')}")
        return subprocess.run(["bash", str(script), arg], env=env,
                              cwd=str(self.root), capture_output=True,
                              text=True, encoding="utf-8", timeout=30)

    def test_root_that_is_no_project_is_refused_by_name(self):
        bad = self.root / "not-a-project"
        bad.mkdir()
        for script, name, arg in self.SCRIPTS:
            result = self._run(script, arg, bad)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn(f"{name}: ROOT={bad} is not a studio project root",
                          result.stderr)
            self.assertIn("/c/GitHub/tk-studio/apps/supervisor",
                          result.stderr)
            self.assertEqual(list(bad.iterdir()), [], name)
            self.assertFalse(self.marker.exists(), name)

    def test_root_with_either_marker_gets_past_the_check(self):
        # A studio project root (.tk-studio/config.yaml only) and a bare
        # engine project (.bmad-loop/ only) are both accepted: the payload
        # runs (the stubbed claude / bmad-loop leaves the marker) and the
        # script ends without the refusal.
        for kind in ("config", "bmad-loop"):
            for script, name, arg in self.SCRIPTS:
                root = self.root / f"{kind}-{name}"
                if kind == "config":
                    (root / ".tk-studio").mkdir(parents=True)
                    (root / ".tk-studio" / "config.yaml").write_text(
                        "project_id: x\n", encoding="utf-8")
                else:
                    (root / ".bmad-loop").mkdir(parents=True)
                if self.marker.exists():
                    self.marker.unlink()
                result = self._run(script, arg, root)
                label = f"{name} with {kind}"
                self.assertNotEqual(result.returncode, 2, label)
                self.assertNotIn("is not a studio project root",
                                 result.stderr, label)
                self.assertEqual(result.returncode, 0,
                                 f"{label}: {result.stderr}")
                self.assertTrue(self.marker.exists(), label)

    def test_refusal_precedes_any_write_and_spares_the_hold_loop(self):
        for script, _name, _arg in self.SCRIPTS:
            text = script.read_text(encoding="utf-8")
            refusal = text.index('[ ! -f "$ROOT/.tk-studio/config.yaml" ]')
            self.assertLess(refusal, text.index('mkdir -p "$OUT"'))
            self.assertIn("exit 2", text[refusal:text.index('mkdir -p "$OUT"')])
            self.assertIn("while pgrep -f", text)

    def test_headers_name_both_roots(self):
        for script, _name, _arg in self.SCRIPTS:
            header = script.read_text(encoding="utf-8").split("\nset -u", 1)[0]
            self.assertIn("ROOT=/c/GitHub/tk-studio/apps/supervisor", header)
            self.assertIn("ROOT=/c/GitHub/tk-studio ", header)


if __name__ == "__main__":
    unittest.main()
