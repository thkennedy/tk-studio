"""tk-studio-report — record a human-authored defect report as a `report` event (FR28).

Thin wrapper over the ledger library so callers pass plain flags instead of
hand-escaped JSON (the payload is assembled and validated here).

Usage:
  uv run report.py --description TEXT [--surface SKILL] [--project KEY]
                   [--skill NAME] [--mode attended|headless]

Output: one JSON object; exit 0 ok, 2 validation error.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

import ledger  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--description", required=True,
                        help="what the skill did wrong, in the operator's words")
    parser.add_argument("--surface", help="suspected skill/surface")
    parser.add_argument("--project", help="project key")
    parser.add_argument("--skill", help="skill that was running when observed")
    parser.add_argument("--mode", choices=["attended", "headless"],
                        help="session mode when observed")
    args = parser.parse_args(argv)

    payload: dict = {"description": args.description}
    if args.surface:
        payload["surface"] = args.surface
    context = {k: v for k, v in {
        "project": args.project, "skill": args.skill, "session_mode": args.mode,
    }.items() if v}
    if context:
        payload["context"] = context

    try:
        envelope = ledger.emit("report", payload, project=args.project)
    except ledger.LedgerError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    print(json.dumps({"ok": True, "ledger": str(ledger.ledger_path()),
                      "envelope": envelope}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
