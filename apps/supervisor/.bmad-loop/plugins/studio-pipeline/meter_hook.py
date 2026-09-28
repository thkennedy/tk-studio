"""post_commit hook for the studio-pipeline plugin: meter the landed story (ST-24.1).

bmad-loop fires post_commit right after `story-done`, only for a landed story,
with BMAD_LOOP_RUN_DIR, BMAD_LOOP_RUN_ID, BMAD_LOOP_REPO_ROOT and
BMAD_LOOP_STORY_KEY in the environment. This hook runs where the engine runs
(inside the microVM on the sbx engine), so it can reach the session
transcripts; the studio meter copies them into the run dir, prices them and
records one observation.

The studio root is TK_STUDIO_ROOT, else BMAD_LOOP_REPO_ROOT when it holds
plugins/tk-studio/lib/meter.py. The meter's JSON is printed as-is. The hook is
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


def _studio_root(env) -> Path | None:
    explicit = env.get("TK_STUDIO_ROOT")
    if explicit:
        return Path(explicit)
    repo = env.get("BMAD_LOOP_REPO_ROOT")
    if repo and (Path(repo) / METER).is_file():
        return Path(repo)
    return None


def main() -> int:
    env = os.environ
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
