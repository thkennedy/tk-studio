"""Release-discipline guard (ST-048): the skill roster must never outrun
the version gate. released-roster.json is the gate's third file — the skill
list delivered at the recorded version, bumped in lockstep with plugin.json
and marketplace.json by the release motion.

The EP-012 gap this guards against: three shipped skills the installed
plugin never delivered because the gate was never pulled — the roster grew,
the version did not, and AD-13's lockstep check passed trivially. The
real-repo test here goes red in exactly that shape.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
sys.path.insert(0, str(PLUGIN_ROOT / "skills" / "tk-studio-activate" / "scripts"))

import drift_check  # noqa: E402

sys.path.insert(0, str(PLUGIN_ROOT.parents[1] / "tools"))
import release_archive  # noqa: E402  (repo-side, like the gate reads above)

REPO_PLUGIN = json.loads(
    (PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
REPO_MARKETPLACE = json.loads(
    (PLUGIN_ROOT.parents[1] / ".claude-plugin" / "marketplace.json")
    .read_text(encoding="utf-8"))
ROSTER_RECORD = PLUGIN_ROOT / ".claude-plugin" / "released-roster.json"


def _plugin_fixture(tmp: Path, version: str, roster: list[str],
                    recorded_version: str | None = None,
                    recorded: list[str] | None = None) -> Path:
    root = tmp / "plugin"
    (root / ".claude-plugin").mkdir(parents=True)
    for skill in roster:
        d = root / "skills" / skill
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text("# skill\n", encoding="utf-8")
    if recorded is not None or recorded_version is not None:
        (root / ".claude-plugin" / "released-roster.json").write_text(
            json.dumps({"version": recorded_version or version,
                        "skills": recorded if recorded is not None else roster}),
            encoding="utf-8")
    return root


class RealRepoGateTestCase(unittest.TestCase):
    """The guard itself: these go red the moment skills/ changes without a
    version-gate pull — green again when the release motion bumps the gate
    and roster together."""

    def test_repo_roster_rides_the_version_gate(self):
        check = drift_check._released_roster_check(
            PLUGIN_ROOT, REPO_PLUGIN["version"])
        self.assertEqual(check["status"], "ok", check["detail"])

    def test_gate_files_are_in_three_way_lockstep(self):
        entry = next(p for p in REPO_MARKETPLACE["plugins"]
                     if p["name"] == REPO_PLUGIN["name"])
        record = json.loads(ROSTER_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(
            {REPO_PLUGIN["version"], entry["version"], record["version"]},
            {REPO_PLUGIN["version"]},
            "plugin.json, marketplace.json, and released-roster.json must "
            "bump together (the release motion)")


ARCHIVE_FLOOR = (0, 2, 6)
"""First version released under the archive-backstop discipline (ST-057).

From this floor on, the roster must record the release's published
archive — ``archive: {url, sha256}`` — written by
``tools/release_archive.py`` after the asset is published and verified.
The record trails its tag by one commit (a zip cannot contain its own
digest), so this pin validates the repo tip, not historical checkouts:
the tagged commit itself legitimately predates its record.
"""


def _version_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def _archive_record_problems(record: dict) -> list[str]:
    """Shape problems in a roster's archive record, [] when well-formed
    (or legitimately absent below the floor)."""
    version = record.get("version", "")
    archive = record.get("archive")
    problems: list[str] = []
    if archive is None:
        if _version_tuple(version) >= ARCHIVE_FLOOR:
            problems.append(
                f"version {version} is at or beyond the archive-backstop "
                f"floor but records no archive — run "
                f"tools/release_archive.py in the release motion")
        return problems
    sha = archive.get("sha256", "")
    if not (isinstance(sha, str) and len(sha) == 64
            and all(c in "0123456789abcdef" for c in sha.lower())):
        problems.append(f"archive.sha256 is not a 64-hex digest: {sha!r}")
    url = archive.get("url", "")
    expected_tag = f"tk-studio--v{version}"
    if not (isinstance(url, str) and url.startswith("https://")
            and expected_tag in url):
        problems.append(
            f"archive.url must be https and name the release tag "
            f"{expected_tag}: {url!r}")
    return problems


class ArchiveRecordPinTestCase(unittest.TestCase):
    """ST-057: from the 0.2.6 floor on, every release records its
    published archive in the roster, well-formed — red on a missing or
    malformed record."""

    def test_real_repo_roster_archive_rides_the_floor(self):
        record = json.loads(ROSTER_RECORD.read_text(encoding="utf-8"))
        problems = _archive_record_problems(record)
        self.assertEqual(problems, [], "; ".join(problems))

    def test_missing_record_at_the_floor_is_red(self):
        problems = _archive_record_problems(
            {"version": "0.2.6", "skills": []})
        self.assertEqual(len(problems), 1)
        self.assertIn("records no archive", problems[0])

    def test_missing_record_below_the_floor_is_green(self):
        self.assertEqual(_archive_record_problems(
            {"version": "0.2.5", "skills": []}), [])

    def test_malformed_record_is_red_even_below_the_floor(self):
        problems = _archive_record_problems(
            {"version": "0.2.5", "skills": [],
             "archive": {"url": "https://x/tk-studio--v0.2.5/p.zip",
                         "sha256": "abc123"}})
        self.assertEqual(len(problems), 1)
        self.assertIn("64-hex", problems[0])

    def test_url_must_name_the_versions_release_tag(self):
        problems = _archive_record_problems(
            {"version": "0.2.6", "skills": [],
             "archive": {"url": "https://x/tk-studio--v0.2.5/p.zip",
                         "sha256": "0" * 64}})
        self.assertEqual(len(problems), 1)
        self.assertIn("tk-studio--v0.2.6", problems[0])

    def test_http_url_is_red(self):
        problems = _archive_record_problems(
            {"version": "0.2.6", "skills": [],
             "archive": {"url": "http://x/tk-studio--v0.2.6/p.zip",
                         "sha256": "0" * 64}})
        self.assertEqual(len(problems), 1)
        self.assertIn("https", problems[0])

    def test_well_formed_record_at_the_floor_is_green(self):
        self.assertEqual(_archive_record_problems(
            {"version": "0.2.6", "skills": [],
             "archive": {"url": "https://github.com/x/y/releases/download/"
                                "tk-studio--v0.2.6/tk-studio-0.2.6.zip",
                         "sha256": "d1" * 32}}), [])


class NormalizeZipTestCase(unittest.TestCase):
    """ST-057: the published zip's bytes depend only on (tree, commit) —
    the property raw ``git archive <ref>:subdir`` lacks (tree archives
    are stamped with the archiving wall clock, probed live 2026-08-10)."""

    @staticmethod
    def _source_zip(path: Path, order: list[str], stamp: tuple) -> None:
        import zipfile
        entries = {"b.txt": b"beta", "a/c.txt": b"gamma", "a.txt": b"alpha"}
        with zipfile.ZipFile(path, "w") as z:
            for name in order:
                info = zipfile.ZipInfo(name, date_time=stamp)
                z.writestr(info, entries[name])

    def test_output_depends_only_on_content_and_epoch(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self._source_zip(tmp / "s1.zip", ["b.txt", "a/c.txt", "a.txt"],
                             (2026, 1, 1, 0, 0, 0))
            self._source_zip(tmp / "s2.zip", ["a.txt", "b.txt", "a/c.txt"],
                             (2026, 8, 10, 12, 34, 56))
            release_archive.normalize_zip(tmp / "s1.zip", tmp / "n1.zip",
                                          1754000000)
            release_archive.normalize_zip(tmp / "s2.zip", tmp / "n2.zip",
                                          1754000000)
            self.assertEqual((tmp / "n1.zip").read_bytes(),
                             (tmp / "n2.zip").read_bytes(),
                             "normalized bytes must not depend on source "
                             "entry order or mtimes")

    def test_contents_and_names_survive_normalization(self):
        import zipfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self._source_zip(tmp / "s.zip", ["b.txt", "a/c.txt", "a.txt"],
                             (2026, 1, 1, 0, 0, 0))
            release_archive.normalize_zip(tmp / "s.zip", tmp / "n.zip",
                                          1754000000)
            with zipfile.ZipFile(tmp / "n.zip") as z:
                self.assertEqual(z.namelist(),
                                 ["a.txt", "a/c.txt", "b.txt"])
                self.assertEqual(z.read("a/c.txt"), b"gamma")


class RosterGuardShapeTestCase(unittest.TestCase):
    def test_roster_growth_at_unchanged_gate_goes_red(self):
        # the EP-012 gap shape: roster grew, version unchanged
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0",
                                   ["tk-a", "tk-b", "tk-new"],
                                   recorded=["tk-a", "tk-b"])
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("+tk-new", check["detail"])
        self.assertIn("outran the version gate", check["detail"])
        self.assertEqual(check["fix"], drift_check.FIX_RELEASE)
        self.assertIn("release motion", check["fix"])

    def test_shrunk_roster_is_named_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a"],
                                   recorded=["tk-a", "tk-gone"])
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("-tk-gone", check["detail"])

    def test_gate_and_roster_bumped_together_is_green(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.1.0",
                                   ["tk-a", "tk-b", "tk-new"],
                                   recorded=["tk-a", "tk-b", "tk-new"])
            check = drift_check._released_roster_check(root, "1.1.0")
        self.assertEqual(check["status"], "ok", check["detail"])

    def test_record_out_of_lockstep_with_the_gate_is_drift(self):
        # the gate bumped but the third file did not ride the motion
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.1.0", ["tk-a"],
                                   recorded_version="1.0.0",
                                   recorded=["tk-a"])
            check = drift_check._released_roster_check(root, "1.1.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("out of lockstep", check["detail"])
        self.assertEqual(check["fix"], drift_check.FIX_RELEASE)

    def test_missing_record_is_drift_naming_the_release_motion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a"])
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "drift")
        self.assertIn("released-roster.json missing", check["detail"])
        self.assertEqual(check["fix"], drift_check.FIX_RELEASE)

    def test_unreadable_record_is_error_not_a_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a"])
            (root / ".claude-plugin" / "released-roster.json").write_text(
                "{not json", encoding="utf-8")
            check = drift_check._released_roster_check(root, "1.0.0")
        self.assertEqual(check["status"], "error")
        self.assertIn("unreadable", check["detail"])

    def test_plugin_plane_reports_roster_drift_riding_the_shape(self):
        # AC: the plane reports drift with guidance naming the release
        # motion, riding the existing planes/fixes shape
        with tempfile.TemporaryDirectory() as tmp:
            root = _plugin_fixture(Path(tmp), "1.0.0", ["tk-a", "tk-new"],
                                   recorded=["tk-a"])
            (root / ".claude-plugin" / "plugin.json").write_text(
                json.dumps({"name": "tk-studio", "version": "1.0.0"}),
                encoding="utf-8")
            home = Path(tmp) / "home"
            (home / "plugins").mkdir(parents=True)
            cache = home / "cache" / "1.0.0"
            cache.mkdir(parents=True)
            (home / "plugins" / "installed_plugins.json").write_text(
                json.dumps({"version": 2, "plugins": {"tk-studio@m": [
                    {"scope": "user", "version": "1.0.0",
                     "installPath": str(cache)}]}}), encoding="utf-8")
            old = drift_check.PLUGIN_ROOT
            drift_check.PLUGIN_ROOT = root
            try:
                plane = drift_check.check_plugin(Path(tmp) / "proj", None, home)
            finally:
                drift_check.PLUGIN_ROOT = old
        self.assertEqual(plane["plane"], "plugin")
        self.assertEqual(plane["status"], "drift")
        self.assertIn("outran the version gate", plane["detail"])
        self.assertIn("harness-loadable", plane["detail"])
        self.assertIn("release motion", plane["fix"])


if __name__ == "__main__":
    unittest.main()
