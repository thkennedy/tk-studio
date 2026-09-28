import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { studioOps, studioRunFinder } from "../src/cli";
import {
  defaultOwnerAlive, launchStatusProbe, ORPHANED_REASON, processStartTime, Queue, QueueDbMissing, QueueDbPlacementRefused,
  queueDbPath, REQUEUED_REASON, RunTerminal, selfOwner, type EngineProbe, type Owner, type Probes,
} from "../src/queue";

const REPO = resolve(import.meta.dir, "..");
const HOST = hostname();
const A: Owner = { pid: 910001, host: HOST, nonce: "nonce-a" };
const B: Owner = { pid: 910002, host: HOST, nonce: "nonce-b" };

/** Probes where only the pids in `alive` exist and the engine answers `engine`. */
function fakeProbes(alive: Set<number>, engine: (id: string | null) => EngineProbe = () => ({ live: false })) {
  const engineCalls: (string | null)[][] = [];
  const probes: Probes = {
    ownerAlive: (o) => alive.has(o.pid),
    engineLive: async (root, id) => { engineCalls.push([root, id]); return engine(id); },
  };
  return { probes, engineCalls };
}

function fixture(alive = new Set<number>([A.pid, B.pid]), engine?: (id: string | null) => EngineProbe) {
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-queue-"));
  const checkout = mkdtempSync(join(tmpdir(), "tk-sup-checkout-"));
  const { probes, engineCalls } = fakeProbes(alive, engine);
  const queue = new Queue(join(dir, "q.db"), probes);
  const enqueue = (jobId = "studio-health", owner: Owner | null = null, target = "skill", skill = "tk-studio-activate") =>
    queue.enqueue({ jobId, root: checkout, projectId: "p", target,
      definition: { id: jobId, trigger: "one-shot", target: target === "core" ? { core: "c" } : { skill } }, owner });
  return { dir, checkout, queue, enqueue, alive, engineCalls, db: join(dir, "q.db") };
}

const count = (q: Queue, table: string) => (q.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("queue database placement", () => {
  const safe = () => mkdtempSync(join(tmpdir(), "tk-sup-qpath-"));

  test("unset → QueueDbMissing", () => {
    expect(() => queueDbPath({})).toThrow(QueueDbMissing);
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: "  " })).toThrow(QueueDbMissing);
  });

  test("inside the store (TK_STUDIO_HOME) → refused, no file created", () => {
    const store = safe();
    const path = join(store, "sub", "q.db");
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: store })).toThrow(QueueDbPlacementRefused);
    expect(() => Queue.open({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: store })).toThrow(/studio store/);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(store, "sub"))).toBe(false);
  });

  test("inside the default store ~/.tk-studio when TK_STUDIO_HOME is unset → refused", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: join(home, ".tk-studio", "q.db") })).toThrow(/studio store/);
  });

  test("inside ~/.tk-studio even when TK_STUDIO_HOME points elsewhere → refused (the studio owns ~/.tk-studio)", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const path = join(home, ".tk-studio", "sub", "q.db");
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: safe() })).toThrow(QueueDbPlacementRefused);
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: safe() })).toThrow(/studio store/);
    // Case-folded where the file system is case-insensitive by default.
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: join(home, ".TK-Studio", "q.db"), TK_STUDIO_HOME: safe() }, "darwin"))
      .toThrow(/studio store/);
    expect(existsSync(join(home, ".tk-studio", "sub"))).toBe(false);
  });

  test("inside TK_STUDIO_ROOT → refused", () => {
    const root = safe();
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: join(root, "q.db"), TK_STUDIO_HOME: safe(), TK_STUDIO_ROOT: root }))
      .toThrow(/TK_STUDIO_ROOT/);
  });

  test("inside any git checkout (an ancestor holds .git) → refused, no file created", () => {
    const repo = safe();
    mkdirSync(join(repo, ".git"));
    const path = join(repo, "deep", "er", "q.db");
    expect(() => Queue.open({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: safe() })).toThrow(QueueDbPlacementRefused);
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: safe() })).toThrow(/git checkout/);
    expect(existsSync(join(repo, "deep"))).toBe(false);
    // This repository is itself a checkout.
    expect(() => queueDbPath({ TK_SUPERVISOR_DB: join(REPO, "q.db"), TK_STUDIO_HOME: safe() })).toThrow(/git checkout/);
  });

  test("outside all three → the path; the queue opens there", () => {
    const dir = safe();
    const path = join(dir, "q.db");
    expect(queueDbPath({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: safe() })).toBe(path);
    const q = Queue.open({ TK_SUPERVISOR_DB: path, TK_STUDIO_HOME: safe() });
    q.close();
    expect(existsSync(path)).toBe(true);
  });
});

describe("enqueue (idempotent mint)", () => {
  test("valid submission → one jobs row with the definition, one queued run, one event", () => {
    const fx = fixture();
    const { run, minted } = fx.enqueue();
    expect(minted).toBe(true);
    expect(run).toMatchObject({ job_id: "studio-health", state: "queued", project_id: "p", target: "skill", studio_run_id: null });
    expect(run.run_id).toMatch(/^q-studio-health-\d{8}T\d{6}Z-[0-9a-f]{6}$/);
    expect(count(fx.queue, "jobs")).toBe(1);
    expect(JSON.parse((fx.queue.db.query("SELECT definition FROM jobs").get() as { definition: string }).definition))
      .toEqual({ id: "studio-health", trigger: "one-shot", target: { skill: "tk-studio-activate" } });
    expect(count(fx.queue, "runs")).toBe(1);
    expect(fx.queue.events(run.run_id).map((e) => [e.kind, e.from_state, e.to_state])).toEqual([["enqueued", null, "queued"]]);
  });

  test("a second enqueue while queued or running mints nothing and answers that run", async () => {
    const fx = fixture();
    const first = fx.enqueue("j", A);
    const again = fx.enqueue("j", B);
    expect(again).toMatchObject({ minted: false, run: { run_id: first.run.run_id } });
    await fx.queue.claim(first.run.run_id, A);
    expect(fx.enqueue("j").minted).toBe(false);
    expect(count(fx.queue, "runs")).toBe(1);
    expect(fx.queue.events().length).toBe(2); // enqueued + claimed; adoption is not a transition
    // Terminal → the next enqueue mints a fresh run.
    fx.queue.end(first.run.run_id, "complete");
    const next = fx.enqueue("j");
    expect(next.minted).toBe(true);
    expect(next.run.run_id).not.toBe(first.run.run_id);
  });

  test("racing processes on one db file → exactly one run minted; every caller gets its id", async () => {
    const fx = fixture();
    fx.queue.close();
    const script = join(fx.dir, "enqueue.ts");
    writeFileSync(script, `
import { Queue } from ${JSON.stringify(join(REPO, "src", "queue.ts"))};
const [db, root, startAt] = process.argv.slice(2);
const q = new Queue(db);
while (Date.now() < Number(startAt)) { /* line up with the other racers */ }
const { run, minted } = q.enqueue({ jobId: "racer", root, projectId: "p", target: "skill", definition: { id: "racer" } });
console.log(JSON.stringify({ run_id: run.run_id, minted }));
q.close();
`);
    const startAt = Date.now() + 1500;
    const procs = Array.from({ length: 6 }, () =>
      Bun.spawn(["bun", script, fx.db, fx.checkout, String(startAt)], { stdout: "pipe", stderr: "pipe" }));
    const outs = await Promise.all(procs.map(async (p) => {
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      if (code !== 0) throw new Error(`racer exited ${code}: ${err}`);
      return JSON.parse(out.trim()) as { run_id: string; minted: boolean };
    }));
    const q = new Queue(fx.db, fakeProbes(new Set()).probes);
    expect(count(q, "runs")).toBe(1);
    const id = q.runs()[0].run_id;
    expect(outs.every((o) => o.run_id === id)).toBe(true);
    expect(outs.filter((o) => o.minted)).toHaveLength(1);
    expect(q.events(id).map((e) => e.kind)).toEqual(["enqueued"]);
    q.close();
  }, 60_000);

  test("permission_mode round-trips: stored on mint, recorded on an adopted queued run, kept through a lock wait and a re-queue", async () => {
    const fx = fixture(new Set([A.pid, B.pid]));
    const def = { id: "j", trigger: "one-shot", target: { skill: "tk-studio-activate" } };
    // No explicit mode → null (the default applies when driven).
    const plain = fx.queue.enqueue({ jobId: "j", root: fx.checkout, definition: def }).run;
    expect(plain.permission_mode).toBeNull();
    expect(fx.queue.events(plain.run_id)[0].detail).toBeNull();
    // Adopting the queued run with an explicit mode records it, with an event; the same mode again writes nothing.
    const adopted = fx.queue.enqueue({ jobId: "j", root: fx.checkout, definition: def, permissionMode: "plan" });
    expect(adopted).toMatchObject({ minted: false, run: { run_id: plain.run_id, permission_mode: "plan" } });
    fx.queue.enqueue({ jobId: "j", root: fx.checkout, definition: def, permissionMode: "plan" });
    expect(fx.queue.events(plain.run_id).map((e) => [e.kind, e.to_state, e.detail])).toEqual([
      ["enqueued", "queued", null], ["permission-mode", "queued", { permission_mode: "plan", previous: null }],
    ]);
    // Re-read from the file: the column persists.
    fx.queue.close();
    const q = new Queue(fx.db, fakeProbes(new Set([A.pid])).probes);
    try {
      expect(q.get(plain.run_id)!.permission_mode).toBe("plan");
      q.end(plain.run_id, "cancelled");
      // Minted with a mode: stored and named in the enqueued event.
      const minted = q.enqueue({ jobId: "j", root: fx.checkout, definition: def, owner: A, permissionMode: "acceptEdits" }).run;
      expect(minted.permission_mode).toBe("acceptEdits");
      expect(q.events(minted.run_id)[0].detail).toMatchObject({ permission_mode: "acceptEdits" });
      // A running run keeps the mode it is driven under: neither enqueue nor recordPermissionMode rewrites it.
      await q.claim(minted.run_id, A);
      q.enqueue({ jobId: "j", root: fx.checkout, definition: def, permissionMode: "plan" });
      expect(q.recordPermissionMode(minted.run_id, "plan").permission_mode).toBe("acceptEdits");
      // The owner dies before the verb: re-queued with its mode intact.
      const restarted = new Queue(fx.db, fakeProbes(new Set()).probes);
      try {
        const rec = await restarted.recover({
          end: async () => ({ ok: true, detail: "" }), find: async () => ({ ok: true, run_id: null }),
        }, B);
        expect(rec.requeued).toEqual([minted.run_id]);
      } finally { restarted.close(); }
      expect(q.get(minted.run_id)).toMatchObject({ state: "queued", permission_mode: "acceptEdits" });
    } finally { q.close(); }
  });

  test("tier/sandbox/model/effort round-trip: stored on mint, recorded on a queued run with one run-options event, kept once running", async () => {
    const fx = fixture(new Set([A.pid, B.pid]));
    const def = { id: "j", trigger: "one-shot", target: { skill: "tk-studio-activate" } };
    const plain = fx.queue.enqueue({ jobId: "j", root: fx.checkout, definition: def }).run;
    expect(plain).toMatchObject({ tier: null, sandbox: null, model: null, effort: null });
    // Adopting with options records the changed ones in one event; the same options again write nothing.
    const opts = { tier: "sbx", sandbox: "claude-p", model: "m-1", effort: "high" };
    expect(fx.queue.enqueue({ jobId: "j", root: fx.checkout, definition: def, ...opts }).run).toMatchObject({ run_id: plain.run_id, ...opts });
    fx.queue.recordRunOptions(plain.run_id, opts);
    fx.queue.recordRunOptions(plain.run_id, { model: "m-2" });
    expect(fx.queue.events(plain.run_id).map((e) => [e.kind, e.detail])).toEqual([
      ["enqueued", null],
      ["run-options", { ...opts, previous: { tier: null, sandbox: null, model: null, effort: null } }],
      ["run-options", { model: "m-2", previous: { model: "m-1" } }],
    ]);
    fx.queue.close();
    const q = new Queue(fx.db, fakeProbes(new Set([A.pid])).probes);
    try {
      expect(q.get(plain.run_id)).toMatchObject({ tier: "sbx", sandbox: "claude-p", model: "m-2", effort: "high" });
      q.end(plain.run_id, "cancelled");
      const minted = q.enqueue({ jobId: "j", root: fx.checkout, definition: def, owner: A, tier: "host" }).run;
      expect(minted).toMatchObject({ tier: "host", sandbox: null });
      expect(q.events(minted.run_id)[0].detail).toMatchObject({ tier: "host" });
      // A running run keeps the options it is driven under.
      await q.claim(minted.run_id, A);
      expect(q.recordRunOptions(minted.run_id, { tier: "sbx", sandbox: "s" })).toMatchObject({ tier: "host", sandbox: null });
    } finally { q.close(); }
  });

  test("an old-schema queue file gains the new nullable run columns on open (guarded ALTER), rows intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-queue-old-"));
    const path = join(dir, "q.db");
    const old = new Database(path, { create: true });
    old.exec(`CREATE TABLE jobs (job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL, project_id TEXT,
        definition TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (job_id, checkout));
      CREATE TABLE runs (run_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, checkout TEXT NOT NULL, root TEXT NOT NULL,
        project_id TEXT, target TEXT,
        state TEXT NOT NULL CHECK (state IN ('queued','running','complete','partial','blocked','cancelled')),
        reason TEXT, owner_pid INTEGER, owner_host TEXT, owner_nonce TEXT, owner_start TEXT,
        studio_run_id TEXT, engine_run_id TEXT, verb_started TEXT, verb_snapshot TEXT, definition TEXT,
        created TEXT NOT NULL, updated TEXT NOT NULL, FOREIGN KEY (job_id, checkout) REFERENCES jobs (job_id, checkout));
      INSERT INTO jobs VALUES ('j', '/x', '/x', NULL, '{}', 't', 't');
      INSERT INTO runs (run_id, job_id, checkout, root, state, created, updated) VALUES ('q-old', 'j', '/x', '/x', 'queued', 't', 't');`);
    old.close();
    for (let i = 0; i < 2; i++) { // idempotent: a second open adds nothing
      const q = new Queue(path, fakeProbes(new Set()).probes);
      try {
        const cols = (q.db.query("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
        for (const c of ["permission_mode", "tier", "sandbox", "model", "effort", "session_id", "worker_pid", "worker_start", "wake"]) {
          expect(cols.filter((n) => n === c)).toHaveLength(1);
        }
        const types = Object.fromEntries((q.db.query("PRAGMA table_info(runs)").all() as { name: string; type: string }[]).map((c) => [c.name, c.type]));
        expect(types.worker_pid).toBe("INTEGER");
        expect(q.get("q-old")).toMatchObject({
          state: "queued", permission_mode: null, tier: null, sandbox: null, model: null, effort: null,
          session_id: null, worker_pid: null, worker_start: null, wake: null,
        });
      } finally { q.close(); }
    }
  });
});

describe("transitions", () => {
  test("one events row per transition: enqueued, claimed, studio-run, ended", async () => {
    const fx = fixture();
    const { run } = fx.enqueue("j", A);
    expect((await fx.queue.claim(run.run_id, A)).claimed).toBe(true);
    fx.queue.setStudioRun(run.run_id, "j-20260928T101010Z");
    fx.queue.end(run.run_id, "complete", null);
    expect(fx.queue.events(run.run_id).map((e) => [e.kind, e.from_state, e.to_state])).toEqual([
      ["enqueued", null, "queued"], ["claimed", "queued", "running"],
      ["studio-run", "running", "running"], ["ended", "running", "complete"],
    ]);
    expect(fx.queue.get(run.run_id)).toMatchObject({ state: "complete", studio_run_id: "j-20260928T101010Z", owner_pid: null });
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("terminal runs are immutable — through the API and at the table", async () => {
    const fx = fixture();
    const { run } = fx.enqueue("j", A);
    await fx.queue.claim(run.run_id, A);
    fx.queue.end(run.run_id, "blocked", "boom");
    const events = fx.queue.events(run.run_id).length;
    expect(() => fx.queue.end(run.run_id, "complete")).toThrow(RunTerminal);
    expect(() => fx.queue.setStudioRun(run.run_id, "x")).toThrow(RunTerminal);
    expect(() => fx.queue.db.run("UPDATE runs SET state = 'queued' WHERE run_id = ?", [run.run_id])).toThrow(/immutable/);
    expect((await fx.queue.claim(run.run_id, B))).toMatchObject({ claimed: false, why: "terminal" });
    expect(fx.queue.get(run.run_id)).toMatchObject({ state: "blocked", reason: "boom" });
    expect(fx.queue.events(run.run_id)).toHaveLength(events);
  });

  test("end({ from }) refuses a run no longer in that state; end without `from` is unchanged", async () => {
    const fx = fixture();
    const { run } = fx.enqueue("j", A);
    await fx.queue.claim(run.run_id, A);
    const before = fx.queue.events(run.run_id);
    expect(() => fx.queue.end(run.run_id, "blocked", "resolve: refused", { from: "queued" })).toThrow(/is running, not queued/);
    expect(fx.queue.get(run.run_id)).toMatchObject({ state: "running", owner_nonce: A.nonce, reason: null });
    expect(fx.queue.events(run.run_id)).toEqual(before);
    expect(fx.queue.events(run.run_id).some((e) => e.kind === "ended")).toBe(false);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "run", run_id: run.run_id });
    // Without `from`: ends as before, lock released, one `ended` event.
    fx.queue.end(run.run_id, "blocked", "boom");
    expect(fx.queue.get(run.run_id)).toMatchObject({ state: "blocked", reason: "boom", owner_pid: null });
    expect(fx.queue.events(run.run_id).filter((e) => e.kind === "ended")).toMatchObject([{ from_state: "running", to_state: "blocked" }]);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("a failed transaction leaves neither the state change nor its event (failure after the run UPDATE)", async () => {
    const fx = fixture();
    const { run } = fx.enqueue("j", A);
    await fx.queue.claim(run.run_id, A);
    const other = fx.queue.enqueue({ jobId: "k", root: mkdtempSync(join(tmpdir(), "tk-sup-checkout-")), definition: { id: "k" }, owner: A }).run;
    const [runBefore, otherBefore, lockBefore, eventsBefore] =
      [fx.queue.get(run.run_id), fx.queue.get(other.run_id), fx.queue.lock(fx.checkout), fx.queue.events()];
    // The events INSERT fails inside the transaction, after the run UPDATE (and the lock change) already ran.
    fx.queue.db.run("CREATE TEMP TRIGGER events_refused BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test: events refused'); END");
    expect(() => fx.queue.end(run.run_id, "blocked", "boom")).toThrow(/events refused/);
    expect(() => fx.queue.setStudioRun(run.run_id, "j-20260928T101010Z")).toThrow(/events refused/);
    await expect(fx.queue.claim(other.run_id, A)).rejects.toThrow(/events refused/);
    expect(fx.queue.get(run.run_id)).toEqual(runBefore);
    expect(fx.queue.get(other.run_id)).toEqual(otherBefore);
    expect(fx.queue.lock(fx.checkout)).toEqual(lockBefore);
    expect(fx.queue.lock(other.root)).toBeNull();
    expect(fx.queue.events()).toEqual(eventsBefore);
    // Without the trigger the same transitions commit.
    fx.queue.db.run("DROP TRIGGER events_refused");
    expect(fx.queue.end(run.run_id, "blocked", "boom")).toMatchObject({ state: "blocked" });
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });
});

describe("checkout lock", () => {
  test("held by a running run with a live owner → the second run stays queued naming it; release frees it", async () => {
    const fx = fixture();
    const a = fx.enqueue("job-a", A).run;
    expect((await fx.queue.claim(a.run_id, A)).claimed).toBe(true);
    const b = fx.enqueue("job-b", B).run;
    const wait = await fx.queue.claim(b.run_id, B);
    expect(wait).toMatchObject({ claimed: false, why: "lock", holder: { kind: "run", run_id: a.run_id, job_id: "job-a", pid: A.pid } });
    if (wait.claimed) throw new Error("unreachable");
    for (const s of [wait.reason, fx.queue.get(b.run_id)!.reason!]) {
      expect(s).toContain(a.run_id);
      expect(s).toContain("job-a");
      expect(s).toContain(String(A.pid));
    }
    expect(fx.queue.get(b.run_id)).toMatchObject({ state: "queued", owner_pid: null });
    expect(fx.queue.events(b.run_id).at(-1)).toMatchObject({ kind: "lock-wait", from_state: "queued", to_state: "queued" });

    fx.queue.end(a.run_id, "complete");
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    const again = await fx.queue.claim(b.run_id, B);
    expect(again.claimed).toBe(true);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "run", run_id: b.run_id, owner_pid: B.pid });
  });

  test("a running run under another live owner is answered, not claimed", async () => {
    const fx = fixture();
    const a = fx.enqueue("j", A).run;
    await fx.queue.claim(a.run_id, A);
    const again = fx.enqueue("j", B);
    expect(again.minted).toBe(false);
    expect(await fx.queue.claim(again.run.run_id, B)).toMatchObject({ claimed: false, why: "running", run: { state: "running" } });
  });

  test("a lock whose holder's owner died is stale: the claim takes it and names the release", async () => {
    const fx = fixture();
    const a = fx.enqueue("job-a", A).run;
    await fx.queue.claim(a.run_id, A);
    fx.alive.delete(A.pid);
    const b = fx.enqueue("job-b", B).run;
    expect((await fx.queue.claim(b.run_id, B)).claimed).toBe(true);
    expect(fx.queue.events(b.run_id).at(-1)!.detail).toMatchObject({ released: { kind: "run", run_id: a.run_id } });
  });

  describe("engine holder (a detached bmad-loop engine a tk-studio-launch run started)", () => {
    async function launched(engine: (id: string | null) => EngineProbe) {
      const fx = fixture(new Set([A.pid, B.pid]), engine);
      const l = fx.enqueue("run-epic", A).run;
      await fx.queue.claim(l.run_id, A);
      fx.queue.setStudioRun(l.run_id, "run-epic-20260928T101010Z");
      fx.queue.end(l.run_id, "complete", null, { engineRunId: "20260928-101500-ab12" });
      return { fx, l };
    }

    test("the finished launch run hands the lock to the engine", async () => {
      const { fx, l } = await launched(() => ({ live: true }));
      expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "20260928-101500-ab12", run_id: l.run_id });
      expect(fx.queue.get(l.run_id)).toMatchObject({ state: "complete", engine_run_id: "20260928-101500-ab12" });
      expect(fx.queue.events(l.run_id).at(-1)!.detail).toMatchObject({ lock: { handed_to_engine: "20260928-101500-ab12" } });
    });

    test("engine live → a new run waits queued naming engine E", async () => {
      const { fx, l } = await launched(() => ({ live: true }));
      const b = fx.enqueue("studio-health", B).run;
      const wait = await fx.queue.claim(b.run_id, B);
      expect(wait).toMatchObject({ claimed: false, why: "lock", holder: { kind: "engine", engine_run_id: "20260928-101500-ab12", run_id: l.run_id } });
      expect(fx.queue.get(b.run_id)!.reason).toContain("bmad-loop engine 20260928-101500-ab12");
      expect(fx.engineCalls).toEqual([[fx.checkout, "20260928-101500-ab12"]]);
    });

    test("engine no longer live → the lock is free", async () => {
      const { fx } = await launched(() => ({ live: false }));
      const b = fx.enqueue("studio-health", B).run;
      expect((await fx.queue.claim(b.run_id, B)).claimed).toBe(true);
      expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "run", run_id: b.run_id });
      expect(fx.queue.events(b.run_id).at(-1)!.detail).toMatchObject({ released: { kind: "engine", engine_run_id: "20260928-101500-ab12" } });
    });

    test("a failed status probe counts as live (fail closed) and is named", async () => {
      const { fx } = await launched(() => ({ live: true, detail: "launch status probe failed (exit 1): bmad-loop list failed" }));
      const b = fx.enqueue("studio-health", B).run;
      const wait = await fx.queue.claim(b.run_id, B);
      expect(wait.claimed).toBe(false);
      const reason = fx.queue.get(b.run_id)!.reason!;
      expect(reason).toContain("20260928-101500-ab12");
      expect(reason).toContain("launch status probe failed");
      expect(reason).toContain("counted live");
    });
  });
});

describe("restart recovery", () => {
  type Call = string[];
  /** A fake §4 verb runner: `status` answers `state` for every run; the ending verbs answer `ending(args)`. */
  function verbs(state: string, ending: (args: string[]) => Record<string, any> = (a) => a[0] === "cancel"
    ? { cancelled: true, runs_ended: [a[a.indexOf("--run-id") + 1]] } : { run_id: a[a.indexOf("--run-id") + 1], state: "partial" }) {
    const calls: Call[] = [];
    const runner = async (_root: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "status") return { job_id: "j", runs: [{ run_id: args[args.indexOf("--run-id") + 1], state }] };
      return ending(args);
    };
    return { calls, runner };
  }

  async function started(target: "skill" | "core") {
    const fx = fixture();
    const r = fx.enqueue("j", A, target).run;
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, "j-20260928T101010Z");
    fx.alive.delete(A.pid); // the supervisor died
    return { fx, r };
  }

  test("running orphan with a studio run (skill) → partial `orphaned: supervisor restart`; studio run finished partial; lock released", async () => {
    const { fx, r } = await started("skill");
    const { calls, runner } = verbs("queued");
    const report = await fx.queue.recover(studioOps(runner), B);
    expect(report.ended.map((e) => e.run_id)).toEqual([r.run_id]);
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "partial", reason: ORPHANED_REASON, owner_pid: null });
    const finish = calls.find((c) => c[0] === "finish")!;
    expect(finish).toEqual(["finish", "--directory", fx.checkout, "--run-id", "j-20260928T101010Z", "--state", "partial", "--reason", ORPHANED_REASON]);
    expect(calls.some((c) => c[0] === "cancel")).toBe(false);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    expect(fx.queue.events(r.run_id).at(-1)).toMatchObject({ kind: "orphaned", from_state: "running", to_state: "partial", detail: { studio: { ok: true } } });
  });

  test("running orphan (core) → the studio run is cancelled, never finished", async () => {
    const { fx, r } = await started("core");
    const { calls, runner } = verbs("running");
    await fx.queue.recover(studioOps(runner), B);
    expect(fx.queue.get(r.run_id)!.state).toBe("partial");
    expect(calls.find((c) => c[0] === "cancel")).toEqual(["cancel", "--directory", fx.checkout, "--job-id", "j", "--run-id", "j-20260928T101010Z"]);
    expect(calls.some((c) => c[0] === "finish")).toBe(false);
  });

  test("a failed studio call is recorded in the event; the queue run still ends", async () => {
    const { fx, r } = await started("skill");
    const { runner } = verbs("running", () => ({ ok: false, error: "store locked" }));
    await fx.queue.recover(studioOps(runner), B);
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "partial", reason: ORPHANED_REASON });
    const ev = fx.queue.events(r.run_id).at(-1)!;
    expect(ev.detail).toMatchObject({ studio: { ok: false } });
    expect(JSON.stringify(ev.detail)).toContain("store locked");
  });

  test("a studio run already terminal is not ended again", async () => {
    const { fx, r } = await started("skill");
    const { calls, runner } = verbs("complete");
    await fx.queue.recover(studioOps(runner), B);
    expect(fx.queue.get(r.run_id)!.state).toBe("partial");
    expect(calls.map((c) => c[0])).toEqual(["status"]);
  });

  test("never started: queued with a dead owner, and running with no studio run → re-queued, lock released", async () => {
    const fx = fixture();
    const q = fx.enqueue("job-q", A).run;
    const other = mkdtempSync(join(tmpdir(), "tk-sup-checkout-"));
    const r = fx.queue.enqueue({ jobId: "job-r", root: other, definition: { id: "job-r" }, owner: A }).run;
    await fx.queue.claim(r.run_id, A);
    fx.alive.delete(A.pid);
    const { calls, runner } = verbs("running");
    const report = await fx.queue.recover(studioOps(runner), B);
    expect(report.requeued.sort()).toEqual([q.run_id, r.run_id].sort());
    expect(report.ended).toEqual([]);
    expect(calls).toEqual([]);
    for (const id of [q.run_id, r.run_id]) {
      expect(fx.queue.get(id)).toMatchObject({ state: "queued", owner_pid: null, reason: REQUEUED_REASON });
      expect(fx.queue.events(id).at(-1)).toMatchObject({ kind: "requeued", to_state: "queued" });
    }
    expect(fx.queue.lock(other)).toBeNull();
    // Re-claimable later.
    expect((await fx.queue.claim(r.run_id, B)).claimed).toBe(true);
  });

  test("live owners and ownerless queued runs are left alone", async () => {
    const fx = fixture();
    const live = fx.enqueue("job-live", A).run;
    await fx.queue.claim(live.run_id, A);
    const submitted = fx.enqueue("job-submitted", null).run;
    const report = await fx.queue.recover(studioOps(verbs("running").runner), B);
    expect(report).toEqual({ ended: [], requeued: [], resumed: [] });
    expect(fx.queue.get(live.run_id)!.state).toBe("running");
    expect(fx.queue.get(submitted.run_id)!.state).toBe("queued");
  });
});

/** A studio run id `<job>-<YYYYMMDDTHHMMSSZ>` for time `ms`. */
const studioId = (job: string, ms: number) => `${job}-${new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;

describe("restart recovery: the verb_started rule", () => {
  /** A fake §4 verb runner for the lookup: job-level `status` lists `runs`
   * (or fails when `runs` is an Error); ending verbs succeed. */
  function lookupVerbs(runs: { run_id: string; state: string }[] | Error) {
    const calls: string[][] = [];
    const runner = async (_root: string, args: string[]) => {
      calls.push(args);
      if (args[0] === "status") {
        if (runs instanceof Error) return { ok: false, error: runs.message };
        const id = args.includes("--run-id") ? args[args.indexOf("--run-id") + 1] : undefined;
        return { job_id: "j", runs: id ? runs.filter((r) => r.run_id === id) : runs };
      }
      if (args[0] === "cancel") return { cancelled: true, runs_ended: [args[args.indexOf("--run-id") + 1]] };
      return { run_id: args[args.indexOf("--run-id") + 1], state: "partial" };
    };
    return { calls, runner };
  }

  /** A run that reached the minting verb (snapshot `before`), then its supervisor died. */
  async function verbStarted(before: string[], target: "skill" | "core" = "skill") {
    const fx = fixture();
    const r = fx.enqueue("j", A, target).run;
    await fx.queue.claim(r.run_id, A);
    fx.queue.markVerbStarted(r.run_id, "submit", before);
    fx.alive.delete(A.pid);
    return { fx, r };
  }

  test("markVerbStarted stores the time and the snapshot with one event", async () => {
    const { fx, r } = await verbStarted(["j-20260101T000000Z"]);
    const run = fx.queue.get(r.run_id)!;
    expect(run.verb_started).toBeString();
    expect(JSON.parse(run.verb_snapshot!)).toEqual(["j-20260101T000000Z"]);
    expect(fx.queue.events(r.run_id).at(-1)).toMatchObject({
      kind: "verb-started", from_state: "running", to_state: "running", detail: { verb: "submit", snapshot: ["j-20260101T000000Z"] },
    });
  });

  test("found: a studio run absent from the snapshot is recorded, then both are ended", async () => {
    const { fx, r } = await verbStarted(["j-20260101T000000Z"]);
    const minted = studioId("j", Date.now() + 1000);
    const { calls, runner } = lookupVerbs([
      { run_id: "j-20260101T000000Z", state: "complete" }, { run_id: minted, state: "running" },
    ]);
    const report = await fx.queue.recover(studioOps(runner), B);
    expect(report.requeued).toEqual([]);
    expect(report.ended).toMatchObject([{ run_id: r.run_id, studio_run_id: minted, studio: { ok: true } }]);
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "partial", reason: ORPHANED_REASON, studio_run_id: minted });
    expect(calls.find((c) => c[0] === "finish")).toEqual([
      "finish", "--directory", fx.checkout, "--run-id", minted, "--state", "partial", "--reason", ORPHANED_REASON,
    ]);
    expect(fx.queue.events(r.run_id).at(-1)).toMatchObject({
      kind: "orphaned", to_state: "partial", detail: { studio_run_id: minted, lookup: { ok: true, adopted: minted } },
    });
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("not found (lookup ok): re-queued, verb_started cleared, nothing ended", async () => {
    const { fx, r } = await verbStarted(["j-20260101T000000Z"]);
    const { calls, runner } = lookupVerbs([{ run_id: "j-20260101T000000Z", state: "complete" }]);
    const report = await fx.queue.recover(studioOps(runner), B);
    expect(report).toEqual({ ended: [], requeued: [r.run_id], resumed: [] });
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "queued", reason: REQUEUED_REASON, owner_nonce: null, verb_started: null, verb_snapshot: null });
    expect(calls.map((c) => c[0])).toEqual(["status"]);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("lookup failed: ended partial naming the failed lookup — never re-queued", async () => {
    const { fx, r } = await verbStarted([]);
    const { calls, runner } = lookupVerbs(new Error("store unreadable"));
    const report = await fx.queue.recover(studioOps(runner), B);
    expect(report.requeued).toEqual([]);
    expect(report.ended).toMatchObject([{ run_id: r.run_id, studio_run_id: null, studio: null }]);
    const run = fx.queue.get(r.run_id)!;
    expect(run.state).toBe("partial");
    expect(run.reason).toStartWith(ORPHANED_REASON);
    expect(run.reason).toContain("studio run lookup failed");
    expect(run.reason).toContain("store unreadable");
    expect(calls.map((c) => c[0])).toEqual(["status"]); // no studio run to end
    expect(fx.queue.events(r.run_id).at(-1)).toMatchObject({ kind: "orphaned", detail: { lookup: { ok: false } } });
  });

  test("studioRunFinder: the EARLIEST absent run minted at/after verb_started — not a later foreign one", async () => {
    const run = { root: "/r", job_id: "j", verb_started: "2026-09-28T10:10:10.500Z" } as never;
    const find = (runs: string[], snapshot: string[] = []) =>
      studioRunFinder(lookupVerbs(runs.map((run_id) => ({ run_id, state: "queued" }))).runner)(run, snapshot);
    // Two absent candidates: ours (minted in the verb's second) and a foreign one minted during the downtime.
    expect(await find(["j-20260928T111500Z", "j-20260928T101010Z"])).toEqual({ ok: true, run_id: "j-20260928T101010Z" });
    // Same second: the collision suffix orders them (no suffix = 1).
    expect(await find(["j-20260928T101011Z-2", "j-20260928T101011Z"])).toEqual({ ok: true, run_id: "j-20260928T101011Z" });
    // A run minted before verb_started is never ours; in the snapshot, never a candidate.
    expect(await find(["j-20260928T101009Z"])).toEqual({ ok: true, run_id: null });
    expect(await find(["j-20260928T101010Z"], ["j-20260928T101010Z"])).toEqual({ ok: true, run_id: null });
    // An absent id whose mint time cannot be read: ambiguous → a failed lookup.
    expect(await find(["j-20260928T101010Z", "j-weird"])).toMatchObject({ ok: false, detail: expect.stringContaining("ambiguous") });
    const boom = await studioRunFinder(async () => { throw new Error("uv timed out"); })(run, []);
    expect(boom).toMatchObject({ ok: false });
  });
});

describe("restart recovery: owner identity", () => {
  test("a same-pid restart (new nonce) recovers the dead predecessor's runs even though the pid is alive", async () => {
    const fx = fixture(new Set([A.pid, B.pid]));
    const old: Owner = { pid: A.pid, host: HOST, nonce: "old-process" };
    const restarted: Owner = { pid: A.pid, host: HOST, nonce: "new-process" };
    const r = fx.enqueue("j", old).run;
    await fx.queue.claim(r.run_id, old);
    fx.queue.setStudioRun(r.run_id, "j-20260928T101010Z");
    const q = fx.queue.enqueue({ jobId: "k", root: mkdtempSync(join(tmpdir(), "tk-sup-checkout-")), definition: { id: "k" }, owner: old }).run;
    const report = await fx.queue.recover(studioOps(async (_r, a) => a[0] === "status"
      ? { runs: [{ run_id: "j-20260928T101010Z", state: "running" }] } : { state: "partial" }), restarted);
    expect(report.ended.map((e) => e.run_id)).toEqual([r.run_id]);
    expect(report.requeued).toEqual([q.run_id]);
    // Another live pid is left alone; my own nonce is never an orphan.
    const live = fx.enqueue("m", B).run;
    const mine = fx.queue.enqueue({ jobId: "n", root: mkdtempSync(join(tmpdir(), "tk-sup-checkout-")), definition: { id: "n" }, owner: restarted }).run;
    expect(await fx.queue.recover(studioOps(async () => ({})), restarted)).toEqual({ ended: [], requeued: [], resumed: [] });
    expect(fx.queue.get(live.run_id)!.owner_nonce).toBe(B.nonce);
    expect(fx.queue.get(mine.run_id)!.owner_nonce).toBe("new-process");
  });

  test("claim: a queued run is mine by nonce, not by pid", async () => {
    const fx = fixture(new Set([A.pid]));
    const r = fx.enqueue("j", A).run;
    // Same pid, different nonce and alive: treated as my dead predecessor, so claimable.
    expect((await fx.queue.claim(r.run_id, { ...A, nonce: "other" })).claimed).toBe(true);
  });

  describe.skipIf(process.platform !== "linux")("process start time (Linux /proc/<pid>/stat field 22)", () => {
    test("a live pid matches only its own start time; a reused pid is not the owner", async () => {
      const child = Bun.spawn(["sleep", "30"]);
      try {
        const start = processStartTime(child.pid);
        expect(start).toMatch(/^\d+$/);
        const owner: Owner = { pid: child.pid, host: HOST, nonce: "n", start };
        expect(defaultOwnerAlive(owner)).toBe(true);
        expect(defaultOwnerAlive({ ...owner, start: "1" })).toBe(false); // the pid was reused by another process
        expect(defaultOwnerAlive({ ...owner, start: null })).toBe(true); // no start recorded: the pid decides
        expect(defaultOwnerAlive({ ...owner, host: `${HOST}-elsewhere` })).toBe(true); // another host: fail closed

        // At the queue: the reused-pid owner is an orphan; the real one is not.
        const dir = mkdtempSync(join(tmpdir(), "tk-sup-queue-"));
        const queue = new Queue(join(dir, "q.db"), { ownerAlive: defaultOwnerAlive, engineLive: async () => ({ live: false }) });
        const root = mkdtempSync(join(tmpdir(), "tk-sup-checkout-"));
        const reused = queue.enqueue({ jobId: "reused", root, definition: { id: "reused" }, owner: { ...owner, nonce: "r", start: "1" } }).run;
        const real = queue.enqueue({ jobId: "real", root, definition: { id: "real" }, owner }).run;
        const report = await queue.recover(studioOps(async () => ({})), B);
        expect(report.requeued).toEqual([reused.run_id]);
        expect(queue.get(real.run_id)!.owner_pid).toBe(child.pid);
      } finally { child.kill(); await child.exited; }
      expect(defaultOwnerAlive({ pid: child.pid, host: HOST, nonce: "n" })).toBe(false); // dead
    });

    test("selfOwner carries this process's start time and one nonce per process", () => {
      expect(selfOwner()).toMatchObject({ pid: process.pid, host: HOST, start: processStartTime(process.pid) });
      expect(selfOwner().nonce).toBe(selfOwner().nonce);
    });
  });
});

describe("restart recovery: the launch-orphan engine handover", () => {
  /** A running tk-studio-launch run with a studio run whose supervisor died. */
  async function launchOrphan(engine: (id: string | null) => EngineProbe) {
    const fx = fixture(new Set([A.pid, B.pid]), engine);
    const r = fx.enqueue("run-epic", A, "skill", "tk-studio-launch").run;
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, "run-epic-20260928T101010Z");
    fx.alive.delete(A.pid);
    const ops = studioOps(async (_r, a) => a[0] === "status" ? { runs: [{ run_id: "run-epic-20260928T101010Z", state: "running" }] } : { state: "partial" });
    return { fx, r, ops };
  }

  test("live[] non-empty → the lock passes to that engine (event names it); a new run waits naming it", async () => {
    const { fx, r, ops } = await launchOrphan(() => ({ live: true, run_ids: ["E1"] }));
    const report = await fx.queue.recover(ops, B);
    expect(fx.engineCalls[0]).toEqual([fx.checkout, null]);
    expect(report.ended[0]).toMatchObject({ run_id: r.run_id, engine: { handed_to_engine: "E1" } });
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "partial", reason: ORPHANED_REASON, engine_run_id: "E1" });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "E1", run_id: r.run_id });
    expect(fx.queue.events(r.run_id).at(-1)!.detail).toMatchObject({ lock: { handed_to_engine: "E1" }, engine: { live: ["E1"] } });
    const b = fx.enqueue("studio-health", B).run;
    const wait = await fx.queue.claim(b.run_id, B);
    expect(wait).toMatchObject({ claimed: false, why: "lock", holder: { kind: "engine", engine_run_id: "E1" } });
    expect(fx.engineCalls.at(-1)).toEqual([fx.checkout, "E1"]);
  });

  test("a failed probe → an unverified engine holds the lock; a claim re-probes: failed or non-empty live[] waits, empty frees", async () => {
    let answer: EngineProbe = { live: true, detail: "launch status probe failed (exit 1): boom" };
    const { fx, r, ops } = await launchOrphan(() => answer);
    await fx.queue.recover(ops, B);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: null, run_id: r.run_id });
    expect(fx.queue.events(r.run_id).at(-1)!.detail).toMatchObject({ lock: { handed_to_engine: "unverified" }, engine: { detail: answer.detail } });

    const b = fx.enqueue("studio-health", B).run;
    const failed = await fx.queue.claim(b.run_id, B);
    expect(failed).toMatchObject({ claimed: false, holder: { kind: "engine", engine_run_id: null } });
    if (failed.claimed) throw new Error("unreachable");
    expect(failed.reason).toContain("unverified bmad-loop engine");
    expect(failed.reason).toContain("boom");
    expect(fx.engineCalls.at(-1)).toEqual([fx.checkout, null]);

    answer = { live: true, run_ids: ["E7"] };
    expect(await fx.queue.claim(b.run_id, B)).toMatchObject({ claimed: false, holder: { engine_run_id: "E7" } });

    answer = { live: false, run_ids: [] };
    expect((await fx.queue.claim(b.run_id, B)).claimed).toBe(true);
    expect(fx.queue.events(b.run_id).at(-1)!.detail).toMatchObject({ released: { kind: "engine", engine_run_id: null } });
  });

  test("no engine live → the lock is released as for any orphan", async () => {
    const { fx, r, ops } = await launchOrphan(() => ({ live: false, run_ids: [] }));
    await fx.queue.recover(ops, B);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "partial", engine_run_id: null });
  });

  test("a non-launch orphan never probes the engine", async () => {
    const fx = fixture(new Set([A.pid]), () => ({ live: true }));
    const r = fx.enqueue("j", A).run;
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, "j-1");
    fx.alive.delete(A.pid);
    await fx.queue.recover(studioOps(async (_r, a) => a[0] === "status" ? { runs: [{ run_id: "j-1", state: "complete" }] } : {}), B);
    expect(fx.engineCalls).toEqual([]);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });
});

describe("drainable", () => {
  test("queued runs with no owner or a dead owner, oldest first; live-owned and running runs excluded", async () => {
    const fx = fixture(new Set([B.pid]));
    const roots = Array.from({ length: 5 }, () => mkdtempSync(join(tmpdir(), "tk-sup-checkout-")));
    const mk = (jobId: string, i: number, owner: Owner | null) =>
      fx.queue.enqueue({ jobId, root: roots[i], definition: { id: jobId }, owner }).run;
    const first = mk("first", 0, null);
    const liveOwned = mk("live-owned", 1, B);
    const deadOwned = mk("dead-owned", 2, A);
    const running = mk("running", 3, B);
    await fx.queue.claim(running.run_id, B);
    const last = mk("last", 4, null);
    const self: Owner = { pid: 1, host: HOST, nonce: "self" };
    expect(fx.queue.drainable(self).map((r) => r.run_id)).toEqual([first.run_id, deadOwned.run_id, last.run_id]);
    expect(fx.queue.drainable(self).map((r) => r.run_id)).not.toContain(liveOwned.run_id);
  });
});

describe("launchStatusProbe (the launch core's status, injected uv)", () => {
  const withRoot = async <T>(fn: () => Promise<T>) => {
    const prev = process.env.TK_STUDIO_ROOT;
    process.env.TK_STUDIO_ROOT = prev || mkdtempSync(join(tmpdir(), "tk-sup-studio-"));
    try { return await fn(); } finally { if (prev === undefined) delete process.env.TK_STUDIO_ROOT; }
  };
  const uv = (stdout: string, exit = 0, stderr = "") => async (_root: string, script: string, args: string[]) => {
    expect(script).toEndWith(join("lib", "launch.py"));
    expect(args).toEqual(["status", "--directory", "/proj"]);
    return { exit, stdout, stderr };
  };
  const answer = JSON.stringify({ ok: true, runs: [], live: [{ run_id: "E1", status: "running" }, { run_id: "E2" }] });

  test("live[] parse: a named engine is live while listed; an unverified one while live[] is non-empty", async () => {
    await withRoot(async () => {
      expect(await launchStatusProbe("/proj", "E1", uv(answer))).toEqual({ live: true, run_ids: ["E1", "E2"] });
      expect(await launchStatusProbe("/proj", "E9", uv(answer))).toEqual({ live: false, run_ids: ["E1", "E2"] });
      expect(await launchStatusProbe("/proj", null, uv(answer))).toEqual({ live: true, run_ids: ["E1", "E2"] });
      expect(await launchStatusProbe("/proj", null, uv(JSON.stringify({ ok: true, runs: [], live: [] })))).toEqual({ live: false, run_ids: [] });
    });
  });

  test("fail closed: a refusal, no JSON, or a throw counts live and is named", async () => {
    await withRoot(async () => {
      const refused = await launchStatusProbe("/proj", "E1", uv(JSON.stringify({ ok: false, error: "bmad-loop not installed" }), 2));
      expect(refused).toMatchObject({ live: true });
      expect(refused.detail).toContain("bmad-loop not installed");
      expect((await launchStatusProbe("/proj", "E1", uv("garbage", 1, "Traceback"))).detail).toContain("Traceback");
      const thrown = await launchStatusProbe("/proj", "E1", async () => { throw new Error("uv missing"); });
      expect(thrown).toMatchObject({ live: true });
      expect(thrown.detail).toContain("uv missing");
    });
  });
});

describe("review pass 2 fixes", () => {
  test("claim: a stale tk-studio-launch holder is probed — a live engine takes the lock and the claimer waits naming it", async () => {
    let answer: EngineProbe = { live: true, run_ids: ["E5"] };
    const fx = fixture(new Set([A.pid, B.pid]), () => answer);
    const l = fx.enqueue("run-epic", A, "skill", "tk-studio-launch").run;
    await fx.queue.claim(l.run_id, A);
    fx.alive.delete(A.pid); // the launch run's supervisor died; its lock row is stale
    const b = fx.enqueue("studio-health", B).run;
    const wait = await fx.queue.claim(b.run_id, B);
    expect(wait).toMatchObject({ claimed: false, why: "lock", holder: { kind: "engine", engine_run_id: "E5", run_id: l.run_id } });
    expect(fx.engineCalls[0]).toEqual([fx.checkout, null]);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "E5", run_id: l.run_id });
    expect(fx.queue.events(b.run_id).at(-1)).toMatchObject({
      kind: "lock-wait", detail: { holder: { engine_run_id: "E5" }, handover: { from_run: l.run_id, to_engine: "E5" } },
    });
    answer = { live: false, run_ids: [] };
    expect((await fx.queue.claim(b.run_id, B)).claimed).toBe(true);
  });

  test("claim: a stale launch holder with a failed probe → an unverified engine holds; not live → taken over as before", async () => {
    let answer: EngineProbe = { live: true, detail: "launch status probe failed: uv missing" };
    const fx = fixture(new Set([A.pid, B.pid]), () => answer);
    const l = fx.enqueue("run-epic", A, "skill", "tk-studio-launch").run;
    await fx.queue.claim(l.run_id, A);
    fx.alive.delete(A.pid);
    const b = fx.enqueue("studio-health", B).run;
    const wait = await fx.queue.claim(b.run_id, B);
    if (wait.claimed) throw new Error("claimed under a failed probe");
    expect(wait.reason).toContain("unverified bmad-loop engine");
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: null });

    // A non-launch stale holder is never probed.
    const fx2 = fixture(new Set([A.pid, B.pid]), () => ({ live: true }));
    const r = fx2.enqueue("j", A).run;
    await fx2.queue.claim(r.run_id, A);
    fx2.alive.delete(A.pid);
    const c = fx2.enqueue("k", B).run;
    expect((await fx2.queue.claim(c.run_id, B)).claimed).toBe(true);
    expect(fx2.engineCalls).toEqual([]);
  });

  test("recovery uses the target and definition the run was driven with (recorded at verb_started): stored skill, driven core → cancel", async () => {
    const fx = fixture();
    const r = fx.enqueue("j", A, "skill").run;
    await fx.queue.claim(r.run_id, A);
    fx.queue.markVerbStarted(r.run_id, "wake", [], { target: "core", definition: { id: "j", target: { core: "c" } } });
    expect(fx.queue.get(r.run_id)).toMatchObject({ target: "core" });
    expect(fx.queue.definition(fx.queue.get(r.run_id)!)).toEqual({ id: "j", target: { core: "c" } });
    fx.queue.setStudioRun(r.run_id, "j-20260928T101010Z");
    fx.alive.delete(A.pid);
    const calls: string[][] = [];
    await fx.queue.recover(studioOps(async (_root, a) => {
      calls.push(a);
      return a[0] === "status" ? { runs: [{ run_id: "j-20260928T101010Z", state: "running" }] } : { cancelled: true };
    }), B);
    expect(calls.map((c) => c[0])).toEqual(["status", "cancel"]);
    expect(fx.queue.get(r.run_id)!.state).toBe("partial");
  });

  test("win32 start time: a bounded PowerShell read through injection; a failed read is absent", () => {
    const seen: string[] = [];
    const ps = (out: string | null) => (cmd: string) => { seen.push(cmd); return out; };
    expect(processStartTime(4242, "win32", ps("2026-09-28T10:00:00.1234567Z\r\n"))).toBe("2026-09-28T10:00:00.1234567Z");
    expect(seen[0]).toContain("Get-Process -Id 4242");
    expect(seen[0]).toContain("ToUniversalTime().ToString('o')");
    expect(processStartTime(4242, "win32", ps(null))).toBeNull();
    expect(processStartTime(4242, "win32", ps("Get-Process : Cannot find a process"))).toBeNull();
    expect(processStartTime(4242, "darwin", ps("2026-09-28T10:00:00Z"))).toBeNull();
    // The owner probe compares the recorded start with the injected read: a reused pid is dead.
    const me: Owner = { pid: process.pid, host: HOST, nonce: "n", start: "2026-09-28T10:00:00.0000000Z" };
    expect(defaultOwnerAlive(me, () => "2026-09-28T10:00:00.0000000Z")).toBe(true);
    expect(defaultOwnerAlive(me, () => "2026-09-28T11:11:11.0000000Z")).toBe(false);
    expect(defaultOwnerAlive(me, () => null)).toBe(true); // unreadable: the pid decides
  });

  test("placement: darwin (case-insensitive by default) folds case — ~/.TK-Studio is still the store", () => {
    const base = mkdtempSync(join(tmpdir(), "tk-sup-qpath-"));
    const env = { TK_SUPERVISOR_DB: join(base, ".TK-Studio", "q.db"), TK_STUDIO_HOME: join(base, ".tk-studio") };
    expect(() => queueDbPath(env, "darwin")).toThrow(QueueDbPlacementRefused);
    expect(() => queueDbPath(env, "win32")).toThrow(/studio store/);
    // case-sensitive: a different directory. Only a case-sensitive host can show it:
    // on win32, node's path.relative itself compares case-insensitively.
    if (process.platform !== "win32") expect(queueDbPath(env, "linux")).toBe(join(base, ".TK-Studio", "q.db"));
    const root = { TK_SUPERVISOR_DB: join(base, "Studio", "q.db"), TK_STUDIO_HOME: join(base, "s"), TK_STUDIO_ROOT: join(base, "studio") };
    expect(() => queueDbPath(root, "darwin")).toThrow(/TK_STUDIO_ROOT/);
    expect(existsSync(join(base, ".TK-Studio"))).toBe(false);
  });
});

describe("a driven tk-studio-launch run that names no engine (endDriven probes before releasing)", () => {
  const LAUNCH_DEFN = { id: "run-epic", trigger: "one-shot", target: { skill: "tk-studio-launch" } };
  /** A launch run this process drove past the minting verb; its outcome named no `.bmad-loop/runs/<id>`. */
  async function drivenLaunch(engine: (id: string | null) => EngineProbe) {
    const fx = fixture(new Set([A.pid, B.pid]), engine);
    const r = fx.enqueue("run-epic", A, "skill", "tk-studio-launch").run;
    await fx.queue.claim(r.run_id, A);
    fx.queue.markVerbStarted(r.run_id, "submit", [], { target: "skill", definition: LAUNCH_DEFN });
    fx.queue.setStudioRun(r.run_id, "run-epic-20260928T101010Z");
    return { fx, r };
  }

  test("live[] non-empty → the lock passes to that engine (first live id); the next claim waits naming it", async () => {
    const { fx, r } = await drivenLaunch(() => ({ live: true, run_ids: ["E3", "E4"] }));
    await fx.queue.endDriven(r.run_id, "blocked", "status block ended 'blocked'");
    expect(fx.engineCalls).toEqual([[fx.checkout, null]]);
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "blocked", engine_run_id: "E3" });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "E3", run_id: r.run_id });
    expect(fx.queue.events(r.run_id).at(-1)).toMatchObject({
      kind: "ended", to_state: "blocked", detail: { lock: { handed_to_engine: "E3" }, engine: { handed_to_engine: "E3", live: ["E3", "E4"] } },
    });
    const b = fx.enqueue("studio-health", B).run;
    const wait = await fx.queue.claim(b.run_id, B);
    expect(wait).toMatchObject({ claimed: false, why: "lock", holder: { kind: "engine", engine_run_id: "E3", run_id: r.run_id } });
    if (wait.claimed) throw new Error("unreachable");
    expect(wait.reason).toContain("bmad-loop engine E3");
  });

  test("empty live[] → the lock is released", async () => {
    const { fx, r } = await drivenLaunch(() => ({ live: false, run_ids: [] }));
    await fx.queue.endDriven(r.run_id, "partial", "guard: max_wall_clock_seconds (600s)");
    expect(fx.engineCalls).toEqual([[fx.checkout, null]]);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "partial", engine_run_id: null });
    expect(fx.queue.events(r.run_id).at(-1)!.detail).toMatchObject({ lock: "released", engine: { handed_to_engine: null, live: [] } });
    expect((await fx.queue.claim(fx.enqueue("studio-health", B).run.run_id, B)).claimed).toBe(true);
  });

  test("a failed probe → an unverified engine holds the lock (fail closed, named); a claim waits naming it", async () => {
    const detail = "launch status probe failed (exit 1): bmad-loop list failed";
    const { fx, r } = await drivenLaunch(() => ({ live: true, detail }));
    await fx.queue.endDriven(r.run_id, "blocked", MISSING_BLOCK);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: null, run_id: r.run_id });
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "blocked", engine_run_id: null });
    expect(fx.queue.events(r.run_id).at(-1)!.detail).toMatchObject({ lock: { handed_to_engine: "unverified" }, engine: { handed_to_engine: "unverified", detail } });
    const wait = await fx.queue.claim(fx.enqueue("studio-health", B).run.run_id, B);
    if (wait.claimed) throw new Error("claimed under a failed probe");
    expect(wait.reason).toContain("unverified bmad-loop engine");
    expect(wait.reason).toContain("bmad-loop list failed");
  });

  test("no probe: an engine already named, a run that never reached the verb, a non-launch run", async () => {
    const named = await drivenLaunch(() => ({ live: false }));
    await named.fx.queue.endDriven(named.r.run_id, "complete", null, { engineRunId: "E1" });
    expect(named.fx.engineCalls).toEqual([]);
    expect(named.fx.queue.lock(named.fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "E1" });

    const fx = fixture(new Set([A.pid]), () => ({ live: true }));
    const early = fx.enqueue("run-epic", A, "skill", "tk-studio-launch").run;
    await fx.queue.claim(early.run_id, A);
    await fx.queue.endDriven(early.run_id, "blocked", "status (pre-submit snapshot): uv timed out");
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    const plain = fx.enqueue("j", A).run;
    await fx.queue.claim(plain.run_id, A);
    fx.queue.markVerbStarted(plain.run_id, "submit", [], { target: "skill", definition: { id: "j", target: { skill: "tk-studio-activate" } } });
    await fx.queue.endDriven(plain.run_id, "blocked", MISSING_BLOCK);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    expect(fx.engineCalls).toEqual([]);
  });
});

const MISSING_BLOCK = "conformance failure (AD-11): run terminated without a JSON status block (§3)";

describe("no owner or engine probe runs inside a transaction", () => {
  /** A queue whose probes record any call made while the database is inside a transaction. */
  function guarded(alive: Set<number>, engine: (id: string | null) => EngineProbe = () => ({ live: false }), onOwner?: (o: Owner) => void) {
    const seen = { owner: 0, engine: 0, inTransaction: [] as string[] };
    let queue: Queue | undefined;
    const probes: Probes = {
      ownerAlive: (o) => {
        seen.owner++;
        if (queue!.db.inTransaction) seen.inTransaction.push(`ownerAlive(${o.pid})`);
        onOwner?.(o);
        return alive.has(o.pid);
      },
      engineLive: async (_root, id) => {
        seen.engine++;
        if (queue!.db.inTransaction) seen.inTransaction.push(`engineLive(${id})`);
        return engine(id);
      },
    };
    queue = new Queue(join(mkdtempSync(join(tmpdir(), "tk-sup-queue-")), "q.db"), probes);
    const checkout = () => mkdtempSync(join(tmpdir(), "tk-sup-checkout-"));
    const enqueue = (jobId: string, root: string, owner: Owner | null, skill = "tk-studio-activate") =>
      queue!.enqueue({ jobId, root, definition: { id: jobId, target: { skill } }, owner }).run;
    return { queue, seen, alive, checkout, enqueue };
  }

  test("claim (queued under a live owner, a live run holder, a stale launch holder, an engine holder), recover, drainable, endDriven", async () => {
    let answer: EngineProbe = { live: true, run_ids: ["E8"] };
    const g = guarded(new Set([A.pid, B.pid]), () => answer);
    // Queued under a live owner.
    const owned = g.enqueue("owned", g.checkout(), A);
    expect(await g.queue.claim(owned.run_id, B)).toMatchObject({ claimed: false, why: "owned" });
    // A live run holder.
    const c1 = g.checkout();
    const holder = g.enqueue("holder", c1, A);
    expect((await g.queue.claim(holder.run_id, A)).claimed).toBe(true);
    expect(await g.queue.claim(g.enqueue("waiter", c1, null).run_id, B)).toMatchObject({ claimed: false, why: "lock", holder: { kind: "run" } });
    // A stale tk-studio-launch holder (its owner died): probed, handed to the engine.
    const c2 = g.checkout();
    const launch = g.enqueue("run-epic", c2, A, "tk-studio-launch");
    expect((await g.queue.claim(launch.run_id, A)).claimed).toBe(true);
    g.alive.delete(A.pid);
    const next = g.enqueue("next", c2, null);
    expect(await g.queue.claim(next.run_id, B)).toMatchObject({ claimed: false, holder: { kind: "engine", engine_run_id: "E8" } });
    // The engine holder: re-probed, now gone.
    answer = { live: false, run_ids: [] };
    expect((await g.queue.claim(next.run_id, B)).claimed).toBe(true);
    // recover and drainable.
    await g.queue.recover(studioOps(async () => ({ runs: [] })), B);
    g.queue.drainable(B);
    // endDriven's launch probe.
    const c3 = g.checkout();
    const driven = g.enqueue("run-epic-2", c3, B, "tk-studio-launch");
    await g.queue.claim(driven.run_id, B);
    g.queue.markVerbStarted(driven.run_id, "submit", []);
    await g.queue.endDriven(driven.run_id, "blocked", MISSING_BLOCK);
    expect(g.seen.owner).toBeGreaterThan(0);
    expect(g.seen.engine).toBeGreaterThanOrEqual(3);
    expect(g.seen.inTransaction).toEqual([]);
  });

  test("claim: rows that change between the probe and the transaction are re-read and re-probed", async () => {
    const D: Owner = { pid: 910009, host: HOST, nonce: "nonce-d" }; // never alive
    let q: Queue | undefined;
    let holderId = "", swappedTo = "";
    // While the holder's owner is probed (alive), the holder ends and a run with a dead owner takes the lock.
    const g = guarded(new Set([A.pid, B.pid]), undefined, (o) => {
      if (o.pid !== A.pid || swappedTo) return;
      q!.end(holderId, "complete");
      const d = q!.enqueue({ jobId: "d", root: c, definition: { id: "d" }, owner: D }).run;
      q!.db.run("UPDATE runs SET state = 'running' WHERE run_id = ?", [d.run_id]);
      q!.db.run(`INSERT INTO locks (checkout, root, kind, run_id, job_id, owner_pid, owner_host, owner_nonce, acquired)
        VALUES (?, ?, 'run', ?, 'd', ?, ?, ?, ?)`, [d.checkout, c, d.run_id, D.pid, D.host, D.nonce, new Date().toISOString()]);
      swappedTo = d.run_id;
    });
    q = g.queue;
    const c = g.checkout();
    holderId = g.enqueue("holder", c, A).run_id;
    expect((await g.queue.claim(holderId, A)).claimed).toBe(true);
    const b = g.enqueue("waiter", c, null);
    // The first probe saw holder A alive; the transaction saw a different lock row and retried: D is dead, so the lock is taken.
    expect((await g.queue.claim(b.run_id, B)).claimed).toBe(true);
    expect(swappedTo).not.toBe("");
    expect(g.queue.events(b.run_id).at(-1)!.detail).toMatchObject({ released: { kind: "run", run_id: swappedTo } });
    expect(g.seen.inTransaction).toEqual([]);
  });
});

describe("stop events and the pacer's read (Story 21.5)", () => {
  const STOP = { condition: "on_status" as const, state: "partial", job_id: "j" };
  const studio = (state: string) => ({ detail: { studio_outcome: { run_id: "s-1", state } } });

  test("end(..., { stop }): the `stopped` event is written in the same transaction as `ended`", () => {
    const fx = fixture();
    try {
      const run = fx.enqueue("j").run;
      fx.queue.end(run.run_id, "partial", "guard: max_turns (40)", { stop: STOP });
      const evs = fx.queue.events(run.run_id);
      const ended = evs.findIndex((e) => e.kind === "ended");
      expect(evs[ended + 1]).toMatchObject({ kind: "stopped", from_state: "partial", to_state: "partial", detail: STOP });
      expect(fx.queue.get(run.run_id)).toMatchObject({ state: "partial", reason: "guard: max_turns (40)" });
      // A refused end (already terminal) writes neither.
      expect(() => fx.queue.end(run.run_id, "partial", null, { stop: STOP })).toThrow(RunTerminal);
      expect(fx.queue.events(run.run_id).filter((e) => e.kind === "stopped")).toHaveLength(1);
    } finally { fx.queue.close(); }
  });

  test("pacing: live vs adoptable runs, the latest terminal run's end and the stop, per (job, checkout)", () => {
    const fx = fixture();
    try {
      expect(fx.queue.pacing("j", fx.checkout)).toEqual({ live: [], adoptable: [], lastEnded: null, latestTerminal: null, stopped: null });
      const first = fx.enqueue("j").run;
      fx.queue.end(first.run_id, "partial", null, { ...studio("partial"), stop: STOP });
      const endedAt = fx.queue.events(first.run_id).find((e) => e.kind === "ended")!.at;
      let p = fx.queue.pacing("j", fx.checkout);
      expect(p).toMatchObject({ live: [], adoptable: [], lastEnded: endedAt, latestTerminal: { run_id: first.run_id }, stopped: { kind: "stopped" } });

      // A later run the studio ran to a terminal state clears the stop; an ownerless queued run is adoptable; other jobs are not listed.
      const second = fx.enqueue("j").run;
      fx.queue.end(second.run_id, "complete", null, studio("complete"));
      const third = fx.enqueue("j").run;
      fx.enqueue("other");
      p = fx.queue.pacing("j", fx.checkout);
      expect(p.live).toEqual([]);
      expect(p.adoptable.map((r) => r.run_id)).toEqual([third.run_id]);
      expect(p.latestTerminal!.run_id).toBe(second.run_id);
      expect(p.lastEnded).toBe(fx.queue.events(second.run_id).find((e) => e.kind === "ended")!.at);
      expect(p.stopped).toBeNull();
      // Another checkout of the same job is its own pacing.
      expect(fx.queue.pacing("j", mkdtempSync(join(tmpdir(), "tk-sup-other-co-"))).adoptable).toEqual([]);
    } finally { fx.queue.close(); }
  });

  test("pacing: a queued run under a live owner and a running run are live; a dead owner's queued run is adoptable", async () => {
    const fx = fixture(new Set([A.pid]));
    try {
      const owned = fx.enqueue("j", A).run;
      expect(fx.queue.pacing("j", fx.checkout, B)).toMatchObject({ live: [{ run_id: owned.run_id }], adoptable: [] });
      fx.alive.delete(A.pid);
      expect(fx.queue.pacing("j", fx.checkout, B)).toMatchObject({ live: [], adoptable: [{ run_id: owned.run_id }] });
      await fx.queue.claim(owned.run_id, B);
      expect(fx.queue.pacing("j", fx.checkout, B)).toMatchObject({ live: [{ run_id: owned.run_id, state: "running" }], adoptable: [] });
    } finally { fx.queue.close(); }
  });

  test("pacing: a stop persists past later runs the studio never ran to a terminal state (not-woken, refused, orphan)", () => {
    const fx = fixture();
    try {
      const stopped = fx.enqueue("j").run;
      fx.queue.end(stopped.run_id, "partial", null, { ...studio("partial"), stop: STOP });
      // not-woken / refused: ended `blocked` with no studio outcome.
      const notWoken = fx.enqueue("j").run;
      fx.queue.end(notWoken.run_id, "blocked", "not-woken: stop: on_status");
      const refused = fx.enqueue("j").run;
      fx.queue.end(refused.run_id, "blocked", "registry show refused");
      let p = fx.queue.pacing("j", fx.checkout);
      expect(p.latestTerminal!.run_id).toBe(refused.run_id);
      expect(p.stopped).toMatchObject({ run_id: stopped.run_id, kind: "stopped" });
      // An orphan (ended by the restart rule, an `orphaned` event) never clears it either.
      const orphan = fx.enqueue("j").run;
      fx.queue.db.query("UPDATE runs SET state = 'partial', reason = ? WHERE run_id = ?").run(ORPHANED_REASON, orphan.run_id);
      fx.queue.db.query("INSERT INTO events (run_id, at, kind, from_state, to_state, detail) VALUES (?, ?, 'orphaned', 'running', 'partial', NULL)")
        .run(orphan.run_id, new Date(Date.now() + 1000).toISOString());
      p = fx.queue.pacing("j", fx.checkout);
      expect(p.latestTerminal!.run_id).toBe(orphan.run_id);
      expect(p.stopped).toMatchObject({ run_id: stopped.run_id });
    } finally { fx.queue.close(); }
  });
});

describe("resume takeover and restart ends (Story 21.6)", () => {
  async function orphaned(defn: Record<string, unknown> = {}) {
    const fx = fixture();
    const r = fx.queue.enqueue({ jobId: "j", root: fx.checkout, projectId: "p", target: "skill",
      definition: { id: "j", target: { skill: "tk-studio-activate" }, ...defn }, owner: A }).run;
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, "j-20260928T101010Z");
    fx.queue.setSession(r.run_id, "sid-1");
    fx.queue.setWake(r.run_id, { directive: { kind: "invoke-skill", skill: "tk-studio-activate" }, state: "queued" });
    fx.alive.delete(A.pid);
    return { fx, r };
  }
  const ops = (resume: boolean) => ({
    end: async () => ({ ok: true, detail: "finished", state: "partial" }),
    find: async () => ({ ok: true as const, run_id: null }),
    resume: async () => (resume ? { resume: true as const, detail: { session_id: "sid-1" } } : { resume: false as const, cause: "no session recorded" }),
  });

  test("setters: session, worker, wake and accounted ids are recorded with one event each, on a running run only", async () => {
    const { fx, r } = await orphaned();
    fx.queue.setWorker(r.run_id, 4242, "999");
    fx.queue.recordAccounted(r.run_id, ["m1", "m2"], { turns: 2, tokens: 30 });
    expect(fx.queue.get(r.run_id)).toMatchObject({ session_id: "sid-1", worker_pid: 4242, worker_start: "999" });
    expect(JSON.parse(fx.queue.get(r.run_id)!.wake!)).toMatchObject({ state: "queued" });
    expect(fx.queue.events(r.run_id).map((e) => e.kind)).toEqual(["enqueued", "claimed", "studio-run", "session", "woke", "worker", "accounted"]);
    expect(fx.queue.accountedIds(r.run_id)).toEqual(["m1", "m2"]);
    const q = fx.enqueue("other").run;
    expect(() => fx.queue.setSession(q.run_id, "x")).toThrow(/not running/);
  });

  test("the takeover keeps the lock: owner and lock move to the restarted supervisor in one transaction; another run waits on it", async () => {
    const { fx, r } = await orphaned();
    const report = await fx.queue.recover(ops(true), B);
    expect(report.resumed).toEqual([{ run_id: r.run_id, studio_run_id: "j-20260928T101010Z", resume: 1 }]);
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "running", owner_nonce: B.nonce, owner_pid: B.pid });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "run", run_id: r.run_id, owner_nonce: B.nonce });
    expect(fx.queue.events(r.run_id).at(-1)).toMatchObject({ kind: "resumed", from_state: "running", to_state: "running", detail: { resume: 1, session_id: "sid-1" } });
    expect(fx.queue.resumeCount(r.run_id)).toBe(1);
    // The resumed run holds the checkout: a second job's run on it waits naming it.
    const waiter = fx.enqueue("waiter").run;
    expect(await fx.queue.claim(waiter.run_id, B)).toMatchObject({ claimed: false, why: "lock", holder: { kind: "run", run_id: r.run_id } });
    // The pacer sees it live; a second recover leaves it alone (its owner is this process).
    expect(fx.queue.pacing("j", fx.checkout, B).live.map((x) => x.run_id)).toEqual([r.run_id]);
    expect(await fx.queue.recover(ops(true), B)).toEqual({ ended: [], requeued: [], resumed: [] });
  });

  test("an orphan end records studio_outcome, and `stopped` in the same transaction when stop.on_status lists it (DW-8)", async () => {
    const { fx, r } = await orphaned({ stop: { on_status: ["partial"] } });
    await fx.queue.recover(ops(false), B);
    expect(fx.queue.get(r.run_id)).toMatchObject({ state: "partial", reason: `${ORPHANED_REASON}; no session recorded` });
    const evs = fx.queue.events(r.run_id);
    expect(evs.at(-2)).toMatchObject({ kind: "orphaned", detail: { studio_outcome: { run_id: "j-20260928T101010Z", state: "partial" }, lock: "released" } });
    expect(evs.at(-1)).toMatchObject({ kind: "stopped", seq: evs.at(-2)!.seq + 1, detail: { condition: "on_status", state: "partial", job_id: "j" } });
    expect(fx.queue.pacing("j", fx.checkout, B).stopped).toMatchObject({ run_id: r.run_id, kind: "stopped" });
  });

  test("no stop listed: studio_outcome recorded, no `stopped` event", async () => {
    const { fx, r } = await orphaned();
    await fx.queue.recover(ops(false), B);
    expect(fx.queue.events(r.run_id).map((e) => e.kind).at(-1)).toBe("orphaned");
    expect(fx.queue.pacing("j", fx.checkout, B).stopped).toBeNull();
  });
});
