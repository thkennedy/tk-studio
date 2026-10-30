"""The Story 35.7 e2e drive — the `run-sweep` job type with a fake engine.

The launch core, the planning adapter and the shipped type are studio code,
so this drive proves them in process, with a fake substrate (no bmad-loop is
spawned, nothing leaves the temp folders):

    launch.sweep   in a throwaway git project (a policy and a ledger
                   committed), the fake spawner writes the engine's
                   `state.json` and a valid `triage.json` (two bundles, one
                   blocked, one decision): the block is `complete`, its
                   reason names all three, one `sweep-triage` ledger event
                   lands (in a throwaway store)
    dirty tree     an untracked file: the CLI's block is `blocked` naming it,
                   nothing spawned
    ledger-resolve a fixture ledger: the engine's `done` entry becomes
                   `resolved … by <owner/repo>#N`, and the call again is
                   `unchanged`
    job type       `lib/job.py` loads `run-sweep` with no problem, in
                   `run-epic`'s shape on `tk-studio-launch` verb `sweep`

then the supervisor half (the triage record, the `## Sweep` PR body, the
inbox line, the end-state rule, the paused sweep, the ledger pass) the way
the supervisor's own gate runs it: locate the checkout (the folder holding
`apps/supervisor/package.json`) → find `bun` → `bun test test/sweep.test.ts
-t "Story 35.7|Story 36.1"` from `apps/supervisor` under a fresh temp folder,
`TK_SUPERVISOR_*` stripped, bounded at `BOUND_S`. No checkout or no `bun`:
that step is `ok: true` with `not_run` naming which (the `cli_drives`
precedent). Prints one JSON object {ok, steps[]} and exits nonzero on a red
step. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
SUITES = ["test/sweep.test.ts"]
FILTER = "Story 35.7|Story 36.1"
TYPE_ID = "run-sweep"
BOUND_S = 60
INSTALL_BOUND_S = 40
MANIFEST_TIMEOUT_S = 120  # keep in step with manifest.json's entry for this drive
assert BOUND_S + INSTALL_BOUND_S < MANIFEST_TIMEOUT_S, "the drive's bounds must sit under the manifest's timeout"
TAIL = 20
RID = "20261029-120000-e2e7"

TRIAGE = {
    "workflow": "deferred-sweep-triage",
    "open_ids": ["DW-1", "DW-2", "DW-3", "DW-4", "DW-5"],
    "already_resolved": [],
    "bundles": [{"name": "a", "dw_ids": ["DW-1", "DW-2"], "intent": "one goal"},
                {"name": "b", "dw_ids": ["DW-3"], "intent": "another"}],
    "blocked": [{"id": "DW-4", "blocker": "a later story"}],
    "skip": [],
    "decisions": [{"id": "DW-5", "question": "keep or drop?", "context": "c",
                   "options": [], "recommendation": "1"}],
    "escalations": [],
}
REASON = "bundles: a (DW-1, DW-2); b (DW-3); blocked: DW-4; decisions: DW-5"

LEDGER = """# Deferred Work

### DW-1: first
status: done 2026-10-29
resolution: resolved by sweep bundle dw-a

### DW-2: second
status: open
"""


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.email=e2e@tk", "-c", "user.name=e2e", *args],
                   cwd=str(root), check=True, capture_output=True, stdin=subprocess.DEVNULL)


def _project(base: Path) -> Path:
    root = base / "proj"
    (root / ".bmad-loop").mkdir(parents=True)
    (root / ".bmad-loop" / "policy.toml").write_text('[sweep]\nauto = "never"\n', encoding="utf-8")
    ledger = root / "_bmad-output" / "implementation-artifacts" / "deferred-work.md"
    ledger.parent.mkdir(parents=True)
    ledger.write_text("# Deferred Work\n", encoding="utf-8")
    (root / ".gitignore").write_text(".bmad-loop/runs/\n", encoding="utf-8")
    _git(root, "init", "-q")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


class _FakeEngine:
    """The spawner writes state.json and triage.json; status reports in-progress; list no live run."""

    def __init__(self) -> None:
        self.spawned: list[list[str]] = []

    def run_cli(self, args, *, cwd=None, timeout=120):
        if args[0] == "status":
            return 0, json.dumps({"run_id": args[-1], "status": "in-progress", "tasks": []}), ""
        if args[0] == "list":  # the sweep's live-engine probe: no run owns the checkout
            return 0, json.dumps({"schema_version": 1, "runs": []}), ""
        return 1, "", f"unexpected {args[0]}"

    def spawn_detached(self, args, *, cwd, log_path):
        self.spawned.append(list(args))
        rid = args[args.index("--run-id") + 1]
        run_dir = Path(cwd) / ".bmad-loop" / "runs" / rid
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "state.json").write_text("{}", encoding="utf-8")
        (run_dir / "triage.json").write_text(json.dumps(TRIAGE), encoding="utf-8")
        return 4242


def lib_steps() -> list[dict]:
    sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
    import job  # noqa: E402 - the plugin's own modules
    import launch  # noqa: E402
    import ledger  # noqa: E402
    import plansync  # noqa: E402
    steps: list[dict] = []
    base = Path(tempfile.mkdtemp(prefix="tk-run-sweep-"))
    saved_home = os.environ.get("TK_STUDIO_HOME")
    saved = (launch.run_cli, launch.spawn_detached, launch._bmad_loop_binary)
    try:
        os.environ["TK_STUDIO_HOME"] = str(base / "store")
        fake = _FakeEngine()
        launch.run_cli, launch.spawn_detached = fake.run_cli, fake.spawn_detached
        launch._bmad_loop_binary = lambda: "bmad-loop"

        root = _project(base)
        result = launch.sweep(root, run_id=RID, triage_wait_s=5)
        block = launch.with_block(result, *launch.sweep_block(result))
        events = []
        if ledger.ledger_path().is_file():
            events = [json.loads(line) for line in ledger.ledger_path().read_text("utf-8").splitlines()
                      if line and json.loads(line)["event"] == "sweep-triage"]
        ok = (block["status"] == "complete" and block["intent"] == "tk-studio-launch"
              and block["reason"] == REASON and len(events) == 1
              and block["artifacts"] == [f".bmad-loop/runs/{RID}", f".bmad-loop/runs/{RID}/triage.json"]
              and fake.spawned and fake.spawned[0][:3] == ["sweep", "--project", str(root.resolve())]
              and "--no-prompt" in fake.spawned[0])
        steps.append({"step": "sweep", "ok": bool(ok),
                      "detail": f"{block['status']}: {block['reason']}; sweep-triage events {len(events)}"})

        (root / "stray.txt").write_text("x", encoding="utf-8")
        before = len(fake.spawned)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = launch.main(["sweep", "--directory", str(root), "--run-id", "20261029-120001-e2e7"])
        refused = json.loads(out.getvalue())
        ok = (code == 2 and refused["status"] == "blocked" and "stray.txt" in (refused["reason"] or "")
              and len(fake.spawned) == before)
        steps.append({"step": "dirty", "ok": ok, "detail": f"exit {code}: {refused['reason']}"})

        led_root = base / "owner"
        path = led_root / "_bmad-output" / "implementation-artifacts" / "deferred-work.md"
        path.parent.mkdir(parents=True)
        path.write_text(LEDGER, encoding="utf-8", newline="\n")
        first = plansync.ledger_resolve(led_root, "thkennedy/tk-studio#300", ["DW-1", "DW-2"])
        text = path.read_text(encoding="utf-8")
        again = plansync.ledger_resolve(led_root, "thkennedy/tk-studio#300", ["DW-1"])
        ok = (first["ok"] and first["resolved"] == ["DW-1"] and first["pending"] == ["DW-2"]
              and "status: resolved 2026-10-29 by thkennedy/tk-studio#300 (sweep bundle dw-a; " in text
              and again["unchanged"] == ["DW-1"] and again["resolved"] == []
              and path.read_text(encoding="utf-8") == text)
        steps.append({"step": "ledger-resolve", "ok": bool(ok),
                      "detail": f"resolved {first['resolved']}, pending {first['pending']}; "
                                f"again unchanged {again['unchanged']}"})

        types = job.load_types()
        entry = types.get(TYPE_ID)
        epic = types["run-epic"]["definition"]
        ok = (entry is not None and not entry["problems"] and entry["definition"]["target"]
              == {"skill": "tk-studio-launch", "payload": {"verb": "sweep"}}
              and set(entry["definition"]) == set(epic)
              and all(entry["definition"][k] == epic[k]
                      for k in ("trigger", "requires", "guards", "stop", "effort")))
        steps.append({"step": "type", "ok": bool(ok),
                      "detail": f"{TYPE_ID}: " + ("run-epic's shape on tk-studio-launch verb sweep" if ok
                                                  else json.dumps(entry)[:300])})
    finally:
        launch.run_cli, launch.spawn_detached, launch._bmad_loop_binary = saved
        if saved_home is None:
            os.environ.pop("TK_STUDIO_HOME", None)
        else:
            os.environ["TK_STUDIO_HOME"] = saved_home
        shutil.rmtree(base, ignore_errors=True)
    return steps


def _checkout(start: Path) -> Path | None:
    """The folder above ``start`` holding ``apps/supervisor/package.json``."""
    for folder in (start, *start.parents):
        if (folder / "apps" / "supervisor" / "package.json").is_file():
            return folder
    return None


def suite_steps() -> list[dict]:
    steps: list[dict] = []
    checkout = _checkout(PLUGIN_ROOT)
    if checkout is None:
        return [{"step": "locate", "ok": True, "not_run": "no checkout"}]
    supervisor = checkout / "apps" / "supervisor"
    steps.append({"step": "locate", "ok": True, "detail": str(supervisor)})
    bun = shutil.which("bun")
    if bun is None:
        steps.append({"step": "bun", "ok": True, "not_run": "bun absent"})
        return steps
    steps.append({"step": "bun", "ok": True, "detail": bun})
    temp = tempfile.mkdtemp(prefix="tk-run-sweep-suite-")
    try:
        env = {k: v for k, v in os.environ.items() if not k.startswith("TK_SUPERVISOR_")}
        env.pop("TK_STUDIO_ROOT", None)
        env.update(TMPDIR=temp, TEMP=temp, TMP=temp)
        if not (supervisor / "node_modules").is_dir():
            try:
                inst = subprocess.run(
                    [bun, "install", "--frozen-lockfile"], cwd=str(supervisor), env=env,
                    stdin=subprocess.DEVNULL, capture_output=True, text=True,
                    encoding="utf-8", errors="replace", timeout=INSTALL_BOUND_S)
            except subprocess.TimeoutExpired:
                steps.append({"step": "install", "ok": False,
                              "detail": f"bun install hung past {INSTALL_BOUND_S}s"})
                return steps
            if inst.returncode != 0:
                steps.append({"step": "install", "ok": False,
                              "detail": f"bun install exit {inst.returncode}: "
                                        f"{(inst.stderr or inst.stdout).strip()[-300:]}"})
                return steps
            steps.append({"step": "install", "ok": True,
                          "detail": "bun install --frozen-lockfile (node_modules was absent)"})
        started = time.monotonic()
        try:
            proc = subprocess.run(
                [bun, "test", *SUITES, "-t", FILTER], cwd=str(supervisor), env=env,
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                encoding="utf-8", errors="replace", timeout=BOUND_S)
        except subprocess.TimeoutExpired:
            steps.append({"step": "suite", "ok": False,
                          "detail": f"bun test {' '.join(SUITES)} hung past {BOUND_S}s"})
            return steps
        lines = f"{proc.stdout}{proc.stderr}".rstrip().splitlines()
        steps.append({"step": "suite", "ok": proc.returncode == 0,
                      "detail": f"bun test {' '.join(SUITES)} -t \"{FILTER}\" "
                                + ("green" if proc.returncode == 0 else
                                   f"exit {proc.returncode}: " + " | ".join(lines[-TAIL:])),
                      "duration_ms": int((time.monotonic() - started) * 1000)})
        return steps
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def run() -> dict:
    steps = lib_steps()
    if all(s["ok"] for s in steps):
        steps += suite_steps()
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    del argv  # no arguments: the drive builds its own fixtures
    try:
        result = run()
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
