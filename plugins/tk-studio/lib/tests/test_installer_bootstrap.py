"""The bootstrap scripts and the shared roster guard (Story 25.4, AC1).

Static checks only: the two ``roster_guard.py`` copies are one file, the
scripts embed exactly the roster's uv pins, never clone or resolve a
"latest" release, put only ``<root>/bin`` on PATH, set git long paths,
verify the wheel before installing it, install into the same uv tool
environment the CLI's self-update replaces, and the README publishes each
script's real SHA-256.
"""
from __future__ import annotations

import ast
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
LIB_GUARD = PLUGIN_ROOT / "lib" / "roster_guard.py"
CLI_GUARD = (REPO_ROOT / "tools" / "installer" / "cli" / "tk_studio_cli"
             / "roster_guard.py")
INSTALLER = REPO_ROOT / "tools" / "installer"
PS1 = INSTALLER / "install.ps1"
SH = INSTALLER / "install.sh"
ROSTERS = INSTALLER / "rosters"

sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"))
import drift_check  # noqa: E402
import roster_guard  # noqa: E402  (lib/, on the path through drift_check)

sys.path.insert(0, str(INSTALLER / "cli"))
from tk_studio_cli import apps  # noqa: E402  (repo-side)


def _uv_entry(channel: str) -> dict:
    return json.loads((ROSTERS / f"{channel}.json").read_text(
        encoding="utf-8"))["components"]["uv"]


class SharedGuard(unittest.TestCase):
    def test_two_copies_are_byte_identical(self):
        self.assertEqual(LIB_GUARD.read_bytes(), CLI_GUARD.read_bytes(),
                         "edit plugins/tk-studio/lib/roster_guard.py and copy "
                         "it to tools/installer/cli/tk_studio_cli/")

    def test_both_copies_import_only_the_stdlib(self):
        for path in (LIB_GUARD, CLI_GUARD):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            names = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names.update(a.name.split(".")[0] for a in node.names)
                elif isinstance(node, ast.ImportFrom):
                    self.assertEqual(node.level, 0, f"{path}: relative import")
                    names.add(node.module.split(".")[0])
            with self.subTest(path=str(path)):
                self.assertTrue(names)
                self.assertEqual(names - set(sys.stdlib_module_names), set())

    def test_drift_check_reexports_the_guard(self):
        self.assertIs(drift_check.roster_problems, roster_guard.roster_problems)
        self.assertIs(drift_check.RELEASE_COMPONENTS,
                      roster_guard.RELEASE_COMPONENTS)
        self.assertNotIn("def roster_problems", (
            PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"
            / "drift_check.py").read_text(encoding="utf-8"))

    def test_cli_has_no_second_parser(self):
        text = (CLI_GUARD.parent / "plugin_leg.py").read_text(encoding="utf-8")
        self.assertIn("roster_guard.roster_problems(roster)", text)
        self.assertNotIn("_HEX64", text)
        self.assertNotIn("_SEMVER", text)


SHARED_COPIES = ("skills_plane.py", "miniyaml.py",   # Story 25.5
                 "sandbox_login.py")                # Story 33.2


class SharedCopies(unittest.TestCase):
    """The doctor's shared modules: one file each, stdlib only."""

    def test_copies_are_byte_identical(self):
        for name in SHARED_COPIES:
            with self.subTest(name=name):
                self.assertEqual(
                    (PLUGIN_ROOT / "lib" / name).read_bytes(),
                    (CLI_GUARD.parent / name).read_bytes(),
                    f"edit plugins/tk-studio/lib/{name} and copy it to "
                    "tools/installer/cli/tk_studio_cli/")

    def test_copies_import_only_the_stdlib(self):
        for name in SHARED_COPIES:
            for path in (PLUGIN_ROOT / "lib" / name, CLI_GUARD.parent / name):
                tree = ast.parse(path.read_text(encoding="utf-8"))
                names = set()
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        names.update(a.name.split(".")[0] for a in node.names)
                    elif isinstance(node, ast.ImportFrom):
                        self.assertEqual(node.level, 0,
                                         f"{path}: relative import")
                        names.add(node.module.split(".")[0])
                with self.subTest(path=str(path)):
                    self.assertTrue(names)
                    self.assertEqual(names - set(sys.stdlib_module_names),
                                     set())

    def test_drift_check_reexports_the_plane(self):
        import skills_plane
        self.assertIs(drift_check.skills_dir_check,
                      skills_plane.skills_dir_check)
        self.assertIs(drift_check.FIX_UPDATE, skills_plane.FIX_UPDATE)
        self.assertNotIn("def _marketplace_copies", (
            PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"
            / "drift_check.py").read_text(encoding="utf-8"))

    def test_the_cli_imports_only_itself_and_the_stdlib(self):
        allowed = set(sys.stdlib_module_names) | {"tk_studio_cli"}
        for path in sorted(CLI_GUARD.parent.glob("*.py")):
            names = set()
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.Import):
                    names.update(a.name.split(".")[0] for a in node.names)
                elif isinstance(node, ast.ImportFrom):
                    names.add((node.module or "").split(".")[0])
            with self.subTest(path=path.name):
                self.assertEqual(names - allowed, set())


class Scripts(unittest.TestCase):
    def setUp(self):
        self.ps1 = PS1.read_text(encoding="utf-8")
        self.sh = SH.read_text(encoding="utf-8")

    def test_ps1_embeds_the_rosters_windows_uv_pin(self):
        version = re.search(r"\$UvVersion\s*=\s*'([^']+)'", self.ps1).group(1)
        target = re.search(r"\$UvTarget\s*=\s*'([^']+)'", self.ps1).group(1)
        sha = re.search(r"\$UvSha256\s*=\s*'([^']+)'", self.ps1).group(1)
        self.assertEqual(target, "x86_64-pc-windows-msvc")
        for channel in ("stable", "latest"):
            with self.subTest(channel=channel):
                uv = _uv_entry(channel)
                self.assertEqual(version, uv["version"])
                self.assertEqual(sha, uv["sha256"][target])

    def test_sh_embeds_the_rosters_linux_and_darwin_uv_pins(self):
        version = re.search(r"^UV_VERSION=(\S+)$", self.sh, re.M).group(1)
        pins = {
            "x86_64-unknown-linux-gnu": re.search(
                r"^UV_SHA256_X86_64_LINUX=(\S+)$", self.sh, re.M).group(1),
            "aarch64-apple-darwin": re.search(
                r"^UV_SHA256_AARCH64_DARWIN=(\S+)$", self.sh, re.M).group(1)}
        for channel in ("stable", "latest"):
            uv = _uv_entry(channel)
            self.assertEqual(version, uv["version"])
            for target, sha in pins.items():
                with self.subTest(channel=channel, target=target):
                    self.assertEqual(sha, uv["sha256"][target])
        # each pin is used for its own target
        self.assertRegex(self.sh, r"UV_TARGET=x86_64-unknown-linux-gnu; "
                                  r"UV_SHA256=\"\$UV_SHA256_X86_64_LINUX\"")
        self.assertRegex(self.sh, r"UV_TARGET=aarch64-apple-darwin; "
                                  r"UV_SHA256=\"\$UV_SHA256_AARCH64_DARWIN\"")

    def test_no_other_digest_is_embedded(self):
        known = set(_uv_entry("latest")["sha256"].values())
        for name, text in (("install.ps1", self.ps1), ("install.sh", self.sh)):
            with self.subTest(script=name):
                self.assertLessEqual(set(re.findall(r"\b[0-9a-f]{64}\b", text)),
                                     known, "a digest not read from the roster")

    def test_never_clones_or_resolves_latest(self):
        for name, text in (("install.ps1", self.ps1), ("install.sh", self.sh)):
            with self.subTest(script=name):
                self.assertNotIn("git clone", text)
                self.assertNotIn("/releases/latest", text)

    def test_only_root_bin_goes_on_path(self):
        user_path = [ln for ln in self.ps1.splitlines()
                     if re.search(r"Registry\]::SetValue\(.*'Path'", ln)]
        session_path = [ln for ln in self.ps1.splitlines()
                        if re.search(r"\$env:Path\s*=", ln)]
        self.assertEqual(len(user_path), 1)
        for line in user_path + session_path:
            self.assertIn("$Bin", line)
        self.assertRegex(self.ps1, r"\$Bin\s*=\s*Join-Path \$Root 'bin'")
        self.assertRegex(self.ps1, r"\$Root\s*=\s*Join-Path \$env:LOCALAPPDATA "
                                   r"'tk-studio'")
        exports = re.findall(r".*(?<![A-Z_])PATH=.*", self.sh)
        self.assertEqual(len(exports), 1, exports)
        self.assertIn("export PATH=\"%s:$PATH\"", exports[0])
        self.assertIn("\"$BIN\"", exports[0])
        self.assertRegex(self.sh, r'BIN="\$ROOT/bin"')

    def test_ps1_keeps_user_path_unexpanded(self):
        # the expanded read flattens %VAR% entries when written back
        self.assertNotRegex(self.ps1, r"GetEnvironmentVariable\(\s*'Path'\s*,"
                                      r"\s*'User'\s*\)")
        self.assertNotRegex(self.ps1, r"SetEnvironmentVariable\(\s*'Path'")
        self.assertIn("Get-Item -LiteralPath 'HKCU:\\Environment'", self.ps1)
        self.assertIn(".GetValue('Path', '', 'DoNotExpandEnvironmentNames')",
                      self.ps1)
        self.assertIn("[Microsoft.Win32.RegistryValueKind]::ExpandString",
                      self.ps1)
        write = self.ps1.index("[Microsoft.Win32.Registry]::SetValue(")
        self.assertLess(self.ps1.index("DoNotExpandEnvironmentNames"), write)
        self.assertLess(write, self.ps1.index("Send-SettingChange\n", write))
        self.assertIn("SendMessageTimeout", self.ps1)
        self.assertIn("0x1A", self.ps1, "WM_SETTINGCHANGE")

    def test_ps1_is_scoped_and_throws_under_iex(self):
        code = [ln for ln in self.ps1.splitlines()
                if ln.strip() and not ln.lstrip().startswith("#")]
        body = self.ps1[self.ps1.index("#>") + 2:]
        # everything after the help block is one script block run with &
        self.assertTrue(body.strip().startswith("& {"), body[:40])
        self.assertTrue(body.strip().endswith(
            "} $args $PSCommandPath $MyInvocation"))
        self.assertNotRegex(self.ps1, r"(?m)^\s*(\[CmdletBinding\(\)\]\s*)?"
                                      r"param\(\s*\[string\]\$Channel")
        self.assertIn('throw "${Name}: $Detail"', self.ps1)
        exits = [ln.strip() for ln in code if re.search(r"\bexit\b", ln)]
        self.assertEqual(exits, ["exit 1"], "exit only in file mode")
        file_branch = self.ps1[self.ps1.index("if ($AsFile) {"):]
        self.assertIn("exit 1", file_branch)
        self.assertLess(self.ps1.index("$AsFile = $false"),
                        self.ps1.index("Set-StrictMode"))
        for name in ("TK_STUDIO_CHANNEL", "TK_STUDIO_ROSTER"):
            self.assertIn(f"$env:{name}", self.ps1)
        self.assertIn("$env:UV_TOOL_BIN_DIR = $savedToolBin", self.ps1)

    def test_readme_passes_channel_through_env_for_one_liners(self):
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("$env:TK_STUDIO_CHANNEL = 'latest'", readme)
        self.assertIn("| TK_STUDIO_CHANNEL=latest sh", readme)
        self.assertIn("sh -s -- --channel", readme)

    def test_sh_writes_profiles_zsh_and_bash_read(self):
        self.assertIn('add_path_line "$HOME/.profile"', self.sh)
        self.assertIn('Darwin:*|*:*/zsh) add_path_line "$HOME/.zprofile"',
                      self.sh)
        self.assertIn('add_path_line "$HOME/.bash_profile"', self.sh)

    @unittest.skipIf(shutil.which("sh") is None, "sh not on PATH")
    def test_sh_path_block_is_idempotent_per_profile(self):
        block = self.sh[self.sh.index("# 4. only <root>/bin on PATH"):
                        self.sh.index("# 5. long paths for git")]
        mark = re.search(r'^MARK="([^"]+)"$', self.sh, re.M).group(1)
        with tempfile.TemporaryDirectory() as home:
            Path(home, ".bash_profile").write_text("# mine\n", encoding="utf-8")
            env = {"HOME": home, "SHELL": "/usr/bin/zsh",
                   "PATH": "/usr/bin:/bin", "BIN": "/opt/tk/bin",
                   "MARK": mark}
            for _ in range(2):
                proc = subprocess.run(["sh", "-c", "set -eu\n" + block],
                                      env=env, capture_output=True, text=True)
                self.assertEqual(proc.returncode, 0, proc.stderr)
            for name in (".profile", ".zprofile", ".bash_profile"):
                with self.subTest(profile=name):
                    text = Path(home, name).read_text(encoding="utf-8")
                    self.assertEqual(text.count(mark), 1)
                    self.assertIn('export PATH="/opt/tk/bin:$PATH"', text)
            self.assertFalse(Path(home, ".bash_login").exists())

    def test_sets_git_long_paths(self):
        for name, text in (("install.ps1", self.ps1), ("install.sh", self.sh)):
            with self.subTest(script=name):
                self.assertIn("git config --global core.longpaths true", text)

    def test_wheel_verified_before_uv_tool_install(self):
        cases = (("install.ps1", self.ps1, "Get-Verified $WheelUrl $WheelSha",
                  "& $Uv tool install --force $wheel"),
                 ("install.sh", self.sh,
                  'get_verified "$WHEEL_URL" "$WHEEL_SHA"',
                  '"$UV" tool install --force "$WHEEL"'))
        for name, text, verify, install in cases:
            with self.subTest(script=name):
                self.assertEqual(text.count(verify), 1)
                self.assertEqual(text.count(install), 1)
                self.assertLess(text.index(verify), text.index(install))

    def test_uv_archive_verified_against_embedded_sha_before_extraction(self):
        cases = (("install.ps1", self.ps1,
                  'Get-Verified "https://github.com/astral-sh/uv/releases/'
                  'download/$UvVersion/uv-$UvTarget.zip" $UvSha256 $zip',
                  "Expand-Archive -LiteralPath $zip"),
                 ("install.sh", self.sh,
                  'get_verified "https://github.com/astral-sh/uv/releases/'
                  'download/$UV_VERSION/uv-$UV_TARGET.tar.gz" \\\n'
                  '    "$UV_SHA256" "$WORK/uv.tar.gz"',
                  'tar -xzf "$WORK/uv.tar.gz"'))
        for name, text, verify, extract in cases:
            with self.subTest(script=name):
                self.assertEqual(text.count(verify), 1)
                self.assertEqual(text.count(extract), 1)
                self.assertLess(text.index(verify), text.index(extract))
        # the verifier compares the digest and refuses before returning
        ps_verify = self.ps1[self.ps1.index("function Get-Verified"):
                             self.ps1.index("function Send-SettingChange")]
        self.assertIn("Get-FileHash -Algorithm SHA256", ps_verify)
        self.assertIn("if ($got -ne $Sha256)", ps_verify)
        self.assertIn("Stop-Bootstrap 'DigestMismatch'", ps_verify)
        sh_verify = self.sh[self.sh.index("get_verified() {"):
                            self.sh.index("# 1. uv, pinned and unmanaged")]
        self.assertIn('if [ "$got" != "$2" ]; then', sh_verify)
        self.assertIn("fail DigestMismatch", sh_verify)
        # each script extracts exactly once: the verified uv archive
        self.assertEqual(self.ps1.count("Expand-Archive"), 1)
        self.assertEqual(len(re.findall(r"(?m)^\s*(tar|unzip)\s", self.sh)), 1)

    def test_uv_installed_unmanaged(self):
        """The pinned archive is unpacked into tools/uv-<version>; astral's
        installer script (which writes the receipt that turns
        ``uv self update`` on) is never fetched or run."""
        for name, text in (("install.ps1", self.ps1), ("install.sh", self.sh)):
            with self.subTest(script=name):
                self.assertNotIn("astral.sh", text)
                self.assertNotIn("uv-installer", text)
                self.assertNotIn("UV_INSTALL_DIR", text)
                urls = re.findall(r"https://\S*astral-sh\S*", text)
                self.assertEqual(len(urls), 1, urls)
                self.assertRegex(urls[0], r"^https://github\.com/astral-sh/uv/"
                                          r"releases/download/\$\w+/uv-\$\w+"
                                          r"\.(zip|tar\.gz)\"?$")
        self.assertRegex(self.ps1, r"\$UvDir\s*=\s*Join-Path \$Tools "
                                   r"\"uv-\$UvVersion\"")
        self.assertIn("Move-Item -LiteralPath $stage -Destination $UvDir",
                      self.ps1)
        self.assertRegex(self.sh, r'(?m)^UV_DIR="\$TOOLS/uv-\$UV_VERSION"$')
        self.assertIn('mv "$WORK/uv/uv-$UV_TARGET" "$UV_DIR"', self.sh)

    def test_same_uv_tool_dirs_as_the_cli_self_update(self):
        """``uv tool install --force`` replaces one tool environment only
        when the bootstrap and ``cli_leg`` name the same two folders:
        ``UV_TOOL_DIR=<root>/tools/uv-tools``, ``UV_TOOL_BIN_DIR=<root>/bin``."""
        want = {"UV_TOOL_DIR": "tools/uv-tools", "UV_TOOL_BIN_DIR": "bin"}
        # install.ps1: $Bin/$Tools under $Root, then the two assignments
        self.assertRegex(self.ps1, r"\$Tools\s*=\s*Join-Path \$Root 'tools'")
        self.assertIn("$env:UV_TOOL_BIN_DIR = $Bin", self.ps1)
        self.assertIn("$env:UV_TOOL_DIR = Join-Path $Tools 'uv-tools'",
                      self.ps1)
        # install.sh: the same, on the install command itself
        self.assertRegex(self.sh, r'(?m)^TOOLS="\$ROOT/tools"$')
        self.assertIn('UV_TOOL_BIN_DIR="$BIN" UV_TOOL_DIR="$TOOLS/uv-tools" '
                      '"$UV" tool install --force "$WHEEL"', self.sh)
        # cli_leg, on both platforms (in-process run and the Windows helper)
        data = b"PK wheel"
        url = ("https://github.com/thkennedy/tk-studio/releases/download/"
               "cli--v0.2.0/tk_studio_cli-0.2.0-py3-none-any.whl")
        entry = {"tag": "cli--v0.2.0", "url": url,
                 "sha256": hashlib.sha256(data).hexdigest()}
        for plat in (apps.Platform("linux", "x86_64"),
                     apps.Platform("windows", "x86_64")):
            with self.subTest(platform=plat.system), \
                    tempfile.TemporaryDirectory() as tmp:
                env = {"XDG_DATA_HOME": tmp, "HOME": tmp,
                       "LOCALAPPDATA": tmp}
                seen: list[dict] = []

                def runner(args, env=None):
                    seen.append(dict(env))
                    return subprocess.CompletedProcess(args, 0, "", "")
                ctx = apps.make_ctx(env, platform=plat, fetch=lambda u: data,
                                    runner=runner,
                                    spawn_detached=lambda a, e=None: None,
                                    cli_version="0.1.0")
                uv = ctx.root / "tools" / "uv-0.13.1" / apps._exe(plat, "uv")
                uv.parent.mkdir(parents=True)
                uv.write_text("uv", encoding="utf-8")
                with mock.patch.object(apps.os, "getpid", return_value=1):
                    leg = apps.cli_leg(ctx, entry, None)
                if plat.windows:
                    helper = Path(leg["helper"]).read_text(encoding="utf-8")
                    got = dict(re.findall(r'set "(UV_TOOL_\w+)=([^"]*)"',
                                          helper))
                else:
                    got = {k: v for k, v in seen[-1].items()
                           if k.startswith("UV_TOOL_")}
                self.assertEqual(got, {k: str(ctx.root / v)
                                       for k, v in want.items()})

    def test_cli_absent_is_named(self):
        for name, text in (("install.ps1", self.ps1), ("install.sh", self.sh)):
            with self.subTest(script=name):
                self.assertIn("CliNotShipped", text)

    def test_readme_publishes_each_scripts_sha256(self):
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        for path in (PS1, SH):
            with self.subTest(script=path.name):
                m = re.search(rf"`tools/installer/{re.escape(path.name)}` \| "
                              r"`([0-9a-f]{64})`", readme)
                self.assertIsNotNone(m, f"README has no SHA-256 row for "
                                        f"{path.name}")
                self.assertEqual(m.group(1),
                                 hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertIn("Get-FileHash", readme)
        self.assertIn("sha256sum -c", readme)

    def test_readme_verify_run_works_on_stock_windows_and_macos(self):
        """Stock Windows ships only Windows PowerShell 5.1 (``powershell``),
        which install.ps1 is written for; stock macOS has ``shasum``, not
        ``sha256sum``."""
        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("powershell -ExecutionPolicy Bypass -File "
                      ".\\install.ps1", readme)
        self.assertNotIn("pwsh -ExecutionPolicy", readme)
        self.assertNotIn("pwsh -File install.ps1", readme)
        sha = hashlib.sha256(SH.read_bytes()).hexdigest()
        for check in ("sha256sum -c -", "shasum -a 256 -c -"):
            with self.subTest(check=check):
                self.assertIn(f'echo "{sha}  install.sh" | {check}', readme)

    def test_sh_next_hint_quotes_the_bin_path(self):
        # macOS: <root> is under "Application Support"; a pasted unquoted
        # path splits at the space
        self.assertIn('Next: \\"$BIN/tk-studio\\" install', self.sh)
        self.assertNotIn("Next: $BIN/tk-studio", self.sh)

    def test_scripts_are_lf_pinned(self):
        attrs = (REPO_ROOT / ".gitattributes").read_text(encoding="utf-8")
        self.assertIn("tools/installer/install.* text eol=lf", attrs)
        for path in (PS1, SH):
            self.assertNotIn(b"\r\n", path.read_bytes())

    @unittest.skipIf(shutil.which("bash") is None, "bash not on PATH")
    def test_bash_n_install_sh(self):
        proc = subprocess.run(["bash", "-n", str(SH)], capture_output=True,
                              text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)


if __name__ == "__main__":
    unittest.main()
