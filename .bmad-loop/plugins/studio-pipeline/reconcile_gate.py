"""pre_commit gate for the studio-pipeline plugin (ported verbatim from The Universe Awaits, 2026-09-28).

Reads the unit's spec frontmatter and decides whether the commit may proceed:

  reconcile_verdict: escalate            -> pause veto (the run stops for a human)
  deviation_score >= min_score, no verdict
      fail_closed = true                 -> pause veto
      fail_closed = false (default)      -> advisory line, commit proceeds
  anything else                          -> silent

Contract (bmad_loop.plugins.bus): the LAST non-empty stdout line may be a JSON
object; `{"veto": {"action": "pause", "reason": ...}}` is honoured at pre_commit
(the only veto that stage accepts). Any earlier line is advisory log text. The
hook is declared blocking=false, so a crash here can never defer the unit —
exit 0 on every path and never raise. Stdlib only: it runs under
`uv run --no-project python`, so PyYAML is not guaranteed.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ARTIFACTS = Path("_bmad-output") / "implementation-artifacts"


def _frontmatter(text: str) -> dict[str, str]:
    """Minimal `key: value` reader for the leading --- block; scalars only."""
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    out: dict[str, str] = {}
    for line in parts[1].splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip("'\"")
    return out


def _find_spec(root: Path, key: str) -> Path | None:
    direct = root / ARTIFACTS / f"spec-{key}.md"
    if direct.is_file():
        return direct
    matches = [p for p in (root / "_bmad-output" / "specs").glob(f"*/stories/{key}-*.md") if p.is_file()]
    return matches[0] if len(matches) == 1 else None


def _bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def main() -> int:
    env = os.environ
    root = Path(env.get("BMAD_LOOP_WORKTREE") or env.get("BMAD_LOOP_REPO_ROOT") or ".")
    key = env.get("BMAD_LOOP_STORY_KEY", "")
    min_score_raw = env.get("BMAD_LOOP_SETTING_MIN_SCORE", "2")
    fail_closed = _bool(env.get("BMAD_LOOP_SETTING_FAIL_CLOSED"), False)
    try:
        min_score = int(min_score_raw)
    except ValueError:
        min_score = 2

    if not key:
        print("studio-reconcile gate: no BMAD_LOOP_STORY_KEY -nothing to check")
        return 0
    spec = _find_spec(root, key)
    if spec is None:
        print(f"studio-reconcile gate: spec for {key} not found under {root} -nothing to check")
        return 0
    try:
        fm = _frontmatter(spec.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as e:
        print(f"studio-reconcile gate: could not read {spec}: {e} -nothing to check")
        return 0

    # seam-fix guard (planning session 2026-09-12, after 0-7 skipped its pre-dispatch text-fix): a `text-fix` verdict
    # whose staged script is not folded yet (newer than staged/.last-boundary) must show as SEAM-FIX lines in the spec —
    # the dev session applies the pairs at STUDIO ACTIVATION 4/4. Absent -> pause, fail closed (the story is re-driven or
    # the fix is folded by hand); a verdict already folded by a boundary (script older than the marker) is not checked.
    sup = root / "_bmad-output" / "implementation-artifacts" / "supervision"
    seam_json = sup / "seam" / f"{key}.json"
    script, marker = sup / "staged" / f"apply_seam_{key}.py", sup / "staged" / ".last-boundary"
    try:
        if (seam_json.is_file()
                and json.loads(seam_json.read_text(encoding="utf-8")).get("verdict") == "text-fix"
                and script.is_file()
                and (not marker.exists() or script.stat().st_mtime > marker.stat().st_mtime)
                and "SEAM-FIX:" not in spec.read_text(encoding="utf-8")):
            reason = (f"studio-seam: {key} has an unapplied pre-dispatch text-fix (supervision/seam/{key}.md) and the spec "
                      f"carries no SEAM-FIX line -- the dev session skipped STUDIO ACTIVATION 4/4; fold the fix or re-drive")
            print(json.dumps({"veto": {"action": "pause", "reason": reason}}))
            return 0
        print(f"studio-seam guard: {key} ok")
    except (OSError, ValueError) as e:
        print(f"studio-seam guard: skipped ({e})")

    verdict = (fm.get("reconcile_verdict") or "").lower()
    try:
        score = int(fm.get("deviation_score") or 0)
    except ValueError:
        score = 0

    if verdict == "escalate":
        reason = f"studio-reconcile: {key} deviation score {score} -verdict escalate; see the spec's Reconcile section"
        print(json.dumps({"veto": {"action": "pause", "reason": reason}}))
        return 0
    if score >= min_score and not verdict:
        if fail_closed:
            reason = f"studio-reconcile: {key} deviation score {score} >= {min_score} but no reconcile verdict was recorded"
            print(json.dumps({"veto": {"action": "pause", "reason": reason}}))
            return 0
        print(
            f"studio-reconcile gate: {key} deviation score {score} >= {min_score} with no verdict "
            f"(reconcile session missing or failed) -committing anyway (fail_closed=false)"
        )
        return 0
    print(f"studio-reconcile gate: {key} score {score}, verdict {verdict or 'none'} -ok")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never let the gate itself defer a unit
        print(f"studio-reconcile gate: internal error ignored: {e}")
        sys.exit(0)
