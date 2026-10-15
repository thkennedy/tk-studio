#!/usr/bin/env bash
# Verify a Docker Sandboxes microVM reads the studio plugin from the host's
# shared skills store, mounted read-only (Story 25.6, AD-21; runbook §3.8).
# Run inside the sandbox: bash <this>   (provision-engine.sh calls it)
# It only verifies: it never installs, uninstalls or imports anything.
# Order: the mount point, read-only, the plugin folder, no shadowing
# marketplace copy `tk-studio@<m>` (any marketplace but skills-dir; driver
# contract §6), `tk-studio@skills-dir` loaded from the mount (its `Path:` is
# the mount's tk-studio folder, not a project or other skills folder). Each
# failure prints one line naming the mount and its fix, and exits 1.
# Overridable: SKILLS_MOUNT (default $HOME/.claude/skills), PROC_MOUNTS
# (default /proc/mounts), PROJECT_DIR (default $PWD: the directory
# `claude plugin list` runs in, so a project-scope copy in its
# .claude/settings.json is listed; provision-engine.sh passes the project),
# LIST_TIMEOUT (default 120: seconds `claude plugin list` may take when
# `timeout` is on PATH), and `claude` as resolved from PATH.
set -u
MOUNT="${SKILLS_MOUNT:-$HOME/.claude/skills}"
MOUNT="${MOUNT%/}"
MOUNTS_FILE="${PROC_MOUNTS:-/proc/mounts}"
LIST_DIR="${PROJECT_DIR:-$PWD}"
LIST_TIMEOUT="${LIST_TIMEOUT:-120}"
RECREATE="recreate the sandbox from PowerShell on the host: sbx rm <sandbox>; sbx create --skills readonly --name <sandbox> claude <mounts> (runbook §3.8)"

fail() { echo "skills-mount FAIL: $MOUNT $*" >&2; exit 1; }

# 1. A mounts row whose target is the path. Field 2 is the target, with
#    spaces octal-escaped (\040), field 4 the options.
opts=""
found=0
if [ -r "$MOUNTS_FILE" ]; then
  want="${MOUNT// /\\040}"
  while read -r _src target _fs options _rest; do
    if [ "$target" = "$want" ]; then
      found=1; opts="$options"   # the last row wins: it is the top mount
    fi
  done < "$MOUNTS_FILE"
fi
[ "$found" = 1 ] || fail "is not mounted (no $MOUNTS_FILE row targets it): $RECREATE"

# 2. Read-only.
case ",$opts," in
  *,ro,*) ;;
  *) fail "is mounted read-write ($opts): $RECREATE" ;;
esac

# 3. The plugin folder the host installer writes.
[ -f "$MOUNT/tk-studio/.claude-plugin/plugin.json" ] || fail "has no tk-studio/.claude-plugin/plugin.json (the shared store is empty): run tk-studio install on the host, then sbx skills import --force there (the store is a copy of the host folder, not a live view)"

# 4 and 5. `claude plugin list`, run from the project so its project-scope
#    settings count: first no marketplace copy (a shadowing copy likely keeps
#    the skills-dir entry from loading, and its fix is the uninstall), then
#    the skills-dir entry loaded from the mount. A failing or stalled
#    listing is its own cause, not "not loaded".
command -v claude >/dev/null 2>&1 || fail "cannot be checked: claude is not on PATH"
[ -d "$LIST_DIR" ] || fail "cannot be checked: PROJECT_DIR $LIST_DIR is not a directory"
bounded=0
command -v timeout >/dev/null 2>&1 && bounded=1
list_plugins() {
  if [ "$bounded" = 1 ]; then timeout -k 5 "$LIST_TIMEOUT" claude plugin list
  else claude plugin list; fi
}
listing="$(cd "$LIST_DIR" && list_plugins 2>&1)"; rc=$?
if [ "$rc" != 0 ]; then
  if [ "$bounded" = 1 ] && { [ "$rc" = 124 ] || [ "$rc" = 137 ]; }; then
    fail "cannot be checked: claude plugin list timed out after ${LIST_TIMEOUT}s"
  fi
  first="$(printf '%s\n' "$listing" | sed -n '/[^[:space:]]/{p;q;}')"
  fail "cannot be checked: claude plugin list failed: ${first:-no output}"
fi
# Every `❯ tk-studio@<m>` entry but skills-dir is a marketplace copy: one
# uninstall per copy, and the marketplace removal only for the tk-studio
# marketplace the old provisioning registered.
copies="$(printf '%s\n' "$listing" | sed -nE 's/^.*❯[[:space:]]*tk-studio@([^[:space:]]+)[[:space:]]*$/\1/p' | grep -vx 'skills-dir' | sort -u)"
if [ -n "$copies" ]; then
  names=""; fixes=""; remove=""
  while IFS= read -r m; do
    names="$names${names:+, }tk-studio@$m"
    fixes="$fixes${fixes:+; }claude plugin uninstall tk-studio@$m --scope user (and --scope project, then --scope local, from the project)"
    [ "$m" = tk-studio ] && remove=", then claude plugin marketplace remove tk-studio"
  done <<< "$copies"
  fail "is shadowed by a marketplace copy $names: run $fixes$remove, inside the sandbox"
fi
# A loaded skills-dir entry counts only when its `Path:` is the mount's
# folder: the listing runs from the project, so a project (or other)
# .claude/skills/tk-studio would load instead of the mounted copy. Prints
# "yes", "no", or "elsewhere <path>" for a loaded entry from another path.
loaded="$(printf '%s\n' "$listing" | WANT="$MOUNT/tk-studio" awk '
  function flush() {
    if (cur && st) {
      if (p == want) ok = 1
      else if (other == "") other = (p == "" ? "an entry with no Path: line" : p)
    }
    cur = 0; st = 0; p = ""
  }
  BEGIN { want = ENVIRON["WANT"] }
  /❯/ { flush(); cur = ($0 ~ /❯[[:space:]]*tk-studio@skills-dir[[:space:]]*$/); next }
  cur && /^[[:space:]]*Path:/ { p = $0; sub(/^[[:space:]]*Path:[[:space:]]*/, "", p); sub(/[[:space:]]+$/, "", p); sub(/\/+$/, "", p) }
  cur && /Status:/ && /✔ loaded/ { st = 1 }
  END { flush(); if (ok) print "yes"; else if (other != "") print "elsewhere " other; else print "no" }')"
case "$loaded" in
  yes) ;;
  elsewhere*) fail "loads tk-studio@skills-dir from ${loaded#elsewhere }, not from the mount: remove that folder (a project or other .claude/skills/tk-studio) so the mounted copy loads" ;;
  *) fail "is mounted but claude plugin list does not show tk-studio@skills-dir ✔ loaded: run claude plugin validate $MOUNT/tk-studio and check settings for a disabled tk-studio@skills-dir" ;;
esac

echo "skills-mount ok: $MOUNT read-only, tk-studio@skills-dir loaded, no marketplace copy"
