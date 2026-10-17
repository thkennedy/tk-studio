"""Render the nested studio-pipeline copy for apps/supervisor (Story 28.2, AD-21, ADR section 5).

After the merge, apps/supervisor is a nested studio project with its own
.bmad-loop/plugins/studio-pipeline/. Its four prose files (task-planning.md,
consult.md, gate.md, reconcile.md) are the root copy with exactly three
rewrites, and transcribe.py is the root copy with only its two spec-pointer
`companions` lines (the spine and the driver contract) given the first two,
so the engine running in the nested root needs no TK_STUDIO_ROOT:

  - the architecture spine path   `_bmad-output/planning-artifacts/architecture/...`
                                -> `../../_bmad-output/planning-artifacts/architecture/...`
  - the driver contract prefix    `plugins/tk-studio/contracts/`
                                -> `../../plugins/tk-studio/contracts/`
  - the project name `tk-studio` in the three named prose lines (consult.md,
    gate.md, reconcile.md) -> --project-name (default `supervisor`)
  - transcribe.py: the two companion lines `  - _bmad-output/planning-artifacts/
    architecture/...` and `  - plugins/tk-studio/contracts/...` get the same
    `../../` prefix; nothing else in the script changes

Everything else stays byte-identical: every other `_bmad-output/...` path
(the nested project has its own), the `tk-studio-launch` skill name and
`.tk-studio/budget-bands.yaml`. Every rewrite must match: a root copy that
drifted from these anchors is refused, never half-rendered.

The real nested copy is written by the merge's ADR section 5 step 3
fix-ups from this renderer; plugins/tk-studio/lib/tests/test_nest_pipeline.py
pins the diff. Stdlib only; writes only under --out.

Usage: uv run python tools/restructure/nest_pipeline.py --out DIR [--project-name supervisor]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / ".bmad-loop" / "plugins" / "studio-pipeline"
FILES = ("task-planning.md", "consult.md", "gate.md", "reconcile.md", "transcribe.py")
DEFAULT_PROJECT_NAME = "supervisor"
UP = "../../"

SPINE = "`_bmad-output/planning-artifacts/architecture/"
CONTRACTS = "`plugins/tk-studio/contracts/"
NAME = "tk-studio"
# transcribe.py spec_pointer() companion lines (inside a Python string literal)
COMPANION = '"  - '


def _rules(project_name: str) -> dict[str, list[tuple[str, str]]]:
    """Per file: (anchor, replacement) pairs; each anchor must occur."""
    spine = (SPINE, "`" + UP + SPINE[1:])
    contracts = (CONTRACTS, "`" + UP + CONTRACTS[1:])
    companion_spine = (COMPANION + SPINE[1:], COMPANION + UP + SPINE[1:])
    companion_contracts = (COMPANION + CONTRACTS[1:], COMPANION + UP + CONTRACTS[1:])
    return {
        "task-planning.md": [spine, contracts],
        "consult.md": [(f"for the {NAME} pipeline", f"for the {project_name} pipeline")],
        "gate.md": [(f"**gate session** for {NAME}.", f"**gate session** for {project_name}.")],
        "reconcile.md": [(f"adapted to {NAME}.", f"adapted to {project_name}."),
                         spine, contracts],
        "transcribe.py": [companion_spine, companion_contracts],
    }


class NestError(Exception):
    """The root copy no longer carries an anchor the render rewrites."""


def render_text(name: str, text: str, project_name: str = DEFAULT_PROJECT_NAME) -> str:
    """The nested copy of one root file's text (pure)."""
    rules = _rules(project_name).get(name)
    if rules is None:
        raise NestError(f"{name} is not one of the rendered files {FILES}")
    for anchor, replacement in rules:
        if anchor not in text:
            raise NestError(f"{name}: anchor {anchor!r} not found in the root copy")
        text = text.replace(anchor, replacement)
    return text


def render(source: Path = SOURCE, project_name: str = DEFAULT_PROJECT_NAME) -> dict[str, str]:
    """{file name: nested text} for the five rendered files of the root copy."""
    return {name: render_text(name, (source / name).read_text(encoding="utf-8"), project_name)
            for name in FILES}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="render the nested studio-pipeline copy")
    parser.add_argument("--out", required=True, help="folder the rendered files are written to")
    parser.add_argument("--project-name", default=DEFAULT_PROJECT_NAME)
    parser.add_argument("--source", default=str(SOURCE),
                        help="root studio-pipeline folder (default: this checkout's)")
    args = parser.parse_args(argv)
    try:
        rendered = render(Path(args.source), args.project_name)
    except (NestError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for name, text in rendered.items():
        (out / name).write_text(text, encoding="utf-8", newline="\n")
        written.append(str(out / name))
    print(json.dumps({"ok": True, "written": written}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
