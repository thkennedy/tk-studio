#!/usr/bin/env bash
# Re-arm a bmad-loop run paused on an escalation whose cause was fixed by hand,
# resume it, and hold the sandbox attached while the engine lives.
#   sbx exec <sandbox> bash -lc 'ROOT=<project-mount> bash <this> <run_id> [<tag>]'
#
# ROOT is the project the run belongs to. In the one-mount tk-studio sandbox
# `claude-tk-studio` (runbook §3.8, Story 28.3) that is:
#   ROOT=/c/GitHub/tk-studio/apps/supervisor   a supervisor run (nested project)
#   ROOT=/c/GitHub/tk-studio                   a plugin run (the repository root)
# Any other project's sandbox: ROOT=/c/GitHub/<project>. A ROOT with neither
# .tk-studio/config.yaml nor .bmad-loop/ is refused (exit 2) before anything
# is written.
#
# A supervisor run never uses this script: the supervisor resumes a paused run
# whose story did no work through `POST /runs/{id}/resume` (the same
# `bmad-loop resolve --no-interactive --resume`, held by the supervisor), and
# closes out one whose story landed by itself (harvest commit, meter harvest,
# `bmad-loop archive`, relaunch). Use this only for an engine run started by
# hand, when the paused story had no landed work (a missing fact, a render
# halt): a re-drive restarts that story from its baseline. A hand-started
# story whose dev session already committed (its spec says `status: done`) is
# closed another way:
#   1. commit the engine's staged harvest by hand;
#   2. `bmad-loop archive` the paused run;
#   3. launch the epic again. It skips `done` stories.
set -u
RUN="$1"; TAG="${2:-resume}"
ROOT="${ROOT:?set ROOT to the project mount}"
if [ ! -f "$ROOT/.tk-studio/config.yaml" ] && [ ! -d "$ROOT/.bmad-loop" ]; then
  echo "resume-run: ROOT=$ROOT is not a studio project root (no .tk-studio/config.yaml, no .bmad-loop/): use /c/GitHub/tk-studio/apps/supervisor for a supervisor run, /c/GitHub/tk-studio for a plugin run (runbook §3.8)" >&2
  exit 2
fi
export PATH="$HOME/.local/bin:$PATH"
OUT="$ROOT/.bmad-loop/cache/$RUN-$TAG"
mkdir -p "$OUT"
cd "$ROOT"
date -u +%FT%TZ > "$OUT/started"
bmad-loop resolve --project "$ROOT" --no-interactive --resume "$RUN" > "$OUT/resolve.log" 2>&1
echo "resolve exit $?" > "$OUT/resolve.rc"
sleep 20
while pgrep -f "bmad-loop (run|resume|resolve)" > /dev/null 2>&1; do sleep 60; done
date -u +%FT%TZ > "$OUT/engine-gone"
