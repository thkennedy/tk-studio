#!/usr/bin/env bash
# Launch one epic through tk-studio-launch, headless, inside the engine sandbox,
# then hold the sandbox attached for as long as the bmad-loop engine lives
# (runbook §3.8: a sandbox stops when nothing is attached, and a detached
# engine dies with it).
#
# Run from the host, held for the engine's lifetime (Git Bash: set
# MSYS_NO_PATHCONV=1 so /c/... arguments pass through):
#   sbx exec <sandbox> bash -lc 'ROOT=<project-mount> bash <this> <epic> [<tag>]'
#
# Output lands in <project>/.bmad-loop/cache/epic-<epic>-<tag>/ (gitignored):
# launch.json (the session's --output-format json result, cost included),
# launch.rc, and started / launch-ended / engine-gone stamps.
#
# A first launch on an epic writes SPEC.md, stories.yaml and the first plan.
# If it ends `blocked` on a dirty tree, commit that output on the run branch
# and launch again.
set -u
EPIC="$1"; TAG="${2:-launch}"
ROOT="${ROOT:?set ROOT to the project mount}"
MODEL="${LAUNCH_MODEL:-claude-opus-5-5}"      # the planner leg; keep it equal to routing
EFFORT="${LAUNCH_EFFORT:-high}"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
OUT="$ROOT/.bmad-loop/cache/epic-$EPIC-$TAG"
mkdir -p "$OUT"
cd "$ROOT"
date -u +%FT%TZ > "$OUT/started"
PAYLOAD="{\"verb\":\"start\",\"directory\":\"$ROOT\",\"epic\":$EPIC}"
# bypass is allowed here: this runs inside the Docker Sandboxes microVM only
claude -p "/tk-studio:tk-studio-launch $PAYLOAD" \
  --model "$MODEL" --effort "$EFFORT" \
  --permission-mode bypassPermissions \
  --output-format json > "$OUT/launch.json" 2> "$OUT/launch.err"
echo "launch exit $?" > "$OUT/launch.rc"
date -u +%FT%TZ > "$OUT/launch-ended"
sleep 20
while pgrep -f "bmad-loop run" > /dev/null 2>&1; do sleep 60; done
date -u +%FT%TZ > "$OUT/engine-gone"
