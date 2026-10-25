"""tk-studio quote core — the engagement's 50/85/95 band from the studio's own
history (Story 32.5, F2 step 4; D4; B5 item 4). Driven by `engage.py quote`.

History: every `observation` in the store's `measurements/*.jsonl` (every
machine's file, harvested records included) whose envelope `project` is the
project's key and whose payload is the meter's structured record (`kind:
meter`, Settled shape 1), deduped by `story_key` with the last record (by
envelope `ts`, then read order) kept. Per story: `tokens = Σ legs (input +
output + cache_read + cache_write)` of `legs.<leg>.usage`, and `usd`. A
`meter:` observation without `kind: meter` is counted as `unstructured` and
never parsed.

Bootstrap (Settled shape 2): `random.Random(seed)`, 10,000 resamples; each
draws `n` story indices with replacement and sums tokens and usd over the
same indices; nearest-rank percentiles (`sorted[ceil(p/100*R)-1]`) of each
sum. The one-story p85 (for the cap) and the per-epic p85 draws continue the
same stream, in that order. `cap = p95 + one story at p85`.

Thin history (Settled shape 5): under THIN_BELOW structured records the
samples are the records plus the analogy prior (PRIOR_USD), and band85,
band95 and the cap are multiplied by WIDEN. A prior sample's tokens are its
dollars over the history's mean usd-per-token; with no metered story the
tokens (and the share) are null and the dollars carry.

`write_epic_bands` lands `epics.<EP-NNN>.usd_estimate` in
`.tk-studio/budget-bands.yaml` (Settled shape 4): every byte before the
top-level `epics:` key (and after its block) is kept, entries of other epics
are kept, and an entry this quote owns is overwritten. Stdlib-only (NFR9).
"""
from __future__ import annotations

import hashlib
import math
import random
import re
from pathlib import Path

import miniyaml

RESAMPLES = 10_000
THIN_BELOW = 8
WIDEN = 1.5
PERCENTILES = (50, 85, 95)
# The analogy prior (design spec §10's sizing by analogy): the twelve
# per-story all-in dollars of the Opus 5.5 trial, Epics 20-22 (dated
# 2026-09-28 to 2026-10-07), from kb/trial-record-opus-5-5.md's per-story
# table (Σ 246.64).
PRIOR_SOURCE = "kb/trial-record-opus-5-5.md"
PRIOR_USD = (3.97, 7.14, 19.45, 12.13, 38.13, 20.02, 27.49, 35.53, 22.43,
             17.68, 29.25, 13.42)
USAGE_FIELDS = ("input", "output", "cache_read", "cache_write")
AT_CAP = ("the run pauses partial, the engagement's issue blocks with the "
          "figures, the owner decides")
BANDS_REL = Path(".tk-studio") / "budget-bands.yaml"
# any top-level `epics:` key line; its value (comment stripped) is empty (a
# block mapping below), an empty scalar (`~`, `null`, `{}`, replaced) or any
# other scalar (refused: never a second `epics:` key beside it)
EPICS_LINE_RE = re.compile(r"^epics\s*:(?=\s|$)\s*(.*?)\s*$")
EMPTY_EPICS_RE = re.compile(r"^(~|null|\{\s*\})$")


class QuoteError(Exception):
    """The budget bands cannot be read as YAML; nothing is written."""


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(value)


# ------------------------------------------------------------ the history

def story_tokens(payload: dict) -> int | None:
    """Σ legs (input + output + cache_read + cache_write), or None when the
    legs are not the structured shape."""
    legs = payload.get("legs")
    if not isinstance(legs, dict):
        return None
    total = 0
    for leg in legs.values():
        usage = leg.get("usage") if isinstance(leg, dict) else None
        if not isinstance(usage, dict):
            return None
        for field in USAGE_FIELDS:
            value = usage.get(field, 0)
            if not _number(value) or value < 0:
                return None
            total += value
    return int(total)


def history(events: list[dict], project: str) -> dict:
    """`{samples: [{story_key, tokens, usd, route}], unstructured, project}`
    of the project's meter records (see the module docstring)."""
    ordered = sorted(enumerate(events),
                     key=lambda pair: (str(pair[1].get("ts") or ""), pair[0]))
    by_key: dict[str, dict] = {}
    unstructured = 0
    for _, envelope in ordered:
        if envelope.get("event") != "observation" \
                or envelope.get("project") != project:
            continue
        payload = envelope.get("payload")
        if not isinstance(payload, dict):
            continue
        if payload.get("kind") != "meter":
            if str(payload.get("description") or "").startswith("meter:"):
                unstructured += 1
            continue
        key, usd = payload.get("story_key"), payload.get("usd")
        tokens = story_tokens(payload)
        if not isinstance(key, str) or not key or not _number(usd) \
                or usd < 0 or tokens is None:
            unstructured += 1
            continue
        by_key.pop(key, None)  # the last record wins, in its own place
        by_key[key] = {"story_key": key, "tokens": tokens, "usd": usd,
                       "route": payload.get("route")
                       if isinstance(payload.get("route"), dict) else None}
    return {"samples": list(by_key.values()), "unstructured": unstructured,
            "project": project}


# ------------------------------------------------------------ the bootstrap

SEED_LIMIT = 2 ** 53  # a JSON number (the supervisor's js-yaml and
# JSON.stringify rewrite of the record) is exact only below 2**53


def valid_seed(seed) -> bool:
    return isinstance(seed, int) and not isinstance(seed, bool) \
        and 0 <= seed < SEED_LIMIT


def default_seed(engagement: str, n: int) -> int:
    """The first 6 bytes of sha256("<engagement>:<n>"): always < 2**53, so
    `basis.seed` survives the supervisor's JSON rewrite of the record."""
    digest = hashlib.sha256(f"{engagement}:{n}".encode("utf-8")).digest()
    return int.from_bytes(digest[:6], "big")


def nearest_rank(ordered: list, p: float):
    return ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]


def bootstrap(tokens: list | None, usd: list, n: int, rng: random.Random,
              resamples: int = RESAMPLES) -> dict:
    """`{p: (tokens | None, usd)}` for PERCENTILES: `resamples` draws of `n`
    indices with replacement, tokens and usd summed over the same indices."""
    size = len(usd)
    tok_sums, usd_sums = [], []
    for _ in range(resamples):
        idx = [rng.randrange(size) for _ in range(n)]
        usd_sums.append(sum(usd[i] for i in idx))
        if tokens is not None:
            tok_sums.append(sum(tokens[i] for i in idx))
    usd_sums.sort()
    tok_sums.sort()
    return {p: (nearest_rank(tok_sums, p) if tokens is not None else None,
                nearest_rank(usd_sums, p)) for p in PERCENTILES}


def share_of(tokens, window) -> float | str | None:
    if tokens is None:
        return None
    if window is None:
        return "share unknown"
    return round(tokens / window, 4)


def _band(tokens, usd, window, factor=1.0) -> dict:
    tok = None if tokens is None else int(round(tokens * factor))
    return {"tokens": tok, "usd": round(usd * factor, 2),
            "share": share_of(tok, window)}


def compute(samples: list[dict], n: int, epics: list[dict], seed: int,
            window: int | None, resamples: int = RESAMPLES) -> dict:
    """The quote's figures: `{band50, band85, band95, cap, cap_tokens,
    thin, notes, epic_usd: {k: usd}, history_n}`. `epics` are `{k,
    stories}`; `window` the plan's weekly token window or None."""
    hist_n = len(samples)
    thin = hist_n < THIN_BELOW
    usd = [float(s["usd"]) for s in samples]
    tokens: list | None = [float(s["tokens"]) for s in samples]
    notes = []
    if thin:
        notes.append(f"thin history: {hist_n} landed stories")
        total_tokens, total_usd = sum(tokens), sum(usd)
        if hist_n and total_tokens > 0 and total_usd > 0:
            per_token = total_usd / total_tokens
            tokens = tokens + [d / per_token for d in PRIOR_USD]
        else:
            # no usd-per-token ratio to price the prior in tokens: the
            # dollars carry, the tokens (and the share) are unknown
            tokens = None
            notes.append("tokens unknown: thin history (no metered story)"
                         if not hist_n else "tokens unknown: thin history "
                         "(no usd-per-token ratio)")
        usd = usd + list(PRIOR_USD)
    factor = WIDEN if thin else 1.0
    rng = random.Random(seed)
    main = bootstrap(tokens, usd, n, rng, resamples)
    one = bootstrap(tokens, usd, 1, rng, resamples)
    epic_usd = {}
    for epic in epics:
        if epic["stories"] < 1:
            continue
        drawn = bootstrap(tokens, usd, epic["stories"], rng, resamples)
        epic_usd[epic["k"]] = round(drawn[85][1] * factor, 2)
    t95, u95 = main[95]
    t1, u1 = one[85]
    cap_tokens = None if t95 is None else int(round((t95 + t1) * factor))
    return {
        "band50": _band(*main[50], window),
        "band85": _band(*main[85], window, factor),
        "band95": _band(*main[95], window, factor),
        "cap": round((u95 + u1) * factor, 2),
        "cap_tokens": cap_tokens,
        "thin": thin,
        "notes": notes,
        "epic_usd": epic_usd,
        "history_n": hist_n,
    }


# ------------------------------------------------------------ the bands file

def _epics_span(lines: list[str]) -> tuple[int, int] | None:
    """(start, end) line indexes of the top-level `epics:` block, or None."""
    for i, line in enumerate(lines):
        if EPICS_LINE_RE.match(line.rstrip("\r\n")):
            end = i + 1
            while end < len(lines):
                raw = lines[end].rstrip("\r\n")
                if raw.strip() and not raw.lstrip().startswith("#") \
                        and not raw[:1].isspace():
                    break
                end += 1
            # trailing blank and comment lines belong to what follows
            while end > i + 1 and (not lines[end - 1].strip()
                                   or lines[end - 1].lstrip().startswith("#")):
                end -= 1
            return i, end
    return None


def epic_bands_text(text: str | None, estimates: dict[str, float]) -> str:
    """The bands file with `epics.<id>.usd_estimate` set for each of
    `estimates` (other epics' entries kept); raises QuoteError when the
    existing text is not YAML the studio reads."""
    existing: dict = {}
    lines = (text or "").splitlines(keepends=True)
    span = _epics_span(lines)
    value = None
    if span is not None:
        value = EPICS_LINE_RE.match(lines[span[0]].rstrip("\r\n")).group(1)
        value = re.sub(r"(^|\s)#.*$", "", value).strip()
    if value and not EMPTY_EPICS_RE.match(value):
        raise QuoteError(f"{BANDS_REL.as_posix()}'s top-level epics is "
                         f"{value!r}, not a mapping; nothing is written")
    if value:
        # a scalar `epics: ~ | null | {}` is the (empty) block to replace;
        # the rest of the file is still read as YAML
        text = "".join(lines[:span[0]] + lines[span[1]:])
    if text:
        try:
            doc = miniyaml.loads(text)
        except miniyaml.MiniYamlError as exc:
            raise QuoteError(f"{BANDS_REL.as_posix()} is not YAML the studio "
                             f"reads ({exc})") from None
        epics = doc.get("epics") if isinstance(doc, dict) else None
        if isinstance(epics, dict):
            existing = dict(epics)
    merged = dict(existing)
    for ep_id, usd in estimates.items():
        entry = dict(merged[ep_id]) if isinstance(merged.get(ep_id), dict) \
            else {}
        entry["usd_estimate"] = usd
        merged[ep_id] = entry
    try:
        block = miniyaml.dumps({"epics": merged})
    except miniyaml.MiniYamlError as exc:
        raise QuoteError(f"{BANDS_REL.as_posix()}'s epics block cannot be "
                         f"rewritten ({exc})") from None
    if not block.endswith("\n"):
        block += "\n"
    if span is None:
        head = "".join(lines)
        if head and not head.endswith("\n"):
            head += "\n"
        return head + block
    start, end = span
    return "".join(lines[:start]) + block + "".join(lines[end:])
