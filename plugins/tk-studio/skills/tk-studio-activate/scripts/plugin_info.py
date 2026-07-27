"""Report plugin identity from wherever the plugin is installed.

Prints one JSON object: plugin root, name/version from plugin.json, and the
bmad.lock core pin. Exit 0 on success, 1 with {"error": ...} on any failure.

Stdlib-only (NFR9); bmad.lock's core version is extracted with a line scan so
no YAML dependency is needed.
"""

import json
import re
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[3]


def core_pin(lock_path: Path) -> str | None:
    in_core = False
    for line in lock_path.read_text(encoding="utf-8").splitlines():
        if re.match(r"^core:", line):
            in_core = True
            continue
        if in_core:
            if not line.startswith(" "):
                break
            m = re.match(r"^\s+version:\s*(\S+)", line)
            if m:
                return m.group(1)
    return None


def main() -> int:
    try:
        manifest = json.loads(
            (PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        lock = PLUGIN_ROOT / "bmad.lock"
        result = {
            "plugin_root": str(PLUGIN_ROOT),
            "name": manifest.get("name"),
            "version": manifest.get("version"),
            "bmad_core_pin": core_pin(lock) if lock.is_file() else None,
            "bmad_lock_present": lock.is_file(),
        }
    except (OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
