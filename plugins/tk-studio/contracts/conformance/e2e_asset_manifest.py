"""The Story 34.6 e2e drive — the asset manifest check, both verdicts —
and Story 34.7's ladder refusals and the mirror index.

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

Story 34.7's steps run over `fixtures/asset-manifest/ladder` (one cc0
entry, one generated entry, no greybox in place) and
`fixtures/asset-manifest/kit/fixture-kit` (a licence file and one `.glb`),
copied to a temp folder so the shipped fixtures are never written:

    no-cap       `generate` with no `.tk-studio/budget-bands.yaml` → exit 2,
                 blocked, the reason naming `assets.credit_cap`
    no-key       `generate` with `assets.credit_cap` set and no
                 `TK_ASSETS_MESHY_KEY` in the env → exit 2, blocked naming
                 the variable (on a box whose user holds the key in
                 HKCU\\Environment the refusal is `--blender`'s, which names
                 no file: still before any call, reported in the detail)
    no-mirror    `match` with `TK_ASSETS_MIRROR` naming no folder → exit 0,
                 complete, the cc0 entry `skipped` with `no mirror` (on a
                 box whose user holds the mirror in HKCU\\Environment the
                 mirror resolves and the entry is still not placed,
                 reported in the detail)
    mirror-index `mirror-index` over two copies of the kit → the same
                 `index.json` bytes, the `.glb` indexed with its tags

No step runs Blender or reaches the network.

The drive prints one JSON object {ok, steps[]} and exits nonzero on a red
step. Stdlib-only (NFR9); never prompts (AD-11); each call bounded.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
ASSETS = PLUGIN_ROOT / "lib" / "assets.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "asset-manifest"
CALL_BOUND_S = 20
BLOCK_KEYS = ["status", "intent", "artifacts", "reason"]


def _assets(*args: str, env: dict | None = None) -> tuple[int, dict | None]:
    proc = subprocess.run(
        [sys.executable, str(ASSETS), *args],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=CALL_BOUND_S, env=env)
    try:
        out = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return proc.returncode, None
    return proc.returncode, out if isinstance(out, dict) else None


def _check(project: Path) -> tuple[int, dict | None]:
    return _assets("check", "--directory", str(project))


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
    temp = Path(tempfile.mkdtemp(prefix="tk-e2e-ladder-"))
    try:
        steps.extend(_ladder_steps(temp))
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def _ladder_steps(temp: Path) -> list[dict]:
    steps: list[dict] = []
    env = {k: v for k, v in os.environ.items()
           if k not in ("TK_ASSETS_MESHY_KEY", "TK_ASSETS_MIRROR", "BLENDER")}
    env["TK_STUDIO_HOME"] = str(temp / "home")
    project = temp / "ladder"
    shutil.copytree(FIXTURES / "ladder", project)
    manifest = (project / "assets" / "manifest.yaml").read_bytes()
    absent = str(temp / "no-such-blender.exe")
    code, out = _assets("generate", "--directory", str(project), "--run-id", "conformance",
                        "--blender", absent, env=env)
    reason = (out or {}).get("reason") or ""
    ok = (code == 2 and out is not None and _block_ok(out) and out["status"] == "blocked"
          and "assets.credit_cap" in reason)
    steps.append({"step": "no-cap", "ok": ok, "detail": f"exit {code}; {reason}"})
    bands = project / ".tk-studio" / "budget-bands.yaml"
    bands.parent.mkdir(parents=True, exist_ok=True)
    bands.write_text("assets:\n  credit_cap: 40\n", encoding="utf-8")
    code, out = _assets("generate", "--directory", str(project), "--run-id", "conformance",
                        "--blender", absent, env=env)
    reason = (out or {}).get("reason") or ""
    blocked = code == 2 and out is not None and _block_ok(out) and out["status"] == "blocked"
    named = "TK_ASSETS_MESHY_KEY" in reason
    held = os.name == "nt" and "no blender" in reason  # the key is this user's, by name
    ok = blocked and (named or held)
    detail = f"exit {code}; {reason}"
    if blocked and held and not named:
        detail += " (TK_ASSETS_MESHY_KEY is set for this user: refused at --blender, no call)"
    steps.append({"step": "no-key", "ok": ok, "detail": detail})
    env_mirror = dict(env, TK_ASSETS_MIRROR=str(temp / "no-such-mirror"))
    code, out = _assets("match", "--directory", str(project), env=env_mirror)
    rows = {e.get("name"): e for e in (out or {}).get("entries") or []}
    crate = rows.get("crate-small") or {}
    settled = (code == 0 and out is not None and _block_ok(out) and out["status"] == "complete"
               and "lamp-post" not in rows)
    named = (crate.get("action") == "skipped"
             and str(crate.get("reason") or "").startswith("no mirror"))
    # the override names no folder, so a resolved mirror on Windows can only be
    # this user's HKCU\Environment value (it wins); the cc0 entry still not placed
    held = (os.name == "nt" and out is not None and out.get("mirror") is not None
            and crate.get("action") in ("skipped", "unmatched"))
    ok = settled and (named or held)
    detail = f"exit {code}; " + ", ".join(
        f"{n}: {e.get('action')} ({e.get('reason')})" for n, e in rows.items())
    if settled and held and not named:
        detail += " (TK_ASSETS_MIRROR is set for this user: the mirror resolved, nothing placed)"
    steps.append({"step": "no-mirror", "ok": ok, "detail": detail})
    unchanged = (project / "assets" / "manifest.yaml").read_bytes() == manifest
    if not unchanged:
        steps[-1]["ok"] = False
        steps[-1]["detail"] += "; the manifest changed"
    indexes = []
    for copy in ("one", "two"):
        kit = temp / copy / "fixture-kit"
        shutil.copytree(FIXTURES / "kit" / "fixture-kit", kit)
        code, out = _assets("mirror-index", "--kit", str(kit), "--category", "prop", env=env)
        index = kit / "index.json"
        indexes.append((code, out, index.read_bytes() if index.is_file() else None))
    (c1, o1, b1), (c2, _o2, b2) = indexes
    try:
        doc = json.loads(b1) if b1 else {}
    except json.JSONDecodeError:
        doc = {}
    ok = (c1 == 0 and c2 == 0 and o1 is not None and _block_ok(o1)
          and o1["status"] == "complete" and b1 is not None and b1 == b2
          and doc.get("kit") == "fixture-kit" and doc.get("licence") == "cc0"
          and doc.get("licence_file") == "LICENSE.txt"
          and doc.get("assets") == [{"path": "Models/crateWooden.glb", "category": "prop",
                                     "tags": ["crate", "models", "wooden"]}])
    steps.append({"step": "mirror-index", "ok": ok,
                  "detail": f"exit {c1}/{c2}; same bytes: {b1 == b2}; "
                            f"assets: {len(doc.get('assets') or [])}"})
    return steps


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
