"""tk-studio evolve loop, drafting half — observations -> proposals/ledger.md (ST-040, AD-8/AD-12).

The consumer the `observation` events never had: reads the merged
per-user-per-machine files under measurements/ (they arrived through the PR
membrane), clusters observation-shaped events by stated-toil similarity, and
maintains the living proposals ledger with the consolidate-twin row
discipline — stable PROP-NNN ids assigned in order and never reused, impact
High/Medium/Low, status Draft/Under-review/Adopted/Declined, rows updated in
place and never deleted. Each proposal names its evidence events, extracts the
candidate change the observation itself states where it states one, and
cross-links the issues ledger where an observation and an ISS row share
evidence (the observation/report twin pattern).

Defect-shaped events stay consolidate's: this module clusters only
`observation` events. `report` events are read as context for ISS
cross-links, never drafted from.

The D1 boundary is hard: drafting triggers nothing. This module writes PROP
rows and nothing else — no auto-apply, no scaffolding, no follow-on writes.
A proposal's status moves to Adopted/Declined by operator hand or PR review;
an adopted proposal becomes ordinary planned work.

Ownership per column (documented in the ledger header):
  - the drafter owns Evidence, Opened, and Updated, and writes Proposal, Candidate
    change, Affected surfaces, Impact, and Key at creation;
  - it upgrades a Candidate change only while the cell still holds a value it
    wrote itself — a hand-edited candidate is never overwritten;
  - operators own Impact and Status after creation.
The Key cell is the machine cluster key: how a rerun finds the row to update
in place. Reruns are idempotent — Opened/Updated stamp evidence-event dates,
never the wall clock, so drafting from unchanged data changes nothing.

Not an emitter: drafting derives; the events it reads were emitted by their
one named emitter each (AD-12, D2: no new taxonomy event).

CLI:
  uv run evolve.py draft --directory DIR [--dry-run]
  uv run evolve.py status --directory DIR

Exit codes: 0 ok (incl. clean no-op); 2 blocked (missing directory, not the
studio repo, unparseable proposals ledger). Stdlib-only (NFR9); never prompts
(AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path
import sys

import consolidate  # read_events: the \n-only merged-ledger reading discipline

MEASUREMENTS_DIR = "measurements"
LEDGER_REL = "proposals/ledger.md"
ISSUES_LEDGER_REL = "issues/ledger.md"

# Two observations state the same toil when their salient-token overlap
# reaches this coefficient (|a ∩ b| / min(|a|, |b|)) against the cluster seed.
SIMILARITY = 0.5

_STOPWORDS = frozenset("""
    the and for with that this from was were are has have had not but its
    into over under after before been being when where which while whose
    what all any can could would may might must shall will than then them
    they their there here also only same such each per via during without
    observed during actual expected
    """.split())

_TABLE_HEADER = ("| ID | Impact | Status | Proposal | Evidence "
                 "| Candidate change | Affected surfaces | Key | Opened | Updated |")
_TABLE_RULE = ("|----|--------|--------|----------|----------"
               "|------------------|-------------------|-----|--------|---------|")

_LEDGER_TEMPLATE = f"""# Proposals Ledger

The studio's living record of candidate changes drafted from observed toil —
derived from the merged measurement data in `measurements/` by
`tk-studio-evolve` (ST-040, AD-8/AD-12). Proposals are documents only (D1):
adoption and implementation stay human-initiated; an adopted proposal becomes
ordinary planned work.

## Discipline

- **Rows update in place, never delete.** Ids are stable `PROP-NNN`, assigned
  in order, never reused. A superseded proposal is Declined with an edit,
  never erased.
- **Ownership per column:** the drafter owns Evidence, Opened, and Updated —
  both stamps derive from evidence-event dates, never the wall clock — and
  writes Proposal, Candidate change, Affected surfaces, Impact, and Key at
  creation;
  it upgrades a Candidate change only while the cell still holds a value it
  wrote itself — a hand-edited candidate is never overwritten. Operators own
  Impact and Status after creation and may refine any prose column.
- **Key** is the machine cluster key — do not edit it; it is how a rerun
  finds the row to update in place.
- **Cross-links:** where a proposal's evidence twins an issues-ledger row
  (an observation and a report describing the same find), Evidence names the
  ISS id.

## Vocabulary

- **Impact:** High (evidence spans machines) | Medium (repeated evidence or
  an issues-ledger twin) | Low (a single observation).
- **Status:** Draft | Under-review | Adopted | Declined.

## Ledger

<!-- newest at bottom; never delete a row; update Status in place -->

{_TABLE_HEADER}
{_TABLE_RULE}
"""


class EvolveBlocked(Exception):
    """A refusal, not a failure: the input or ledger cannot be trusted."""

    def __init__(self, step: str, error: str):
        super().__init__(error)
        self.step = step


def _cell(text: str, limit: int = 200) -> str:
    """One markdown table cell: single line, no pipes, bounded."""
    flat = re.sub(r"\s+", " ", str(text)).replace("|", "/").strip()
    return flat[: limit - 1] + "…" if len(flat) > limit else flat


# --------------------------------------------------------------- clustering

def _text(envelope: dict) -> str:
    payload = envelope.get("payload") or {}
    if not isinstance(payload, dict):
        return ""
    return " ".join(str(payload.get(field) or "")
                    for field in ("description", "evidence"))


def _tokens(text: str) -> frozenset:
    return frozenset(t for t in re.findall(r"[a-z0-9][a-z0-9.\-_/]*",
                                           text.lower())
                     if len(t) >= 3 and t not in _STOPWORDS)


def _similar(a: frozenset, b: frozenset) -> bool:
    if not a or not b:
        return False
    return len(a & b) / min(len(a), len(b)) >= SIMILARITY


def _slug(envelope: dict) -> str:
    """The bounded cluster key an event would seed: obs:<first salient tokens>."""
    salient = [t for t in re.findall(r"[a-z0-9][a-z0-9.\-_/]*",
                                     _text(envelope).lower())
               if len(t) >= 3 and t not in _STOPWORDS]
    ordered_unique = list(dict.fromkeys(salient))[:6]
    return _cell("obs:" + "-".join(ordered_unique) if ordered_unique
                 else "obs:unstated", 120)


def cluster(events: list[dict]) -> list[dict]:
    """Greedy seed clustering of observation events, in evidence order.

    Each cluster is {"seed", "members", "tokens"}; an event joins the earliest
    cluster whose seed it resembles, else seeds its own. The merged ledger is
    append-only, so seeds — and the keys derived from them — are stable across
    reruns.
    """
    observations = sorted(
        (e for e in events
         if e.get("event") == "observation" and isinstance(e.get("payload"), dict)),
        key=lambda e: (e.get("ts") or "", e.get("user") or "",
                       e.get("machine") or ""))
    clusters: list[dict] = []
    for envelope in observations:
        toks = _tokens(_text(envelope))
        for entry in clusters:
            if _similar(entry["tokens"], toks):
                entry["members"].append(envelope)
                break
        else:
            clusters.append({"seed": envelope, "members": [envelope],
                             "tokens": toks})
    return clusters


def _machines(members: list[dict]) -> list[str]:
    return sorted({f"{e.get('user', '?')}-{e.get('machine', '?')}"
                   for e in members})


def _dates(members: list[dict]) -> tuple[str, str]:
    stamps = sorted((e.get("ts") or "")[:10] for e in members if e.get("ts"))
    if not stamps:
        return "unknown", "unknown"
    return stamps[0], stamps[-1]


# ------------------------------------------------------------- description

_SURFACE_RE = re.compile(r"tk-studio-[a-z][a-z0-9-]*"
                         r"|(?:lib|scripts|contracts)/[^\s,;)]+")
_CANDIDATE_RE = re.compile(r"candidate:\s*(.+)$", re.IGNORECASE)


def _candidate(envelope: dict) -> str:
    """The candidate change one observation states, if it states one."""
    description = str((envelope.get("payload") or {}).get("description") or "")
    match = _CANDIDATE_RE.search(description)
    if match:
        return match.group(1).strip()
    for sentence in re.split(r"(?<=[.;])\s+", description):
        if " should " in sentence or " must " in sentence:
            return sentence.strip()
    return ""


def _surfaces(members: list[dict]) -> str:
    found = sorted({m.group(0).rstrip(".,;:")
                    for e in members
                    for m in _SURFACE_RE.finditer(_text(e))})
    return _cell(", ".join(found), 160) if found else "unspecified"


def _issue_rows(directory: Path) -> dict[str, str]:
    """Key cell -> ISS id from the issues ledger, leniently (read-only context)."""
    path = directory / ISSUES_LEDGER_REL
    if not path.is_file():
        return {}
    mapping: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| ISS-"):
            continue
        cells = [c.strip() for c in line.split("|")][1:-1]
        if len(cells) == 10:
            mapping[cells[7]] = cells[0]
    return mapping


def _issue_links(entry: dict, reports: list[dict],
                 issues_by_key: dict[str, str]) -> list[str]:
    """ISS ids whose report evidence twins this cluster's observations."""
    surfaces = _surfaces(entry["members"])
    linked = set()
    for report in reports:
        payload = report.get("payload") or {}
        surface = str(payload.get("surface") or "unspecified")
        named = surface != "unspecified" and surface in surfaces
        if not (named or _similar(entry["tokens"], _tokens(_text(report)))):
            continue
        issue_id = issues_by_key.get(f"report:{surface}")
        if issue_id:
            linked.add(issue_id)
    return sorted(linked)


def evidence_cell(members: list[dict], links: list[str]) -> str:
    first, last = _dates(members)
    span = first if first == last else f"{first}..{last}"
    base = (f"{len(members)}× observation from "
            f"{'+'.join(_machines(members))} ({span})")
    return _cell(base + (f" ↔ {'+'.join(links)}" if links else ""))


def describe(entry: dict, links: list[str]) -> dict:
    """Title, impact, candidate change (+ every machine-writable variant)."""
    members = entry["members"]
    description = str((entry["seed"].get("payload") or {})
                      .get("description") or "unstated observation")
    title = re.split(r"(?<=[.;])\s+", description)[0]
    variants = list(dict.fromkeys(_candidate(m) for m in members)) + [""]
    candidate = next((c for c in (_candidate(m) for m in reversed(members))
                      if c), "")
    if len(_machines(members)) >= 2:
        impact = "High"
    elif len(members) >= 2 or links:
        impact = "Medium"
    else:
        impact = "Low"
    return {"title": _cell(title), "impact": impact,
            "candidate": _cell(candidate, 300),
            "machine_candidates": [_cell(v, 300) for v in variants],
            "surfaces": _surfaces(members)}


# ------------------------------------------------------------ ledger (md)

def _parse_rows(lines: list[str]) -> dict[int, list[str]]:
    """Line index -> cells for every PROP row; raises on an unparseable row."""
    rows: dict[int, list[str]] = {}
    for index, line in enumerate(lines):
        if not line.startswith("| PROP-"):
            continue
        cells = [cell.strip() for cell in line.split("|")][1:-1]
        if len(cells) != 10:
            raise EvolveBlocked(
                "ledger-parse",
                f"proposals ledger row at line {index + 1} has {len(cells)} "
                "cells, expected 10 — refusing to update a table it cannot "
                "parse")
        rows[index] = cells
    return rows


def _render_row(cells: list[str]) -> str:
    return "| " + " | ".join(cells) + " |"


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _load_ledger(ledger_path: Path) -> list[str]:
    if ledger_path.is_file():
        text = ledger_path.read_text(encoding="utf-8")
        if _TABLE_HEADER not in text:
            raise EvolveBlocked(
                "ledger-parse",
                f"{LEDGER_REL} exists but its table header is missing — "
                "refusing to update a ledger it cannot parse")
    else:
        text = _LEDGER_TEMPLATE
    return text.splitlines()


def draft(directory: Path, dry_run: bool = False) -> dict:
    """Cluster merged observations and sync the proposals ledger in place."""
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise EvolveBlocked("preflight", f"{directory} does not exist")
    measurements = directory / MEASUREMENTS_DIR
    result: dict = {"ok": True, "ledger": LEDGER_REL, "created": [],
                    "updated": [], "unchanged": 0}
    if not measurements.is_dir():
        result.update(events_scanned=0, observation_events=0, clusters=0,
                      skipped_lines=0,
                      note=f"no {MEASUREMENTS_DIR}/ under {directory.name} — "
                           "nothing to draft from")
        return result
    if not (directory / ".claude-plugin" / "marketplace.json").is_file():
        raise EvolveBlocked(
            "preflight",
            f"{directory} is not the studio repo root — the proposals ledger "
            "is studio data and lands only there (AD-3)")

    events, skipped = consolidate.read_events(measurements)
    clusters = cluster(events)
    reports = [e for e in events if e.get("event") == "report"
               and isinstance(e.get("payload"), dict)]
    issues_by_key = _issue_rows(directory)
    result.update(events_scanned=len(events) + skipped,
                  observation_events=sum(len(c["members"]) for c in clusters),
                  clusters=len(clusters), skipped_lines=skipped)

    ledger_path = directory / LEDGER_REL
    lines = _load_ledger(ledger_path)
    rows = _parse_rows(lines)
    by_key = {cells[7]: (index, cells) for index, cells in rows.items()}
    next_id = max((int(m.group(1)) for line in lines
                   for m in [re.match(r"\| PROP-(\d+) ", line)] if m),
                  default=0) + 1

    changed = False
    claimed: set[str] = set()
    for entry in clusters:
        members = entry["members"]
        links = _issue_links(entry, reports, issues_by_key)
        described = describe(entry, links)
        evidence = evidence_cell(members, links)
        first, last = _dates(members)
        # a rerun finds its row by any member's would-be seed key, so a
        # cross-machine merge that reorders history cannot strand a row
        member_slugs = [_slug(e) for e in members]
        hit = None
        for slug in member_slugs:
            found = by_key.get(slug)
            if found and found[1][7] not in claimed:
                hit = found
                break
        if hit is None:
            proposal_id = f"PROP-{next_id:03d}"
            next_id += 1
            cells = [proposal_id, described["impact"], "Draft",
                     described["title"], evidence, described["candidate"],
                     described["surfaces"], member_slugs[0], first, last]
            insert_at = (max(rows) + 1 if rows
                         else lines.index(_TABLE_HEADER) + 2)  # past the rule line
            lines.insert(insert_at, _render_row(cells))
            rows = _parse_rows(lines)  # reindex after the insert
            by_key = {c[7]: (i, c) for i, c in rows.items()}
            claimed.add(member_slugs[0])
            result["created"].append({"id": proposal_id, "key": member_slugs[0],
                                      "impact": described["impact"],
                                      "title": described["title"],
                                      "candidate": described["candidate"]})
            changed = True
            continue
        index, cells = hit
        claimed.add(cells[7])
        new_cells = list(cells)
        new_cells[4] = evidence
        # upgrade only a candidate this tool wrote itself; hand edits stand
        if cells[5] in described["machine_candidates"]:
            new_cells[5] = described["candidate"]
        new_cells[8] = first  # merged earlier evidence moves Opened back
        new_cells[9] = last
        if new_cells != cells:
            lines[index] = _render_row(new_cells)
            rows[index] = new_cells
            by_key[cells[7]] = (index, new_cells)
            result["updated"].append(cells[0])
            changed = True
        else:
            result["unchanged"] += 1

    result["dry_run"] = dry_run
    if changed and not dry_run:
        _atomic_write(ledger_path, "\n".join(lines) + "\n")
    result["wrote"] = changed and not dry_run
    return result


def status(directory: Path) -> dict:
    """Read-only view of the proposals ledger: counts and rows."""
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise EvolveBlocked("preflight", f"{directory} does not exist")
    ledger_path = directory / LEDGER_REL
    if not ledger_path.is_file():
        return {"ok": True, "ledger": LEDGER_REL, "rows": 0, "by_status": {},
                "proposals": [],
                "note": f"no {LEDGER_REL} yet — nothing drafted"}
    rows = _parse_rows(_load_ledger(ledger_path))
    by_status: dict[str, int] = {}
    proposals = []
    for cells in rows.values():
        by_status[cells[2]] = by_status.get(cells[2], 0) + 1
        proposals.append({"id": cells[0], "impact": cells[1],
                          "status": cells[2], "title": cells[3]})
    return {"ok": True, "ledger": LEDGER_REL, "rows": len(rows),
            "by_status": by_status, "proposals": proposals}


# ---------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio evolve drafting")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("draft",
                         help="cluster measurements/ into proposals/ledger.md")
    cmd.add_argument("--directory", required=True, help="studio repo root")
    cmd.add_argument("--dry-run", action="store_true")
    cmd = sub.add_parser("status", help="read-only proposals ledger summary")
    cmd.add_argument("--directory", required=True, help="studio repo root")
    args = parser.parse_args(argv)

    try:
        if args.command == "draft":
            result = draft(Path(args.directory), dry_run=args.dry_run)
        else:
            result = status(Path(args.directory))
    except EvolveBlocked as exc:
        print(json.dumps({"ok": False, "step": exc.step, "error": str(exc)},
                         ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
