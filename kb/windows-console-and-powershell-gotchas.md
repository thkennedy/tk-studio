---
title: Windows console and PowerShell gotchas
description: BOM-writing PowerShell cmdlets corrupt canonical frontmatter (duplicate-id mints), and cp1252 consoles crash unicode JSON prints — the rules and guardrails for both.
rank: 40
---

# Windows Console and PowerShell Gotchas

Two machine-discovered hazards from the v1 build (see the v1 retrospective,
2026-08-06). Both bit for real; both have guardrails now. Any agent working
in this repo on Windows inherits these rules.

## 1. Never write canonical plan files with PowerShell `Set-Content` / `Out-File`

Windows PowerShell 5.1 writes a UTF-8 **BOM** (or ANSI, depending on cmdlet
and version). A BOM before the opening `---` breaks frontmatter parsing, and
`plansync` then treats the entity as id-less and mints a **duplicate id**
from the counter. The AD-4 duplicate-id block catches it loudly at the next
sync, but the file is already corrupted.

**Rule:** edit canonical planning artifacts (`_bmad-output/planning-artifacts/plan/`,
anything with `shape_version` frontmatter) only with Python (`pathlib.write_text(...,
encoding="utf-8")`), or an editor/tool that writes BOM-less UTF-8. For commit
messages with non-ASCII, use `git commit -F <msgfile>`, not `-m`.

## 2. Every CLI `main()` reconfigures stdout to utf-8

Windows consoles default to cp1252 while the studio CLIs print JSON with
`ensure_ascii=False` — arbitrary unicode in titles/descriptions crashes the
final print with `UnicodeEncodeError` *after the work has already landed*
(the exact print-only silent divergence AD-11 forbids; `observe.py`
demonstrated it live).

**Rule:** every CLI entry point starts `main()` with:

```python
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
```

Enforced by `lib/tests/test_utf8_guard.py`: a static sweep over every CLI
module (lib/*.py, skills/*/scripts/*.py, the conformance runner) plus a live
cp1252 subprocess round-trip. A new CLI without the guard fails the suite.
