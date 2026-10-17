// Hole 31 (2026-10-17): the supervisor's `bun test` under the agent PC's real User environment
// (TK_SUPERVISOR_NOTIFY=telegram and the bot's token and chat) sent every test run's end
// notifications to the real chat. This file is bunfig.toml's `[test] preload`: it runs once, before
// any test module loads, in the test process itself.
//
//   - The notifier's variables are removed from `process.env`, so neither the in-process paths nor
//     a child spawned with `...process.env` (the e2e suites run `bun src/cli.ts ...`) can select a
//     real notifier. A test that needs one sets it on its own fixture's `env`.
//   - The marker makes `notify()` in src/hygiene.ts refuse a send through the real `fetch`: a test
//     exercises a notifier only through an injected fake (see `underBunTest`).
//
// Per-suite `beforeAll` hooks that clear the same variables stay as they are: they also cover the
// backup, work and sign-in variables, and restoring an absent value is a no-op.
export const NOTIFIER_VARS = [
  "TK_SUPERVISOR_NOTIFY", "TK_SUPERVISOR_NTFY_URL", "TK_SUPERVISOR_TELEGRAM_TOKEN", "TK_SUPERVISOR_TELEGRAM_CHAT",
] as const;

for (const name of NOTIFIER_VARS) delete process.env[name];
process.env.TK_SUPERVISOR_UNDER_TEST = "1";
