"""The Story 34.6 e2e drive — the asset manifest check, both verdicts.

`assets.py check` is an engine verify command (it runs in the sandbox: the
stdlib only, no Blender), so this drive proves it the way a verify gate
runs it, over the shipped fixtures:

    valid    `fixtures/asset-manifest/valid` (two entries, one `.glb` in
             budget under the default art path, one absent) → exit 0,
             status `complete`, intent `assets`, the present entry `pass`
             with its facts (12 triangles, `base-center`, UVs, one
             material), the absent one `missing`
    invalid  `fixtures/asset-manifest/invalid` (one closed-set violation,
             `category: monster`) → exit 2, status `blocked`, the reason
             naming the entry and the field

The drive prints one JSON object {ok, steps[]} and exits nonzero on a red
step. Stdlib-only (NFR9); never prompts (AD-11); each call bounded.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
ASSETS = PLUGIN_ROOT / "lib" / "assets.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "asset-manifest"
CALL_BOUND_S = 20
BLOCK_KEYS = ["status", "intent", "artifacts", "reason"]


def _check(project: Path) -> tuple[int, dict | None]:
    proc = subprocess.run(
        [sys.executable, str(ASSETS), "check", "--directory", str(project)],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=CALL_BOUND_S)
    try:
        out = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return proc.returncode, None
    return proc.returncode, out if isinstance(out, dict) else None


def _block_ok(out: dict) -> bool:
    return list(out)[-4:] == BLOCK_KEYS and out.get("intent") == "assets"


def run() -> dict:
    steps: list[dict] = []
    code, out = _check(FIXTURES / "valid")
    entries = {e.get("name"): e for e in (out or {}).get("entries") or []}
    crate, barrel = entries.get("crate-small") or {}, entries.get("barrel") or {}
    facts = crate.get("facts") or {}
    ok = (code == 0 and out is not None and _block_ok(out) and out["status"] == "complete"
          and crate.get("verdict") == "pass" and crate.get("rung") == "greybox"
          and crate.get("status") == "placeholder" and facts.get("triangles") == 12
          and facts.get("origin") == "base-center" and facts.get("uv") is True
          and facts.get("materials") == 1 and barrel.get("verdict") == "missing")
    steps.append({"step": "valid", "ok": ok,
                  "detail": f"exit {code}; " + ", ".join(
                      f"{n}: {e.get('verdict')}" for n, e in entries.items())})
    code, out = _check(FIXTURES / "invalid")
    reason = (out or {}).get("reason") or ""
    ok = (code == 2 and out is not None and _block_ok(out) and out["status"] == "blocked"
          and "entry crate-small" in reason and "category" in reason and "monster" in reason)
    steps.append({"step": "invalid", "ok": ok, "detail": f"exit {code}; {reason}"})
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    del argv  # no arguments: the fixtures ship beside the drive
    try:
        result = run()
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
