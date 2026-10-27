// Story 33.4: test/tmp.ts, the one owner of the suites' temp folders and fixture queues (holes 63, 64, 70).
import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Queue } from "../src/queue";
import { cleanupTemp, tempDir, track } from "./tmp";

const probes = { ownerAlive: () => true, engineLive: async () => ({ live: false }) };

describe("tmp.ts", () => {
  test("tempDir makes a prefixed folder under tmpdir(), and cleanup removes it", () => {
    const dir = tempDir("tk-sup-tmp-");
    expect(dirname(dir)).toBe(tmpdir());
    expect(basename(dir).startsWith("tk-sup-tmp-")).toBe(true);
    writeFileSync(join(dir, "a.txt"), "x");
    expect(existsSync(dir)).toBe(true);
    cleanupTemp();
    expect(existsSync(dir)).toBe(false);
  });

  test("a tracked queue is closed before its folder is removed", () => {
    const dir = tempDir("tk-sup-tmp-q-");
    const queue = track(new Queue(join(dir, "q.db"), probes));
    const order: string[] = [];
    const close = queue.close.bind(queue);
    queue.close = () => { order.push(existsSync(dir) ? "close, folder present" : "close, folder gone"); close(); };
    cleanupTemp();
    expect(order).toEqual(["close, folder present"]);
    expect(existsSync(dir)).toBe(false);
    expect(() => queue.runs()).toThrow(); // the database is closed
  });

  test("a failing close is swallowed and the folder still goes", () => {
    const dir = tempDir("tk-sup-tmp-bad-");
    track({ close: () => { throw new Error("already closed"); } });
    expect(() => cleanupTemp()).not.toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  test("a second cleanup is a no-op, and a folder a test removed itself is no error", () => {
    let closes = 0;
    const dir = tempDir("tk-sup-tmp-twice-");
    track({ close: () => { closes += 1; } });
    cleanupTemp();
    expect(() => cleanupTemp()).not.toThrow();
    expect(closes).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });
});

// The preload's registered cleanup itself (AC2): a child `bun test` on a fixture written at run time (a
// committed `*.test.ts` fixture would be picked up by the gate's glob and a plain `bun test`), with the
// real preload and its TMPDIR/TEMP/TMP at a fresh empty folder, leaves no `tk-sup-*` folder behind.
describe("preload.ts cleanup in a child bun test", () => {
  const preload = resolve(import.meta.dir, "preload.ts");
  const tmpTs = resolve(import.meta.dir, "tmp.ts");

  function runFixture(body: string): { status: number | null; out: string; fresh: string } {
    const fresh = tempDir("tk-sup-tmp-child-tmpdir-");
    const fixtures = tempDir("tk-sup-tmp-child-fixture-");
    writeFileSync(join(fixtures, "fixture.test.ts"), [
      `import { test } from "bun:test";`,
      `import { tempDir } from ${JSON.stringify(tmpTs)};`,
      body,
    ].join("\n"));
    const env: Record<string, string | undefined> = { ...process.env, TMPDIR: fresh, TEMP: fresh, TMP: fresh };
    const child = spawnSync(process.execPath, ["test", "--preload", preload, "./fixture.test.ts"], {
      cwd: fixtures, env, encoding: "utf-8", timeout: 120_000, killSignal: "SIGKILL",
    });
    return { status: child.status, out: `${child.stdout ?? ""}${child.stderr ?? ""}`, fresh };
  }

  const leftovers = (fresh: string) => readdirSync(fresh).filter((name) => name.startsWith("tk-sup-"));

  test("the global afterAll removes the folders when the tests end normally", () => {
    const { status, out, fresh } = runFixture(
      `test("makes a folder", () => { tempDir("tk-sup-fixture-"); });`,
    );
    if (status !== 0) console.error(out);
    expect(status).toBe(0);
    expect(leftovers(fresh)).toEqual([]);
  }, 150_000);

  test("the exit fallback removes the folders when a test calls process.exit", () => {
    const { status, out, fresh } = runFixture(
      `test("makes a folder and exits", () => { tempDir("tk-sup-fixture-"); process.exit(3); });`,
    );
    if (status !== 3) console.error(out);
    expect(status).toBe(3);
    expect(leftovers(fresh)).toEqual([]);
  }, 150_000);

  // A signal skips both the afterAll and the "exit" handler: the preload's own SIGTERM/SIGHUP handlers clean
  // up and exit 128 + the signal's number (hole 70; SIGHUP is a dropped `sbx exec` or terminal on Linux).
  // POSIX only: Windows has no SIGTERM/SIGHUP delivery to a child.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const [signal, code] of [["SIGTERM", 143], ["SIGHUP", 129]] as const) {
    test.skipIf(process.platform === "win32")(`on ${signal} the preload removes the folders and exits ${code}`, async () => {
      const fresh = tempDir("tk-sup-tmp-child-tmpdir-");
      const fixtures = tempDir("tk-sup-tmp-child-fixture-");
      const ready = join(fixtures, "ready.txt");
      writeFileSync(join(fixtures, "fixture.test.ts"), [
        `import { test } from "bun:test";`,
        `import { writeFileSync } from "node:fs";`,
        `import { tempDir } from ${JSON.stringify(tmpTs)};`,
        `test("makes a folder and waits", async () => {`,
        `  writeFileSync(${JSON.stringify(ready)}, tempDir("tk-sup-fixture-"));`,
        `  await new Promise((r) => setTimeout(r, 60_000));`,
        `}, 90_000);`,
      ].join("\n"));
      const env: Record<string, string | undefined> = { ...process.env, TMPDIR: fresh, TEMP: fresh, TMP: fresh };
      const child = spawn(process.execPath, ["test", "--preload", preload, "./fixture.test.ts"], { cwd: fixtures, env, stdio: "ignore" });
      const exited = new Promise<number | null>((r) => child.on("exit", (status) => r(status)));
      try {
        for (let waited = 0; !existsSync(ready) && child.exitCode === null && waited < 60_000; waited += 50) await sleep(50);
        expect(existsSync(ready)).toBe(true);
        expect(existsSync(readFileSync(ready, "utf-8"))).toBe(true); // the folder is there before the signal
        child.kill(signal);
        const status = await Promise.race([exited, sleep(30_000).then(() => "timed out" as const)]);
        expect(status).toBe(code);
        expect(leftovers(fresh)).toEqual([]);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    }, 120_000);
  }
});
