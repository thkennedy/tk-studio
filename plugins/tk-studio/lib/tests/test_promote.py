"""Tests for the knowledge promotion gate (ST-9.5 acceptance criteria).

Routing doc -> ONE new dated kb file on the stable knowledge branch ->
membrane PR: a promotion attempt without a routing doc is a named rejection;
drafted files are ordinary kb markdown (no new frontmatter keys — AD-8);
nothing auto-applies and no base branch is ever pushed (D3, AD-12); the
promoted baseline (promotions record) makes repeat drafts incremental; and
the surface is a mover, not an emitter — no ledger event lands in ST-9.5
(the knowledge-promotion event and its taxonomy row arrive together at
contract 1.7.0, ST-9.6).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import knowledge  # noqa: E402
import ledger  # noqa: E402
import promote  # noqa: E402
import reconcile  # noqa: E402


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args], cwd=str(cwd), stdin=subprocess.DEVNULL,
        capture_output=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed: {proc.stderr}")
    return proc


def _line(**overrides) -> dict:
    line = {"run_id": "r-20260807-abc123",
            "captured_at": "2026-08-07T05:00:00.000+00:00",
            "anchor": "SEED-r-20260807-abc123-A1", "verdict": "WRONG",
            "reality": "the adapter also reads the local overlay",
            "evidence": "lib/config.py:81", "tier": "run-local"}
    line.update(overrides)
    return line


class PromoteTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = str(tmp / "store")

        self.origin = tmp / "origin.git"
        _git(tmp, "init", "--bare", "-b", "main", str(self.origin))
        self.repo = tmp / "proj"
        self.repo.mkdir()
        _git(self.repo, "init", "-b", "main")
        for key, value in (("user.email", "t@example.com"), ("user.name", "T"),
                           ("commit.gpgsign", "false"),
                           ("core.autocrlf", "false")):
            _git(self.repo, "config", key, value)
        (self.repo / "README.md").write_text("proj\n", encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "seed")
        _git(self.repo, "remote", "add", "origin", str(self.origin))
        _git(self.repo, "push", "-q", "-u", "origin", "main")

        self.key = "proj"
        self.branch = promote.branch_name()

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    # ------------------------------------------------------------- helpers

    def _queue(self, *lines: dict) -> None:
        path = reconcile.queue_path(self.key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8", newline="\n") as handle:
            for line in lines:
                handle.write(json.dumps(line, ensure_ascii=False,
                                        separators=(",", ":")) + "\n")

    def _route(self) -> None:
        result = reconcile.route(self.key)
        assert result["rendered"], result

    def _seed_two_corrections(self) -> None:
        self._queue(
            _line(anchor="SPINE-A1", tier="spine", verdict="STALE",
                  reality="the pin moved during the run"),
            _line())
        self._route()

    def _file_on(self, ref: str, path: str) -> str:
        return _git(self.repo, "show", f"{ref}:{path}").stdout

    def _origin_refs(self) -> list[str]:
        out = _git(self.origin, "for-each-ref",
                   "--format=%(refname:short)").stdout
        return sorted(line for line in out.split("\n") if line.strip())

    # --- AC 2: no routing doc is a named rejection

    def test_draft_refuses_without_a_routing_doc(self):
        self._queue(_line())  # queue exists, but route never ran
        with self.assertRaises(promote.PromoteBlocked) as caught:
            promote.draft(self.repo, no_pr=True)
        self.assertEqual(caught.exception.step, "routing")
        self.assertIn("no routing doc", str(caught.exception))
        # dry-run refuses identically — never downgraded
        with self.assertRaises(promote.PromoteBlocked):
            promote.draft(self.repo, dry_run=True)

    # --- AC 1: drafted kb changes on a feature branch; nothing auto-applies

    def test_draft_lands_one_kb_file_on_the_branch_never_the_base(self):
        self._seed_two_corrections()
        base_before = _git(self.repo, "rev-parse", "origin/main").stdout

        result = promote.draft(self.repo, no_pr=True)

        self.assertEqual(result["result_state"], "pushed")
        self.assertEqual(result["corrections"], 2)
        self.assertRegex(result["file"], r"^kb/reconciliation-\d{4}-\d{2}-\d{2}\.md$")
        self.assertEqual(self._origin_refs(), sorted(["main", self.branch]))
        self.assertEqual(_git(self.repo, "rev-parse", "origin/main").stdout,
                         base_before, "the base branch is never pushed")
        # back on the start branch, tree clean
        self.assertEqual(_git(self.repo, "rev-parse", "--abbrev-ref",
                              "HEAD").stdout.strip(), "main")
        self.assertEqual(_git(self.repo, "status", "--porcelain").stdout, "")
        # nothing landed on the local base either — review applies, not us
        self.assertNotIn("kb", [p.name for p in self.repo.iterdir()])

        doc = self._file_on(f"origin/{self.branch}", result["file"])
        fm_keys = [line.split(":", 1)[0]
                   for line in doc.split("---\n")[1].strip().split("\n")
                   if ":" in line]
        self.assertEqual(fm_keys, ["title", "description"],
                         "ordinary kb frontmatter, no new keys (AD-8)")
        self.assertIn("`SPINE-A1`", doc)
        self.assertIn("Spine corrections", doc)
        index = self._file_on(f"origin/{self.branch}", "kb/index.md")
        self.assertIn("generated by tk-studio kb.py", index)
        self.assertIn(result["file"].removeprefix("kb/"), index)
        self.assertEqual(result["index"]["state"], "regenerated")

    def test_repeat_draft_noops_then_drafts_only_new_corrections(self):
        self._seed_two_corrections()
        first = promote.draft(self.repo, no_pr=True)

        again = promote.draft(self.repo, no_pr=True)
        self.assertEqual(again["result_state"], "no-op")
        self.assertEqual(again["corrections"], 0)
        self.assertIn("already drafted", again["detail"])

        self._queue(_line(anchor="SPINE-A2", tier="spine",
                          reality="a fresh correction"))
        self._route()
        second = promote.draft(self.repo, no_pr=True)
        self.assertEqual(second["result_state"], "pushed")
        self.assertEqual(second["corrections"], 1)
        self.assertNotEqual(second["file"], first["file"],
                            "each draft is a NEW file — append-only")
        self.assertRegex(second["file"],
                         r"^kb/reconciliation-\d{4}-\d{2}-\d{2}-2\.md$")
        # the first draft is untouched on the branch
        first_doc = self._file_on(f"origin/{self.branch}", first["file"])
        self.assertNotIn("SPINE-A2", first_doc)
        second_doc = self._file_on(f"origin/{self.branch}", second["file"])
        self.assertIn("`SPINE-A2`", second_doc)
        self.assertNotIn("`SPINE-A1`", second_doc)

    def test_redraft_overrides_the_promoted_baseline(self):
        self._seed_two_corrections()
        promote.draft(self.repo, no_pr=True)
        redrafted = promote.draft(self.repo, no_pr=True, redraft=True)
        self.assertEqual(redrafted["result_state"], "pushed")
        self.assertEqual(redrafted["corrections"], 2)

    # --- dry-run: data gates only, no git, no writes

    def test_dry_run_walks_the_gates_and_touches_nothing(self):
        plain = Path(self._tmp.name) / "plainproj"
        plain.mkdir()
        key = "plainproj"
        path = reconcile.queue_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(_line(), separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        assert reconcile.route(key)["rendered"]

        result = promote.draft(plain, dry_run=True)

        self.assertEqual(result["result_state"], "dry-run")
        self.assertEqual(result["corrections"], 1)
        self.assertEqual(result["sanitization"], "clean")
        self.assertEqual(result["entries"][0]["anchor"], _line()["anchor"])
        self.assertFalse(promote.record_path(key).exists(),
                         "a dry run records nothing")
        self.assertFalse((plain / "kb").exists())

    # --- refusals: preflight and sanitization

    def test_draft_refuses_a_non_git_project(self):
        plain = Path(self._tmp.name) / "nogit"
        plain.mkdir()
        key = "nogit"
        path = reconcile.queue_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(_line(), separators=(",", ":")) + "\n",
                        encoding="utf-8", newline="\n")
        assert reconcile.route(key)["rendered"]
        with self.assertRaises(promote.PromoteBlocked) as caught:
            promote.draft(plain, no_pr=True)
        self.assertIn("not a git work tree", str(caught.exception))

    def test_draft_refuses_a_dirty_tree(self):
        self._seed_two_corrections()
        (self.repo / "README.md").write_text("dirty\n", encoding="utf-8")
        with self.assertRaises(promote.PromoteBlocked) as caught:
            promote.draft(self.repo, no_pr=True)
        self.assertIn("not clean", str(caught.exception))

    def test_draft_refuses_a_base_branch_collision(self):
        self._seed_two_corrections()
        with self.assertRaises(promote.PromoteBlocked) as caught:
            promote.draft(self.repo, base=self.branch, no_pr=True)
        self.assertIn("never pushed", str(caught.exception))

    def test_sanitization_blocks_credential_shaped_corrections(self):
        self._queue(_line(reality="rotate the key AKIAABCDEFGHIJKLMNOP "
                                  "before the next run"))
        self._route()
        with self.assertRaises(promote.PromoteBlocked) as caught:
            promote.draft(self.repo, no_pr=True)
        self.assertEqual(caught.exception.step, "sanitization")
        self.assertTrue(caught.exception.findings)
        self.assertEqual(self._origin_refs(), ["main"],
                         "blocked before any branch exists")

    def test_invalid_queue_lines_report_and_never_draft(self):
        self._queue(_line())
        with open(reconcile.queue_path(self.key), "a", encoding="utf-8",
                  newline="\n") as handle:
            handle.write("not json at all\n")
        self._route()
        result = promote.draft(self.repo, no_pr=True)
        self.assertEqual(result["corrections"], 1)
        self.assertEqual(len(result["queue_invalid"]), 1)
        doc = self._file_on(f"origin/{self.branch}", result["file"])
        self.assertNotIn("not json", doc)

    # --- preservation: a foreign index is skipped, never clobbered

    def test_foreign_index_is_skipped_never_clobbered(self):
        (self.repo / "kb").mkdir()
        (self.repo / "kb" / "index.md").write_text(
            "# Hand-authored index\n", encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "hand-authored kb index")
        _git(self.repo, "push", "-q", "origin", "main")
        self._seed_two_corrections()

        result = promote.draft(self.repo, no_pr=True)

        self.assertEqual(result["result_state"], "pushed")
        self.assertEqual(result["index"]["state"], "skipped")
        index = self._file_on(f"origin/{self.branch}", "kb/index.md")
        self.assertEqual(index, "# Hand-authored index\n")
        self.assertIn("reconciliation", self._file_on(
            f"origin/{self.branch}", result["file"]))

    # --- recovery: a recorded draft is never orphaned (adversarial review)

    def _break_remote(self) -> None:
        _git(self.repo, "remote", "set-url", "origin",
             str(Path(self._tmp.name) / "nowhere.git"))

    def _fix_remote(self) -> None:
        _git(self.repo, "remote", "set-url", "origin", str(self.origin))

    def test_committed_local_draft_survives_a_later_draft(self):
        # must-fix: a later draft's branch selection must never reset away
        # a recorded-but-unpushed draft — the record baseline would block
        # those corrections from ever re-drafting (silent, permanent loss)
        self._seed_two_corrections()
        first = promote.draft(self.repo, no_pr=True)

        self._break_remote()
        self._queue(_line(anchor="SPINE-A2", tier="spine",
                          reality="unpushed correction B"))
        self._route()
        second = promote.draft(self.repo, no_pr=True)
        self.assertEqual(second["result_state"], "committed-local")

        self._fix_remote()
        self._queue(_line(anchor="SPINE-A3", tier="spine",
                          reality="fresh correction C"))
        self._route()
        third = promote.draft(self.repo, no_pr=True)
        self.assertEqual(third["result_state"], "pushed")

        tip_files = _git(self.repo, "ls-tree", "-r", "--name-only",
                         f"origin/{self.branch}").stdout
        for result in (first, second, third):
            self.assertIn(result["file"], tip_files,
                          "no draft is ever orphaned")
        self.assertIn("unpushed correction B",
                      self._file_on(f"origin/{self.branch}", second["file"]))

    def test_noop_run_pushes_a_waiting_branch(self):
        # the committed-local recovery is re-running the verb — a no-op run
        # completes the interrupted push instead of stranding it
        self._seed_two_corrections()
        promote.draft(self.repo, no_pr=True)
        self._break_remote()
        self._queue(_line(anchor="SPINE-A2", tier="spine",
                          reality="offline correction"))
        self._route()
        stuck = promote.draft(self.repo, no_pr=True)
        self.assertEqual(stuck["result_state"], "committed-local")

        self._fix_remote()
        retry = promote.draft(self.repo, no_pr=True)
        self.assertEqual(retry["result_state"], "pushed")
        self.assertEqual(retry["corrections"], 0)
        self.assertIn("waiting", retry["detail"])
        self.assertIn(stuck["file"],
                      _git(self.repo, "ls-tree", "-r", "--name-only",
                           f"origin/{self.branch}").stdout)

    def test_diverged_promotion_branch_refuses_named(self):
        self._seed_two_corrections()
        promote.draft(self.repo, no_pr=True)
        # origin advances (a review edit) while local rewinds and advances
        # differently — neither side may be reset silently
        _git(self.repo, "checkout", "-q", self.branch)
        _git(self.repo, "commit", "--allow-empty", "-q", "-m", "review edit")
        _git(self.repo, "push", "-q", "origin", self.branch)
        _git(self.repo, "reset", "--hard", "-q", "HEAD~1")
        _git(self.repo, "commit", "--allow-empty", "-q", "-m", "local only")
        _git(self.repo, "checkout", "-q", "main")
        self._queue(_line(anchor="SPINE-A2", tier="spine", reality="new"))
        self._route()
        with self.assertRaises(promote.PromoteBlocked) as caught:
            promote.draft(self.repo, no_pr=True)
        self.assertIn("diverged", str(caught.exception))

    def test_merged_branch_with_deleted_remote_restarts_from_base(self):
        self._seed_two_corrections()
        first = promote.draft(self.repo, no_pr=True)
        # merge the promotion PR and delete its branch, as review would
        _git(self.repo, "checkout", "-q", "main")
        _git(self.repo, "merge", "-q", "--no-ff", "-m", "merge promotion",
             self.branch)
        _git(self.repo, "push", "-q", "origin", "main")
        _git(self.repo, "push", "-q", "origin", "--delete", self.branch)

        self._queue(_line(anchor="SPINE-A2", tier="spine",
                          reality="post-merge correction"))
        self._route()
        second = promote.draft(self.repo, no_pr=True)
        self.assertEqual(second["result_state"], "pushed")
        self.assertEqual(
            _git(self.repo, "rev-list", "--count", f"origin/{self.branch}",
                 "^origin/main").stdout.strip(),
            "1", "the stale local branch restarted fresh off base")
        tip_files = _git(self.repo, "ls-tree", "-r", "--name-only",
                         f"origin/{self.branch}").stdout
        self.assertIn(first["file"], tip_files)  # merged draft rides base
        self.assertIn(second["file"], tip_files)

    def test_detached_head_refuses_named(self):
        self._seed_two_corrections()
        _git(self.repo, "checkout", "-q", "--detach", "HEAD")
        try:
            with self.assertRaises(promote.PromoteBlocked) as caught:
                promote.draft(self.repo, no_pr=True)
            self.assertIn("detached", str(caught.exception))
        finally:
            _git(self.repo, "checkout", "-q", "main")

    # --- the promotions record: the exactly-once baseline for 9.6

    def test_record_line_matches_the_published_shape(self):
        self._seed_two_corrections()
        result = promote.draft(self.repo, no_pr=True)

        raw = promote.record_path(self.key).read_text(encoding="utf-8")
        lines = [json.loads(t) for t in raw.split("\n") if t.strip()]
        self.assertEqual(len(lines), 1)
        record = lines[0]

        contracts = Path(__file__).resolve().parents[2] / "contracts"
        schema = json.loads((contracts / "knowledge.schema.json")
                            .read_text(encoding="utf-8"))
        required = schema["promotion"]["record_line"]["required"]
        self.assertEqual(sorted(record), sorted(required),
                         "the record writes exactly the published fields")
        self.assertEqual(record["type"], "draft")
        self.assertEqual(record["branch"], self.branch)
        self.assertEqual(record["base"], "main")
        self.assertEqual(record["file"], result["file"])
        self.assertEqual(len(record["keys"]), 2)
        for key in record["keys"]:
            self.assertEqual(len(key), 4, "delta_key: run provenance excluded")
        parsed = promote.read_record(self.key)
        self.assertEqual(len(parsed["keys"]), 2)

    def test_record_tolerates_malformed_key_entries_without_crashing(self):
        # a nested list inside keys would make tuple() unhashable — one
        # corrupt line must report as invalid, never brick the surface
        self._seed_two_corrections()
        promote.draft(self.repo, no_pr=True)
        with open(promote.record_path(self.key), "a", encoding="utf-8",
                  newline="\n") as handle:
            handle.write('{"type":"draft","drafted_at":"x","branch":"b",'
                         '"base":"main","file":"kb/x.md",'
                         '"keys":[[["nested"],"b","c","d"]]}\n')
        record = promote.read_record(self.key)
        self.assertEqual(len(record["drafts"]), 1)
        self.assertEqual(len(record["invalid"]), 1)
        self.assertIn("malformed key", record["invalid"][0]["error"])
        self.assertTrue(promote.check(self.repo)["ok"])

    def test_record_path_as_directory_is_broken_store_state(self):
        promote.record_path(self.key).mkdir(parents=True)
        with self.assertRaises(promote.PromoteBlocked) as caught:
            promote.check(self.repo)
        self.assertIn("not a file", str(caught.exception))

    def test_record_reads_forward_compatibly(self):
        self._seed_two_corrections()
        promote.draft(self.repo, no_pr=True)
        with open(promote.record_path(self.key), "a", encoding="utf-8",
                  newline="\n") as handle:
            handle.write('{"type":"promotion-emitted","of":"x"}\n')
            handle.write("torn line\n")
        record = promote.read_record(self.key)
        self.assertEqual(len(record["drafts"]), 1)
        self.assertEqual(record["other"], 1, "unknown kinds are not invalid")
        self.assertEqual(len(record["invalid"]), 1)
        # and the baseline still holds: nothing re-drafts
        again = promote.draft(self.repo, no_pr=True)
        self.assertEqual(again["result_state"], "no-op")
        self.assertIn("record_invalid", again)

    # --- AD-12: a mover, not an emitter (until the 1.7.0 row lands)

    def test_draft_emits_no_ledger_event(self):
        self._seed_two_corrections()
        before = (ledger.ledger_path().read_bytes()
                  if ledger.ledger_path().is_file() else b"")
        promote.draft(self.repo, no_pr=True)
        after = (ledger.ledger_path().read_bytes()
                 if ledger.ledger_path().is_file() else b"")
        self.assertEqual(before, after,
                         "the knowledge-promotion event lands at 1.7.0 "
                         "(ST-9.6), not before")

    # --- check: read-only gate state

    def test_check_reports_the_gate_state(self):
        before = promote.check(self.repo)
        self.assertFalse(before["routing"]["present"])
        self.assertEqual(before["corrections"],
                         {"deduped": 0, "promoted": 0, "unpromoted": 0})

        self._seed_two_corrections()
        ready = promote.check(self.repo)
        self.assertTrue(ready["routing"]["present"])
        self.assertEqual(ready["corrections"]["unpromoted"], 2)

        promote.draft(self.repo, no_pr=True)
        drafted = promote.check(self.repo)
        self.assertEqual(drafted["corrections"],
                         {"deduped": 2, "promoted": 2, "unpromoted": 0})
        # check touched no git state
        self.assertEqual(_git(self.repo, "status", "--porcelain").stdout, "")

    # --- CLI surface (the conformance drives' exact shape)

    def test_cli_check_answers_json_and_draft_refusal_names_the_gap(self):
        stdout_check = self._cli("check", "--directory", str(self.repo))
        self.assertTrue(stdout_check["ok"])

        result = self._cli("draft", "--directory", str(self.repo),
                           "--dry-run", expect_exit=2)
        self.assertFalse(result["ok"])
        self.assertIn("no routing doc", result["error"])

    def _cli(self, *argv: str, expect_exit: int = 0) -> dict:
        proc = subprocess.run(
            [sys.executable, str(Path(promote.__file__)), *argv],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
            encoding="utf-8", errors="replace",
            env=dict(os.environ), cwd=str(Path(promote.__file__).parent))
        self.assertEqual(proc.returncode, expect_exit, proc.stdout + proc.stderr)
        return json.loads(proc.stdout.strip().split("\n")[-1]
                          if not proc.stdout.strip().startswith("{")
                          else proc.stdout)


if __name__ == "__main__":
    unittest.main()
