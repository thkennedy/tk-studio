"""tk-studio conformance suite runner (ST-5.4, AD-19).

A studio surface is not done until this suite passes it. For every shipped
skill (discovered from the plugin's skills/ tree — never from the manifest
alone) the runner asserts, per the driver contract:

  registered              the surface has a manifest entry; an unregistered
                          surface fails the suite, as does a stale manifest
                          entry with no shipped skill behind it
  status-block            the SKILL.md documents its terminal status block
                          and the example validates against
                          status-block.schema.json (the driven plugin's
                          own copy) with the right intent
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
                          a hang, never a prompt (AD-11). `expect:
                          status-block` (Story 26.1) judges the core's one
                          JSON object as ending with the status block —
                          the judge cli drives use — with the declared
                          `status` when the drive names one, else any
                          schema-valid status at exit 0 or 2
  harness drives          (opt-in: --harness) the surface is driven through
                          the real harness (claude -p) under a permission
                          profile denying its deterministic core; the
                          transcript must end in a `blocked` terminal status
                          block naming the gap — the layer PROP-005's live
                          failure escaped: a denied core left the skill
                          asking a question with no block (ST-049, AD-11).
                          Spend-bearing, so never part of the default pass.
  harness-loadable        (suite-level; --from-archive <zip>) the built zip
                          is safe-extracted into a clean CLAUDE_CONFIG_DIR
                          skills folder (<tmp>/config/skills/tk-studio/) and
                          every drive runs from there, never the repository
                          tree: the folder's plugin.json must parse with name
                          tk-studio and a version, a skills/ tree must sit at
                          its root — judged before any surface is driven —
                          and its skills set must equal the surfaces
                          discovered (AD-21). Without the flag the report
                          names the skip — never a pass.
  cli drives              (suite-level; manifest `cli_drives`) the meta-CLI
                          located from the runner's repository checkout
                          (tools/installer/cli) is driven headless in a
                          throwaway home: stdout is exactly one JSON object
                          ending with the status block, whose projection
                          validates against the schema (Story 25.5). No
                          checkout beside the runner: each drive is recorded
                          as not run, never a failure.

Every failed check emits a `headless-failure` measurement event naming the
surface and assertion (taxonomy §headless-failure — this runner is that
event's sole emitter). The suite is the v1 maintenance job type's target
(AD-10/ST-6.3): direct invocation now, the reference harness through the
driver contract once the connector exists.

CLI:
  uv run runner.py run [--no-emit] [--timeout SECONDS] [--harness]
                       [--from-archive ZIP]

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
import zipfile
import zlib
from pathlib import Path, PurePosixPath, PureWindowsPath

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[4]   # the checkout, if any
sys.path.insert(0, str(PLUGIN_ROOT / "lib"))

MANIFEST_PATH = Path(__file__).resolve().parent / "manifest.json"
STATUS_SCHEMA_PATH = PLUGIN_ROOT / "contracts" / "status-block.schema.json"

DEFAULT_TIMEOUT = 60
HARNESS_TIMEOUT = 180  # harness drives carry an LLM turn — a wider bound
PLUGIN_NAME = "tk-studio"
HARNESS_LOADABLE_SKIPPED = "skipped: --from-archive not given"


class ConformanceError(Exception):
    """The suite itself cannot run (unreadable manifest, no skills tree)."""


def discover_surfaces(skills_dir: Path | None = None) -> list[str]:
    """Shipped surfaces = every skills/*/SKILL.md — the plugin is the truth."""
    directory = Path(skills_dir) if skills_dir else PLUGIN_ROOT / "skills"
    if not directory.is_dir():
        raise ConformanceError(f"skills tree missing at {directory}")
    return sorted(p.name for p in directory.iterdir()
                  if p.is_dir() and (p / "SKILL.md").is_file())


def load_status_schema(schema_path: Path | None = None) -> dict:
    """The status-block schema the examples and transcripts are judged
    against — the driven plugin's own copy (the extracted folder's under
    --from-archive), never a silent fallback to the repository's."""
    path = Path(schema_path) if schema_path else STATUS_SCHEMA_PATH
    try:
        schema = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConformanceError(
            f"status-block schema unreadable at {path}: {exc}") from exc
    if not isinstance(schema, dict) \
            or not isinstance(schema.get("properties"), dict) \
            or not isinstance(schema.get("required"), list):
        raise ConformanceError(
            f"{path} carries no 'properties' map and 'required' list")
    return schema


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

def _check_status_block_doc(surface: str, skills_dir: Path,
                            schema: dict | None = None) -> dict:
    """SKILL.md documents the terminal status block; example validates
    against ``schema`` (default: the repository plugin's copy)."""
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
    schema = schema if schema is not None else load_status_schema()
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
               timeout: int, plugin_root: Path | None = None,
               env_overlay: dict | None = None,
               schema: dict | None = None) -> dict:
    """One headless drive: stdin closed, bounded, machine-readable out.
    ``plugin_root`` is the plugin tree the drive runs from (the extracted
    archive under --from-archive); ``env_overlay`` joins the child env;
    ``schema`` judges ``expect: status-block`` (default: the repository
    plugin's copy)."""
    root = Path(plugin_root) if plugin_root else PLUGIN_ROOT
    assertion = drive.get("assertion", "headless-drive")
    check = {"assertion": assertion, "ok": False, "detail": ""}
    argv = [a.replace("{sandbox}", str(sandbox)) for a in drive["argv"]]
    script = root / argv[0]
    if not script.is_file():
        check["detail"] = f"drive target {argv[0]} does not exist"
        return check
    env = {**os.environ, **(env_overlay or {}), "TK_STUDIO_HOME": str(store)}
    # A drive may carry its own `timeout` in the manifest (an e2e drive that
    # runs a bun suite needs more than the runner's cap); the cap is the default.
    bound = int(drive.get("timeout", timeout))
    try:
        # Every shipped CLI reconfigures its stdout to utf-8 (AD-11, enforced
        # by test_utf8_guard) — decode the same way, or Windows' cp1252
        # default mangles markers and can crash the suite on stray bytes.
        proc = subprocess.run(
            [sys.executable, str(script), *argv[1:]],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
            encoding="utf-8", errors="replace",
            timeout=bound, env=env, cwd=str(root))
    except subprocess.TimeoutExpired:
        check["detail"] = (f"hung past {bound}s — a prompt or wait, never "
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
    elif expect == "status-block":
        # a surface core whose every result ends with the block (Story
        # 26.1): the judge shared with cli drives, plus an optional
        # declared status; undeclared, any schema-valid status passes at
        # exit 0 (an answer) or 2 (a refusal) — exit 1 is unexpected. A
        # declared marker must appear in stdout: it proves the drive
        # reached the state it targets (a fixture that failed to resolve
        # blocks too, so the status alone cannot tell)
        schema = schema if schema is not None else load_status_schema()
        parsed, problem = _status_block_tail(stdout, proc.returncode, schema,
                                             drive.get("intent", surface))
        declared = drive.get("status")
        marker = drive.get("marker") or None  # empty marker declares nothing
        if problem:
            check["detail"] = problem
        elif marker is not None and marker not in stdout:
            check["detail"] = (f"output does not name the declared marker "
                              f"{marker!r} (exit {proc.returncode}) — the "
                              "drive never reached the state it targets: "
                              f"{parsed['reason']}")
        elif proc.returncode not in (0, 2):
            check["detail"] = (f"the core ended exit {proc.returncode} — a "
                               "status-block drive requires exit 0 (answer) "
                               "or 2 (refusal)")
        elif declared is not None and parsed["status"] != declared:
            check["detail"] = (f"status {parsed['status']!r}, the drive "
                               f"declares {declared!r}: {parsed['reason']}")
        else:
            check["ok"] = True
            check["detail"] = (f"one JSON object, status block last "
                               f"({parsed['status']}, exit {proc.returncode})")
    else:
        check["detail"] = f"manifest declares unknown expect '{expect}'"
    return check


# -------------------------------------------------------------- cli drives

BLOCK_KEYS = ("status", "intent", "artifacts", "reason")
CLI_SURFACE = "tk-studio-cli"


def _block_problem(block: dict, schema: dict, intent: str | None) -> str | None:
    """Why ``block`` (a status-block projection) fails ``schema``, or None."""
    props = schema["properties"]
    missing = [k for k in schema["required"] if k not in block]
    extra = [k for k in block if k not in props]
    if missing or extra:
        return f"block vs schema: missing {missing}, extra {extra}"
    if block["status"] not in props["status"]["enum"]:
        return f"status {block['status']!r} outside the enum"
    if not isinstance(block["intent"], str):
        return f"intent {block['intent']!r} is not a string"
    if intent is not None and block["intent"] != intent:
        return f"intent {block['intent']!r} is not {intent!r}"
    if not (isinstance(block["artifacts"], list)
            and all(isinstance(a, str) for a in block["artifacts"])):
        return f"artifacts {block['artifacts']!r} is not a list of strings"
    if "reason" in block and not (block["reason"] is None
                                  or isinstance(block["reason"], str)):
        return f"reason {block['reason']!r} is not a string or null"
    return None


def _status_block_tail(stdout: str, returncode: int, schema: dict,
                       intent: str | None) -> tuple[dict | None, str | None]:
    """(the parsed object, None) when ``stdout`` is exactly one JSON object
    whose last keys are the status block and whose projection validates
    against ``schema`` with ``intent``; (parsed-or-None, why) otherwise.
    The judge shared by cli drives and surface `status-block` drives."""
    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError:
        return None, (f"stdout is not exactly one JSON object (exit "
                      f"{returncode}): {stdout[:200]!r}")
    if not isinstance(parsed, dict):
        return None, "stdout is JSON but not an object"
    tail = tuple(list(parsed)[-len(BLOCK_KEYS):])
    if tail != BLOCK_KEYS:
        return parsed, (f"the object ends with {list(tail)}, not the "
                        f"status block {list(BLOCK_KEYS)}")
    problem = _block_problem({k: parsed[k] for k in BLOCK_KEYS}, schema, intent)
    return parsed, problem


def _run_cli_drive(drive: dict, schema: dict, timeout: int,
                   repo: Path | None = None) -> dict:
    """One meta-CLI drive (manifest ``cli_drives``), run from the runner's
    repository checkout in a throwaway home with no claude, sbx or git on
    PATH. A runner with no checkout beside it records the drive as not run
    (``ok`` true, ``state`` not run), never a failure."""
    repo = Path(repo) if repo else REPO_ROOT
    assertion = drive.get("assertion", "cli-drive")
    check = {"assertion": assertion, "ok": False, "detail": ""}
    cli = repo / drive["cli"]
    package = cli / drive["module"]
    if not (package / "__main__.py").is_file():
        check.update(ok=True, state="not run",
                     detail=f"not run: no CLI checkout at {package} (the "
                            "runner is not in a repository checkout)")
        return check
    argv = [a.replace("{repo}", str(repo)) for a in drive["argv"]]
    with tempfile.TemporaryDirectory(prefix="tk-conformance-cli-") as tmp:
        home = Path(tmp)
        empty_bin = home / "bin"
        empty_bin.mkdir()
        env = {k: v for k, v in os.environ.items()
               if not k.upper().startswith("TK_SUPERVISOR_")
               and k.upper() not in ("PATH", "PYTHONPATH")}
        env.update(TK_STUDIO_HOME=str(home / "store"),
                   CLAUDE_CONFIG_DIR=str(home / "config"),
                   XDG_DATA_HOME=str(home / "data"),
                   LOCALAPPDATA=str(home / "local"),
                   APPDATA=str(home / "roaming"), HOME=str(home / "home"),
                   PATH=str(empty_bin), PYTHONPATH=str(cli))
        try:
            proc = subprocess.run(
                [sys.executable, "-m", drive["module"], *argv],
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=timeout, env=env,
                cwd=str(home))
        except subprocess.TimeoutExpired:
            check["detail"] = (f"hung past {timeout}s — a prompt or wait, "
                               "never allowed headless (AD-11)")
            return check
    stdout = proc.stdout.strip()
    parsed, problem = _status_block_tail(stdout, proc.returncode, schema,
                                         drive.get("intent"))
    if parsed is None:
        check["detail"] = problem
        return check
    if drive.get("expect") != "status-block":
        check["detail"] = (f"manifest declares unknown cli expect "
                           f"'{drive.get('expect')}'")
        return check
    if problem:
        check["detail"] = problem
        return check
    if proc.returncode != 0 or parsed["status"] != "complete":
        check["detail"] = (f"the CLI ended exit {proc.returncode}, status "
                           f"'{parsed['status']}' — the drive requires exit "
                           "0 and status complete")
        return check
    check["ok"] = True
    check["detail"] = (f"one JSON object, status block last "
                       f"({parsed['status']}, exit {proc.returncode})")
    return check


# ---------------------------------------------------------- harness drives

def evaluate_harness_transcript(stdout: str, *, assertion: str = "harness-blocked",
                                surface: str | None = None,
                                timed_out: bool = False, timeout: int = 0,
                                marker: str | None = None,
                                schema: dict | None = None) -> dict:
    """Assert a harness transcript ends in a `blocked` terminal status block.

    The layer under test is the skill instruction layer above the
    deterministic core: under a permission profile denying the core, the
    run must end with the block naming the gap. A question, free text, or
    silence is exactly the failure PROP-005 observed live (AD-11) — and a
    `complete` block under a denied core is a lie, not a pass. ``schema``
    is the driven plugin's status-block schema (default: the repository
    plugin's copy)."""
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
    schema = schema if schema is not None else load_status_schema()
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


def _run_harness_drive(surface: str, drive: dict, timeout: int,
                       plugin_root: Path | None = None,
                       env_overlay: dict | None = None,
                       cwd: Path | None = None,
                       schema: dict | None = None) -> dict:
    """One harness drive: the surface driven through the real harness
    (claude -p) under the drive's permission profile; the transcript is
    judged by evaluate_harness_transcript. Spend-bearing — reached only
    through the opt-in harness pass, never the default suite. Under
    --from-archive the plugin root is the extracted folder, the env carries
    its CLAUDE_CONFIG_DIR, and ``cwd`` lies outside the repository."""
    root = Path(plugin_root) if plugin_root else PLUGIN_ROOT
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
                 str(root / "contracts" / "conformance" / settings)]
    if cwd is None:
        # harness drives run where the plugin is loadable: the repo root
        # above the plugin when this is the studio repo, else the plugin
        # root itself
        repo_root = root.parent.parent
        cwd = repo_root if (repo_root / ".claude-plugin").is_dir() else root
    archive_config = (env_overlay or {}).get("CLAUDE_CONFIG_DIR")
    if archive_config:
        _link_credentials(Path(archive_config))
    # the child gets an isolated store: even a mis-denying profile must not
    # let a live drive write measurement or run state into the real one
    with tempfile.TemporaryDirectory(prefix="tk-harness-") as tmp:
        env = {**os.environ, **(env_overlay or {}),
               "TK_STUDIO_HOME": str(Path(tmp) / "store")}
        try:
            proc = subprocess.run(
                argv, stdin=subprocess.DEVNULL, capture_output=True,
                text=True, encoding="utf-8", errors="replace",
                timeout=bound, cwd=str(cwd), env=env)
        except subprocess.TimeoutExpired:
            check = evaluate_harness_transcript(
                "", assertion=assertion, surface=surface,
                timed_out=True, timeout=bound)
        else:
            check = evaluate_harness_transcript(
                proc.stdout, assertion=assertion, surface=surface,
                marker=drive.get("marker") or None, schema=schema)
    if archive_config and not check["ok"]:
        check["detail"] += (" (the --from-archive config carries only a "
                            "symlinked .credentials.json from the operator's "
                            "config dir, when one exists there)")
    return check


def _link_credentials(config_dir: Path) -> None:
    """Symlink — never copy — the operator's .credentials.json into the
    archive config dir so a harness drive can authenticate (NFR5: the
    credentials are never copied or written anywhere). The operator's
    config dir is CLAUDE_CONFIG_DIR from the runner's own environment, else
    ~/.claude. Absent credentials or a failed symlink leave the drive to run
    and fail as it would."""
    real = os.environ.get("CLAUDE_CONFIG_DIR")
    source = (Path(real) if real else Path.home() / ".claude") \
        / ".credentials.json"
    link = Path(config_dir) / ".credentials.json"
    if os.path.lexists(link) or not source.is_file():
        return
    try:
        link.symlink_to(source)
    except (OSError, NotImplementedError):
        pass


# ------------------------------------------------- from-archive (AD-21)

def install_archive(archive: Path, config_dir: Path) -> Path:
    """Safe-extract the built plugin zip (members at the zip root) into a
    clean ``<config_dir>/skills/tk-studio/`` — the skills-dir folder the
    harness loads as tk-studio@skills-dir. Every member is vetted before
    anything is written: an absolute or ``..`` member is refused by name."""
    archive = Path(archive)
    try:
        bundle = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile, RuntimeError,
            NotImplementedError, EOFError) as exc:
        raise ConformanceError(
            f"--from-archive {archive}: not a readable zip ({exc})") from exc
    with bundle:
        for name in bundle.namelist():
            posix = PurePosixPath(name.replace("\\", "/"))
            if posix.is_absolute() or PureWindowsPath(name).drive \
                    or ".." in posix.parts:
                raise ConformanceError(
                    f"--from-archive {archive}: unsafe member {name!r} "
                    "(absolute or '..' path) — refused, nothing extracted")
        folder = Path(config_dir) / "skills" / PLUGIN_NAME
        folder.mkdir(parents=True)
        try:
            bundle.extractall(folder)
        except (OSError, zipfile.BadZipFile, RuntimeError,
                NotImplementedError, EOFError, zlib.error) as exc:
            # RuntimeError: an encrypted member; NotImplementedError: an
            # unsupported compression method — both become the AD-11 error
            raise ConformanceError(
                f"--from-archive {archive}: extraction failed ({exc})") from exc
    return folder


def check_harness_loadable(folder: Path, shipped: list[str] | None
                           ) -> tuple[dict, dict]:
    """(suite-level check, report field) for the skills-dir folder: its
    plugin.json parses with name tk-studio and a version, a skills/ tree
    sits at its root, and its skills set equals the surfaces discovered.
    ``shipped`` None checks the folder alone — the gate run before surface
    discovery, so a folder the harness cannot load (a wrapped zip: no
    skills/ at the root) is a named failure, never "skills tree missing"."""
    check = {"assertion": "harness-loadable", "ok": False, "detail": ""}
    field: dict = {"state": "failed", "folder": str(folder)}
    manifest = folder / ".claude-plugin" / "plugin.json"
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        check["detail"] = f"skills-dir {manifest} unreadable: {exc}"
        return check, field
    if not isinstance(data, dict) or data.get("name") != PLUGIN_NAME \
            or not isinstance(data.get("version"), str) \
            or not data["version"]:
        check["detail"] = (f"skills-dir {manifest} must carry name "
                           f"{PLUGIN_NAME!r} and a version")
        return check, field
    field["version"] = data["version"]
    skills_dir = folder / "skills"
    if not skills_dir.is_dir():
        check["detail"] = (f"skills-dir folder {folder} has no skills/ tree "
                           "at its root (members must sit at the zip root)")
        return check, field
    present = {p.name for p in skills_dir.iterdir()
               if p.is_dir() and not p.name.startswith(".")}
    if shipped is not None and present != set(shipped):
        extra = ", ".join(sorted(present - set(shipped)))
        absent = ", ".join(sorted(set(shipped) - present))
        check["detail"] = (f"skills-dir folder skills differ from the "
                           f"surfaces discovered (not loadable: {extra or '-'}; "
                           f"absent: {absent or '-'})")
        return check, field
    check["ok"] = True
    field["state"] = "ok"
    return check, field


# -------------------------------------------------------------------- run

def run_suite(skills_dir: Path | None = None, manifest_path: Path | None = None,
              timeout: int = DEFAULT_TIMEOUT, emit: bool = True,
              harness: bool = False, from_archive: Path | None = None) -> dict:
    """Drive every shipped surface; return the report. Emits headless-failure
    events for every failed check unless emit=False. Harness drives
    (expect: harness-blocked) are spend-bearing and run only when
    harness=True; otherwise each is reported as a named skip — loud,
    never silent (ST-049). ``from_archive`` installs the built zip into a
    clean CLAUDE_CONFIG_DIR skills folder and drives from there; surfaces,
    the manifest and drive scripts then come from that folder, never the
    repository tree (AD-21). Without it, harness-loadable is a named skip."""
    if from_archive is None:
        return _run_suite(Path(skills_dir) if skills_dir
                          else PLUGIN_ROOT / "skills",
                          manifest_path, timeout, emit, harness)
    with tempfile.TemporaryDirectory(prefix="tk-conformance-archive-") as tmp:
        config = Path(tmp) / "config"
        folder = install_archive(Path(from_archive), config)
        outside = Path(tmp) / "work"   # harness cwd outside the repo
        outside.mkdir()
        return _run_suite(
            folder / "skills",
            folder / "contracts" / "conformance" / "manifest.json",
            timeout, emit, harness, plugin_root=folder,
            env_overlay={"CLAUDE_CONFIG_DIR": str(config)},
            harness_cwd=outside)


def _run_suite(skills: Path, manifest_path: Path | None, timeout: int,
               emit: bool, harness: bool, plugin_root: Path | None = None,
               env_overlay: dict | None = None,
               harness_cwd: Path | None = None) -> dict:
    surfaces: dict[str, list[dict]] = {}
    cli_checks: list[dict] = []
    harness_declared = 0
    failures: list[dict] = []
    conformance_version = 1
    harness_state = None
    # harness-loadable is suite-level: read the skills-dir folder only when
    # the suite was driven from one — a repo-tree run is a named skip,
    # never a pass for the wrong reason. Under --from-archive the folder is
    # judged first: one the harness cannot load is a named failure and no
    # surface is driven from it
    if plugin_root is None:
        harness_loadable = {"state": HARNESS_LOADABLE_SKIPPED}
        gate = None
    else:
        gate, harness_loadable = check_harness_loadable(Path(plugin_root),
                                                        None)
    if gate is not None and not gate["ok"]:
        harness_state = "not run: the skills-dir folder is not harness-loadable"
        failures.append({"surface": PLUGIN_NAME, "assertion": gate["assertion"],
                         "detail": gate["detail"]})
    else:
        shipped = discover_surfaces(skills)
        manifest = load_manifest(manifest_path)
        conformance_version = manifest.get("conformance_version", 1)
        # the driven plugin's own schema: the extracted folder's under
        # --from-archive (absent there is an error, never the repo copy)
        schema = load_status_schema(
            Path(plugin_root) / "contracts" / "status-block.schema.json"
            if plugin_root is not None else None)
        surfaces, harness_declared = _drive_surfaces(
            shipped, manifest["surfaces"], skills, schema, timeout, harness,
            plugin_root, env_overlay, harness_cwd)
        failures = [{"surface": s, "assertion": c["assertion"],
                     "detail": c["detail"]}
                    for s, checks in surfaces.items()
                    for c in checks if not c["ok"]]
        cli_checks = [_run_cli_drive(d, schema, timeout)
                      for d in (manifest.get("cli_drives") or {})
                      .get("drives", [])]
        failures += [{"surface": CLI_SURFACE, "assertion": c["assertion"],
                      "detail": c["detail"]}
                     for c in cli_checks if not c["ok"]]
        if plugin_root is not None:
            loadable, harness_loadable = check_harness_loadable(
                Path(plugin_root), shipped)
            if not loadable["ok"]:
                failures.append({"surface": PLUGIN_NAME,
                                 "assertion": loadable["assertion"],
                                 "detail": loadable["detail"]})

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

    if harness_state is None:
        if harness_declared == 0:
            harness_state = "none declared"
        elif harness:
            harness_state = "ran"
        else:
            harness_state = "skipped: --harness not given (spend-bearing)"

    return {
        "conformance_version": conformance_version,
        "ok": not failures,
        "surfaces_checked": len(surfaces),
        "checks_run": sum(len(c) for c in surfaces.values()),
        # the harness pass is never a silent cap: the report always names
        # whether spend-bearing drives ran, were skipped, or don't exist
        "harness_pass": {"declared": harness_declared,
                         "state": harness_state},
        # the skills-dir folder check names whether it ran (AD-21)
        "harness_loadable": harness_loadable,
        "failures": failures,
        "surfaces": surfaces,
        # the meta-CLI's drives (Story 25.5), outside the skill surfaces
        "cli_drives": cli_checks,
    }


def _drive_surfaces(shipped: list[str], registered: dict, skills: Path,
                    schema: dict, timeout: int, harness: bool,
                    plugin_root: Path | None, env_overlay: dict | None,
                    harness_cwd: Path | None
                    ) -> tuple[dict[str, list[dict]], int]:
    """(per-surface checks, harness drives declared) for every shipped
    surface, plus a stale-entry failure per manifest entry with no shipped
    skill behind it."""
    surfaces: dict[str, list[dict]] = {}
    harness_declared = 0
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
        checks.append(_check_status_block_doc(surface, skills, schema))
        checks.append(_check_unrunnable_core_doc(surface, skills))
        checks.append(_check_auth_preflight(entry))
        with tempfile.TemporaryDirectory(prefix="tk-conformance-") as tmp:
            sandbox = Path(tmp) / "project"
            store = Path(tmp) / "store"
            sandbox.mkdir()
            store.mkdir()
            for drive in entry.get("drives", []):
                if drive.get("expect") == "harness-blocked":
                    harness_declared += 1
                    if harness:
                        checks.append(_run_harness_drive(
                            surface, drive, HARNESS_TIMEOUT,
                            plugin_root=plugin_root,
                            env_overlay=env_overlay, cwd=harness_cwd,
                            schema=schema))
                    else:
                        checks.append({
                            "assertion": drive.get("assertion",
                                                   "harness-blocked"),
                            "ok": True,
                            "detail": "skipped: harness pass not enabled "
                                      "(--harness) — spend-bearing drive"})
                    continue
                checks.append(_run_drive(surface, drive, sandbox, store,
                                         timeout, plugin_root=plugin_root,
                                         env_overlay=env_overlay,
                                         schema=schema))
        surfaces[surface] = checks

    for name in sorted(set(registered) - set(shipped)):
        surfaces[name] = [{"assertion": "registered", "ok": False,
                           "detail": "manifest entry has no shipped skill "
                                     "behind it (stale entry)"}]
    return surfaces, harness_declared


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
    cmd.add_argument("--from-archive", metavar="ZIP",
                     help="install the built plugin zip into a clean "
                          "CLAUDE_CONFIG_DIR skills folder and drive every "
                          "surface from there (the harness-loadable check)")
    args = parser.parse_args(argv)

    try:
        report = run_suite(timeout=args.timeout, emit=not args.no_emit,
                           harness=args.harness,
                           from_archive=(Path(args.from_archive)
                                         if args.from_archive else None))
    except ConformanceError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
