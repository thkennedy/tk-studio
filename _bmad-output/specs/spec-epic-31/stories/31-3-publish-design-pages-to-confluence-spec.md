---
title: 'Publish: Design Pages to Confluence'
type: 'feature'
created: '2026-10-24'
baseline_revision: '2cb1d65a76a78da6c1170060eefeae9c5f6221e4'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-31/plans/31-3.md'
  - '{project-root}/kb/atlassian-free-tier.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** As the owner, I want the brief, the GDD, the scope of work and the decisions published to the project's Confluence space, and epics and stories promoted to Jira as today, so that the plan is readable from any device without the studio site (§6.8 b). Canonical: ST-117.

**Approach:** A new `plansync.py publish` verb (behind the planning adapter, AD-4) converts each design-page source from Markdown to Confluence storage format (new stdlib `lib/mdstorage.py`), creates or updates it by stable title in the folder 31.2's setup recorded, with a provenance footer and a content hash that skips unchanged pages, and writes a local page index that `jirabackend.promote` turns into a "Design pages" link line on every epic and story description.

**Acceptance criteria (verbatim, epics.md Story 31.3):**
- AC1: **Given** the planning artifacts under `_bmad-output/planning-artifacts/` and the design folder **When** `plansync.py sync` runs with the Jira binding (today's promote) and the new `publish` verb runs **Then** each design page is created or updated in the space's folder by a stable title, with a provenance footer naming the source file and the commit, Markdown converted to Confluence storage format (headings, lists, tables, code, links; images attached), and unchanged pages are skipped by content hash; epics and stories promote as before, now with a link to their design pages; the plan stays canonical (AD-5): nothing from Confluence changes an entity field
- AC2: **Given** the publish **When** it is tested **Then** the lib suite covers the conversion, the hashing, the idempotence and the provenance with a fake Confluence REST; the contract's §2 names `publish` (additive)

**31-1 carry (binding, invoke_dev_with; kb/atlassian-free-tier.md §2 Q3/Q4):** authenticate Confluence with `TK_ATLASSIAN_AGENT_EMAIL` and `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` through `https://api.atlassian.com/ex/confluence/<cloud id>/wiki/api/v2`, refusing by name when the token is absent. Downscale or compress design images before upload. Refuse by name any attachment over the per-file ceiling: the smaller of the site's Attachment maximum size and 100 MB; use the site setting only when supplied or readable, otherwise assume 100 MB and say so in the output (REST uploads over 100 MB fail with 502). Report the bytes uploaded against Free's 2 GB storage. Site-wide use is an attended browser check (Confluence Settings > Storage).

## Boundaries & Constraints

**Always:**
- Settled shapes 1–3 of `plans/31-3.md` (= SPEC.md design notes "CAP-5 — design-page sources / publish hash and provenance / published page index") are the design: categories and default globs, `--source <category>=<path>`, stable title `<FOLDERS title>: <slug>`, sha256 over title + storage body (footer excluded) + each attachment's sha256, footer `<p><em>Published by tk-studio from <code>{source}</code> at commit <code>{sha}</code>. content-hash: sha256:{hex}</em></p>`, skip by the remote footer hash, `.tk-studio/confluence-pages.json` written atomically with ids and paths only.
- Footer commit = `git log -1 --format=%H -- <source>` (never HEAD); `(uncommitted changes)` appended when `git status --porcelain -- <source>` is non-empty; `no commit` outside a work tree.
- Env refusals by name before any call; missing `planning.confluence` binding refused ("run `plansync.py setup` first"); a category with no folder id is skipped and named, run ends `partial`; an oversize attachment is refused by name, the page still publishes, run ends `partial`; the ceiling is 104,857,600 bytes assumed (said in `notes[]`) unless `--attachment-max-bytes` supplies a smaller site setting.
- Images: PNG re-deflated losslessly (stdlib zlib, kept only when smaller), other types as is; an attachment whose remote `comment` carries the same `sha256:` is not re-uploaded; result reports `bytes_uploaded` and the 2 GB note.
- Result `{found[], created[], updated[], skipped[], refused[], would_publish[] (dry run), bytes_uploaded, notes[], written[]}`, AD-11 status block last; exit 0 on ok, else 2. Dry run makes no write call and writes no file.
- The link line enters promote's `_content_hash`; absent index ⇒ description and hash unchanged.
- House rules: stdlib only, `uv run`, atomic writes, no credential in a tracked file or event, no driver/supervisor import. Tests use fakes only; no live call.

**Block If:**
- The AC can be met only by a write that bypasses the planning adapter (AD-4), a non-stdlib dependency (NFR9), or changing an entity field from Confluence (AD-5).
- The Files list must grow past the twelve in `plans/31-3.md` §Files.
- The link cannot enter promote's hash without changing `pull_back`, the status maps or the `external.jira` snapshot keys.

**Never:** touch `pull_back`, `_transition_to_category`, the category maps, `config.py`, `shape.v1.json`, `migrate.py`, `runner.py`, `apps/**`, this repo's `.tk-studio/config.yaml`, `epics.md`, `stories.yaml`, SPEC.md; publish the `records` folder; move Jira to REST v3; bump the contract version (extend the 0.1.26 clause); push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First publish | binding + 2 sources, empty folder | 2 pages created with footer; index written; `complete` | — |
| Rerun unchanged | remote footer hash matches | page in `skipped[]`/`found[]`, no PUT | — |
| Source edited | hash differs | PUT with version n+1 | — |
| Edited in Confluence | remote body lacks matching hash | overwritten, named in `notes[]` | — |
| Empty category | no gdd/scope-of-work file | named in `skipped[]` | not an error |
| Duplicate title | two sources ⇒ one title | refused by name before any call | `blocked` |
| No env / no binding | token or space id absent | names each gap; no call | `blocked`, exit 2 |
| Oversize image | > ceiling | image refused by name, page publishes | `partial` |
| Dry run | any | `would_publish[]`, no write, no file | — |

</intent-contract>

## Code Map

The plan's Code Map (`plans/31-3.md`) is the investigation; anchors were spot-checked against the tree at planning time and hold. Key points:

- `plugins/tk-studio/lib/confluence.py` -- `API_PREFIX` :27, `SCOPE_*` :31-32 (add page/attachment scopes), `ConfluenceClient` :51 (transport seam `transport(method, url, body)`; `request()` routes errors via `jirabackend.auth_failure`), `_paged_results` :130 (add a prefix parameter, `setup:` stays the default), `find_folders`/`create_folder` :171-184. Add page find/get/create/update (v2) and attachment list/upload (v1 `…/wiki/rest/api/content/{id}/child/attachment`, multipart, `X-Atlassian-Token: no-check`, `comment` = `sha256:<hex>`) through the same transport callable so fakes intercept.
- `plugins/tk-studio/lib/plansync.py` -- docstring CLI list :49-56; `sync` :630; `SETUP_BLOCK_KEYS` :864, `_recorded` :871, `_setup_gaps` :882, `_finish_setup` :1148, `setup` :1174 (client build model); `main` :1477 subparsers/dispatch. Add `publish`.
- `plugins/tk-studio/lib/jirabackend.py` -- `_content_hash` :122; `promote` :490, hash at :519-521, fields at :536-538: append `Design pages: [Title|https://<site>/wiki<webui>], …` from the index, inside the hash.
- `plugins/tk-studio/lib/promote.py:149-156` -- `_git` pattern to copy (read-only).
- `plugins/tk-studio/lib/tests/test_tracking_setup.py` -- `FakeAtlassian` :51-245, `SetupTestCase` :248-284; subclass as `FakeConfluencePublish` in the new test file (handle `/wiki/rest/api/` and page/attachment routes first); do not edit `FakeAtlassian.__call__`.
- `plugins/tk-studio/lib/tests/test_jirabackend.py` -- `FakeJira` :41, `JiraTestCase` :125.
- `plugins/tk-studio/contracts/driver-contract.md` :5 (0.1.26 clause), :285 (plan-sync row: core `…sync|normalize|setup|publish`, `publish?` payload, refusals, `partial`); `tests/test_driver_contract.py` :612-655 (keep clause-order asserts), :646 core substring.
- `plugins/tk-studio/skills/tk-studio-plan-sync/SKILL.md` :57-73, :99-107, :116-123; `contracts/conformance/manifest.json` :148-175 (add a `blocked-on-ambiguity` publish drive).
- Real sources (tests fix the rule, not paths): `briefs/brief-tk-studio-2026-07-25/brief.md`, `briefs/brief-studio-supervisor-2026-09-27/brief.md`, `design/studio-design-spec-2026-10-09/decisions.md` (+ `decisions-answers.md`); no GDD, no scope-of-work, no images.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/mdstorage.py` -- new: `convert(md, source_path, titles_by_path) -> (storage, attachments[])` (headings, paragraphs and inline, nested lists, GFM tables, fenced code macro with `]]>` split, links incl. `ri:page` for published `.md`, images as `ri:attachment`, frontmatter stripped, `html.escape`), PNG re-deflate -- the converter.
- `plugins/tk-studio/lib/confluence.py` -- page and attachment calls, scopes, pager prefix -- the client.
- `plugins/tk-studio/lib/plansync.py` -- `publish` verb + CLI (`--directory`, `--dry-run`, `--source`, `--attachment-max-bytes`), discovery, git provenance, hash/footer, index write -- the verb.
- `plugins/tk-studio/lib/jirabackend.py` -- link line in `promote`, in the hash -- AC1 Jira half.
- `plugins/tk-studio/lib/tests/test_mdstorage.py`, `tests/test_publish.py` (new), `tests/test_jirabackend.py`, `tests/test_driver_contract.py` -- AC2 coverage per the I/O matrix.
- `plugins/tk-studio/contracts/driver-contract.md`, `contracts/conformance/manifest.json`, `skills/tk-studio-plan-sync/SKILL.md` -- §2 names `publish` (additive), conformance drive, skill payload `publish: true` relay.

**Acceptance Criteria:**
- Given a fake Confluence REST and two sources, when `publish` runs twice, then the first creates both pages (footer names source and commit, storage format body) and the second skips both with no write call.
- Given the page index, when `promote` runs, then each epic and story description ends with the `Design pages:` line and its hash changes once; without the index, descriptions and hashes are unchanged.
- Given no agent env, when `plansync.py publish --directory .` runs, then it ends `blocked`, exit 2, naming each absent variable, with no call.
- Given the contract, when the lib suite and conformance run, then §2 names `publish` and both are green.

## Spec Change Log

## Review Triage Log

### 2026-10-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11 (high 1, medium 6, low 4)
- defer: 0
- reject: 3 (high 0, medium 1, low 2)
- addressed_findings:
  - `[high]` `[patch]` images resolving outside the project root (`../`, absolute, symlink, non-http scheme) were read and uploaded; now refused by name before any read, page still publishes, run `partial` (consult: apply)
  - `[medium]` `[patch]` same-basename images from different paths collided on one attachment and re-uploaded forever; colliding names get a short path-hash suffix
  - `[medium]` `[patch]` the no-env refusal test did not wire the fake, so "no call" could not fail; the CLI client now routes through the fake and real HTTP fails the test
  - `[medium]` `[patch]` the driver could not supply the site's Attachment maximum size; `attachment_max_bytes?` added to the skill mapping and the 0.1.26 plan-sync row (no bump), ceiling = min(supplied, 100 MB), notes[] says which
  - `[medium]` `[patch]` the page index dropped pages of skipped or overridden categories and was not rewritten when empty; merged by title
  - `[medium]` `[patch]` attachment sha256 was over the recompressed bytes (zlib-build dependent); now over source bytes
  - `[medium]` `[patch]` a huge image was read whole before the ceiling check; size is checked before reading
  - `[low]` `[patch]` remote hash taken from the first `content-hash:` match; now the last (the footer)
  - `[low]` `[patch]` dry run said pages were "overwritten"; now "would be overwritten"
  - `[low]` `[patch]` percent-encoded image paths were not found; relative paths are unquoted
  - `[low]` `[patch]` the same file under two categories via `--source` silently retitled; refused by name before any call
- rejected:
  - `[medium]` the footer's commit stays at the publish-time commit (or `(uncommitted changes)`) until the content changes: Settled shape 2 pins the hash over title, body without footer and attachments, so the footer names the commit of the published content; not a defect of this story
  - `[low]` a Confluence edit that keeps the footer survives: Settled shape 2 overwrites a page "without a matching footer hash" only
  - `[low]` a stale folder id ends the run `blocked` with the 404 named: the refusal is named and the AD-11 block is emitted; plumbing

### 2026-10-24 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 0, low 8)
- defer: 0
- reject: 7 (high 0, medium 0, low 7)
- addressed_findings:
  - `[low]` `[patch]` `HEADING_RE` dropped a trailing `#` with no space before it (`## Notes on C#` became `C`); a closing `#` run is now removed only after whitespace
  - `[low]` `[patch]` relative link targets were not percent-decoded (images were), so `my%20doc.md` never linked to its page; links are now unquoted like images (both layers)
  - `[low]` `[patch]` inline code in a page-link body put literal `<code>` markup inside the CDATA; held fragments are reduced to plain text there
  - `[low]` `[patch]` a prose line with `|` before a `---` line became a table; the delimiter row's cell count must now match the header (block and paragraph-continuation checks)
  - `[low]` `[patch]` `recompress_png` inflated IDAT with no bound; inflation is capped (`PNG_MAX_RAW_BYTES`, 256 MiB), past it the input uploads unchanged
  - `[low]` `[patch]` an undecodable `.tk-studio/confluence-pages.json` raised after publishing, with no AD-11 block; it is now treated as absent and rewritten
  - `[low]` `[patch]` a dry run on an unchanged page whose attachment was missing or stale remotely ended `complete`; it now lists attachments (read-only) and names an `attach` entry in `would_publish[]`, ending `partial`
  - `[low]` `[patch]` the contract's refused-page/refused-image `partial` outcomes and the 403 half of the 401/403 split had no test; pinned (update 409, upload 500, create 403); no production change
- rejected:
  - `[low]` design/*/decisions.md files in two folders collide on one title and block: Settled shape 1 pins the slug rule and the I/O matrix pins the duplicate-title refusal; `--source` is the escape
  - `[low]` the footer commit stays at the publish-time commit until the content changes: Settled shape 2 (as rejected in the first pass)
  - `[low]` a `--source` override drops other pages' cross-links to the replaced default for that run: `titles_by_path` covers the run's sources by design; the next default run restores them
  - `[low]` the page index is never pruned: the merge-by-title consult ruling (19:51:27Z); recorded residual risk
  - `[low]` a refused or missing image leaves a broken reference in the page: recorded residual risk; the refusal is named and the run ends `partial`
  - `[low]` a page with the stable title moved elsewhere in the space is refused on create every run: the refusal is named, the run ends `partial`; moving studio pages is an operator act, no criterion names it
  - `[low]` a non-auth error (404/5xx) on a page read ends the whole run `blocked`: the error is named, the AD-11 block emitted and the index written for landed pages; no criterion or contract row names this case

### 2026-10-24 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 0, low 4)
- defer: 0
- reject: 8 (high 0, medium 0, low 8)
- addressed_findings:
  - `[low]` `[patch]` default-glob design-page sources were not confined to the project root, so a `brief.md` symlinked outside it was read and published, while `--source` paths and images were confined; a discovered source that resolves outside the root is now refused by name, unread, before any call, the same way as an out-of-root `--source` (blind-hunter)
  - `[low]` `[patch]` the duplicate-title check was case-sensitive, but Confluence titles are unique per space regardless of case, so `Decisions.md` and `decisions.md` reached Confluence and were refused on every run (`partial`) instead of the I/O matrix's `blocked` before any call; `owners` is now keyed on `title.casefold()` (edge-case-hunter)
  - `[low]` `[patch]` an angle-bracket destination with spaces (`![x](<my image.png>)`, `[d](<my doc.md>)`) did not match `IMAGE_RE`/`LINK_RE`, so the image was not attached and raw Markdown showed on the page; the `<…>` form now accepts any characters except `<`, `>` or a newline (edge-case-hunter)
  - `[low]` `[patch]` `test_index_adds_the_line_and_moves_each_hash_once` did not show that pull-back leaves the plan unchanged once the `Design pages:` line lands (AD-5); it now asserts empty `conflicts`/`applied`, unchanged canonical front matter and bodies, and no `Design pages` in any body. No production change (blind-hunter)
- rejected:
  - `[low]` a Confluence edit that keeps the footer is not overwritten: Settled shape 2 and the I/O matrix ("remote body lacks matching hash"), as rejected in both earlier passes
  - `[low]` the footer commit stays at the publish-time commit until the content changes: Settled shape 2, as rejected earlier
  - `[low]` a `--source` override degrades other pages' cross-links to the replaced default: by design, as rejected in the follow-up pass
  - `[low]` a category skipped for a missing folder still gets `ac:link`s from other pages: the skip is named and the run ends `partial`; the link resolves once the category publishes, and leaving it out would move the linking page's hash later
  - `[low]` the page index is never pruned: the merge-by-title consult ruling (19:51:27Z), as rejected earlier
  - `[low]` an undecodable source or a non-auth error ends the run `blocked`: `UnicodeDecodeError` and `ConfluenceError` are caught (`plansync.py` publish `except`), named, and the AD-11 block is emitted; as rejected in the follow-up pass
  - `[low]` a remote page whose title differs only by case from the stable title is not found by `find_page`: an operator rename, same class as the moved-page rejection in the follow-up pass
  - `[low]` `migrate.py` calls `promote` without `design_line`: `migrate.py` is in the intent's Never list; the next sync adds the line and moves each hash once, which AC1 allows

## Design Notes

"Their design pages" = the project's published pages in index order (the plan has no per-entity mapping). No downscaling: the stdlib cannot resample, so PNG is re-deflated losslessly and anything else uploads as is; this satisfies "downscale or compress" and is not DRIFT. "Unchanged pages are skipped" lists the page in `skipped[]` with reason `unchanged` and in `found[]`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `env -u TK_ATLASSIAN_AGENT_EMAIL -u TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN -u TK_ATLASSIAN_CLOUD_ID uv run plugins/tk-studio/lib/plansync.py publish --directory .` -- expected: `blocked`, exit 2, gaps named, no call
- `git grep -n -E "ATATT3|_TOKEN=[^ ]" -- plugins/ _bmad-output/specs/spec-epic-31/` -- expected: only pattern text
- `git status --porcelain` -- expected: only the plan's Files

**Manual checks (if no CLI):**
- Unverifiable here (attended): `uv run plugins/tk-studio/lib/plansync.py publish --directory <project> --dry-run`, then without `--dry-run`, after `sbx policy allow network` (kb §1 step 8); storage use at Confluence Settings > Storage.

## Deviation Summary

### pass 1 (2026-10-24, implementer)

- planned: attachment upload as `POST {gateway}/ex/confluence/{cloud}/wiki/rest/api/content/{id}/child/attachment` (plans/31-3.md Code Map) / actual: `PUT` on the same v1 path, which creates or replaces the attachment / why: v1 `POST` fails when an attachment with that filename already exists, so a changed image could never be re-uploaded / may affect: 31-4-sync-back-on-a-timer

DEVIATION SCORE: 1

DRIFT: attachment upload uses v1 PUT (create-or-replace) instead of the plan's POST on child/attachment — POST refuses an existing filename, so a changed image could never be re-uploaded — affects: 31-4-sync-back-on-a-timer

### pass 2 (2026-10-24, implementer, review patches)

- planned: the attachment sha256 (page-hash input and `comment` marker) over the bytes sent, with the size check after a full read (plans/31-3.md Images) / actual: the sha256 is over the original image bytes, the compressed bytes are uploaded, and the size is checked before reading (non-PNG over the ceiling, PNG over 4x it) / why: review findings (stable hash across zlib builds; no full read of a huge file) / may affect: none (consult: 31-4 reads neither the marker nor the index)
- planned: the page index lists this run's pages only (Settled shape 3) / actual: merged by title with the previous index (earlier order kept, new titles appended), shape unchanged / why: a skipped or overridden category would otherwise drop its Jira links and move every issue hash / may affect: none

DEVIATION SCORE: 1

DRIFT: attachment sha256 computed over the source image bytes and the size checked before reading — a different zlib build would otherwise republish unchanged pages, and a huge file would be read whole — affects: none
DRIFT: the page index is merged by title with the previous one instead of rebuilt from the run — a skipped or overridden category would otherwise drop its Jira links and move every issue hash — affects: none

### pass 3 (2026-10-24, implementer, follow-up 2 review patches)

- The implementer self-scored 1 for two test-fixture choices: the case-only duplicate-title test uses `Decisions.md` vs `decisions.md`, because for `decisions.md` the slug is the file stem, so the suggested `Foo/`/`foo/` pair already collided; and the symlink test skips with `self.skipTest`, matching the existing symlink test. Consult 20:09:09Z ruled both no deviation from the story, an AD or the contract.

DEVIATION SCORE: 0

## Consult Log

- 2026-10-24T19:42:40Z — trigger: deviation-gt-0 — question: accept the v1 attachment upload as PUT (create-or-replace) instead of the plan's POST? — ruling: accept-deviation score 1 — do: keep PUT on …/wiki/rest/api/content/{id}/child/attachment as in confluence.upload_attachment; make sure the module docstring at confluence.py:15 and the fake both name PUT; record why PUT and not POST — rule candidate: When a plan marks a REST request shape ungraded, the implementer may change the HTTP method or endpoint variant without a consult, provided the fake pins the new shape and no contract row names the method.
- 2026-10-24T19:45:58Z — trigger: high-severity-finding — question: triage of images resolving outside the project root being read and uploaded (patch/partial vs blocked vs escalate) — ruling: apply — do: patch as option (a), partial not blocked; resolve with symlinks followed and refuse by name (refused[], "outside the project root") before any read_bytes, page still publishes, run partial; pin ../ escape, absolute path and out-of-root symlink in test_publish.py — rule candidate: Any path the studio reads from content it ingests must be resolved with symlinks followed and confined to the project root before it is read; an escape is refused by name with the verb's existing missing-file outcome.
- 2026-10-24T19:51:27Z — trigger: deviation-gt-0 — question: accept the pass-1 patch deviations (attachment sha256 over source bytes with a pre-read size check; page index merged by title with the previous one)? — ruling: accept-deviation score 1 — do: keep both patches; record that the attachment sha256 (page hash and comment marker) is over the source image bytes, not the uploaded bytes, and that the page index is merged by title with its shape unchanged — rule candidate: Any content hash used to skip unchanged work is computed over the source input before any transform, and any index of published pages is merged by stable key, never rebuilt from only the current run.
  - recorded per the DO: the attachment sha256 (page-hash input and `comment` `sha256:` marker) is computed over the source image bytes; the re-deflated bytes are uploaded and the ceiling applies to them. `.tk-studio/confluence-pages.json` is merged by title with the previous index (earlier order kept, new titles appended); its shape is unchanged.

- 2026-10-24T20:09:09Z — trigger: deviation-gt-0 — question: the implementer self-scored 1 for two test-fixture choices in the follow-up-2 patches (a case-only title pair `Decisions.md`/`decisions.md` instead of the suggested `Foo/`/`foo/` folders, which already collided; `self.skipTest` instead of `unittest.skipUnless`); accept at 1, rule 0, or escalate? — ruling: apply — do: re-score this pass deviation 0 and record no deviation for the two test choices; keep both tests as written (`tests/test_publish.py:722`, `:750`) and proceed on the green verify gate — rule candidate: Score deviation only against the story, the AD spine or the driver contract; a change to a test fixture or skip mechanism that keeps the patch instruction's intent and passes the I/O matrix row it targets scores 0 and needs no consult.

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Second follow-up review of the committed 31.3 implementation: the `plansync.py publish` verb, the stdlib `mdstorage.py` Markdown → storage converter, the Confluence page and attachment client, and the `Design pages:` line in `jirabackend.promote`. Both layers ran (L band). The pass applied four low-severity patches:
- Default-glob sources that resolve outside the project root are refused by name, unread, before any call (as `--source` and images already were).
- The duplicate-title check is case-insensitive, matching Confluence's per-space title uniqueness.
- `<…>` link and image destinations with spaces now convert.
- The promote/index test now proves pull-back leaves the plan unchanged once the line lands (AD-5).

No contract surface changed. This pass's deviation score is 0 (consult 20:09:09Z). The story's `deviation_score` stays 1 from the earlier passes.

**Files changed (this pass):**
- `plugins/tk-studio/lib/plansync.py`: `_discover_sources` confines each discovered source to the resolved root (out-of-root is a named gap, so the run ends `blocked` before any call); `owners` keyed on `title.casefold()`.
- `plugins/tk-studio/lib/mdstorage.py`: shared destination pattern accepting `<…>` (no `<`, `>` or newline) or the bare form; `_dest()` strips the brackets for the image and link handlers.
- `plugins/tk-studio/lib/tests/test_publish.py`: out-of-root symlinked `brief.md` refused unread, with no call; case-only title clash refused before any call.
- `plugins/tk-studio/lib/tests/test_mdstorage.py`: angle-bracket destinations with spaces for links and attachments.
- `plugins/tk-studio/lib/tests/test_jirabackend.py`: pull-back `conflicts`/`applied` empty and canonical entities unchanged after the `Design pages:` line lands, and on the following run.
- `_bmad-output/specs/spec-epic-31/stories/31-3-publish-design-pages-to-confluence-spec.md`: this triage entry, consult entry and result.

**Review:** blind-hunter 8, edge-case-hunter 4; 12 after deduplication. Patches applied: 4 (high 0, medium 0, low 4). Deferred: 0. Rejected: 8 (see the Review Triage Log; six repeat or extend earlier rulings). Follow-up review recommended: false (score 3×0 + 1×4 = 4, below 5; no high).

**Verification:**
- Lib suite: `Ran 1611 tests`, OK (skipped=2).
- Conformance: `ok: true`.
- `env -u TK_ATLASSIAN_AGENT_EMAIL -u TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN -u TK_ATLASSIAN_CLOUD_ID uv run plugins/tk-studio/lib/plansync.py publish --directory .`: `blocked`, exit 2. It names the three variables and the absent `planning.confluence` binding, and makes no call.
- Token-pattern `git grep` over `plugins/` and the epic's specs: only pattern text in plans and specs, plus the existing `test_installer_apps.py:1005` fixture.
- `git status` before commit: only the five code and test files above and this spec, all inside the plan's Files.

**Unverifiable here:** a live publish. After the operator approves network access (kb §1 step 8: `sbx policy allow network --sandbox claude-tk-studio "api.atlassian.com,<site>.atlassian.net"`) and the project is set up, run `uv run plugins/tk-studio/lib/plansync.py publish --directory <project> --dry-run`, then again without `--dry-run`. Site-wide storage use is the attended browser check at Confluence Settings > Storage.

**Residual risks:**
- The v2 page and v1 attachment request shapes are pinned only in the fake. A live mismatch shows up through the 401/403 split and ends the run `blocked` or `partial`.
- A Confluence edit that keeps the footer is not overwritten, and the footer names the commit of the published content (Settled shape 2).
- A refused image's reference stays in the page body and shows as missing. Index entries for renamed or removed sources persist until removed by hand.
- A symlinked default source that points outside the root now blocks the whole run. The escape is `--source` with an in-root path.
- Issues imported by `migrate.py` get the `Design pages:` line on the next sync, not at import.
- A PNG whose raw image data exceeds 256 MiB uploads without re-deflation, still subject to the ceiling. Nothing is downscaled, because the stdlib cannot resample.

DRIFT: attachment upload uses v1 PUT (create-or-replace) instead of the plan's POST on child/attachment — POST refuses an existing filename, so a changed image could never be re-uploaded — affects: none (consult: 31-4 never calls the upload)
DRIFT: attachment sha256 computed over the source image bytes and the size checked before reading — a different zlib build would otherwise republish unchanged pages, and a huge file would be read whole — affects: none
DRIFT: the page index is merged by title with the previous one instead of rebuilt from the run — a skipped or overridden category would otherwise drop its Jira links and move every issue hash — affects: none

## Reconcile

- 2026-10-24 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 31-4-sync-back-on-a-timer
