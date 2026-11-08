// DW-184, DW-195: the live-host-leg signal (src/liveleg.ts, the rule tools/verify_host.py reads) and test/preload.ts's
// beside-leg refusal (hole 118).
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { besideLegRefusal, leaseClock, leaseDeadlineMs, leaseLive, liveLegs } from "../src/liveleg";
import { tempDir, track } from "./tmp";

const REPO = resolve(import.meta.dir, "..");
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const AT = "2026-11-08T11:30:00.000Z";
const OWNER = { pid: 4242, host: "box", nonce: "n1" };

/** A fixture queue file holding only the `events` table, plus an `event` writer. */
function queueFile(): { path: string; event: (runId: string, kind: string, detail: unknown) => void } {
  const path = join(tempDir("tk-sup-liveleg-"), "queue.db");
  const db = track(new Database(path));
  db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, "
    + "from_state TEXT, to_state TEXT NOT NULL, detail TEXT)");
  return {
    path,
    event: (runId, kind, detail) => {
      db.query("INSERT INTO events (run_id, at, kind, from_state, to_state, detail) VALUES (?, ?, ?, 'partial', 'partial', ?)")
        .run(runId, AT, kind, typeof detail === "string" ? detail : JSON.stringify(detail));
    },
  };
}

const lease = (extra: Record<string, unknown> = {}) => ({ owner: OWNER, by: "close-out", ...extra });
const REFUSAL = (id: string, by = "close-out") => `bun test: refused: a host leg is live on this box: queue run ${id} (by ${by}, since ${AT}); `
  + `a hand test beside the leg slows its bounded drives (hole 118): wait for its host-verify event (GET /runs/${id}), `
  + "or set TK_VERIFY_BESIDE_LEG=1 to run anyway";

describe("DW-184: the live-leg rule", () => {
  test("a deadline ahead is live; past (or equal) is stale; absent or unparsable is live; closed or released is not", () => {
    const q = queueFile();
    q.event("q-ahead", "host-verify-leg", lease({ guard_s: 600, deadline: new Date(NOW + 3_600_000).toISOString() }));
    q.event("q-past", "host-verify-leg", lease({ guard_s: 600, deadline: new Date(NOW - 1000).toISOString() }));
    q.event("q-now", "host-verify-leg", lease({ guard_s: 600, deadline: new Date(NOW).toISOString() }));
    q.event("q-old", "host-verify-leg", lease()); // written before DW-184
    q.event("q-garbage", "host-verify-leg", lease({ deadline: "garbage" }));
    q.event("q-closed", "host-verify-leg", lease());
    q.event("q-closed", "host-verify", { green: true });
    q.event("q-released", "host-verify-leg", lease({ by: "api" }));
    q.event("q-released", "host-verify-leg", { owner: null, released: OWNER });
    q.event("q-api", "host-verify-leg", { owner: OWNER }); // no `by`: a re-run
    expect(liveLegs(q.path, NOW)).toEqual({ legs: [
      { run_id: "q-ahead", by: "close-out", at: AT }, { run_id: "q-old", by: "close-out", at: AT },
      { run_id: "q-garbage", by: "close-out", at: AT }, { run_id: "q-api", by: "re-run", at: AT },
    ] });
  });

  test("leaseLive and leaseClock", () => {
    expect(leaseLive(null, NOW)).toBe(false);
    expect(leaseLive({ owner: null }, NOW)).toBe(false);
    expect(leaseLive({ owner: OWNER, deadline: 12 }, NOW)).toBe(true);
    expect(leaseClock(90, NOW)).toEqual({ guard_s: 90, deadline: "2026-11-08T12:01:30.000Z" });
  });

  test("only a strict zoned extended deadline is read (the same rule as verify_host.py lease_deadline)", () => {
    // A zoneless, padded or basic-format deadline is no deadline (live); an offset is honoured.
    for (const deadline of ["2026-11-08T12:00:00", " 2026-11-08T12:00:00Z ", "20261108T120000Z"]) {
      expect(leaseLive({ owner: OWNER, deadline }, NOW + 86_400_000)).toBe(true);
      expect(leaseDeadlineMs(deadline)).toBeNaN();
    }
    expect(leaseLive({ owner: OWNER, deadline: "2026-11-08T14:00:00+02:00" }, NOW - 1000)).toBe(true);
    expect(leaseLive({ owner: OWNER, deadline: "2026-11-08T14:00:00+02:00" }, NOW)).toBe(false);
    expect(leaseDeadlineMs("2026-11-08T14:00:00+02:00")).toBe(NOW);
    expect(leaseDeadlineMs("2026-11-08T07:00:00.5-05:00")).toBe(NOW + 500);
    for (const bad of ["2026-02-30T12:00:00Z", "2026-11-08T24:00:00Z", "2026-11-08T12:00:00+24:00",
      "2026-11-08T12:00:00z", "2026-11-08 12:00:00Z"]) {
      expect(leaseDeadlineMs(bad)).toBeNaN();
    }
  });

  test("an unreadable queue answers its error, never throws", () => {
    const path = join(tempDir("tk-sup-liveleg-"), "garbage.db");
    writeFileSync(path, "this is not a sqlite database at all, just bytes".repeat(20), { encoding: "utf-8" });
    const r = liveLegs(path, NOW);
    expect(r.legs).toEqual([]);
    expect(typeof r.error).toBe("string");
  });
});

describe("DW-195: besideLegRefusal", () => {
  test("a live leg: the refusal naming every live run; the override, the leg's own run, no queue: null", () => {
    const q = queueFile();
    q.event("q-a", "host-verify-leg", lease({ guard_s: 600, deadline: new Date(NOW + 3_600_000).toISOString() }));
    const env = { TK_SUPERVISOR_DB: q.path };
    expect(besideLegRefusal(env, NOW)).toBe(REFUSAL("q-a"));
    q.event("q-b", "host-verify-leg", { owner: OWNER, by: "api" });
    expect(besideLegRefusal(env, NOW)).toBe(REFUSAL("q-a").replace(`since ${AT});`, `since ${AT}); queue run q-b (by api, since ${AT});`));
    expect(besideLegRefusal({ ...env, TK_VERIFY_BESIDE_LEG: "1" }, NOW)).toBeNull();
    expect(besideLegRefusal({ ...env, TK_SUPERVISOR_HOST_LEG: "q-a" }, NOW)).toBeNull();
    expect(besideLegRefusal({}, NOW)).toBeNull();
    expect(besideLegRefusal({ TK_SUPERVISOR_DB: join(tempDir("tk-sup-liveleg-"), "absent.db") }, NOW)).toBeNull();
    // Past q-a's deadline: q-a is stale; q-b has no deadline and stays live.
    expect(besideLegRefusal(env, NOW + 7_200_000)).toBe(REFUSAL("q-b", "api"));
  });

  test("the leg's own run never opens the queue (its path need not even be a file)", () => {
    expect(besideLegRefusal({ TK_SUPERVISOR_DB: REPO, TK_SUPERVISOR_HOST_LEG: "q-a" }, NOW)).toBeNull();
  });

  test("an unreadable queue: null (one stderr note)", () => {
    const path = join(tempDir("tk-sup-liveleg-"), "garbage.db");
    writeFileSync(path, "this is not a sqlite database at all, just bytes".repeat(20), { encoding: "utf-8" });
    const notes: string[] = [];
    const real = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      notes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(besideLegRefusal({ TK_SUPERVISOR_DB: path }, NOW)).toBeNull();
    } finally {
      process.stderr.write = real;
    }
    expect(notes).toHaveLength(1);
    expect(notes[0]).toStartWith(`bun test: the queue at ${path} was not read (`);
    expect(notes[0]).toEndWith("); running without the beside-leg check\n");
  });

  test("a hand `bun test --timeout 30000 <file>` beside a live leg exits 2 naming the run before any test runs; with TK_VERIFY_BESIDE_LEG=1 it runs", () => {
    const q = queueFile();
    q.event("q-live", "host-verify-leg", lease({ guard_s: 600, deadline: new Date(Date.now() + 3_600_000).toISOString() }));
    const probe = join(tempDir("tk-sup-liveleg-probe-"), "probe.test.ts");
    writeFileSync(probe, `import { test } from "bun:test";\ntest("probe", () => { console.log("PROBE RAN"); });\n`, { encoding: "utf-8" });
    const env: Record<string, string | undefined> = { ...process.env, TK_SUPERVISOR_DB: q.path };
    delete env.TK_SUPERVISOR_HOST_LEG; // this suite runs inside the host leg too, whose env sets both
    delete env.TK_VERIFY_BESIDE_LEG;
    const run = (extra: Record<string, string>) => spawnSync(process.execPath, ["test", "--timeout", "30000", probe], {
      cwd: REPO, env: { ...env, ...extra }, encoding: "utf-8", timeout: 60_000, windowsHide: true,
    });
    const refused = run({});
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("queue run q-live");
    expect(`${refused.stdout}${refused.stderr}`).not.toContain("PROBE RAN");
    const beside = run({ TK_VERIFY_BESIDE_LEG: "1" });
    expect(beside.status).toBe(0);
    expect(`${beside.stdout}${beside.stderr}`).toContain("PROBE RAN");
  }, 60_000);
});
