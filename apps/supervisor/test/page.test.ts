import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join, sep } from "node:path";
import { createApi } from "../src/api";
import { studioHome } from "../src/env";
import { credentialKey, holderOf, redactCredentials, redactLedgerLine, tailLines } from "../src/page";
import { Queue, type Owner, type Probes, type WorkerKill } from "../src/queue";
import { tempDir, track } from "./tmp";

const TOKEN = "tok-page-7c1e-very-secret-value";
const TELEGRAM = "123456789:AAtelegram-bot-secret-value-xyz-0123456789";
const OTHER_TOKEN = "other-supervisor-token-value-42";
const BEARER = "bearer-planted-secret-9f8e";
const SK_ANT = "sk-ant-api03-plantedSecretValue_abc123";
const GHP = "ghp_PlantedGithubToken0123456789abcd";
const PASSWORD = "hunter2-planted-password";
const API_KEY = "planted-api-key-value-778";
const PLANTED = [TOKEN, TELEGRAM, OTHER_TOKEN, BEARER, SK_ANT, GHP, PASSWORD, API_KEY];
const HOST = hostname();
const A: Owner = { pid: 930001, host: HOST, nonce: "page-nonce-a" };
const BASE = "http://100.100.1.2:8787";
const LEDGER = { user: "op", machine: "box" };

/** Everything credential-shaped at once, as prose. */
const LEAKY = `Authorization: Bearer ${BEARER}; key ${SK_ANT}; gh ${GHP}; api ${TOKEN}; tg ${TELEGRAM}; other ${OTHER_TOKEN}`;

interface FxOpts {
  registry?: () => Promise<Record<string, any>>; now?: () => number;
  probeWorker?: Probes["probeWorker"]; env?: Record<string, string>;
  /** null: no `ledger` dep (the default identity). */
  ledger?: { user: string; machine: string } | null;
  /** Story 30.2: the studio web's root (a temp dir; never the real apps/studio-web/dist). */
  web?: { dir: string };
}

/** The default web root: an isolated temp dir holding index.html (built), so the page never reads the checkout's
 * apps/studio-web/dist. */
function builtWeb(): { dir: string } {
  const dir = tempDir("tk-sup-page-web-built-");
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>web</title>");
  return { dir };
}

function fixture(o: FxOpts = {}) {
  const dir = tempDir("tk-sup-page-");
  const store = tempDir("tk-sup-page-store-");
  const probes: Probes = {
    ownerAlive: (w) => w.pid === A.pid,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
    probeWorker: o.probeWorker ?? ((pid, start): WorkerKill => ({ pid, start, outcome: "not running" })),
    ...(o.now ? { now: o.now } : {}),
  };
  const db = join(dir, "q.db");
  const queue = track(new Queue(db, probes));
  const env = { TK_STUDIO_HOME: store, TK_SUPERVISOR_TELEGRAM_TOKEN: TELEGRAM, TK_SUPERVISOR_OTHER_TOKEN: OTHER_TOKEN, ...o.env };
  const registryCalls: number[] = [];
  const registry = o.registry ?? (async () => { registryCalls.push(1); return { ok: true, projects: { p: { root: "/work/p", vcs: "git", planning_backend: "files" } } }; });
  const handler = createApi({ queue, token: TOKEN, env, registry, ...(o.ledger === null ? {} : { ledger: o.ledger ?? LEDGER }), web: o.web ?? builtWeb() });
  /** Story 30.6: the page's address is `GET /status` with `Accept: text/html` — the default (no path given); a path
   * given is requested with no `Accept` unless one is named. */
  const call = (method: string, path?: string, auth: string | null = `Bearer ${TOKEN}`, accept?: string) => {
    const headers: Record<string, string> = auth === null ? {} : { authorization: auth };
    const a = accept ?? (path === undefined ? "text/html" : undefined);
    if (a) headers.accept = a;
    return handler(new Request(`${BASE}${path ?? "/status"}`, { method, headers }));
  };
  const checkout = () => tempDir("tk-sup-page-checkout-");
  const enqueue = (jobId: string, root: string, extra: { tier?: string; sandbox?: string } = {}) =>
    queue.enqueue({ jobId, root, projectId: "p", target: "skill", tier: extra.tier, sandbox: extra.sandbox,
      definition: { id: jobId, trigger: "one-shot", target: { skill: "tk-studio-activate" } } }).run;
  const workspace = (studioRunId: string) => {
    const ws = join(store, "projects", "p", "runs", studioRunId);
    mkdirSync(ws, { recursive: true });
    return ws;
  };
  return { dir, db, store, queue, env, call, checkout, enqueue, workspace, registryCalls };
}

/** A populated queue and store: a resumed complete run with its workspace, an sbx run that ended keeping
 * its lock, a cancelled run whose lock is kept for its live driver, a long reason, credentials planted. */
async function populated(o: FxOpts = {}) {
  const now = Date.now();
  const fx = fixture({ now: () => now, ...o });
  // 1. A complete run, resumed once, whose run.json sums the cost; handoff.json present.
  const done = fx.enqueue("studio-health", fx.checkout());
  await fx.queue.claim(done.run_id, A);
  fx.queue.setStudioRun(done.run_id, "studio-health-20260928T000001Z");
  fx.queue.markResumed(done.run_id, { session_id: "s-1" });
  fx.queue.end(done.run_id, "complete", `done; ${LEAKY}`);
  const ws = fx.workspace("studio-health-20260928T000001Z");
  writeFileSync(join(ws, "run.json"), JSON.stringify({
    run_id: "studio-health-20260928T000001Z", state: "complete", reason: "finished", total_cost_usd: 1.2345,
    status_block: { status: "complete", summary: "health green", note: LEAKY }, started: "2026-09-28T00:00:01Z", ended: "2026-09-28T00:05:00Z",
    password: PASSWORD, api_key: API_KEY, nested: { access_token: "nested-planted-token-1" },
  }));
  writeFileSync(join(ws, "handoff.json"), JSON.stringify({ next: "resume from step 3", secret: "handoff-planted-secret", text: LEAKY }));
  // 2. An sbx run that ended keeping its lock: the recorded worker's in-VM deadline.
  const sbx = fx.enqueue("run-epic", fx.checkout(), { tier: "sbx", sandbox: "sb" });
  await fx.queue.claim(sbx.run_id, A);
  fx.queue.setWorker(sbx.run_id, 4242, "999", 600);
  fx.queue.end(sbx.run_id, "partial", "worker may still run", { holdLock: "sbx worker may still run" });
  // 3. A cancelled run with no worker recorded whose lock is kept for its live driver.
  const cancelled = fx.enqueue("nightly", fx.checkout());
  await fx.queue.claim(cancelled.run_id, A);
  fx.queue.end(cancelled.run_id, "cancelled", "cancelled over the API", { holdLock: "its live driver", driverLive: true });
  // 4. A long reason (> 300 characters), with no studio run recorded.
  const longReason = `orphaned: supervisor restart; guard: max_wall_clock_seconds (600s); ${"x".repeat(320)} END-OF-REASON`;
  const long = fx.enqueue("long-one", fx.checkout());
  fx.queue.end(long.run_id, "partial", longReason);
  // 5. The ledger, with more lines than the tail shows.
  mkdirSync(join(fx.store, "measurements"), { recursive: true });
  const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify({ n: i, kind: "measure", marker: `line-${i}` }));
  lines.push(JSON.stringify({ n: 40, kind: "measure", token: "ledger-planted-token", text: LEAKY }));
  writeFileSync(join(fx.store, "measurements", "op-box.jsonl"), lines.join("\n") + "\n");
  return { ...fx, done, sbx, cancelled, long, longReason, deadline: new Date(now).getTime() };
}

/** Every file under `root` with its mtime and hash. */
function listing(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { out.push(`${p}/`); walk(p); }
      else out.push(`${p} ${statSync(p).mtimeMs} ${createHash("sha256").update(readFileSync(p)).digest("hex")}`);
    }
  };
  walk(root);
  return out.sort();
}

function dbBytes(dir: string): string {
  return readdirSync(dir).sort().map((f) => `${f} ${createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")}`).join("\n");
}

const maxSeq = (q: Queue) => (q.db.query("SELECT MAX(seq) AS m FROM events").get() as { m: number | null }).m;

describe("the status page (AC1)", () => {
  test("GET /status (Accept: text/html) with a valid token: text/html, a viewport meta, no script", async () => {
    const fx = await populated();
    const res = await fx.call("GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/html");
    const body = await res.text();
    expect(body).toContain('<meta name="viewport"');
    expect(body.toLowerCase()).not.toContain("<script");
    expect(body).toContain("overflow-wrap:anywhere");
  });

  test("no token or a wrong one: 401 (the same gate as the API), answered with the sign-in page (Story 22.5)", async () => {
    const fx = await populated();
    for (const auth of [null, "", `Bearer ${TOKEN}x`, `Basic ${TOKEN}`]) {
      const res = await fx.call("GET", undefined, auth);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toStartWith("text/html");
      const body = await res.text();
      expect(body).toContain('action="/auth/token"');
      // Nothing of the page: no section, no run, no planted value.
      expect(body).not.toContain('id="runs"');
      expect(body).not.toContain(fx.done.run_id);
      for (const v of PLANTED) expect(body).not.toContain(v);
    }
    expect(fx.registryCalls).toEqual([]);
  });

  test("a non-GET on the page route: 405 with Allow: GET", async () => {
    const fx = fixture();
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await fx.call(method);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    }
  });

  test("the JSON routes answer as before", async () => {
    const fx = await populated();
    const status = await (await fx.call("GET", "/status")).json() as Record<string, any>;
    // Story 33.1 (0.1.28, additive): `log` joins the four; Story 33.7 (0.1.28, additive): `pacer` too.
    expect(Object.keys(status).sort()).toEqual(["counts", "live", "locks", "log", "ok", "pacer"]);
    expect((await fx.call("GET", "/nope")).status).toBe(404);
  });

  test("Story 30.6: /status without text/html is the same JSON byte for byte (none, */*, application/json), vary Accept", async () => {
    const fx = await populated();
    const answers: string[] = [];
    for (const accept of [undefined, "*/*", "application/json"]) {
      const res = await fx.call("GET", "/status", `Bearer ${TOKEN}`, accept);
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("vary")).toBe("Accept");
      answers.push(await res.text());
    }
    expect(new Set(answers).size).toBe(1);
    expect(Object.keys(JSON.parse(answers[0])).sort()).toEqual(["counts", "live", "locks", "log", "ok", "pacer"]);
    const page = await fx.call("GET");
    expect(page.headers.get("vary")).toBe("Accept");
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  test("Story 30.6: GET / with no built web is the page (never a 503); with a built web, the web's index.html", async () => {
    const none = fixture({ web: { dir: tempDir("tk-sup-page-web-") } });
    const home = await none.call("GET", "/");
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("The web is not built");
    const built = fixture();
    const index = await built.call("GET", "/");
    expect(index.status).toBe(200);
    expect(await index.text()).toBe("<!doctype html><title>web</title>");
  });
});

describe("the supervisor log section (Story 33.1, AC1)", () => {
  test("the page shows the log's last lines, redacted, right before the ledger; `no log` and unset work noted", async () => {
    const work = tempDir("tk-sup-page-work-");
    const at = Date.UTC(2026, 9, 26, 9);
    const page = async (env: Record<string, string>) => {
      const fx = fixture({ env });
      const handler = createApi({ queue: fx.queue, token: TOKEN, env: fx.env, registry: async () => ({ projects: {} }), ledger: LEDGER, web: builtWeb(), now: () => at });
      return (await handler(new Request(`${BASE}/status`, { headers: { authorization: `Bearer ${TOKEN}`, accept: "text/html" } }))).text();
    };
    try {
      const unset = await page({});
      // Story 33.7: the pacer line opens the section.
      expect(unset).toContain('<section id="log"><h2>Supervisor log</h2><p class="meta">pacer: no pass recorded</p><p class="note">TK_SUPERVISOR_WORK is not set</p></section>');
      expect(await page({ TK_SUPERVISOR_WORK: work })).toContain('<section id="log"><h2>Supervisor log</h2><p class="meta">pacer: no pass recorded</p><p class="note">no log</p></section>');
      const dir = join(work, "supervisor", "logs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "supervisor-2026-10-26.log"), [
        "2026-10-26T08:00:00.000Z [pacer] started",
        `2026-10-26T08:00:01.000Z [serve] ${LEAKY} <b>`,
        "2026-10-26T08:30:00.000Z [keeper] stopped (exit 1)",
      ].join("\n") + "\n");
      const body = await page({ TK_SUPERVISOR_WORK: work });
      const section = body.slice(body.indexOf('<section id="log">'), body.indexOf('<section id="ledger">'));
      expect(section).toContain("(last 3 lines)");
      expect(section).toContain("2026-10-26T08:00:00.000Z [pacer] started\n");
      expect(section).toContain("[keeper] stopped (exit 1)");
      expect(section).toContain("&lt;b&gt;");
      for (const v of PLANTED) expect(section).not.toContain(v);
      expect(body.indexOf('<section id="log">')).toBeLessThan(body.indexOf('<section id="ledger">'));
      expect(body.indexOf('<section id="workspaces">')).toBeLessThan(body.indexOf('<section id="log">'));
    } finally { rmSync(work, { recursive: true, force: true }); }
  });
});

describe("the pacer line (Story 33.7, AC2)", () => {
  test("the section opens with the pacer's last passes (a missing value `-`), or `no pass recorded`", async () => {
    const work = tempDir("tk-sup-page-work-");
    const page = async () => {
      const fx = fixture({ env: { TK_SUPERVISOR_WORK: work } });
      const handler = createApi({ queue: fx.queue, token: TOKEN, env: fx.env, registry: async () => ({ projects: {} }), ledger: LEDGER, web: builtWeb() });
      const body = await (await handler(new Request(`${BASE}/status`, { headers: { authorization: `Bearer ${TOKEN}`, accept: "text/html" } }))).text();
      return body.slice(body.indexOf('<section id="log">'), body.indexOf('<section id="ledger">'));
    };
    try {
      expect(await page()).toStartWith('<section id="log"><h2>Supervisor log</h2><p class="meta">pacer: no pass recorded</p>');
      mkdirSync(join(work, "supervisor"), { recursive: true });
      writeFileSync(join(work, "supervisor", "pacer.json"), JSON.stringify({ last_tick_ms: 812, last_drain_ms: 4021, last_pass_at: "2026-10-27T02:00:04.021Z" }));
      expect(await page()).toStartWith('<section id="log"><h2>Supervisor log</h2><p class="meta">pacer: last tick 812 ms · last drain 4021 ms · last pass 2026-10-27T02:00:04.021Z</p>');
      writeFileSync(join(work, "supervisor", "pacer.json"), JSON.stringify({ last_tick_ms: 812, last_drain_ms: null, last_pass_at: "2026-10-27T02:00:00.812Z" }));
      expect(await page()).toContain('<p class="meta">pacer: last tick 812 ms · last drain - ms · last pass 2026-10-27T02:00:00.812Z</p>');
    } finally { rmSync(work, { recursive: true, force: true }); }
  });
});

describe("the web's not-built note (Story 30.2, AC2)", () => {
  const NOTE = '<p class="note">The web is not built: cd apps/studio-web &amp;&amp; bun install --frozen-lockfile &amp;&amp; bun run build</p>';

  test("no built web: one note line under the header naming the build command", async () => {
    const fx = fixture({ web: { dir: tempDir("tk-sup-page-web-") } });
    const body = await (await fx.call("GET")).text();
    const header = body.indexOf('<h1>tk-studio supervisor</h1><p class="meta">generated ');
    expect(header).toBeGreaterThan(-1);
    expect(body.indexOf(`</p>${NOTE}\n<section id="jobs">`)).toBeGreaterThan(header);
    expect(body.split("The web is not built")).toHaveLength(2);
  });

  test("a built web (index.html present): no note", async () => {
    const dir = tempDir("tk-sup-page-web-");
    writeFileSync(join(dir, "index.html"), "<!doctype html>");
    const fx = fixture({ web: { dir } });
    const res = await fx.call("GET");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("The web is not built");
  });
});

describe("what the page shows (AC2)", () => {
  test("every section: jobs, runs (state, reason, cost, resume count), kept locks, status blocks, workspaces, ledger tail, registry", async () => {
    const fx = await populated();
    const body = await (await fx.call("GET")).text();
    for (const id of ["jobs", "runs", "locks", "status-blocks", "workspaces", "ledger", "registry"]) expect(body).toContain(`<section id="${id}">`);
    const section = (id: string) => { const at = body.indexOf(`<section id="${id}">`); return body.slice(at, body.indexOf("</section>", at)); };
    // Jobs: each job's own card in the Jobs section (id, project, trigger, target).
    const jobCards = section("jobs").split('<div class="card">').slice(1);
    for (const job of ["studio-health", "run-epic", "nightly", "long-one"]) {
      const card = jobCards.find((c) => c.startsWith(`<strong>${job}</strong>`))!;
      expect(card).toBeDefined();
      expect(card).toContain('<span class="meta">project p</span>');
      expect(card).toContain("trigger one-shot · target {&quot;skill&quot;:&quot;tk-studio-activate&quot;}");
    }
    // Runs: each run's card in the Runs section with its state markup; resume count, the summed cost
    // from run.json, absent where none.
    const runs = section("runs");
    const runCard = (runId: string) => runs.split('<div class="card" ').find((c) => c.startsWith(`id="run-${runId}"`))!;
    for (const [run, state] of [[fx.done, "complete"], [fx.sbx, "partial"], [fx.cancelled, "cancelled"], [fx.long, "partial"]] as const) {
      expect(runCard(run.run_id)).toContain(`<strong>${run.run_id}</strong> <span class="st">${state}</span>`);
    }
    expect(runCard(fx.done.run_id)).toContain("resumes 1");
    expect(runCard(fx.done.run_id)).toContain("cost $1.2345");
    expect(runCard(fx.long.run_id)).toContain("cost absent");
    // Event kinds as stored.
    expect(body).toContain("<strong>resumed</strong>");
    expect(body).toContain("<strong>studio-run</strong>");
    // Status blocks and workspaces.
    expect(body).toContain("health green");
    expect(body).toContain("resume from step 3");
    expect(body).toContain("projects/p/runs/studio-health-20260928T000001Z");
    // Ledger tail: the last lines only.
    expect(body).toContain("measurements/op-box.jsonl");
    expect(body).toContain("line-39");
    expect(body).not.toContain("line-5&quot;");
    expect(body).not.toContain('"line-5"');
    // Registry projects.
    expect(body).toContain("/work/p");
    expect(body).toContain("vcs git");
  });

  test("an ended sbx run keeping its lock: the holder and the in-VM deadline", async () => {
    const fx = await populated();
    const body = await (await fx.call("GET")).text();
    const deadline = (await fx.queue.recordedWorker(fx.queue.get(fx.sbx.run_id)!, false)).worker!.deadline!;
    const card = body.slice(body.indexOf('<section id="locks">'), body.indexOf('<section id="status-blocks">'));
    expect(card).toContain(`run ${fx.sbx.run_id} (job run-epic, pid`);
    expect(card).toContain(`deadline ${deadline}`);
  });

  test("a cancelled run keeping its lock for its live driver: the holder, the text, no deadline", async () => {
    const fx = await populated();
    const body = await (await fx.call("GET")).text();
    const locks = body.slice(body.indexOf('<section id="locks">'), body.indexOf('<section id="status-blocks">'));
    const card = locks.split('<div class="card">').find((c) => c.includes(fx.cancelled.run_id))!;
    expect(card).toContain(`run ${fx.cancelled.run_id} (job nightly, pid ${A.pid}`);
    expect(card).toContain("kept for its live driver");
    expect(card).not.toContain("deadline");
  });

  test("more than 50 runs: the oldest run's kept lock still shows its holder, state and reason", async () => {
    const fx = fixture();
    const oldest = fx.enqueue("oldest-keeper", fx.checkout());
    await fx.queue.claim(oldest.run_id, A);
    const reason = `cancelled over the API; guard: ${"r".repeat(120)} END-OF-KEPT-REASON`;
    fx.queue.end(oldest.run_id, "cancelled", reason, { holdLock: "its live driver", driverLive: true });
    const filler = fx.checkout();
    for (let i = 0; i < 55; i++) fx.enqueue(`filler-${i}`, filler);
    const body = await (await fx.call("GET")).text();
    const runs = body.slice(body.indexOf('<section id="runs">'), body.indexOf('<section id="locks">'));
    expect(runs).not.toContain(`id="run-${oldest.run_id}"`);
    expect(runs).toContain("6 older runs not shown");
    const locks = body.slice(body.indexOf('<section id="locks">'), body.indexOf('<section id="status-blocks">'));
    const card = locks.split('<div class="card">').find((c) => c.includes(oldest.run_id))!;
    expect(card).toBeDefined();
    expect(card).toContain(`run ${oldest.run_id} (job oldest-keeper, pid ${A.pid}`);
    expect(card).toContain('<span class="st">cancelled</span>');
    expect(card).toContain(`<p class="reason">${reason}</p>`);
  });

  test("a long reason is rendered whole", async () => {
    const fx = await populated();
    const body = await (await fx.call("GET")).text();
    expect(fx.longReason.length).toBeGreaterThan(300);
    expect(body).toContain(fx.longReason);
  });

  test("worker-kill and lock-released events render as stored", async () => {
    const fx = await populated();
    fx.queue.noteWorkerKill(fx.cancelled.run_id, { pid: 1, start: null, outcome: "killed" }, "spawned after the run was cancelled");
    fx.queue.db.query("INSERT INTO events (run_id, at, kind, from_state, to_state, detail) VALUES (?, ?, 'lock-released', 'cancelled', 'cancelled', NULL)")
      .run(fx.cancelled.run_id, new Date().toISOString());
    const body = await (await fx.call("GET")).text();
    expect(body).toContain("<strong>worker-kill</strong>");
    expect(body).toContain("<strong>lock-released</strong>");
  });

  test("missing store files: section notes naming the store-relative path, never a 500", async () => {
    const fx = fixture();
    const a = fx.enqueue("no-studio", fx.checkout());
    fx.queue.end(a.run_id, "partial", "never minted");
    const b = fx.enqueue("no-workspace", fx.checkout());
    await fx.queue.claim(b.run_id, A);
    fx.queue.setStudioRun(b.run_id, "no-workspace-1");
    fx.queue.end(b.run_id, "blocked", "x");
    const c = fx.enqueue("bad-json", fx.checkout());
    await fx.queue.claim(c.run_id, A);
    fx.queue.setStudioRun(c.run_id, "bad-json-1");
    fx.queue.end(c.run_id, "blocked", "x");
    writeFileSync(join(fx.workspace("bad-json-1"), "run.json"), "{not json");
    const res = await fx.call("GET");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("no studio run recorded");
    expect(body).toContain("projects/p/runs/no-workspace-1/run.json not found");
    expect(body).toContain("projects/p/runs/bad-json-1/run.json is not valid JSON");
    expect(body).toContain("projects/p/runs/bad-json-1/handoff.json not found");
    expect(body).toContain("measurements/op-box.jsonl not found");
    expect(body).not.toContain(fx.store);
  });

  test("a registry failure: a note in its section, never a 500", async () => {
    const fx = fixture({ registry: async () => { throw new Error("registry: unreadable registry"); } });
    const res = await fx.call("GET");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("registry show failed: registry: unreadable registry");
  });

  test("the store root is TK_STUDIO_HOME when set, else ~/.tk-studio", () => {
    expect(studioHome({ TK_STUDIO_HOME: " /s/store " })).toBe("/s/store");
    expect(studioHome({})).toMatch(/\.tk-studio$/);
  });

  test("the ledger is read from its end: the last lines only", () => {
    const dir = tempDir("tk-sup-page-tail-");
    const f = join(dir, "l.jsonl");
    writeFileSync(f, Array.from({ length: 5000 }, (_, i) => `{"n":${i},"pad":"${"p".repeat(40)}"}`).join("\n") + "\n");
    const tail = tailLines(f, 3);
    expect(tail.map((l) => JSON.parse(l).n)).toEqual([4997, 4998, 4999]);
  });
});

describe("reads only, and no credential (AC3)", () => {
  test("several GETs write nothing to the queue or to the store", async () => {
    const fx = await populated();
    fx.queue.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const before = { db: dbBytes(fx.dir), seq: maxSeq(fx.queue), store: listing(fx.store) };
    for (let i = 0; i < 3; i++) expect((await fx.call("GET")).status).toBe(200);
    expect((await fx.call("POST")).status).toBe(405);
    expect({ db: dbBytes(fx.dir), seq: maxSeq(fx.queue), store: listing(fx.store) }).toEqual(before);
  });

  test("credentials planted in run.json, handoff.json, the ledger and a run reason never appear", async () => {
    const fx = await populated();
    const body = await (await fx.call("GET")).text();
    for (const v of [...PLANTED, "nested-planted-token-1", "handoff-planted-secret", "ledger-planted-token"]) expect(body).not.toContain(v);
    expect(body).toContain("[redacted]");
  });

  test("the page's ledger line is exactly redactLedgerLine's output (one redaction path, NFR5)", async () => {
    const fx = await populated();
    const body = await (await fx.call("GET")).text();
    const line = JSON.stringify({ n: 40, kind: "measure", token: "ledger-planted-token", text: LEAKY });
    const env = { TK_STUDIO_HOME: fx.store, TK_SUPERVISOR_TELEGRAM_TOKEN: TELEGRAM, TK_SUPERVISOR_OTHER_TOKEN: OTHER_TOKEN };
    const redacted = redactLedgerLine(line, env, TOKEN);
    expect(redacted).not.toContain("ledger-planted-token");
    const esc = redacted.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    expect(body).toContain(esc);
  });

  test("redactCredentials: each shape", () => {
    const env = { TK_SUPERVISOR_TELEGRAM_TOKEN: TELEGRAM, TK_SUPERVISOR_BIND: "100.64.0.1" };
    const out = redactCredentials(`${LEAKY} {"password": "${PASSWORD}", "api_key": "${API_KEY}", "total_tokens": 1234} SECRET=abc123`, env, TOKEN);
    for (const v of [TOKEN, TELEGRAM, BEARER, SK_ANT, GHP, PASSWORD, API_KEY, "abc123"]) expect(out).not.toContain(v);
    // Not credential-named: kept.
    expect(out).toContain('"total_tokens": 1234');
    expect(redactCredentials("bind 100.64.0.1", env, TOKEN)).toBe("bind 100.64.0.1");
  });

  test("Story 22.5: every TK_SUPERVISOR_*SECRET* value is redacted exactly, on the page too", async () => {
    const secrets = { TK_SUPERVISOR_SESSION_SECRET: "plain-session-secret-value", TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET: "plain-google-secret", TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET: "plain-github-secret" };
    expect(redactCredentials("x plain-session-secret-value y plain-google-secret z plain-github-secret", secrets, TOKEN)).toBe("x [redacted] y [redacted] z [redacted]");
    const fx = await populated({ env: secrets });
    const run = fx.enqueue("leaky", fx.checkout());
    fx.queue.end(run.run_id, "partial", `failed near ${Object.values(secrets).join(" ")}`);
    const body = await (await fx.call("GET")).text();
    for (const v of Object.values(secrets)) expect(body).not.toContain(v);
  });
});

describe("review patches", () => {
  test("tailLines: a multi-byte character straddling a chunk boundary stays whole", () => {
    const dir = tempDir("tk-sup-page-utf8-");
    const f = join(dir, "l.jsonl");
    // The em dash's first byte sits just before the last 8 KiB chunk; its other two bytes inside it.
    const after = Array.from({ length: 30 }, (_, i) => `{"n":${i}}`).join("\n") + "\n";
    const lineEnd = `-end"}\n`;
    const pad = "p".repeat(8190 - Buffer.byteLength(lineEnd + after));
    const target = `{"text":"before\u2014${pad}${lineEnd.slice(0, -1)}`;
    const head = Array.from({ length: 50 }, (_, i) => `{"h":${i}}`).join("\n") + "\n";
    const content = `${head}${target}\n${after}`;
    writeFileSync(f, content);
    const bytes = Buffer.from(content, "utf-8");
    const dash = bytes.indexOf(Buffer.from("\u2014", "utf-8"));
    expect(dash).toBe(bytes.length - 8193); // straddles the boundary at size - 8192
    const tail = tailLines(f, 31);
    expect(tail[0]).toBe(target);
    expect(tail.join("\n")).not.toContain("\uFFFD");
    expect(JSON.parse(tail[0]).text.startsWith("before\u2014p")).toBe(true);
  });

  test("a Telegram token right after /bot in an API URL is redacted", () => {
    const tg = "987654321:AAHfakeTelegramTokenValue_0123456789-xyz";
    const out = redactCredentials(`POST https://api.telegram.org/bot${tg}/sendMessage failed`, {}, TOKEN);
    expect(out).not.toContain(tg);
    expect(out).not.toContain("AAHfakeTelegramTokenValue");
    expect(out).toContain("https://api.telegram.org/bot[redacted]/sendMessage");
  });

  test("private key, cookie and session key/token names are redacted; session_id stays visible", async () => {
    const keys = ["private_key", "privateKey", "private-key", "cookie", "session_key", "session_token"];
    const text = keys.map((k, i) => `${k}=planted-v${i}-zz`).join(" ") + ` session_id=keep-this-session-id`;
    const out = redactCredentials(text, {}, TOKEN);
    keys.forEach((_, i) => expect(out).not.toContain(`planted-v${i}-zz`));
    expect(out).toContain("session_id=keep-this-session-id");
    // Parsed JSON: run.json on the page.
    const fx = fixture();
    const r = fx.enqueue("keys", fx.checkout());
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, "keys-1");
    fx.queue.end(r.run_id, "complete", "ok");
    writeFileSync(join(fx.workspace("keys-1"), "run.json"), JSON.stringify({
      ...Object.fromEntries(keys.map((k, i) => [k, `json-planted-v${i}-zz`])), session_id: "keep-json-session-id",
    }));
    const body = await (await fx.call("GET")).text();
    keys.forEach((_, i) => expect(body).not.toContain(`json-planted-v${i}-zz`));
    expect(body).toContain("keep-json-session-id");
  });

  test("JSON embedded in a string leaf (run.json, handoff.json, an event detail) never renders its value", async () => {
    const fx = fixture();
    const r = fx.enqueue("embedded", fx.checkout());
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, "embedded-1");
    fx.queue.end(r.run_id, "complete", "ok");
    const ws = fx.workspace("embedded-1");
    writeFileSync(join(ws, "run.json"), JSON.stringify({ note: JSON.stringify({ password: "runjson-embedded-pw" }) }));
    writeFileSync(join(ws, "handoff.json"), JSON.stringify({ blob: `{"api_key": "handoff-embedded-key"}` }));
    fx.queue.db.query("INSERT INTO events (run_id, at, kind, from_state, to_state, detail) VALUES (?, ?, 'note', 'complete', 'complete', ?)")
      .run(r.run_id, new Date().toISOString(), JSON.stringify({ raw: JSON.stringify({ secret: "event-embedded-secret" }) }));
    const body = await (await fx.call("GET")).text();
    for (const v of ["runjson-embedded-pw", "handoff-embedded-key", "event-embedded-secret"]) expect(body).not.toContain(v);
  });

  test("a live-driver lock whose owner is dead: named as freeable, not as kept for its live driver", async () => {
    const fx = fixture();
    const B: Owner = { pid: 930002, host: HOST, nonce: "page-nonce-b" }; // the fixture's probe: only A is alive
    const r = fx.enqueue("dead-driver", fx.checkout());
    await fx.queue.claim(r.run_id, B);
    fx.queue.end(r.run_id, "cancelled", "cancelled over the API", { holdLock: "its live driver", driverLive: true });
    const body = await (await fx.call("GET")).text();
    const locks = body.slice(body.indexOf('<section id="locks">'), body.indexOf('<section id="status-blocks">'));
    const card = locks.split('<div class="card">').find((c) => c.includes(r.run_id))!;
    expect(card).toContain(`run ${r.run_id} (job dead-driver, pid ${B.pid}`);
    expect(card).toContain("kept by a driver no longer alive: the next claim or recover frees it");
    expect(card).not.toContain("kept for its live driver");
  });

  test("an sbx lock past its in-VM deadline: named as passed, the deadline still shown (injected clock)", async () => {
    let clock = Date.now();
    const fx = fixture({ now: () => clock });
    const sbx = fx.enqueue("run-epic", fx.checkout(), { tier: "sbx", sandbox: "sb" });
    await fx.queue.claim(sbx.run_id, A);
    fx.queue.setWorker(sbx.run_id, 4242, "999", 600);
    fx.queue.end(sbx.run_id, "partial", "worker may still run", { holdLock: "sbx worker may still run" });
    const cardOf = async () => {
      const body = await (await fx.call("GET")).text();
      const locks = body.slice(body.indexOf('<section id="locks">'), body.indexOf('<section id="status-blocks">'));
      return locks.split('<div class="card">').find((c) => c.includes(sbx.run_id))!;
    };
    const deadline = (await fx.queue.recordedWorker(fx.queue.get(sbx.run_id)!, false)).worker!.deadline!;
    const before = await cardOf();
    expect(before).toContain("kept until its sbx worker&#39;s in-VM deadline");
    expect(before).toContain(`deadline ${deadline}`);
    clock = Date.parse(deadline) + 1000;
    const after = await cardOf();
    expect(after).toContain("in-VM deadline passed: the next claim or recover frees it");
    expect(after).not.toContain("kept until its sbx worker&#39;s in-VM deadline");
    expect(after).toContain(`deadline ${deadline}`);
    expect(fx.queue.locks().some((l) => l.run_id === sbx.run_id)).toBe(true); // the page frees nothing
  });

  test("holderOf lives in page.ts; /status names holders as before", async () => {
    const fx = await populated();
    const status = await (await fx.call("GET", "/status")).json() as { locks: { checkout: string; root: string; acquired: string; holder: unknown }[] };
    expect(status.locks).toEqual(fx.queue.locks().map((l) => ({ checkout: l.checkout, root: l.root, acquired: l.acquired, holder: holderOf(l) })));
    const src = readFileSync(join(import.meta.dir, "..", "src", "page.ts"), "utf-8");
    expect(src).not.toMatch(/from "\.\/api"/);
  });
});

describe("follow-up review patches", () => {
  const lockCard = async (fx: ReturnType<typeof fixture>, runId: string) => {
    const body = await (await fx.call("GET")).text();
    const locks = body.slice(body.indexOf('<section id="locks">'), body.indexOf('<section id="status-blocks">'));
    return locks.split('<div class="card">').find((c) => c.includes(runId))!;
  };
  /** An ended host-tier run that kept its lock for its recorded worker. */
  const hostKeeper = async (fx: ReturnType<typeof fixture>) => {
    const r = fx.enqueue("host-keeper", fx.checkout());
    await fx.queue.claim(r.run_id, A);
    fx.queue.setWorker(r.run_id, 5151, "777");
    fx.queue.end(r.run_id, "partial", "worker may still run", { holdLock: "its recorded worker may still run" });
    return r;
  };

  test("an ended host-tier run whose recorded worker is alive: may run (probe only, no signal)", async () => {
    const probed: number[] = [];
    const fx = fixture({ probeWorker: (pid, start) => { probed.push(pid); return { pid, start, outcome: "running" }; } });
    const r = await hostKeeper(fx);
    const card = await lockCard(fx, r.run_id);
    expect(card).toContain("kept while its recorded worker (pid 5151) may run");
    expect(card).not.toContain("deadline");
    expect(probed).toEqual([5151]);
    expect(fx.queue.locks().some((l) => l.run_id === r.run_id)).toBe(true);
  });

  test("an ended host-tier run whose recorded worker is gone: named as freeable", async () => {
    const fx = fixture({ probeWorker: (pid, start) => ({ pid, start, outcome: "not running" }) });
    const r = await hostKeeper(fx);
    const card = await lockCard(fx, r.run_id);
    expect(card).toContain("recorded worker (pid 5151) is gone: the next claim or recover frees it");
    expect(card).not.toContain("may run");
    expect(fx.queue.locks().some((l) => l.run_id === r.run_id)).toBe(true); // the page frees nothing
  });

  test("a worker probe that throws: the unknown wording, no deadline, no live-worker claim", async () => {
    const fx = fixture({ probeWorker: () => { throw new Error("probe exploded"); } });
    const r = await hostKeeper(fx);
    const card = await lockCard(fx, r.run_id);
    expect(card).toContain("kept for its recorded worker (pid 5151) (liveness unknown)");
    expect(card).not.toContain("may run");
    expect(card).not.toContain("deadline");
    // sbx: a throwing probe names no deadline.
    const sbx = fx.enqueue("run-epic", fx.checkout(), { tier: "sbx", sandbox: "sb" });
    await fx.queue.claim(sbx.run_id, A);
    fx.queue.setWorker(sbx.run_id, 4242, "999", 600);
    fx.queue.end(sbx.run_id, "partial", "worker may still run", { holdLock: "sbx worker may still run" });
    fx.queue.recordedWorker = async () => { throw new Error("probe exploded"); };
    const sbxCard = await lockCard(fx, sbx.run_id);
    expect(sbxCard).toContain("kept for its sbx worker (deadline unknown)");
    expect(sbxCard).not.toContain("deadline 2");
    expect(sbxCard).not.toContain("in-VM deadline");
  });

  test("running runs with a recorded worker: held by the run; sbx shows its deadline, host is never probed", async () => {
    const probed: number[] = [];
    const fx = fixture({ probeWorker: (pid, start) => { probed.push(pid); return { pid, start, outcome: "running" }; } });
    const sbx = fx.enqueue("run-epic", fx.checkout(), { tier: "sbx", sandbox: "sb" });
    await fx.queue.claim(sbx.run_id, A);
    fx.queue.setWorker(sbx.run_id, 4242, "999", 600);
    const host = fx.enqueue("host-running", fx.checkout());
    await fx.queue.claim(host.run_id, A);
    fx.queue.setWorker(host.run_id, 6161, "888");
    expect(fx.queue.get(sbx.run_id)!.state).toBe("running");
    expect(fx.queue.get(host.run_id)!.state).toBe("running");
    const deadline = (await fx.queue.recordedWorker(fx.queue.get(sbx.run_id)!, false)).worker!.deadline!;
    const sbxCard = await lockCard(fx, sbx.run_id);
    expect(sbxCard).toContain("held by its running run");
    expect(sbxCard).toContain(`deadline ${deadline}`);
    const hostCard = await lockCard(fx, host.run_id);
    expect(hostCard).toContain("held by its running run");
    expect(hostCard).not.toContain("deadline");
    expect(probed).not.toContain(6161);
  });

  test("a registry failure naming machine paths: store-relative in the note (AD-15)", async () => {
    const studio = "/opt/planted-studio-root-xyz";
    let store = "";
    const home = join(homedir(), "planted-home-file");
    const fx = fixture({
      env: { TK_STUDIO_ROOT: studio },
      registry: async () => {
        throw new Error(`registry show emitted no JSON (exit 1): open ${store}/registry.yaml; ${store.replace(/\//g, "\\")}\\registry.yaml; `
          + `${studio}/plugins/tk-studio/lib/registry.py; cache ${home}`);
      },
    });
    store = fx.store;
    const res = await fx.call("GET");
    expect(res.status).toBe(200);
    const body = await res.text();
    const section = body.slice(body.indexOf('<section id="registry">'));
    expect(section).toContain("registry show failed: registry show emitted no JSON (exit 1)");
    expect(section).toContain("~/.tk-studio/registry.yaml");
    expect(section).toContain("&lt;studio&gt;/plugins/tk-studio/lib/registry.py");
    // The home prefix becomes `~`; the rest of the path keeps its own separator (`\` on win32).
    expect(section).toContain(`cache ~${sep}planted-home-file`);
    for (const abs of [fx.store, fx.store.replace(/\//g, "\\"), studio, home, homedir() + "/"]) expect(body).not.toContain(abs);
  });

  const safe = (s: string) => s.replace(/[^A-Za-z0-9._\-]/g, "_");
  const ledgerFile = (store: string, user: string, marker: string) => {
    mkdirSync(join(store, "measurements"), { recursive: true });
    writeFileSync(join(store, "measurements", `${safe(user)}-${safe(hostname())}.jsonl`), JSON.stringify({ kind: "measure", marker }) + "\n");
  };

  test("the default ledger identity: LOGNAME wins over USER, with this machine's hostname", async () => {
    const fx = fixture({ ledger: null, env: { LOGNAME: "log-name", USER: "user-name" } });
    ledgerFile(fx.store, "log-name", "logname-ledger-line");
    ledgerFile(fx.store, "user-name", "user-ledger-line");
    const body = await (await fx.call("GET")).text();
    expect(body).toContain(`measurements/log-name-${safe(hostname())}.jsonl`);
    expect(body).toContain("logname-ledger-line");
    expect(body).not.toContain("user-ledger-line");
  });

  test("the default ledger identity: USER when LOGNAME is absent", async () => {
    const fx = fixture({ ledger: null, env: { USER: "user-name" } });
    ledgerFile(fx.store, "user-name", "user-ledger-line");
    const body = await (await fx.call("GET")).text();
    expect(body).toContain(`measurements/user-name-${safe(hostname())}.jsonl`);
    expect(body).toContain("user-ledger-line");
  });

  test("the default ledger identity: unsafe characters become _ (safe_name)", async () => {
    const fx = fixture({ ledger: null, env: { USER: "jane doe@corp" } });
    ledgerFile(fx.store, "jane doe@corp", "safe-name-ledger-line");
    const body = await (await fx.call("GET")).text();
    expect(body).toContain(`measurements/jane_doe_corp-${safe(hostname())}.jsonl`);
    expect(body).toContain("safe-name-ledger-line");
  });

  /** A run with no project id, ended with a studio run minted. */
  const unkeyedRun = async (fx: ReturnType<typeof fixture>, root: string, studioRunId: string) => {
    const r = fx.queue.enqueue({ jobId: `unkeyed-${studioRunId}`, root, target: "skill",
      definition: { id: `unkeyed-${studioRunId}`, trigger: "one-shot", target: { skill: "tk-studio-activate" } } }).run;
    expect(r.project_id).toBeNull();
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, studioRunId);
    fx.queue.end(r.run_id, "complete", "ok");
    return r;
  };
  const runJsonAt = (store: string, key: string, studioRunId: string, marker: string) => {
    const ws = join(store, "projects", key, "runs", studioRunId);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "run.json"), JSON.stringify({ marker }));
  };

  test("the project key without a run project id: the checkout's .tk-studio/config.yaml project_id", async () => {
    const fx = fixture();
    const root = fx.checkout();
    mkdirSync(join(root, ".tk-studio"), { recursive: true });
    writeFileSync(join(root, ".tk-studio", "config.yaml"), "project_id: cfg-proj\n");
    await unkeyedRun(fx, root, "cfg-run-1");
    runJsonAt(fx.store, "cfg-proj", "cfg-run-1", "config-keyed-run-json");
    const body = await (await fx.call("GET")).text();
    expect(body).toContain("projects/cfg-proj/runs/cfg-run-1");
    expect(body).toContain("config-keyed-run-json");
  });

  test("the project key with neither: the checkout's basename", async () => {
    const fx = fixture();
    const root = fx.checkout();
    await unkeyedRun(fx, root, "base-run-1");
    const key = safe(basename(root));
    runJsonAt(fx.store, key, "base-run-1", "basename-keyed-run-json");
    const body = await (await fx.call("GET")).text();
    expect(body).toContain(`projects/${key}/runs/base-run-1`);
    expect(body).toContain("basename-keyed-run-json");
  });
});

describe("second follow-up review patches", () => {
  /** An ended run with the given reason. */
  const endedWith = async (fx: ReturnType<typeof fixture>, jobId: string, reason: string) => {
    const r = fx.enqueue(jobId, fx.checkout());
    await fx.queue.claim(r.run_id, A);
    fx.queue.end(r.run_id, "partial", reason);
    return r;
  };
  const registrySection = async (fx: ReturnType<typeof fixture>) => {
    const res = await fx.call("GET");
    expect(res.status).toBe(200);
    const body = await res.text();
    const at = body.indexOf('<section id="registry">');
    return { body, section: body.slice(at, body.indexOf("</section>", at)) };
  };

  test("redactCredentials: a credential in JSON escaped once or twice inside free text", () => {
    const once = JSON.stringify({ detail: JSON.stringify({ password: "once-escaped-pw", note: "once-sibling" }) });
    const twice = JSON.stringify({ detail: JSON.stringify({ inner: JSON.stringify({ api_key: 'tw1ce"esc4ped\\v4l', note: "twice-sibling" }) }) });
    const outOnce = redactCredentials(`failed: ${once} (exit 1)`, {}, TOKEN);
    expect(outOnce).toBe(`failed: {"detail":"{\\"password\\":\\"[redacted]\\",\\"note\\":\\"once-sibling\\"}"} (exit 1)`);
    const outTwice = redactCredentials(twice, {}, TOKEN);
    for (const v of ["tw1ce", "esc4ped", "v4l"]) expect(outTwice).not.toContain(v);
    expect(outTwice).toContain("twice-sibling");
    expect(outTwice).toContain('\\\\\\"api_key\\\\\\":\\\\\\"[redacted]\\\\\\"');
    // Already redacted: left as it is (no double processing).
    for (const s of [outOnce, outTwice, `{"password": "[redacted]"} password=[redacted] tail`]) expect(redactCredentials(s, {}, TOKEN)).toBe(s);
  });

  test("a credential in once- and twice-escaped JSON in a run reason never renders; its sibling does", async () => {
    const fx = fixture();
    await endedWith(fx, "escaped-once", `worker failed: ${JSON.stringify({ detail: JSON.stringify({ password: "reason-once-pw", note: "reason-once-sibling" }) })}`);
    await endedWith(fx, "escaped-twice", `worker failed: ${JSON.stringify({ detail: JSON.stringify({ inner: JSON.stringify({ secret: "reason-twice-secret", note: "reason-twice-sibling" }) }) })}`);
    const body = await (await fx.call("GET")).text();
    for (const v of ["reason-once-pw", "reason-twice-secret"]) expect(body).not.toContain(v);
    for (const v of ["reason-once-sibling", "reason-twice-sibling"]) expect(body).toContain(v);
  });

  test("a single-quoted credential in a run reason's free text never renders; its sibling does", async () => {
    const fx = fixture();
    await endedWith(fx, "single-quoted", "worker failed: password='s1ngle-qu0ted-secret' note='single-sibling' (exit 1)");
    const body = await (await fx.call("GET")).text();
    expect(body).not.toContain("s1ngle-qu0ted-secret");
    expect(body).toContain("single-sibling");
  });

  test("credentialKey: camelCase keys starting with the credential word; count-shaped keys are not", () => {
    for (const k of ["secretKey", "SecretAccessKey", "tokenValue", "passwordHash", "apiKeyId",
      "aws_secret_access_key", "privateKey", "session_key", "cookie", "Authorization"]) expect([k, credentialKey(k)]).toEqual([k, true]);
    for (const k of ["total_tokens", "input_tokens", "session_id", "tokenCount", "tokensUsed"]) expect([k, credentialKey(k)]).toEqual([k, false]);
  });

  test("camelCase credential keys in run.json and handoff.json: values absent from the page", async () => {
    const fx = fixture();
    const r = fx.enqueue("camel", fx.checkout());
    await fx.queue.claim(r.run_id, A);
    fx.queue.setStudioRun(r.run_id, "camel-1");
    fx.queue.end(r.run_id, "complete", "ok");
    const ws = fx.workspace("camel-1");
    writeFileSync(join(ws, "run.json"), JSON.stringify({ secretKey: "camel-planted-1", SecretAccessKey: "camel-planted-2", tokenValue: "camel-planted-3", tokenCount: 987654 }));
    writeFileSync(join(ws, "handoff.json"), JSON.stringify({ passwordHash: "camel-planted-4", apiKeyId: "camel-planted-5", tokensUsed: 135791 }));
    const body = await (await fx.call("GET")).text();
    for (let i = 1; i <= 5; i++) expect(body).not.toContain(`camel-planted-${i}`);
    expect(body).toContain("&quot;tokenCount&quot;: 987654");
    expect(body).toContain("&quot;tokensUsed&quot;: 135791");
  });

  test("a registry failure naming Windows paths as a Python repr (doubled backslashes, other drive-letter case): no absolute path", async () => {
    const store = "C:\\Users\\planted\\.tk-studio", studio = "D:\\planted-studio-root";
    const dbl = (p: string) => p.replace(/[\\/]/g, "\\\\");
    const lowerDrive = (p: string) => p[0].toLowerCase() + p.slice(1);
    const fx = fixture({
      env: { TK_STUDIO_HOME: store, TK_STUDIO_ROOT: studio },
      registry: async () => {
        throw new Error(`registry show emitted no JSON (exit 1): FileNotFoundError: [Errno 2] No such file: '${dbl(lowerDrive(store))}\\\\registry.yaml'; `
          + `'${dbl(lowerDrive(studio))}\\\\plugins\\\\tk-studio\\\\lib\\\\registry.py'; ${lowerDrive(studio)}\\lib; cache '${dbl(homedir())}\\\\cache'`);
      },
    });
    const { body, section } = await registrySection(fx);
    expect(section).toContain("~/.tk-studio\\\\registry.yaml");
    expect(section).toContain("&lt;studio&gt;\\\\plugins\\\\tk-studio\\\\lib\\\\registry.py");
    expect(section).toContain("&lt;studio&gt;\\lib");
    expect(section).toContain("~\\\\cache");
    expect(section).not.toMatch(/[A-Za-z]:\\/);
    for (const abs of ["Users", "planted-studio-root", dbl(homedir()), homedir()]) expect(body).not.toContain(abs);
  });

  test("a machine path substitutes only where the path ends: longer siblings are not mangled", async () => {
    const home = homedir();
    const fx = fixture({
      env: { TK_STUDIO_HOME: "/s/store" },
      registry: async () => { throw new Error(`open /s/store2/registry.yaml; open /s/store/registry.yaml; cache ${home}othy/x; home ${home}/y`); },
    });
    const { section } = await registrySection(fx);
    expect(section).toContain("open /s/store2/registry.yaml");
    expect(section).not.toContain("~/.tk-studio2");
    expect(section).toContain("open ~/.tk-studio/registry.yaml");
    expect(section).toContain(`cache ${home}othy/x`);
    expect(section).not.toContain("~othy");
    expect(section).toContain("home ~/y");
  });
});
