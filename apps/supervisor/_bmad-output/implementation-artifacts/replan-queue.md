# Replan queue

## 21-3 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): one-shot jobs start via jobrun `submit`, recurring ones via `wake` (the lifted CLI does both); idempotent minting covers both verbs. Timeout recovery adopts only a run started within 2s before the caller began: keep that rule when the queue owns minting.
- Status: closed — applied to the unstarted 21-3 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-4 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): a host-tier bypass request is refused before any run exists (HostBypassRefused, exit 2, reported `blocked`); read this story's "the run ends blocked" as the submission refused `blocked` with no run minted. The worker prompt is the argument after `-p` (no stdin, no shell retry: an injection risk); keep it.
- Status: closed — applied to the unstarted 21-4 entry's invoke_dev_with by the planning session (2026-09-28)

## 21-6 — scope: stories — from 21-1-the-lift-drives-the-studio-at-the-current-contract — 2026-09-28

- What changed: see the 21-1 spec Reconcile section
- Suggested adjustment: Replan (21-1 reconcile, 2026-09-28): resume and orphan handling must respect the lifted CLI's rule that only a run started within 2s before the caller began is adopted after a wake/submit timeout; one-shot runs are minted by `submit`.
- Status: closed — applied to the unstarted 21-6 entry's invoke_dev_with by the planning session (2026-09-28)
