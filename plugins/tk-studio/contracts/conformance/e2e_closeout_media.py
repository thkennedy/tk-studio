"""The Story 35.6 e2e drive — the closeout carries the proof.

`engage.py closeout` (the supervisor's closeout pass runs it on the host)
renders the engagement's `closeout.md` and publishes it beside the scope.
Story 35.6 gives each slice entry of the closeout input its own leg's
`report.json` and sampled frames (`slices[].report?`, `frames?`, paths
under the run workspace). This drive runs `engage.closeout` in process, in
a temp served root, against a fake Confluence transport (the shape of
`test_engage.py`'s `FakeEngagementConfluence`, copied here, never imported
from the tests):

    setup     an `in-progress` engagement record and its `scope.md`; two
              slice stories, each with its own leg's `report.json`, frames
              and contact sheet under a temp store (`legs/<stamp>/`,
              `sheets/<stamp>.png`), and the closeout input naming them
    closeout  `engage.closeout` → a `complete` status block, last
    page      `closeout.md` carries each story's own sheet image, its
              `| Report | Value |` verdict table (its own seed) and its
              frame and report links
    files     each sheet, report and frame written beside `closeout.md`,
              the bytes of its own leg
    attached  the page's attachments hold `<key>-report.json`, every
              `<key>-frame-<name>` and the sheets

No bun, no network, no credential (the agent-seat variables the gateway
client checks for are set to fakes in this process only). The supervisor
side (each story's own leg) is covered by `delivery.test.ts`.

The drive prints one JSON object {ok, steps[]} and exits nonzero on a red
step. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
ENG = "ENG-001"
NOW = "2026-10-29T05:00:00.000Z"
SCOPE = """# ENG-001: Scope of Work

## Goal

A vertical slice of the game.

## Deliverables

### Playable slice

The first room plays.

Acceptance signal: the playable step passes.

## Proposed epics and stories

### Epic 1: Slice

#### Story 1.1: Room

The room loads.

#### Story 1.2: Player

The player moves.
"""
STORIES = {
    "41-1-room": {"stamp": "1-1-1", "seed": 7, "verdict": "pass",
                  "frames": ["tick-000000.png", "tick-000030.png"]},
    "41-2-player": {"stamp": "2-2-2", "seed": 9, "verdict": "fail",
                    "frames": ["tick-000060.png"]},
}


class FakeConfluence:
    """The Confluence routes `engage.closeout` publishes through (v2 spaces,
    folders, pages, a page's attachments; v1 attachment upload), the shape
    of the test suite's `FakeEngagementConfluence`. Folders keep their
    parent."""

    def __init__(self, confluence):
        self.confluence = confluence
        self.pages: dict[str, dict] = {}
        self.attachments: dict[str, list[dict]] = {}
        self.folders: dict[str, list[dict]] = {"S-1": []}
        self.child_folders: dict[str, list[dict]] = {}
        self.calls: list[tuple[str, str]] = []
        self._ids = 0

    def _id(self, base: int) -> str:
        self._ids += 1
        return str(base + self._ids)

    def _cursor(self, values):
        return 200, {"results": values, "_links": {}}

    def __call__(self, method, url, body):
        c = self.confluence
        if "/ex/confluence/" in url and c.V1_PREFIX + "/" in url:
            path = url.split(c.V1_PREFIX, 1)[1].partition("?")[0]
            self.calls.append((method, "v1:" + path))
            m = re.match(r"^/content/([^/]+)/child/attachment$", path)
            if method == "PUT" and m and isinstance(body, c.Multipart):
                files = self.attachments.setdefault(m.group(1), [])
                files[:] = [f for f in files if f["title"] != body.filename]
                files.append({"id": self._id(70000), "title": body.filename,
                              "comment": body.fields.get("comment"),
                              "fileSize": len(body.content),
                              "content": body.content})
                return 200, {"results": [{"title": body.filename}]}
            return 400, {"message": f"unhandled v1 {method} {path}"}
        if "/ex/confluence/" not in url:
            return 400, {"message": f"unhandled {method} {url}"}
        path, _, query = url.split(c.API_PREFIX, 1)[1].partition("?")
        self.calls.append((method, path))
        del query  # one page per list: no cursor to follow
        m = re.match(r"^/spaces/([^/]+)/direct-children$", path)
        if method == "GET" and m:
            return self._cursor([{"id": "home", "type": "page",
                                  "title": "Overview"}]
                                + self.folders.get(m.group(1), []))
        if method == "POST" and path == "/folders":
            entry = {"id": self._id(50000 if not body.get("parentId")
                                    else 55000),
                     "type": "folder", "title": body["title"]}
            if body.get("parentId"):
                entry["parentId"] = body["parentId"]
                self.child_folders.setdefault(body["parentId"], []).append(
                    entry)
            else:
                self.folders.setdefault(body["spaceId"], []).append(entry)
            return 200, entry
        m = re.match(r"^/folders/([^/]+)/direct-children$", path)
        if method == "GET" and m:
            kids = [{"id": f["id"], "type": "folder", "title": f["title"]}
                    for f in self.child_folders.get(m.group(1), [])]
            kids += [{"id": p["id"], "type": "page", "title": p["title"]}
                     for p in self.pages.values()
                     if p["parentId"] == m.group(1)]
            return self._cursor(kids)
        if method == "POST" and path == "/pages":
            if any(p["title"] == body["title"] for p in self.pages.values()):
                return 400, {"message": "A page with this title already "
                                        "exists"}
            pid = self._id(60000)
            self.pages[pid] = {"id": pid, "title": body["title"],
                               "parentId": body["parentId"], "version": 1,
                               "body": body["body"]["value"]}
            return 200, self._page_json(pid)
        m = re.match(r"^/pages/([^/]+)$", path)
        if m and m.group(1) in self.pages:
            page = self.pages[m.group(1)]
            if method == "GET":
                return 200, self._page_json(page["id"])
            if method == "PUT":
                if body["version"]["number"] != page["version"] + 1:
                    return 409, {"message": "version conflict"}
                page.update(version=body["version"]["number"],
                            title=body["title"], body=body["body"]["value"])
                return 200, self._page_json(page["id"])
        m = re.match(r"^/pages/([^/]+)/attachments$", path)
        if method == "GET" and m:
            return self._cursor([{k: v for k, v in f.items()
                                  if k != "content"}
                                 for f in self.attachments.get(m.group(1),
                                                               [])])
        return 400, {"message": f"unhandled {method} {path}"}

    def _page_json(self, pid):
        page = self.pages[pid]
        return {"id": pid, "title": page["title"],
                "parentId": page["parentId"],
                "version": {"number": page["version"]},
                "body": {"storage": {"value": page["body"],
                                     "representation": "storage"}},
                "_links": {"webui": f"/spaces/TKSTUDIO/pages/{pid}"}}


def _record() -> dict:
    return {"shape_version": 1, "id": ENG, "project": "drive",
            "state": "in-progress", "request": "A vertical slice",
            "questions": [], "assumptions": [], "scope_page": None,
            "quote": None, "autonomy": None, "approved_at": NOW,
            "closeout": None, "created": NOW, "updated": NOW,
            "spend": {"planning_usd": 0, "runs_usd": 0}, "inputs": [],
            "game": True}


def _leg(store: Path, story: str, spec: dict) -> dict:
    """One leg's copy under the store and the closeout input's entry."""
    leg = store / "legs" / spec["stamp"]
    (leg / "frames").mkdir(parents=True, exist_ok=True)
    report = {"schema": 1, "verdict": spec["verdict"],
              "failed": None if spec["verdict"] == "pass" else
              {"invariant": "node_exists", "tick": 60,
               "detail": "Player missing"},
              "seed": spec["seed"], "ticks": 120, "ticks_run": 120,
              "mode": "movie", "frames": [], "log_errors": [],
              "moments": [{"name": "spawn", "tick": 0}]}
    (leg / "report.json").write_text(json.dumps(report), encoding="utf-8")
    frames = []
    for name in spec["frames"]:
        path = leg / "frames" / name
        path.write_bytes(b"\x89PNG\r\n\x1a\n" + f"{story}:{name}".encode())
        frames.append(str(path))
    sheet = store / "sheets" / f"{spec['stamp']}.png"
    sheet.parent.mkdir(parents=True, exist_ok=True)
    sheet.write_bytes(b"\x89PNG\r\n\x1a\n" + f"{story}:sheet".encode())
    return {"story": story, "engine": "green", "assets": "green",
            "playable": spec["verdict"], "contact_sheet": str(sheet),
            "report": str(leg / "report.json"), "frames": frames}


def _input(slices: list[dict]) -> dict:
    return {"run_id": "q-1", "outcome_hint": "partial",
            "runs": [{"run_id": "q-1", "job": "run-epic-41",
                      "state": "complete", "studio_run_id": "s-1",
                      "cost_usd": None, "pr": None}],
            "stories": [{"key": k, "run_id": "q-1", "spec_status": "done",
                         "pr": None, "pr_state": None} for k in STORIES],
            "epics": [{"job": "run-epic-41", "queued": True}],
            "side_exits": [], "spend": {"planning_usd": 0, "runs_usd": 0},
            "quote": None, "slices": slices}


def run() -> dict:
    steps: list[dict] = []

    def step(name: str, ok: bool, detail: str = "") -> bool:
        steps.append({"step": name, "ok": bool(ok), "detail": detail})
        return bool(ok)

    sys.path.insert(0, str(PLUGIN_ROOT / "lib"))
    import config as configlib  # noqa: E402 - the plugin's own lib
    import confluence  # noqa: E402
    import engage  # noqa: E402
    import jirabackend  # noqa: E402
    import plansync  # noqa: E402

    with tempfile.TemporaryDirectory(prefix="tk-closeout-media-") as tmp:
        base = Path(tmp)
        saved = dict(os.environ)
        try:
            os.environ["TK_STUDIO_HOME"] = str(base / "home")
            for name in (jirabackend.TOKEN_ENV, jirabackend.EMAIL_ENV):
                os.environ.pop(name, None)
            os.environ.update({
                jirabackend.SITE_ENV: "example.atlassian.net",
                jirabackend.AGENT_EMAIL_ENV: "agent@example.com",
                jirabackend.AGENT_TOKEN_ENV: "fake-jira-token",
                jirabackend.AGENT_CONFLUENCE_TOKEN_ENV: "fake-token",
                jirabackend.CLOUD_ID_ENV: "cloud-drive"})
            root = base / "proj"
            root.mkdir()
            configlib.standup_project_config(root, project_id="drive")
            plansync.write_binding(root, {
                "jira": {"site": "example.atlassian.net"},
                "confluence": {"space_key": "TKSTUDIO", "space_id": "S-1"}})
            eng_dir = root / "_bmad-output" / "engagements" / ENG
            eng_dir.mkdir(parents=True)
            (eng_dir / "engagement.yaml").write_text(
                json.dumps(_record(), indent=2) + "\n", encoding="utf-8")
            (eng_dir / "scope.md").write_text(SCOPE, encoding="utf-8")
            store = base / "home" / "projects" / "drive" / "runs" / "s-1" \
                / "playable"
            slices = [_leg(store, k, v) for k, v in STORIES.items()]
            (base / "measurements").mkdir()
            step("setup", True, f"{len(slices)} slice legs under {store}")

            fake = FakeConfluence(confluence)
            result = engage.closeout(root, ENG, _input(slices),
                                     transport=fake, sleep=lambda _s: None,
                                     now=NOW,
                                     measurements=base / "measurements")
            if not step("closeout", list(result)[-4:] == [
                    "status", "intent", "artifacts", "reason"]
                    and result.get("status") == "complete",
                    f"status {result.get('status')}: {result.get('reason')}"
                    f"; notes {result.get('notes')}"):
                return {"ok": False, "steps": steps}

            text = (eng_dir / "closeout.md").read_text(encoding="utf-8")
            missing = []
            for key, spec in STORIES.items():
                want = [f"![{key} contact sheet]({key}-contact-sheet.png)",
                        "| Report | Value |",
                        f"| verdict | {spec['verdict']} |",
                        f"| seed | {spec['seed']} |",
                        f"[report.json]({key}-report.json)"]
                want += [f"[{n}]({key}-frame-{n})" for n in spec["frames"]]
                missing += [w for w in want if w not in text]
                # the story's own block: its sheet, then its own table
                at = text.find(f"![{key} contact sheet]")
                own = text[at:text.find("\n![", at + 1)
                           if text.find("\n![", at + 1) > 0 else None]
                if f"| seed | {spec['seed']} |" not in own:
                    missing.append(f"{key}: its own seed under its sheet")
            step("page", not missing, "; ".join(missing)
                 or "each story's sheet, verdict table and links")

            wrong = []
            for key, spec in STORIES.items():
                pairs = [(f"{key}-report.json",
                          store / "legs" / spec["stamp"] / "report.json"),
                         (f"{key}-contact-sheet.png",
                          store / "sheets" / f"{spec['stamp']}.png")]
                pairs += [(f"{key}-frame-{n}",
                           store / "legs" / spec["stamp"] / "frames" / n)
                          for n in spec["frames"]]
                for name, source in pairs:
                    copy = eng_dir / name
                    if not copy.is_file() or \
                            copy.read_bytes() != source.read_bytes():
                        wrong.append(name)
            step("files", not wrong, "; ".join(wrong)
                 or "every sheet, report and frame beside closeout.md")

            page = next((p for p in fake.pages.values()
                         if p["title"] == f"{ENG}: Closeout"), None)
            titles = sorted(f["title"] for f in
                            fake.attachments.get(page["id"], [])) \
                if page else []
            expected = sorted(
                [f"{k}-report.json" for k in STORIES]
                + [f"{k}-contact-sheet.png" for k in STORIES]
                + [f"{k}-frame-{n}" for k, v in STORIES.items()
                   for n in v["frames"]])
            step("attached", page is not None and titles == expected,
                 f"attachments {titles}" if titles != expected
                 else f"{len(titles)} attachments on {ENG}: Closeout")
        finally:
            os.environ.clear()
            os.environ.update(saved)
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        out = run()
    except Exception as exc:  # the drive's own failure, reported as data
        out = {"ok": False, "error": f"{exc.__class__.__name__}: {exc}",
               "steps": []}
    print(json.dumps(out))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
