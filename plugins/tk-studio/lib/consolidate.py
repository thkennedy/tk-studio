"""tk-studio consolidation — merged measurements -> issues/ledger.md (ST-7.2, AD-12).

The closing half of the measurement loop: reads the merged per-user-per-machine
files under measurements/ (they arrived through the PR membrane), clusters
defect-shaped events into candidate defects, and maintains the living issues
ledger with the legacy-council row discipline — stable ISS-NNN ids assigned in order and
never reused, severity High/Medium/Low, status Open/Mitigated/Resolved/Wontfix,
rows updated in place and never deleted. Each issue names its evidence events
and, where the evidence makes it clear, a specific fix candidate — including
"revise the distribution mechanism" when repeated drift or install failures
across machines point there (the AD-1/O1 revision channel).

Ownership per column (documented in the ledger header):
  - the consolidator owns Evidence and Updated, and writes Issue, Expected vs
    Actual, Fix candidate, and Key at creation;
  - it upgrades a Fix candidate only while the cell still holds a value it
    wrote itself — a hand-edited candidate is never overwritten;
  - operators own Sev and Status after creation.
The Key cell is the machine cluster key: how a rerun finds the row to update
in place. Reruns are idempotent — Opened/Updated stamp evidence-event dates,
never the wall clock, so consolidating unchanged data changes nothing.

Not an emitter: consolidation derives; the events it reads were emitted by
their one named emitter each (AD-12).

CLI:
  uv run consolidate.py run --directory DIR [--dry-run]

Exit codes: 0 ok (incl. clean no-op); 2 blocked (missing directory, not the
studio repo, unparseable issues ledger). Stdlib-only (NFR9); never prompts
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

MEASUREMENTS_DIR = "measurements"
LEDGER_REL = "issues/ledger.md"

SEVERITY = {
    "install-failure": "High",
    "activation-failure": "High",
    "headless-failure": "High",
    "drift": "Medium",
    "onboarding-failure": "Medium",
    "job-blocked": "Medium",
    "report": "Medium",
}

DISTRIBUTION_FIX = ("revise the distribution mechanism (AD-1/O1 revision "
                    "channel — repeated {what} across machines)")

_TABLE_HEADER = ("| ID | Sev | Status | Issue | Expected vs Actual | Evidence "
                 "| Fix candidate | Key | Opened | Updated |")
_TABLE_RULE = ("|----|-----|--------|-------|--------------------|----------"
               "|---------------|-----|--------|---------|")

_LEDGER_TEMPLATE = f"""# Issues Ledger

The studio's living defect record — consolidated from the merged measurement
data in `measurements/` by `tk-studio-consolidate` (ST-7.2, AD-12), leading to
specific fixes (the O1 revision channel).

## Discipline

- **Rows update in place, never delete.** Ids are stable `ISS-NNN`, assigned
  in order, never reused. A superseded finding is corrected with an edit,
  never erased.
- **Ownership per column:** the consolidator owns Evidence and Updated, and
  writes Issue, Expected vs Actual, Fix candidate, and Key at creation; it
  upgrades a Fix candidate only while the cell still holds a value it wrote
  itself — a hand-edited candidate is never overwritten. Operators own Sev
  and Status after creation and may refine any prose column.
- **Key** is the machine cluster key — do not edit it; it is how a rerun
  finds the row to update in place.

## Vocabulary

- **Severity:** High (breaks an invariant or blocks work) | Medium (degrades
  work, has a workaround) | Low (annoyance / cosmetic).
- **Status:** Open | Mitigated (worked around, root cause lingers) | Resolved
  | Wontfix.

## Ledger

<!-- newest at bottom; never delete a row; update Status in place -->

{_TABLE_HEADER}
{_TABLE_RULE}
"""


class ConsolidateBlocked(Exception):
    """A refusal, not a failure: the input or ledger cannot be trusted."""

    def __init__(self, step: str, error: str):
        super().__init__(error)
        self.step = step


def _cell(text: str, limit: int = 200) -> str:
    """One markdown table cell: single line, no pipes, bounded."""
    flat = re.sub(r"\s+", " ", str(text)).replace("|", "/").strip()
    return flat[: limit - 1] + "…" if len(flat) > limit else flat


# ------------------------------------------------------------------ reading

def read_events(measurements: Path) -> tuple[list[dict], int]:
    """All parseable envelopes from measurements/*.jsonl, plus skipped count."""
    events: list[dict] = []
    skipped = 0
    for path in sorted(measurements.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                envelope = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if isinstance(envelope, dict):
                events.append(envelope)
            else:
                skipped += 1
    return events, skipped


# --------------------------------------------------------------- clustering

def cluster_key(envelope: dict) -> tuple | None:
    """Defect-shaped events map to a cluster key; everything else is None."""
    event = envelope.get("event")
    payload = envelope.get("payload") or {}
    if not isinstance(payload, dict):
        return None
    if event == "install-outcome" and payload.get("outcome") == "failure":
        return ("install-failure", payload.get("step") or "unknown")
    if event == "activation-failure":
        return ("activation-failure", payload.get("step") or "unknown")
    if event == "headless-failure":
        return ("headless-failure", payload.get("surface") or "unknown",
                payload.get("assertion") or "unknown")
    if event == "drift-detection" and payload.get("result") == "drift":
        return ("drift",)
    if event == "onboarding-funnel" and payload.get("ok") is False:
        return ("onboarding-failure", payload.get("stage") or "unknown")
    if event == "job-run" and payload.get("state") == "blocked":
        return ("job-blocked", payload.get("job_id") or "unknown")
    if event == "report":
        return ("report", payload.get("surface") or "unspecified")
    return None


def cluster(events: list[dict]) -> dict[tuple, list[dict]]:
    clusters: dict[tuple, list[dict]] = {}
    for envelope in events:
        key = cluster_key(envelope)
        if key is not None:
            clusters.setdefault(key, []).append(envelope)
    for members in clusters.values():
        members.sort(key=lambda e: e.get("ts") or "")
    return clusters


def _machines(members: list[dict]) -> list[str]:
    return sorted({f"{e.get('user', '?')}-{e.get('machine', '?')}"
                   for e in members})


def _dates(members: list[dict]) -> tuple[str, str]:
    stamps = sorted((e.get("ts") or "")[:10] for e in members if e.get("ts"))
    if not stamps:
        return "unknown", "unknown"
    return stamps[0], stamps[-1]


def evidence_cell(key: tuple, members: list[dict]) -> str:
    """Names the evidence events: count, type, source files, date span."""
    event_type = members[0].get("event", key[0])
    first, last = _dates(members)
    span = first if first == last else f"{first}..{last}"
    return _cell(f"{len(members)}× {event_type} from "
                 f"{'+'.join(_machines(members))} ({span})")


def _sample_detail(members: list[dict], *fields: str) -> str:
    """Most recent non-empty detail-ish payload field across the cluster."""
    for envelope in reversed(members):
        payload = envelope.get("payload") or {}
        for field in fields:
            value = payload.get(field)
            if value:
                return str(value)
    return ""


def describe(key: tuple, members: list[dict]) -> dict:
    """Issue title, expected-vs-actual, and both deterministic fix candidates
    (single-source and cross-machine) for one cluster."""
    category = key[0]
    multi = len(_machines(members)) >= 2
    if category == "install-failure":
        step = key[1]
        detail = _sample_detail(members, "detail", "step")
        title = f"Install fails at step '{step}'"
        eva = ("Expected: the installer completes at the bmad.lock pin. "
               f"Actual: step '{step}' fails" + (f" — {detail}" if detail else ""))
        fixes = (f"harden the '{step}' step in tk-studio-install",
                 DISTRIBUTION_FIX.format(what="install failures"))
        fix = fixes[1] if multi else fixes[0]
    elif category == "activation-failure":
        step = key[1]
        detail = _sample_detail(members, "error")
        title = f"Activation check fails at step '{step}'"
        eva = ("Expected: every activation check step completes (AD-13). "
               f"Actual: step '{step}' fails" + (f" — {detail}" if detail else ""))
        fixes = (f"harden the '{step}' check in tk-studio-activate",)
        fix = fixes[0]
    elif category == "headless-failure":
        surface, assertion = key[1], key[2]
        detail = _sample_detail(members, "detail")
        title = f"{surface} fails conformance assertion '{assertion}'"
        eva = (f"Expected: {surface} passes the conformance suite headless "
               f"(AD-11/AD-19). Actual: assertion '{assertion}' fails"
               + (f" — {detail}" if detail else ""))
        fixes = (f"restore dual-mode conformance for {surface} "
                 f"('{assertion}' assertion)",)
        fix = fixes[0]
    elif category == "drift":
        detail = _sample_detail(members, "detail")
        title = "Version drift detected between installed planes and the pins"
        eva = ("Expected: installed planes match the pins on every machine "
               "(AD-13). Actual: drift reported"
               + (f" — {detail}" if detail else ""))
        fixes = ("run the guided fix on the affected machine (tk install / "
                 "/plugin marketplace update)",
                 DISTRIBUTION_FIX.format(what="drift"))
        fix = fixes[1] if multi else fixes[0]
    elif category == "onboarding-failure":
        stage = key[1]
        detail = _sample_detail(members, "detail")
        title = f"Onboarding funnel fails at stage '{stage}'"
        eva = (f"Expected: onboarding stage '{stage}' completes (NFR7). "
               "Actual: the stage fails" + (f" — {detail}" if detail else ""))
        fixes = (f"fix onboarding stage '{stage}' in tk-studio-onboard",)
        fix = fixes[0]
    elif category == "job-blocked":
        job_id = key[1]
        reason = _sample_detail(members, "reason", "detail")
        title = f"Job '{job_id}' runs end blocked"
        eva = (f"Expected: job '{job_id}' runs within its guards (AD-10). "
               "Actual: runs end blocked" + (f" — {reason}" if reason else ""))
        fixes = (f"fix job '{job_id}' definition or its target skill's "
                 "headless path",)
        fix = fixes[0]
    else:  # report
        surface = key[1]
        description = _sample_detail(members, "description") or "no description"
        title = (f"Operator report on {surface}" if surface != "unspecified"
                 else "Operator report")
        eva = ("Expected: the surface behaves as designed. Actual (operator "
               f"report): {description}")
        fixes = ("",)
        fix = fixes[0]
    return {"title": _cell(title), "expected_vs_actual": _cell(eva, 300),
            "fix": _cell(fix), "machine_fixes": [_cell(f) for f in fixes],
            "severity": SEVERITY[category]}


# ------------------------------------------------------------ ledger (md)

def _key_cell(key: tuple) -> str:
    return _cell(":".join(key), 120)


def _parse_rows(lines: list[str]) -> dict[int, list[str]]:
    """Line index -> cells for every ISS row; raises on an unparseable row."""
    rows: dict[int, list[str]] = {}
    for index, line in enumerate(lines):
        if not line.startswith("| ISS-"):
            continue
        cells = [cell.strip() for cell in line.split("|")][1:-1]
        if len(cells) != 10:
            raise ConsolidateBlocked(
                "ledger-parse",
                f"issues ledger row at line {index + 1} has {len(cells)} cells, "
                "expected 10 — refusing to update a table it cannot parse")
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


def consolidate(directory: Path, dry_run: bool = False) -> dict:
    """Cluster merged measurements and sync the issues ledger in place."""
    directory = Path(directory).resolve()
    if not directory.is_dir():
        raise ConsolidateBlocked("preflight", f"{directory} does not exist")
    measurements = directory / MEASUREMENTS_DIR
    result: dict = {"ok": True, "ledger": LEDGER_REL, "created": [],
                    "updated": [], "unchanged": 0}
    if not measurements.is_dir():
        result.update(events_scanned=0, defect_events=0, clusters=0,
                      skipped_lines=0,
                      note=f"no {MEASUREMENTS_DIR}/ under {directory.name} — "
                           "nothing to consolidate")
        return result
    if not (directory / ".claude-plugin" / "marketplace.json").is_file():
        raise ConsolidateBlocked(
            "preflight",
            f"{directory} is not the studio repo root — the issues ledger is "
            "studio data and lands only there (AD-3)")

    events, skipped = read_events(measurements)
    clusters = cluster(events)
    result.update(events_scanned=len(events) + skipped,
                  defect_events=sum(len(m) for m in clusters.values()),
                  clusters=len(clusters), skipped_lines=skipped)

    ledger_path = directory / LEDGER_REL
    if ledger_path.is_file():
        text = ledger_path.read_text(encoding="utf-8")
        if _TABLE_HEADER not in text:
            raise ConsolidateBlocked(
                "ledger-parse",
                f"{LEDGER_REL} exists but its table header is missing — "
                "refusing to update a ledger it cannot parse")
    else:
        text = _LEDGER_TEMPLATE
    lines = text.splitlines()
    rows = _parse_rows(lines)
    by_key = {cells[7]: (index, cells) for index, cells in rows.items()}
    next_id = max((int(m.group(1)) for line in lines
                   for m in [re.match(r"\| ISS-(\d+) ", line)] if m),
                  default=0) + 1

    changed = False
    for key in sorted(clusters):
        members = clusters[key]
        described = describe(key, members)
        evidence = evidence_cell(key, members)
        first, last = _dates(members)
        cell_key = _key_cell(key)
        hit = by_key.get(cell_key)
        if hit is None:
            issue_id = f"ISS-{next_id:03d}"
            next_id += 1
            cells = [issue_id, described["severity"], "Open",
                     described["title"], described["expected_vs_actual"],
                     evidence, described["fix"], cell_key, first, last]
            insert_at = (max(rows) + 1 if rows
                         else lines.index(_TABLE_HEADER) + 2)  # past the rule line
            lines.insert(insert_at, _render_row(cells))
            rows = _parse_rows(lines)  # reindex after the insert
            by_key = {c[7]: (i, c) for i, c in rows.items()}
            result["created"].append({"id": issue_id, "key": cell_key,
                                      "severity": described["severity"],
                                      "title": described["title"],
                                      "fix_candidate": described["fix"]})
            changed = True
            continue
        index, cells = hit
        new_cells = list(cells)
        new_cells[5] = evidence
        # upgrade only a candidate this tool wrote itself; hand edits stand
        if cells[6] in described["machine_fixes"]:
            new_cells[6] = described["fix"]
        new_cells[9] = last
        if new_cells != cells:
            lines[index] = _render_row(new_cells)
            rows[index] = new_cells
            by_key[cell_key] = (index, new_cells)
            result["updated"].append(cells[0])
            changed = True
        else:
            result["unchanged"] += 1

    result["dry_run"] = dry_run
    if changed and not dry_run:
        _atomic_write(ledger_path, "\n".join(lines) + "\n")
    result["wrote"] = changed and not dry_run
    return result


# ---------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio consolidation")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("run", help="cluster measurements/ into issues/ledger.md")
    cmd.add_argument("--directory", required=True, help="studio repo root")
    cmd.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    try:
        result = consolidate(Path(args.directory), dry_run=args.dry_run)
    except ConsolidateBlocked as exc:
        print(json.dumps({"ok": False, "step": exc.step, "error": str(exc)},
                         ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
