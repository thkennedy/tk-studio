"""tk-studio conformance suite runner (ST-5.4, AD-19).

A studio surface is not done until this suite passes it. For every shipped
skill (discovered from the plugin's skills/ tree — never from the manifest
alone) the runner asserts, per the driver contract:

  registered              the surface has a manifest entry; an unregistered
                          surface fails the suite, as does a stale manifest
                          entry with no shipped skill behind it
  status-block            the SKILL.md documents its terminal status block
                          and the example validates against
                          status-block.schema.json with the right intent
  auth-preflight          the manifest declares how the surface satisfies
                          the auth preflight; a surface making external
                          calls may not declare "none"
  headless drives         the deterministic core is driven headless in a
                          throwaway sandbox (isolated TK_STUDIO_HOME, stdin
                          closed, wall-clock bounded): output is JSON, and
                          ambiguity ends in a clean refusal — blocked, not
                          a hang, never a prompt (AD-11)

Every failed check emits a `headless-failure` measurement event naming the
surface and assertion (taxonomy §headless-failure — this runner is that
event's sole emitter). The suite is the v1 maintenance job type's target
(AD-10/ST-6.3): direct invocation now, the reference harness through the
driver contract once the connector exists.

CLI:
  uv run runner.py run [--no-emit] [--timeout SECONDS] [--json]

Exit codes: 0 all surfaces pass; 1 failures; 2 suite cannot run.
Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

MANIFEST_PATH = Path(__file__).resolve().parent / "manifest.json"
STATUS_SCHEMA_PATH = PLUGIN_ROOT / "contracts" / "status-block.schema.json"

DEFAULT_TIMEOUT = 60


class ConformanceError(Exception):
    """The suite itself cannot run (unreadable manifest, no skills tree)."""


def discover_surfaces(skills_dir: Path | None = None) -> list[str]:
    """Shipped surfaces = every skills/*/SKILL.md — the plugin is the truth."""
    directory = Path(skills_dir) if skills_dir else PLUGIN_ROOT / "skills"
    if not directory.is_dir():
        raise ConformanceError(f"skills tree missing at {directory}")
    return sorted(p.name for p in directory.iterdir()
                  if p.is_dir() and (p / "SKILL.md").is_file())


def load_manifest(manifest_path: Path | None = None) -> dict:
    path = Path(manifest_path) if manifest_path else MANIFEST_PATH
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConformanceError(f"conformance manifest unreadable: {exc}") from exc
    if "surfaces" not in manifest:
        raise ConformanceError(f"{path} has no 'surfaces' map")
    return manifest


# ------------------------------------------------------------------ checks

def _check_status_block_doc(surface: str, skills_dir: Path) -> dict:
    """SKILL.md documents the terminal status block; example validates."""
    check = {"assertion": "status-block", "ok": False, "detail": ""}
    text = (skills_dir / surface / "SKILL.md").read_text(encoding="utf-8")
    example = next((line.strip() for line in text.splitlines()
                    if line.strip().startswith('{"status"')), None)
    if example is None:
        check["detail"] = "SKILL.md documents no status-block example"
        return check
    try:
        block = json.loads(example)
    except json.JSONDecodeError as exc:
        check["detail"] = f"status-block example is not valid JSON: {exc}"
        return check
    schema = json.loads(STATUS_SCHEMA_PATH.read_text(encoding="utf-8"))
    props = set(schema["properties"])
    missing = [k for k in schema["required"] if k not in block]
    extra = [k for k in block if k not in props]
    if missing or extra:
        check["detail"] = (f"example vs schema: missing {missing}, extra {extra}")
        return check
    if block["status"] not in schema["properties"]["status"]["enum"]:
        check["detail"] = f"status '{block['status']}' outside the enum"
        return check
    if block["intent"] != surface:
        check["detail"] = (f"example intent '{block['intent']}' does not name "
                           f"the surface '{surface}'")
        return check
    check["ok"] = True
    return check


def _check_auth_preflight(entry: dict) -> dict:
    check = {"assertion": "auth-preflight", "ok": False, "detail": ""}
    declared = (entry.get("auth_preflight") or "").strip()
    if not declared:
        check["detail"] = "manifest entry declares no auth_preflight posture"
    elif entry.get("external_calls") and declared.lower().startswith("none"):
        check["detail"] = ("surface makes external calls but declares no "
                          "auth preflight")
    else:
        check["ok"] = True
    return check


def _run_drive(surface: str, drive: dict, sandbox: Path, store: Path,
               timeout: int) -> dict:
    """One headless drive: stdin closed, bounded, machine-readable out."""
    assertion = drive.get("assertion", "headless-drive")
    check = {"assertion": assertion, "ok": False, "detail": ""}
    argv = [a.replace("{sandbox}", str(sandbox)) for a in drive["argv"]]
    script = PLUGIN_ROOT / argv[0]
    if not script.is_file():
        check["detail"] = f"drive target {argv[0]} does not exist"
        return check
    env = dict(os.environ, TK_STUDIO_HOME=str(store))
    try:
        # Every shipped CLI reconfigures its stdout to utf-8 (AD-11, enforced
        # by test_utf8_guard) — decode the same way, or Windows' cp1252
        # default mangles markers and can crash the suite on stray bytes.
        proc = subprocess.run(
            [sys.executable, str(script), *argv[1:]],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
            encoding="utf-8", errors="replace",
            timeout=timeout, env=env, cwd=str(PLUGIN_ROOT))
    except subprocess.TimeoutExpired:
        check["detail"] = (f"hung past {timeout}s — a prompt or wait, never "
                          "allowed headless (AD-11)")
        return check
    stdout = proc.stdout.strip()
    parsed = None
    for candidate in (stdout, stdout.splitlines()[-1] if stdout else ""):
        try:
            parsed = json.loads(candidate)
            break
        except (json.JSONDecodeError, IndexError):
            continue

    expect = drive.get("expect", "json")
    if expect == "json":
        if parsed is None:
            check["detail"] = f"stdout is not JSON (exit {proc.returncode})"
        else:
            check["ok"] = True
    elif expect == "refusal":
        marker = drive.get("marker") or None  # empty marker declares nothing
        # A refusal is either out-of-band (nonzero exit / JSON ok=false) or
        # in-band: the core reports the block as data — detect's ask,
        # orchestrate's needs-onboarding — proven by the declared marker.
        # Either way a declared marker is a requirement, not an alternative:
        # the refusal must name its reason, or the skill layer has nothing
        # to surface as blocked (ISS-002 — a crash or unrelated error is
        # not a clean refusal).
        refused = (proc.returncode != 0
                   or (isinstance(parsed, dict) and parsed.get("ok") is False)
                   or (marker is not None and marker in stdout))
        if marker is not None and marker not in stdout:
            check["detail"] = (f"refusal does not name the declared marker "
                              f"{marker!r} (exit {proc.returncode}) — an "
                              "unnamed refusal cannot be surfaced as blocked")
        elif refused:
            check["ok"] = True
        else:
            check["detail"] = ("expected a clean refusal, got exit 0 with "
                              "ok!=false")
    else:
        check["detail"] = f"manifest declares unknown expect '{expect}'"
    return check


# -------------------------------------------------------------------- run

def run_suite(skills_dir: Path | None = None, manifest_path: Path | None = None,
              timeout: int = DEFAULT_TIMEOUT, emit: bool = True) -> dict:
    """Drive every shipped surface; return the report. Emits headless-failure
    events for every failed check unless emit=False."""
    skills = Path(skills_dir) if skills_dir else PLUGIN_ROOT / "skills"
    shipped = discover_surfaces(skills)
    manifest = load_manifest(manifest_path)
    registered = manifest["surfaces"]

    surfaces: dict[str, list[dict]] = {}
    for surface in shipped:
        checks: list[dict] = []
        entry = registered.get(surface)
        if entry is None:
            checks.append({"assertion": "registered", "ok": False,
                           "detail": "shipped surface has no conformance "
                                     "manifest entry (ST-5.4: unregistered "
                                     "surfaces fail the suite)"})
            surfaces[surface] = checks
            continue
        checks.append({"assertion": "registered", "ok": True, "detail": ""})
        checks.append(_check_status_block_doc(surface, skills))
        checks.append(_check_auth_preflight(entry))
        with tempfile.TemporaryDirectory(prefix="tk-conformance-") as tmp:
            sandbox = Path(tmp) / "project"
            store = Path(tmp) / "store"
            sandbox.mkdir()
            store.mkdir()
            for drive in entry.get("drives", []):
                checks.append(_run_drive(surface, drive, sandbox, store,
                                         timeout))
        surfaces[surface] = checks

    for name in sorted(set(registered) - set(shipped)):
        surfaces[name] = [{"assertion": "registered", "ok": False,
                           "detail": "manifest entry has no shipped skill "
                                     "behind it (stale entry)"}]

    failures = [{"surface": s, "assertion": c["assertion"], "detail": c["detail"]}
                for s, checks in surfaces.items()
                for c in checks if not c["ok"]]

    if emit and failures:
        import ledger
        for failure in failures:
            try:
                ledger.emit("headless-failure", {
                    "surface": failure["surface"],
                    "assertion": failure["assertion"],
                    "detail": failure["detail"] or "failed",
                })
            except Exception as exc:  # emission must never mask the report
                failure["emit_error"] = str(exc)

    return {
        "conformance_version": manifest.get("conformance_version", 1),
        "ok": not failures,
        "surfaces_checked": len(surfaces),
        "checks_run": sum(len(c) for c in surfaces.values()),
        "failures": failures,
        "surfaces": surfaces,
    }


# -------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console: payloads are
    # arbitrary unicode and must always print (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio conformance suite")
    sub = parser.add_subparsers(dest="command", required=True)
    cmd = sub.add_parser("run", help="drive every shipped surface headless")
    cmd.add_argument("--no-emit", action="store_true",
                     help="do not emit headless-failure events (local debugging)")
    cmd.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT,
                     help="per-drive wall clock in seconds")
    args = parser.parse_args(argv)

    try:
        report = run_suite(timeout=args.timeout, emit=not args.no_emit)
    except ConformanceError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
