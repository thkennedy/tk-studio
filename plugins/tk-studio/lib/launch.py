"""tk-studio launch — start, inspect and stop the execution substrate for one
project epic (the `tk-studio-launch` surface; AD-2, AD-10, AD-11).

The studio pipeline (`agentic-pipeline-2026-09-02.md`, decision 5) routes
every run through the studio: a conformant driver (the studio supervisor,
Hermes as the front door that submits to it, or direct invocation —
driver-contract §1 driver roster) runs a `run-epic` job, the orchestrator
invokes this surface, and this core is the one place that talks to the
substrate — bmad-loop, driven only through its
CLI (`bmad-loop run|list|status|stop|validate`), never imported. The agent
side of the skill does the planner-tier work first (the epic SPEC, the first
story's task manifest); this core stays deterministic: readiness gates, a
pre-minted run id, a detached engine process, and JSON answers.

Verbs (all end with JSON on stdout; never prompt — AD-11):
  uv run launch.py check  --directory DIR --spec FOLDER
  uv run launch.py start  --directory DIR --spec FOLDER [--run-id ID] [--wait S]
                          [--allow-budget-mismatch]
  uv run launch.py status --directory DIR [--run-id ID]
  uv run launch.py stop   --directory DIR --run-id ID [--graceful]

Guarantees:
  - `start` never launches onto a checkout that already has a live engine
    (one engine per checkout — the merge gate and dispatch read the live
    tree and collide), never without a SPEC.md and a non-empty task
    manifest, and never past a failing `bmad-loop validate`; every gap is
    named (`gaps[]`), never guessed around.
  - The engine runs detached, with no console window (the operator's
    headless rule), its output captured to the per-user store —
    `~/.tk-studio/projects/<key>/launches/<run-id>.log` — never into the
    project tree (an untracked file there would dirty the checkout the
    engine's own preflight refuses to run on).
  - `start` answers `ok` only once the engine has written its
    `.bmad-loop/runs/<run-id>/state.json`; a launch the engine never
    acknowledged reports the pid and log instead of claiming success.
  - Every result — each verb's answer and every refusal — ends with the
    AD-11 status block keys, in order: `status`, `intent`
    ("tk-studio-launch"), `artifacts`, `reason` (driver-contract §3), so a
    skill path, fresh or relaunch, ends on the core's block.
  - `check` and `start` compare the engine's `.bmad-loop/policy.toml`
    `[limits]` (read-only, never edited) with the tracked
    `.tk-studio/budget-bands.yaml`: `budget.budget_mismatch[]` names every
    limit the largest band exceeds, with both numbers. A mismatch is never
    a gap (`ok` is unchanged): `check` ends `partial` naming it, and
    `start` refuses unless `--allow-budget-mismatch` is given (the skill's
    `allow_budget_mismatch: true` payload); a `start` refusal after its
    readiness check that found a mismatch carries the `budget` object too.
    A band whose compared field is not a number puts that limit under
    `not_compared`, never compared on the remaining bands.
  - `check` reports the engine sandbox (Story 33.3) as one advisory row,
    never a gap: a sandbox the supervisor config names that `sbx ls` lists
    as running with no supervisor pin record
    (`<store>/sandboxes/<sandbox>.pin`) is named as a warning ("started
    outside the supervisor; the next pin restarts it"). `sbx daemon status`
    runs before `sbx ls`, and no other sbx command runs.
  - `check` reports the playable path (Story 34.2) as one advisory row
    after the engine sandbox, never a gap: for a project whose tracked
    `.tk-studio/config.yaml` declares `verify.engine`, a `GODOT` that is
    unset or not an absolute file, or no display session for the ruled
    path (`PLAYABLE_PATH`, shared with `playable.py`), reads as a warning;
    it starts no engine.
  - `check` launches nothing; its one write (Story 33.5, hole 62) is the
    policy's `[verify] commands`, reconciled from a tracked list — the
    project's `.tk-studio/config.yaml` `engine.verify_commands` when the key
    is present, else `plugins/tk-studio/pipeline/verify-commands.toml`
    (never config.local.yaml or the user tier). A missing tracked command
    is appended after the operator's, which are kept in order; nothing to
    add leaves the file byte-identical. The write is atomic and re-read
    with tomllib (the original bytes restored on any mismatch); `[limits]`
    stays read-only. The `verify commands` row and the `verify_commands`
    key `{source, tracked, added, kept, policy}` report it on every check;
    a source or policy that cannot be read or placed is a named gap ("fix
    it by hand"); no tracked list or no policy is an advisory skip.
    The same row names where the engine gate runs (Story 34.4), from the
    tracked config only: with a non-empty `verify.engine`, `engine gate:
    sandbox and host leg (engine.verify_commands, verify.engine)` when an
    `engine.verify_commands` entry equals it once stripped, else `engine
    gate: host leg (verify.engine, Story 34.1)`; with no `verify.engine` but
    `gds-engine-godot-4` in some `working_set.<role>`, `engine gate: sandbox
    list only (engine.verify_commands; not identified without
    verify.engine)` when `engine.verify_commands` has a non-empty entry,
    else a warning (`engine gate: none (...)`). The clause never turns the
    row red.
  - `check` refuses the story the launch would start (Story 35.2) — the
    first manifest entry with no `stories/<id>-*.md` at `status: done` —
    with the gap `open questions` when one of its SPEC CAPs (`- **CAP-N**
    (E.S)`) has a `- CAP-N:` line under `## Open Questions` and no bullet
    under `## Design notes (settled shape, planner, <date>)` names that CAP
    or the story; a later story's un-noted CAP is never a gap. The advisory
    `story plans` row (after `playable path`, never a gap) reads `all <n>
    planned` or `without a plan: <id>, …` (manifest order), plus `;
    un-noted open questions: CAP-N (<id>), …` for later stories.

Exit codes: 0 verb answered (a `check` with gaps is an answer: ok=false);
2 bad invocation or refusal (`start` on a failing check, missing spec, an
unacknowledged budget mismatch);
1 unexpected failure (spawn error, engine never acknowledged).
Env: TK_STUDIO_HOME overrides the store root (tests). Stdlib-only (NFR9).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
import tomllib
from datetime import datetime
from pathlib import Path

import job as joblib
import miniyaml
import sandbox_login
import store as storelib
from pipeline import LEGACY_BEGIN_RE

# statuses `bmad-loop list --json` reports for a run whose engine is gone;
# anything else owns the checkout (a paused engine is still a live process)
TERMINAL_STATUSES = frozenset({"finished", "stopped", "interrupted", "crashed"})
RUN_ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")
DEFAULT_WAIT_S = 30.0
POLL_S = 0.5

INTENT = "tk-studio-launch"
# the AD-11 status block, last in every result and in this order (§3)
BLOCK_KEYS = ("status", "intent", "artifacts", "reason")

POLICY_REL = ".bmad-loop/policy.toml"
BANDS_REL = ".tk-studio/budget-bands.yaml"
# Story 33.5: the tracked [verify] commands the readiness check reconciles
# into the policy (the project config's key overrides the plugin file)
CONFIG_REL = ".tk-studio/config.yaml"
VERIFY_PLUGIN_REL = "plugins/tk-studio/pipeline/verify-commands.toml"
VERIFY_CONFIG_SOURCE = ".tk-studio/config.yaml engine.verify_commands"
VERIFY_CHECK = "verify commands"
# Story 34.4: the verify-commands row's engine-gate placement clause
ENGINE_SKILL = "gds-engine-godot-4"
ENGINE_GATE_BOTH = ("engine gate: sandbox and host leg (engine.verify_commands, "
                    "verify.engine)")
ENGINE_GATE_SANDBOX_ONLY = ("engine gate: sandbox list only (engine.verify_commands; "
                            "not identified without verify.engine)")
ENGINE_GATE_HOST = "engine gate: host leg (verify.engine, Story 34.1)"
ENGINE_GATE_NONE = ("warning: engine gate: none (set verify.engine for the host "
                    "leg, or add the gate to engine.verify_commands only in a "
                    "WITH_GODOT sandbox)")
# policy `[limits]` key -> the band field its largest band is compared with
BUDGET_COMPARED = (("max_tokens_per_story", "weighted_tokens"),
                   ("max_review_cycles", "review_cycles_max"))
# policy limits the bands carry no field for (the wall-clock session
# timeout, the per-session token guard, the follow-up review cap): listed,
# never a mismatch
BUDGET_NOT_COMPARED = ("session_timeout_min", "max_tokens_per_session",
                       "max_followup_reviews")


class LaunchError(Exception):
    """Bad invocation or a refusal with its reason named. ``extra`` holds
    structured fields the refusal JSON carries before the block keys (the
    readiness ``budget`` on a `start` refusal after its check)."""

    def __init__(self, message: str, *, extra: dict | None = None) -> None:
        super().__init__(message)
        self.extra = dict(extra or {})


# ------------------------------------------------------------------ transport

def _bmad_loop_binary() -> str | None:
    return shutil.which("bmad-loop")


def run_cli(args: list[str], *, cwd: Path | None = None,
            timeout: int = 120) -> tuple[int, str, str]:
    """`bmad-loop <args>` captured. Module-level so tests inject a fake."""
    binary = _bmad_loop_binary()
    if binary is None:
        raise LaunchError("bmad-loop is not on PATH (install: uv tool install bmad-loop)")
    proc = subprocess.run([binary, *args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout,
                          cwd=str(cwd) if cwd else None, stdin=subprocess.DEVNULL)
    return proc.returncode, proc.stdout, proc.stderr


def spawn_detached(args: list[str], *, cwd: Path, log_path: Path) -> int:
    """Start `bmad-loop <args>` as a detached, console-less process whose
    output lands in `log_path`. Returns the pid. Module-level so tests
    inject a fake."""
    binary = _bmad_loop_binary()
    if binary is None:
        raise LaunchError("bmad-loop is not on PATH (install: uv tool install bmad-loop)")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = (subprocess.DETACHED_PROCESS
                                   | subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        kwargs["start_new_session"] = True
    with open(log_path, "ab") as log:
        proc = subprocess.Popen([binary, *args], cwd=str(cwd),
                                stdin=subprocess.DEVNULL, stdout=log,
                                stderr=subprocess.STDOUT, close_fds=True,
                                **kwargs)
    return proc.pid


SBX_TIMEOUT = 30  # seconds per sbx call, at most (the row's budget caps it)


def run_sbx(args: list[str], timeout: float = SBX_TIMEOUT):
    """One bounded, argv-only sbx call (FileNotFoundError when sbx is
    absent). Module-level so tests inject a fake (no live sbx in tests)."""
    exe = shutil.which(args[0])
    if exe is None:
        raise FileNotFoundError(args[0])
    return subprocess.run([exe, *args[1:]], capture_output=True, text=True,
                          encoding="utf-8", errors="replace",
                          timeout=min(SBX_TIMEOUT, timeout),
                          stdin=subprocess.DEVNULL)


def _json_out(text: str) -> dict | None:
    text = text.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


# ------------------------------------------------------------------- helpers

def mint_run_id(now: datetime | None = None) -> str:
    """bmad-loop's own run-id shape: %Y%m%d-%H%M%S-<4 hex> (lexical = chronological)."""
    stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{secrets.token_hex(2)}"


def _manifest_entry_count(path: Path) -> int:
    """`- id:` entries of a stories.yaml (a top-level list by the substrate's
    schema; leading indentation tolerated), without a YAML parser — the
    substrate validates the manifest properly; this only answers "is there
    anything to dispatch"."""
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if re.match(r"^\s*-\s+id:\s*\S", line):
            count += 1
    return count


def default_spec_folder(epic: int) -> str:
    """The epic's spec folder when the payload names only the epic number
    (the skill's documented default)."""
    return f"_bmad-output/specs/spec-epic-{int(epic)}"


def _spec_paths(root: Path, spec_folder: str) -> tuple[Path, str]:
    """(absolute folder, the project-relative spelling handed to the
    substrate). A relative spelling is passed through verbatim — Path()
    would rewrite separators on Windows — and an absolute one is
    relativized once, here, so `validate` and `run` always see the same
    argument."""
    folder = Path(spec_folder)
    if folder.is_absolute():
        return folder, os.path.relpath(folder, root)
    return root / folder, spec_folder


def launches_dir(project_root: Path) -> Path:
    key = joblib.project_key(project_root)
    return storelib.store_root() / "projects" / key / "launches"


def list_runs(project_root: Path) -> list[dict]:
    """`bmad-loop list --json` for the checkout; [] when the project has never run."""
    if not (project_root / ".bmad-loop").is_dir():
        return []
    rc, out, err = run_cli(["list", "--json", "--project", str(project_root)])
    parsed = _json_out(out)
    if rc != 0 or parsed is None:
        raise LaunchError(f"bmad-loop list failed (exit {rc}): {(err or out).strip()[:400]}")
    return list(parsed.get("runs") or [])


def live_runs(runs: list[dict]) -> list[dict]:
    """Runs whose engine still owns the checkout: any non-terminal status
    (a paused engine is a live process). Terminal is decided by status
    alone — a stale `paused_stage` on a finished run must never block
    every later launch."""
    return [r for r in runs if str(r.get("status", "")) not in TERMINAL_STATUSES]


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _empty_budget() -> dict:
    return {"compared": [], "budget_mismatch": [], "not_compared": []}


def compare_budget(project_root: Path) -> tuple[dict, dict]:
    """(budget, check entry): the engine's policy limits against the budget
    bands. Both files are only read — the machine-local policy is never
    edited here. A band ceiling above its policy limit is a
    `budget_mismatch` entry `{limit, policy, band, band_field, band_value}`;
    a limit the bands carry no field for is `not_compared`. A missing or
    unparseable input is named in the check entry, never a crash and never
    a mismatch."""
    budget = _empty_budget()
    every_limit = [limit for limit, _ in BUDGET_COMPARED] + list(BUDGET_NOT_COMPARED)

    def not_compared_all(problem: str) -> tuple[dict, dict]:
        budget["not_compared"] = [{"limit": limit, "reason": problem} for limit in every_limit]
        return budget, {"check": "budget", "ok": True,
                        "detail": f"not compared (advisory): {problem}"}

    policy_path = project_root / POLICY_REL
    try:
        with open(policy_path, "rb") as fh:
            policy = tomllib.load(fh)
    except FileNotFoundError:
        return not_compared_all(f"{POLICY_REL} missing")
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        return not_compared_all(f"{POLICY_REL} unparseable: {exc}")
    bands_path = project_root / BANDS_REL
    try:
        bands_doc = miniyaml.load(bands_path)
    except FileNotFoundError:
        return not_compared_all(f"{BANDS_REL} missing")
    except (OSError, UnicodeDecodeError, miniyaml.MiniYamlError) as exc:
        return not_compared_all(f"{BANDS_REL} unparseable: {exc}")
    limits = policy.get("limits")
    if not isinstance(limits, dict):
        return not_compared_all(f"{POLICY_REL} has no [limits] table")
    bands = bands_doc.get("bands") if isinstance(bands_doc, dict) else None
    if not isinstance(bands, dict) or not bands:
        return not_compared_all(f"{BANDS_REL} has no bands map")

    for limit, field in BUDGET_COMPARED:
        policy_value = limits.get(limit)
        if not _number(policy_value):
            reason = "absent from policy" if limit not in limits else "not a number in policy"
            budget["not_compared"].append({"limit": limit, "reason": reason})
            continue
        typed = [(str(name), band[field]) for name, band in bands.items()
                 if isinstance(band, dict) and field in band]
        # a band carrying the field with a non-numeric value would let a
        # smaller band be compared and hide a real mismatch: name it instead
        bad = [name for name, value in typed if not _number(value)]
        if bad:
            budget["not_compared"].append({
                "limit": limit,
                "reason": "; ".join(f"band {name} {field} not a number" for name in bad)})
            continue
        carried = typed
        if not carried:
            budget["not_compared"].append({"limit": limit, "reason": "no band field"})
            continue
        band, band_value = max(carried, key=lambda item: item[1])
        entry = {"limit": limit, "policy": policy_value, "band": band,
                 "band_field": field, "band_value": band_value}
        budget["compared"].append(entry)
        if band_value > policy_value:
            budget["budget_mismatch"].append(entry)
    for limit in BUDGET_NOT_COMPARED:
        budget["not_compared"].append({"limit": limit, "reason": "no band field"})

    mismatch = budget["budget_mismatch"]
    detail = ("budget_mismatch: " + "; ".join(mismatch_text(m) for m in mismatch)
              if mismatch else
              f"{len(budget['compared'])} limit(s) within the bands")
    return budget, {"check": "budget", "ok": not mismatch, "detail": detail}


# ------------------------------------------- the tracked [verify] commands

def _verify_key(source: str | None, tracked: list[str], policy: str, *,
                added: list[str] | None = None, kept: list[str] | None = None) -> dict:
    return {"source": source, "tracked": list(tracked), "added": list(added or []),
            "kept": list(kept or []), "policy": policy}


def _strings(value: object, *, non_empty: bool) -> bool:
    return isinstance(value, list) and all(
        isinstance(v, str) and (v.strip() or not non_empty) for v in value)


def tracked_verify_commands(root: Path) -> tuple[str | None, list[str], str | None]:
    """(source, tracked, problem) — Story 33.5's resolution order, tracked
    files only (never config.local.yaml or the user tier): the project
    config's ``engine.verify_commands`` when the key is present (no value
    reads as the empty list: nothing tracked), else the plugin's
    ``pipeline/verify-commands.toml`` ``commands``, else no source.
    ``problem`` names a source that does not parse or is not a list of
    non-empty strings."""
    config = root / CONFIG_REL
    if config.is_file():
        try:
            doc = miniyaml.load(config)
        except (OSError, UnicodeDecodeError, miniyaml.MiniYamlError) as exc:
            return CONFIG_REL, [], f"{CONFIG_REL} unparseable: {exc}"
        engine = doc.get("engine") if isinstance(doc, dict) else None
        if isinstance(engine, dict) and "verify_commands" in engine:
            value = engine["verify_commands"]
            value = [] if value is None else value
            if not _strings(value, non_empty=True):
                return VERIFY_CONFIG_SOURCE, [], (
                    f"{CONFIG_REL} engine.verify_commands is not a list of non-empty strings")
            return VERIFY_CONFIG_SOURCE, list(value), None
    plugin = root / VERIFY_PLUGIN_REL
    if plugin.is_file():
        try:
            with open(plugin, "rb") as fh:
                doc = tomllib.load(fh)
        except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
            return VERIFY_PLUGIN_REL, [], f"{VERIFY_PLUGIN_REL} unparseable: {exc}"
        value = doc.get("commands")
        if not _strings(value, non_empty=True):
            return VERIFY_PLUGIN_REL, [], (
                f"{VERIFY_PLUGIN_REL} commands is not a list of non-empty strings")
        return VERIFY_PLUGIN_REL, list(value), None
    return None, [], None


def _array_end(text: str, start: int) -> int:
    """Index just past the ``]`` closing the TOML array opening at
    ``text[start] == "["`` — a bracket scan honouring basic, literal and
    multi-line strings and comments; -1 when it never closes."""
    depth, i, n = 0, start, len(text)
    while i < n:
        ch = text[i]
        if ch in "\"'":
            triple = text.startswith(ch * 3, i)
            close = ch * 3 if triple else ch
            i += len(close)
            while i < n and not text.startswith(close, i):
                if ch == '"' and text[i] == "\\":
                    i += 1
                elif not triple and text[i] in "\r\n":
                    return -1
                i += 1
            if i >= n:
                return -1
            i += len(close)
            continue
        if ch == "#":
            while i < n and text[i] not in "\r\n":
                i += 1
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def _place_verify_commands(text: str, data: dict, desired: list[str]) -> str | None:
    """``text`` with ``[verify] commands`` set to ``desired`` (one line, TOML
    basic strings, the file's newline kept); None when the key cannot be
    located (a dotted key, an inline table)."""
    nl = "\r\n" if "\r\n" in text else "\n"
    line = "commands = [" + ", ".join(json.dumps(c, ensure_ascii=False) for c in desired) + "]"
    header = re.search(r"^[ \t]*\[[ \t]*verify[ \t]*\][ \t]*(?:#[^\r\n]*)?\r?$", text, re.M)
    verify = data.get("verify")
    if header is None:
        if verify is not None:
            return None  # `verify.commands = ...` or `verify = {...}`: never guessed
        block = f"[verify]{nl}{line}{nl}"
        fence = re.search(r"^" + LEGACY_BEGIN_RE, text, re.M)
        if fence is not None:
            return text[:fence.start()] + block + nl + text[fence.start():]
        base = text
        if base and not base.endswith(nl):
            base += nl
        if base and not base.endswith(nl + nl):
            base += nl
        return base + block
    after = text.find("\n", header.end())
    body_start = len(text) if after < 0 else after + 1
    nxt = re.search(r"^[ \t]*\[", text[body_start:], re.M)
    body_end = body_start + nxt.start() if nxt else len(text)
    key = re.search(r"^[ \t]*commands[ \t]*=[ \t]*", text[body_start:body_end], re.M)
    if not isinstance(verify, dict):
        return None
    if "commands" not in verify:
        if key is not None:
            return None
        prefix = text[:body_start] if after >= 0 else text + nl
        return prefix + line + nl + text[body_start:]
    if key is None:
        return None
    open_at = body_start + key.end()
    if open_at >= len(text) or text[open_at] != "[":
        return None
    close_at = _array_end(text, open_at)
    if close_at < 0:
        return None
    value_start = body_start + key.start()
    return text[:value_start] + line + text[close_at:]


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f"{path.name}.tk-studio-{os.getpid()}.tmp")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        try:
            shutil.copymode(path, tmp)
        except OSError:
            pass
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def engine_gate_clause(root: Path) -> str | None:
    """Story 34.4: where the engine gate runs, read from the tracked
    ``.tk-studio/config.yaml`` only (never config.local.yaml or the user
    tier). ``engine.verify_commands`` is the in-sandbox list and
    ``verify.engine`` the host leg's single command, two keys never merged.
    A set ``verify.engine`` gives the host-leg (or both-places) clause
    whatever the working set; only without it does a working set carrying
    the engine skill give the sandbox-only or none clause. None when there
    is nothing to say (no config, unparseable, no ``verify.engine`` and no
    working set carrying the engine skill)."""
    config = root / CONFIG_REL
    if not config.is_file():
        return None
    try:
        doc = miniyaml.load(config)
    except (OSError, UnicodeDecodeError, miniyaml.MiniYamlError):
        return None
    if not isinstance(doc, dict):
        return None
    verify = doc.get("verify")
    gate = verify.get("engine") if isinstance(verify, dict) else None
    engine = doc.get("engine")
    listed = engine.get("verify_commands") if isinstance(engine, dict) else None
    listed = [c for c in listed if isinstance(c, str) and c.strip()] \
        if isinstance(listed, list) else []
    if isinstance(gate, str) and gate.strip():
        # the 34.1 host leg runs verify.engine whenever it is set, so a
        # command in both keys runs in both places
        if any(c.strip() == gate.strip() for c in listed):
            return ENGINE_GATE_BOTH
        return ENGINE_GATE_HOST
    working_set = doc.get("working_set")
    if isinstance(working_set, dict) and any(
            isinstance(v, list) and ENGINE_SKILL in v for v in working_set.values()):
        return ENGINE_GATE_SANDBOX_ONLY if listed else ENGINE_GATE_NONE
    return None


def reconcile_verify_commands(root: Path) -> tuple[dict, dict]:
    """(verify_commands key, check row) — Story 33.5: the engine policy's
    ``[verify] commands`` reconciled from the tracked list. Tracked commands
    the policy lacks are appended after the operator's, in tracked order;
    the operator's commands are never reordered or removed; nothing to add
    leaves the file byte-identical. The write is atomic and re-read with
    tomllib; on any mismatch the original bytes are restored. Every problem
    is a named refusal (``ok`` false, a gap), never a guess; no tracked list
    or no policy is an advisory skip and writes nothing. The detail ends
    with the engine-gate clause when there is one (Story 34.4), which never
    changes ``ok``."""
    clause = engine_gate_clause(root)

    def row(ok: bool, detail: str) -> dict:
        if clause:
            detail = f"{detail}; {clause}"
        return {"check": VERIFY_CHECK, "ok": ok, "detail": detail}

    def refused(source: str | None, tracked: list[str], problem: str) -> tuple[dict, dict]:
        return (_verify_key(source, tracked, "refused"),
                row(False, f"refused: {problem} — fix it by hand"))

    source, tracked, problem = tracked_verify_commands(root)
    if problem:
        return refused(source, tracked, problem)
    if source is None:
        skip = "skipped (no tracked list)"
        return _verify_key(None, [], skip), row(True, skip)
    policy_path = root / POLICY_REL
    if not policy_path.is_file():
        skip = f"skipped (no {POLICY_REL}; bmad-loop init creates it)"
        return _verify_key(source, tracked, skip), row(True, skip)
    try:
        original = policy_path.read_bytes()
        text = original.decode("utf-8")
        data = tomllib.loads(text)
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        return refused(source, tracked, f"{POLICY_REL} unparseable: {exc}")
    verify = data.get("verify", {})
    current = verify.get("commands", []) if isinstance(verify, dict) else None
    if not _strings(current, non_empty=False):
        return refused(source, tracked,
                       f"{POLICY_REL} verify.commands is not a list of strings")
    desired = list(current)
    for command in tracked:
        if command not in desired:
            desired.append(command)
    added = desired[len(current):]
    kept = [c for c in current if c not in tracked]
    if not added:
        return (_verify_key(source, tracked, "unchanged", kept=kept),
                row(True, f"unchanged ({len(tracked)} tracked, {len(kept)} operator)"))
    new_text = _place_verify_commands(text, data, desired)
    if new_text is None:
        return refused(source, tracked,
                       f"{POLICY_REL} [verify] commands cannot be located "
                       "(a dotted key or an inline table)")
    expected = {**data, "verify": {**(verify or {}), "commands": desired}}
    try:
        _write_atomic(policy_path, new_text.encode("utf-8"))
        with open(policy_path, "rb") as fh:
            ok = tomllib.load(fh) == expected
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError):
        ok = False
    if not ok:
        try:
            _write_atomic(policy_path, original)
        except OSError as exc:
            return refused(source, tracked,
                           f"{POLICY_REL} reconciliation did not verify and the original "
                           f"could not be restored: {exc}")
        return refused(source, tracked,
                       f"{POLICY_REL} reconciliation did not verify; the original is restored")
    return (_verify_key(source, tracked, "written", added=added, kept=kept),
            row(True, f"added {len(added)} from {source}; kept {len(kept)} operator commands"))


def mismatch_text(entry: dict) -> str:
    """One mismatch, both numbers named."""
    return (f"{entry['limit']} {entry['policy']} < band {entry['band']} "
            f"{entry['band_field']} {entry['band_value']}")


def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    out = {k: v for k, v in result.items() if k not in BLOCK_KEYS}
    out.update(status=status, intent=INTENT, artifacts=list(artifacts), reason=reason)
    return out


def check_block(result: dict) -> tuple[str, list[str], str | None]:
    """check: blocked naming the gaps; partial naming each mismatch;
    complete otherwise. A check launches nothing, so no artifacts."""
    mismatch = (result.get("budget") or {}).get("budget_mismatch") or []
    mismatch_reason = ("budget_mismatch: " + "; ".join(mismatch_text(m) for m in mismatch)
                       if mismatch else None)
    if result.get("gaps"):
        reason = "; ".join(result["gaps"])
        if mismatch_reason:
            reason += "; " + mismatch_reason
        return "blocked", [], reason
    if mismatch_reason:
        return "partial", [], mismatch_reason
    return "complete", [], None


def start_block(result: dict) -> tuple[str, list[str], str | None]:
    """start: complete with the project-relative run dir and spec folder
    (never `run_dir_abs` or the store `log`); blocked when unacknowledged."""
    if result.get("ok"):
        return "complete", [result["run_dir"], result["spec_folder"]], None
    return "blocked", [], result.get("error") or "the engine never acknowledged the launch"


# ------------------------------------------------------- the engine sandbox

ENGINE_SANDBOX_CHECK = "engine sandbox"
OUTSIDE_WARNING = ("warning: {sb} started outside the supervisor; the next "
                   "pin restarts it")


def pin_record_path(sandbox: str) -> Path:
    """The supervisor's pin record (Story 33.3): written on every pin,
    removed when its release stopped the sandbox."""
    safe = re.sub(r"[^A-Za-z0-9._\-]", "_", sandbox)
    return storelib.store_root() / "sandboxes" / f"{safe}.pin"


def engine_sandbox_row(env=None) -> dict:
    """Story 33.3: the advisory ``engine sandbox`` row (``ok`` always true,
    never a gap). The sandboxes are the supervisor config's
    ``jobs.*.sandbox`` (``sandbox_login.config_sandboxes``); ``sbx daemon
    status`` runs before ``sbx ls`` and every call shares one budget. A
    sandbox listed as running with no pin record reads ``warning: <sb>
    started outside the supervisor; the next pin restarts it``; otherwise
    ``pinned by the supervisor``, ``not running``, ``no engine sandbox
    configured``, ``sbx absent`` or ``daemon down``."""
    env = os.environ if env is None else env

    def row(detail: str) -> dict:
        return {"check": ENGINE_SANDBOX_CHECK, "ok": True, "detail": detail}

    path = (env.get("TK_SUPERVISOR_CONFIG") or "").strip()
    try:
        text = Path(path).read_text(encoding="utf-8-sig") if path else ""
    except (OSError, UnicodeDecodeError):
        text = ""
    sandboxes = sandbox_login.config_sandboxes(text)
    if not sandboxes:
        return row("no engine sandbox configured")
    deadline = sandbox_login.Deadline(sandbox_login.BUDGET_S)
    try:
        daemon, why = sandbox_login._call(run_sbx, ["sbx", "daemon", "status"], deadline)
        if why == "absent":
            return row("sbx absent")
        if daemon is None or daemon.returncode != 0:
            return row("daemon down")
        ls, why = sandbox_login._call(run_sbx, ["sbx", "ls"], deadline)
    except sandbox_login._Spent:
        return row("daemon down")
    # a failed listing reads as not running (the supervisor's own rule)
    listing = (ls.stdout or "") if ls is not None and ls.returncode == 0 else ""
    parts = []
    for sb in sandboxes:
        line = sandbox_login._listed(listing, sb)
        if line is None or "running" not in line.lower().split():
            state = "not running"
        elif pin_record_path(sb).is_file():
            state = "pinned by the supervisor"
        else:
            parts.append(OUTSIDE_WARNING.format(sb=sb))
            continue
        parts.append(state if len(sandboxes) == 1 else f"{sb}: {state}")
    return row("; ".join(parts))


# ----------------------------------------------------- the playable path

PLAYABLE_PATH_CHECK = "playable path"
# The ruled rendering path (kb/playable-verify-on-the-box.md `## Ruling`);
# playable.py's default `--mode` is the same constant (a test pins both).
PLAYABLE_PATH = "movie"
NO_GODOT_WARNING = ("warning: no $env:GODOT (unset or not an absolute file); "
                    "playable runs refuse")
NO_DISPLAY_WARNING = ("warning: no display session; the {path} path needs "
                      "the logged-in desktop")


def display_session(env=None) -> bool:
    """Whether a logged-in display session is there. Windows: the input
    desktop opens (a locked console or no session does not); POSIX:
    ``DISPLAY`` or ``WAYLAND_DISPLAY``. Module-level so tests inject a
    fake; may raise (the row reads the error)."""
    env = os.environ if env is None else env
    if sys.platform == "win32":
        import ctypes
        user32 = ctypes.windll.user32
        user32.OpenInputDesktop.restype = ctypes.c_void_p
        user32.CloseDesktop.argtypes = [ctypes.c_void_p]
        handle = user32.OpenInputDesktop(0, False, 0x0100)  # DESKTOP_SWITCHDESKTOP
        if not handle:
            return False
        user32.CloseDesktop(handle)
        return True
    return bool((env.get("DISPLAY") or "").strip()
                or (env.get("WAYLAND_DISPLAY") or "").strip())


def playable_path_row(root: Path, env=None) -> dict:
    """Story 34.2: the advisory ``playable path`` row (``ok`` always true,
    never a gap). A project without ``verify.engine`` in its tracked config
    reads ``not a game project (no verify.engine)``; then ``GODOT`` (an
    absolute file) and, for the ``display`` and ``movie`` paths, a display
    session; otherwise ``ready (<path>)``. Starts nothing."""
    env = os.environ if env is None else env

    def row(detail: str) -> dict:
        return {"check": PLAYABLE_PATH_CHECK, "ok": True, "detail": detail}

    engine = None
    config = root / CONFIG_REL
    if config.is_file():
        try:
            doc = miniyaml.load(config)
        except (OSError, UnicodeDecodeError, miniyaml.MiniYamlError):
            doc = None
        verify = doc.get("verify") if isinstance(doc, dict) else None
        engine = verify.get("engine") if isinstance(verify, dict) else None
    if not (isinstance(engine, str) and engine.strip()):
        return row("not a game project (no verify.engine)")
    godot = (env.get("GODOT") or "").strip()
    if not godot or not Path(godot).is_absolute() or not Path(godot).is_file():
        return row(NO_GODOT_WARNING)
    if PLAYABLE_PATH in ("display", "movie"):
        try:
            present = display_session(env)
        except Exception as exc:  # noqa: BLE001 - never raise out of check
            return row(f"warning: display session unknown ({exc})")
        if not present:
            return row(NO_DISPLAY_WARNING.format(path=PLAYABLE_PATH))
    return row(f"ready ({PLAYABLE_PATH})")


# ------------------------------------------- story plans and open questions

OPEN_QUESTIONS_CHECK = "open questions"
STORY_PLANS_CHECK = "story plans"
# Story 35.2: a SPEC capability line names its story (`35.2` -> ids `35-2-…`);
# any non-digit may follow the story (`(28.5; added by correct-course …)`)
CAP_LINE_RE = re.compile(r"^- \*\*CAP-(\d+)\*\* \((\d+)\.(\d+)(?![\d.])")
# a CAP list: `CAP-9`, `CAP-9 and CAP-10`, `CAP-11/CAP-12`, `CAP-4, CAP-5`
CAP_LIST = r"CAP-\d+(?:\s*(?:,|/|&|\band\b)\s*(?:and\s+)?CAP-\d+)*"
# an open question: any bullet naming a CAP. One led by a CAP list,
# possessive or not (`- CAP-9: …`, `- CAP-9's tracked source: …`), is a
# question of the lead CAPs only, its text the rest, past a colon right after
# the lead; any other (`- Is X in scope for CAP-2?`) is a question of every
# CAP it names, its text the whole bullet
OPEN_QUESTION_RE = re.compile(rf"^- ({CAP_LIST})(?:['’]s\b)?(?=[\s:]|$):?\s*(.*)$")
# a design-note subject: a CAP list, optionally with its story (`CAP-2/CAP-3 (28.1)`)
NOTE_CAPS_RE = re.compile(rf"^({CAP_LIST})(?:\s*\(\d+[.-]\d+\))?$")
NOTES_HEADING_RE = re.compile(r"^## Design notes \(settled shape, planner, [^)]*\)\s*$")
NOTE_STORY_RE = re.compile(r"^(\d+)[.-](\d+)$")
QUESTION_CLIP = 160


def _manifest_ids(path: Path) -> list[str]:
    """The `- id:` values of a stories.yaml, in list order (quotes stripped)."""
    ids = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return ids
    for line in lines:
        m = re.match(r"^\s*-\s+id:\s*(\S.*?)\s*$", line)
        if m:
            ids.append(m.group(1).strip().strip("'\""))
    return ids


def _clip(text: str, n: int = QUESTION_CLIP) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _caps_in(cap_list: str) -> list[str]:
    """`CAP-9 and CAP-10` → [`CAP-9`, `CAP-10`] (normalized, in order)."""
    return [f"CAP-{int(n)}" for n in re.findall(r"\bCAP-(\d+)(?!\w)", cap_list)]


def spec_open_questions(text: str) -> dict:
    """Story 35.2: the SPEC's CAP → story map (`"35-2"`), its open questions
    (any bullet under `## Open Questions` naming `CAP-N`: one led by a CAP
    list — `CAP-9 and CAP-10`, `CAP-11/CAP-12`, `CAP-4, CAP-5` — optionally
    possessive, `CAP-9's …`, is a question of the lead CAPs, the text past
    the lead; any other is a question of each CAP it names, the whole
    bullet; CAP → every question naming it) and its design-note
    subjects (bullets under any `## Design notes (settled shape, planner,
    <date>)` heading: the text before the first ` — ` or `:`; a CAP list,
    optionally with its story `(28.1)`, notes each CAP), split into noted
    CAPs and noted stories (`35.2`/`35-2` → `"35-2"`)."""
    caps: dict[str, str] = {}
    questions: dict[str, list[str]] = {}
    noted_caps: set[str] = set()
    noted_stories: set[str] = set()
    section = None
    for line in text.splitlines():
        if line.startswith("## "):
            if line.strip() == "## Open Questions":
                section = "questions"
            elif NOTES_HEADING_RE.match(line):
                section = "notes"
            else:
                section = None
            continue
        cap = CAP_LINE_RE.match(line)
        if cap:
            caps.setdefault(f"CAP-{int(cap.group(1))}", f"{int(cap.group(2))}-{int(cap.group(3))}")
        if section == "questions":
            q = OPEN_QUESTION_RE.match(line)
            if q:
                named, text = _caps_in(q.group(1)), q.group(2).strip()
            elif line.startswith("- "):
                named, text = _caps_in(line), line[2:].strip()
            else:
                named = []
            for cap in dict.fromkeys(named):
                questions.setdefault(cap, []).append(text)
        elif section == "notes" and line.startswith("- "):
            body = line[2:]
            cuts = [i for i in (body.find(" — "), body.find(":")) if i >= 0]
            subject = (body[:min(cuts)] if cuts else body).strip()
            caps_note = NOTE_CAPS_RE.match(subject)
            if caps_note:
                noted_caps.update(_caps_in(caps_note.group(1)))
                continue
            m = NOTE_STORY_RE.match(subject)
            if m:
                noted_stories.add(f"{int(m.group(1))}-{int(m.group(2))}")
    return {"caps": caps, "questions": questions,
            "noted_caps": noted_caps, "noted_stories": noted_stories}


def _story_of(entry_id: str) -> str | None:
    """`35-2` of a manifest id `35-2-<slug>` (None for any other shape)."""
    m = re.match(r"^(\d+)-(\d+)-", entry_id)
    return f"{int(m.group(1))}-{int(m.group(2))}" if m else None


def _spec_done(folder: Path, entry_id: str) -> bool:
    """The entry's single `stories/<id>-*.md` (closeout.ts `findSpec`'s
    glob) has frontmatter `status: done`."""
    stories = folder / "stories"
    try:
        hits = [p for p in stories.iterdir()
                if p.name.startswith(f"{entry_id}-") and p.name.endswith(".md")]
    except OSError:
        return False
    if len(hits) != 1:
        return False
    try:
        lines = hits[0].read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeDecodeError):
        return False
    if not lines or lines[0].strip() != "---":
        return False
    for line in lines[1:]:
        if line.strip() == "---":
            break
        m = re.match(r"^status:\s*(.*?)\s*$", line)
        if m:
            return m.group(1).strip("'\"") == "done"
    return False


def next_story(folder: Path, ids: list[str]) -> str | None:
    """The story the launch would start: the first manifest entry whose
    spec is not at `status: done` (None when every entry is done)."""
    return next((i for i in ids if not _spec_done(folder, i)), None)


def unnoted_questions(parsed: dict, entry_id: str) -> list[tuple[str, str]]:
    """(CAP, question) for each open question of each of the entry's CAPs
    with no design note naming the CAP or the story, in CAP order (a CAP
    with several question lines gives one pair each)."""
    story = _story_of(entry_id)
    if story is None or story in parsed["noted_stories"]:
        return []
    out = []
    for cap, qs in sorted(parsed["questions"].items(), key=lambda kv: int(kv[0][4:])):
        if parsed["caps"].get(cap) == story and cap not in parsed["noted_caps"]:
            out.extend((cap, q) for q in qs)
    return out


def open_questions_gap(folder: Path, spec_md: Path, manifest: Path) -> str | None:
    """Story 35.2: the `open questions` gap's detail for the next story
    (`<id>: CAP-N has no design note — <question>`, `; ` between CAPs), or
    None. A SPEC without `## Open Questions`, or unreadable, is no gap."""
    try:
        text = spec_md.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return None
    nxt = next_story(folder, _manifest_ids(manifest))
    if nxt is None:
        return None
    missing = unnoted_questions(spec_open_questions(text), nxt)
    if not missing:
        return None
    return "; ".join(f"{nxt}: {cap} has no design note — {_clip(q)}" for cap, q in missing)


def story_plans_row(folder: Path, spec_md: Path, manifest: Path) -> dict:
    """Story 35.2: the advisory ``story plans`` row (``ok`` always true,
    never a gap): ``all <n> planned`` or ``without a plan: <id>, …``
    (manifest order; a plan is ``plans/<N>-<M>.md``), plus ``; un-noted
    open questions: CAP-N (<id>), …`` for the stories after the next one."""
    ids = _manifest_ids(manifest) if manifest.is_file() else []
    unplanned = [i for i in ids
                 if (s := _story_of(i)) is None or not (folder / "plans" / f"{s}.md").is_file()]
    detail = (f"all {len(ids)} planned" if not unplanned
              else "without a plan: " + ", ".join(unplanned))
    try:
        text = spec_md.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        text = ""
    if text:
        parsed = spec_open_questions(text)
        nxt = next_story(folder, ids)
        later = ids[ids.index(nxt) + 1:] if nxt is not None else []
        named, seen = [], set()
        for i in later:  # a remediation entry shares its story's CAPs: named once
            for cap, _ in unnoted_questions(parsed, i):
                if cap not in seen:
                    seen.add(cap)
                    named.append(f"{cap} ({i})")
        if named:
            detail += "; un-noted open questions: " + ", ".join(named)
    return {"check": STORY_PLANS_CHECK, "ok": True, "detail": detail}


# --------------------------------------------------------------------- verbs

def check(project_root: Path, spec_folder: str) -> dict:
    """Readiness gates for a launch. ok=false names every gap; nothing is
    launched, and the one write is the policy's ``[verify] commands``
    reconciliation (``verify_commands``; Story 33.5)."""
    checks: list[dict] = []
    gaps: list[str] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})
        if not ok:
            gaps.append(f"{name}: {detail}")

    root = project_root.resolve()
    add("project", root.is_dir(), f"{root}" if root.is_dir() else f"not a directory: {root}")
    if not root.is_dir():
        return {"ok": False, "checks": checks, "gaps": gaps, "budget": _empty_budget(),
                "verify_commands": _verify_key(None, [], "skipped (no project directory)")}

    # the budget comparison is advisory to `ok`: a mismatch is never a gap
    budget, budget_check = compare_budget(root)
    checks.append(budget_check)
    # Story 33.5: check's one write — the policy's [verify] commands
    # reconciled from the tracked list; a refusal is a gap
    verify_commands, verify_row = reconcile_verify_commands(root)
    add(verify_row["check"], verify_row["ok"], verify_row["detail"])

    folder_abs, rel = _spec_paths(root, spec_folder)
    spec_md = folder_abs / "SPEC.md"
    manifest = folder_abs / "stories.yaml"
    add("spec folder", folder_abs.is_dir(),
        str(folder_abs) if folder_abs.is_dir() else f"spec folder missing: {folder_abs}")
    add("SPEC.md", spec_md.is_file(),
        "present" if spec_md.is_file() else "missing — distill the epic with bmad-spec first")
    if manifest.is_file():
        n = _manifest_entry_count(manifest)
        add("task manifest", n > 0,
            f"{n} entries" if n > 0 else "stories.yaml has no entries — bootstrap the first story's tasks first")
    else:
        add("task manifest", False, "stories.yaml missing — bootstrap the first story's tasks first")
    # Story 35.2: the next story's un-noted open questions refuse the launch
    if spec_md.is_file() and manifest.is_file():
        questions = open_questions_gap(folder_abs, spec_md, manifest)
        if questions:
            add(OPEN_QUESTIONS_CHECK, False, questions)

    binary = _bmad_loop_binary()
    add("bmad-loop", binary is not None,
        binary or "bmad-loop is not on PATH (install: uv tool install bmad-loop)")
    if binary is None or not folder_abs.is_dir():
        return {"ok": not gaps, "checks": checks, "gaps": gaps, "budget": budget,
                "verify_commands": verify_commands}

    plugin = root / ".bmad-loop" / "plugins" / "studio-pipeline" / "plugin.toml"
    checks.append({"check": "studio-pipeline plugin", "ok": True,
                   "detail": ("present" if plugin.is_file()
                              else "absent — the run will have no gate session (advisory)")})
    # Story 33.3: advisory like the plugin row — never a gap
    checks.append(engine_sandbox_row())
    # Story 34.2: advisory too — never a gap, starts no engine
    checks.append(playable_path_row(root))
    # Story 35.2: advisory too — the stories still without a plan
    checks.append(story_plans_row(folder_abs, spec_md, manifest))

    try:
        live = live_runs(list_runs(root))
    except LaunchError as exc:
        add("live engine", False, str(exc))
    else:
        add("live engine", not live,
            "none" if not live else "a run already owns this checkout: "
            + ", ".join(f"{r.get('run_id')} ({r.get('status')})" for r in live))

    try:
        rc, out, err = run_cli(["validate", "--json", "--project", str(root), "--spec", rel])
    except LaunchError as exc:
        add("bmad-loop validate", False, str(exc))
    else:
        parsed = _json_out(out)
        if parsed is None:
            add("bmad-loop validate", False,
                f"no JSON from bmad-loop validate (exit {rc}): {(err or out).strip()[:300]}")
        else:
            problems = [f.get("message", "") for f in parsed.get("findings", [])
                        if f.get("severity") == "problem"]
            add("bmad-loop validate", bool(parsed.get("ok")) and not problems,
                "ok" if parsed.get("ok") else "; ".join(problems) or "validate reported not ok")
    return {"ok": not gaps, "checks": checks, "gaps": gaps, "budget": budget,
            "verify_commands": verify_commands}


def start(project_root: Path, spec_folder: str, *, run_id: str | None = None,
          wait_s: float = DEFAULT_WAIT_S, allow_budget_mismatch: bool = False) -> dict:
    """Launch the engine detached for the epic's manifest; ok only once the
    engine acknowledged the pre-minted run id on disk. A budget mismatch
    refuses unless ``allow_budget_mismatch`` acknowledges it."""
    readiness = check(project_root, spec_folder)
    mismatch = readiness["budget"]["budget_mismatch"]
    # a refusal after readiness that found a mismatch carries the structured
    # comparison, so every exceeded limit is named with both numbers (AC3);
    # a gaps-only refusal keeps the plain refusal shape
    budget_extra = {"budget": readiness["budget"]} if mismatch else None
    if not readiness["ok"]:
        raise LaunchError("launch refused: " + "; ".join(readiness["gaps"]),
                          extra=budget_extra)
    if mismatch and not allow_budget_mismatch:
        raise LaunchError(
            "launch refused: budget_mismatch: "
            + "; ".join(mismatch_text(m) for m in mismatch)
            + f" — raise the limit in {POLICY_REL} [limits] (never edited by the launch core) "
              "or acknowledge with allow_budget_mismatch: true (--allow-budget-mismatch)",
            extra=budget_extra)
    root = project_root.resolve()
    rid = run_id or mint_run_id()
    if not RUN_ID_RE.match(rid):
        raise LaunchError(f"run id must look like YYYYMMDD-HHMMSS-hex4: {rid!r}")
    run_dir = root / ".bmad-loop" / "runs" / rid
    if run_dir.exists():
        raise LaunchError(f"run id already exists: {run_dir}")
    log_path = launches_dir(root) / f"{rid}.log"
    _, rel = _spec_paths(root, spec_folder)
    args = ["run", "--project", str(root), "--spec", rel, "--run-id", rid]
    pid = spawn_detached(args, cwd=root, log_path=log_path)
    state = run_dir / "state.json"
    deadline = time.monotonic() + max(0.0, wait_s)
    seen = state.is_file()
    while not seen and time.monotonic() < deadline:
        time.sleep(POLL_S)
        seen = state.is_file()
    result = {
        "ok": seen,
        "run_id": rid,
        # project-relative, so it can go into a status block's artifacts[]
        # verbatim (driver-contract §3: never an absolute local path)
        "run_dir": f".bmad-loop/runs/{rid}",
        "run_dir_abs": str(run_dir),
        "log": str(log_path),
        "pid": pid,
        "spec_folder": rel,
        "state_seen": seen,
        "checks": readiness["checks"],
        "budget": readiness["budget"],
    }
    if not seen:
        result["error"] = (f"engine did not write {state} within {wait_s:g}s — it may still be "
                           f"starting (pid {pid}); inspect the log before launching again")
    return result


def status(project_root: Path, run_id: str | None = None) -> dict:
    root = project_root.resolve()
    runs = list_runs(root)
    live = live_runs(runs)
    result: dict = {"ok": True, "project": str(root), "runs": runs, "live": live}
    target = run_id or (live[-1]["run_id"] if live else None)
    if target:
        rc, out, err = run_cli(["status", "--json", "--project", str(root), target])
        parsed = _json_out(out)
        if parsed is None:
            raise LaunchError(f"bmad-loop status {target} failed (exit {rc}): {(err or out).strip()[:400]}")
        tasks = parsed.get("tasks") or []
        result["run"] = {
            "run_id": parsed.get("run_id"),
            "status": parsed.get("status"),
            "finished": parsed.get("finished"),
            "stopped": parsed.get("stopped"),
            "crashed": parsed.get("crashed"),
            "paused_stage": parsed.get("paused_stage"),
            "paused_reason": parsed.get("paused_reason"),
            "paused_story_key": parsed.get("paused_story_key"),
            "tokens": parsed.get("tokens"),
            "adapters": parsed.get("adapters"),
            "tasks": [{"key": t.get("story_key"), "phase": t.get("phase"),
                       "attempt": t.get("attempt"), "review_cycle": t.get("review_cycle")}
                      for t in tasks],
        }
    return result


def stop(project_root: Path, run_id: str, *, graceful: bool = False) -> dict:
    root = project_root.resolve()
    args = ["stop"]
    if graceful:
        args.append("--graceful")
    args += ["--project", str(root), run_id]
    rc, out, err = run_cli(args)
    if rc != 0:
        # an unknown or already-terminal run is a refusal the substrate
        # names, not an unexpected failure — surface it as one (exit 2)
        raise LaunchError(f"bmad-loop stop {run_id} refused (exit {rc}): "
                          f"{(out + err).strip()[:400]}")
    return {"ok": True, "run_id": run_id, "graceful": graceful,
            "output": (out + err).strip()[:800]}


# ----------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="tk-studio launch — the execution substrate for one epic")
    sub = parser.add_subparsers(dest="command", required=True)

    for name, help_text in (("check", "readiness gates; launches nothing"),
                            ("start", "launch the engine detached for the epic's manifest")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--directory", required=True)
        p.add_argument("--spec", help="epic spec folder (project-relative); "
                                      "default from --epic: _bmad-output/specs/spec-epic-<N>")
        p.add_argument("--epic", type=int, help="epic number (names the default spec folder)")
        if name == "start":
            p.add_argument("--run-id", help="pre-minted run id (default: minted here)")
            p.add_argument("--wait", type=float, default=DEFAULT_WAIT_S,
                           help="seconds to wait for the engine's state.json")
            p.add_argument("--allow-budget-mismatch", action="store_true",
                           help="start despite a policy limit the budget bands exceed "
                                "(the payload's allow_budget_mismatch: true)")

    p = sub.add_parser("status", help="runs on the checkout; detail for the live or named run")
    p.add_argument("--directory", required=True)
    p.add_argument("--run-id")

    p = sub.add_parser("stop", help="stop a run (graceful = after the current unit)")
    p.add_argument("--directory", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--graceful", action="store_true")

    args = parser.parse_args(argv)
    # --directory walks up to the nearest project root (driver contract
    # 0.1.22): a supervisor epic launches against the nested root.
    root = joblib.configlib.find_project_root(Path(args.directory))
    try:
        if args.command in ("check", "start"):
            spec = args.spec
            if not spec:
                if args.epic is None:
                    raise LaunchError("give --spec or --epic (the spec folder is required)")
                spec = default_spec_folder(args.epic)
        if args.command == "check":
            result = check(root, spec)
            _emit(with_block(result, *check_block(result)))
            return 0
        if args.command == "start":
            result = start(root, spec, run_id=args.run_id, wait_s=args.wait,
                           allow_budget_mismatch=args.allow_budget_mismatch)
            _emit(with_block(result, *start_block(result)))
            return 0 if result["ok"] else 1
        if args.command == "status":
            _emit(with_block(status(root, args.run_id), "complete", [], None))
            return 0
        if args.command == "stop":
            _emit(with_block(stop(root, args.run_id, graceful=args.graceful),
                             "complete", [], None))
            return 0
    except LaunchError as exc:
        refusal = {"ok": False, "error": str(exc), **exc.extra}
        _emit(with_block(refusal, "blocked", [], str(exc)))
        return 2
    except (OSError, subprocess.SubprocessError) as exc:
        error = f"{type(exc).__name__}: {exc}"
        _emit(with_block({"ok": False, "error": error}, "blocked", [], error))
        return 1
    return 2


def _emit(result: dict) -> None:
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
