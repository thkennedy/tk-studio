---
status: blocked
deviation_score: 0
baseline_revision: 9eef5415da0d4ce2b5c7501cc18fcdd1bee2ed87
---

# The Roster and the Release Motion for Every App

Story 25.1 (Canonical: ST-081). Authoritative text: `_bmad-output/planning-artifacts/epics.md` §"Story 25.1". Plan: `_bmad-output/specs/spec-epic-25/plans/25-1.md`.

## Rulings received (2026-10-14)

The two blocking questions are ruled in `SPEC.md` "Rulings on the open questions" (items 1 and 2) and in the authoritative story text (AC1 and AC3 as amended): roster components are optional per channel, a present entry is complete or refused, no placeholders; `uv` and `bun` carry a per-platform digest map. Re-driven from the baseline.

## Deviation Summary

None. No code, data or doc file was touched; the session halted before planning.

## Consult Log

- 2026-10-14T19:57:30Z — trigger: halt — question: AC1 requires `supervisor`, `studio-web` and `cli` as `{tag, url, sha256}` and `uv`/`bun` as a single `{version, sha256}`, but only the plugin has a release and uv/bun ship one archive per platform; does the session pick a schema (pending marker / optional / deferred; per-platform map) or escalate? — ruling: escalate — do: HALT blocked before writing any spec or code. Hand the operator two questions. (1) Should the roster carry placeholders for the three unreleased components, carry them as optional entries, or leave them out until they ship? Whatever the answer, the guard must accept it. (2) Should the uv/bun `{version, sha256}` entry become a per-platform map, or should the roster pin one named platform? Re-drive 25.1 once the operator has ruled on both. — rule candidate: When a story's acceptance criteria require a schema entry for an artifact that won't exist until a later story or an operator action, the planner settles the schema (pending marker, optional entry or deferred entry, plus the per-platform digest shape) in the SPEC before launch instead of leaving it as a Block If.

## Auto Run Result

Status: blocked
Blocking condition: operator ruling required on the roster schema (consult ruled `escalate`). (1) AC1 requires `supervisor`, `studio-web` and `cli` as `{tag, url, sha256}`, and the guard must refuse a missing digest. None of the three has a release: `apps/studio-web` does not exist (D5, later epic), the `cli` wheel arrives in Story 25.4, and `supervisor--v0.1.0` is an operator cut (AC3). Fabricating a tag, URL or digest is forbidden, so the operator must choose: placeholder entries, optional entries, or no entry until the component ships. The guard must accept whichever is chosen. (2) `uv` and `bun` publish one archive per platform, so a single `{version, sha256}` cannot pin them honestly. The operator must choose: a per-platform digest map, or one named platform. Both are recorded as Block If in `plans/25-1.md` and as Open Questions in `SPEC.md`. Re-drive 25.1 once both are ruled, ideally by recording the rulings in the SPEC or the story text.
Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Baseline: 9eef5415da0d4ce2b5c7501cc18fcdd1bee2ed87 (branch loop/epic-25). No files outside this spec were changed, and nothing was committed.
