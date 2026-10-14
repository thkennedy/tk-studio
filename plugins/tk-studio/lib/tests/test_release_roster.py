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

import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

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
INSTALLER_ROSTERS = PLUGIN_ROOT.parents[1] / "tools" / "installer" / "rosters"


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

    def test_gate_files_are_in_four_way_lockstep(self):
        # gate x4 (AD-21, Story 25.1): plugin.json, marketplace.json,
        # released-roster.json, and latest.json's plugin entry — the
        # channel the release motion writes; stable trails it by PR
        entry = next(p for p in REPO_MARKETPLACE["plugins"]
                     if p["name"] == REPO_PLUGIN["name"])
        record = json.loads(ROSTER_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(
            {REPO_PLUGIN["version"], entry["version"], record["version"]},
            {REPO_PLUGIN["version"]},
            "plugin.json, marketplace.json, and released-roster.json must "
            "bump together (the release motion)")
        roster = json.loads((INSTALLER_ROSTERS / "latest.json")
                            .read_text(encoding="utf-8"))
        plugin = roster["components"]["plugin"]
        self.assertEqual(plugin["tag"], f"tk-studio--v{REPO_PLUGIN['version']}")
        self.assertEqual({"url": plugin["url"], "sha256": plugin["sha256"]},
                         record["archive"])

    def test_installer_rosters_pass_the_guard(self):
        # latest.json: shape + gate x4; stable.json: shape only — it trails
        # latest by PR (consult ruling 2026-10-14T20:13:37Z), so equality at
        # the first cut is evidence, not an invariant
        record = json.loads(ROSTER_RECORD.read_text(encoding="utf-8"))
        rosters = {}
        for channel in ("stable", "latest"):
            roster = json.loads((INSTALLER_ROSTERS / f"{channel}.json")
                                .read_text(encoding="utf-8"))
            gate = {"released_archive": record["archive"],
                    "plugin_version": REPO_PLUGIN["version"]} \
                if channel == "latest" else {}
            problems = drift_check.roster_problems(roster, **gate)
            self.assertEqual(problems, [], f"{channel}: " + "; ".join(problems))
            self.assertEqual(roster["channel"], channel)
            rosters[channel] = roster
        # the exact first-cut set (plugin, uv, bun) is evidence shown by the
        # story's Verification, not an invariant: the operator's later
        # `supervisor` entry (AC3) must keep this suite green
        known = set(drift_check.RELEASE_COMPONENTS) | set(drift_check.TOOL_COMPONENTS)
        latest = set(rosters["latest"]["components"])
        self.assertLessEqual({"plugin", "uv", "bun"}, latest)
        self.assertLessEqual(latest, known)


ARCHIVE_FLOOR = (0, 2, 6)
"""First version released under the archive-backstop discipline (ST-057).

From this floor on, the roster must record the release's published
archive — ``archive: {url, sha256}`` — written by
``tools/release_archive.py`` after the asset is published and verified.
The record trails its tag by one commit (a zip cannot contain its own
digest), so this pin validates the repo tip, not historical checkouts:
the tagged commit itself legitimately predates its record.
"""


def _version_tuple(version: str) -> tuple[int, ...] | None:
    """x.y.z as an int tuple; None when unparseable — the guard must go
    cleanly red on a pre-release-styled or missing version, never crash."""
    parts = version.split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    return tuple(int(p) for p in parts)


def _archive_record_problems(record: dict) -> list[str]:
    """Shape problems in a roster's archive record, [] when well-formed
    (or legitimately absent below the floor)."""
    version = record.get("version", "")
    archive = record.get("archive")
    problems: list[str] = []
    parsed = _version_tuple(version)
    if parsed is None:
        problems.append(f"roster version is not plain x.y.z: {version!r}")
        return problems
    if archive is None:
        if parsed >= ARCHIVE_FLOOR:
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

    def test_unparseable_version_is_a_named_red_not_a_crash(self):
        for version in ("0.2.6-rc1", "0.3.0.dev1", ""):
            problems = _archive_record_problems(
                {"version": version, "skills": []})
            self.assertEqual(len(problems), 1, version)
            self.assertIn("not plain x.y.z", problems[0])

    def test_well_formed_record_at_the_floor_is_green(self):
        self.assertEqual(_archive_record_problems(
            {"version": "0.2.6", "skills": [],
             "archive": {"url": "https://github.com/x/y/releases/download/"
                                "tk-studio--v0.2.6/tk-studio-0.2.6.zip",
                         "sha256": _digest("plugin-0.2.6")}}), [])


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


# --- installer roster (AD-21, Story 25.1) ----------------------------------


def _digest(label: str) -> str:
    """A real-shaped fixture digest: non-periodic and distinct per label —
    the guard refuses periodic placeholders such as ``"a1" * 32``."""
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


FIX_URL = ("https://github.com/o/r/releases/download/tk-studio--v1.2.3/"
           "tk-studio-1.2.3.zip")
FIX_ARCHIVE = {"url": FIX_URL, "sha256": _digest("plugin")}
SUP_URL = ("https://github.com/o/r/releases/download/supervisor--v0.1.0/"
           "supervisor-0.1.0.zip")


def _good_roster(channel: str = "latest") -> dict:
    return {
        "schema": 1, "channel": channel,
        "requires": {"claude-code": ">=2.1.224"},
        "components": {
            "plugin": {"tag": "tk-studio--v1.2.3", "url": FIX_URL,
                       "sha256": _digest("plugin")},
            "uv": {"version": "0.13.1",
                   "sha256": {"x86_64-pc-windows-msvc": _digest("uv-win"),
                              "x86_64-unknown-linux-gnu": _digest("uv-linux")}},
            "bun": {"version": "1.4.3",
                    "sha256": {"x86_64-pc-windows-msvc": _digest("bun-win")}},
        },
    }


def _release_entry(component: str) -> dict:
    prefix = drift_check.RELEASE_COMPONENTS[component]
    tag = f"{prefix}0.1.0"
    return {"tag": tag,
            "url": f"https://github.com/o/r/releases/download/{tag}/"
                   f"{component}-0.1.0.zip",
            "sha256": _digest(component)}


_TRAILING_URL = ("https://github.com/o/r/releases/download/tk-studio--v0.2.15/"
                 "tk-studio-0.2.15.zip")
_TRAILING_PLUGIN = {"tag": "tk-studio--v0.2.15", "url": _TRAILING_URL,
                    "sha256": _digest("plugin-0.2.15")}


def _problems(roster, archive=FIX_ARCHIVE, version="1.2.3") -> list[str]:
    return drift_check.roster_problems(
        roster, released_archive=archive, plugin_version=version)


class InstallerRosterGuardTestCase(unittest.TestCase):
    """One test per row of the story's I/O matrix: the pure guard the lib
    suite and the plugin plane share."""

    def assertNamed(self, problems: list[str], *needles: str) -> None:
        self.assertTrue(
            any(all(n in p for n in needles) for p in problems),
            f"no problem names {needles}: {problems}")

    def test_well_formed_roster_is_green(self):
        self.assertEqual(_problems(_good_roster()), [])

    def test_absent_components_are_green(self):
        roster = _good_roster()
        self.assertNotIn("supervisor", roster["components"])
        self.assertEqual(_problems(roster), [])
        roster["components"] = {}
        self.assertEqual(_problems(roster), [])

    def test_missing_top_level_key_is_named(self):
        for key in ("schema", "channel", "requires", "components"):
            roster = _good_roster()
            del roster[key]
            self.assertNamed(_problems(roster), key, "missing")
        roster = _good_roster()
        roster["requires"] = {}
        self.assertNamed(_problems(roster), "requires.claude-code", "missing")

    def test_requires_claude_code_is_a_version_floor(self):
        roster = _good_roster()
        roster["requires"]["claude-code"] = "latest"
        self.assertNamed(_problems(roster), "requires.claude-code")

    def test_present_entry_incomplete_names_component_and_field(self):
        for component in ("plugin", "supervisor", "studio-web", "cli"):
            for field in ("tag", "url", "sha256"):
                roster = _good_roster()
                entry = roster["components"]["plugin"] if component == "plugin" \
                    else _release_entry(component)
                entry = dict(entry)
                del entry[field]
                roster["components"][component] = entry
                self.assertNamed(_problems(roster),
                                 f"components.{component}.{field}", "missing")

    def test_malformed_digest_is_named(self):
        for bad in ("A1" * 32, "a1" * 31, "z" * 64, 42):
            roster = _good_roster()
            roster["components"]["plugin"]["sha256"] = bad
            self.assertNamed(_problems(roster, archive=None),
                             "components.plugin.sha256", "64-lowercase-hex")
            roster = _good_roster()
            roster["components"]["uv"]["sha256"]["x86_64-pc-windows-msvc"] = bad
            self.assertNamed(_problems(roster),
                             "components.uv.sha256.x86_64-pc-windows-msvc")

    def test_placeholder_values_are_refused(self):
        roster = _good_roster()
        roster["components"]["plugin"]["sha256"] = "0" * 64
        self.assertNamed(_problems(roster, archive=None),
                         "components.plugin", "placeholder")
        roster = _good_roster()
        roster["components"]["bun"]["sha256"]["x86_64-pc-windows-msvc"] = "f" * 64
        self.assertNamed(_problems(roster), "components.bun", "placeholder")
        cases = [("supervisor", "tag", "supervisor--vTBD"),
                 ("supervisor", "url", SUP_URL.replace("/o/", "/<owner>/")),
                 ("cli", "url", SUP_URL.replace("o/r", "o/placeholder"))]
        for component, field, value in cases:
            roster = _good_roster()
            entry = _release_entry(component)
            entry[field] = value
            roster["components"][component] = entry
            self.assertNamed(_problems(roster), f"components.{component}",
                             "placeholder")
        roster = _good_roster()
        roster["components"]["uv"]["version"] = "pending"
        self.assertNamed(_problems(roster), "components.uv.version",
                         "placeholder")

    def test_periodic_digest_is_a_placeholder(self):
        # a repeated unit whose length divides 64 is typed, never hashed
        for value in ("ab" * 32, "deadbeef" * 8, "0123456789abcdef" * 4,
                      _digest("half")[:32] * 2):
            roster = _good_roster()
            roster["components"]["plugin"]["sha256"] = value
            self.assertNamed(_problems(roster, archive=None),
                             "components.plugin.sha256", "placeholder")
            roster = _good_roster()
            roster["components"]["uv"]["sha256"]["x86_64-pc-windows-msvc"] = value
            self.assertNamed(_problems(roster),
                             "components.uv.sha256.x86_64-pc-windows-msvc",
                             "placeholder")
            roster = _good_roster()
            roster["components"]["cli"] = dict(_release_entry("cli"),
                                               sha256=value)
            self.assertNamed(_problems(roster), "components.cli.sha256",
                             "placeholder")

    def test_duplicate_tool_target_digests_are_fabricated(self):
        # real upstream assets differ per platform: a shared digest is copied
        for tool in ("uv", "bun"):
            roster = _good_roster()
            digests = roster["components"][tool]["sha256"]
            digests["x86_64-unknown-linux-gnu"] = digests["x86_64-pc-windows-msvc"]
            self.assertNamed(_problems(roster), f"components.{tool}.sha256",
                             "x86_64-pc-windows-msvc",
                             "x86_64-unknown-linux-gnu", "same digest")

    def test_placeholder_platform_target_is_refused(self):
        for target in ("<platform target>", "TBD", "", "  "):
            roster = _good_roster()
            roster["components"]["uv"]["sha256"][target] = _digest("uv-mac")
            self.assertNamed(_problems(roster), "components.uv.sha256",
                             "placeholder platform target", repr(target))

    def test_tool_entry_shape(self):
        for tool in ("uv", "bun"):
            for digests in (_digest("uv-win"), {}, [_digest("uv-win")]):
                roster = _good_roster()
                roster["components"][tool]["sha256"] = digests
                self.assertNamed(_problems(roster), f"components.{tool}.sha256",
                                 "map")
            roster = _good_roster()
            roster["components"][tool]["sha256"] = {
                "x86_64-unknown-linux-gnu": _digest("uv-linux")}
            self.assertNamed(_problems(roster), f"components.{tool}.sha256",
                             "x86_64-pc-windows-msvc")
            roster = _good_roster()
            del roster["components"][tool]["version"]
            self.assertNamed(_problems(roster), f"components.{tool}.version",
                             "missing")

    def test_tag_must_carry_its_components_prefix(self):
        roster = _good_roster()
        entry = _release_entry("cli")
        entry["tag"] = "supervisor--v0.1.0"
        entry["url"] = SUP_URL
        roster["components"]["cli"] = entry
        self.assertNamed(_problems(roster), "components.cli.tag", "cli--v")
        roster = _good_roster()
        entry = _release_entry("supervisor")
        entry["tag"] = "supervisor--v0.1"
        roster["components"]["supervisor"] = entry
        self.assertNamed(_problems(roster), "components.supervisor.tag")

    def test_url_must_be_a_github_release_asset_naming_the_tag(self):
        for url in (SUP_URL.replace("https", "http"),
                    "https://example.com/supervisor--v0.1.0/s.zip",
                    SUP_URL.replace("download/supervisor--v0.1.0",
                                    "download/supervisor--v0.0.9")):
            roster = _good_roster()
            entry = _release_entry("supervisor")
            entry["url"] = url
            roster["components"]["supervisor"] = entry
            self.assertNamed(_problems(roster), "components.supervisor.url")

    def test_foreign_url_is_green_only_when_source_names_it(self):
        foreign = SUP_URL.replace("o/r", "o/sup")
        roster = _good_roster()
        roster["components"]["supervisor"] = dict(
            _release_entry("supervisor"), url=foreign)
        self.assertNamed(_problems(roster), "components.supervisor.source",
                         "o/sup")
        roster["components"]["supervisor"]["source"] = "o/sup"
        self.assertEqual(_problems(roster), [])
        roster["components"]["supervisor"]["source"] = "o/other"
        self.assertNamed(_problems(roster), "components.supervisor.source",
                         "does not match")

    def test_source_must_match_its_url_without_a_plugin_entry(self):
        roster = _good_roster()
        del roster["components"]["plugin"]
        roster["components"]["supervisor"] = dict(
            _release_entry("supervisor"),
            url=SUP_URL.replace("o/r", "o/sup"), source="o/sup")
        self.assertEqual(_problems(roster), [])
        roster["components"]["supervisor"]["source"] = "o/r"
        self.assertNamed(_problems(roster), "components.supervisor.source")

    def test_without_a_plugin_entry_every_app_entry_names_its_source(self):
        # no plugin entry, no home: a foreign (or any) URL cannot be told
        # from the roster's own repository, so source is required
        for component in ("supervisor", "studio-web", "cli"):
            roster = _good_roster()
            del roster["components"]["plugin"]
            entry = _release_entry(component)
            roster["components"][component] = dict(
                entry, url=entry["url"].replace("o/r", "o/sup"))
            self.assertNamed(_problems(roster), f"components.{component}.source",
                             "missing", "without the plugin entry")
            roster["components"][component]["source"] = "o/sup"
            self.assertEqual(_problems(roster), [])
        # with the plugin entry present, an own-repository entry needs none
        roster = _good_roster()
        roster["components"]["supervisor"] = _release_entry("supervisor")
        self.assertEqual(_problems(roster), [])

    def test_gate_x4_plugin_entry_agrees_with_the_gate(self):
        self.assertNamed(_problems(_good_roster(), version="1.2.4"),
                         "components.plugin.tag", "gate x4")
        self.assertNamed(
            _problems(_good_roster(),
                      archive=dict(FIX_ARCHIVE, sha256=_digest("other"))),
            "components.plugin.sha256", "released-roster.json")
        self.assertNamed(
            _problems(_good_roster(),
                      archive=dict(FIX_ARCHIVE, url=FIX_URL.replace("o/r", "o/x"))),
            "components.plugin.url", "released-roster.json")

    def test_trailing_stable_is_green_in_shape_mode(self):
        # stable trails latest by PR: a well-formed plugin entry at an
        # older tag passes the shape-only guard, and is red under gate x4
        roster = _good_roster("stable")
        roster["components"]["plugin"] = dict(_TRAILING_PLUGIN)
        self.assertEqual(drift_check.roster_problems(roster), [])
        self.assertNamed(_problems(roster), "components.plugin.tag", "gate x4")

    def test_no_archive_record_skips_the_archive_comparison(self):
        roster = _good_roster()
        self.assertEqual(_problems(roster, archive=None), [])
        self.assertNamed(_problems(roster, archive=None, version="1.2.4"),
                         "components.plugin.tag", "gate x4")

    def test_schema_must_be_the_integer_one(self):
        # JSON true and 1.0 compare equal to 1 in Python — still refused
        for bad in (True, 1.0, "1"):
            roster = _good_roster()
            roster["schema"] = bad
            self.assertNamed(_problems(roster), "schema", "unsupported")

    def test_unknown_component_and_non_object_are_named(self):
        roster = _good_roster()
        roster["components"]["hermes"] = {}
        self.assertNamed(_problems(roster), "components.hermes", "unknown")
        self.assertEqual(_problems([]), ["roster: not a JSON object"])


class InstallerRosterPlaneTestCase(unittest.TestCase):
    """AC4: the guard rides the drift check's plugin plane, reading the
    roster from the project directory (sealing, AD-21)."""

    def _plugin_root(self, tmp: Path) -> Path:
        root = _plugin_fixture(tmp, "1.2.3", ["tk-a"], recorded=["tk-a"])
        (root / ".claude-plugin" / "released-roster.json").write_text(
            json.dumps({"version": "1.2.3", "skills": ["tk-a"],
                        "archive": FIX_ARCHIVE}), encoding="utf-8")
        (root / ".claude-plugin" / "plugin.json").write_text(
            json.dumps({"name": "tk-studio", "version": "1.2.3"}),
            encoding="utf-8")
        return root

    @staticmethod
    def _project(tmp: Path, roster, latest=None) -> Path:
        project = tmp / "proj"
        rosters = project / "tools" / "installer" / "rosters"
        rosters.mkdir(parents=True)
        for channel, data in (("stable", roster), ("latest", latest)):
            if data is None:
                continue
            text = data if isinstance(data, str) else json.dumps(data)
            (rosters / f"{channel}.json").write_text(text, encoding="utf-8")
        return project

    def test_no_roster_is_ok_and_not_checkable(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                tmp / "proj", self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "ok")
        self.assertIn("no installer roster at", check["detail"])
        self.assertIn("roster not checkable from this project", check["detail"])

    def test_good_roster_is_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"),
                              _good_roster("latest")),
                self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "ok", check["detail"])
        self.assertIn("installer roster", check["detail"])
        self.assertIn("gate x4", check["detail"])

    def test_absent_latest_is_ok_and_gate_not_checkable(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable")),
                self._plugin_root(tmp), "1.2.4")
        self.assertEqual(check["status"], "ok", check["detail"])
        self.assertIn("gate x4 not checkable from this project", check["detail"])

    def test_stable_trailing_the_gate_is_ok(self):
        stable = _good_roster("stable")
        stable["components"]["plugin"] = dict(_TRAILING_PLUGIN)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, stable, _good_roster("latest")),
                self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "ok", check["detail"])

    def test_malformed_stable_is_drift_even_when_latest_is_good(self):
        stable = _good_roster("stable")
        stable["components"]["plugin"]["sha256"] = "abc"
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, stable, _good_roster("latest")),
                self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "drift")
        self.assertIn("installer roster stable.json: components.plugin.sha256",
                      check["detail"])

    def test_missing_archive_record_is_not_reported_as_gate_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            root = self._plugin_root(tmp)
            (root / ".claude-plugin" / "released-roster.json").write_text(
                json.dumps({"version": "1.2.3", "skills": ["tk-a"]}),
                encoding="utf-8")
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"),
                              _good_roster("latest")), root, "1.2.3")
        self.assertEqual(check["status"], "ok", check["detail"])
        self.assertNotIn("gate x4 broken", check["detail"])
        self.assertNotIn("fix", check)

    def test_bad_roster_is_drift_naming_the_release_motion(self):
        roster = _good_roster("stable")
        del roster["schema"]
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, roster), self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "drift")
        self.assertIn("schema: missing", check["detail"])
        self.assertIn("tools/release_archive.py run --app plugin", check["fix"])

    def test_out_of_gate_latest_is_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"),
                              _good_roster("latest")),
                self._plugin_root(tmp), "1.2.4")
        self.assertEqual(check["status"], "drift")
        self.assertIn("installer roster latest.json: components.plugin.tag",
                      check["detail"])
        self.assertNotIn("stable.json", check["detail"])

    def test_unreadable_roster_is_error_not_a_crash(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, "{not json"), self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "error")
        self.assertIn("unreadable", check["detail"])
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"), "{not json"),
                self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "error")
        self.assertIn("latest.json unreadable", check["detail"])

    def test_non_utf8_roster_is_error_not_a_crash(self):
        for stem in ("stable", "latest"):
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                project = self._project(tmp, _good_roster("stable"),
                                        _good_roster("latest"))
                (project / "tools" / "installer" / "rosters"
                 / f"{stem}.json").write_bytes(b'{"schema": 1, "x": "\xff\xfe"}')
                check = drift_check._installer_roster_check(
                    project, self._plugin_root(tmp), "1.2.3")
            self.assertEqual(check["status"], "error", stem)
            self.assertIn(f"{stem}.json unreadable", check["detail"])
        # a non-UTF-8 released-roster.json is no archive record (the record's
        # own checks report it), never an escaping exception
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            root = self._plugin_root(tmp)
            (root / ".claude-plugin" / "released-roster.json").write_bytes(
                b"\xff\xfe")
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"),
                              _good_roster("latest")), root, "1.2.3")
        self.assertEqual(check["status"], "ok", check["detail"])
        self.assertIn("url/sha256 comparison skipped", check["detail"])

    def test_channel_not_its_file_stem_is_drift(self):
        for stem, declared in (("stable", "latest"), ("latest", "stable")):
            rosters = {"stable": _good_roster("stable"),
                       "latest": _good_roster("latest")}
            rosters[stem]["channel"] = declared
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                check = drift_check._installer_roster_check(
                    self._project(tmp, rosters["stable"], rosters["latest"]),
                    self._plugin_root(tmp), "1.2.3")
            self.assertEqual(check["status"], "drift", stem)
            self.assertIn(f"installer roster {stem}.json: channel: "
                          f"{declared!r} is not the file stem {stem!r}",
                          check["detail"])

    def test_bad_stable_fix_names_the_promotion_pr(self):
        roster = _good_roster("stable")
        roster["components"]["plugin"]["sha256"] = "abc"
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, roster), self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "drift")
        self.assertIn("tools/release_archive.py run --app plugin", check["fix"])
        self.assertIn("stable.json trails latest.json and is repaired by a "
                      "promotion PR", check["fix"])

    def test_ok_note_matches_what_gate_x4_checked(self):
        latest = _good_roster("latest")
        del latest["components"]["plugin"]
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"), latest),
                self._plugin_root(tmp), "1.2.3")
        self.assertEqual(check["status"], "ok", check["detail"])
        self.assertIn("latest.json in shape, no plugin entry (gate x4 not "
                      "applicable)", check["detail"])
        self.assertNotIn("plugin entry at the gate", check["detail"])
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            root = self._plugin_root(tmp)
            (root / ".claude-plugin" / "released-roster.json").write_text(
                json.dumps({"version": "1.2.3", "skills": ["tk-a"]}),
                encoding="utf-8")
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"),
                              _good_roster("latest")), root, "1.2.3")
        self.assertEqual(check["status"], "ok", check["detail"])
        self.assertIn("url/sha256 comparison skipped", check["detail"])
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            check = drift_check._installer_roster_check(
                self._project(tmp, _good_roster("stable"),
                              _good_roster("latest")),
                self._plugin_root(tmp), "1.2.3")
        self.assertIn("latest.json in shape, plugin entry at the gate "
                      "(gate x4)", check["detail"])

    def test_plugin_plane_folds_the_roster_check_in(self):
        roster = _good_roster("stable")
        roster["components"]["uv"]["sha256"] = {}
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            root = self._plugin_root(tmp)
            project = self._project(tmp, roster)
            home = tmp / "home"
            (home / "plugins").mkdir(parents=True)
            cache = home / "cache" / "1.2.3"
            cache.mkdir(parents=True)
            (home / "plugins" / "installed_plugins.json").write_text(
                json.dumps({"version": 2, "plugins": {"tk-studio@m": [
                    {"scope": "user", "version": "1.2.3",
                     "installPath": str(cache)}]}}), encoding="utf-8")
            old = drift_check.PLUGIN_ROOT
            drift_check.PLUGIN_ROOT = root
            try:
                plane = drift_check.check_plugin(project, None, home)
            finally:
                drift_check.PLUGIN_ROOT = old
        self.assertEqual(plane["status"], "drift")
        self.assertIn("components.uv.sha256", plane["detail"])
        self.assertIn("harness-loadable", plane["detail"])
        self.assertIn("tools/release_archive.py run --app plugin", plane["fix"])


class ReleaseMotionTestCase(unittest.TestCase):
    """AC2: the generalised motion against a fake git/gh — no network, no
    real repository file touched (module paths point at a tempdir)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.repo = self.tmp / "repo"
        self.sup = self.tmp / "supervisor"
        self.sup.mkdir()
        meta = self.repo / "plugins" / "tk-studio" / ".claude-plugin"
        meta.mkdir(parents=True)
        self.manifest = meta / "plugin.json"
        self.manifest.write_text(json.dumps(
            {"name": "tk-studio", "version": "1.2.3"}), encoding="utf-8")
        self.record = meta / "released-roster.json"
        self.record.write_text(json.dumps(
            {"version": "1.2.3", "skills": ["tk-a"], "archive": FIX_ARCHIVE},
            indent=2) + "\n", encoding="utf-8")
        self.rosters = self.repo / "tools" / "installer" / "rosters"
        self.rosters.mkdir(parents=True)
        for channel in ("latest", "stable"):
            (self.rosters / f"{channel}.json").write_text(
                json.dumps(_good_roster(channel), indent=2) + "\n",
                encoding="utf-8")
        self.calls: list[tuple[list[str], Path | None]] = []
        self.tags = {"tk-studio--v1.2.3", "supervisor--v0.1.0", "cli--v0.1.0",
                     "studio-web--v0.1.0"}
        self.subtree_present = True
        self.tamper = False
        self.release_exists = False
        self.wheel_version = "0.1.0"
        self.build_env: dict | None = None
        self.build_src: str | None = None
        self.uploaded = b""
        for name, value in (("REPO_ROOT", self.repo), ("ROSTER", self.record),
                            ("PLUGIN_MANIFEST", self.manifest),
                            ("ROSTERS_DIR", self.rosters),
                            ("_run", self._fake_run)):
            patcher = mock.patch.object(release_archive, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _snapshot(self) -> dict:
        return {p: p.read_bytes() for p in
                (self.record, self.rosters / "latest.json",
                 self.rosters / "stable.json")}

    def _fake_run(self, args, cwd=None, **kw):
        self.calls.append((list(args), cwd))

        def done(rc=0, out=""):
            return subprocess.CompletedProcess(args, rc, out, "fake failure"
                                               if rc else "")
        if args[:3] == ["git", "tag", "-l"]:
            return done(out=args[3] + "\n" if args[3] in self.tags else "")
        if args[:2] == ["git", "rev-list"]:
            return done(out="c0ffee\n")
        if args[:2] == ["git", "cat-file"]:
            return done(out="tree\n") if self.subtree_present else done(128)
        if args[:2] == ["git", "show"]:
            return done(out="1754000000\n")
        if "archive" in args:
            out = Path(args[args.index("-o") + 1])
            with zipfile.ZipFile(out, "w") as z:
                z.writestr("a.txt", f"tree {args[-1]}")
            return done()
        if args[:3] == ["gh", "repo", "view"]:
            return done(out="o/sup\n" if cwd == self.sup else "o/r\n")
        if args[:2] == ["uv", "build"]:
            self.build_env = kw.get("env")
            self.build_src = (Path(args[-1]) / "a.txt").read_text("utf-8")
            out = Path(args[args.index("--out-dir") + 1])
            out.mkdir(parents=True, exist_ok=True)
            (out / f"tk_cli-{self.wheel_version}-py3-none-any.whl").write_bytes(
                b"wheel " + self.wheel_version.encode())
            return done()
        if args[:3] == ["gh", "release", "view"]:
            return done(0 if self.release_exists else 1)
        if args[:3] in (["gh", "release", "create"], ["gh", "release", "edit"]):
            return done()
        if args[:3] == ["gh", "release", "upload"]:
            self.uploaded = Path(args[4]).read_bytes()
            return done()
        if args[:3] == ["gh", "release", "download"]:
            asset = args[args.index("--pattern") + 1]
            target = Path(args[args.index("--dir") + 1]) / asset
            target.write_bytes(self.uploaded + (b"x" if self.tamper else b""))
            return done()
        raise AssertionError(f"unexpected command {args}")

    def _gh_calls(self, verb: str | None = None) -> list[list[str]]:
        return [a for a, _ in self.calls if a[0] == "gh"
                and (verb is None or a[1:3] == ["release", verb])]

    def _fails(self, **kw) -> dict:
        out = io.StringIO()
        with redirect_stdout(out), self.assertRaises(SystemExit) as ctx:
            release_archive.run(False, **kw)
        self.assertEqual(ctx.exception.code, 1)
        return json.loads(out.getvalue())

    def test_plugin_cut_publishes_not_latest_and_records_both_files(self):
        before_stable = (self.rosters / "stable.json").read_bytes()
        result = release_archive.run(False)
        create = self._gh_calls("create")
        self.assertEqual(len(create), 1)
        self.assertIn("--latest=false", create[0])  # make_latest: false
        self.assertTrue(result["verified"])
        self.assertEqual(result["asset"], "tk-studio-1.2.3.zip")
        roster = json.loads((self.rosters / "latest.json").read_text("utf-8"))
        self.assertEqual(roster["components"]["plugin"],
                         {"tag": "tk-studio--v1.2.3", "url": FIX_URL,
                          "sha256": result["sha256"]})
        record = json.loads(self.record.read_text("utf-8"))
        self.assertEqual(record["archive"],
                         {"url": FIX_URL, "sha256": result["sha256"]})
        self.assertEqual(record["skills"], ["tk-a"])
        self.assertEqual(sorted(result["written"]), [
            "plugins/tk-studio/.claude-plugin/released-roster.json",
            "tools/installer/rosters/latest.json"])
        self.assertEqual((self.rosters / "stable.json").read_bytes(),
                         before_stable)
        self.assertEqual(drift_check.roster_problems(
            roster, released_archive=record["archive"],
            plugin_version="1.2.3"), [])

    def test_foreign_supervisor_cut_records_source(self):
        before_record = self.record.read_bytes()
        result = release_archive.run(False, app="supervisor", version="0.1.0",
                                     repo=self.sup)
        create = self._gh_calls("create")
        self.assertIn("--latest=false", create[0])
        self.assertTrue(all(cwd == self.sup for a, cwd in self.calls
                            if a[:2] in (["gh", "release"], ["git", "archive"])
                            or "archive" in a))
        self.assertIn("supervisor--v0.1.0:", [a[-1] for a, _ in self.calls
                                             if "archive" in a])
        roster = json.loads((self.rosters / "latest.json").read_text("utf-8"))
        self.assertEqual(roster["components"]["supervisor"], {
            "tag": "supervisor--v0.1.0",
            "url": "https://github.com/o/sup/releases/download/"
                   "supervisor--v0.1.0/supervisor-0.1.0.zip",
            "sha256": result["sha256"], "source": "o/sup"})
        self.assertEqual(roster["components"]["plugin"],
                         _good_roster()["components"]["plugin"])
        self.assertEqual(self.record.read_bytes(), before_record)
        self.assertEqual(result["written"],
                         ["tools/installer/rosters/latest.json"])

    def test_existing_release_is_demoted_from_latest(self):
        self.release_exists = True
        result = release_archive.run(False)
        self.assertTrue(result["verified"])
        self.assertEqual(self._gh_calls("create"), [])
        self.assertIn((["gh", "release", "edit", "tk-studio--v1.2.3",
                        "--latest=false"], self.repo), self.calls)

    def test_cli_cut_publishes_the_wheel(self):
        result = release_archive.run(False, app="cli", version="0.1.0")
        wheel = "tk_cli-0.1.0-py3-none-any.whl"
        self.assertEqual(result["asset"], wheel)
        self.assertIn("--latest=false", self._gh_calls("create")[0])
        upload = self._gh_calls("upload")[0]
        self.assertEqual(Path(upload[4]).name, wheel)
        self.assertEqual(self.build_env["SOURCE_DATE_EPOCH"], "1754000000")
        roster = json.loads((self.rosters / "latest.json").read_text("utf-8"))
        self.assertEqual(roster["components"]["cli"], {
            "tag": "cli--v0.1.0",
            "url": f"https://github.com/o/r/releases/download/cli--v0.1.0/{wheel}",
            "sha256": result["sha256"]})
        self.assertEqual(result["written"],
                         ["tools/installer/rosters/latest.json"])

    def test_cli_wheel_of_another_version_is_refused(self):
        self.wheel_version = "0.0.9"
        before = self._snapshot()
        failure = self._fails(app="cli", version="0.1.0")
        self.assertIn("tk_cli-0.0.9-py3-none-any.whl is not version 0.1.0",
                      failure["error"])
        self.assertEqual([a for a in self._gh_calls() if a[1] == "release"], [])
        self.assertEqual(self._snapshot(), before)

    def test_no_archive_record_skips_the_gate_comparison(self):
        self.record.write_text(json.dumps(
            {"version": "1.2.3", "skills": ["tk-a"]}), encoding="utf-8")
        result = release_archive.run(False, app="studio-web", version="0.1.0")
        self.assertTrue(result["verified"])
        roster = json.loads((self.rosters / "latest.json").read_text("utf-8"))
        self.assertEqual(roster["components"]["studio-web"]["tag"],
                         "studio-web--v0.1.0")

    def test_stable_channel_is_guarded_for_shape_only(self):
        stable = _good_roster("stable")
        stable["components"]["plugin"] = dict(_TRAILING_PLUGIN)
        (self.rosters / "stable.json").write_text(json.dumps(stable),
                                                  encoding="utf-8")
        result = release_archive.run(False, app="studio-web", version="0.1.0",
                                     channel="stable")
        self.assertEqual(result["written"],
                         ["tools/installer/rosters/stable.json"])
        roster = json.loads((self.rosters / "stable.json").read_text("utf-8"))
        self.assertEqual(roster["components"]["plugin"], _TRAILING_PLUGIN)

    def test_latest_out_of_gate_is_never_published(self):
        latest = _good_roster("latest")
        latest["components"]["plugin"] = dict(_TRAILING_PLUGIN)
        (self.rosters / "latest.json").write_text(json.dumps(latest),
                                                  encoding="utf-8")
        before = self._snapshot()
        failure = self._fails(app="studio-web", version="0.1.0")
        self.assertIn("gate x4 broken", failure["error"])
        self.assertEqual(self._gh_calls("create"), [])
        self.assertEqual(self._snapshot(), before)

    def test_digest_mismatch_writes_nothing(self):
        self.tamper = True
        before = self._snapshot()
        failure = self._fails()
        self.assertFalse(failure["ok"])
        self.assertIn("digest mismatch", failure["error"])
        self.assertEqual(self._snapshot(), before)

    def test_missing_tag_fails_before_any_gh_call(self):
        self.tags.clear()
        before = self._snapshot()
        failure = self._fails(app="supervisor", version="0.1.0", repo=self.sup)
        self.assertIn("supervisor--v0.1.0 not found", failure["error"])
        self.assertEqual(self._gh_calls(), [])
        self.assertEqual(self._snapshot(), before)

    def test_missing_subtree_fails_before_any_gh_call(self):
        self.subtree_present = False
        before = self._snapshot()
        failure = self._fails()
        self.assertIn("subtree plugins/tk-studio absent", failure["error"])
        self.assertEqual(self._gh_calls(), [])
        self.assertEqual(self._snapshot(), before)

    def test_roster_the_guard_rejects_is_never_published(self):
        roster = _good_roster()
        roster["components"]["uv"]["sha256"] = {}
        (self.rosters / "latest.json").write_text(json.dumps(roster),
                                                  encoding="utf-8")
        before = self._snapshot()
        failure = self._fails()
        self.assertIn("components.uv.sha256", failure["error"])
        self.assertEqual(self._gh_calls("create"), [])
        self.assertEqual(self._gh_calls("upload"), [])
        self.assertEqual(self._snapshot(), before)

    def test_dry_run_publishes_and_writes_nothing(self):
        before = self._snapshot()
        result = release_archive.run(True)
        self.assertEqual(result["written"], [])
        self.assertEqual([a for a in self._gh_calls()
                          if a[1] == "release"], [])
        self.assertEqual(self._snapshot(), before)

    def test_plugin_into_stable_is_refused_before_any_call(self):
        # the plugin cut rewrites released-roster.json's archive: recorded
        # into stable it would leave latest.json's plugin entry stale
        before = self._snapshot()
        for dry_run in (False, True):
            out = io.StringIO()
            with redirect_stdout(out), self.assertRaises(SystemExit):
                release_archive.run(dry_run, channel="stable")
            self.assertIn("the plugin motion records into latest (gate x4); "
                          "promote to stable by PR",
                          json.loads(out.getvalue())["error"])
        self.assertEqual(self.calls, [])
        self.assertEqual(self._snapshot(), before)

    def test_roster_channel_not_its_stem_is_refused_before_gh(self):
        stable = _good_roster("latest")
        (self.rosters / "stable.json").write_text(json.dumps(stable),
                                                  encoding="utf-8")
        before = self._snapshot()
        failure = self._fails(app="studio-web", version="0.1.0",
                              channel="stable")
        self.assertIn("installer roster stable.json: channel 'latest' is not "
                      "the file stem 'stable'", failure["error"])
        self.assertEqual(self._gh_calls(), [])
        self.assertEqual(self._snapshot(), before)

    def test_non_utf8_roster_fails_by_name_before_gh(self):
        (self.rosters / "latest.json").write_bytes(b'{"x": "\xff\xfe"}')
        before = self._snapshot()
        failure = self._fails(app="studio-web", version="0.1.0")
        self.assertIn("installer roster latest.json unreadable",
                      failure["error"])
        self.assertEqual(self._gh_calls(), [])
        self.assertEqual(self._snapshot(), before)
        self.record.write_bytes(b"\xff\xfe")
        failure = self._fails()
        self.assertIn("released-roster.json unreadable", failure["error"])

    def test_each_app_archives_its_subtree_at_its_tag(self):
        # AC2: built from the app's subtree at its <prefix>--vX.Y.Z tag —
        # asserted against APPS and, for the planned layout, literally
        expected = {"plugin": "tk-studio--v1.2.3:plugins/tk-studio",
                    "supervisor": "supervisor--v0.1.0:",
                    "studio-web": "studio-web--v0.1.0:apps/studio-web/dist",
                    "cli": "cli--v0.1.0:" + release_archive.APPS["cli"][1]}
        self.assertEqual(set(expected), set(release_archive.APPS))
        for app, (prefix, subtree, _kind) in release_archive.APPS.items():
            self.calls.clear()
            version = "1.2.3" if app == "plugin" else "0.1.0"
            repo = self.sup if app == "supervisor" else self.repo
            treeish = f"{prefix}{version}:" + ("" if subtree == "." else subtree)
            self.assertEqual(treeish, expected[app])
            result = release_archive.run(
                True, app=app, version=None if app == "plugin" else version,
                repo=self.sup if app == "supervisor" else None)
            self.assertEqual(result["tag"], f"{prefix}{version}")
            archives = [(a, cwd) for a, cwd in self.calls if "archive" in a]
            self.assertEqual(archives, [(
                ["git", "-c", "core.autocrlf=false", "archive", "--format=zip",
                 "-o", archives[0][0][6], treeish], repo)], app)
        # the cli wheel is built from that archived subtree, not the worktree
        self.assertEqual(self.build_src, f"tree {expected['cli']}")

    def test_plugin_from_another_checkout_is_refused_before_any_call(self):
        # the plugin is gated against this repository's plugin.json and
        # released-roster.json: built and published elsewhere it is ungated
        before = self._snapshot()
        for dry_run in (False, True):
            out = io.StringIO()
            with redirect_stdout(out), self.assertRaises(SystemExit):
                release_archive.run(dry_run, repo=self.sup)
            error = json.loads(out.getvalue())["error"]
            self.assertIn("--app plugin --repo", error)
            self.assertIn("refused", error)
        self.assertEqual(self.calls, [])
        self.assertEqual(self._snapshot(), before)
        # this repository named explicitly is the default, not another one
        self.assertTrue(release_archive.run(True, repo=self.repo)["ok"])

    def test_plugin_less_roster_cut_records_source(self):
        # without a plugin entry the guard cannot establish home, so the
        # motion names even this repository in source (else it is refused)
        stable = _good_roster("stable")
        del stable["components"]["plugin"]
        (self.rosters / "stable.json").write_text(json.dumps(stable),
                                                  encoding="utf-8")
        result = release_archive.run(False, app="studio-web", version="0.1.0",
                                     channel="stable")
        self.assertEqual(result["source"], "o/r")
        roster = json.loads((self.rosters / "stable.json").read_text("utf-8"))
        self.assertEqual(roster["components"]["studio-web"]["source"], "o/r")
        self.assertEqual(drift_check.roster_problems(roster), [])

    def test_non_plugin_app_needs_a_version(self):
        failure = self._fails(app="studio-web")
        self.assertIn("--version X.Y.Z", failure["error"])
        self.assertEqual(self._gh_calls(), [])


if __name__ == "__main__":
    unittest.main()
