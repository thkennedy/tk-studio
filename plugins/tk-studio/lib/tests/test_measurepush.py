"""Tests for measurement push (ST-7.1 acceptance criteria).

Ledger -> feature branch -> commit to measurements/<user>-<machine>.jsonl ->
PR: never a base-branch push, never a merge; the sanitization re-check blocks
pre-commit before any branch exists; repeat pushes append to the same
per-machine file and reuse an open PR instead of stacking a second one; and
the surface is a mover, not an emitter (AD-12) — it writes no ledger event of
its own.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ledger  # noqa: E402
import measurepush  # noqa: E402
import plansync  # noqa: E402


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args], cwd=str(cwd), stdin=subprocess.DEVNULL,
        capture_output=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {proc.stderr}")
    return proc


class MeasurePushTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(tmp / "store")

        self.origin = tmp / "origin.git"
        _git(tmp, "init", "--bare", "-b", "main", str(self.origin))
        self.repo = tmp / "repo"
        self.repo.mkdir()
        _git(self.repo, "init", "-b", "main")
        for key, value in (("user.email", "t@example.com"), ("user.name", "T"),
                           ("commit.gpgsign", "false"), ("core.autocrlf", "false")):
            _git(self.repo, "config", key, value)
        (self.repo / ".claude-plugin").mkdir()
        (self.repo / ".claude-plugin" / "marketplace.json").write_text(
            "{}\n", encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "seed")
        _git(self.repo, "remote", "add", "origin", str(self.origin))
        _git(self.repo, "push", "-q", "-u", "origin", "main")

        self.branch = measurepush.branch_name()
        self.path = measurepush.repo_file()

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _emit(self, description: str) -> None:
        ledger.emit("observation", {"source": "other", "description": description})

    def _origin_refs(self) -> list[str]:
        out = _git(self.origin, "for-each-ref", "--format=%(refname:short)").stdout
        return sorted(line for line in out.splitlines() if line)

    def _file_on(self, ref: str) -> list[str]:
        # \n-only split, like the code under test: splitlines() would mask a
        # U+2028-sheared file by re-shearing it the same way here
        out = _git(self.repo, "show", f"{ref}:{self.path}").stdout
        return [line for line in out.split("\n") if line.strip()]

    # --- AC 1: branch, per-machine file, PR — never main, never a merge

    def test_first_push_lands_branch_and_file_never_touching_main(self):
        self._emit("first event")
        self._emit("second event")
        main_before = _git(self.origin, "rev-parse", "main").stdout.strip()

        result = measurepush.push(self.repo, no_pr=True)

        self.assertEqual(result["result_state"], "pushed")
        self.assertEqual(result["new_events"], 2)
        self.assertEqual(self._origin_refs(), sorted(["main", self.branch]))
        self.assertEqual(_git(self.origin, "rev-parse", "main").stdout.strip(),
                         main_before)
        self.assertEqual(len(self._file_on(f"origin/{self.branch}")), 2)
        # the run restores the starting branch and leaves the tree clean
        self.assertEqual(_git(self.repo, "rev-parse", "--abbrev-ref",
                              "HEAD").stdout.strip(), "main")
        self.assertEqual(_git(self.repo, "status", "--porcelain").stdout.strip(), "")

    def test_repeat_push_appends_only_new_lines_to_the_same_file(self):
        self._emit("first event")
        measurepush.push(self.repo, no_pr=True)
        self._emit("second event")

        result = measurepush.push(self.repo, no_pr=True)

        self.assertEqual(result["new_events"], 1)
        lines = self._file_on(f"origin/{self.branch}")
        self.assertEqual(len(lines), 2)
        self.assertEqual(len(set(lines)), 2, "no duplicated lines")
        descriptions = [json.loads(line)["payload"]["description"] for line in lines]
        self.assertEqual(descriptions, ["first event", "second event"])

    def test_unicode_line_separator_event_pushes_as_one_line(self):
        # ledger.emit writes ensure_ascii=False, so a U+2028-class character
        # lands raw in the JSONL; reading it back must not shear the line
        # (that would corrupt the pushed file and break baseline dedupe —
        # same class as the PR #16 reconcile.py fix)
        detail = "sheared\u2028half\u2029more\x85end"
        self._emit("plain event")
        self._emit(detail)

        result = measurepush.push(self.repo, no_pr=True)

        self.assertEqual(result["result_state"], "pushed")
        self.assertEqual(result["new_events"], 2)
        lines = self._file_on(f"origin/{self.branch}")
        self.assertEqual(len(lines), 2, "each event is exactly one line")
        self.assertEqual(
            [json.loads(line)["payload"]["description"] for line in lines],
            ["plain event", detail], "the separator round-trips intact")

        # repeat push dedupes against the baseline read back from git —
        # a sheared baseline would count the same event as unpushed forever
        again = measurepush.push(self.repo, no_pr=True)
        self.assertEqual(again["result_state"], "no-op")
        self.assertEqual(again["new_events"], 0)

    def test_only_this_machines_file_is_touched(self):
        other = self.repo / "measurements" / "somebody-else.jsonl"
        other.parent.mkdir()
        other.write_text('{"event":"observation"}\n', encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "another machine's ledger")
        _git(self.repo, "push", "-q", "origin", "main")
        self._emit("mine")

        measurepush.push(self.repo, no_pr=True)

        touched = _git(self.repo, "show", "--name-only", "--format=",
                       self.branch).stdout.split()
        self.assertEqual(touched, [self.path])
        self.assertEqual(
            _git(self.repo, "show",
                 f"{self.branch}:measurements/somebody-else.jsonl").stdout,
            '{"event":"observation"}\n')

    # --- AC 2: sanitization re-check blocks pre-commit

    def test_credential_shaped_value_blocks_before_any_branch_exists(self):
        self._emit("legitimate event")
        with open(ledger.ledger_path(), "a", encoding="utf-8", newline="\n") as handle:
            handle.write('{"ts":"t","event":"observation","user":"u","machine":"m",'
                         '"payload":{"source":"other","description":'
                         '"leaked ghp_ABCDEFGHIJKLMNOPQRSTUVWX"}}\n')

        with self.assertRaises(measurepush.PushBlocked) as ctx:
            measurepush.push(self.repo, no_pr=True)

        self.assertEqual(ctx.exception.step, "sanitization")
        self.assertTrue(ctx.exception.findings)
        self.assertEqual(self._origin_refs(), ["main"], "nothing was pushed")
        self.assertNotEqual(
            subprocess.run(["git", "rev-parse", "--verify", "--quiet", self.branch],
                           cwd=str(self.repo), capture_output=True).returncode,
            0, "no branch was created")

    def test_unredacted_credential_key_blocks(self):
        self._emit("legitimate event")
        with open(ledger.ledger_path(), "a", encoding="utf-8", newline="\n") as handle:
            handle.write('{"ts":"t","event":"report","user":"u","machine":"m",'
                         '"payload":{"description":"x",'
                         '"context":{"api_key":"hunter2value"}}}\n')
        with self.assertRaises(measurepush.PushBlocked) as ctx:
            measurepush.push(self.repo, no_pr=True)
        self.assertIn("api_key", json.dumps(ctx.exception.findings))

    # --- no-op, dry-run, preflight refusals

    def test_empty_ledger_is_a_clean_noop(self):
        result = measurepush.push(self.repo, no_pr=True)
        self.assertEqual(result["result_state"], "no-op")
        self.assertEqual(self._origin_refs(), ["main"])

    def test_everything_already_pushed_is_a_clean_noop(self):
        self._emit("only event")
        measurepush.push(self.repo, no_pr=True)
        result = measurepush.push(self.repo, no_pr=True)
        self.assertEqual(result["result_state"], "no-op")

    def test_dry_run_mutates_nothing(self):
        self._emit("an event")
        result = measurepush.push(self.repo, dry_run=True)
        self.assertEqual(result["result_state"], "dry-run")
        self.assertEqual(result["new_events"], 1)
        self.assertEqual(self._origin_refs(), ["main"])
        self.assertEqual(_git(self.repo, "status", "--porcelain").stdout.strip(), "")

    def test_dirty_tree_blocked(self):
        self._emit("an event")
        (self.repo / ".claude-plugin" / "marketplace.json").write_text(
            '{"dirty": true}\n', encoding="utf-8")
        with self.assertRaises(measurepush.PushBlocked) as ctx:
            measurepush.push(self.repo, no_pr=True)
        self.assertEqual(ctx.exception.step, "preflight")

    def test_push_outside_studio_repo_blocked_headless_clean(self):
        elsewhere = Path(self._tmp.name) / "elsewhere"
        elsewhere.mkdir()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = measurepush.main(["push", "--directory", str(elsewhere),
                                     "--dry-run"])
        self.assertEqual(code, 2)
        out = json.loads(stdout.getvalue())
        self.assertFalse(out["ok"])
        self.assertEqual(out["step"], "preflight")

    # --- mover, not emitter (AD-12)

    def test_mover_not_emitter(self):
        self._emit("the only event ever emitted")
        before = ledger.ledger_path().read_bytes()
        measurepush.push(self.repo, no_pr=True)
        self.assertEqual(ledger.ledger_path().read_bytes(), before,
                         "a push writes no ledger event of its own")

    # --- open-PR handling (gh stubbed; the branch push is real)

    def test_open_pr_reused_never_duplicated(self):
        self._emit("an event")
        calls: list[tuple] = []

        def fake_gh(directory, *args):
            calls.append(args)
            if args[:2] == ("pr", "list"):
                return subprocess.CompletedProcess(
                    args, 0, stdout='[{"number": 7, "url": "https://example/pr/7"}]',
                    stderr="")
            raise AssertionError(f"unexpected gh call with an open PR: {args}")

        original = measurepush._gh
        measurepush._gh = fake_gh
        try:
            result = measurepush.push(self.repo)
        finally:
            measurepush._gh = original

        self.assertEqual(result["pr"]["state"], "updated-existing")
        self.assertEqual(result["pr"]["number"], 7)
        self.assertEqual(len(calls), 1)

    def test_pr_opened_when_none_open_and_never_merged(self):
        self._emit("an event")
        calls: list[tuple] = []

        def fake_gh(directory, *args):
            calls.append(args)
            if args[:2] == ("pr", "list"):
                return subprocess.CompletedProcess(args, 0, stdout="[]", stderr="")
            if args[:2] == ("pr", "create"):
                return subprocess.CompletedProcess(
                    args, 0, stdout="https://example/pr/8\n", stderr="")
            raise AssertionError(f"unexpected gh call: {args}")

        original = measurepush._gh
        measurepush._gh = fake_gh
        try:
            result = measurepush.push(self.repo)
        finally:
            measurepush._gh = original

        self.assertEqual(result["pr"], {"state": "opened",
                                        "url": "https://example/pr/8"})
        create = next(c for c in calls if c[:2] == ("pr", "create"))
        self.assertIn("--base", create)
        self.assertEqual(create[create.index("--base") + 1], "main")
        self.assertEqual(create[create.index("--head") + 1], self.branch)
        self.assertFalse([c for c in calls if "merge" in c],
                         "the mover never merges (AD-12: review is the membrane)")

    def test_gh_unavailable_is_graceful_not_fatal(self):
        self._emit("an event")
        original = measurepush._gh
        measurepush._gh = lambda directory, *args: subprocess.CompletedProcess(
            args, 127, stdout="", stderr="gh unavailable")
        try:
            result = measurepush.push(self.repo)
        finally:
            measurepush._gh = original
        self.assertEqual(result["result_state"], "pushed")
        self.assertEqual(result["pr"]["state"], "unavailable")

    # --- check verb

    def test_check_counts_unpushed_then_zero_after_push(self):
        self._emit("first event")
        self._emit("second event")
        before = measurepush.check(self.repo)
        self.assertEqual(before["unpushed"], 2)
        self.assertTrue(before["sanitization"]["clean"])
        measurepush.push(self.repo, no_pr=True)
        after = measurepush.check(self.repo)
        self.assertEqual(after["unpushed"], 0)
        self.assertEqual(after["baseline"], f"origin/{self.branch}")

    def test_check_outside_studio_repo_counts_all_events(self):
        self._emit("an event")
        elsewhere = Path(self._tmp.name) / "elsewhere"
        elsewhere.mkdir()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = measurepush.main(["check", "--directory", str(elsewhere)])
        self.assertEqual(code, 0)
        out = json.loads(stdout.getvalue())
        self.assertTrue(out["ok"])
        self.assertEqual(out["unpushed"], 1)
        self.assertIn("note", out)


    # --- 35-8: the Stage Log harvest never stops the push

    def _push_cli(self, *extra: str) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = measurepush.main(["push", "--directory", str(self.repo),
                                     "--no-pr", *extra])
        return code, json.loads(out.getvalue())

    def test_a_non_utf8_spec_is_skipped_and_the_push_still_reports(self):
        stories = self.repo / "_bmad-output" / "specs" / "x" / "stories"
        stories.mkdir(parents=True)
        (stories / "1-1-bad-spec.md").write_bytes(
            b"## Stage Log\n\xff\xfe not utf-8 \x81\n")
        self._emit("an event")
        code, out = self._push_cli("--dry-run")
        self.assertEqual(code, 0, out)
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["stage_events"]["emitted"], 0)
        self.assertIn("result_state", out)

    def test_a_failing_harvest_is_recorded_and_the_push_continues(self):
        real = measurepush.harvest_stages

        def boom(directory, dry_run=False):
            raise OSError("ledger refused the stage event")
        measurepush.harvest_stages = boom
        try:
            self._emit("an event")
            code, out = self._push_cli()
        finally:
            measurepush.harvest_stages = real
        self.assertEqual(code, 0, out)
        self.assertEqual(out["result_state"], "pushed")
        self.assertFalse(out["stage_events"]["ok"])
        self.assertIn("ledger refused", out["stage_events"]["error"])

    def test_push_emits_one_stage_event_per_completed_row_then_none(self):
        # Story 35.8 (AC3): `push` itself harvests the Stage Log before it moves the ledger
        stories = self.repo / "_bmad-output" / "specs" / "spec-epic-35" / "stories"
        stories.mkdir(parents=True)
        (stories / "35-8-a-story-spec.md").write_text(
            "---\ntitle: 'a story'\nstatus: 'in-progress'\n---\n\nbody\n",
            encoding="utf-8", newline="\n")
        plansync.stage_append(self.repo, [
            {"stage": "dev", "pass": 1, "started": "2026-10-28T23:41:00Z",
             "ended": "2026-10-28T23:52:10Z", "outcome": "done"},
            {"stage": "review", "pass": 1, "started": "2026-10-28T23:53:00Z",
             "ended": "2026-10-29T00:03:00Z", "outcome": "clean"},
            {"stage": "merge", "started": "2026-10-29T01:00:00Z",
             "ended": "2026-10-29T01:00:00Z", "outcome": "merged"}], story="35-8-a-story")
        plansync.stage_start(self.repo, "gate", story="35-8-a-story", pass_=1)  # open: waits
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "a spec with its Stage Log")
        completed = [e["key"] for e in plansync.stage_rows(self.repo)
                     if e["row"]["ended"] != plansync.NO_VALUE]
        self.assertEqual(len(completed), 3)

        first = measurepush.push(self.repo, no_pr=True)
        self.assertEqual(first["result_state"], "pushed")
        self.assertEqual(first["stage_events"]["emitted"], 3)
        self.assertEqual(sorted(first["stage_events"]["row_keys"]), sorted(completed))
        events = [json.loads(line) for line in self._file_on(f"origin/{self.branch}")]
        self.assertEqual(sorted(e["payload"]["row_key"] for e in events if e["event"] == "stage"),
                         sorted(completed))

        second = measurepush.push(self.repo, no_pr=True)
        self.assertEqual((second["stage_events"]["emitted"], second["stage_events"]["already"]),
                         (0, 3))
        self.assertEqual(second["stage_events"]["row_keys"], [])

if __name__ == "__main__":
    unittest.main()
