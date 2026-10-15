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
uninstall or ``sbx``. No network, no real ``claude``.
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


if __name__ == "__main__":
    unittest.main()
