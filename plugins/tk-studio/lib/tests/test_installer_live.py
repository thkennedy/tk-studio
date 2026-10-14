"""AC4 on the box (Story 25.2): the written folder loads as tk-studio@skills-dir.

Opt-in: ``TK_STUDIO_LIVE_CLAUDE=1`` (skipped otherwise). Runs the real
``claude`` against an isolated temp ``CLAUDE_CONFIG_DIR`` — never the real
``~/.claude``. Builds a zip of ``plugins/tk-studio`` (tracked files) plus a
test-only probe skill, installs it through the plugin leg with a file-serving
fetcher, then checks ``claude plugin list``, ``claude plugin validate`` and a
headless probe of ``${CLAUDE_PLUGIN_ROOT}`` / ``${CLAUDE_SKILL_DIR}``.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.request
import zipfile
from pathlib import Path
from unittest import mock

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PLUGIN_ROOT.parents[1]
sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"))
import drift_check  # noqa: E402

sys.path.insert(0, str(REPO_ROOT / "tools" / "installer" / "cli"))
from tk_studio_cli import main as cli_main  # noqa: E402  (repo-side)

LIVE = os.environ.get("TK_STUDIO_LIVE_CLAUDE") == "1"
PROBE = """---
name: zz-probe
description: Test-only probe that echoes the plugin root and skill dir.
---

Reply with exactly these two lines and nothing else:

ROOT=${CLAUDE_PLUGIN_ROOT}
SKILL=${CLAUDE_SKILL_DIR}
"""


def _claude(args, env, cwd, timeout=180):
    return subprocess.run([shutil.which("claude"), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace",
                          env=env, cwd=str(cwd), timeout=timeout)


@unittest.skipUnless(LIVE, "set TK_STUDIO_LIVE_CLAUDE=1 to run the on-box "
                           "skills-dir probe against the real claude")
class SkillsDirLiveProbe(unittest.TestCase):
    def setUp(self):
        if shutil.which("claude") is None:
            self.skipTest("claude not on PATH")
        self.real_config = Path(os.environ.get("CLAUDE_CONFIG_DIR")
                                or Path.home() / ".claude")
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.config = self.tmp / "config"
        self.config.mkdir()
        self.env = dict(os.environ, CLAUDE_CONFIG_DIR=str(self.config))
        patcher = mock.patch.dict(os.environ,
                                  {"CLAUDE_CONFIG_DIR": str(self.config)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    def build_zip(self) -> tuple[Path, str]:
        version = json.loads((PLUGIN_ROOT / ".claude-plugin" / "plugin.json")
                             .read_text(encoding="utf-8"))["version"]
        listed = subprocess.run(
            ["git", "ls-files", "-z", "plugins/tk-studio"], cwd=REPO_ROOT,
            capture_output=True, check=True).stdout.decode("utf-8").split("\0")
        out = self.tmp / f"tk-studio-{version}.zip"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for rel in filter(None, listed):
                src = REPO_ROOT / rel
                if src.is_file():
                    zf.write(src, src.relative_to(PLUGIN_ROOT).as_posix())
            zf.writestr("skills/zz-probe/SKILL.md", PROBE)
        return out, version

    def install(self, roster: Path, served: dict[str, Path]):
        def fetch(url: str) -> bytes:  # file:// serving fetcher
            with urllib.request.urlopen(served[url].as_uri()) as resp:
                return resp.read()
        return cli_main.run(["install", "--roster", str(roster)], fetch=fetch)

    def test_skills_dir_folder_loads_validates_and_substitutes(self):
        zip_path, version = self.build_zip()
        tag = f"tk-studio--v{version}"
        url = (f"https://github.com/thkennedy/tk-studio/releases/download/"
               f"{tag}/tk-studio-{version}.zip")
        roster = {"schema": 1, "channel": "stable",
                  "requires": {"claude-code": ">=2.1.224"},
                  "components": {"plugin": {
                      "tag": tag, "url": url,
                      "sha256": hashlib.sha256(zip_path.read_bytes())
                      .hexdigest()}}}
        self.assertEqual(drift_check.roster_problems(roster), [])
        roster_path = self.tmp / "stable.json"
        roster_path.write_text(json.dumps(roster), encoding="utf-8")

        result, code = self.install(roster_path, {url: zip_path})
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        result, code = self.install(roster_path, {url: zip_path})
        self.assertEqual((code, result["status"]), (0, "complete"), result)
        folder = self.config / "skills" / "tk-studio"
        self.assertTrue((self.config / "skills" / ".tk-studio.previous")
                        .is_dir())

        listed = _claude(["plugin", "list"], self.env, self.tmp)
        sys.stderr.write(f"\n[plugin list]\n{listed.stdout}{listed.stderr}\n")
        self.assertEqual(listed.returncode, 0, listed.stderr)
        block = listed.stdout.split("tk-studio@skills-dir", 1)
        self.assertEqual(len(block), 2, "tk-studio@skills-dir not listed")
        status = re.search(r"Status:\s*(.+)", block[1])
        self.assertIsNotNone(status)
        self.assertIn("loaded", status.group(1))
        self.assertNotIn(".tk-studio.previous", listed.stdout)
        self.assertNotIn(".tk-studio.new", listed.stdout)

        valid = _claude(["plugin", "validate", str(folder)], self.env, self.tmp)
        sys.stderr.write(f"[plugin validate]\n{valid.stdout}{valid.stderr}\n")
        self.assertEqual(valid.returncode, 0, valid.stdout + valid.stderr)
        self.assertIn("Validation passed", valid.stdout + valid.stderr)

        creds = self.real_config / ".credentials.json"
        if not creds.is_file():
            self.skipTest(f"headless probe step skipped: no {creds} to "
                          "symlink into the isolated config")
        try:
            (self.config / ".credentials.json").symlink_to(creds)
        except OSError as exc:
            self.skipTest(f"headless probe step skipped: cannot symlink "
                          f"{creds}: {exc}")
        probe = _claude(["-p", "/tk-studio:zz-probe"], self.env, self.tmp,
                        timeout=300)
        sys.stderr.write(f"[probe]\n{probe.stdout}{probe.stderr}\n")
        self.assertEqual(probe.returncode, 0, probe.stdout + probe.stderr)
        # To end of line: a path may contain spaces (C:/Users/Tim Kennedy).
        root = re.search(r"^\s*ROOT=(.+)$", probe.stdout, re.M)
        skill = re.search(r"^\s*SKILL=(.+)$", probe.stdout, re.M)
        self.assertIsNotNone(root, probe.stdout)
        self.assertIsNotNone(skill, probe.stdout)
        root_v, skill_v = root.group(1).strip(), skill.group(1).strip()
        # Raw and resolved forms: temp paths may be 8.3 names or symlinked
        # (/var -> /private/var) on either side.
        bases = {folder.as_posix(), folder.resolve().as_posix()}
        for value in (root_v, skill_v):
            self.assertNotIn("\\", value, "not a forward-slash path")
            self.assertTrue(any(value.startswith(b) for b in bases),
                            f"{value} not under {sorted(bases)}")
        self.assertIn(skill_v.rstrip("/"),
                      {f"{b}/skills/zz-probe" for b in bases})


if __name__ == "__main__":
    unittest.main()
