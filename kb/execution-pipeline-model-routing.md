---
title: Execution pipeline — model routing per leg, measured
description: The tested model/effort assignment for every role of a bmad-loop run (pipeline v2), the dollars per landed story behind it, the policy values that held, and how the studio ships and applies it (tk-studio-launch [pipeline] defaults + lib/pipeline.py).
rank: 30
---

# Execution pipeline — model routing per leg, measured

The studio's execution substrate is bmad-loop (studio pipeline decision 5:
ClaudeOS → orchestrator → substrate). bmad-loop routes per **stage**
(`[adapter.dev|review|triage]` in its policy); the studio routes per **leg**
of a story — the session, the subagents it launches, the checks around it —
and per story. This entry records the routing that held up under
measurement, so a project onboarded to the studio starts from it instead of
re-deriving it. Shipped as the resource-default tier of AD-14 in
`plugins/tk-studio/skills/tk-studio-launch/customize.toml` (`[pipeline]`);
resolved and written by `lib/pipeline.py`.

## The legs (pipeline v2)

| Leg | Who runs it | Default | Why |
| --- | --- | --- | --- |
| `planner` | the attended planning session — a fresh session per quiet point; never a subagent | Fable 5.1 / high | Plans, reads reports, judges; never reads transcripts or bulk code |
| `session` | the bmad-loop dev session (`bmad-build-auto`, `adapter.dev`) — a **monitor**: follows the workflow, launches subagents, integrates, verifies, writes the spec, **never decides** | Sonnet 5 / medium | Was Opus. Under monitor posture the session's own spend halved and every story still landed |
| `implementer` | the coding subagent | Sonnet 5 | Well-specified stories need no more; the top tier for prose or judgment-over-numbers stories only (project rule) |
| `reviewers` | the review-hunter subagents — one layer for an S-band story (≤ 3 files, ≤ 150 new lines), two otherwise | Sonnet 5 | Two layers (blind hunter, edge-case hunter) produced every patch the five original layers ever applied |
| `consult` | a subagent the session launches on an **objective trigger** only; rules within scope; every ruling logged (spec `## Consult Log` + one `observation` event) | Opus 5 | Buys judgment where the monitor may not decide; ≈ $0.05–0.15 per consult |
| `seam` | the read-only pre-dispatch check of the **next** story's pinned files / signatures / tables / tests against the tree: `dispatch`, exact text fixes, or `escalate`; three consecutive text fixes = drift → pause | Opus 5 / medium, ≤ 15 calls | A halt on a planner seam costs a re-drive plus an attended hour; the check costs ≈ $0.45–0.68 |
| `review` | bmad-loop's follow-up review session (`adapter.review`) — disabled by default on the measured project; the inline layers are the review | Opus 5 / high | When it does run it must be able to refute |
| `triage` | bmad-loop sweep / triage / resolve sessions (`adapter.triage`) | Opus 5 / high | Judgment over the deferred-work ledger |
| `supervise` | the post-hoc supervisor pass — **only** on a `DRIFT:` line, an engine-directory touch, or an escalation; the epic pass stays Opus / high | Sonnet 5 / low | Was Fable per story; supervision had reached 36 % of all spend |

Subagent legs (`implementer`, `reviewers`, `consult`) carry no effort: the
harness passes no effort flag to a subagent. A subagent is never launched on
the planner tier.

Consult triggers (the only cases the session may consult): `verify-red`,
`halt`, `deviation-gt-0`, `high-severity-finding`, `tripwire`,
`seam-text-fix`, `file-outside-files`. Scope: resolve a contradiction between
pinned facts, choose between two readings of the story, accept or reject a
deviation. Never a design number, a product behaviour, or an architecture
invariant — those return `escalate` and the session halts (CRITICAL stays
human). Three rulings of one shape → a rule drafted for the planner.

## The numbers behind it

Measured on a private C#/Godot game project, 2026-09-09 → 2026-09-13, with a
dedup'd weighted-token counter (main session + subagents, cache reads at
0.1). Prices at the time: Sonnet 5 ≈ $2.37 per M weighted, Opus 5 ≈ $5.9.
Judge on dollars, never on token counters: weighted tokens per story did
**not** fall between versions — the whole saving is the model price.

| Pipeline | Stories | Dev $/story | All-in $/story | Attempt-1 landings |
| --- | --- | --- | --- | --- |
| v1 — Opus session + Opus supervisor pass per story | Epic 1 | 6–8 | 13–17 | — |
| v2 trial — small follow-up stories | 7 | 3.59 | 4.2 | 4/4 after the background-subagent fix |
| v2 — real feature stories (2–5 files, 150–550 lines) | 18 | 6.8 | 8.6 | 18/18 (one accepted attended) |

By story kind on v2 (post-posture-fix means): core code stories ≈ $4.4,
engine-node stories ≈ $8.6 (larger test files; they breach a 2.0M / 1.5M
tripwire), content-authoring stories ≈ $10 (implementer-heavy by design; a
cheaper authoring model is the only lever). Overheads across the 18-story
run: ≈ 50 seam checks ≈ $27, 8 consults ≈ $1.2, 12 conditional post-hoc
passes ≈ $3.5.

Where the cost actually moved: not dollars but **attended time on planner
seams** — six escalates in eighteen stories, each an attended hour, every
one a story-text fact a forward check against the tree would have caught
(a test class with no file slot; a lint that can never pass; a header-only
table). Three posture failures before the monitor fix (the session
implementing itself: 13 source edits, 149 calls, ≈ $9.8 against ≈ $3.5
delegated) explain most of the gap between the trial and the post-fix mean.

The binding constraint on a subscription plan is **weekly plan usage, not
dollars**: ≈ 0.8 percentage points of the weekly cap per story on the top
planning tier. Schedule around the reset, not the invoice.

## Policy values that held (bmad-loop `policy.toml`)

Not written by the studio — the engine's `bmad-loop init` template is the
source — but these are the values the measured run settled on:

- `[limits] max_tokens_per_story = 5000000`, `max_tokens_per_session = 4000000`,
  `cache_read_weight = 0.1`, `session_timeout_min = 90`,
  `stop_without_result_nudges = 3` (Claude Code resumes by itself when a
  background subagent finishes).
- `[review] enabled = false` — the follow-up review fired once, cost ≈ 2.0M
  for two string literals and erased the drift record; the dev pass's inline
  layers are the review.
- Budget bands in weighted tokens, provisional: S 2.0M, M 3.5M, L 5.0M —
  bmad-loop's own journal figure counts the main session only (~55 % of the
  true cost).

## Rules the run taught (fold into planning, not into the loop)

1. The seam check must check **tree facts**, not names: does the fixture or
   content a test reads exist; does the CLI accept the root; is the
   validator on the type the story names; is a `#` colour quoted in a shell
   command.
2. A halted dev session can go undetected until the session timeout; watch
   the escalate line and hard-stop after a halt.
3. Decide per story kind whether a larger tripwire leg or a split rule
   (tests in their own story) applies, rather than paying a graceful stop
   per engine-node story.
4. The reconcile gate hides a gated story from the tripwire (no story-done
   journaled) — fire the tripwire arithmetic at close-out too.
5. **Foreground only.** Every subagent launch carries
   `run_in_background: false`; a turn that ends with a subagent running is
   read by the engine as the session having finished (two attempts lost
   that way). The one observation that reverses the Sonnet session: a
   recurrence of that failure — then the session goes back to Opus and the
   subagents stay Sonnet.

## How the studio applies it

```bash
uv run "$PLUGIN_ROOT/lib/pipeline.py" defaults                                   # the shipped legs
uv run "$PLUGIN_ROOT/lib/pipeline.py" check   --directory <root>                 # validate .bmad-loop/routing.toml
uv run "$PLUGIN_ROOT/lib/pipeline.py" resolve --directory <root> --story <key>   # effective route, tier named per field
uv run "$PLUGIN_ROOT/lib/pipeline.py" apply   --directory <root> --story <key>   # write it where the engine reads it
```

Precedence per leg and field (AD-14): runtime `--set leg.field=value` >
the project's `.bmad-loop/routing.toml` (`[stories."<key>"]` > first
matching `[[rules]]` by `fnmatch` on the story key > `[defaults]`) > the
shipped `[pipeline.legs]`. The consult policy resolves project `[consult]` >
shipped `[pipeline.consult]` as a unit. A project with no `routing.toml`
runs the shipped defaults; one that keeps its own table only lists what it
changes:

```toml
# .bmad-loop/routing.toml — project tier; everything unlisted is the shipped default
[[rules]]
match = "9-*"
note  = "prose in six registers; verbatim lines are tests"
implementer = { model = "claude-opus-5" }

[stories."11-4-balance-pass"]
note = "judgment over numbers"
implementer = { model = "claude-opus-5" }
```

`apply` writes exactly three things: the managed block at the end of
`.bmad-loop/policy.toml` (`[adapter.dev|review|triage]` model + `--effort`;
bmad-loop's `extra_args` replaces the profile's bypass flags, so the block
restates `--permission-mode bypassPermissions`), `CLAUDE_CODE_SUBAGENT_MODEL`
in `.bmad-loop/profiles/claude.toml` when that tracked profile exists, and
`.bmad-loop/routing.current.json` (every leg + the consult policy). It
refuses a missing policy rather than inventing one, and reports any of its
files the project has not gitignored — the engine's preflight refuses a
dirty tree, so `.bmad-loop/policy.toml` and `.bmad-loop/routing.current.json`
belong in the project's `.gitignore`.

The dev session consumes the route through the project's `bmad-build-auto`
customization (`_bmad/custom/bmad-build-auto.toml`, user-authored studio
content — AD-17, stock skill untouched — AD-4): at activation it reads
`routing.current.json`, passes `model:` explicitly on every subagent launch
(implementer, each reviewer layer, the consult), holds monitor posture, and
applies the seam check's text fixes before transcribing the story. The seam
check and the conditional supervisor pass read their legs from the same
file. `tk-studio-launch` runs `apply` for the epic's first story before its
readiness check; stories mode runs the whole epic under one policy, so the
session/review/triage models are per epic while implementer and reviewer
models stay per story through the customization.
