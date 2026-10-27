// Story 33.4 (holes 63, 64, 70): the one owner of every temp folder and fixture queue the suites make.
//
//   - `tempDir(prefix)` is the only `mkdtempSync` in test/: it makes `<tmpdir>/<prefix>XXXXXX` and records it.
//   - `track(q)` records a queue (or any closable) opened inside such a folder, so it is closed before its
//     folder is removed: an open SQLite file cannot be removed on Windows (hole 63's EBUSY).
//   - `cleanupTemp()` closes every tracked item (errors swallowed), then removes every recorded folder.
//     A folder a test already removed is a no-op (`force`), and a second cleanup finds nothing left.
//
// preload.ts registers `cleanupTemp` once, as a global `afterAll` (at the end of the `bun test` process: a
// preload's `afterAll` runs once, after its last file; under the host gate every file is its own process,
// so there it is per file), as a `process.on("exit")` fallback and on SIGINT/SIGTERM/SIGHUP, so the folders go
// under every exit, Linux included (hole 70).
// Rule for a new suite: make temp folders with `tempDir("tk-sup-<what>-")`, wrap fixture queues in `track`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folders: string[] = [];
const closables: { close(): void }[] = [];

/** `mkdtempSync(join(tmpdir(), prefix))`, recorded for `cleanupTemp`. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  folders.push(dir);
  return dir;
}

/** Record a queue (or any closable) to close before the folders are removed; returns it unchanged. */
export function track<T extends { close(): void }>(q: T): T {
  closables.push(q);
  return q;
}

/** Close the tracked items first (errors swallowed), then remove every recorded folder. */
export function cleanupTemp(): void {
  for (const item of closables.splice(0)) {
    try { item.close(); } catch { /* already closed, or closing failed: the removal still runs */ }
  }
  for (const dir of folders.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
  }
}
