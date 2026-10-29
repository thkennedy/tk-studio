"""The Story 35.8 e2e drive — the Stage Log writer and the Jira poster.

The writer is driven through its CLI (`lib/plansync.py stage`), the way
the engine hook, the supervisor and the operator call it, over a fixture
project built in a temp folder:

    from-pass   a run dir (state.json sessions, journal session-start /
                session-end ts, transcripts with usage lines, one consult
                subagent) after each of dev, review, review, gate →
                rows `dev 1`, `review 1`, `review 2`, `consult 1`,
                `gate 1`, the dev row's tokens summed (input + cache-read
                + cache-creation / output) and priced from prices.json,
                no elapsed column; the same pass again → `appended: 0`
    buffer      `stage --start --stage plan` before the spec exists →
                buffered in `<spec_folder>/stages/<key>.jsonl`; the spec
                written, `stage --stop` → the row flushed into the table
                and the buffer gone
    two-roots   the planner's `stage --start/--stop --stage plan` run from
                the project root (buffered there, no spec yet); the
                engine's pass in a distinct worktree holding the spec,
                `--from-pass --worktree <wt> --repo-root <root>` → the plan
                row flushed into the worktree's table before the dev row,
                the project root's buffer removed
    append      the supervisor's rows (`stage --append --row-json`) after
                the engine rows; again → `appended: 0`
    refusal     `stage --stop` with no open row → exit 2, `ok: false`,
                the status block naming it

The poster (`plansync.stage_post`) runs in process over a fake Jira
transport (the agent seat's variables set to dummies, no network):

    post        the start and finish comments (AC2's shapes, the marker
                `[stage:<key> start|stop]`) and one worklog of the derived
                span; a second run posts nothing
    retry       a transport answering 503 → `ok: false`, `retryable`,
                the row counted `unposted`; the next run posts them
                (`unposted: 0`)

The drive prints one JSON object {ok, steps[]} and exits nonzero on a red
step. Stdlib-only (NFR9); never prompts (AD-11); each call bounded.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
LIB = PLUGIN_ROOT / "lib"
PLANSYNC = LIB / "plansync.py"
CALL_BOUND_S = 60
KEY = "9-1-a-staged-story"
MODEL = "claude-opus-5-5"
SPEC = ("---\ntitle: 'a staged story'\n---\n\n## Consult Log\n\n- one\n\n"
        "## Auto Run Result\n\nresult\n")
AGENT_ENV = {"TK_ATLASSIAN_AGENT_TOKEN": "dummy", "TK_ATLASSIAN_AGENT_EMAIL": "agent@example.com",
             "TK_ATLASSIAN_CLOUD_ID": "cloud", "TK_ATLASSIAN_SITE": "example.atlassian.net"}


def _stage(*args: str, env: dict | None = None) -> tuple[int, dict | None]:
    proc = subprocess.run(
        [sys.executable, str(PLANSYNC), "stage", *args], stdin=subprocess.DEVNULL,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=CALL_BOUND_S, env={**os.environ, **(env or {})})
    try:
        return proc.returncode, json.loads(proc.stdout)
    except ValueError:
        return proc.returncode, None


def _usage(mid: str, inp: int, out: int, cr: int = 0, cw: int = 0, ts: str = "2026-10-28T23:42:00Z") -> dict:
    return {"type": "assistant", "timestamp": ts, "message": {"id": mid, "model": MODEL, "usage": {
        "input_tokens": inp, "output_tokens": out, "cache_read_input_tokens": cr,
        "cache_creation_input_tokens": cw,
        "cache_creation": {"ephemeral_5m_input_tokens": cw, "ephemeral_1h_input_tokens": 0}}}}


def _user(text: str, ts: str) -> dict:
    return {"type": "user", "timestamp": ts, "message": {"role": "user", "content": text}}


def _epoch(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


class Project:
    def __init__(self, base: Path):
        self.root = base / "proj"
        self.stories = self.root / "_bmad-output" / "specs" / "spec-epic-9" / "stories"
        self.stories.mkdir(parents=True)
        self.spec = self.stories / f"{KEY}-spec.md"
        self.run = self.root / ".bmad-loop" / "runs" / "r1"
        self.run.mkdir(parents=True)
        self.claude = base / "claude"
        self.claude.mkdir()
        self.state = {"spec_folder": "_bmad-output/specs/spec-epic-9",
                      "tasks": {KEY: {"story_key": KEY, "sessions": []}}}
        self._save()

    def _save(self):
        (self.run / "state.json").write_text(json.dumps(self.state), encoding="utf-8")

    def add_pass(self, label: str, role: str, start: str, end: str, lines: list, subagents: dict | None = None):
        sessions = self.state["tasks"][KEY]["sessions"]
        n = 1 + sum(1 for s in sessions if s["task_id"].rsplit("-", 1)[0] == f"{KEY}-{label}")
        task_id, sid = f"{KEY}-{label}-{n}", f"s-{label}-{n}"
        transcript = self.claude / f"{sid}.jsonl"
        transcript.write_text("".join(json.dumps(r) + "\n" for r in lines), encoding="utf-8")
        for name, sub in (subagents or {}).items():
            folder = self.claude / sid / "subagents"
            folder.mkdir(parents=True, exist_ok=True)
            (folder / f"{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in sub), encoding="utf-8")
        sessions.append({"task_id": task_id, "role": role, "status": "completed", "model": MODEL,
                         "session_id": sid, "transcript_path": str(transcript)})
        self._save()
        with (self.run / "journal.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": _epoch(start), "kind": "session-start", "task_id": task_id}) + "\n")
            f.write(json.dumps({"ts": _epoch(end), "kind": "session-end", "task_id": task_id}) + "\n")
        return _stage("--from-pass", "--run-dir", str(self.run), "--story", KEY, "--role", role,
                      "--worktree", str(self.root))

    def rows(self) -> list[dict]:
        sys.path.insert(0, str(LIB))
        import plansync
        return plansync.parse_stage_log(self.spec.read_text(encoding="utf-8"))


def _step(steps: list, name: str, ok: bool, detail: str) -> None:
    steps.append({"step": name, "ok": bool(ok), "detail": detail})


def _writer(base: Path, steps: list) -> Project:
    p = Project(base)
    p.spec.write_text(SPEC, encoding="utf-8", newline="\n")
    p.add_pass("dev", "dev", "2026-10-28T23:41:00Z", "2026-10-28T23:52:10Z",
               [_usage("m1", 100_000, 50_000, cr=1_000_000, cw=200_000)])
    p.add_pass("review", "review", "2026-10-28T23:55:00Z", "2026-10-29T00:05:00Z", [_usage("r1", 10_000, 1_000)])
    consult = [_user("# Consult: a ruling on one objective trigger\n\nquestion", "2026-10-29T00:10:00Z"),
               {**_usage("c1", 5_000, 500, ts="2026-10-29T00:12:00Z"), "agentId": "c1"}]
    p.add_pass("review", "review", "2026-10-29T00:06:00Z", "2026-10-29T00:20:00Z", [_usage("r2", 20_000, 2_000)],
               {"agent-c1": consult})
    code, out = p.add_pass("studio-pipeline.gate", "review", "2026-10-29T00:21:00Z", "2026-10-29T00:25:00Z",
                           [_usage("g1", 3_000, 300)])
    rows = p.rows()
    got = [(r["stage"], r["pass"]) for r in rows]
    want = [("dev", "1"), ("review", "1"), ("review", "2"), ("consult", "1"), ("gate", "1")]
    dev = rows[0] if rows else {}
    text = p.spec.read_text(encoding="utf-8")
    _step(steps, "from-pass", code == 0 and got == want and dev.get("tokens_in") == "1300000"
          and dev.get("tokens_out") == "50000" and dev.get("cost_usd") == "2.6000"
          and "elapsed" not in text and text.index("## Stage Log") < text.index("## Auto Run Result"),
          f"exit {code}; rows {got}; dev tokens {dev.get('tokens_in')}/{dev.get('tokens_out')} cost {dev.get('cost_usd')}")
    code, out = _stage("--from-pass", "--run-dir", str(p.run), "--story", KEY, "--worktree", str(p.root))
    _step(steps, "from-pass-idempotent", code == 0 and out and out.get("appended") == 0,
          f"exit {code}; appended {out and out.get('appended')}")
    rows = [{"stage": "host-leg", "pass": 1, "started": "2026-10-29T01:00:00Z", "ended": "2026-10-29T01:05:00Z",
             "outcome": "green"}, {"stage": "merge", "started": "2026-10-29T02:00:00Z",
                                   "ended": "2026-10-29T02:00:00Z", "outcome": "merged"}]
    code, out = _stage("--append", "--directory", str(p.root), "--story", KEY, "--row-json", json.dumps(rows))
    again, out2 = _stage("--append", "--directory", str(p.root), "--story", KEY, "--row-json", json.dumps(rows))
    stages = [r["stage"] for r in p.rows()]
    _step(steps, "append", code == 0 and out["appended"] == 2 and out2["appended"] == 0
          and stages[-3:] == ["gate", "host-leg", "merge"], f"stages {stages}")
    code, out = _stage("--stop", "--directory", str(p.root), "--story", KEY, "--stage", "plan")
    _step(steps, "refusal", code == 2 and out and out.get("ok") is False and out.get("status") == "blocked"
          and "no open plan row" in str(out.get("reason")), f"exit {code}; reason {out and out.get('reason')}")
    return p


def _buffer(base: Path, steps: list) -> None:
    p = Project(base)
    code, out = _stage("--start", "--directory", str(p.root), "--story", KEY, "--stage", "plan",
                       "--model", MODEL, "--effort", "high")
    buffer = p.root / "_bmad-output" / "specs" / "spec-epic-9" / "stages" / f"{KEY}.jsonl"
    buffered = code == 0 and out["buffered"] and buffer.is_file()
    p.spec.write_text(SPEC, encoding="utf-8", newline="\n")
    code, out = _stage("--stop", "--directory", str(p.root), "--story", KEY, "--stage", "plan")
    rows = p.rows()
    _step(steps, "buffer", buffered and code == 0 and out.get("flushed") == 1 and not buffer.exists()
          and len(rows) == 1 and rows[0]["outcome"] == "done" and rows[0]["ended"] != "—",
          f"buffered {buffered}; exit {code}; rows {[(r['stage'], r['outcome']) for r in rows]}")


def _two_roots(base: Path, steps: list) -> None:
    p = Project(base)  # the project root: the planner runs here, before any spec
    c1, _ = _stage("--start", "--directory", str(p.root), "--story", KEY, "--stage", "plan")
    c2, _ = _stage("--stop", "--directory", str(p.root), "--story", KEY, "--stage", "plan")
    root_buffer = p.root / "_bmad-output" / "specs" / "spec-epic-9" / "stages" / f"{KEY}.jsonl"
    buffered = c1 == 0 and c2 == 0 and root_buffer.is_file()
    worktree = base / "worktree"
    spec = worktree / "_bmad-output" / "specs" / "spec-epic-9" / "stories" / f"{KEY}-spec.md"
    spec.parent.mkdir(parents=True)
    spec.write_text(SPEC, encoding="utf-8", newline="\n")
    sessions = p.state["tasks"][KEY]["sessions"]
    transcript = p.claude / "s-dev-1.jsonl"
    transcript.write_text(json.dumps(_usage("m1", 10, 1)) + "\n", encoding="utf-8")
    sessions.append({"task_id": f"{KEY}-dev-1", "role": "dev", "status": "completed", "model": MODEL,
                     "session_id": "s-dev-1", "transcript_path": str(transcript)})
    p._save()
    with (p.run / "journal.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": _epoch("2099-01-01T00:00:00Z"), "kind": "session-start", "task_id": f"{KEY}-dev-1"}) + "\n")
        f.write(json.dumps({"ts": _epoch("2099-01-01T00:10:00Z"), "kind": "session-end", "task_id": f"{KEY}-dev-1"}) + "\n")
    code, out = _stage("--from-pass", "--run-dir", str(p.run), "--story", KEY, "--role", "dev",
                       "--worktree", str(worktree), "--repo-root", str(p.root))
    sys.path.insert(0, str(LIB))
    import plansync
    rows = plansync.parse_stage_log(spec.read_text(encoding="utf-8"))
    got = [r["stage"] for r in rows]
    _step(steps, "two-roots", buffered and code == 0 and got == ["plan", "dev"] and out.get("flushed") == 1
          and not root_buffer.exists(),
          f"buffered {buffered}; exit {code}; rows {got}; root buffer left {root_buffer.exists()}")


class FakeJira:
    def __init__(self):
        self.comments: list[dict] = []
        self.worklogs: list[dict] = []
        self.fail = False
        self.calls = 0

    def __call__(self, method, url, body):
        self.calls += 1
        path = url.split("/rest/api/2", 1)[1].split("?")[0]
        if self.fail:
            return 503, {"errorMessages": ["unavailable"]}
        bucket, field = (self.comments, "comments") if path.endswith("/comment") else (self.worklogs, "worklogs")
        if method == "GET":
            return 200, {field: bucket, "startAt": 0, "total": len(bucket)}
        made = {"id": str(len(bucket) + 1), "created": "2026-10-29T03:00:00.000+0000", **(body or {})}
        bucket.append(made)
        return 201, made


def _poster(base: Path, steps: list) -> None:
    sys.path.insert(0, str(LIB))
    import config as configlib
    import interchange
    import plansync
    p = Project(base)
    p.spec.write_text(SPEC, encoding="utf-8", newline="\n")
    configlib.standup_project_config(p.root, project_id="stage-drive")
    plansync.write_binding(p.root, {"jira": {"site": "example.atlassian.net", "project_key": "TKS"}})
    plan = plansync.plan_dir(p.root)
    plan.mkdir(parents=True)
    (plan / "ST-001.md").write_text(interchange.render_entity({
        "shape_version": 1, "id": "ST-001", "type": "story", "title": "a staged story", "status": "review",
        "created": "2026-10-28T00:00:00+00:00", "updated": "2026-10-28T00:00:00+00:00",
        "source": "epics.md#story-9.1", "external": {"jira": {"key": "TKS-1"}}}, "\nbody\n"),
        encoding="utf-8", newline="\n")
    plansync.stage_append(p.root, [{"stage": "review", "pass": 2, "started": "2026-10-28T23:41:00Z",
                                    "ended": "2026-10-28T23:52:10Z", "model": MODEL, "effort": "medium",
                                    "tokens_in": 812345, "tokens_out": 10234, "cost_usd": 1.23}], story=KEY)
    key = plansync.stage_row_key(KEY, p.rows()[0])
    saved = {k: os.environ.get(k) for k in AGENT_ENV}
    os.environ.update(AGENT_ENV)
    try:
        fake = FakeJira()
        fake.fail = True
        failed = plansync.stage_post(p.root, "ST-001", story=KEY, transport=fake)
        _step(steps, "post-failure", failed["ok"] is False and failed.get("retryable") is True
              and failed.get("unposted") == 1 and len(failed["pending"]) == 3
              and not (p.root / plansync.STAGE_POSTS_REL).exists(),
              f"ok {failed['ok']}; pending {failed['pending']}; reason {failed['reason']}")
        fake.fail = False
        posted = plansync.stage_post(p.root, "ST-001", story=KEY, transport=fake)
        bodies = [c["body"] for c in fake.comments]
        want = [f"Stage review [pass 2] started — 2026-10-28T23:41:00Z; model: {MODEL}; effort: medium [stage:{key} start]",
                f"Stage review [pass 2] finished — 2026-10-28T23:52:10Z; model: {MODEL}; effort: medium; "
                f"tokens: 812345/10234; cost: $1.23 [stage:{key} stop]"]
        _step(steps, "post", posted["ok"] and posted["unposted"] == 0 and bodies == want and len(fake.worklogs) == 1
              and fake.worklogs[0]["timeSpentSeconds"] == 670,
              f"ok {posted['ok']}; comments {len(bodies)}; worklogs {len(fake.worklogs)}")
        calls = fake.calls
        again = plansync.stage_post(p.root, "ST-001", story=KEY, transport=fake)
        _step(steps, "post-dedupe", again["ok"] and fake.calls == calls and len(fake.comments) == 2,
              f"calls {fake.calls - calls}; comments {len(fake.comments)}")
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def run() -> dict:
    steps: list = []
    with tempfile.TemporaryDirectory(prefix="tk-stage-drive-") as tmp:
        base = Path(tmp)
        os.environ.setdefault("TK_STUDIO_HOME", str(base / "store"))
        for name, fn in (("writer", _writer), ("buffer", _buffer), ("two-roots", _two_roots),
                         ("poster", _poster)):
            folder = base / name
            folder.mkdir()
            fn(folder, steps)
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    del argv  # no arguments: the fixture is built in a temp folder
    try:
        result = run()
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
