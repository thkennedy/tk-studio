"""tk-studio research core — charters and evidence-graded findings (ST-6.4).

The deterministic half of the tk-studio-research surface. The reasoning half
(actually surveying the ecosystem) is the agent driving the session; this
module keeps it honest at both ends:

  charter   validates the scoped charter a research job carries in its
            payload — topics and sources are required and non-empty, so an
            unscoped "go research" can never start (refuse-to-guess). The
            normalized charter names what a run must produce.
  record    validates the run's findings — every finding carries an evidence
            grade (A–D) and its evidence trail — then lands the artifacts in
            the run workspace (findings.json + a human-readable findings.md)
            and emits one `observation` measurement event per
            recommendation-carrying finding (source `research-job`; the
            taxonomy names research job types as an observation emitter —
            the job wrapper's job-run event stays separate, AD-12).

Evidence grades (dps discipline — ungraded findings refuse):
  A  primary source, verified directly
  B  multiple independent sources agree
  C  single credible source
  D  inference or speculation — needs verification

CLI:
  uv run research.py charter --charter JSON
  uv run research.py record --directory DIR --run-id RID
                            (--findings JSON | --findings-file PATH)
                            [--no-emit]

Exit codes: 0 ok; 2 invalid charter/findings or unknown run; 1 unexpected
failure. Env: TK_STUDIO_HOME overrides the store root (tests).
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import job as joblib
import ledger

GRADES = {
    "A": "primary source, verified directly",
    "B": "multiple independent sources agree",
    "C": "single credible source",
    "D": "inference or speculation — needs verification",
}

_CHARTER_KEYS = ("topics", "sources", "max_findings", "notes")
_FINDING_KEYS = ("title", "summary", "grade", "evidence", "recommendation")
_EVIDENCE_KEYS = ("source", "url", "note")
_RECOMMENDATION_KEYS = ("action", "target")


class ResearchError(Exception):
    """Invalid charter or findings; message is safe to surface."""


# ---------------------------------------------------------------- charter

def validate_charter(charter: object) -> dict:
    """Normalize a charter or raise — a run without scope never starts."""
    if not isinstance(charter, dict):
        raise ResearchError("charter must be a JSON object")
    unknown = set(charter) - set(_CHARTER_KEYS)
    if unknown:
        raise ResearchError(
            f"charter has unknown field(s): {', '.join(sorted(unknown))}")
    problems = []
    for field in ("topics", "sources"):
        value = charter.get(field)
        if (not isinstance(value, list) or not value
                or not all(isinstance(v, str) and v.strip() for v in value)):
            problems.append(f"charter.{field} must be a non-empty list of "
                            "strings — an unscoped run never starts")
    if "max_findings" in charter and not (
            isinstance(charter["max_findings"], int)
            and not isinstance(charter["max_findings"], bool)
            and charter["max_findings"] > 0):
        problems.append("charter.max_findings must be an integer > 0")
    if "notes" in charter and not isinstance(charter["notes"], str):
        problems.append("charter.notes must be a string")
    if problems:
        raise ResearchError("; ".join(problems))
    return {
        "topics": charter["topics"],
        "sources": charter["sources"],
        "max_findings": charter.get("max_findings", 10),
        "notes": charter.get("notes", ""),
        "must_produce": {
            "findings": "evidence-graded findings (grades "
                        + "|".join(GRADES) + "), landed via research.py "
                        "record — ungraded findings refuse",
            "observations": "one observation event per recommendation-"
                            "carrying finding (source: research-job)",
        },
    }


# --------------------------------------------------------------- findings

def _validate_finding(index: int, finding: object) -> list[str]:
    label = f"findings[{index}]"
    if not isinstance(finding, dict):
        return [f"{label} must be an object"]
    problems = []
    unknown = set(finding) - set(_FINDING_KEYS)
    if unknown:
        problems.append(f"{label} has unknown field(s): "
                        f"{', '.join(sorted(unknown))}")
    for field in ("title", "summary"):
        if not isinstance(finding.get(field), str) or not finding.get(field, "").strip():
            problems.append(f"{label}.{field} must be a non-empty string")
    grade = finding.get("grade")
    if grade not in GRADES:
        problems.append(f"{label}.grade must be one of {'|'.join(GRADES)} "
                        "— ungraded findings refuse")
    evidence = finding.get("evidence")
    if not isinstance(evidence, list):
        problems.append(f"{label}.evidence must be a list")
    else:
        if grade in ("A", "B", "C") and not evidence:
            problems.append(f"{label}: grade {grade} claims evidence — the "
                            "trail may not be empty (only D may stand bare)")
        for j, item in enumerate(evidence):
            if not isinstance(item, dict) or not isinstance(
                    item.get("source"), str) or not item.get("source", "").strip():
                problems.append(f"{label}.evidence[{j}] needs a source string")
                continue
            unknown = set(item) - set(_EVIDENCE_KEYS)
            if unknown:
                problems.append(f"{label}.evidence[{j}] has unknown "
                                f"field(s): {', '.join(sorted(unknown))}")
    if "recommendation" in finding:
        rec = finding["recommendation"]
        if not isinstance(rec, dict) or not isinstance(
                rec.get("action"), str) or not rec.get("action", "").strip():
            problems.append(f"{label}.recommendation needs an action string")
        elif set(rec) - set(_RECOMMENDATION_KEYS):
            problems.append(f"{label}.recommendation has unknown field(s): "
                            f"{', '.join(sorted(set(rec) - set(_RECOMMENDATION_KEYS)))}")
    return problems


def validate_findings(findings: object) -> list[dict]:
    if not isinstance(findings, list):
        raise ResearchError("findings must be a JSON array")
    problems: list[str] = []
    for index, finding in enumerate(findings):
        problems.extend(_validate_finding(index, finding))
    if problems:
        raise ResearchError("; ".join(problems))
    return findings


def render_findings_md(findings: list[dict], charter: dict | None = None) -> str:
    """The human window on a run's findings — graded, evidence attached."""
    lines = ["# Research findings", ""]
    if charter:
        lines += [f"Charter topics: {', '.join(charter.get('topics', []))}",
                  f"Sources: {', '.join(charter.get('sources', []))}", ""]
    lines += ["Evidence grades: "
              + "; ".join(f"**{g}** = {d}" for g, d in GRADES.items()), ""]
    if not findings:
        lines += ["_No findings this run._", ""]
    for grade in GRADES:
        graded = [f for f in findings if f["grade"] == grade]
        if not graded:
            continue
        lines.append(f"## Grade {grade} — {GRADES[grade]}")
        lines.append("")
        for finding in graded:
            lines.append(f"### {finding['title']}")
            lines.append("")
            lines.append(finding["summary"])
            lines.append("")
            for item in finding["evidence"]:
                pointer = item["source"]
                if item.get("url"):
                    pointer += f" — {item['url']}"
                if item.get("note"):
                    pointer += f" ({item['note']})"
                lines.append(f"- evidence: {pointer}")
            if finding.get("recommendation"):
                rec = finding["recommendation"]
                target = f" → {rec['target']}" if rec.get("target") else ""
                lines.append(f"- **recommendation:** {rec['action']}{target}")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def record(project_root: Path, run_id: str, findings: list[dict],
           emit: bool = True) -> dict:
    """Land a run's findings in its workspace and emit observations for the
    recommendation-carrying ones. The run must exist and still be open."""
    findings = validate_findings(findings)
    key = joblib.project_key(Path(project_root))
    run = joblib.read_run(key, run_id)
    if run["state"] not in joblib.RESUMABLE_STATES:
        raise ResearchError(f"run '{run_id}' already ended {run['state']}")
    charter = ((run.get("job") or {}).get("target") or {}) \
        .get("payload", {}).get("charter")
    joblib.write_workspace_json(key, run_id, "findings.json",
                                {"findings": findings})
    md_path = joblib.workspace_path(key, run_id) / "findings.md"
    md_path.write_text(render_findings_md(findings, charter),
                       encoding="utf-8", newline="\n")
    observations = 0
    for finding in findings:
        if not finding.get("recommendation"):
            continue
        payload = {
            "source": "research-job",
            "description": f"{finding['title']} — "
                           f"{finding['recommendation']['action']}",
        }
        if finding["evidence"]:
            first = finding["evidence"][0]
            payload["evidence"] = first.get("url") or first["source"]
        if emit:
            ledger.emit("observation", payload, project=key)
        observations += 1
    return {
        "run_id": run_id,
        "findings": len(findings),
        "graded": {g: sum(1 for f in findings if f["grade"] == g)
                   for g in GRADES},
        "observations_emitted": observations if emit else 0,
        "artifacts": ["findings.json", "findings.md"],
    }


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="tk-studio research core (charters + evidence-graded "
                    "findings)")
    sub = parser.add_subparsers(dest="command", required=True)

    cha = sub.add_parser("charter", help="validate + normalize a charter")
    cha.add_argument("--charter", required=True, help="JSON object")

    rec = sub.add_parser("record", help="land findings, emit observations")
    rec.add_argument("--directory", required=True, help="project root")
    rec.add_argument("--run-id", required=True)
    rec.add_argument("--findings", help="JSON array inline")
    rec.add_argument("--findings-file", help="path to a JSON array")
    rec.add_argument("--no-emit", action="store_true",
                     help="land artifacts without ledger emission (debugging)")

    args = parser.parse_args(argv)
    try:
        if args.command == "charter":
            try:
                charter = json.loads(args.charter)
            except json.JSONDecodeError as exc:
                raise ResearchError(f"charter is not valid JSON: {exc}")
            result = {"charter": validate_charter(charter)}
        else:
            if bool(args.findings) == bool(args.findings_file):
                raise ResearchError("record takes exactly one of --findings "
                                    "or --findings-file")
            raw = (args.findings if args.findings
                   else Path(args.findings_file).read_text(encoding="utf-8"))
            try:
                findings = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ResearchError(f"findings are not valid JSON: {exc}")
            result = record(Path(args.directory), args.run_id, findings,
                            emit=not args.no_emit)
    except (ResearchError, joblib.JobError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
