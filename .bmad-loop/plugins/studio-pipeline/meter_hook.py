"""post_commit and post_session hook for the studio-pipeline plugin.

post_commit meters the landed story (ST-24.1). post_session (Story 35.8)
writes the pass that just ended into the story spec's `## Stage Log`:
`plansync.py stage --from-pass --run-dir D --story K --role R --phase P
--worktree W [--repo-root R]`, from bmad-loop's BMAD_LOOP_* env (the repo
root when it is not the worktree: the planner's buffered plan row is
flushed from there too). Both paths exit 0: a
stage-log failure never fails a pass (its JSON is printed, a note goes to
stderr).

bmad-loop fires post_commit right after `story-done`, only for a landed story,
with BMAD_LOOP_RUN_DIR, BMAD_LOOP_RUN_ID, BMAD_LOOP_REPO_ROOT and
BMAD_LOOP_STORY_KEY in the environment. This hook runs where the engine runs
(inside the microVM on the sbx engine), so it can reach the session
transcripts; the studio meter copies them into the run dir, prices them and
records one observation.

The studio root is TK_STUDIO_ROOT, else the nearest ancestor-or-self of
BMAD_LOOP_REPO_ROOT holding plugins/tk-studio/lib/meter.py — so a nested
studio project (apps/supervisor) finds the outer checkout without
TK_STUDIO_ROOT (driver contract 0.1.22). The walk-up is inlined: this hook
must not import the plugin's config. The meter's JSON is printed as-is. The hook is
declared blocking=false and exits 0 on every path, so a meter failure never
blocks the run. Stdlib only: it runs under `uv run --no-project python`.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

METER = Path("plugins") / "tk-studio" / "lib" / "meter.py"
PLANSYNC = Path("plugins") / "tk-studio" / "lib" / "plansync.py"


def _studio_root(env) -> Path | None:
    explicit = env.get("TK_STUDIO_ROOT")
    if explicit:
        return Path(explicit)
    repo = env.get("BMAD_LOOP_REPO_ROOT")
    if repo:
        start = Path(repo).resolve()
        for candidate in (start, *start.parents):
            if (candidate / METER).is_file():
                return candidate
    return None


def stage_pass(env) -> int:
    """post_session: one Stage Log row for the pass (plus its consults)."""
    try:
        root = _studio_root(env)
        run_dir = env.get("BMAD_LOOP_RUN_DIR")
        key = env.get("BMAD_LOOP_STORY_KEY")
        worktree = env.get("BMAD_LOOP_WORKTREE") or env.get("BMAD_LOOP_REPO_ROOT")
        if root is None or not (root / PLANSYNC).is_file():
            print("stage log: studio root not found", file=sys.stderr)
            return 0
        if not run_dir or not key or not worktree:
            print("stage log: BMAD_LOOP_RUN_DIR, BMAD_LOOP_STORY_KEY or "
                  "BMAD_LOOP_WORKTREE missing from the hook env", file=sys.stderr)
            return 0
        cmd = [sys.executable, str(root / PLANSYNC), "stage", "--from-pass",
               "--run-dir", run_dir, "--story", key, "--worktree", worktree]
        for flag, name in (("--role", "BMAD_LOOP_ROLE"), ("--phase", "BMAD_LOOP_PHASE")):
            if env.get(name):
                cmd += [flag, env[name]]
        repo = env.get("BMAD_LOOP_REPO_ROOT")
        if repo and Path(repo).resolve() != Path(worktree).resolve():
            # the planner's plan row was buffered under the project root
            cmd += ["--repo-root", repo]
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=100)
        out = proc.stdout.strip()
        if out:
            # one line, so bmad-loop's last-line JSON read never takes it as a mutation
            try:
                print(json.dumps({"stage_log": json.loads(out)}))
            except ValueError:
                print(json.dumps({"stage_log": {"ok": False, "stdout": out[-2000:]}}))
        if proc.returncode != 0:
            print(f"stage log: plansync stage --from-pass exited {proc.returncode}: "
                  f"{(proc.stderr.strip() or out)[-500:]}", file=sys.stderr)
    except Exception as exc:  # never fail the pass
        print(f"stage log hook: {exc}", file=sys.stderr)
    return 0


def main() -> int:
    env = os.environ
    if env.get("BMAD_LOOP_STAGE") == "post_session":
        return stage_pass(env)
    try:
        root = _studio_root(env)
        run_dir = env.get("BMAD_LOOP_RUN_DIR")
        key = env.get("BMAD_LOOP_STORY_KEY")
        if root is None or not (root / METER).is_file():
            print(json.dumps({"ok": False, "error": "meter: studio root not found "
                              "(set TK_STUDIO_ROOT, or run from a checkout holding "
                              f"{METER.as_posix()})"}))
            return 0
        if not run_dir or not key:
            print(json.dumps({"ok": False, "error": "meter: BMAD_LOOP_RUN_DIR or "
                              "BMAD_LOOP_STORY_KEY missing from the hook env"}))
            return 0
        cmd = [sys.executable, str(root / METER), "story",
               "--run-dir", run_dir, "--story-key", key]
        repo = env.get("BMAD_LOOP_REPO_ROOT")
        if repo:
            cmd += ["--repo-root", repo]
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=240)
        out = proc.stdout.strip()
        if out:
            print(out)
        else:
            print(json.dumps({"ok": False, "error": f"meter: no output (rc {proc.returncode})",
                              "stderr": proc.stderr.strip()[-2000:]}))
    except Exception as exc:  # never block the run
        print(json.dumps({"ok": False, "error": f"meter hook: {exc}"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
