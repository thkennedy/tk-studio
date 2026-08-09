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
  unrunnable-core         the SKILL.md documents the unrunnable-core
                          discipline: a core the skill cannot run (tool call
                          denied, interpreter unavailable) ends blocked with
                          the status block naming the gap — never a question
                          (AD-11)
  auth-preflight          the manifest declares how the surface satisfies
                          the auth preflight; a surface making external
                          calls may not declare "none"
  headless drives         the deterministic core is driven headless in a
                          throwaway sandbox (isolated TK_STUDIO_HOME, stdin
                          closed, wall-clock bounded): output is JSON, and
                          ambiguity ends in a clean refusal — blocked, not
                          a hang, never a prompt (AD-11)
  harness drives          (opt-in: --harness) the surface is driven through
                          the real harness (claude -p) under a permission
                          profile denying its deterministic core; the
                          transcript must end in a `blocked` terminal status
                          block naming the gap — the layer PROP-005's live
                          failure escaped: a denied core left the skill
                          asking a question with no block (ST-049, AD-11).
                          Spend-bearing, so never part of the default pass.

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
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

MANIFEST_PATH = Path(__file__).resolve().parent / "manifest.json"
STATUS_SCHEMA_PATH = PLUGIN_ROOT / "contracts" / "status-block.schema.json"

DEFAULT_TIMEOUT = 60
HARNESS_TIMEOUT = 180  # harness drives carry an LLM turn — a wider bound


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


def _check_unrunnable_core_doc(surface: str, skills_dir: Path) -> dict:
    """SKILL.md documents the unrunnable-core discipline: a core the skill
    cannot run (tool call denied, interpreter unavailable) ends blocked with
    the status block naming the gap — never a question, never a run that
    ends without the block (AD-11). Surfaced by the connector's live probe:
    a permission-denied core left a skill asking the user a question with
    no terminal status block."""
    check = {"assertion": "unrunnable-core", "ok": False, "detail": ""}
    text = (skills_dir / surface / "SKILL.md").read_text(encoding="utf-8")
    # the canonical sentence prefix, not a loose substring — every SKILL.md
    # already says "blocked" somewhere, so anything weaker is vacuous
    if "If the deterministic core is unrunnable" not in text:
        check["detail"] = ("SKILL.md does not document the unrunnable-core "
                           "discipline (the canonical 'If the deterministic "
                           "core is unrunnable' paragraph — end blocked with "
                           "the status block naming the gap, AD-11)")
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
    elif expect == "ok":
        # json with teeth: the drive's own assertions must all have held
        # (ok=true in the parsed output) — used by e2e drives whose value
        # is the chain succeeding, not merely answering
        if parsed is None:
            check["detail"] = f"stdout is not JSON (exit {proc.returncode})"
        elif not (isinstance(parsed, dict) and parsed.get("ok") is True):
            failed = ""
            if isinstance(parsed, dict):
                failed = (parsed.get("error")
                          or "; ".join(f"{s.get('step')}: {s.get('detail')}"
                                       for s in parsed.get("steps", [])
                                       if not s.get("ok")))
            check["detail"] = (f"drive assertions failed (exit "
                              f"{proc.returncode}): {failed or 'ok!=true'}")
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


# ---------------------------------------------------------- harness drives

def evaluate_harness_transcript(stdout: str, *, assertion: str = "harness-blocked",
                                surface: str | None = None,
                                timed_out: bool = False, timeout: int = 0,
                                marker: str | None = None) -> dict:
    """Assert a harness transcript ends in a `blocked` terminal status block.

    The layer under test is the skill instruction layer above the
    deterministic core: under a permission profile denying the core, the
    run must end with the block naming the gap. A question, free text, or
    silence is exactly the failure PROP-005 observed live (AD-11) — and a
    `complete` block under a denied core is a lie, not a pass."""
    check = {"assertion": assertion, "ok": False, "detail": ""}
    if timed_out:
        check["detail"] = (f"hung past {timeout}s — a prompt or wait, never "
                           "allowed headless (AD-11)")
        return check
    block = None
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith('{"status"'):
            try:
                block = json.loads(line)
            except json.JSONDecodeError:
                pass  # a broken terminal block is no terminal block
            break
    if block is None:
        check["detail"] = ("transcript ends without a terminal status block "
                           "— a question or free text is not a refusal "
                           "(AD-11: the block names the gap)")
        return check
    schema = json.loads(STATUS_SCHEMA_PATH.read_text(encoding="utf-8"))
    props = set(schema["properties"])
    missing = [k for k in schema["required"] if k not in block]
    extra = [k for k in block if k not in props]
    if missing or extra:
        check["detail"] = (f"terminal block vs schema: missing {missing}, "
                           f"extra {extra}")
        return check
    if block["status"] != "blocked":
        check["detail"] = (f"expected status 'blocked' under a denied core, "
                           f"got '{block['status']}'")
        return check
    if surface is not None and block.get("intent") != surface:
        check["detail"] = (f"block intent '{block.get('intent')}' does not "
                           f"name the surface '{surface}'")
        return check
    reason = block.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        check["detail"] = ("blocked block carries no reason naming the "
                           "unrunnable core")
        return check
    if marker is not None and marker not in reason:
        check["detail"] = (f"reason does not name the declared marker "
                           f"{marker!r}: got {reason[:120]!r}")
        return check
    check["ok"] = True
    return check


def _run_harness_drive(surface: str, drive: dict, timeout: int) -> dict:
    """One harness drive: the surface driven through the real harness
    (claude -p) under the drive's permission profile; the transcript is
    judged by evaluate_harness_transcript. Spend-bearing — reached only
    through the opt-in harness pass, never the default suite."""
    assertion = drive.get("assertion", "harness-blocked")
    bound = int(drive.get("timeout", timeout))
    exe = shutil.which("claude")
    if exe is None:
        return {"assertion": assertion, "ok": False,
                "detail": "claude CLI not on PATH — the harness pass "
                          "cannot run on this machine"}
    argv = [exe, "-p", drive["prompt"], "--output-format", "text"]
    settings = drive.get("settings")
    if settings:
        argv += ["--settings",
                 str(Path(__file__).resolve().parent / settings)]
    # harness drives run where the plugin is loadable: the repo root above
    # the plugin when this is the studio repo, else the plugin root itself
    repo_root = PLUGIN_ROOT.parent.parent
    cwd = repo_root if (repo_root / ".claude-plugin").is_dir() else PLUGIN_ROOT
    try:
        proc = subprocess.run(
            argv, stdin=subprocess.DEVNULL, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=bound, cwd=str(cwd))
    except subprocess.TimeoutExpired:
        return evaluate_harness_transcript(
            "", assertion=assertion, surface=surface,
            timed_out=True, timeout=bound)
    return evaluate_harness_transcript(
        proc.stdout, assertion=assertion, surface=surface,
        marker=drive.get("marker") or None)


# -------------------------------------------------------------------- run

def run_suite(skills_dir: Path | None = None, manifest_path: Path | None = None,
              timeout: int = DEFAULT_TIMEOUT, emit: bool = True,
              harness: bool = False) -> dict:
    """Drive every shipped surface; return the report. Emits headless-failure
    events for every failed check unless emit=False. Harness drives
    (expect: harness-blocked) are spend-bearing and run only when
    harness=True; otherwise each is reported as a named skip — loud,
    never silent (ST-049)."""
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
        checks.append(_check_unrunnable_core_doc(surface, skills))
        checks.append(_check_auth_preflight(entry))
        with tempfile.TemporaryDirectory(prefix="tk-conformance-") as tmp:
            sandbox = Path(tmp) / "project"
            store = Path(tmp) / "store"
            sandbox.mkdir()
            store.mkdir()
            for drive in entry.get("drives", []):
                if drive.get("expect") == "harness-blocked":
                    if harness:
                        checks.append(_run_harness_drive(
                            surface, drive, HARNESS_TIMEOUT))
                    else:
                        checks.append({
                            "assertion": drive.get("assertion",
                                                   "harness-blocked"),
                            "ok": True,
                            "detail": "skipped: harness pass not enabled "
                                      "(--harness) — spend-bearing drive"})
                    continue
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
    cmd.add_argument("--harness", action="store_true",
                     help="include spend-bearing harness drives (the surface "
                          "driven through the real claude CLI under a "
                          "denying permission profile)")
    args = parser.parse_args(argv)

    try:
        report = run_suite(timeout=args.timeout, emit=not args.no_emit,
                           harness=args.harness)
    except ConformanceError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
