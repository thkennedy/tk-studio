"""The Story 34.8 e2e drive — the `run-vertical-slice` job type and its
supervisor legs.

The shipped type is studio data (`jobs/run-vertical-slice.json`, read by
`lib/job.py`), so this drive proves it in process: it loads among the
shipped types with no problem, it has `run-epic`'s shape under its own id
and description, and an approve-minted instance (`{id: "run-epic-41",
type: "run-vertical-slice", target: {payload: {epic: 41}}}`) resolves to
the launch surface with its `type` kept (the supervisor's slice detection
reads `type` or `id`). Approve's type rule and the slice's host leg (the
assets step, the contact sheet, the PR section) are supervisor code
(`apps/supervisor/src/approve.ts`, `hostverify.ts`, AD-2), so the drive
runs their Story 34.8 cases the way the supervisor's own gate does, and
Story 35.1's re-run cases (`hostleg.ts`: the PR body rewritten with the
`Legs:` history, the ready and `--undo` flips, a slice re-run's art and
proof committed and pushed on the run branch):

    locate the checkout (walk up from the plugin root to the folder holding
    `apps/supervisor/package.json`) → find `bun` on PATH → `bun test
    test/approve.test.ts test/hostverify.test.ts test/hostleg.test.ts
    -t "Story 34.8|Story 35.1|Story 36.1"` from
    `apps/supervisor` under a fresh temp folder (`TMPDIR`/`TEMP`/`TMP`,
    removed afterwards: the Story 33.4 rule), `TK_SUPERVISOR_*` stripped,
    bounded at `BOUND_S` → judge its exit

No checkout (an extracted plugin archive) or no `bun` on PATH: the suite
step is `ok: true` with `not_run` naming which (the `cli_drives` "not run"
precedent). The drive prints one JSON object {ok, steps[]} and exits
nonzero on a red step. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from _budget import suite_bound  # the sibling helper: the suite's bound derives from the manifest entry's timeout

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
SUITES = ["test/approve.test.ts", "test/hostverify.test.ts", "test/hostleg.test.ts"]
# bun's `-t` is a regex: Story 34.8's cases, Story 35.1's re-run (the body rewrite, both flips, the slice commit) and
# Story 36.1's (`legHistory` on an inconclusive leg, the `FRAMES_DIR` pins).
FILTER = "Story 34.8|Story 35.1|Story 36.1"
TYPE_ID = "run-vertical-slice"
# Derived from the manifest's `timeout` for this drive (the runner honours it since Story 35.1's
# fix-forward), with the install's bound beside it: the suite step measured about 100 s on the
# Windows host with the Story 35.1 filter (hole 87's lesson: bounds follow the box, not the planner).
INSTALL_BOUND_S = 40
BOUND_S = suite_bound("e2e_vertical_slice.py", install_s=INSTALL_BOUND_S)
# A multi-file run needs the flag: the preload's `setDefaultTimeout` reaches only the first file (bun 1.4.3).
TEST_TIMEOUT_MS = "30000"
TAIL = 20


def _checkout(start: Path) -> Path | None:
    """The folder above ``start`` holding ``apps/supervisor/package.json``."""
    for folder in (start, *start.parents):
        if (folder / "apps" / "supervisor" / "package.json").is_file():
            return folder
    return None


def type_steps() -> list[dict]:
    """The shipped type loads, has `run-epic`'s shape and resolves an instance."""
    sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
    import job  # noqa: E402 - the plugin's own resolver
    steps: list[dict] = []
    types = job.load_types()
    entry = types.get(TYPE_ID)
    if entry is None or entry["definition"] is None or entry["problems"]:
        steps.append({"step": "type", "ok": False,
                      "detail": f"{TYPE_ID}: " + ("not shipped" if entry is None
                                                  else "; ".join(entry["problems"]))})
        return steps
    defn, epic = entry["definition"], types["run-epic"]["definition"]
    # Story 36.6: the rhythm (`stop.after_stories`) is run-epic's alone
    epic = {**epic, "stop": {k: v for k, v in epic["stop"].items() if k != "after_stories"}}
    same = {k: v for k, v in defn.items() if k not in ("id", "description")} \
        == {k: v for k, v in epic.items() if k not in ("id", "description")}
    steps.append({"step": "type", "ok": same and defn["id"] == TYPE_ID
                  and defn["description"] != epic["description"],
                  "detail": f"{entry['path']}: run-epic's shape under its own id and "
                            f"description" if same else "shape differs from run-epic"})
    resolved, problems = job.resolve_instance(
        {"job_schema_version": 1, "id": "run-epic-41", "type": TYPE_ID,
         "target": {"payload": {"epic": 41}}}, types)
    ok = (not problems and not job.validate_definition(resolved)
          and resolved.get("type") == TYPE_ID and resolved.get("id") == "run-epic-41"
          and resolved["target"] == {"skill": "tk-studio-launch",
                                     "payload": {"verb": "start", "bootstrap": True,
                                                 "epic": 41}})
    steps.append({"step": "resolve", "ok": ok,
                  "detail": "run-epic-41 of type run-vertical-slice resolves to "
                            "tk-studio-launch with its type kept" if ok
                            else f"resolved {json.dumps(resolved)[:300]}; {problems}"})
    return steps


def suite_steps() -> list[dict]:
    steps: list[dict] = []
    checkout = _checkout(PLUGIN_ROOT)
    if checkout is None:
        return [{"step": "locate", "ok": True, "not_run": "no checkout"}]
    supervisor = checkout / "apps" / "supervisor"
    steps.append({"step": "locate", "ok": True, "detail": str(supervisor)})
    bun = shutil.which("bun")
    if bun is None:
        steps.append({"step": "bun", "ok": True, "not_run": "bun absent"})
        return steps
    steps.append({"step": "bun", "ok": True, "detail": bun})
    temp = tempfile.mkdtemp(prefix="tk-vertical-slice-")
    try:
        env = {k: v for k, v in os.environ.items() if not k.startswith("TK_SUPERVISOR_")}
        env.update(TMPDIR=temp, TEMP=temp, TMP=temp)
        if not (supervisor / "node_modules").is_dir():
            try:
                inst = subprocess.run(
                    [bun, "install", "--frozen-lockfile"], cwd=str(supervisor), env=env,
                    stdin=subprocess.DEVNULL, capture_output=True, text=True,
                    encoding="utf-8", errors="replace", timeout=INSTALL_BOUND_S)
            except subprocess.TimeoutExpired:
                steps.append({"step": "install", "ok": False,
                              "detail": f"bun install hung past {INSTALL_BOUND_S}s"})
                return steps
            if inst.returncode != 0:
                steps.append({"step": "install", "ok": False,
                              "detail": f"bun install exit {inst.returncode}: "
                                        f"{(inst.stderr or inst.stdout).strip()[-300:]}"})
                return steps
            steps.append({"step": "install", "ok": True,
                          "detail": "bun install --frozen-lockfile (node_modules was absent)"})
        started = time.monotonic()
        try:
            proc = subprocess.run(
                [bun, "test", "--timeout", TEST_TIMEOUT_MS, *SUITES, "-t", FILTER], cwd=str(supervisor), env=env,
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=BOUND_S)
        except subprocess.TimeoutExpired:
            steps.append({"step": "suite", "ok": False,
                          "detail": f"bun test {' '.join(SUITES)} hung past {BOUND_S}s"})
            return steps
        duration_ms = int((time.monotonic() - started) * 1000)
        lines = f"{proc.stdout}{proc.stderr}".rstrip().splitlines()
        steps.append({"step": "suite", "ok": proc.returncode == 0,
                      "detail": f"bun test {' '.join(SUITES)} -t \"{FILTER}\" "
                                + ("green" if proc.returncode == 0 else
                                   f"exit {proc.returncode}: " + " | ".join(lines[-TAIL:])),
                      "duration_ms": duration_ms})
        return steps
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def run() -> dict:
    steps = type_steps()
    if all(s["ok"] for s in steps):
        steps += suite_steps()
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    del argv  # no arguments: the drive locates its own checkout
    try:
        result = run()
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
