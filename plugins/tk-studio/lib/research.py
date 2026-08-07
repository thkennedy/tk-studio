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
  seed      validates an agent-authored per-run seed (knowledge.schema.json
            shape, checked via lib/knowledge.py) and lands it as seed.md in
            the run workspace — the anchor surface findings and handoff
            deltas cite. Inherited spine anchors are verified against the
            project spine when one exists; a missing spine is reported,
            never a gate.
  spine     validates and lands the project research spine at project scope:
            ~/.tk-studio/projects/<key>/knowledge/spine.md in the per-user
            store (D2, AD-3 — provisional knowledge never lands on the
            project VCS). Spine authoring is a chartered research-run
            flavor: the verb requires an open run, so the charter gate and
            the job's budget guards cover the authoring pass. Anchor ids
            are append-only — a re-authored spine that drops or renumbers
            an existing anchor refuses.

Anchors (ST-9.3, Epic 9): findings optionally cite an `anchor` — a bare
anchor id from the run's seed (defined + inherited set, same rule as
handoff deltas). Dangling citations are named rejections, never silently
dropped; findings without anchors land regardless of seed state (aid, not
gate — only the invalid artifact refuses, the run is untouched).

Evidence grades (legacy-council discipline — ungraded findings refuse):
  A  primary source, verified directly
  B  multiple independent sources agree
  C  single credible source
  D  inference or speculation — needs verification

CLI:
  uv run research.py charter --charter JSON
  uv run research.py record --directory DIR --run-id RID
                            (--findings JSON | --findings-file PATH)
                            [--no-emit]
  uv run research.py seed   --directory DIR --run-id RID
                            (--text TEXT | --file PATH)
  uv run research.py spine  --directory DIR --run-id RID
                            (--text TEXT | --file PATH)

Exit codes: 0 ok; 2 invalid charter/findings/artifact or unknown run;
1 unexpected failure. Env: TK_STUDIO_HOME overrides the store root (tests).
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import job as joblib
import knowledge
import ledger
import store as storelib

GRADES = {
    "A": "primary source, verified directly",
    "B": "multiple independent sources agree",
    "C": "single credible source",
    "D": "inference or speculation — needs verification",
}

_CHARTER_KEYS = ("topics", "sources", "max_findings", "notes")
_FINDING_KEYS = ("title", "summary", "grade", "evidence", "recommendation",
                 "anchor")
_EVIDENCE_KEYS = ("source", "url", "note")
_RECOMMENDATION_KEYS = ("action", "target")

SEED_NAME = "seed.md"


class ResearchError(Exception):
    """Invalid charter, findings, or knowledge artifact; message is safe to
    surface."""


def spine_path(key: str) -> Path:
    """The project research spine — per-user store, project scope (D2)."""
    return storelib.store_root() / "projects" / key / "knowledge" / "spine.md"


def spine_ref_value(key: str) -> str:
    """The store-relative spine path a seed's `spine_ref` must carry."""
    return f"projects/{key}/knowledge/spine.md"


def _open_run(project_root: Path, run_id: str) -> tuple[str, dict]:
    key = joblib.project_key(Path(project_root))
    run = joblib.read_run(key, run_id)
    if run["state"] not in joblib.RESUMABLE_STATES:
        raise ResearchError(f"run '{run_id}' already ended {run['state']}")
    return key, run


def _read_spine(key: str) -> tuple[str | None, dict]:
    """(text, report) for the project spine. Aid, not gate: missing or
    unreadable is reported to the caller, never raised."""
    path = spine_path(key)
    if not path.is_file():
        return None, {"present": False, "path": str(path),
                      "note": "no project spine — author one via a chartered "
                              "research run (research.py spine)"}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return None, {"present": True, "path": str(path),
                      "note": f"spine unreadable: {exc}"}
    verdict = knowledge.validate_seed(text)
    report = {"present": True, "path": str(path),
              "anchors": knowledge.extract_anchors(text),
              "valid": verdict["valid"]}
    if not verdict["valid"]:
        report["problems"] = verdict["errors"]
    return text, report


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
    if "anchor" in finding and not knowledge.is_anchor_id(finding["anchor"]):
        problems.append(f"{label}.anchor must be a bare anchor id "
                        "(SPINE-A<n> or SEED-<run-id>-A<n>)")
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
            if finding.get("anchor"):
                lines.append(f"- anchor: `{finding['anchor']}`")
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


def _check_anchored(findings: list[dict], workspace: Path) -> int:
    """Anchored findings must cite the run seed's available set (defined +
    inherited) — the same rule handoff deltas obey. Dangling citations are
    named rejections; unanchored findings are untouched by seed state."""
    anchored = [f for f in findings if f.get("anchor")]
    if not anchored:
        return 0
    seed_path = workspace / SEED_NAME
    seed_text = ""
    if seed_path.is_file():
        try:
            seed_text = seed_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            # A UTF-16/ANSI-re-encoded seed (the PowerShell default trap)
            # must refuse named, never die with a traceback (AD-11).
            raise ResearchError(f"{SEED_NAME} unreadable: {exc}") from exc
    available = set(knowledge.parse_seed(seed_text)["available"]) \
        if seed_text else set()
    dangling = sorted({f["anchor"] for f in anchored
                       if f["anchor"] not in available})
    if dangling:
        context = ("" if seed_path.is_file() else
                   f" [workspace has no {SEED_NAME} — no anchors exist to "
                   "cite; land one via research.py seed first]")
        raise ResearchError(
            f"anchored findings rejected, never silently dropped{context}: "
            "dangling anchor(s) " + ", ".join(dangling))
    return len(anchored)


def record(project_root: Path, run_id: str, findings: list[dict],
           emit: bool = True) -> dict:
    """Land a run's findings in its workspace and emit observations for the
    recommendation-carrying ones. The run must exist and still be open."""
    findings = validate_findings(findings)
    key, run = _open_run(project_root, run_id)
    anchored = _check_anchored(findings,
                               joblib.workspace_path(key, run_id))
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
    _, spine_report = _read_spine(key)
    return {
        "run_id": run_id,
        "findings": len(findings),
        "graded": {g: sum(1 for f in findings if f["grade"] == g)
                   for g in GRADES},
        "anchored": anchored,
        "observations_emitted": observations if emit else 0,
        "artifacts": ["findings.json", "findings.md"],
        "spine": spine_report,
    }


# ----------------------------------------------------------- seed / spine

def emit_seed(project_root: Path, run_id: str, text: str) -> dict:
    """Validate an agent-authored per-run seed and land it as seed.md in the
    run workspace. Intrinsic artifact validity refuses before any run or
    store read; cross-checks (run identity, spine inheritance) accumulate
    after. A missing project spine is reported, never a gate."""
    verdict = knowledge.validate_seed(text)
    seed = knowledge.parse_seed(text)
    problems = list(verdict["errors"])
    if seed["tier"] == "spine":
        problems.append("run workspaces carry tier: seed artifacts — the "
                        "project spine lands via research.py spine")
    for inherited in seed["inherits"]:
        if not knowledge.is_anchor_id(inherited):
            problems.append(f"inherits entry '{inherited}' is not an "
                            "anchor id")
    if problems:
        raise ResearchError("seed rejected, never silently landed: "
                            + "; ".join(problems))

    key, _ = _open_run(project_root, run_id)
    fm = seed["frontmatter"]
    if fm.get("run_id") != run_id:
        problems.append(f"seed run_id '{fm.get('run_id')}' does not match "
                        f"run '{run_id}'")
    expected_ref = spine_ref_value(key)
    if fm.get("spine_ref") != expected_ref:
        problems.append("spine_ref must be the store-relative project spine "
                        f"path '{expected_ref}'")
    if fm.get("project") != key:
        problems.append(f"seed project '{fm.get('project')}' does not match "
                        f"project '{key}'")
    own_prefix = f"SEED-{run_id}-A"
    for anchor in seed["anchors"]:
        if anchor.startswith("SEED-") and not anchor.startswith(own_prefix):
            problems.append(f"seed anchor '{anchor}' must carry the owning "
                            f"run id ('{own_prefix}<n>') — anchor ids join "
                            "across runs, collisions poison the join")
    spine_text, spine_report = _read_spine(key)
    if seed["inherits"] and spine_text is not None:
        spine_anchors = set(knowledge.extract_anchors(spine_text))
        dangling = [a for a in seed["inherits"] if a not in spine_anchors]
        if dangling:
            problems.append("inherited anchor(s) not defined by the project "
                            "spine: " + ", ".join(dangling))
    path = joblib.workspace_path(key, run_id) / SEED_NAME
    if path.is_file():
        try:
            previous = knowledge.parse_seed(
                path.read_text(encoding="utf-8"))["available"]
        except (OSError, UnicodeDecodeError) as exc:
            raise ResearchError(
                f"existing {SEED_NAME} unreadable: {exc} — refusing to "
                "overwrite what cannot be checked (anchor ids are "
                "append-only)") from exc
        current = set(seed["available"])
        dropped = [a for a in previous if a not in current]
        if dropped:
            problems.append("existing seed anchor(s) missing from the new "
                            "text (anchor ids are append-only, never "
                            "renumbered — landed findings cite them): "
                            + ", ".join(dropped))
    if problems:
        raise ResearchError("seed rejected, never silently landed: "
                            + "; ".join(problems))

    path.write_text(text, encoding="utf-8", newline="\n")
    return {
        "run_id": run_id,
        "path": str(path),
        "anchors": seed["anchors"],
        "inherits": seed["inherits"],
        "inherits_verified": spine_text is not None,
        "spine": spine_report,
    }


def emit_spine(project_root: Path, run_id: str, text: str) -> dict:
    """Validate and land the project research spine at project scope in the
    per-user store (D2). Spine authoring is a chartered research-run flavor:
    an open run is required, so the charter gate and the job's budget guards
    cover the pass. Anchor ids are append-only — a new text that drops an
    existing anchor refuses (queued deltas cite identity; dropping an id
    strands them)."""
    verdict = knowledge.validate_seed(text)
    parsed = knowledge.parse_seed(text)
    problems = list(verdict["errors"])
    if parsed["tier"] == "seed":
        problems.append("the project spine carries tier: spine — per-run "
                        "seeds land via research.py seed")
    if problems:
        raise ResearchError("spine rejected, never silently landed: "
                            + "; ".join(problems))

    key, _ = _open_run(project_root, run_id)
    if parsed["frontmatter"].get("project") != key:
        problems.append(f"spine project "
                        f"'{parsed['frontmatter'].get('project')}' does not "
                        f"match project '{key}'")
    path = spine_path(key)
    previous: list[str] = []
    if path.is_file():
        try:
            previous = knowledge.extract_anchors(
                path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError) as exc:
            raise ResearchError(
                f"existing spine unreadable: {exc} — refusing to overwrite "
                "what cannot be checked (anchor ids are append-only)"
            ) from exc
        current = set(parsed["anchors"])
        dropped = [a for a in previous if a not in current]
        if dropped:
            problems.append("existing spine anchor(s) missing from the new "
                            "text (anchor ids are append-only, never "
                            "renumbered): " + ", ".join(dropped))
    if problems:
        raise ResearchError("spine rejected, never silently landed: "
                            + "; ".join(problems))

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return {
        "run_id": run_id,
        "path": str(path),
        "anchors": parsed["anchors"],
        "appended": [a for a in parsed["anchors"] if a not in set(previous)],
        "replaced_existing": bool(previous),
    }


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
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

    for verb, description in (
            ("seed", "validate + land seed.md in the run workspace"),
            ("spine", "validate + land the project spine (per-user store)")):
        art = sub.add_parser(verb, help=description)
        art.add_argument("--directory", required=True, help="project root")
        art.add_argument("--run-id", required=True)
        art.add_argument("--text", help="artifact text inline")
        art.add_argument("--file", help="path to the artifact text")

    args = parser.parse_args(argv)
    try:
        if args.command == "charter":
            try:
                charter = json.loads(args.charter)
            except json.JSONDecodeError as exc:
                raise ResearchError(f"charter is not valid JSON: {exc}")
            result = {"charter": validate_charter(charter)}
        elif args.command == "record":
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
        else:
            if bool(args.text) == bool(args.file):
                raise ResearchError(f"{args.command} takes exactly one of "
                                    "--text or --file")
            text = (args.text if args.text
                    else Path(args.file).read_text(encoding="utf-8"))
            handler = emit_seed if args.command == "seed" else emit_spine
            result = handler(Path(args.directory), args.run_id, text)
    except (ResearchError, joblib.JobError, OSError,
            UnicodeDecodeError) as exc:
        # UnicodeDecodeError: a re-encoded --file/--findings-file (the
        # PowerShell default trap) refuses named, never a traceback (AD-11).
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
