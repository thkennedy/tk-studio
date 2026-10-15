#!/bin/sh
# tk-studio bootstrap (AD-21, Story 25.4): installs the pinned uv and the
# tk-studio meta-CLI. Re-running it is the update. It:
#   1. installs the pinned uv (version and SHA-256 embedded below) unmanaged
#      into <root>/tools/uv-<version>/ (no install receipt, so
#      `uv self update` is off)
#   2. reads the roster (--roster / TK_STUDIO_ROSTER, else the channel's file
#      on main) and takes components.cli; no cli entry exits non-zero with
#      CliNotShipped
#   3. downloads the meta-CLI wheel, verifies its SHA-256 against the roster,
#      then runs `uv tool install --force <wheel>` with
#      UV_TOOL_BIN_DIR=<root>/bin
#   4. puts only <root>/bin on PATH: one marked line in ~/.profile, and in
#      ~/.zprofile (macOS or zsh) and ~/.bash_profile or ~/.bash_login
#      (when present);
#      idempotent
#   5. turns on long paths for git (git config --global core.longpaths true)
# It never clones a repository and never resolves a "latest" release.
# <root>: Linux ${XDG_DATA_HOME:-~/.local/share}/tk-studio,
#         macOS ~/Library/Application Support/tk-studio.
# Then run: tk-studio install
set -eu

UV_VERSION=0.13.1
UV_SHA256_X86_64_LINUX=eadd9d27c134ab5ac1ffd4473b97a741407f3ea238288f03121fc4deddf90220
UV_SHA256_AARCH64_DARWIN=cfe454573412ff7380d15fc7dae5997ab53ffce72fce0a78e91ddbc84001acd2

CHANNEL="${TK_STUDIO_CHANNEL:-stable}"
ROSTER="${TK_STUDIO_ROSTER:-}"
MARK="# tk-studio bin (install.sh)"

fail() {
  echo "$1: $2" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --channel) CHANNEL="${2:?--channel needs a value}"; shift 2 ;;
    --roster) ROSTER="${2:?--roster needs a value}"; shift 2 ;;
    *) fail UsageError "unknown argument $1 (use --channel stable|latest, --roster PATH|URL)" ;;
  esac
done
case "$CHANNEL" in
  stable|latest) ;;
  *) fail UsageError "channel '$CHANNEL' is not stable or latest" ;;
esac

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64|Linux-amd64)
    UV_TARGET=x86_64-unknown-linux-gnu; UV_SHA256="$UV_SHA256_X86_64_LINUX"
    ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/tk-studio" ;;
  Darwin-arm64|Darwin-aarch64)
    UV_TARGET=aarch64-apple-darwin; UV_SHA256="$UV_SHA256_AARCH64_DARWIN"
    ROOT="$HOME/Library/Application Support/tk-studio" ;;
  *) fail PlatformNotPinned "no pinned uv for $(uname -s)-$(uname -m)" ;;
esac

BIN="$ROOT/bin"
TOOLS="$ROOT/tools"
UV_DIR="$TOOLS/uv-$UV_VERSION"
UV="$UV_DIR/uv"
mkdir -p "$BIN" "$TOOLS"
WORK="$(mktemp -d "$TOOLS/.bootstrap.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --proto '=https' -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail NoDownloader "neither curl nor wget is installed"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

get_verified() {
  download "$1" "$3"
  got="$(sha256_of "$3")"
  if [ "$got" != "$2" ]; then
    rm -f "$3"
    fail DigestMismatch "$1 sha256 $got != pinned $2"
  fi
}

# 1. uv, pinned and unmanaged
if [ ! -x "$UV" ]; then
  get_verified "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$UV_TARGET.tar.gz" \
    "$UV_SHA256" "$WORK/uv.tar.gz"
  mkdir "$WORK/uv"
  tar -xzf "$WORK/uv.tar.gz" -C "$WORK/uv"
  rm -rf "$UV_DIR"
  mv "$WORK/uv/uv-$UV_TARGET" "$UV_DIR"
fi
echo "uv $UV_VERSION at $UV"

# 2. the roster's cli entry
if [ -z "$ROSTER" ]; then
  ROSTER="https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/rosters/$CHANNEL.json"
fi
case "$ROSTER" in
  https://*) download "$ROSTER" "$WORK/roster.json" ;;
  *) cp "$ROSTER" "$WORK/roster.json" ;;
esac
CLI_FIELDS="$("$UV" run --no-project python -c '
import json, sys
cli = json.load(open(sys.argv[1], encoding="utf-8")).get("components", {}).get("cli")
print("" if not cli else cli["url"] + " " + cli["sha256"])
' "$WORK/roster.json")"
[ -n "$CLI_FIELDS" ] || fail CliNotShipped "$ROSTER has no components.cli: no meta-CLI release in this channel yet"
WHEEL_URL="${CLI_FIELDS% *}"
WHEEL_SHA="${CLI_FIELDS#* }"
case "$WHEEL_URL" in
  https://github.com/*/releases/download/cli--v*/*.whl) ;;
  *) fail RosterInvalid "components.cli.url '$WHEEL_URL' is not a cli--v release wheel" ;;
esac

# 3. the wheel: verified, then installed
mkdir -p "$TOOLS/wheels"
WHEEL="$TOOLS/wheels/${WHEEL_URL##*/}"
get_verified "$WHEEL_URL" "$WHEEL_SHA" "$WORK/${WHEEL_URL##*/}"
mv -f "$WORK/${WHEEL_URL##*/}" "$WHEEL"
UV_TOOL_BIN_DIR="$BIN" UV_TOOL_DIR="$TOOLS/uv-tools" "$UV" tool install --force "$WHEEL" \
  || fail CliInstallFailed "uv tool install exited non-zero"

# 4. only <root>/bin on PATH: the same marked line in ~/.profile, plus
#    ~/.zprofile on macOS or under zsh (zsh never reads ~/.profile) and
#    ~/.bash_profile (or ~/.bash_login) when it exists (bash then skips
#    ~/.profile)
add_path_line() {
  if ! grep -qF "$MARK" "$1" 2>/dev/null; then
    printf '\nexport PATH="%s:$PATH" %s\n' "$BIN" "$MARK" >> "$1"
    echo "added $BIN to PATH in $1 (new shells see it)"
  fi
}
add_path_line "$HOME/.profile"
case "$(uname -s):${SHELL:-}" in
  Darwin:*|*:*/zsh) add_path_line "$HOME/.zprofile" ;;
esac
if [ -f "$HOME/.bash_profile" ]; then
  add_path_line "$HOME/.bash_profile"
elif [ -f "$HOME/.bash_login" ]; then
  add_path_line "$HOME/.bash_login"
fi

# 5. long paths for git
if command -v git >/dev/null 2>&1; then
  git config --global core.longpaths true
  echo "git: core.longpaths true"
else
  echo "git not found: core.longpaths not set (run: git config --global core.longpaths true once git is installed)"
fi

echo
echo "tk-studio meta-CLI installed. Next: \"$BIN/tk-studio\" install   (then: tk-studio status)"
