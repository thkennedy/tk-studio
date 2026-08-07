---
name: tk-studio-report
description: One-verb human defect report — "the skill did the wrong thing" — recorded as a report event in the local measurement ledger. Use when the user says "tk report", "report a defect", "that skill misbehaved", or "log a studio issue".
---

# tk-studio-report

The explicit human-authored defect verb (AD-12). Human-observed defects enter
the same measurement stream as telemetry and ride the same PR membrane toward
the issues ledger.

## Behavior

**Attended:** elaborate before recording — ask (briefly, once) for whatever is
missing from: what happened vs. what was expected, which skill/surface is
suspected, and which project it was in. Then emit:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/tk-studio-report/scripts/report.py" \
  --description "<expected vs actual, operator's words>" \
  --surface <suspected-skill> --project <key> --skill <skill-running> --mode attended
```

Confirm to the user what landed (the script echoes the sanitized envelope —
show its `description` back so they can spot over-redaction).

**Headless:** the payload arrives complete in the invocation; pass it straight
through with `--mode headless` — never prompt (AD-11). A missing
`--description` is the script's validation error → end `blocked`. End with the
status block:

```json
{"status": "complete", "intent": "tk-studio-report", "artifacts": ["~/.tk-studio/measurements/<user>-<machine>.jsonl"], "reason": null}
```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- The description is the operator's account, not your diagnosis — record what
  they said, don't fix the defect in this flow.
- Sanitization happens in the ledger library; still, never coax credentials or
  machine paths into the description.
