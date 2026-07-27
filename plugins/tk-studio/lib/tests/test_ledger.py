"""Tests for the measurement ledger library (ST-1.2 acceptance criteria)."""
from __future__ import annotations

import json
import multiprocessing
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ledger  # noqa: E402


def _emit_batch(args: tuple[str, int, int]) -> None:
    """Worker for the concurrency test: emit `count` events tagged by worker id."""
    store, worker_id, count = args
    os.environ["TK_STUDIO_HOME"] = store
    for i in range(count):
        ledger.emit(
            "observation",
            {"source": "research-job", "description": f"worker-{worker_id}-event-{i}"},
        )


class ValidationTests(unittest.TestCase):
    def test_unknown_event_rejected(self):
        with self.assertRaises(ledger.LedgerError):
            ledger.validate("made-up-event", {})

    def test_missing_required_field_rejected(self):
        with self.assertRaises(ledger.LedgerError):
            ledger.validate("install-outcome", {"outcome": "success"})  # no core_version

    def test_enum_violation_rejected(self):
        with self.assertRaises(ledger.LedgerError):
            ledger.validate(
                "install-outcome", {"outcome": "maybe", "core_version": "6.10.0"}
            )

    def test_type_violation_rejected(self):
        with self.assertRaises(ledger.LedgerError):
            ledger.validate(
                "onboarding-funnel", {"stage": "store", "ok": "yes"}  # ok must be boolean
            )

    def test_unknown_payload_field_rejected(self):
        with self.assertRaises(ledger.LedgerError):
            ledger.validate(
                "report", {"description": "x", "stray": 1}
            )

    def test_valid_payloads_pass(self):
        ledger.validate("install-outcome", {"outcome": "success", "core_version": "6.10.0"})
        ledger.validate("drift-detection", {"result": "clean", "planes": []})
        ledger.validate("report", {"description": "skill did the wrong thing"})


class SanitizationTests(unittest.TestCase):
    def test_credential_key_redacted(self):
        out = ledger.sanitize({"api_key": "abc123", "detail": "fine"})
        self.assertEqual(out["api_key"], ledger.REDACTED)
        self.assertEqual(out["detail"], "fine")

    def test_credential_shaped_values_redacted(self):
        cases = [
            "header Bearer abcdefgh12345678 sent",
            "found ghp_ABCDEFGHIJKLMNOP1234 in log",
            "slack xoxb-12345678-ABCDEFGH here",
            "aws AKIAABCDEFGHIJKLMNOP used",
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0 seen",
        ]
        for text in cases:
            out = ledger.sanitize({"detail": text})
            self.assertIn(ledger.REDACTED, out["detail"], text)

    def test_nested_structures_sanitized(self):
        out = ledger.sanitize({"list": [{"token": "x"}, "Bearer abcdefgh12345678"]})
        self.assertEqual(out["list"][0]["token"], ledger.REDACTED)
        self.assertIn(ledger.REDACTED, out["list"][1])

    def test_non_allowlisted_absolute_path_masked(self):
        out = ledger.sanitize({"detail": r"wrote C:\Somewhere\else\file.txt today"})
        self.assertIn(ledger.MASKED_PATH, out["detail"])
        self.assertNotIn("Somewhere", out["detail"])
        out2 = ledger.sanitize({"detail": "read /home/alice/notes.md"})
        self.assertIn(ledger.MASKED_PATH, out2["detail"])

    def test_allowlisted_path_survives(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = str(Path(tmp) / "runs" / "r1")
            old = os.environ.get("TK_STUDIO_PATH_ALLOWLIST")
            os.environ["TK_STUDIO_PATH_ALLOWLIST"] = tmp
            try:
                out = ledger.sanitize({"detail": f"workspace {target}"})
                self.assertNotIn(ledger.MASKED_PATH, out["detail"])
            finally:
                if old is None:
                    os.environ.pop("TK_STUDIO_PATH_ALLOWLIST", None)
                else:
                    os.environ["TK_STUDIO_PATH_ALLOWLIST"] = old

    def test_content_hash_survives(self):
        digest = "9f2c1a4e" * 8
        out = ledger.sanitize({"detail": f"content_hash {digest}"})
        self.assertIn(digest, out["detail"])


class EmissionTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_home = os.environ.get("TK_STUDIO_HOME")
        os.environ["TK_STUDIO_HOME"] = self._tmp.name

    def tearDown(self):
        if self._old_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = self._old_home
        self._tmp.cleanup()

    def _lines(self):
        path = ledger.ledger_path()
        if not path.exists():
            return []
        return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()]

    def test_envelope_shape_and_append(self):
        env = ledger.emit("report", {"description": "wrong output"}, project="tk-studio")
        for key in ("ts", "event", "user", "machine", "project", "payload"):
            self.assertIn(key, env)
        lines = self._lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["event"], "report")
        self.assertEqual(lines[0]["payload"]["description"], "wrong output")

    def test_invalid_event_never_lands(self):
        with self.assertRaises(ledger.LedgerError):
            ledger.emit("report", {})
        self.assertEqual(self._lines(), [])

    def test_sanitized_before_disk(self):
        ledger.emit("report", {"description": "leaked Bearer abcdefgh12345678"})
        raw = ledger.ledger_path().read_text(encoding="utf-8")
        self.assertNotIn("abcdefgh12345678", raw)
        self.assertIn(ledger.REDACTED, raw)

    def test_dry_run_writes_nothing(self):
        ledger.emit("report", {"description": "x"}, dry_run=True)
        self.assertEqual(self._lines(), [])

    def test_concurrent_emitters_no_interleave_no_loss(self):
        workers, per_worker = 4, 25
        ctx = multiprocessing.get_context("spawn")
        with ctx.Pool(workers) as pool:
            pool.map(
                _emit_batch,
                [(self._tmp.name, w, per_worker) for w in range(workers)],
            )
        lines = self._lines()  # json.loads fails loudly on any interleaved line
        self.assertEqual(len(lines), workers * per_worker)
        descriptions = {l["payload"]["description"] for l in lines}
        self.assertEqual(len(descriptions), workers * per_worker)


if __name__ == "__main__":
    unittest.main()
