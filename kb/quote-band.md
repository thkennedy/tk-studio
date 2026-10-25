---
title: The quote band — how an engagement is priced from the studio's own history
description: Story 32.5's record. The method behind `engage.py quote` (a seeded bootstrap of the project's metered per-story tokens and dollars into a 50/85/95 band with a hard cap), the meter's structured observation it reads, the thin-history rule, and the first figures over this repo's own history.
rank: 64
---

# The quote band (Story 32.5)

An engagement is approved with a price and its tail, never a bare number
(F2 step 4; D4; B5 item 4). `engage.py quote` computes it; the planner proposes
`go`; the owner's `go` moves `scoping → quoted` through 32.1's `quote-present`
row. The quote itself never moves the state.

## The history it reads

The trial meter (`plugins/tk-studio/lib/meter.py`) writes one `observation`
per landed story. Since Story 32.5 its payload carries, besides the unchanged
free-text `description`, the structured and additive fields:

| field | meaning |
|---|---|
| `kind` | `"meter"` |
| `story_key` | the story's key |
| `epic` | the key's leading integer |
| `usd` | the story's `usd_total` at the list price |
| `legs.<leg>` | `{usd, usage: {input, output, cache_read, cache_write}}`; `cache_write` = 5m + 1h writes |
| `route` | leg → model |
| `prices_date` | the `prices.json` date it was priced at |

The key is `usage`, not `tokens`: the ledger sanitizer redacts any key that
matches `token` wholesale (`classify.CREDENTIAL_KEY_RE`), and that credential
rule is not weakened. `observation.json` still equals the ledger line, and
`meter.py harvest` re-emits the same fields.

`quote` reads every machine's ledger under the store's `measurements/`. It
keeps the records whose envelope `project` is the project's key and whose
payload says `kind: meter`, deduped by `story_key` (the last one wins). A
story's tokens are `Σ legs (input + output + cache_read + cache_write)`. An
older free-text `meter: story=… usd=…` line is counted as
`basis.history.unstructured` and never parsed.

## The method

- **Count.** `n` = the `#### Story <k>.<m>: …` headings under `scope.md`'s
  `## Proposed epics and stories` (`engage.scope_counts`, headings only, so
  an owner-edited scope still counts).
- **Bootstrap.** `random.Random(seed)`, 10,000 resamples. Each draws `n`
  story indices with replacement and sums tokens **and** dollars over the
  same indices. The default seed is the first 6 bytes of
  `sha256("<engagement>:<n>")` (always below 2^53, so it survives the
  supervisor's JSON rewrite of the record), recorded in `basis.seed`, so a
  rerun gives the same band. An explicit `--seed` outside `0 <= seed < 2^53`
  refuses `BadSeed`.
- **Percentiles.** Nearest rank, `sorted[ceil(p/100 × R) − 1]`, for 50, 85
  and 95. Each band is `{tokens, usd, share}`.
- **Share.** `tokens / plan.window_tokens` (4 decimals), read from the user
  config `~/.tk-studio/config.yaml` (or the studio defaults; never the
  project's). If that key is absent or not a positive integer, the share is
  `"share unknown"`.
- **Cap.** `cap = p95 + one story at p85`, the one-story draw continuing
  the same random stream. `quote.cap` is a number in USD (what 32.1's
  `raise-cap` adds to), and `basis.cap_tokens` carries the tokens. At the
  cap the run pauses `partial`, the engagement's issue blocks with the
  figures, and the owner decides (`basis.at_cap`).
- **Basis.** `method`, `resamples`, `seed`, `stories`, `epics[] {k, title,
  stories, ep_id}`, `history {n, unstructured, project}`, `kind: "story"`
  (project-wide; the meter carries no story kind yet), `thin`, `at_cap`,
  `route`, `autonomy` (`ask`, `steady`, `full`, the levels 32.6 offers),
  `planning_usd` with `scoping_billable` (planning spend so far > 0),
  `prices_date`, `window_tokens`, `cap_tokens` and `notes`.
- **The board.** Each proposed epic `k` gets the id `plan-counter.yaml`
  predicts, `EP-<next.epic + k − 1>`. Its `usd_estimate` (the p85 dollars of
  a bootstrap over that epic's own story count) is written into
  `.tk-studio/budget-bands.yaml`'s top-level `epics:`: every byte outside
  that block is kept, other epics' entries are kept and this quote's are
  overwritten. The proposed epics must be numbered 1..m in order (else
  `NoScope`), so no id lands on a live epic or a gap; with the counter
  unreadable `ep_id` is `null` and no band is written. `GET /board`'s
  `band_usd` then draws the band against spend once the epic exists. If the counter moves before approval, 32.6
  re-keys from `basis.epics[].ep_id`.

## Thin history

With fewer than **8** structured records for the project, `basis.thin` is
true and the notes say `thin history: <n> landed stories`. The samples are
then the project's records plus an analogy prior (design spec §10's sizing
by analogy): the twelve per-story all-in dollars of the Opus 5.5 trial,
Epics 20–22 (`kb/trial-record-opus-5-5.md`, Σ $246.64). A prior sample's
tokens are its dollars divided by the history's mean usd per token. Band85,
band95 and the cap are multiplied by **1.5** (`basis.widen`, with
`basis.prior` naming the source). With no metered story at all, the tokens
and the share are `null` and the notes say
`tokens unknown: thin history (no metered story)`. The dollars always
carry, so the quote is never a bare number.

## First figures (2026-10-25)

The store's ledger on the agent machine holds 332 events. For the project
key `tk-studio` it has **0 structured meter records** and 3 unstructured
`meter:` lines. Every earlier story was metered before this story made the
payload structured. So the first quotes are thin history with no metered
story: dollars only, from the prior, widened.

The figures below come from a `quote --dry-run`-style computation over that
history (`quote.compute`, default seed for `ENG-001`, no `plan.window_tokens`
set):

| proposed stories | seed | band50 | band85 | band95 | cap |
|---|---|---|---|---|---|
| 1 | 278516312347859 | $20.02 | $53.30 | $57.20 | $110.49 |
| 8 (one epic) | 205926277844329 | $163.80 | $291.17 | $318.87 | $372.17 |

The tokens and the share are `null` in both rows. For the 8-story epic the
board's `usd_estimate` is $292.08 (its own p85 draw).

A caveat for later readers: the project key is the explicit `project_id`
from tracked config, else the root's basename. Each loop worktree here has
no tracked id, so its meter records carry the worktree's name
(`q-run-epic-32-…`), not `tk-studio`. A quote run from the main checkout
does not see those records until they share one key.
