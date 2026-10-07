#!/usr/bin/env bash
# Provision a Docker Sandboxes microVM as a bmad-loop engine home (runbook §3.8).
# Run inside the sandbox: sbx exec <sandbox> bash <this> <project-mount> <studio-mount>
#   <project-mount>  the project checkout as mounted in the sandbox (read-write)
#   <studio-mount>   the tk-studio checkout as mounted in the sandbox (read-only
#                    for other projects; the project itself when it IS tk-studio)
# Idempotent. Stdlib tools only; network per the sandbox's `balanced` policy.
set -u
PROJ="$1"; STUDIO="$2"
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

step tmux
command -v tmux >/dev/null || { sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1; sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux >/dev/null 2>&1; }
tmux -V

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
  "$HOME/.dotnet/dotnet" --list-sdks 2>&1 | head -3
fi

# Godot (mono, Linux) for a game project's engine gate: WITH_GODOT=4.7.2. The
# GitHub release host is allowed by `balanced`. Project gates call `godot` on
# PATH (TUA's verify.sh and engine-gate.sh) and the studio runs it through
# $GODOT, so both are set. libfontconfig1 is what the headless binary's loader
# asks for on the VM's Ubuntu.
if [ -n "${WITH_GODOT:-}" ]; then
  step godot
  GD_DIR="$HOME/godot/Godot_v${WITH_GODOT}-stable_mono_linux_x86_64"
  GD_BIN="$GD_DIR/Godot_v${WITH_GODOT}-stable_mono_linux.x86_64"
  [ -x "$GD_BIN" ] || {
    mkdir -p "$HOME/godot"
    curl -fsSL "https://github.com/godotengine/godot/releases/download/${WITH_GODOT}-stable/Godot_v${WITH_GODOT}-stable_mono_linux_x86_64.zip" -o /tmp/godot.zip \
      && unzip -q -o /tmp/godot.zip -d "$HOME/godot" && chmod +x "$GD_BIN" && rm -f /tmp/godot.zip
  }
  dpkg -s libfontconfig1 >/dev/null 2>&1 || { sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1; sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libfontconfig1 >/dev/null 2>&1; }
  mkdir -p "$HOME/.local/bin"
  printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$GD_BIN" > "$HOME/.local/bin/godot"
  chmod +x "$HOME/.local/bin/godot"
  grep -q 'export GODOT=' ~/.profile 2>/dev/null || echo "export GODOT=\"$GD_BIN\"" >> ~/.profile
  "$HOME/.local/bin/godot" --version 2>&1 | tail -2
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

step plugin
claude plugin marketplace add "$STUDIO" >/dev/null 2>&1
claude plugin install tk-studio@tk-studio --scope user 2>&1 | tail -1
claude plugin update tk-studio@tk-studio --scope user 2>&1 | tail -1

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
