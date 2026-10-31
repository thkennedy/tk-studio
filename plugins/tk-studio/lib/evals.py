#!/usr/bin/env python3
"""tk-studio evals — the deterministic core of `tk-studio-evals` (Story 35.5,
hole 85, CAP-10).

The shipped `maintenance-evals` job type (the sandbox-tier sibling of the
host core job `maintenance-conformance`) runs this core on the sandbox tier,
where the eval child has a shell and the repository tree:

  uv run evals.py run [--cases JSON|a,b] [--runs N] [--plugin DIR]
                      [--out DIR | --directory D --run-id R]
      one `claude plugin eval <plugin> --trust-plugin --allow-tools Bash
      Write --no-publish --threshold 0 --case <c> --runs <n> --json
      <out>/<c>.json` per case (`CLAUDE_BIN` names the CLI; default
      `claude`), then `<out>/scores.json`
      `{cases: {<c>: {runs, passed, score}}, cli: "<claude --version>"}`.

`--claude-bin` (else `CLAUDE_BIN`) names a fake CLI; a `.py` one runs under
this interpreter (the conformance drive's fake is `lib/tests/test_evals.py`,
portable to Windows, where a `.py` is not spawnable).

`--threshold 0` keeps a low score from turning into exit 1; an exit 1 is
still read as a score (the JSON is read either way), never a refusal. The
output folder is `--out`, else the run workspace's `evals/` folder
(`--directory` + `--run-id`, the payload's run id; on the sandbox tier that
folder is the VM's — the host reads the scores from the status block, which
`finish` lands in the host run's run.json and its `job-run` line). Each
case's stale `<out>/<c>.json` is deleted before its CLI runs, and
`scores.json` is rewritten after every case, so a later case's failure
never loses an earlier case's score. Every result ends in the AD-11 status
block with `intent: "tk-studio-evals"`: `artifacts` lists `scores.json`, and
`reason` is `<c> <passed>/<runs>; …`.

A case that cannot be scored — `case <c>: claude plugin eval failed to run:
…`, `case <c>: no result JSON (exit <n>)`, `case <c>: not in the result
JSON`, `case <c>: unreadable run verdicts` (a run with no recognisable
verdict is never counted as a failed run) — is recorded in `scores.json` as
`{<c>: {error: <reason>}}`, the other cases still run, and the result ends
`blocked` (exit 2) with that reason in place of the case's `<passed>/<runs>`.
Refusals before any case runs end `blocked` with exit 2: `claude CLI
unavailable: …`, `no output folder`, `output folder not writable: …`,
`unknown case: <c>`, `bad invocation: …`. A `scores.json` write failure
ends `blocked` naming it, the scored cases still in the status block.

Exit codes: 0 every case scored; 2 a case unscored, a refusal or a bad
invocation.
Stdlib-only (NFR9). Imports no driver, supervisor or Hermes (AD-2).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import _core
import job as joblib

INTENT = "tk-studio-evals"
BLOCK_KEYS = _core.BLOCK_KEYS
PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCORES = "scores.json"
# The run verdict strings read as a pass or a fail; any other is unreadable.
PASS_WORDS = ("pass", "passed", "ok", "success")
FAIL_WORDS = ("fail", "failed", "failure")
# The cases the host cannot run (they need a shell and the tree; hole 85).
DEFAULT_CASES = ("tk-studio-playable-judge-verdict", "asset-ladder-generated-rung")
DEFAULT_RUNS = 3
# One case's eval: `--runs` full claude children. Bounded so the default
# cases (2 x 1500 s, plus the version probe) fit under the job's 3600 s
# wall-clock guard with margin (`maintenance-evals.json`).
CASE_TIMEOUT_S = 1500
VERSION_TIMEOUT_S = 30


class Refusal(Exception):
    """A named refusal: the run ends `blocked`, exit 2."""


def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    return _core.with_block(result, status, artifacts, reason, intent=INTENT)


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f"{path.name}.tk-studio-{os.getpid()}.tmp")
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def claude_bin(flag: str | None = None) -> str:
    return (flag or "").strip() or os.environ.get("CLAUDE_BIN", "").strip() or "claude"


def _cli_argv(cli: str) -> list[str]:
    """A `.py` CLI (a fake) runs under this interpreter."""
    return [sys.executable, cli] if cli.endswith(".py") else [cli]


def eval_argv(cli: str, plugin: Path, case: str, runs: int, out: Path) -> list[str]:
    """The one argv per case (CAP-10)."""
    return [*_cli_argv(cli), "plugin", "eval", str(plugin), "--trust-plugin",
            "--allow-tools", "Bash", "Write", "--no-publish",
            "--threshold", "0", "--case", case, "--runs", str(runs),
            "--json", str(out / f"{case}.json")]


def parse_cases(raw: str | None) -> list[str]:
    if raw is None:
        return list(DEFAULT_CASES)
    text = raw.strip()
    if text.startswith("["):
        try:
            value = json.loads(text)
        except json.JSONDecodeError as exc:
            raise Refusal(f"bad invocation: --cases is not a JSON list: {exc}")
        if not isinstance(value, list) or not all(isinstance(c, str) for c in value):
            raise Refusal("bad invocation: --cases must be a list of case names")
        cases = [c.strip() for c in value]
    else:
        cases = [c.strip() for c in text.split(",")]
    cases = [c for c in cases if c]
    if not cases:
        raise Refusal("bad invocation: --cases names no case")
    return cases


def _passed(run: object) -> bool | None:
    """One run's verdict, read defensively from the CLI's per-run entry."""
    if isinstance(run, bool):
        return run
    if not isinstance(run, dict):
        return None
    for key in ("passed", "pass", "ok", "success"):
        if isinstance(run.get(key), bool):
            return run[key]
    for key in ("verdict", "status", "result"):
        if isinstance(run.get(key), str):
            # Only a named pass or fail counts; "error", "timeout", "skipped"
            # … are unreadable, never a failed run (hole 85).
            word = run[key].strip().lower()
            if word in PASS_WORDS:
                return True
            if word in FAIL_WORDS:
                return False
            return None
    score = run.get("score")
    if isinstance(score, (int, float)) and not isinstance(score, bool):
        return score >= 1.0
    return None


def _run_list(entry: dict) -> object:
    """The case's per-run entries: a `runs` or `results` list, else (claude
    2.1.312, hole 99) the ablation's `with` arm — the runs made with the
    plugin loaded, the ones the acceptance bar counts; the `without` arm is
    the control and never scores the skill."""
    for key in ("runs", "results"):
        if isinstance(entry.get(key), list):
            return entry[key]
    arms = entry.get("arms")
    if isinstance(arms, dict) and isinstance(arms.get("with"), list):
        return arms["with"]
    return None


def _names_case(entry: dict, case: str) -> bool | None:
    """True when ``entry`` names ``case`` (name/case/id), False when it names
    another, None when it names none."""
    names = [entry[k] for k in ("name", "case", "id") if k in entry]
    if not names:
        return None
    return case in names


def _case_entry(doc: object, case: str) -> dict | None:
    """The case's entry in the `--json` result: a `cases` list or map keyed
    by name, else the document itself (one case filtered per call). The
    single-entry and whole-document fallbacks hold only when they name no
    case or this one — never another case's result."""
    if not isinstance(doc, dict):
        return None
    cases = doc.get("cases")
    if isinstance(cases, dict):
        entry = cases.get(case)
        return entry if isinstance(entry, dict) else None
    if isinstance(cases, list):
        for entry in cases:
            if isinstance(entry, dict) and _names_case(entry, case):
                return entry
        if len(cases) == 1 and isinstance(cases[0], dict) and _names_case(cases[0], case) is None:
            return cases[0]
        return None
    return doc if _names_case(doc, case) is not False else None


def score_case(doc: object, case: str, runs: int) -> dict:
    """`{runs, passed, score}` for one case from its `--json` result."""
    entry = _case_entry(doc, case)
    if entry is None:
        raise Refusal(f"case {case}: not in the result JSON")
    run_list = _run_list(entry)
    if isinstance(run_list, list) and run_list:
        verdicts = [_passed(r) for r in run_list]
        # A run without a recognisable verdict is unreadable, never a failed
        # run (hole 85: a shape mismatch must not read as 0/<runs>).
        if any(v is None for v in verdicts):
            raise Refusal(f"case {case}: unreadable run verdicts")
        n_runs = len(run_list)
        n_passed = sum(1 for v in verdicts if v)
    elif isinstance(entry.get("passed"), int) and not isinstance(entry.get("passed"), bool):
        n_runs = entry.get("runs") if isinstance(entry.get("runs"), int) else runs
        n_passed = entry["passed"]
    else:
        raise Refusal(f"case {case}: unreadable run verdicts")
    # A short (or long) result is never scored against its own count: the
    # bar is "k of the requested runs" (hole 85: 1/1 must not read as a pass).
    if n_runs != runs:
        raise Refusal(f"case {case}: {n_runs} runs reported, {runs} requested")
    if not 0 <= n_passed <= n_runs:
        raise Refusal(f"case {case}: unreadable run verdicts")
    score = entry.get("score")
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        # claude 2.1.312 (hole 99): the case's score sits under `aggregates`
        aggregates = entry.get("aggregates")
        score = aggregates.get("score") if isinstance(aggregates, dict) else None
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        score = round(n_passed / n_runs, 4) if n_runs else 0.0
    return {"runs": int(n_runs), "passed": int(n_passed), "score": score}


def cli_version(cli: str) -> str:
    try:
        res = subprocess.run([*_cli_argv(cli), "--version"], capture_output=True, text=True,
                             timeout=VERSION_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Refusal(f"claude CLI unavailable: {cli}: {exc}")
    if res.returncode != 0:
        raise Refusal(f"claude CLI unavailable: {cli} --version exited {res.returncode}")
    return res.stdout.strip() or res.stderr.strip()


def resolve_out(out: str | None, directory: str | None, run_id: str | None) -> Path:
    if out:
        path = Path(out)
    elif directory and run_id:
        key = joblib.project_key(Path(directory))
        path = joblib.workspace_path(key, run_id) / "evals"
    else:
        raise Refusal("no output folder: pass --out, or --directory with --run-id "
                      "(the run workspace)")
    return path


def run(cases_raw: str | None, runs: int, plugin: str | None, out: str | None,
        directory: str | None, run_id: str | None,
        cli_flag: str | None = None) -> tuple[dict, int]:
    cases = parse_cases(cases_raw)
    if runs < 1:
        raise Refusal("bad invocation: --runs must be > 0")
    plugin_root = Path(plugin).resolve() if plugin else PLUGIN_ROOT
    known = {p.name for p in (plugin_root / "evals").iterdir() if p.is_dir()} \
        if (plugin_root / "evals").is_dir() else set()
    for case in cases:
        if case not in known:
            raise Refusal(f"unknown case: {case} (cases under {plugin_root / 'evals'}: "
                          f"{', '.join(sorted(known)) or 'none'})")
    out_dir = resolve_out(out, directory, run_id)
    cli = claude_bin(cli_flag)
    version = cli_version(cli)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise Refusal(f"output folder not writable: {out_dir}: {exc}")
    out_dir = out_dir.resolve()
    scores: dict[str, dict] = {}
    scores_path = out_dir / SCORES
    failed: list[str] = []
    write_error: str | None = None
    for case in cases:
        try:
            scores[case] = run_case(cli, plugin_root, case, runs, out_dir)
        except Refusal as exc:
            scores[case] = {"error": str(exc)}
            failed.append(str(exc))
        # After every case: a later failure (or the guard) never loses it.
        try:
            _write_atomic(scores_path, json.dumps({"cases": scores, "cli": version},
                                                  indent=2, ensure_ascii=False) + "\n")
        except OSError as exc:
            # The scores still reach the status block; the run ends blocked.
            write_error = f"{SCORES} not writable: {scores_path}: {exc}"
    reason = "; ".join(s["error"] if "error" in s else f"{c} {s['passed']}/{s['runs']}"
                       for c, s in scores.items())
    if write_error:
        failed.append(write_error)
        reason = f"{reason}; {write_error}"
    artifacts = [str(scores_path)] if scores_path.is_file() and not write_error else []
    artifacts += [str(out_dir / f"{c}.json") for c in cases if (out_dir / f"{c}.json").is_file()]
    if failed:
        return with_block({"ok": False, "error": "; ".join(failed), "cases": scores,
                           "cli": version}, "blocked", artifacts, reason), 2
    return with_block({"ok": True, "cases": scores, "cli": version},
                      "complete", artifacts, reason), 0


def run_case(cli: str, plugin_root: Path, case: str, runs: int, out_dir: Path) -> dict:
    """One case: its stale result deleted, the CLI run, the result scored.
    Raises a `case <c>: …` Refusal when it cannot be scored."""
    result = out_dir / f"{case}.json"
    # A stale result from a reused --out is never read as a fresh score.
    try:
        result.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        raise Refusal(f"case {case}: stale result not removable: {exc}")
    argv = eval_argv(cli, plugin_root, case, runs, out_dir)
    try:
        res = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=CASE_TIMEOUT_S,
                             stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Refusal(f"case {case}: claude plugin eval failed to run: {exc}")
    # exit 1 is a case below the threshold: a score, read either way.
    try:
        doc = json.loads(result.read_text(encoding="utf-8"))
    except (OSError, ValueError):  # ValueError: bad JSON or undecodable bytes
        raise Refusal(f"case {case}: no result JSON (exit {res.returncode})")
    return score_case(doc, case, runs)


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
    parser = _Parser(description="tk-studio evals — claude plugin eval per case, scored")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    r = sub.add_parser("run", help="run the eval cases and write scores.json")
    r.add_argument("--cases", help="a JSON list or comma-separated case names "
                                   f"(default: {', '.join(DEFAULT_CASES)})")
    r.add_argument("--runs", type=int, default=DEFAULT_RUNS, help="runs per case (default 3)")
    r.add_argument("--plugin", help="the plugin root (default: this plugin)")
    r.add_argument("--out", help="the output folder (default: the run workspace's evals/)")
    r.add_argument("--directory", help="project root (with --run-id: the run workspace)")
    r.add_argument("--run-id", help="the studio run id (the payload's run_id)")
    r.add_argument("--claude-bin", help="the claude CLI (default: $CLAUDE_BIN, else claude)")
    try:
        args = parser.parse_args(argv)
        result, code = run(args.cases, args.runs, args.plugin, args.out,
                           args.directory, args.run_id, args.claude_bin)
    except Refusal as exc:
        _emit(with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)))
        return 2
    _emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
