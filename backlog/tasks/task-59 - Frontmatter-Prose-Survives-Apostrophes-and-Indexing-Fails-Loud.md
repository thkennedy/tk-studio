---
id: TASK-59
title: Frontmatter Prose Survives Apostrophes and Indexing Fails Loud
status: Done
assignee: []
created_date: '2026-08-10 19:08'
updated_date: '2026-08-10 19:47'
labels:
  - ST-059
milestone: Three Small Truths from the Boundary Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a kb author writing plain-prose frontmatter,
I want mid-word quote characters read as literal text and a frontmatter parse failure surfaced in the index result,
So that a description containing an apostrophe neither crashes the parse nor silently mis-indexes the file.

**Acceptance Criteria:**

**Given** an unquoted scalar containing a mid-word quote char (an apostrophe in prose, a quoted aside mid-sentence)
**When** miniyaml loads the line
**Then** the value parses with the quote chars literal — a quote opens a quoted region only where a scalar can begin (start of the value or after whitespace) — and trailing-comment stripping still honors genuinely quoted scalars that contain `#`

**Given** the parser's existing envelope
**When** the suite runs
**Then** every current miniyaml case stays green — leading-quote scalars, escaped quotes, `#` inside quotes, trailing comments — and `dump()`'s quoting of unsafe values is unchanged

**Given** a kb file whose frontmatter fails to parse
**When** `kb.py` builds the index
**Then** the result carries `warnings[]` naming the file and the parse error while the entry still lands on today's fallback — and the envelope-shaped regression is pinned: a file whose description holds an apostrophe indexes at its declared rank with its declared description, warning-free

**Given** the lib suite at the story's close
**When** it runs
**Then** both layers are unit-pinned and the full suite is green
<!-- SECTION:DESCRIPTION:END -->
