"""tk-studio evolve loop, v1 half — observe and log, nothing more (ST-4.4, AD-8).

Records an observation (repeated manual toil, a retrospective signal, a
research-job finding) as an `observation` event in the measurement ledger,
through the one ledger write path (AD-12). The event carries a structured
description: source class, description, optional evidence pointer; the
project key rides the envelope.

The v1 boundary is hard: recording an observation triggers nothing — no
proposal drafting, no skill scaffolding, no follow-on write anywhere. The
future evolve loop reads the accumulated events; this module only feeds it.

CLI:
  uv run observe.py record --source retrospective|repeated-manual-work|research-job|other
                           --description TEXT [--evidence TEXT] [--project KEY]

Exit codes: 0 ok; 2 validation error. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import sys

import ledger

SOURCES = ("retrospective", "repeated-manual-work", "research-job", "other")


def record_observation(source: str, description: str,
                       evidence: str | None = None,
                       project: str | None = None) -> dict:
    """Emit one observation event. Returns the sanitized envelope written."""
    if source not in SOURCES:
        raise ledger.LedgerError(
            f"source must be one of {', '.join(SOURCES)}, got '{source}'")
    if not description.strip():
        raise ledger.LedgerError("an observation needs a non-empty description")
    payload: dict = {"source": source, "description": description.strip()}
    if evidence:
        payload["evidence"] = evidence
    return ledger.emit("observation", payload, project=project)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="tk-studio observe-and-log")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("record", help="record one observation event")
    cmd.add_argument("--source", required=True, choices=SOURCES)
    cmd.add_argument("--description", required=True,
                     help="the observed toil/signal, concretely")
    cmd.add_argument("--evidence",
                     help="pointer to the artifact/session where it was observed")
    cmd.add_argument("--project", help="project key (envelope field)")
    args = parser.parse_args(argv)

    try:
        envelope = record_observation(args.source, args.description,
                                      evidence=args.evidence,
                                      project=args.project)
    except ledger.LedgerError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    print(json.dumps({"ok": True, "ledger": str(ledger.ledger_path()),
                      "envelope": envelope}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
