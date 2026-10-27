---
type: llm
weight: 1
---

The response names all three facts of the generated rung's switch:

1. The cap: a top-level `assets: {credit_cap: <n>}` in the project's
   `.tk-studio/budget-bands.yaml`, `n` in Meshy credits and greater than 0.
   Without it `generate` refuses naming `assets.credit_cap` (the rung is
   off by default), before any network call or write.
2. The key: `TK_ASSETS_MESHY_KEY`, set as a **User** environment variable
   (for example `[Environment]::SetEnvironmentVariable("TK_ASSETS_MESHY_KEY",
   "<key>", "User")`, read from `HKCU\Environment`, then the process env),
   never written into a file, a config, the ledger or a command line; its
   value never appears in output.
3. The bound: the cap is per `generate` invocation (and the supervisor's
   host leg calls `generate` at most once per run — in this version zero
   times), each call checked against the credits already spent before it is
   made.

Fail the response if any of the three is missing or wrong, if it tells the
operator to put the key in a tracked file, `.env`, the project config or a
command-line flag, or if it describes the cap as a dollar amount or a
per-asset limit.
