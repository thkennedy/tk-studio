#!/usr/bin/env python3
"""tk-studio playable judge — the deterministic core of `tk-studio-playable-judge`
(Story 34.3).

The host leg's third step (after a green engine gate) runs 34.2's
`playable.py run`, copies its media into the worktree's ignored
`.bmad-loop/runs/<engine>/playable/`, and drives a `claude -p` judge session
on the project's sandbox tier. That session reads only `report.json` and the
frames under the payload's `media` folder (never the code or the spec) and
uses this core twice:

  uv run playable_judge.py prepare --media DIR
      validate `<DIR>/report.json` (34.2's Settled shape 2 keys, `verdict`
      pass or fail) and that every `frames[].file` exists under DIR; print
      the frame list, the moments and the fixed rubric.
  uv run playable_judge.py verdict --media DIR --answer FILE
      parse the model's answer
      `{"verdict": "pass"|"fail", "findings": [{"frame": "frames/<name>.png",
      "rubric": "<id>", "note": "<one line>"}]}` against the same report and
      write `<DIR>/judge.json` atomically (the file the host leg reads back).
  uv run playable_judge.py rubric
      Story 35.3: print the fixed rubric, `{ids: [...], rubric: [{id, line}]}`,
      in a `complete` status block: the one home of the ids, which the host
      leg reads to validate a finding (it keeps no copy of its own).

Rubric ids are fixed (RUBRIC). Refusals end `blocked` with exit 2 and name
the refusal: `no report.json`, `malformed report: <field>`, `no frames`;
for `verdict` also `unknown rubric id: <id>`, `frame not in frames[]:
<frame>`, `fail with no findings`, `malformed answer: <field>`. Every result
ends in the AD-11 status block with `intent: "tk-studio-playable-judge"`.

Exit codes: 0 answered; 2 refusal or bad invocation.
Stdlib-only (NFR9). Never runs a model, never reads code or the spec.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import _core
from _core import _write_atomic

INTENT = "tk-studio-playable-judge"
BLOCK_KEYS = _core.BLOCK_KEYS

REPORT = "report.json"
JUDGE = "judge.json"
VERDICTS = ("pass", "fail")

# 34.2's `report.json` keys (Settled shape 2): the harness writes these.
REPORT_KEYS = ("schema", "verdict", "failed", "seed", "ticks", "ticks_run",
               "capture_every", "mode", "frames", "moments", "frame_time_ms")

# The story's five rubric lines, one fixed id each (Settled shape 3).
RUBRIC = (
    ("scene-loaded", "the scene loaded"),
    ("player-visible", "the player is visible and framed"),
    ("no-magenta-or-error-overlay",
     "no missing-texture magenta and no error overlay"),
    ("hud-reads", "the HUD reads"),
    ("moments-shown",
     "the scenario's named moments appear in the frames they name"),
)
RUBRIC_IDS = tuple(rid for rid, _ in RUBRIC)


class Refusal(Exception):
    """A named refusal: the run ends `blocked`, exit 2."""


def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    return _core.with_block(result, status, artifacts, reason, intent=INTENT)


def _inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


# ------------------------------------------------------------------ report

def load_report(media: Path) -> dict:
    """``<media>/report.json`` validated, or a named Refusal: `no report.json`,
    `malformed report: <field>`, `no frames`."""
    path = media / REPORT
    if not path.is_file():
        raise Refusal(f"no {REPORT}")
    try:
        report = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Refusal(f"malformed report: {REPORT} is not JSON ({exc})") from None
    if not isinstance(report, dict):
        raise Refusal(f"malformed report: {REPORT} is not a JSON object")
    for key in REPORT_KEYS:
        if key not in report:
            raise Refusal(f"malformed report: {key}")
    if report["verdict"] not in VERDICTS:
        raise Refusal("malformed report: verdict")
    frames = report["frames"]
    if not isinstance(frames, list):
        raise Refusal("malformed report: frames")
    if not frames:
        raise Refusal("no frames")
    root = media.resolve()
    for i, item in enumerate(frames):
        name = item.get("file") if isinstance(item, dict) else None
        if not isinstance(name, str) or not name:
            raise Refusal(f"malformed report: frames[{i}].file")
        target = (root / name).resolve()
        if not _inside(target, root) or not target.is_file():
            raise Refusal(f"no frames: {name} does not exist under the media folder")
    moments = report["moments"]
    if not isinstance(moments, list):
        raise Refusal("malformed report: moments")
    for i, m in enumerate(moments):
        if not isinstance(m, dict) or not isinstance(m.get("name"), str):
            raise Refusal(f"malformed report: moments[{i}]")
    return report


def frame_files(report: dict) -> list[str]:
    return [item["file"] for item in report["frames"]]


# ------------------------------------------------------------------ answer

def parse_answer(answer: object, report: dict) -> dict:
    """The model's answer, validated against the report, as
    ``{verdict, findings}``; or a named Refusal."""
    if not isinstance(answer, dict):
        raise Refusal("malformed answer: not a JSON object")
    verdict = answer.get("verdict")
    if verdict not in VERDICTS:
        raise Refusal("malformed answer: verdict")
    findings = answer.get("findings", [])
    if not isinstance(findings, list):
        raise Refusal("malformed answer: findings")
    files = set(frame_files(report))
    out: list[dict] = []
    for i, f in enumerate(findings):
        if not isinstance(f, dict):
            raise Refusal(f"malformed answer: findings[{i}]")
        frame, rubric, note = f.get("frame"), f.get("rubric"), f.get("note")
        if not isinstance(frame, str) or not frame:
            raise Refusal(f"malformed answer: findings[{i}].frame")
        if not isinstance(rubric, str) or not rubric:
            raise Refusal(f"malformed answer: findings[{i}].rubric")
        if note is not None and not isinstance(note, str):
            raise Refusal(f"malformed answer: findings[{i}].note")
        if rubric not in RUBRIC_IDS:
            raise Refusal(f"unknown rubric id: {rubric}")
        if frame not in files:
            raise Refusal(f"frame not in frames[]: {frame}")
        finding = {"frame": frame, "rubric": rubric}
        if note is not None:
            finding["note"] = " ".join(note.split())[:300]
        out.append(finding)
    if verdict == "fail" and not out:
        raise Refusal("fail with no findings")
    return {"verdict": verdict, "findings": out}


# ------------------------------------------------------------------- verbs

def prepare(media: str) -> tuple[dict, int]:
    try:
        folder = Path(media)
        report = load_report(folder)
    except Refusal as exc:
        return with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)), 2
    result = {
        "ok": True, "media": str(media), "report_verdict": report["verdict"],
        "failed": report.get("failed"), "frames": report["frames"],
        "moments": report["moments"],
        "rubric": [{"id": rid, "line": line} for rid, line in RUBRIC],
        "answer_shape": {"verdict": "pass | fail",
                         "findings": [{"frame": "<a frames[].file>",
                                       "rubric": "<a rubric id>",
                                       "note": "<one line>"}]},
    }
    return with_block(result, "complete", [], None), 0


def rubric() -> tuple[dict, int]:
    """Story 35.3: the fixed rubric, ids first, in a `complete` status block."""
    result = {"ok": True, "ids": list(RUBRIC_IDS),
              "rubric": [{"id": rid, "line": line} for rid, line in RUBRIC]}
    return with_block(result, "complete", [], None), 0


def verdict(media: str, answer: str) -> tuple[dict, int]:
    try:
        folder = Path(media)
        report = load_report(folder)
        try:
            raw = json.loads(Path(answer).read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise Refusal(f"malformed answer: {exc}") from None
        parsed = parse_answer(raw, report)
        judged = {"schema": 1, **parsed, "rubric": list(RUBRIC_IDS),
                  "frames": frame_files(report),
                  "report_verdict": report["verdict"]}
        try:
            _write_atomic(folder / JUDGE, (json.dumps(judged, indent=2, ensure_ascii=False)
                                           + "\n").encode("utf-8"))
        except OSError as exc:
            raise Refusal(f"{JUDGE} not written: {exc}") from None
    except Refusal as exc:
        return with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)), 2
    result = {"ok": True, "verdict": parsed["verdict"],
              "findings": parsed["findings"], "judge": str(folder / JUDGE)}
    return with_block(result, "complete", [JUDGE], None), 0


# --------------------------------------------------------------------- cli

class _Parser(argparse.ArgumentParser):
    """A bad invocation is a refusal with a status block, never a usage
    dump alone."""

    def error(self, message: str):  # noqa: D401 - argparse hook
        raise Refusal(f"bad invocation: {message}")


def _emit(result: dict) -> None:
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = _Parser(description="tk-studio playable judge — the screenshot rubric's core")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    p = sub.add_parser("prepare", help="validate report.json and the frames; print the rubric")
    p.add_argument("--media", required=True, help="the folder holding report.json and frames/")
    v = sub.add_parser("verdict", help="parse the answer; write judge.json")
    v.add_argument("--media", required=True, help="the folder holding report.json and frames/")
    v.add_argument("--answer", required=True, help="the answer JSON file")
    sub.add_parser("rubric", help="print the fixed rubric ids and lines (Story 35.3)")
    try:
        args = parser.parse_args(argv)
    except Refusal as exc:
        _emit(with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)))
        return 2
    if args.command == "prepare":
        result, code = prepare(args.media)
    elif args.command == "rubric":
        result, code = rubric()
    else:
        result, code = verdict(args.media, args.answer)
    _emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
