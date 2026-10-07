"""transcribe.py: write an epic's stories 1:1 into a bmad-loop stories.yaml.

The deterministic half of the studio-pipeline bootstrap (task-planning.md
section 1). It reads `_bmad-output/planning-artifacts/epics.md`, takes the
`## Epic <N>:` section, and emits one stories-mode unit per
`### Story <N>.<M>:` heading, in document order. Each unit's
`invoke_dev_with` points the dev session at the authoritative story section.
The epics document is the plan and this file is only its dispatch index, the
same shape as The Universe Awaits' make-spec-folder.py, generalised to the
single-file epics.md layout.

Ids are `<N>-<M>-<slug of the title>`, the sprint-status key convention.
They are quoted, and prefix-free because every id ends in its own slug. The
canonical ST-NNN id is carried in the description when the plan entity
exists; the adapter (tk-studio-plan-sync) remains the only id authority, and
this script never writes one.

Usage (from anywhere; stdlib only):
  transcribe.py --root <project> --epic <N> [--spec-folder <rel>] [--write-spec] [--dry-run]

Refuses (exit 2, nothing written) when stories.yaml already holds entries,
when the epic or its stories are missing, or when a generated id collides.
Prints one JSON object on stdout.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path

EPICS_REL = Path("_bmad-output/planning-artifacts/epics.md")
PLAN_REL = Path("_bmad-output/planning-artifacts/plan")
EPIC_RE = re.compile(r"^## Epic (\d+):\s*(.+?)\s*$")
STORY_RE = re.compile(r"^### Story (\d+)\.(\d+[a-z]?):\s*(.+?)\s*$")
SOURCE_RE = re.compile(r'^source:\s*"?epics\.md#story-([\w.]+)"?\s*$', re.M)
ID_RE = re.compile(r"^id:\s*(ST-\d+)\s*$", re.M)
WRAP = 88


class TranscribeError(Exception):
    pass


def slug(title: str, limit: int = 60) -> str:
    words = re.findall(r"[a-z0-9]+", title.lower().replace("'", ""))
    out = ""
    for w in words:
        nxt = f"{out}-{w}" if out else w
        if len(nxt) > limit:
            break
        out = nxt
    return out or "story"


def epic_section(text: str, epic: int) -> tuple[str, list[str]]:
    lines = text.split("\n")
    start = None
    title = ""
    for i, line in enumerate(lines):
        m = EPIC_RE.match(line)
        if m and int(m.group(1)) == epic:
            start, title = i, m.group(2)
            break
    if start is None:
        raise TranscribeError(f"no `## Epic {epic}:` section in {EPICS_REL.as_posix()}")
    body: list[str] = []
    fenced = False
    for line in lines[start + 1:]:
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and line.startswith("## ") and not line.startswith("### "):
            break
        body.append(line)
    return title, body


def stories_of(epic: int, body: list[str]) -> list[dict]:
    stories: list[dict] = []
    fenced = False
    for i, line in enumerate(body):
        if line.startswith("```"):
            fenced = not fenced
        m = None if fenced else STORY_RE.match(line)
        if not m:
            continue
        if int(m.group(1)) != epic:
            raise TranscribeError(f"story {m.group(1)}.{m.group(2)} sits under Epic {epic}")
        want = []
        for nxt in body[i + 1:i + 6]:
            if nxt.startswith(("I want ", "So that ")):
                want.append(nxt.strip())
        stories.append({"dotted": f"{m.group(1)}.{m.group(2)}", "num": m.group(2),
                        "title": m.group(3), "heading": line.strip(), "want": " ".join(want)})
    if not stories:
        raise TranscribeError(f"Epic {epic} has no `### Story {epic}.M:` headings")
    return stories


def canonical_ids(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    plan = root / PLAN_REL
    if not plan.is_dir():
        return out
    for path in plan.glob("ST-*.md"):
        head = path.read_text(encoding="utf-8")[:2000]
        src, ident = SOURCE_RE.search(head), ID_RE.search(head)
        if src and ident:
            out[src.group(1)] = ident.group(1)
    return out


def q(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def folded(key: str, text: str) -> str:
    body = textwrap.wrap(" ".join(text.split()), WRAP - 4, break_on_hyphens=False, break_long_words=False) or [""]
    return f"  {key}: >-\n" + "\n".join(f"    {line}" for line in body)


def entry(epic: int, story: dict, canon: dict[str, str]) -> tuple[str, str]:
    key = f"{epic}-{story['num']}-{slug(story['title'])}"
    cid = canon.get(story["dotted"])
    desc = story["want"] or story["title"]
    if cid:
        desc = f"{desc} Canonical: {cid}."
    dev = (
        f"Story text: {EPICS_REL.as_posix()}, section \"{story['heading']}\", the authoritative "
        f"specification (user story and acceptance criteria). Read the epic's own narrative "
        f"(the paragraphs under \"## Epic {epic}:\") for scope, rulings and the repo the story "
        f"targets; transcribe the story into the spec's intent contract and never re-derive, "
        f"generalise or extend it. Plan: plans/{epic}-{story['num']}.md when present (its Code Map "
        f"is the investigation). Project rules and the verify gate: the studio customization "
        f"(_bmad/custom/bmad-build-auto.toml). Routing: .bmad-loop/routing.current.json; pass "
        f"implementer.model and reviewers.model explicitly on every subagent launch. Deviations: "
        f"one `DRIFT: <what> - <why> - affects: <keys|none>` line each in the Auto Run Result. "
        f"Spec file: write the executor spec as `stories/{key}-<slug of the title>.md` in the spec "
        f"folder; the engine resolves it by the glob `{key}-*.md`, and a file named `{key}.md` is "
        f"read as pending (loop deficiency 1, story 21-6)."
    )
    lines = [f"- id: {q(key)}", f"  title: {q(story['title'])}", folded("description", desc),
             folded("invoke_dev_with", dev)]
    return key, "\n".join(lines)


def spec_pointer(epic: int, title: str) -> str:
    return (
        "---\n"
        f"epic: {epic}\n"
        f"title: {q(f'Epic {epic}: {title}')}\n"
        "status: transcribed\n"
        "companions:\n"
        f"  - {EPICS_REL.as_posix()}\n"
        "  - _bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md\n"
        "  - plugins/tk-studio/contracts/driver-contract.md\n"
        "---\n\n"
        f"# Epic {epic}: {title} (spec folder)\n\n"
        "This folder exists so bmad-loop can dispatch the epic in stories mode. It is a pointer, "
        f"not a plan: the plan is the `## Epic {epic}:` section of the epics document, whose story "
        "sections carry every acceptance criterion. `stories.yaml` lists those stories 1:1 in "
        "execution order.\n"
    )


def run(root: Path, epic: int, spec_rel: str | None, write_spec: bool, dry: bool) -> dict:
    epics = root / EPICS_REL
    if not epics.is_file():
        raise TranscribeError(f"missing {EPICS_REL.as_posix()}")
    title, body = epic_section(epics.read_text(encoding="utf-8"), epic)
    stories = stories_of(epic, body)
    folder = root / (spec_rel or f"_bmad-output/specs/spec-epic-{epic}")
    manifest = folder / "stories.yaml"
    if manifest.is_file() and re.search(r"^- id:", manifest.read_text(encoding="utf-8"), re.M):
        raise TranscribeError(f"{manifest.relative_to(root).as_posix()} already has entries; "
                              "transcription only seeds an empty manifest")
    canon = canonical_ids(root)
    keys, blocks = [], []
    for story in stories:
        key, block = entry(epic, story, canon)
        if any(k == key or k.startswith(key + "-") or key.startswith(k + "-") for k in keys):
            raise TranscribeError(f"id {key} collides with an earlier id (prefix-free rule)")
        keys.append(key)
        blocks.append(block)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    text = (
        f"# stories.yaml: Epic {epic} of this project, transcribed 1:1 from {EPICS_REL.as_posix()}\n"
        f"# by .bmad-loop/plugins/studio-pipeline/transcribe.py on {stamp}. The epics document is\n"
        "# the plan; the studio gate may append remediation entries (`<key>-r<n>`) and revise\n"
        "# UNSTARTED entries' invoke_dev_with, nothing else.\n\n" + "\n\n".join(blocks) + "\n"
    )
    written = []
    if not dry:
        folder.mkdir(parents=True, exist_ok=True)
        manifest.write_text(text, encoding="utf-8", newline="\n")
        written.append(manifest.relative_to(root).as_posix())
        spec = folder / "SPEC.md"
        if write_spec and not spec.exists():
            spec.write_text(spec_pointer(epic, title), encoding="utf-8", newline="\n")
            written.append(spec.relative_to(root).as_posix())
    return {"ok": True, "dry_run": dry, "epic": epic, "stories": keys, "written": written,
            "canonical": {k: canon.get(s["dotted"]) for k, s in zip(keys, stories)}}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="transcribe an epic into stories.yaml")
    ap.add_argument("--root", default=".")
    ap.add_argument("--epic", type=int, required=True)
    ap.add_argument("--spec-folder")
    ap.add_argument("--write-spec", action="store_true", help="also write a pointer SPEC.md when absent")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    try:
        out = run(Path(args.root).resolve(), args.epic, args.spec_folder, args.write_spec, args.dry_run)
    except TranscribeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
