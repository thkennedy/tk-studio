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

ST-9.4 adds the queue/routing halves of the shape set, still pure: the
reconciliation-queue line shape (validate_queue_line, queue_key — the
dedupe key (run_id, anchor, verdict, reality, tier)), the within-handoff
dedupe key (delta_key — the 9.2 review's deferred finding: duplicate
identical deltas in one handoff refuse), and the routing renderer
(render_routing — a pure function of queue lines; it applies nothing, D3).
reality/evidence are single-line pointers, enforced: control and
line-separator characters refuse at validation and are stripped at render
(the queue is line-oriented JSONL; the routing doc is the human's
promotion-decision surface). File reads and appends live in
lib/reconcile.py.

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

# The reconciliation-queue line shape (knowledge.schema.json `queue_line`,
# ST-9.4): a captured delta plus its provenance. The dedupe key is
# (run_id, anchor, verdict, reality, tier) — `captured_at` and `evidence`
# deliberately stay outside it (re-capturing the same correction later, or
# citing a second place it was observed, is the same correction); `tier` is
# deliberately inside it (the tier names which artifact the correction
# targets — an escalation of a run-local correction to spine tier is a
# distinct routing event, not a duplicate; review finding, PR #16).
QUEUE_LINE_KEYS = ("run_id", "captured_at", "anchor", "verdict", "reality",
                   "evidence", "tier")

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

# Control characters (C0+C1) and the unicode line/paragraph separators.
# reality/evidence must be single-line pointers: the queue is line-oriented
# JSONL (U+2028/U+2029/U+0085 split Python's splitlines and would shear a
# written line into unparseable fragments, defeating dedupe), and the
# routing doc renders these strings — an embedded newline could forge
# sections and anchors on the human's promotion-decision surface (review
# finding, PR #16).
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")

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
        value = delta.get(field)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{label} ('{anchor}') needs a non-empty "
                            f"'{field}' string")
        elif _CONTROL_RE.search(value):
            problems.append(
                f"{label} ('{anchor}') has control or line-separator "
                f"characters in '{field}' — deltas are single-line "
                "pointers (the queue is line-oriented; the routing doc "
                "renders these verbatim)")
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


def clean_inline(value: object) -> str:
    """Control and line-separator characters replaced with spaces — the
    defense-in-depth cleaning every human-facing render applies. Validation
    refuses these characters on entry (validate_queue_line, _validate_delta);
    cleaning again at render means a hand-edited line still cannot forge
    headings or anchors on a decision or canonical surface."""
    return _CONTROL_RE.sub(" ", str(value))


# ------------------------------------------- queue lines + routing (ST-9.4)

def delta_key(delta: dict) -> tuple:
    """The within-handoff dedupe key: (anchor, verdict, reality, tier) —
    the queue key minus run_id, which is constant inside one handoff. Two
    deltas that share it are one correction stated twice (the 9.2 review's
    deferred finding); a differing reality is a genuinely different claim,
    and a differing tier targets a different artifact."""
    return (delta.get("anchor"), delta.get("verdict"),
            delta.get("reality"), delta.get("tier"))


def queue_key(line: dict) -> tuple:
    """The queue dedupe key, verbatim from the schema:
    (run_id, anchor, verdict, reality, tier)."""
    return (line.get("run_id"), line.get("anchor"), line.get("verdict"),
            line.get("reality"), line.get("tier"))


def validate_queue_line(line: object) -> list[str]:
    """Every problem with one reconciliation-queue line (the closed
    knowledge.schema.json `queue_line` shape); empty list = valid."""
    if not isinstance(line, dict):
        return ["queue line must be a JSON object"]
    problems = []
    unknown = set(line) - set(QUEUE_LINE_KEYS)
    if unknown:
        problems.append(f"unknown field(s): {', '.join(sorted(unknown))}")
    for field in ("run_id", "reality", "evidence"):
        value = line.get(field)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"needs a non-empty '{field}' string")
        elif _CONTROL_RE.search(value):
            problems.append(f"'{field}' has control or line-separator "
                            "characters — queue lines are single-line "
                            "JSONL and the routing doc renders them")
    captured = line.get("captured_at")
    if not isinstance(captured, str) or not _ISO_8601_RE.match(captured):
        problems.append("'captured_at' must be an ISO-8601 timestamp")
    if not is_anchor_id(line.get("anchor")):
        problems.append("'anchor' must be a bare anchor id (SPINE-A<n> or "
                        "SEED-<run-id>-A<n>)")
    if line.get("verdict") not in VERDICTS:
        problems.append(f"'verdict' must be one of {', '.join(VERDICTS)}")
    if line.get("tier") not in DELTA_TIERS:
        problems.append(f"'tier' must be one of {', '.join(DELTA_TIERS)}")
    return problems


def render_routing(lines: list[dict], project: str, generated: str,
                   invalid: list[dict] | None = None) -> str:
    """The routing doc — a pure render of the reconciliation queue, applying
    nothing (D3: only a human writes canonical; promotion is ST-9.5's PR
    membrane). Deduped on queue_key; spine-tier corrections lead (they
    challenge the project spine every future seed inherits from), run-local
    follow; WRONG before STALE before CONFIRMED inside each tier. Invalid
    queue lines are surfaced in their own section, never silently dropped.
    Pure: the caller supplies the timestamp; nothing here reads a clock.
    Defense in depth: every interpolated string is stripped of control and
    line-separator characters at render — validation refuses them on entry,
    but a hand-edited queue line must still be unable to forge sections or
    anchors on this surface."""
    _clean = clean_inline

    deduped: dict[tuple, dict] = {}
    for line in lines:
        deduped.setdefault(queue_key(line), line)
    entries = list(deduped.values())
    out = [
        "# Reconciliation routing",
        "",
        f"Project: {project} · generated: {generated} · "
        f"corrections: {len(entries)}",
        "",
        "A pure render of `reconciliation-queue.jsonl` — this document",
        "**applies nothing**. Promotion into project `kb/` is a drafted",
        "branch behind PR review (D3, AD-12); only a human writes canonical.",
        "Draft it: the `tk-studio-knowledge` skill's promote-draft verb",
        "(`promote.py draft`).",
        "",
    ]
    tiers = (("spine", "Spine corrections — challenge the project spine "
                       "(every future seed inherits it)"),
             ("run-local", "Run-local corrections — scoped to one run's "
                           "seed"))
    for tier, heading in tiers:
        tiered = [e for e in entries if e.get("tier") == tier]
        if not tiered:
            continue
        out += [f"## {heading}", ""]
        for verdict in VERDICTS:
            group = [e for e in tiered if e.get("verdict") == verdict]
            if not group:
                continue
            out += [f"### {verdict}", ""]
            for entry in group:
                out += [f"- **[{_clean(entry.get('anchor'))}]** "
                        f"{_clean(entry.get('reality'))}",
                        f"  - evidence: {_clean(entry.get('evidence'))}",
                        f"  - run: {_clean(entry.get('run_id'))} · captured: "
                        f"{_clean(entry.get('captured_at'))}"]
            out.append("")
    if not entries:
        out += ["_The queue holds no valid corrections._", ""]
    if invalid:
        out += ["## Unreadable queue lines — never silently dropped", ""]
        for item in invalid:
            out.append(f"- line {_clean(item.get('line'))}: "
                       f"{_clean(item.get('error'))}")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


# ------------------------------------------------- promotion draft (ST-9.5)

def promotion_entries(lines: list[dict]) -> list[dict]:
    """Queue lines grouped into promotion entries: one entry per correction
    identity (delta_key — anchor, verdict, reality, tier; run provenance
    deliberately outside it: a later run re-observing a drafted correction
    is the same correction, so it merges rather than duplicating). Evidence
    and runs accumulate in first-seen order. Entry order mirrors the routing
    doc — spine tier leads, WRONG|STALE|CONFIRMED inside each tier — so the
    reviewer sees the same shape they decided from."""
    grouped: dict[tuple, dict] = {}
    for line in lines:
        entry = grouped.setdefault(delta_key(line), {
            "anchor": line.get("anchor"), "verdict": line.get("verdict"),
            "reality": line.get("reality"), "tier": line.get("tier"),
            "evidence": [], "runs": []})
        evidence = line.get("evidence")
        if evidence and evidence not in entry["evidence"]:
            entry["evidence"].append(evidence)
        run_id = line.get("run_id")
        if run_id not in [r["run_id"] for r in entry["runs"]]:
            entry["runs"].append({"run_id": run_id,
                                  "captured_at": line.get("captured_at")})
    tier_rank = {tier: i for i, tier in enumerate(("spine", "run-local"))}
    verdict_rank = {verdict: i for i, verdict in enumerate(VERDICTS)}
    return sorted(grouped.values(),  # stable: first-seen order inside groups
                  key=lambda e: (tier_rank.get(e["tier"], len(tier_rank)),
                                 verdict_rank.get(e["verdict"],
                                                  len(verdict_rank))))


def render_promotion(entries: list[dict], project: str, label: str) -> str:
    """The promotion draft — ONE ordinary kb markdown file (D3: drafting
    applies nothing; the PR that carries this file is the gate, and merging
    it is the human's one canonical write). Frontmatter is ordinary kb
    metadata only — title/description, no new keys; `scope:` stays reserved
    and unread (AD-8). Anchor ids render unbracketed on purpose: they are
    provenance (which spine/seed assumption each correction targets), and
    this file must define no anchors of its own. Pure: the caller supplies
    project and label; every interpolated string is cleaned (defense in
    depth — a hand-edited queue line must not forge headings in what will
    become canonical kb)."""
    title = f"Reconciled corrections — {clean_inline(label)}"
    out = [
        "---",
        f"title: {title}",
        "description: Corrections promoted from the reconciliation queue — "
        "anchored deltas with run evidence, gated by PR review",
        "---",
        "",
        f"# {title}",
        "",
        f"Drafted from the `{clean_inline(project)}` reconciliation queue by",
        "`tk-studio-knowledge` (promote-draft). PR review gated this file",
        "into `kb/` — it is ordinary project knowledge now: edit it, fold it",
        "into topical docs, or prune it freely. Anchor ids are provenance",
        "(the spine/seed assumption each correction targets), deliberately",
        "unbracketed — this file defines no anchors.",
        "",
    ]
    tiers = (("spine", "Spine corrections — the project spine was challenged "
                       "here (every future seed inherits it)"),
             ("run-local", "Run-local corrections — scoped to one run's "
                           "seed"))
    for tier, heading in tiers:
        tiered = [e for e in entries if e.get("tier") == tier]
        if not tiered:
            continue
        out += [f"## {heading}", ""]
        for verdict in VERDICTS:
            group = [e for e in tiered if e.get("verdict") == verdict]
            if not group:
                continue
            out += [f"### {verdict}", ""]
            for entry in group:
                evidence = "; ".join(clean_inline(v)
                                     for v in entry.get("evidence", []))
                runs = ", ".join(
                    f"{clean_inline(r.get('run_id'))} "
                    f"(captured {clean_inline(r.get('captured_at'))})"
                    for r in entry.get("runs", []))
                out += [f"- `{clean_inline(entry.get('anchor'))}` — "
                        f"{clean_inline(entry.get('reality'))}",
                        f"  - evidence: {evidence or '—'}",
                        f"  - runs: {runs or '—'}"]
            out.append("")
    return "\n".join(out).rstrip() + "\n"
