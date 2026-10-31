#!/usr/bin/env bash
# Provision a Docker Sandboxes microVM as a bmad-loop engine home (runbook §3.8).
# Run inside the sandbox: sbx exec <sandbox> bash <this> <project-mount> <studio-mount>
#   <project-mount>  the project checkout as mounted in the sandbox (read-write)
#   <studio-mount>   the tk-studio checkout as mounted in the sandbox (read-only
#                    for other projects; the project itself when it IS tk-studio)
# The one-mount tk-studio sandbox `claude-tk-studio` (AD-21, Story 28.3) mounts
# C:\GitHub\tk-studio read-write and serves both loops, the plugin's and the
# nested supervisor's (apps/supervisor), so both arguments are the same path
# and the supervisor needs bun:
#   WITH_BUN=1 bash <this> /c/GitHub/tk-studio /c/GitHub/tk-studio
# TK_STUDIO_ROOT stays the outer root there; launch-epic.sh's ROOT picks the
# project per epic. Other projects (a Godot game) keep the two-mount form.
# The sandbox must be created with the read-only skills mount (`sbx create
# --skills readonly`): the tk-studio plugin comes from Docker Sandboxes' shared
# skills store, a copy of the host's ~/.claude/skills that `sbx skills import`
# fills on the host (not a live view), and the skills-mount step fails loudly
# when it is absent.
# Idempotent. Stdlib tools only; network per the sandbox's `balanced` policy.
set -u
PROJ="$1"; STUDIO="$2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BMAD_LOOP_PIN="${BMAD_LOOP_PIN:-v0.9.1}"     # keep equal to bmad.lock's bmad-loop pin
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
step() { echo "== $*"; }

# The engine's own shell commits the loop's close-out; the agent session has an
# identity but the engine process does not (TUA hit the same in WSL).
step git-identity
[ -n "$(git config --global user.email)" ] || {
  git config --global user.name "${GIT_NAME:?set GIT_NAME}"
  git config --global user.email "${GIT_EMAIL:?set GIT_EMAIL}"
}
git config --global user.email

# Loud on failure (loop hole 24, twice): a silent apt left the sandbox without tmux and
# the engine would have died at its first session. The apt output lands in a log whose
# tail is printed when the install fails; `tmux -V` must answer afterwards.
apt_install() {
  local pkg="$1" log="/tmp/provision-apt-$1.log"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq > "$log" 2>&1 || true
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg" >> "$log" 2>&1 || {
    echo "$pkg: apt-get install failed; last lines of $log:"; tail -n 20 "$log"; return 1; }
}

step tmux
command -v tmux >/dev/null || apt_install tmux || exit 1
tmux -V || { echo "tmux: not runnable after the install"; exit 1; }

# [tui] is not optional: without it `bmad-loop list` fails (pyte/rich) and so
# does tk-studio-launch's live-engine check.
step bmad-loop
uv tool install --force "bmad-loop[tui] @ git+https://github.com/bmad-code-org/bmad-loop@${BMAD_LOOP_PIN}" >/dev/null 2>&1
bmad-loop --version

# C# / Godot projects: the `balanced` network policy blocks NuGet and the .NET
# download hosts (verified 2026-09-28), and the VM's Ubuntu ships only .NET 10.
# A .NET project's engine sandbox needs an operator-approved, sandbox-scoped
# rule first (runbook §3.8): then WITH_DOTNET=8.0 installs the SDK channel.
if [ -n "${WITH_DOTNET:-}" ]; then
  step dotnet
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh     && bash /tmp/dotnet-install.sh --channel "$WITH_DOTNET" --install-dir "$HOME/.dotnet" >/dev/null 2>&1
  grep -q DOTNET_ROOT ~/.profile 2>/dev/null || { echo 'export DOTNET_ROOT="$HOME/.dotnet"' >> ~/.profile; echo 'export PATH="$HOME/.dotnet:$PATH"' >> ~/.profile; }
  # Hole 47: the engine and its verify commands run under a bare `sbx exec` (no login shell, so ~/.profile
  # is never read), whose PATH carries ~/.local/bin; dotnet goes there too, like godot below.
  mkdir -p "$HOME/.local/bin" && ln -sf "$HOME/.dotnet/dotnet" "$HOME/.local/bin/dotnet"
  # Hole 49: an apphost (every xunit v3 test project, so `dotnet test`; a `dotnet run` output) finds the
  # runtime through DOTNET_ROOT or the registered install location, never through the dotnet on PATH, and
  # the bare-exec environment carries no DOTNET_ROOT: the SDK under ~/.dotnet is registered the documented
  # way, so a test host resolves the runtime wherever it is launched from.
  sudo mkdir -p /etc/dotnet && echo "$HOME/.dotnet" | sudo tee /etc/dotnet/install_location >/dev/null
  "$HOME/.dotnet/dotnet" --list-sdks 2>&1 | head -3
  command -v dotnet >/dev/null || { echo "dotnet: not on the bare-exec PATH after the link"; exit 1; }
  [ "$(cat /etc/dotnet/install_location 2>/dev/null)" = "$HOME/.dotnet" ] || { echo "dotnet: install location not registered in /etc/dotnet/install_location"; exit 1; }
fi

# Godot (mono, Linux) for a game project's engine gate: WITH_GODOT=4.7.2. The
# GitHub release host is allowed by `balanced`. Project gates call `godot` on
# PATH (TUA's verify.sh and engine-gate.sh) and the studio runs it through
# $GODOT, so both are set. libfontconfig1 is what the headless binary's loader
# asks for on the VM's Ubuntu.
if [ -n "${WITH_GODOT:-}" ]; then
  step godot
  # Story 36.6 (DW-71): the provisioning's own record, one key=value line per option; `launch.py check`
  # reads it over `sbx exec` (the engine-gate clause), and takes an executable shim with no marker for an
  # older sandbox that has Godot. So both go first: whichever step fails below, a re-provision that fails
  # leaves neither from an earlier one, and they are written only once the binary answers.
  rm -f "$HOME/.tk-studio/provisioned" "$HOME/.local/bin/godot"
  GD_DIR="$HOME/godot/Godot_v${WITH_GODOT}-stable_mono_linux_x86_64"
  GD_BIN="$GD_DIR/Godot_v${WITH_GODOT}-stable_mono_linux.x86_64"
  [ -x "$GD_BIN" ] || {
    mkdir -p "$HOME/godot"
    curl -fsSL "https://github.com/godotengine/godot/releases/download/${WITH_GODOT}-stable/Godot_v${WITH_GODOT}-stable_mono_linux_x86_64.zip" -o /tmp/godot.zip \
      && unzip -q -o /tmp/godot.zip -d "$HOME/godot" && chmod +x "$GD_BIN" && rm -f /tmp/godot.zip
  }
  dpkg -s libfontconfig1 >/dev/null 2>&1 || apt_install libfontconfig1 || exit 1
  GD_VERSION="$("$GD_BIN" --version 2>&1)" || {
    echo "godot: $GD_BIN --version failed; no provisioned marker written:"; echo "$GD_VERSION" | tail -n 20; exit 1; }
  echo "$GD_VERSION" | tail -2
  mkdir -p "$HOME/.local/bin"
  printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$GD_BIN" > "$HOME/.local/bin/godot"
  chmod +x "$HOME/.local/bin/godot"
  grep -q 'export GODOT=' ~/.profile 2>/dev/null || echo "export GODOT=\"$GD_BIN\"" >> ~/.profile
  mkdir -p "$HOME/.tk-studio"
  printf 'WITH_GODOT=%s\ndate=%s\n' "$WITH_GODOT" "$(date -u +%F)" > "$HOME/.tk-studio/provisioned"
fi

if [ "${WITH_BUN:-0}" = 1 ]; then
  step bun
  command -v bun >/dev/null || (curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1) || npm install -g bun >/dev/null 2>&1
  bun --version 2>&1 | head -1
fi

step env
grep -q TK_STUDIO_ROOT ~/.profile 2>/dev/null || {
  echo "export TK_STUDIO_ROOT=$STUDIO" >> ~/.profile
  echo 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"' >> ~/.profile
}
grep TK_STUDIO_ROOT ~/.profile

# The plugin is not installed per sandbox (AD-21): the sandbox reads Docker
# Sandboxes' shared skills store, mounted read-only. The store is a copy of the
# host's ~/.claude/skills that `sbx skills import` fills on the host, not a live
# view, and this step only verifies it (Story 25.6).
step skills-mount
PROJECT_DIR="$PROJ" bash "$HERE/check-skills-mount.sh" || exit 1
# The one-mount tk-studio sandbox also serves the nested supervisor project
# (Story 28.3): a project-scope copy under apps/supervisor/.claude is listed
# only from that directory, so check from it too.
if [ -f "$PROJ/apps/supervisor/.tk-studio/config.yaml" ]; then
  PROJECT_DIR="$PROJ/apps/supervisor" bash "$HERE/check-skills-mount.sh" || exit 1
fi

# Claude Code's "Make auto mode your default permission mode?" dialog is gated by
# hasSeenAutoDefaultNudge in ~/.claude.json. On 2026-09-28 it swallowed an engine
# nudge in a bypass session and the keystrokes flipped the sandbox's default mode
# (loop deficiency 2, runbook section 8). Mark it and its two siblings seen, so no
# headless session ever meets them.
step claude-flags
python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude.json")
d = json.load(open(p)) if os.path.exists(p) else {}
d.update({"hasSeenAutoDefaultNudge": True, "hasSeenAutoDefaultNotice": True, "hasSeenAutoModeEntryWarning": True})
json.dump(d, open(p, "w"), indent=2)
print("seen:", ", ".join(k for k in ("hasSeenAutoDefaultNudge", "hasSeenAutoDefaultNotice", "hasSeenAutoModeEntryWarning") if d.get(k)))
PY

# The sandbox is its own machine for the studio: its own store and ledger
# (AD-12/AD-20), with the project registered as developer.
step store
cd "$STUDIO/plugins/tk-studio/lib" \
  && uv run store.py standup >/dev/null \
  && uv run registry.py register --directory "$PROJ" --writer onboard | grep -o '"action": "[a-z]*"'

step resolve
uv run orchestrate.py resolve --directory "$PROJ" --role developer \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('outcome'),d.get('working_set'))"
