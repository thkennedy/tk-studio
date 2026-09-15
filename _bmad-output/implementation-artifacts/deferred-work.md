# Deferred Work

## Deferred from: code review of feat/tk-studio-connector (2026-08-06)

- ~~**DW-1**~~ — **Resolved 2026-08-07 (ST-039, contract 0.1.7 — shipped as 1.7.0, renumbered to pre-1.0 the same day):** §4 `submit` now reads id-only ("the id of a shipped/project job instance — a full-definition submit form is not part of this surface"), folded into the deliberate 1.7.0 MINOR bump as planned. *(Original: contract §4 `submit` admitted "a job definition (or the id …)" but the CLI/skill surface was id-only.)*
- **DW-2** — Connector test suite (`ClaudeOS/connectors/tk-studio/server.test.ts`) is live-integration by design: it asserts against the real registry and studio install, so it cannot run on a machine without an onboarded tk-studio. Acceptable for the personal ClaudeOS repo (no CI); add a fixture/mock path only if the repo ever grows CI.

## Deferred from: AD-11/AD-13 hardening PRs (2026-08-06)

- ~~**DW-3**~~ — **Resolved 2026-08-07 (ST-039, contract 0.1.7):** §8 names the suite's `unrunnable-core` assertion and §6 reads four-plane (base, plugin incl. harness loadability, store, vault), folded into the 1.7.0 bump with DW-1. *(Original: PATCH-level wording drift — behavior had already shipped and been asserted by the suite.)*
