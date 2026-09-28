#!/usr/bin/env bash
# Re-arm a bmad-loop run paused on an escalation whose cause was fixed by hand,
# resume it, and hold the sandbox attached while the engine lives.
#   sbx exec <sandbox> bash -lc 'ROOT=<project-mount> bash <this> <run_id> [<tag>]'
#
# Use it only when the paused story had no landed work, for example a missing
# fact or a render halt. A re-drive restarts that story from its baseline. A
# story whose dev session already committed (its spec says `status: done`) is
# closed another way:
#   1. commit the engine's staged harvest by hand;
#   2. `bmad-loop archive` the paused run;
#   3. launch the epic again. It skips `done` stories.
set -u
RUN="$1"; TAG="${2:-resume}"
ROOT="${ROOT:?set ROOT to the project mount}"
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
