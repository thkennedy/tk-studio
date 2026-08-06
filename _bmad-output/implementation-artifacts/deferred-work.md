# Deferred Work

## Deferred from: code review of feat/tk-studio-connector (2026-08-06)

- **DW-1** — Contract §4 `submit` says "a job definition (or the id of a shipped/project job instance)", but `lib/jobrun.py submit` (and the §2 `tk-studio-job` payload row) only accept an id — the full-definition form has no CLI/skill surface. Studio-side contract clarification (PATCH wording fix, or a deliberate MINOR adding `--definition`); the connector faithfully mirrors the CLI today. *Revisited 2026-08-06 at the conformance-through-`tk_invoke` seam: neither the through-connector suite nor the watchdog tick needed the definition form (the tick wakes, never submits), so the wording-only PATCH isn't worth its cross-repo pin ripple alone — fold the clarification into the next deliberate contract bump.*
- **DW-2** — Connector test suite (`D:\ClaudeOS\connectors\tk-studio\server.test.ts`) is live-integration by design: it asserts against the real registry and studio install, so it cannot run on a machine without an onboarded tk-studio. Acceptable for the personal ClaudeOS repo (no CI); add a fixture/mock path only if the repo ever grows CI.
