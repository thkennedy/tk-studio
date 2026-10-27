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
import { afterAll } from "bun:test";
import { cleanupTemp } from "./tmp";

export const NOTIFIER_VARS = [
  "TK_SUPERVISOR_NOTIFY", "TK_SUPERVISOR_NTFY_URL", "TK_SUPERVISOR_TELEGRAM_TOKEN", "TK_SUPERVISOR_TELEGRAM_CHAT",
] as const;

for (const name of NOTIFIER_VARS) delete process.env[name];
process.env.TK_SUPERVISOR_UNDER_TEST = "1";

// Story 33.4 (holes 63, 64, 70): every temp folder and fixture queue a suite makes through test/tmp.ts is
// closed and removed at the end of the `bun test` process (a preload's `afterAll` runs once, after its last
// file; under the host gate every file is its own process, so there it is per file), and again at process
// exit for what a crash or `process.exit` skipped, and on SIGINT/SIGTERM/SIGHUP (an "exit" handler
// does not run on a signal; SIGHUP is a dropped `sbx exec` or terminal session on Linux), exiting
// 128 + the signal's number. A second cleanup is a no-op.
afterAll(cleanupTemp);
process.on("exit", cleanupTemp);
process.on("SIGINT", () => {
  cleanupTemp();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupTemp();
  process.exit(143);
});
process.on("SIGHUP", () => {
  cleanupTemp();
  process.exit(129);
});
