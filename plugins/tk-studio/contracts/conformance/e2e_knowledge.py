"""The ST-9.4 e2e drive — the run the source lifecycle never had.

The source lifecycle (first driver, ClaudeOS) shipped its queue and routing
halves design-verified but execution-unproven: no reconciliation queue ever
materialized on disk (planning pass §1). This drive is the studio's answer
— one sandboxed run, driven end to end through the shipped CLIs exactly as
a contract driver would:

    run-init → seed lands → boundary handoff carries deltas → the wrapper's
    finish closes the run → the queue holds the corrections, deduped → the
    routing doc renders beside it → the promotion gate opens (ST-9.5:
    check sees the routing doc and the unpromoted corrections; a dry-run
    draft walks every data gate clean)

Every step is asserted; the drive prints one JSON object {ok, steps[]} and
exits nonzero on any failed assertion, so a manifest entry with
expect "ok" proves the chain, not just its parseability.

Invoked by the conformance runner (manifest: tk-studio-job) in a throwaway
sandbox with an isolated TK_STUDIO_HOME. Stdlib-only (NFR9); never prompts
(AD-11).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]

SEED = """\
---
tier: seed
status: provisional
authority: mission-scoped-supersedes-canonical
project: {project}
generated: 2026-08-07
run_id: {run_id}
spine_ref: projects/{project}/knowledge/spine.md
inherits: [SPINE-A1]
---

- [SEED-{run_id}-A1] the e2e drive's one run-local assumption
- [SEED-{run_id}-A2] a second anchor, left uncorrected
"""


def _cli(*argv: str) -> dict:
    """One shipped CLI, driven as a contract driver would (JSON on stdout)."""
    script = PLUGIN_ROOT / argv[0]
    proc = subprocess.run(
        [sys.executable, str(script), *argv[1:]],
        stdin=subprocess.DEVNULL, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=60,
        cwd=str(PLUGIN_ROOT))
    stdout = proc.stdout.strip()
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"ok": False,
                "error": f"{argv[0]} produced no JSON "
                         f"(exit {proc.returncode}): {stdout[:200]!r}"}


def run(directory: str) -> dict:
    steps: list[dict] = []

    def step(name: str, ok: bool, detail: str = "") -> bool:
        steps.append({"step": name, "ok": ok,
                      **({"detail": detail} if detail else {})})
        return ok

    # 1 — mint the run (the timestamped id threads every later step)
    minted = _cli("lib/job.py", "run-init", "--directory", directory,
                  "--id", "maintenance-conformance")
    if not step("run-init", minted.get("ok") is True, minted.get("error", "")):
        return {"ok": False, "steps": steps}
    run_id = minted["run"]["run_id"]
    project = minted["project"]

    # 2 — the seed lands in the run workspace (research surface, ST-9.3)
    seeded = _cli("lib/research.py", "seed", "--directory", directory,
                  "--run-id", run_id,
                  "--text", SEED.format(project=project, run_id=run_id))
    if not step("seed", seeded.get("ok") is True, seeded.get("error", "")):
        return {"ok": False, "steps": steps}

    # 3 — a boundary handoff carries two deltas (run-local + spine tier);
    #     boundary capture makes them durable immediately (ST-9.4)
    deltas = [
        {"anchor": f"SEED-{run_id}-A1", "verdict": "WRONG",
         "reality": "the assumption did not survive the drive",
         "evidence": "contracts/conformance/e2e_knowledge.py",
         "tier": "run-local"},
        {"anchor": "SPINE-A1", "verdict": "STALE",
         "reality": "the inherited spine claim moved during the run",
         "evidence": "contracts/conformance/e2e_knowledge.py",
         "tier": "spine"},
    ]
    handed = _cli("lib/session.py", "handoff", "--directory", directory,
                  "--run-id", run_id, "--boundary", "phase",
                  "--name", "e2e drive", "--done", "deltas emitted",
                  "--next", "wrapper closes the run",
                  "--delta", json.dumps(deltas[0]),
                  "--delta", json.dumps(deltas[1]))
    boundary_captured = (handed.get("capture") or {}).get("captured")
    if not step("handoff+boundary-capture", handed.get("ok") is True
                and boundary_captured == 2,
                f"captured={boundary_captured}"
                if handed.get("ok") else handed.get("error", "")):
        return {"ok": False, "steps": steps}

    # 4 — the wrapper's finish closes the run; its capture hook re-runs and
    #     the dedupe key holds (nothing new, both duplicates)
    ended = _cli("lib/jobrun.py", "finish", "--directory", directory,
                 "--run-id", run_id, "--state", "complete")
    finish_capture = ended.get("capture") or {}
    if not step("finish+dedupe",
                ended.get("ok") is True and ended.get("state") == "complete"
                and finish_capture.get("captured") == 0
                and finish_capture.get("duplicates") == 2,
                f"capture={finish_capture}" if ended.get("ok")
                else ended.get("error", "")):
        return {"ok": False, "steps": steps}

    # 5 — the queue materialized (the artifact the source never had)
    captured = _cli("lib/reconcile.py", "capture", "--directory", directory,
                    "--run-id", run_id)
    if not step("queue-materialized", captured.get("ok") is True
                and captured.get("duplicates") == 2
                and captured.get("captured") == 0,
                f"duplicates={captured.get('duplicates')}"):
        return {"ok": False, "steps": steps}

    # 6 — the routing doc renders beside the queue, both tiers present
    routed = _cli("lib/reconcile.py", "route", "--directory", directory)
    doc_ok = False
    detail = routed.get("error", "")
    if routed.get("ok") is True and routed.get("rendered") is True:
        doc_path = Path(routed["path"])
        doc = doc_path.read_text(encoding="utf-8") if doc_path.is_file() else ""
        doc_ok = (routed.get("entries") == 2
                  and doc_path.parent == Path(captured["queue"]).parent
                  and "[SPINE-A1]" in doc
                  and f"[SEED-{run_id}-A1]" in doc
                  and "applies nothing" in doc)
        detail = f"entries={routed.get('entries')}, doc={doc_path.name}"
    if not step("routing-doc", doc_ok, detail):
        return {"ok": False, "steps": steps}

    # 7 — the promotion gate sees the routing doc and the corrections
    #     (ST-9.5: check is read-only; nothing promoted yet)
    checked = _cli("lib/promote.py", "check", "--directory", directory)
    corrections = checked.get("corrections") or {}
    if not step("promotion-check", checked.get("ok") is True
                and (checked.get("routing") or {}).get("present") is True
                and corrections.get("unpromoted") == 2,
                f"unpromoted={corrections.get('unpromoted')}"
                if checked.get("ok") else checked.get("error", "")):
        return {"ok": False, "steps": steps}

    # 8 — a dry-run draft walks every data gate clean (routing doc, queue,
    #     promoted baseline, sanitization) — the gate is open; the git
    #     motion itself is the lib suite's job (the sandbox is not a repo)
    drafted = _cli("lib/promote.py", "draft", "--directory", directory,
                   "--dry-run")
    if not step("promotion-dry-run", drafted.get("ok") is True
                and drafted.get("result_state") == "dry-run"
                and drafted.get("corrections") == 2
                and drafted.get("sanitization") == "clean",
                f"corrections={drafted.get('corrections')}"
                if drafted.get("ok") else drafted.get("error", "")):
        return {"ok": False, "steps": steps}

    return {"ok": True, "run_id": run_id, "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="ST-9.4 e2e drive: run emits deltas -> queue "
                    "materializes -> routing doc renders")
    parser.add_argument("--directory", required=True, help="sandbox project")
    args = parser.parse_args(argv)
    try:
        result = run(args.directory)
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": str(exc)},
                         ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
