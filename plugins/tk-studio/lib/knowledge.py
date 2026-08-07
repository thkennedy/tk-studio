"""tk-studio knowledge core — spine/seed/delta validation (ST-9.1, Epic 9).

The pure half of the Research→Knowledge Lifecycle port (planning pass
2026-08-06, D1–D5 ruled). Direct port of the first driver's schema validator
(ClaudeOS `knowledge-schema.ts`, mission mg1) onto studio shapes: no fs, no
I/O, no globals — callers pass raw artifact text (and delta objects) in and
get accumulated results back, so every rule is unit-testable in isolation.

Two tiers share one schema (contracts/knowledge.schema.json):

  tier: spine  — broad, once per project; lives in the per-user store at
                 ~/.tk-studio/projects/<key>/knowledge/spine.md (D2).
                 Budget rides the authoring job's guards — no budget field.
  tier: seed   — narrow, per run; lives in the run workspace as seed.md,
                 inherits spine anchors verbatim (frontmatter `inherits`).

The four ported invariants this module enforces (planning pass §3):

  1. Anchor ids are the join — immutable, append-only, `SPINE-A<n>` /
     `SEED-<run-id>-A<n>`; deltas cite identity, never location.
  2. The supersede header is a wall — `status: provisional` +
     `authority: mission-scoped-supersedes-canonical`, verbatim, required.
  3. Deltas are a closed shape — {anchor, verdict WRONG|STALE|CONFIRMED,
     reality, evidence, tier run-local|spine} as structured JSON (they ride
     handoff.json, not a markdown scan). Unanchored and dangling deltas are
     named rejections, never silently dropped.
  4. Nothing here writes anything — capture (9.4) and promotion (9.5) build
     on these verbs; only a human writes canonical (D3).

Grades stay the studio's A/B/C/D (D1); the source-vocabulary mapping is
published in the schema doc, not enforced here (the source validator never
graded either). Aid-not-gate: validation failure informs — callers must
never block a run on a red or absent spine/seed.

Stdlib-only (NFR9). Deliberately no CLI: purity is the contract here —
file-reading surfaces arrive with the session/capture stories.
"""
from __future__ import annotations

import re

# The verbatim supersede-header contract values (invariant 2). The authority
# string is the ported wire value — unchanged across drivers so artifacts
# remain portable between the source lifecycle and the studio.
SUPERSEDE_AUTHORITY = "mission-scoped-supersedes-canonical"
PROVISIONAL_STATUS = "provisional"

VERDICTS = ("WRONG", "STALE", "CONFIRMED")
DELTA_TIERS = ("run-local", "spine")
SEED_TIERS = ("spine", "seed")

_DELTA_KEYS = ("anchor", "verdict", "reality", "evidence", "tier")

# Anchor id grammar: a bracketed token beginning SPINE|SEED, ending in
# -A<digits>, arbitrary hyphenated middle (the run id for seeds). Examples:
#   [SPINE-A1]  [SEED-r-20260807-abc123-A2]
ANCHOR_RE = re.compile(r"\[((?:SPINE|SEED)(?:-[A-Za-z0-9]+)*-A\d+)\]")

# The same grammar as a bare id (no brackets) — what deltas and finding
# citations carry (ST-9.3: research findings gain an optional `anchor`).
ANCHOR_ID_RE = re.compile(r"(?:SPINE|SEED)(?:-[A-Za-z0-9]+)*-A\d+\Z")


def is_anchor_id(value: object) -> bool:
    """True when value is a bare anchor id (the citation form)."""
    return isinstance(value, str) and bool(ANCHOR_ID_RE.match(value))

# ISO-8601 date or datetime (date-only, or time + optional offset/Z).
_ISO_8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}"
    r"([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?)?\Z")

# Frontmatter block: first non-whitespace content (BOMs are tolerated in any
# mix with whitespace — artifacts cross Windows consoles and re-encoding can
# stack them; comments before the block are not allowed).
_FRONTMATTER_RE = re.compile(
    "^[﻿\\s]*---\r?\n([\\s\\S]*?)\r?\n---[ \t]*\r?\n?([\\s\\S]*)$")


def _extract_anchors_raw(text: str) -> list[str]:
    return ANCHOR_RE.findall(text)


def extract_anchors(text: str) -> list[str]:
    """Every unique bracketed anchor id in text, first-seen order."""
    return list(dict.fromkeys(_extract_anchors_raw(text)))


def _split_frontmatter(text: str) -> tuple[str | None, str]:
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return None, text
    return match.group(1), match.group(2)


def _parse_frontmatter(fm: str) -> dict:
    """Flat `key: value` parser — strips comments, reads `[a, b]` lists.
    Minimal and pure on purpose: no YAML library, no date coercion."""
    out: dict = {}
    for raw_line in re.split(r"\r?\n", fm):
        if not raw_line.strip() or raw_line.strip().startswith("#"):
            continue
        line = re.sub(r"\s+#.*$", "", raw_line)
        key, sep, value = line.partition(":")
        if not sep or not key.strip():
            continue
        key, value = key.strip(), value.strip()
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            out[key] = ([item.strip() for item in inner.split(",")
                         if item.strip()] if inner else [])
        else:
            out[key] = value
    return out


def _as_string(value: object) -> str:
    return value if isinstance(value, str) else ""


def parse_seed(text: str) -> dict:
    """Parse a spine/seed artifact into its structured, anchor-aware form:
    {frontmatter, tier, anchors, inherits, available, body} where available
    (defined + inherited) is the set a delta may legally cite."""
    fm, body = _split_frontmatter(text)
    frontmatter = _parse_frontmatter(fm) if fm is not None else {}
    tier_raw = _as_string(frontmatter.get("tier"))
    tier = tier_raw if tier_raw in SEED_TIERS else None
    inherits_raw = frontmatter.get("inherits")
    inherits = inherits_raw if isinstance(inherits_raw, list) else []
    anchors = extract_anchors(body)
    available = list(dict.fromkeys([*anchors, *inherits]))
    return {"frontmatter": frontmatter, "tier": tier, "anchors": anchors,
            "inherits": inherits, "available": available, "body": body}


def validate_seed(text: str) -> dict:
    """Validate a spine/seed artifact. Accumulates every problem rather than
    failing on the first, so a caller sees the full picture."""
    errors: list[str] = []
    fm, _ = _split_frontmatter(text)
    if fm is None:
        return {"valid": False,
                "errors": ["missing YAML frontmatter block (--- ... ---)"]}
    seed = parse_seed(text)
    fmv = seed["frontmatter"]

    if not seed["tier"]:
        errors.append("invalid or missing 'tier' (must be \"spine\" or "
                      "\"seed\")")

    # --- mandatory supersede header (invariant 2) ---
    if _as_string(fmv.get("status")) != PROVISIONAL_STATUS:
        errors.append(f"missing supersede header: 'status' must be "
                      f"\"{PROVISIONAL_STATUS}\" (provisional knowledge is "
                      "never canonical)")
    if _as_string(fmv.get("authority")) != SUPERSEDE_AUTHORITY:
        errors.append(f"missing supersede header: 'authority' must be "
                      f"verbatim \"{SUPERSEDE_AUTHORITY}\"")

    # --- always-required fields ---
    for field in ("project", "generated"):
        if not _as_string(fmv.get(field)):
            errors.append(f"missing required field '{field}'")
    generated = _as_string(fmv.get("generated"))
    if generated and not _ISO_8601_RE.match(generated):
        errors.append(f"'generated' is not a valid ISO-8601 timestamp: "
                      f"\"{generated}\"")

    # --- tier-conditional fields (spine needs nothing extra: its budget
    #     rides the authoring job's guards, not a schema field) ---
    if seed["tier"] == "seed":
        if not _as_string(fmv.get("run_id")):
            errors.append("seed tier requires 'run_id'")
        if not _as_string(fmv.get("spine_ref")):
            errors.append("seed tier requires 'spine_ref'")

    # --- anchors: at least one, unique, tier-consistent (invariant 1) ---
    if not seed["anchors"]:
        errors.append("no anchor ids defined in body (assumptions must "
                      "carry stable anchor ids)")
    raw_anchors = _extract_anchors_raw(seed["body"])
    for anchor in dict.fromkeys(a for a in raw_anchors
                                if raw_anchors.count(a) > 1):
        errors.append(f"duplicate anchor id '{anchor}' (anchor ids are "
                      "append-only, never reused)")
    for anchor in seed["anchors"]:
        if seed["tier"] == "spine" and not anchor.startswith("SPINE-"):
            errors.append(f"spine anchor '{anchor}' must use the SPINE- "
                          "prefix")
        if (seed["tier"] == "seed" and not anchor.startswith("SEED-")
                and anchor not in seed["inherits"]):
            errors.append(f"seed anchor '{anchor}' must use the SEED- "
                          "prefix (or be declared in 'inherits')")

    return {"valid": not errors, "errors": errors}


def _validate_delta(index: int, delta: object, available: set[str]) -> list[str]:
    label = f"deltas[{index}]"
    if not isinstance(delta, dict):
        return [f"{label} must be an object"]
    problems = []
    unknown = set(delta) - set(_DELTA_KEYS)
    if unknown:
        problems.append(f"{label} has unknown field(s): "
                        f"{', '.join(sorted(unknown))}")
    anchor = delta.get("anchor")
    if not isinstance(anchor, str) or not anchor.strip():
        problems.append(f"unanchored delta entry {label} (cites no anchor "
                        "id) — rejected, never silently dropped")
        return problems
    if anchor not in available:
        problems.append(f"{label} cites dangling anchor '{anchor}' (not "
                        "defined or inherited by the seed)")
        return problems
    if delta.get("verdict") not in VERDICTS:
        problems.append(f"{label} ('{anchor}') has invalid/missing verdict "
                        f"(expected one of {', '.join(VERDICTS)})")
    if delta.get("tier") not in DELTA_TIERS:
        problems.append(f"{label} ('{anchor}') has invalid/missing tier "
                        f"(expected one of {', '.join(DELTA_TIERS)})")
    for field in ("reality", "evidence"):
        if not isinstance(delta.get(field), str) or not delta.get(field, "").strip():
            problems.append(f"{label} ('{anchor}') needs a non-empty "
                            f"'{field}' string")
    return problems


def validate_deltas(deltas: object, seed_text: str) -> dict:
    """Validate delta objects (the closed handoff shape) against the seed
    they claim to correct. Every entry must cite an anchor in the seed's
    available set (defined + inherited)."""
    if not isinstance(deltas, list):
        return {"valid": False, "errors": ["deltas must be a JSON array"]}
    if not deltas:
        return {"valid": False, "errors": ["delta list contains no entries"]}
    available = set(parse_seed(seed_text)["available"])
    errors: list[str] = []
    for index, delta in enumerate(deltas):
        errors.extend(_validate_delta(index, delta, available))
    return {"valid": not errors, "errors": errors}


def validate_knowledge(seed_text: str, deltas: object | None = None) -> dict:
    """Convenience: validate an artifact and (optionally) deltas against it."""
    result = validate_seed(seed_text)
    errors = list(result["errors"])
    if deltas is not None:
        errors.extend(validate_deltas(deltas, seed_text)["errors"])
    return {"valid": not errors, "errors": errors}
