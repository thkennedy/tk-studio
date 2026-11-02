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

The counter bump (Story 37.1, DW-149) runs first, as this is the one seam before
the engine squashes the tree into the story commit. After a harvest (the journal's
`spec-deferrals-harvested`, or a `### DW-N:` heading at or above the counter) it
sets `next.deferred-work` in `.tk-studio/plan-counter.yaml` to the greater of the
counter and the ledger's highest + 1, and the ledger's marker line to one below that
value. It never renumbers an id, never lowers the counter and never vetoes; with no
harvest it writes and prints nothing, a bad counter included. It keeps the marker's
text from lib/dwledger.py inline, as this hook imports no plugin module.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ARTIFACTS = Path("_bmad-output") / "implementation-artifacts"
LEDGER = ARTIFACTS / "deferred-work.md"
COUNTER = Path(".tk-studio") / "plan-counter.yaml"
HARVEST_EVENT = "spec-deferrals-harvested"
MARKER = "<!-- deferred-work counter: last minted DW-{}; mint through plansync.py deferred mint -->"
MARKER_RE = re.compile(r"^<!-- deferred-work counter: last minted DW-\d+; mint through plansync\.py deferred mint -->$", re.M)
HEAD_RE = re.compile(r"^### DW-(\d+):", re.M)
ANY_ID_RE = re.compile(r"\bDW-(\d+)\b")
COUNTER_RE = re.compile(r"^([ \t]+)deferred-work:[ \t]*(.*?)[ \t]*$", re.M)
NEXT_RE = re.compile(r"^next:[ \t]*$", re.M)
TITLE_RE = re.compile(r"\A# [^\n]*(?:\n+|\Z)")


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


def _harvested(env) -> bool:
    """The run's journal holds a harvest (read only; bad lines skipped)."""
    run_dir = env.get("BMAD_LOOP_RUN_DIR")
    if not run_dir:
        return False
    try:
        lines = (Path(run_dir) / "journal.jsonl").read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return False
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("kind") == HARVEST_EVENT:
            return True
    return False


def _write(path: Path, text: str) -> None:
    tmp = path.with_name(f"{path.name}.studio-{os.getpid()}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _with_marker(text: str, last: int) -> str:
    """lib/dwledger.py with_marker, inline (pinned equal by test_stage_log)."""
    line = MARKER.format(last)
    if MARKER_RE.search(text):
        return MARKER_RE.sub(lambda _: line, text, count=1)
    title = TITLE_RE.match(text)
    at = title.end() if title else 0
    head = text[:at]
    if head and not head.endswith("\n\n"):
        head = head.rstrip("\n") + "\n\n"
    return f"{head}{line}\n\n{text[at:]}"


def bump_counter(root: Path, env) -> str | None:
    """The post-harvest bump: one advisory line, or None when nothing changed."""
    ledger, counter = root / LEDGER, root / COUNTER
    if not ledger.is_file() or not counter.is_file():
        return None
    text = ledger.read_text(encoding="utf-8")
    counted = counter.read_text(encoding="utf-8")
    found = COUNTER_RE.search(counted)
    current = None
    if found:
        current = int(found.group(2)) if found.group(2).isdigit() else 0
    bad = current is not None and current < 1
    heads = [int(n) for n in HEAD_RE.findall(text)]
    above = current is not None and not bad and bool(heads) and max(heads) >= current
    if not above and not _harvested(env):
        return None
    if bad:
        return f"studio-ledger counter: next.deferred-work is not an int >= 1 ({found.group(2)!r}); left as it is"
    target = max(current or 1, max((int(n) for n in ANY_ID_RE.findall(text)), default=0) + 1)
    if found:
        new_counted = counted[:found.start(2)] + str(target) + counted[found.end(2):]
    else:
        at = NEXT_RE.search(counted)
        if at is None:
            return "studio-ledger counter: no `next:` block in the counter; left as it is"
        new_counted = f"{counted[:at.end()]}\n  deferred-work: {target}{counted[at.end():]}"
    new_text = _with_marker(text, target - 1)
    if new_counted == counted and new_text == text:
        return None
    if new_counted != counted:
        _write(counter, new_counted)
    if new_text != text:
        _write(ledger, new_text)
    return f"studio-ledger counter: next.deferred-work = {target} (the greater of the counter and the ledger's highest + 1), in this commit"


def main() -> int:
    env = os.environ
    root = Path(env.get("BMAD_LOOP_WORKTREE") or env.get("BMAD_LOOP_REPO_ROOT") or ".")
    try:
        note = bump_counter(root, env)
        if note:
            print(note)
    except Exception as e:  # never a veto, and the gate below still runs
        print(f"studio-ledger counter: skipped ({e})")
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
