// Story 33.1: the supervisor's log file — the line shape, the day file and its midnight switch, the rotation, the
// redaction and the tee end to end, every clock a fake.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  appendLine, dayOf, formatLine, KEEP_DAYS, LOG_TAGS, logDir, logPath, pacerPath, parseTeeArgs, readLogTail, readPacer, redactLine,
  rotateLogs, runUnderLog, SLOW_PASS_MS, TAIL_LINES,
} from "../src/log";
import { redactCredentials } from "../src/page";
import { tempDir } from "./tmp";

const REPO = resolve(import.meta.dir, "..");
const TELEGRAM = "123456789:AAtelegram-bot-secret-value-xyz-0123456789";
const BEARER = "bearer-planted-log-secret-77";
const T0 = Date.UTC(2026, 9, 26, 23, 59, 58, 500); // 2026-10-26T23:59:58.500Z
const tmp = tempDir; // test/tmp.ts removes the folders

/** A work folder and its env (the planted secret included). */
function work(extra: Record<string, string> = {}) {
  const root = tmp("tk-sup-log-");
  const env: Record<string, string> = { TK_SUPERVISOR_WORK: root, TK_SUPERVISOR_TELEGRAM_TOKEN: TELEGRAM, ...extra };
  return { root, env, dir: join(root, "supervisor", "logs") };
}
const clock = (ms: number) => { let at = ms; const now = () => at; return { now, set: (v: number) => { at = v; } }; };
const fileLines = (path: string) => readFileSync(path, "utf-8").split("\n").filter(Boolean);

describe("the line and the day file (AC1)", () => {
  test("formatLine: `<ISO UTC> [tag] text`, a newline a space, a CR dropped", () => {
    expect(formatLine("tick", "a\nb\r", () => T0)).toBe("2026-10-26T23:59:58.500Z [tick] a b");
    expect([...LOG_TAGS]).toEqual(["serve", "tick", "drain", "keeper", "pacer"]);
    expect([KEEP_DAYS, TAIL_LINES]).toEqual([14, 20]);
  });

  test("the folder and the file: <work>/supervisor/logs/supervisor-<UTC date>.log; unset work, none", () => {
    const w = work();
    expect(logDir(w.env)).toBe(w.dir);
    expect(logPath(w.env, () => T0)).toBe(join(w.dir, "supervisor-2026-10-26.log"));
    expect(dayOf(T0 + 2000)).toBe("2026-10-27");
    expect(logDir({})).toBeUndefined();
    expect(logDir({ TK_SUPERVISOR_WORK: "  " })).toBeUndefined();
    expect(appendLine({}, "pacer", "x", () => T0)).toBeUndefined();
  });

  test("the day switch: a line after UTC midnight goes to the new day's file", () => {
    const w = work();
    const c = clock(T0);
    appendLine(w.env, "pacer", "before midnight", c.now);
    c.set(T0 + 2000);
    appendLine(w.env, "pacer", "after midnight", c.now);
    expect(fileLines(join(w.dir, "supervisor-2026-10-26.log"))).toEqual(["2026-10-26T23:59:58.500Z [pacer] before midnight"]);
    expect(fileLines(join(w.dir, "supervisor-2026-10-27.log"))).toEqual(["2026-10-27T00:00:00.500Z [pacer] after midnight"]);
  });
});

describe("the rotation (AC1: the last 14 kept)", () => {
  test("16 day files and a foreign one: the newest 14 kept, the foreign file untouched", () => {
    const w = work();
    mkdirSync(w.dir, { recursive: true });
    const days = Array.from({ length: 16 }, (_, i) => `supervisor-2026-10-${String(i + 1).padStart(2, "0")}.log`);
    for (const d of days) writeFileSync(join(w.dir, d), "old\n");
    writeFileSync(join(w.dir, "notes.txt"), "mine\n");
    writeFileSync(join(w.dir, "supervisor-old.log"), "not a day file\n");
    const removed = rotateLogs(w.dir, () => Date.UTC(2026, 9, 16, 12));
    expect(removed).toEqual(days.slice(0, 2));
    expect(readdirSync(w.dir).sort()).toEqual([...days.slice(2), "notes.txt", "supervisor-old.log"].sort());
  });

  test("a new day's file rotates on its first append; later appends do not", () => {
    const w = work();
    mkdirSync(w.dir, { recursive: true });
    for (let i = 1; i <= 14; i++) writeFileSync(join(w.dir, `supervisor-2026-10-${String(i).padStart(2, "0")}.log`), "old\n");
    const c = clock(Date.UTC(2026, 9, 15, 8));
    appendLine(w.env, "tick", "first of the day", c.now);
    const after = readdirSync(w.dir).sort();
    expect(after).toHaveLength(14);
    expect(after[0]).toBe("supervisor-2026-10-02.log");
    expect(after.at(-1)).toBe("supervisor-2026-10-15.log");
    writeFileSync(join(w.dir, "supervisor-2026-10-03.log"), "kept until the next new day\n");
    appendLine(w.env, "tick", "second of the day", c.now);
    expect(readdirSync(w.dir)).toHaveLength(14);
  });
});

describe("the redaction (AC1: the page's rule)", () => {
  test("a TK_SUPERVISOR_*TOKEN* value and a Bearer: [redacted] in the file and in last_lines", () => {
    const w = work();
    const now = () => T0;
    appendLine(w.env, "serve", `sent with ${TELEGRAM} and Authorization: Bearer ${BEARER}`, now);
    const raw = readFileSync(join(w.dir, "supervisor-2026-10-26.log"), "utf-8");
    for (const v of [TELEGRAM, BEARER]) expect(raw).not.toContain(v);
    expect(raw).toContain("[redacted]");
    // A line planted straight into the file is redacted again on read.
    writeFileSync(join(w.dir, "supervisor-2026-10-26.log"), `${raw}2026-10-26T23:59:59.000Z [tick] leaked ${TELEGRAM} Bearer ${BEARER}\n`);
    const tail = readLogTail(w.env, now);
    expect(tail.last_lines).toHaveLength(2);
    for (const l of tail.last_lines) for (const v of [TELEGRAM, BEARER]) expect(l).not.toContain(v);
    expect(tail.last_lines[1]).toBe("2026-10-26T23:59:59.000Z [tick] leaked [redacted] Bearer [redacted]");
  });

  test("redactLine is redactCredentials itself; a non-secret TK_SUPERVISOR_* value stays (Settled shape 2)", () => {
    const env = { TK_SUPERVISOR_TELEGRAM_TOKEN: TELEGRAM, TK_SUPERVISOR_BIND: "100.64.0.9" };
    const text = `listening http://100.64.0.9:8787 ${TELEGRAM}`;
    expect(redactLine(text, env)).toBe(redactCredentials(text, env, ""));
    expect(redactLine(text, env)).toBe("listening http://100.64.0.9:8787 [redacted]");
  });
});

describe("readLogTail (GET /status's `log`)", () => {
  test("the last 20 lines of today's file", () => {
    const w = work();
    const now = () => T0;
    for (let i = 1; i <= 25; i++) appendLine(w.env, "drain", `line ${i}`, now);
    const tail = readLogTail(w.env, now);
    expect(tail.path).toBe(join(w.dir, "supervisor-2026-10-26.log"));
    expect(tail.last_lines).toHaveLength(20);
    expect(tail.last_lines[0]).toEndWith("[drain] line 6");
    expect(tail.last_lines[19]).toEndWith("[drain] line 25");
    expect(tail.note).toBeUndefined();
  });

  test("no file today: the newest present day file", () => {
    const w = work();
    appendLine(w.env, "keeper", "two days ago", () => T0 - 2 * 86400_000);
    appendLine(w.env, "keeper", "yesterday", () => T0 - 86400_000);
    const tail = readLogTail(w.env, () => T0);
    expect(tail.path).toBe(join(w.dir, "supervisor-2026-10-25.log"));
    expect(tail.last_lines.map((l) => l.split("] ")[1])).toEqual(["yesterday"]);
  });

  test("no folder: `no log`; work unset: path null and the variable named", () => {
    const w = work();
    expect(readLogTail(w.env, () => T0)).toEqual({ path: join(w.dir, "supervisor-2026-10-26.log"), last_lines: [], note: "no log" });
    mkdirSync(w.dir, { recursive: true });
    writeFileSync(join(w.dir, "notes.txt"), "not a log\n");
    expect(readLogTail(w.env, () => T0).note).toBe("no log");
    expect(readLogTail({}, () => T0)).toEqual({ path: null, last_lines: [], note: "TK_SUPERVISOR_WORK is not set" });
  });
});

describe("the tee (AC1: serve, tick and drain under src/log.ts)", () => {
  const script = (body: string) => {
    const dir = tmp("tk-sup-log-script-");
    const path = join(dir, "child.ts");
    writeFileSync(path, body);
    return path;
  };
  const capture = () => {
    const out: string[] = [], err: string[] = [];
    return { out, err, io: { stdout: (s: string) => { out.push(s); }, stderr: (s: string) => { err.push(s); } } };
  };

  test("the usage: a bad tag or no `--` is exit 2, nothing spawned", async () => {
    for (const argv of [[], ["--tag", "nope", "--", "x.ts"], ["--tag", "tick", "x.ts"], ["--tag", "tick", "--"]]) {
      const c = capture();
      expect(parseTeeArgs(argv)).toBeNull();
      expect(await runUnderLog(argv, {}, () => T0, c.io)).toBe(2);
      expect(c.err.join("")).toContain("usage: bun src/log.ts --tag <serve|tick|drain|keeper|pacer>");
    }
    expect(parseTeeArgs(["--tag", "drain", "--", "src/cli.ts", "drain"])).toEqual({ tag: "drain", pass: false, args: ["src/cli.ts", "drain"] });
  });

  test("stdout and stderr echoed and logged, `started` and `stopped (exit 3)`, the child's code answered", async () => {
    const w = work();
    const child = script(`process.stdout.write("to out\\n"); process.stderr.write("to err ${TELEGRAM}\\npartial"); process.exitCode = 3;`);
    const c = capture();
    const code = await runUnderLog(["--tag", "tick", "--", child], w.env, () => T0, c.io);
    expect(code).toBe(3);
    expect(c.out).toEqual(["to out\n"]);
    expect(c.err).toEqual([`to err ${TELEGRAM}\n`, "partial\n"]);
    const lines = fileLines(join(w.dir, "supervisor-2026-10-26.log")).map((l) => l.replace(/^\S+ /, ""));
    expect(lines[0]).toBe(`[tick] started: bun ${child}`);
    expect(lines.slice(1, -1).sort()).toEqual(["[tick] partial", "[tick] to err [redacted]", "[tick] to out"]);
    expect(lines.at(-1)).toBe("[tick] stopped (exit 3)");
    expect(lines.some((l) => l.includes("uncaught"))).toBe(false);
  });

  test("a thrown error adds an `uncaught:` line before `stopped`", async () => {
    const w = work();
    const child = script(`throw new Error("boom in the child");`);
    const c = capture();
    const code = await runUnderLog(["--tag", "drain", "--", child], w.env, () => T0, c.io);
    expect(code).not.toBe(0);
    const lines = fileLines(join(w.dir, "supervisor-2026-10-26.log")).map((l) => l.replace(/^\S+ /, ""));
    const uncaught = lines.findIndex((l) => l.startsWith("[drain] uncaught: "));
    expect(uncaught).toBeGreaterThan(0);
    expect(lines[uncaught]).toContain("boom in the child");
    expect(lines.at(-1)).toBe(`[drain] stopped (exit ${code})`);
  });

  test("the process's own `uncaught:` line (cli.ts / tick.ts handlers) is filed once, not doubled", async () => {
    const w = work();
    const child = script(`process.on("uncaughtException", (e) => { console.error(\`uncaught: \${e.message}\`); process.exit(70); });
setTimeout(() => { throw new Error("late boom"); }, 1);`);
    const code = await runUnderLog(["--tag", "serve", "--", child], w.env, () => T0, capture().io);
    expect(code).toBe(70);
    const lines = fileLines(join(w.dir, "supervisor-2026-10-26.log")).map((l) => l.replace(/^\S+ /, ""));
    expect(lines.filter((l) => l.includes("uncaught"))).toEqual(["[serve] uncaught: late boom"]);
    expect(lines.at(-1)).toBe("[serve] stopped (exit 70)");
  });

  test("as a script: `bun src/log.ts` exits with the child's code and echoes to its own streams", () => {
    const w = work();
    const child = script(`console.log("hello from the child"); console.error("err line"); process.exit(75);`);
    const r = spawnSync(process.execPath, ["src/log.ts", "--tag", "serve", "--", child], { cwd: REPO, encoding: "utf-8", env: { ...process.env, ...w.env } });
    expect(r.status).toBe(75);
    expect(r.stdout).toBe("hello from the child\n");
    expect(r.stderr).toBe("err line\n");
    const log = readdirSync(w.dir).filter((n) => n.startsWith("supervisor-"));
    expect(log).toHaveLength(1);
    const lines = fileLines(join(w.dir, log[0]));
    for (const l of lines) expect(l).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[serve\] /);
    expect(lines.at(-1)).toEndWith("[serve] stopped (exit 75)");
    expect(existsSync(join(w.root, "supervisor", "logs"))).toBe(true);
  });

  // Ctrl+C reaches the tee too (the shared console): it outlives the child to log the child's `stopped` line.
  // win32 cannot deliver a catchable SIGINT to one process (process.kill terminates it), so the row is POSIX's.
  test.skipIf(process.platform === "win32")("as a script: a SIGINT to the tee leaves it up; the child's `stopped` line and code still come", async () => {
    const w = work();
    const child = script(`setTimeout(() => process.exit(4), 1500);`);
    const tee = spawn(process.execPath, ["src/log.ts", "--tag", "tick", "--", child], { cwd: REPO, env: { ...process.env, ...w.env }, stdio: "ignore" });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((ok) => tee.on("exit", (code, signal) => ok({ code, signal })));
    const file = join(w.dir, "supervisor-" + new Date().toISOString().slice(0, 10) + ".log");
    // The `started` line is written after the tee installs its handlers.
    for (let i = 0; i < 100 && !(existsSync(file) && readFileSync(file, "utf-8").includes("started: bun")); i++) await Bun.sleep(20);
    expect(tee.kill("SIGINT")).toBe(true);
    expect(await exited).toEqual({ code: 4, signal: null });
    expect(fileLines(file).at(-1)).toEndWith("[tick] stopped (exit 4)");
  });
});

describe("the processes' own uncaught handlers (cli.ts, tick.ts)", () => {
  for (const name of ["cli.ts", "tick.ts"]) {
    test(`${name}: under import.meta.main, uncaughtException and unhandledRejection print \`uncaught: \` and exit 70`, () => {
      const text = readFileSync(join(REPO, "src", name), "utf-8").replace(/\r\n/g, "\n");
      const entry = text.slice(text.lastIndexOf("\nif (import.meta.main) {\n"));
      const block = entry.slice(0, entry.indexOf("\n}\n") + 2);
      for (const event of ["uncaughtException", "unhandledRejection"]) {
        const handler = block.split("\n").find((l) => l.includes(`process.on("${event}"`));
        expect(handler).toBeDefined();
        expect(handler!).toContain("console.error(`uncaught: ${");
        expect(handler!).toContain("process.exit(70)");
        expect(block.indexOf(handler!)).toBeLessThan(block.indexOf("main("));
      }
    });
  }
});

// Story 33.7: a pacer pass — its duration and exit code logged, a slow one warned and sent once, the last ones
// in pacer.json (`readPacer`). The clock is a fake the child's first output line moves forward.
describe("a pacer pass (Story 33.7, AC2)", () => {
  const script = (body: string) => {
    const dir = tmp("tk-sup-log-script-");
    const path = join(dir, "child.ts");
    writeFileSync(path, body);
    return path;
  };
  /** The io, its clock jumping to `T0 + ms` at the child's first output line, and a recording fetch. */
  const passIo = (ms: number) => {
    const c = clock(T0);
    const sends: { url: string; body: string }[] = [];
    const jump = () => { c.set(T0 + ms); };
    const io = {
      stdout: (_: string) => { jump(); }, stderr: (_: string) => { jump(); },
      fetch: async (url: string, init?: RequestInit) => { sends.push({ url, body: String(init?.body ?? "") }); return new Response("ok"); },
    };
    return { c, io, sends };
  };
  const NTFY = { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.invalid/pacer-topic" };
  const rid = (i: number) => `q-run-epic-33-2026102${i % 10}T021118Z-${(0xabc000 + i).toString(16)}`;
  // Every day file in order (T0 is a second before midnight: a long pass ends in the next day's file).
  const tagged = (w: { dir: string }) => readdirSync(w.dir).filter((n) => n.startsWith("supervisor-")).sort()
    .flatMap((n) => fileLines(join(w.dir, n))).map((l) => l.replace(/^\S+ /, ""));

  test("--pass: `pass: <ms> ms, exit <code>` before `stopped`, pacer.json written; --pass is only for tick and drain", async () => {
    const w = work();
    const child = script(`console.log("ticking"); process.exitCode = 3;`);
    const p = passIo(1234);
    expect(await runUnderLog(["--tag", "tick", "--pass", "--", child], w.env, p.c.now, p.io)).toBe(3);
    const lines = tagged(w);
    expect(lines.slice(-2)).toEqual(["[tick] pass: 1234 ms, exit 3", "[tick] stopped (exit 3)"]);
    expect(lines.some((l) => l.includes("warning:"))).toBe(false);
    expect(p.sends).toEqual([]);
    expect(readPacer(w.env)).toEqual({ last_tick_ms: 1234, last_drain_ms: null, last_pass_at: new Date(T0 + 1234).toISOString() });
    expect(readdirSync(join(w.root, "supervisor")).sort()).toEqual(["logs", "pacer.json"]);

    expect(parseTeeArgs(["--tag", "drain", "--pass", "--", "src/cli.ts", "drain"])).toEqual({ tag: "drain", pass: true, args: ["src/cli.ts", "drain"] });
    for (const argv of [["--tag", "serve", "--pass", "--", child], ["--tag", "keeper", "--pass", "--", child], ["--tag", "tick", "--pass", child], ["--tag", "tick", "--pass", "--"]]) {
      const err: string[] = [];
      expect(parseTeeArgs(argv)).toBeNull();
      expect(await runUnderLog(argv, w.env, () => T0, { stdout: () => {}, stderr: (s) => { err.push(s); } })).toBe(2);
      expect(err.join("")).toContain("[--pass]");
    }
  });

  test("without --pass: no pass line and no pacer.json", async () => {
    const w = work();
    const child = script(`console.log("draining");`);
    const p = passIo(SLOW_PASS_MS + 1);
    expect(await runUnderLog(["--tag", "drain", "--", child], { ...w.env, ...NTFY }, p.c.now, p.io)).toBe(0);
    const lines = tagged(w);
    expect(lines.some((l) => l.includes("pass:") || l.includes("warning:"))).toBe(false);
    expect(lines.at(-1)).toBe("[drain] stopped (exit 0)");
    expect(existsSync(pacerPath(w.env)!)).toBe(false);
    expect(p.sends).toEqual([]);
  });

  test("over SLOW_PASS_MS: one warning naming the run ids it drove (distinct, first seen) and one notifier send", async () => {
    expect(SLOW_PASS_MS).toBe(600_000);
    const w = work();
    const child = script(`console.log("[studio-tick] job: run ${rid(1)} running"); console.error("again ${rid(1)} and {\\"run_id\\":\\"${rid(2)}\\"}");`);
    const p = passIo(SLOW_PASS_MS + 1);
    expect(await runUnderLog(["--tag", "drain", "--pass", "--", child], { ...w.env, ...NTFY }, p.c.now, p.io)).toBe(0);
    const warning = `warning: pass drain took ${SLOW_PASS_MS + 1} ms (over 10 min), driving ${rid(1)}, ${rid(2)}`;
    expect(tagged(w).slice(-3)).toEqual([`[drain] pass: ${SLOW_PASS_MS + 1} ms, exit 0`, `[drain] ${warning}`, "[drain] stopped (exit 0)"]);
    expect(p.sends).toEqual([{ url: NTFY.TK_SUPERVISOR_NTFY_URL, body: warning }]);
  });

  test("the warning: one id, none (`no run named`), six (`+1 more`); a failing send is swallowed", async () => {
    const one = work();
    const p1 = passIo(SLOW_PASS_MS + 5);
    await runUnderLog(["--tag", "tick", "--pass", "--", script(`console.log("run ${rid(3)} queued");`)], one.env, p1.c.now, p1.io);
    expect(tagged(one)).toContain(`[tick] warning: pass tick took ${SLOW_PASS_MS + 5} ms (over 10 min), driving ${rid(3)}`);
    expect(p1.sends).toEqual([]); // no notifier selected: nothing sent

    const none = work();
    const p0 = passIo(SLOW_PASS_MS + 5);
    p0.io.fetch = async () => { throw new Error("network down"); };
    expect(await runUnderLog(["--tag", "tick", "--pass", "--", script(`console.log("nothing to do");`)], { ...none.env, ...NTFY }, p0.c.now, p0.io)).toBe(0);
    expect(tagged(none).slice(-2)).toEqual([`[tick] warning: pass tick took ${SLOW_PASS_MS + 5} ms (over 10 min), driving no run named`, "[tick] stopped (exit 0)"]);

    const six = work();
    const p6 = passIo(SLOW_PASS_MS + 5);
    const ids = [1, 2, 3, 4, 5, 6].map(rid);
    await runUnderLog(["--tag", "drain", "--pass", "--", script(ids.map((id) => `console.log("run ${id}");`).join("\n"))], { ...six.env, ...NTFY }, p6.c.now, p6.io);
    const text = `warning: pass drain took ${SLOW_PASS_MS + 5} ms (over 10 min), driving ${ids.slice(0, 5).join(", ")} +1 more`;
    expect(tagged(six)).toContain(`[drain] ${text}`);
    expect(p6.sends.map((x) => x.body)).toEqual([text]);
  });

  test("at the threshold: no warning, no send", async () => {
    const w = work();
    const p = passIo(SLOW_PASS_MS);
    await runUnderLog(["--tag", "tick", "--pass", "--", script(`console.log("run ${rid(1)}");`)], { ...w.env, ...NTFY }, p.c.now, p.io);
    expect(tagged(w).some((l) => l.includes("warning:"))).toBe(false);
    expect(tagged(w)).toContain(`[tick] pass: ${SLOW_PASS_MS} ms, exit 0`);
    expect(p.sends).toEqual([]);
  });

  test("pacer.json holds both steps across two passes, `last_pass_at` the later one", async () => {
    const w = work();
    const child = script(`console.log("step");`);
    const tick = passIo(40);
    await runUnderLog(["--tag", "tick", "--pass", "--", child], w.env, tick.c.now, tick.io);
    const drain = passIo(75);
    drain.c.set(T0 + 1000);
    drain.io.stdout = () => { drain.c.set(T0 + 1075); };
    await runUnderLog(["--tag", "drain", "--pass", "--", child], w.env, drain.c.now, drain.io);
    expect(readPacer(w.env)).toEqual({ last_tick_ms: 40, last_drain_ms: 75, last_pass_at: new Date(T0 + 1075).toISOString() });
    expect(JSON.parse(readFileSync(pacerPath(w.env)!, "utf-8"))).toEqual(readPacer(w.env));
  });

  test("a failing pacer.json write is swallowed: the pass line still stands before `stopped`, the child's code returned", async () => {
    const w = work();
    // pacer.json is a (non-empty) directory: the rename onto it fails even as root.
    mkdirSync(pacerPath(w.env)!, { recursive: true });
    writeFileSync(join(pacerPath(w.env)!, "keep"), "x");
    const child = script(`console.log("ticking"); process.exitCode = 4;`);
    const p = passIo(321);
    expect(await runUnderLog(["--tag", "tick", "--pass", "--", child], w.env, p.c.now, p.io)).toBe(4);
    expect(tagged(w).slice(-2)).toEqual(["[tick] pass: 321 ms, exit 4", "[tick] stopped (exit 4)"]);
    expect(statSync(pacerPath(w.env)!).isDirectory()).toBe(true);
    expect(readdirSync(join(w.root, "supervisor")).sort()).toEqual(["logs", "pacer.json"]); // no temp file left behind
    expect(readPacer(w.env)).toEqual({ last_tick_ms: null, last_drain_ms: null, last_pass_at: null });
  });

  test("readPacer: absent, invalid and the work folder unset all answer nulls", () => {
    const nulls = { last_tick_ms: null, last_drain_ms: null, last_pass_at: null };
    const w = work();
    expect(readPacer(w.env)).toEqual(nulls);
    mkdirSync(join(w.root, "supervisor"), { recursive: true });
    writeFileSync(pacerPath(w.env)!, "{not json");
    expect(readPacer(w.env)).toEqual(nulls);
    writeFileSync(pacerPath(w.env)!, JSON.stringify([1, 2]));
    expect(readPacer(w.env)).toEqual(nulls);
    writeFileSync(pacerPath(w.env)!, JSON.stringify({ last_tick_ms: "12", last_drain_ms: 9, last_pass_at: 5 }));
    expect(readPacer(w.env)).toEqual({ last_tick_ms: null, last_drain_ms: 9, last_pass_at: null });
    expect(readPacer({})).toEqual(nulls);
    expect(pacerPath({})).toBeUndefined();
  });
});

describe("Story 36.5 (M12, DW-63): the pacer pass, visible while it runs", () => {
  const NTFY = { TK_SUPERVISOR_NOTIFY: "ntfy", TK_SUPERVISOR_NTFY_URL: "https://ntfy.invalid/pacer-topic" };
  const ID = "q-run-epic-36-20261031T121930Z-29f699";
  const childScript = (body: string) => { const p = join(tempDir("tk-sup-log-script-"), "child.ts"); writeFileSync(p, body); return p; };
  const lines = (w: { dir: string }) => readdirSync(w.dir).filter((n) => n.startsWith("supervisor-")).sort().flatMap((n) => fileLines(join(w.dir, n)));

  test("the timer fires while the child runs: warning, one send and `running` before the exit; `finish` repeats none and removes `running`", async () => {
    const w = work(NTFY);
    const c = clock(T0);
    const sends: string[] = [];
    let fire: (() => void) | undefined, armed = 0, cleared = 0;
    const seen: { warned: boolean; running: unknown }[] = [];
    const child = childScript(`console.log("driving ${ID}"); console.log("next"); await new Promise((r) => setTimeout(r, 400)); console.log("done");`);
    const code = await runUnderLog(["--tag", "drain", "--pass", "--", child], w.env, c.now, {
      stdout: (s) => {
        if (!s.startsWith("next")) return; // the ids are collected after each line's echo
        c.set(T0 + SLOW_PASS_MS + 5);
        fire!();
        fire!(); // a second firing is a no-op
        seen.push({ warned: lines(w).some((l) => l.includes("warning: pass drain")), running: readPacer(w.env).running });
        c.set(T0 + SLOW_PASS_MS + 9);
      },
      stderr: () => {},
      fetch: async (_u, init) => { sends.push(String(init?.body ?? "")); return new Response("ok"); },
      setTimeout: (fn, ms) => { expect(ms).toBe(SLOW_PASS_MS); armed++; fire = fn; return 1; },
      clearTimeout: () => { cleared++; },
    });
    expect(code).toBe(0);
    expect(armed).toBe(1);
    expect(cleared).toBe(1);
    expect(seen).toEqual([{ warned: true, running: { tag: "drain", started_at: new Date(T0).toISOString(), elapsed_ms: SLOW_PASS_MS + 5, ids: [ID] } }]);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toBe(`warning: pass drain took ${SLOW_PASS_MS + 5} ms (over 10 min), driving ${ID}`);
    expect(lines(w).filter((l) => l.includes("warning: pass"))).toHaveLength(1);
    const end = readPacer(w.env);
    expect(end).toEqual({ last_tick_ms: null, last_drain_ms: SLOW_PASS_MS + 9, last_pass_at: new Date(T0 + SLOW_PASS_MS + 9).toISOString() });
    expect(Object.keys(JSON.parse(readFileSync(pacerPath(w.env)!, "utf-8")))).toEqual(["last_tick_ms", "last_drain_ms", "last_pass_at"]);
  });

  test("a short pass: no timer output, the timer cleared, exact old keys; a later other step keeps a `running` it does not own", async () => {
    const w = work(NTFY);
    const c = clock(T0);
    const sends: string[] = [];
    let cleared = 0;
    const io = {
      stdout: () => {}, stderr: () => {}, fetch: async (_u: string, init?: RequestInit) => { sends.push(String(init?.body)); return new Response("ok"); },
      setTimeout: () => 7, clearTimeout: (t: unknown) => { expect(t).toBe(7); cleared++; },
    };
    expect(await runUnderLog(["--tag", "tick", "--pass", "--", childScript(`console.log("t");`)], w.env, c.now, io)).toBe(0);
    expect(cleared).toBe(1);
    expect(sends).toEqual([]);
    expect(lines(w).some((l) => l.includes("warning:"))).toBe(false);
    expect(Object.keys(readPacer(w.env))).toEqual(["last_tick_ms", "last_drain_ms", "last_pass_at"]);

    const running = { tag: "drain", started_at: "2026-10-31T00:00:00.000Z", elapsed_ms: 600001, ids: [ID] };
    writeFileSync(pacerPath(w.env)!, JSON.stringify({ ...readPacer(w.env), running }));
    expect(readPacer(w.env).running).toEqual(running);
    await runUnderLog(["--tag", "tick", "--pass", "--", childScript(`console.log("t");`)], w.env, c.now, io);
    expect(readPacer(w.env).running).toEqual(running);
    // an invalid member reads as absent
    writeFileSync(pacerPath(w.env)!, JSON.stringify({ last_tick_ms: 1, running: { tag: 3 } }));
    expect(Object.keys(readPacer(w.env))).toEqual(["last_tick_ms", "last_drain_ms", "last_pass_at"]);
  });

  test("a fake clock past the bound with no timer firing: `finish` warns, once", async () => {
    const w = work(NTFY);
    const c = clock(T0);
    const sends: string[] = [];
    await runUnderLog(["--tag", "tick", "--pass", "--", childScript(`console.log("t");`)], w.env, c.now, {
      stdout: () => { c.set(T0 + SLOW_PASS_MS + 1); }, stderr: () => {}, setTimeout: () => 1, clearTimeout: () => {},
      fetch: async (_u, init) => { sends.push(String(init?.body)); return new Response("ok"); },
    });
    expect(sends).toHaveLength(1);
    expect(lines(w).filter((l) => l.includes("warning:"))).toHaveLength(1);
  });
});
