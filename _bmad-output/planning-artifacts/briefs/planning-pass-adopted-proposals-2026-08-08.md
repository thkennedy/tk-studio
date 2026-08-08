# Adopted proposals (PROP-001 + PROP-003) — planning pass

**Date:** 2026-08-08 · **Status:** ruled 2026-08-08 — see §9; plans only, no code
**Against:** proposals/ledger.md PROP-001 + PROP-003 (Adopted, operator triage
2026-08-08, `2d0a36e`) · issues/ledger.md ISS-001 (PROP-001's twin, carries
the fix candidate) · ARCHITECTURE-SPINE.md AD-1 (base update as one
reviewable motion), AD-8 (evolve-loop landed annotation), AD-11
(headless-clean), AD-12 (ledger discipline) · the evolve-loop planning pass
(planning-pass-evolve-loop-automation-2026-08-07.md — the precedent this
mirrors)

This is the loop's first full cycle closing: observations became proposals
(Epic 10), an operator adopted two, and this pass plans their
implementation as ordinary planned work — exactly what D1 ruled adoption
means. Nothing here changes the contract pin (0.1.9); the one candidate
contract edit is a clarification (0.1.10) rung only if D3 rules a
behavior note into the §2 row.

---

## 1. What the adopted rows name, verified

- **PROP-001** (Medium, Adopted; twin ISS-001 Open, Medium): upstream
  bmad-method 6.10.0's `--yes` reinstall over an existing install
  re-serializes list-valued module config options as JSON strings
  (`primary_platform [a,b]` becomes a quoted string) and rewrites installed
  files with LF endings — large no-op git churn after every verify run
  (first observed during the ST-1.3 determinism run, 2026-07-27; reported
  again 2026-08-06). Candidate change, stated identically in both ledgers:
  teach tk-studio-base-update's verify step to auto-normalize the known
  churn classes before diffing, and file the re-serialization defect
  upstream with bmad-method.
- **PROP-003** (Low, Adopted): CLI JSON prints crash on cp1252 Windows
  consoles when payloads carry non-ASCII (`ensure_ascii=False` with no
  stdout reconfigure). Candidate change: sweep
  `sys.stdout.reconfigure(encoding="utf-8")` across every `lib/*.py` and
  `scripts/*.py` CLI (AD-11 headless-clean).

## 2. Current state, verified against the code

**PROP-003's candidate change is already implemented and test-enforced.**
The sweep landed mid-Epic-9 as `3ee9117` ("utf-8 stdout guard sweep across
all 25 remaining CLIs (AD-11)") — hours *after* the 2026-08-06 observation
that seeded the proposal, which is why the machine-drafted row could not
see it. Enforcement is two-layer in `lib/tests/test_utf8_guard.py`:

- a **static sweep** that walks every shipped CLI (`lib/*.py`,
  `skills/*/scripts/*.py`, `contracts/conformance/*.py` — any module
  defining `main()`) and fails if the guard call is missing inside
  `main()`, plus a guard-the-guard check that the scan keeps finding ≥25
  known CLIs;
- a **live cp1252 round-trip** on `observe.py` (the demonstrated crasher)
  under a forced-cp1252 stdout.

The conformance runner already relies on the invariant (its drive decode is
utf-8, commented against `test_utf8_guard`). There is no un-swept CLI: no
`tools/` scripts exist (the spine's structural-seed `tools/` entry is
unrealized), and the sweep's glob covers everything the proposal names.
What the proposal asks for exists; the open question is disposition (D1).

**PROP-001's gap is precisely located.** `base_update.py`'s flow is
preflight → branch → lock bump commit → install at new pin (install_base
verifies manifest≙pin, emits `install-outcome`) → **step 5: `git add -A` +
commit the full install diff** → push + integration PR. Nothing between
install and commit inspects the diff; every churn class the installer
produces lands in the integration PR the reviewer must read. AD-1's whole
point — "the reviewable upstream diff" — is degraded by noise on every
run and drowned entirely on same-version re-affirmation runs.
`base_update.py` also has **no unit tests today** (the only skill script
without them); the normalizer is the natural occasion to fix that.

**Post-normalization, an empty diff becomes reachable.** Today churn
guarantees a nonempty diff, so step 5's plain `commit` (no
`--allow-empty`, `check=False`) always has something and a PR always
opens. Once churn-only files are reverted, a same-version re-affirmation
run can produce zero install diff — the outcome ISS-001 names as the
expectation ("reinstall at pin is a no-op"). What the motion does then is
a real behavior choice (D3).

## 3. Invariants preserved by construction

1. **AD-1 — one reviewable motion, nothing merges automatically.** The
   normalizer changes what the integration PR *shows*, never what merges.
   Branch isolation and the failure-path restore are untouched.
2. **Revert only what is provably churn.** A file is reverted only when
   old and new content are equal after normalizing the *named* churn
   classes; a file with any real change stays in the diff untouched, noise
   and all. Unknown churn classes are never guessed at — they show, a
   human sees them, and (if recurring) they become a new observation for
   the loop. The result JSON names what was reverted, per class.
3. **Ledger ownership (AD-12).** The machine never edits Impact/Status:
   PROP-001/PROP-003 row movements and ISS-001's Open→Resolved are
   operator hand-edits, listed as acceptance evidence, performed by the
   operator at epic close.
4. **Contract discipline.** Version + pin test + contract doc move
   together; a clarification bump (0.1.10) rides only if D3 puts a
   behavior note in the §2 row. No payload field is added or changed.
5. **AD-11.** The motion stays prompt-free; new outcomes are named in the
   result JSON, never asked about.

## 4. Proposed target shape (PROP-001)

| Concern | Proposal | Notes |
|---|---|---|
| Normalizer home | a pure function set in `base_update.py` (or split to `lib/` if it grows) — `churn_only(old, new, path)` per file | testable without git; step 4.5 walks `git status` under `_bmad/` + `.claude/skills/`, reverts churn-only files via `git checkout --` |
| Churn class 1 | line-endings-only: old ≡ new after CRLF/LF normalization | applies to every installed file |
| Churn class 2 | list re-serialization: a yaml config value whose new form is a quoted JSON string parsing back to the old list | attempted only on `_bmad/**` config yaml; combined with class 1 in one equivalence check |
| Reporting | result JSON gains `normalized: {reverted: N, by_class: {...}}` | additive script-output detail; not a contract payload change |
| Empty diff | D3 fork — skip the PR and report the verified no-op, or open the PR regardless | reachable only post-fix; re-affirmation runs are the case |
| Upstream filing | issue text drafted as an epic artifact from ISS-001's evidence; actually filing on the bmad-method tracker is operator-gated (D4) | outward-facing action — never unilateral |
| Tests | first unit tests for `base_update.py`: normalizer equivalence cases (endings-only, re-serialization, mixed-real-change stays, unknown churn stays) | acceptance beyond units: a live same-version re-affirmation run over this repo showing churn reverted |
| Contract | no shape change; 0.1.10 clarification only if D3 adds row wording | pin in `test_driver_contract.py`; doc + README + pin move together (0.1.8 precedent) |

## 5. What the loop's first cycle closing looks like (grounding)

This epic is the proof the evolve loop terminates: observation
(2026-07-27) → PROP-001 drafted by machine (Epic 10) → adopted by operator
triage (2026-08-08) → implemented as ordinary planned work (this epic) →
ISS-001 Resolved and the rows annotated by operator hand. PROP-003 rides
the same closing as the degenerate case: adopted, then found already
implemented — the honest disposition (D1) is itself loop discipline, since
a proposal ledger that silently accretes "adopted but long done" rows
stops being a work source. Both closings are operator edits under the
ownership rule; the epic's job is to hand the operator the evidence.

## 6. Staging sketch (epic-shaped)

Two stories, each independently green (a third only if D1 rules
conformance elevation in):

1. **Churn-normalized verify step** — the normalizer + step 4.5 in
   `base_update.py`, unit tests (the file's first), the D3-ruled
   empty-diff outcome, contract 0.1.10 clarification if rung; acceptance:
   a live same-version re-affirmation run over this repo whose install
   diff is churn-free.
2. **Upstream filing + cycle closure** — the drafted bmad-method issue
   (filed per D4's gate), and the operator closing motions with evidence
   in hand: ISS-001 → Resolved, PROP-001/PROP-003 prose annotations
   (status stays Adopted — the ledger has no "implemented" state by
   design; implementation lives in planning records).

## 7. Decision points for the operator (genuine forks)

- **D1 — PROP-003 disposition.** Close with evidence (recommended: the
  sweep is landed and two-layer enforced; the static sweep ships in the
  plugin and runs anywhere; adding a conformance check would make a second
  owner of one invariant) vs. elevate enforcement into the conformance
  suite (AD-19's shipped-artifact family — real but duplicative) vs.
  both.
- **D2 — normalization semantics.** Revert churn-only files, leave files
  with any real change fully untouched (recommended: the reviewer sees
  the genuine upstream diff exactly as upstream wrote it; smallest true
  step) vs. also normalize line endings *inside* real-change files
  (quieter diffs, but the PR no longer shows exactly what the installer
  wrote) vs. adopt a repo-side `.gitattributes` policy instead of code
  (declarative, but it papers over the defect being filed upstream and
  touches every checkout).
- **D3 — empty-diff outcome.** When post-normalization there is no
  install diff (same-version re-affirmation): end complete reporting the
  verified no-op with no branch pushed and no PR (recommended: the
  assertion "reinstall at pin is a no-op" is the run's entire value; an
  empty PR is review noise), with the §2 row gaining a clarification
  sentence at 0.1.10 — vs. always push + PR for a uniform motion and an
  auditable PR trail.
- **D4 — upstream filing gate.** Draft the issue text as an epic
  artifact and file it on the bmad-method tracker only on explicit
  in-session operator go-ahead, covering the list re-serialization defect
  with the LF rewrite noted as a question (recommended) vs. operator
  files by hand from the draft vs. drop the upstream half (leaves ISS-001
  only Mitigated — our normalizer is a workaround, root cause upstream).
- **D5 — epic declaration.** Pre-ruled at the 2026-08-08 fork: declared
  at brief merge, build next session, per the boundary discipline. Named
  here only for the record.

## 8. What this pass deliberately does not do

No code, no contract edits, no ledger row edits, no upstream issue filed,
no epic/story records until the brief merges (D5). The normalizer design
in §4 is grounding for the stories, not pre-written code; story 1 verifies
the churn classes against a live install before trusting the equivalence
check.

## 9. Operator rulings (2026-08-08)

Rulings taken via in-session operator Q&A at the planning pass; the
durable record is this section plus the brief's PR thread. All four forks
ruled on the recommended option.

- **D1 — PROP-003 closes with evidence.** No new code, no conformance
  elevation: the sweep is landed (`3ee9117`) and two-layer enforced
  (`test_utf8_guard.py`); the operator annotates the row by hand with that
  evidence. Two stories, not three.
- **D2 — revert churn-only files.** Old ≡ new after normalizing the named
  classes → revert; any real change leaves the file fully untouched;
  unknown churn is never guessed at — it shows in the diff.
- **D3 — empty diff ends complete with no branch pushed and no PR.** The
  verified no-op is the run's record; the §2 base-update row gains a
  clarification sentence at contract 0.1.10 (doc + README + pin test move
  together, the 0.1.8 precedent).
- **D4 — draft + gated filing.** The bmad-method issue text is an epic
  artifact (list re-serialization as the defect, LF rewrite as a
  question); filing happens only on explicit in-session operator
  go-ahead.
- **D5 — pre-ruled at the 2026-08-08 fork:** epic declared at brief
  merge, build starts next session.

---

*Sources: proposals/ledger.md (PROP-001/003, triage `2d0a36e`);
issues/ledger.md (ISS-001); measurements/tim-Tim-PC.jsonl (events
2026-07-27T01:04Z, 2026-08-06T19:52Z);
skills/tk-studio-base-update/scripts/base_update.py (steps 1–6, the
`git add -A` at step 5); lib/tests/test_utf8_guard.py + `3ee9117`;
contracts/conformance/runner.py (utf-8 decode note); driver-contract.md
0.1.9 §2 (base-update row) + change policy; the 0.1.8 clarification
precedent (`c64bab8`, PR #22).*
