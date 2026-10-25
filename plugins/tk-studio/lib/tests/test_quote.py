"""Tests for the quote core (Story 32.5, AC2): the seeded bootstrap (exact
figures, the same on a rerun, the same indices for tokens and dollars), the
thin-history rule (0, 1 and 7 records thin, 8 not; the prior and the
widening), the share, the cap, the history reader (project filter, dedupe,
unstructured count) and the `budget-bands.yaml` `epics` writer.
"""
from __future__ import annotations

import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import miniyaml  # noqa: E402
import quote  # noqa: E402


def samples(k: int) -> list[dict]:
    """k structured stories: tokens 1000*(i+1)**2, usd (i+1)*1.25."""
    return [{"story_key": f"1-{i + 1}-s", "tokens": 1000 * (i + 1) ** 2,
             "usd": (i + 1) * 1.25, "route": None} for i in range(k)]


def meter_event(key, usd, legs, project="proj", ts="2026-10-25T00:00:00Z",
                **extra):
    payload = {"source": "other", "description": f"meter: story={key}",
               "kind": "meter", "story_key": key, "usd": usd, "legs": legs,
               **extra}
    return {"ts": ts, "event": "observation", "project": project,
            "payload": payload}


def legs(**by_leg):
    return {leg: {"usd": 0.0, "usage": {"input": a, "output": b,
                                        "cache_read": c, "cache_write": d}}
            for leg, (a, b, c, d) in by_leg.items()}


class BootstrapTest(unittest.TestCase):
    def reference(self, tokens, usd, n, seed, resamples=quote.RESAMPLES):
        """The design notes' sketch, written out independently."""
        rng = random.Random(seed)
        pairs = []
        for _ in range(resamples):
            idx = [rng.randrange(len(usd)) for _ in range(n)]
            pairs.append((sum(tokens[i] for i in idx),
                          sum(usd[i] for i in idx)))
        tok = sorted(p[0] for p in pairs)
        dol = sorted(p[1] for p in pairs)

        def rank(xs, p):
            return xs[math.ceil(p / 100 * len(xs)) - 1]
        return {p: (rank(tok, p), rank(dol, p)) for p in (50, 85, 95)}

    def test_seeded_exact_and_the_same_on_a_rerun(self):
        hist = samples(10)
        first = quote.compute(hist, 4, [], seed=7, window=None)
        again = quote.compute(hist, 4, [], seed=7, window=None)
        self.assertEqual(first, again)
        self.assertFalse(first["thin"])
        self.assertEqual(first["band50"], {"tokens": 150000, "usd": 27.5,
                                           "share": "share unknown"})
        self.assertEqual(first["band85"], {"tokens": 222000, "usd": 35.0,
                                           "share": "share unknown"})
        self.assertEqual(first["band95"], {"tokens": 265000, "usd": 38.75,
                                           "share": "share unknown"})
        self.assertEqual(first["cap"], 50.0)
        self.assertEqual(first["cap_tokens"], 346000)

    def test_matches_the_reference_bootstrap(self):
        hist = samples(9)
        tokens = [float(s["tokens"]) for s in hist]
        usd = [float(s["usd"]) for s in hist]
        rng = random.Random(11)
        got = quote.bootstrap(tokens, usd, 3, rng)
        self.assertEqual(got, self.reference(tokens, usd, 3, 11))

    def test_a_different_seed_gives_a_different_band(self):
        hist = samples(10)
        a = quote.compute(hist, 4, [], seed=7, window=None)
        b = quote.compute(hist, 4, [], seed=8, window=None)
        self.assertNotEqual((a["band50"], a["band85"], a["band95"]),
                            (b["band50"], b["band85"], b["band95"]))

    def test_tokens_and_usd_are_drawn_from_the_same_indices(self):
        # usd is a fixed multiple of tokens: drawn from the same indices,
        # every resample's pair keeps the ratio, so each band keeps it too
        hist = [{"story_key": f"k{i}", "tokens": t, "usd": t / 1000,
                 "route": None} for i, t in enumerate(
                     (1000, 3000, 7000, 2000, 9000, 4000, 5000, 8000))]
        out = quote.bootstrap([float(h["tokens"]) for h in hist],
                              [h["usd"] for h in hist], 5, random.Random(3),
                              resamples=200)
        for p, (tok, usd) in out.items():
            self.assertAlmostEqual(tok / 1000, usd, places=9, msg=p)

    def test_the_cap_is_p95_plus_one_story_at_p85(self):
        hist = samples(10)
        tokens = [float(s["tokens"]) for s in hist]
        usd = [float(s["usd"]) for s in hist]
        rng = random.Random(5)
        main = quote.bootstrap(tokens, usd, 4, rng)
        one = quote.bootstrap(tokens, usd, 1, rng)
        got = quote.compute(hist, 4, [], seed=5, window=None)
        self.assertEqual(got["cap"], round(main[95][1] + one[85][1], 2))
        self.assertEqual(got["cap_tokens"], int(main[95][0] + one[85][0]))
        self.assertIsInstance(got["cap"], float)

    def test_epic_p85_continues_the_stream(self):
        hist = samples(10)
        tokens = [float(s["tokens"]) for s in hist]
        usd = [float(s["usd"]) for s in hist]
        rng = random.Random(5)
        quote.bootstrap(tokens, usd, 3, rng)
        quote.bootstrap(tokens, usd, 1, rng)
        e1 = quote.bootstrap(tokens, usd, 2, rng)[85][1]
        e2 = quote.bootstrap(tokens, usd, 1, rng)[85][1]
        got = quote.compute(hist, 3, [{"k": 1, "stories": 2},
                                      {"k": 2, "stories": 1}],
                            seed=5, window=None)
        self.assertEqual(got["epic_usd"], {1: round(e1, 2), 2: round(e2, 2)})

    def test_default_seed(self):
        import hashlib
        want = int.from_bytes(hashlib.sha256(b"ENG-001:3").digest()[:6],
                              "big")
        self.assertEqual(quote.default_seed("ENG-001", 3), want)

    def test_the_default_seed_is_exact_as_a_json_number(self):
        # the supervisor rewrites the record with JSON.stringify: a seed at
        # or above 2**53 would be rounded and no longer reproduce the band
        for eng in ("ENG-001", "ENG-002", "ENG-117", "ENG-999"):
            for n in (1, 2, 8, 40, 1000):
                seed = quote.default_seed(eng, n)
                self.assertTrue(0 <= seed < 2 ** 53, (eng, n, seed))
                self.assertTrue(quote.valid_seed(seed))
                self.assertEqual(int(float(seed)), seed)
        for bad in (-1, 2 ** 53, 2 ** 64, True, 1.5, "7"):
            self.assertFalse(quote.valid_seed(bad), bad)


class ThinHistoryTest(unittest.TestCase):
    def test_zero_one_and_seven_are_thin_and_eight_is_not(self):
        for k, thin in ((0, True), (1, True), (7, True), (8, False)):
            got = quote.compute(samples(k), 2, [], seed=1, window=None)
            self.assertEqual(got["thin"], thin, k)
            self.assertEqual(got["history_n"], k)
            if thin:
                self.assertIn(f"thin history: {k} landed stories",
                              got["notes"])
            else:
                self.assertEqual(got["notes"], [])

    def test_no_metered_story_carries_dollars_only(self):
        got = quote.compute([], 2, [], seed=1, window=1_000_000)
        self.assertEqual(got["notes"], [
            "thin history: 0 landed stories",
            "tokens unknown: thin history (no metered story)"])
        for band in ("band50", "band85", "band95"):
            self.assertIsNone(got[band]["tokens"])
            self.assertIsNone(got[band]["share"])
            self.assertGreater(got[band]["usd"], 0)
        self.assertIsNone(got["cap_tokens"])
        self.assertGreater(got["cap"], 0)

    def test_the_prior_and_the_widening(self):
        self.assertEqual(len(quote.PRIOR_USD), 12)
        self.assertAlmostEqual(sum(quote.PRIOR_USD), 246.64, places=6)
        self.assertEqual(quote.PRIOR_SOURCE, "kb/trial-record-opus-5-5.md")
        self.assertEqual(quote.WIDEN, 1.5)
        hist = samples(1)  # 1000 tokens for 1.25 usd
        usd = [1.25] + list(quote.PRIOR_USD)
        tokens = [1000.0] + [d / (1.25 / 1000) for d in quote.PRIOR_USD]
        rng = random.Random(2)
        main = quote.bootstrap(tokens, usd, 2, rng)
        one = quote.bootstrap(tokens, usd, 1, rng)
        got = quote.compute(hist, 2, [], seed=2, window=None)
        self.assertEqual(got["band50"]["usd"], round(main[50][1], 2))
        self.assertEqual(got["band85"]["usd"], round(main[85][1] * 1.5, 2))
        self.assertEqual(got["band95"]["usd"], round(main[95][1] * 1.5, 2))
        self.assertEqual(got["band85"]["tokens"],
                         int(round(main[85][0] * 1.5)))
        self.assertEqual(got["cap"],
                         round((main[95][1] + one[85][1]) * 1.5, 2))


    def test_no_usd_per_token_ratio_carries_dollars_only(self):
        free = [{**s, "usd": 0.0} for s in samples(3)]
        untokened = [{**s, "tokens": 0} for s in samples(3)]
        for hist in (free, untokened):
            got = quote.compute(hist, 2, [{"k": 1, "stories": 2}], seed=1,
                                window=1_000_000)
            self.assertIn("thin history: 3 landed stories", got["notes"])
            self.assertTrue(any(n.startswith("tokens unknown: thin history")
                                for n in got["notes"]), got["notes"])
            for band in ("band50", "band85", "band95"):
                self.assertIsNone(got[band]["tokens"])
                self.assertIsNone(got[band]["share"])
                self.assertGreater(got[band]["usd"], 0)
            self.assertIsNone(got["cap_tokens"])
            self.assertGreater(got["cap"], 0)
            self.assertGreater(got["epic_usd"][1], 0)


class ShareTest(unittest.TestCase):
    def test_share_over_the_window_and_share_unknown(self):
        got = quote.compute(samples(10), 4, [], seed=7, window=1_000_000)
        self.assertEqual(got["band50"]["share"], 0.15)
        self.assertEqual(got["band95"]["share"], 0.265)
        self.assertEqual(quote.share_of(12345, 100000), 0.1235)
        self.assertEqual(quote.share_of(5, None), "share unknown")
        self.assertIsNone(quote.share_of(None, 100))


class HistoryTest(unittest.TestCase):
    def test_project_filter_dedupe_last_wins_and_unstructured(self):
        events = [
            meter_event("1-1-a", 2.0, legs(session=(10, 20, 30, 40)),
                        ts="2026-10-25T01:00:00Z"),
            meter_event("1-1-a", 3.0, legs(session=(1, 1, 1, 1),
                                           review=(2, 2, 2, 2)),
                        ts="2026-10-25T02:00:00Z"),
            meter_event("1-2-b", 1.0, legs(session=(5, 0, 0, 0)),
                        project="other"),
            {"ts": "x", "event": "observation", "project": "proj",
             "payload": {"source": "other",
                         "description": "meter: story=0-1 usd=9.0"}},
            {"ts": "x", "event": "observation", "project": "proj",
             "payload": {"source": "retrospective", "description": "toil"}},
            {"ts": "x", "event": "report", "project": "proj",
             "payload": {"description": "meter: no"}},
        ]
        got = quote.history(events, "proj")
        self.assertEqual(got["project"], "proj")
        self.assertEqual(got["unstructured"], 1)
        self.assertEqual(got["samples"], [
            {"story_key": "1-1-a", "tokens": 12, "usd": 3.0, "route": None}])

    def test_a_malformed_structured_record_is_unstructured(self):
        events = [meter_event("1-1-a", "3", legs(session=(1, 1, 1, 1))),
                  meter_event("1-2-b", 1.0, {"session": {"usd": 1}})]
        got = quote.history(events, "proj")
        self.assertEqual((got["samples"], got["unstructured"]), ([], 2))


BANDS = """# Studio pipeline budget bands (fixture).
# a comment line
bands_version: 1
currency: usd
bands:
  S:
    usd_estimate: 4.5
  M:
    usd_estimate: 8.5
"""


class BandsFileTest(unittest.TestCase):
    def test_appended_with_the_comments_and_bands_byte_identical(self):
        out = quote.epic_bands_text(BANDS, {"EP-033": 12.34})
        self.assertTrue(out.startswith(BANDS))
        self.assertEqual(out[len(BANDS):],
                         "epics:\n  EP-033:\n    usd_estimate: 12.34\n")
        doc = miniyaml.loads(out)
        self.assertEqual(doc["bands"]["S"]["usd_estimate"], 4.5)

    def test_replaced_and_another_epic_kept(self):
        first = quote.epic_bands_text(BANDS, {"EP-033": 12.34,
                                              "EP-034": 3.0})
        tail = "other: 1\n"
        second = quote.epic_bands_text(first + tail, {"EP-033": 20.5})
        self.assertTrue(second.startswith(BANDS))
        self.assertTrue(second.endswith(tail))
        epics = miniyaml.loads(second)["epics"]
        self.assertEqual(epics, {"EP-033": {"usd_estimate": 20.5},
                                 "EP-034": {"usd_estimate": 3.0}})

    def test_a_scalar_epics_line_is_the_block_replaced(self):
        for scalar in ("~", "null", "{}", "{ }  # none yet"):
            with self.subTest(scalar=scalar):
                text = BANDS + f"epics: {scalar}\nother: 1\n"
                out = quote.epic_bands_text(text, {"EP-033": 2.5})
                self.assertTrue(out.startswith(BANDS))
                self.assertTrue(out.endswith("other: 1\n"))
                self.assertEqual(sum(1 for line in out.splitlines()
                                     if line.startswith("epics:")), 1)
                doc = miniyaml.loads(out)
                self.assertEqual(doc["epics"],
                                 {"EP-033": {"usd_estimate": 2.5}})
                self.assertEqual(doc["other"], 1)

    def test_the_board_test_literals_are_the_writers_output(self):
        # apps/supervisor/test/board.test.ts, "band_usd follows the epics
        # block engage.py quote writes (Story 32.5): comments and bands
        # kept, an entry overwritten, another kept" — its two literals are
        # what this writer produces, byte for byte
        head = ("# Studio pipeline budget bands (fixture).\n# operator-"
                "tunable data\nbands_version: 1\ncurrency: usd\nbands:\n"
                "  S:\n    usd_estimate: 4.5\n")
        first = quote.epic_bands_text(head, {"EP-030": 40.0,
                                             "EP-031": 61.27})
        self.assertEqual(first, head + "epics:\n  EP-030:\n    "
                         "usd_estimate: 40.0\n  EP-031:\n    usd_estimate: "
                         "61.27\n")
        second = quote.epic_bands_text(first, {"EP-031": 70.5})
        self.assertEqual(second, head + "epics:\n  EP-030:\n    "
                         "usd_estimate: 40.0\n  EP-031:\n    usd_estimate: "
                         "70.5\n")

    def test_the_approve_test_literals_are_the_writers_output(self):
        # apps/supervisor/test/approve.test.ts (Story 32.6): the approve
        # pass's TypeScript re-key (`rekeyBands`, the predicted EP id's band
        # moved to the minted one) writes these literals; each is what this
        # writer produces from the same input, byte for byte
        head = ("# Studio pipeline budget bands (fixture).\nbands_version: 1"
                "\ncurrency: usd\nepics:\n  EP-030:\n    usd_estimate: "
                "12.0\n")
        self.assertEqual(quote.epic_bands_text(head, {"EP-034": 40.0}),
                         head + "  EP-034:\n    usd_estimate: 40.0\n")
        self.assertEqual(
            quote.epic_bands_text("bands_version: 1\ncurrency: usd\n",
                                  {"EP-034": 40.0}),
            "bands_version: 1\ncurrency: usd\nepics:\n  EP-034:\n    "
            "usd_estimate: 40.0\n")
        self.assertEqual(
            quote.epic_bands_text(head + "other: 1\n", {"EP-030": 61.27}),
            head.replace("12.0", "61.27") + "other: 1\n")
        self.assertEqual(quote.epic_bands_text(None, {"EP-001": 1.0}),
                         "epics:\n  EP-001:\n    usd_estimate: 1.0\n")
        self.assertEqual(
            quote.epic_bands_text("epics: {}\nx: 1\n", {"EP-001": 2.5}),
            "epics:\n  EP-001:\n    usd_estimate: 2.5\nx: 1\n")
        # the moved entry (EP-033 to EP-034): what is left once the predicted
        # entry is gone, then the minted one set
        self.assertEqual(
            quote.epic_bands_text(head + "  EP-031:\n    usd_estimate: 5.0\n",
                                  {"EP-034": 40.0}),
            head + "  EP-031:\n    usd_estimate: 5.0\n  EP-034:\n    "
            "usd_estimate: 40.0\n")

    def test_any_other_scalar_epics_line_refuses(self):
        for scalar in ('""', "0", "x", "'none'", "[]", "1  # one",
                       "{EP-001: {usd_estimate: 1}}"):
            with self.subTest(scalar=scalar):
                text = BANDS + f"epics: {scalar}\nother: 1\n"
                with self.assertRaises(quote.QuoteError) as cm:
                    quote.epic_bands_text(text, {"EP-033": 2.5})
                self.assertIn("not a mapping", str(cm.exception))
        # a key that only starts with `epics` is not the block
        out = quote.epic_bands_text(BANDS + "epics_note: 0\n",
                                    {"EP-033": 2.5})
        self.assertTrue(out.endswith("epics_note: 0\nepics:\n  EP-033:\n"
                                     "    usd_estimate: 2.5\n"))

    def test_no_file_and_unreadable_yaml(self):
        self.assertEqual(quote.epic_bands_text(None, {"EP-001": 1.0}),
                         "epics:\n  EP-001:\n    usd_estimate: 1.0\n")
        with self.assertRaises(quote.QuoteError):
            quote.epic_bands_text("bands: [unclosed\n  - x: : :\n",
                                  {"EP-001": 1.0})


if __name__ == "__main__":
    unittest.main()
