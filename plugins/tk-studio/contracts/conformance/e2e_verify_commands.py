"""The Story 33.5 e2e drive — the tracked [verify] commands reconciled.

The roster gate ran inside the engine only because the operator hand-edited
the gitignored `.bmad-loop/policy.toml` (runbook hole 62). The readiness
check now reconciles the policy's `[verify] commands` from a tracked list.
This drive proves it through the shipped CLI, exactly as a contract driver
runs it, in projects it builds inside the sandbox (never a tracked fixture):

    a policy with one operator extra + `.tk-studio/config.yaml`
    `engine.verify_commands` → `launch.py check` adds the tracked command
    after the extra, keeps the extra, reports the row and the key → a second
    check reports `unchanged` and leaves the file byte-identical → a project
    with no tracked list leaves its policy byte-identical

Every step is asserted; the drive prints one JSON object {ok, steps[]} and
exits nonzero on any failed assertion. Stdlib-only (NFR9); never prompts
(AD-11).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tomllib
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]

OPERATOR = "make lint"
TRACKED = "python -m unittest tests.test_release_roster"
SOURCE = ".tk-studio/config.yaml engine.verify_commands"
SPEC = "_bmad-output/specs/spec-none"
ROUTING = ("# >>> routing (managed by tk-studio lib/pipeline.py) — do not edit inside this block\n"
           "[adapter.dev]\nmodel = \"opus\"\n# <<< routing\n")
POLICY = ("[limits]\nmax_review_cycles = 3\n\n[verify]\n"
          f"commands = [{json.dumps(OPERATOR)}]\n\n" + ROUTING)


def _project(base: Path, name: str, config: str) -> Path:
    """A sandbox project of its own (its config anchors the nearest root)."""
    root = base / name
    (root / ".tk-studio").mkdir(parents=True, exist_ok=True)
    (root / ".tk-studio" / "config.yaml").write_text(config, encoding="utf-8")
    (root / ".bmad-loop").mkdir(parents=True, exist_ok=True)
    (root / ".bmad-loop" / "policy.toml").write_text(POLICY, encoding="utf-8")
    return root


def _check(root: Path) -> dict:
    """`launch.py check`, driven as a contract driver would (JSON on stdout)."""
    proc = subprocess.run(
        [sys.executable, str(PLUGIN_ROOT / "lib" / "launch.py"), "check",
         "--directory", str(root), "--spec", SPEC],
        stdin=subprocess.DEVNULL, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=60, cwd=str(PLUGIN_ROOT))
    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return {"error": f"launch.py check produced no JSON (exit {proc.returncode}): "
                         f"{proc.stdout.strip()[:200]!r}"}


def _row(result: dict) -> dict:
    return next((c for c in result.get("checks", [])
                 if c.get("check") == "verify commands"), {})


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(directory: str) -> dict:
    steps: list[dict] = []

    def step(name: str, ok: bool, detail: str = "") -> bool:
        steps.append({"step": name, "ok": ok, **({"detail": detail} if detail else {})})
        return ok

    base = Path(directory)
    tracked = _project(base, "verify-commands-tracked",
                       f"engine:\n  verify_commands:\n    - {TRACKED}\n")
    policy = tracked / ".bmad-loop" / "policy.toml"

    # 1 — the tracked command is added after the operator's extra, which stays
    first = _check(tracked)
    key = first.get("verify_commands") or {}
    try:
        commands = tomllib.loads(policy.read_text(encoding="utf-8"))["verify"]["commands"]
    except (OSError, tomllib.TOMLDecodeError, KeyError) as exc:
        commands = f"unreadable: {exc}"
    if not step("added-and-kept",
                key.get("source") == SOURCE and key.get("added") == [TRACKED]
                and key.get("kept") == [OPERATOR] and key.get("policy") == "written"
                and commands == [OPERATOR, TRACKED]
                and policy.read_text(encoding="utf-8").endswith(ROUTING),
                f"verify_commands={key} commands={commands}" if key else first.get("error", "")):
        return {"ok": False, "steps": steps}

    # 2 — the check reports it in its row
    row = _row(first)
    if not step("row-reported",
                row.get("ok") is True
                and row.get("detail") == f"added 1 from {SOURCE}; kept 1 operator commands",
                f"row={row}"):
        return {"ok": False, "steps": steps}

    # 3 — a second check: unchanged, byte-identical
    before = _sha(policy)
    second = _check(tracked)
    row = _row(second)
    if not step("second-check-unchanged",
                (second.get("verify_commands") or {}).get("policy") == "unchanged"
                and row.get("detail") == "unchanged (1 tracked, 1 operator)"
                and _sha(policy) == before,
                f"row={row}"):
        return {"ok": False, "steps": steps}

    # 4 — a project with no tracked list: its policy is byte-identical
    bare = _project(base, "verify-commands-none", "vcs: git\n")
    bare_policy = bare / ".bmad-loop" / "policy.toml"
    before = _sha(bare_policy)
    third = _check(bare)
    key = third.get("verify_commands") or {}
    if not step("no-list-unchanged",
                key.get("source") is None and key.get("policy") == "skipped (no tracked list)"
                and _row(third).get("detail") == "skipped (no tracked list)"
                and _sha(bare_policy) == before,
                f"verify_commands={key}"):
        return {"ok": False, "steps": steps}

    return {"ok": True, "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Story 33.5 e2e drive: the readiness check reconciles the "
                    "policy's [verify] commands from the tracked list")
    parser.add_argument("--directory", required=True, help="sandbox project")
    args = parser.parse_args(argv)
    try:
        result = run(args.directory)
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
