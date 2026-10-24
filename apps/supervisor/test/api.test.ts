import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ApiBindRefused, checkBind, checkResumeBody, checkSubmitBody, createApi, serve, type ApiDeps, type SubmitBody } from "../src/api";
import { csrfToken, SESSION_COOKIE, signSession } from "../src/auth";
import { ResumeRefused } from "../src/closeout";
import { CancelRaced, cancelRun, CANCELLED_REASON, endCancelledLeftovers, launchStopGraceful, mirror, queueRecorder, recordMinted, StartError, type RunSummary } from "../src/cli";
import { ApiBindMissing, ApiPortInvalid, ApiTokenMissing, apiBind, apiPort, apiToken } from "../src/env";
import { END_HYGIENE_EVENTS } from "../src/hygiene";
import { type QueueEvent, Queue, RunTerminal, STUDIO_END_RETRY_LIMIT, type EngineProbe, type Owner, type Probes, type QueueRun, type WorkerKill } from "../src/queue";
import { fakeBin } from "./fakes";

const REPO = resolve(import.meta.dir, "..");

/** Story 22.3: the operator's run-hygiene variables (User scope on the Windows host) must never
 * reach this suite — its in-process paths and every child it spawns through `...process.env` would
 * send real notifications, copy transcripts into the real backup and snapshot into the real work
 * folder. They are cleared for the suite (restored after it); a test that needs one sets it
 * explicitly (a fixture's `env`, or `process.env` inside the test). */
const OPERATOR_HYGIENE_VARS = [
  "TK_SUPERVISOR_NOTIFY", "TK_SUPERVISOR_NTFY_URL", "TK_SUPERVISOR_TELEGRAM_TOKEN", "TK_SUPERVISOR_TELEGRAM_CHAT",
  "TK_SUPERVISOR_TRANSCRIPT_BACKUP", "TK_SUPERVISOR_WORK",
  // Story 22.5: the phone sign-in's variables (a `serve` spawned below must not read the operator's).
  "TK_SUPERVISOR_SESSION_SECRET", "TK_SUPERVISOR_TLS_CERT", "TK_SUPERVISOR_TLS_KEY", "TK_SUPERVISOR_TLS_NAME",
  "TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID", "TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET", "TK_SUPERVISOR_OAUTH_GOOGLE_ALLOW",
  "TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_ID", "TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET", "TK_SUPERVISOR_OAUTH_GITHUB_ALLOW",
] as const;
const operatorHygiene: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of OPERATOR_HYGIENE_VARS) { operatorHygiene[k] = process.env[k]; delete process.env[k]; }
});
afterAll(() => {
  for (const k of OPERATOR_HYGIENE_VARS) { if (operatorHygiene[k] === undefined) delete process.env[k]; else process.env[k] = operatorHygiene[k]; }
});

/** A run's lifecycle events: every event but the end hygiene's (Story 22.3), which follows each end. */
const lifecycle = (q: Queue, runId?: string, since?: number): QueueEvent[] =>
  q.events(runId, since).filter((e) => !(END_HYGIENE_EVENTS as readonly string[]).includes(e.kind));

const TOKEN = "tok-3f9a1c-very-secret-value";
const HOST = hostname();
const A: Owner = { pid: 920001, host: HOST, nonce: "api-nonce-a" };
const B: Owner = { pid: 920002, host: HOST, nonce: "api-nonce-b" };
const BASE = "http://100.100.1.2:8787";

// Every console line written while this suite runs: the token must never be among them.
const captured: string[] = [];
const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
beforeAll(() => {
  for (const k of Object.keys(originals) as (keyof typeof originals)[]) {
    console[k] = (...args: unknown[]) => { captured.push(args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")); };
  }
});
afterAll(() => {
  Object.assign(console, originals);
  expect(captured.filter((l) => l.includes(TOKEN))).toEqual([]);
});

interface FxOpts {
  killWorker?: Probes["killWorker"]; engine?: (id: string | null) => EngineProbe; now?: () => number;
  submit?: ApiDeps["submit"]; cancel?: ApiDeps["cancel"]; resume?: ApiDeps["resume"];
}

function fixture(o: FxOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-api-"));
  const checkout = mkdtempSync(join(tmpdir(), "tk-sup-api-checkout-"));
  const probes: Probes = {
    ownerAlive: (w) => w.pid === A.pid,
    engineLive: async (_root, id) => (o.engine ?? (() => ({ live: false })))(id),
    killWorker: o.killWorker ?? (async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" })),
    ...(o.now ? { now: o.now } : {}),
  };
  const queue = new Queue(join(dir, "q.db"), probes);
  const enqueue = (jobId = "studio-health", extra: { skill?: string; tier?: string; sandbox?: string; target?: string } = {}) =>
    queue.enqueue({
      jobId, root: checkout, projectId: "p", target: extra.target ?? "skill", tier: extra.tier, sandbox: extra.sandbox,
      definition: { id: jobId, trigger: "one-shot", target: extra.target === "core" ? { core: "c" } : { skill: extra.skill ?? "tk-studio-activate" } },
    }).run;
  const submitted: SubmitBody[] = [];
  // A stand-in for the submit path: records the body and enqueues on this checkout, as `submitJob` does once validated.
  const submit = o.submit ?? (async (b: SubmitBody) => {
    submitted.push(b);
    const { run, minted } = queue.enqueue({ jobId: b.job, root: checkout, projectId: b.project, target: "skill",
      definition: { id: b.job }, tier: b.tier, model: b.model, effort: b.effort, base_ref: b.base_ref });
    return { ok: true, job_id: b.job, project_id: b.project, run_id: run.run_id, state: run.state, minted };
  });
  const handler = createApi({ queue, token: TOKEN, submit, ...(o.cancel ? { cancel: o.cancel } : {}), ...(o.resume ? { resume: o.resume } : {}), pollMs: 10 });
  const call = (method: string, path: string, init: { body?: string; auth?: string | null; headers?: Record<string, string> } = {}) =>
    handler(new Request(`${BASE}${path}`, {
      method, body: init.body,
      headers: { ...(init.auth === null ? {} : { authorization: init.auth ?? `Bearer ${TOKEN}` }), ...(init.headers ?? {}) },
    }));
  return { queue, checkout, enqueue, call, submitted, handler };
}

describe("bind, port and token (AC1)", () => {
  test("checkBind: only an IPv4 literal inside 100.64.0.0/10", () => {
    for (const ok of ["100.64.0.0", "100.100.1.2", "100.127.255.255"]) expect(checkBind(ok)).toBe(ok);
    for (const bad of ["0.0.0.0", "192.168.1.5", "100.128.0.1", "100.63.255.255", "127.0.0.1", "localhost", "::", "100.64.0", "100.064.0.1", "100.64.0.256", ""]) {
      expect(() => checkBind(bad)).toThrow(ApiBindRefused);
    }
    expect(() => checkBind("0.0.0.0")).toThrow(/^ApiBindRefused:/);
  });

  test("env getters: bind and token required, port defaults to 8787 and must be a port number", () => {
    expect(() => apiBind({})).toThrow(ApiBindMissing);
    expect(apiBind({ TK_SUPERVISOR_BIND: " 100.64.0.1 " })).toBe("100.64.0.1");
    expect(() => apiToken({})).toThrow(ApiTokenMissing);
    expect(() => apiToken({ TK_SUPERVISOR_TOKEN: "  " })).toThrow(ApiTokenMissing);
    expect(apiToken({ TK_SUPERVISOR_TOKEN: TOKEN })).toBe(TOKEN);
    expect(apiPort({})).toBe(8787);
    expect(apiPort({ TK_SUPERVISOR_PORT: "9001" })).toBe(9001);
    for (const bad of ["", "abc", "0", "65536", "80.5", "-1"]) expect(() => apiPort({ TK_SUPERVISOR_PORT: bad })).toThrow(ApiPortInvalid);
  });

  test("serve refuses before binding: bad bind, no token, bad port — each named, the token never in the message", () => {
    // Story 22.5: the session secret is required by `serve` too (its named error: test/auth.test.ts).
    const ok = { TK_SUPERVISOR_BIND: "100.64.0.1", TK_SUPERVISOR_TOKEN: TOKEN, TK_SUPERVISOR_SESSION_SECRET: "session-secret-for-api-tests-0123456789" };
    const refusal = (env: Record<string, string | undefined>) => { try { serve(env); } catch (e) { return (e as Error).message; } return "bound"; };
    for (const bind of ["0.0.0.0", "192.168.1.5", "100.128.0.1"]) expect(refusal({ ...ok, TK_SUPERVISOR_BIND: bind })).toStartWith("ApiBindRefused:");
    expect(refusal({ ...ok, TK_SUPERVISOR_BIND: undefined })).toStartWith("ApiBindMissing:");
    expect(refusal({ ...ok, TK_SUPERVISOR_TOKEN: undefined })).toStartWith("ApiTokenMissing:");
    expect(refusal({ ...ok, TK_SUPERVISOR_TOKEN: "" })).toStartWith("ApiTokenMissing:");
    expect(refusal({ ...ok, TK_SUPERVISOR_PORT: "http" })).toStartWith("ApiPortInvalid:");
    // Story 22.3: a selected notifier missing its variables is a named start error, never the token.
    const tg = { TK_SUPERVISOR_NOTIFY: "telegram", TK_SUPERVISOR_TELEGRAM_TOKEN: "123:tg-secret-value", TK_SUPERVISOR_TELEGRAM_CHAT: "" };
    expect(refusal({ ...ok, ...tg })).toStartWith("NotifierConfigMissing:");
    expect(refusal({ ...ok, ...tg })).not.toContain("tg-secret-value");
    expect(refusal({ ...ok, TK_SUPERVISOR_NOTIFY: "slack" })).toStartWith("NotifierUnknown:");
    expect(refusal({ ...ok, TK_SUPERVISOR_SESSION_SECRET: undefined })).toStartWith("SessionSecretMissing:");
    // All valid: the next check is the queue (unset here) — still before any bind.
    expect(refusal(ok)).toStartWith("QueueDbMissing:");
    for (const env of [{ ...ok, TK_SUPERVISOR_BIND: "0.0.0.0" }, { ...ok, TK_SUPERVISOR_PORT: "x" }]) expect(refusal(env)).not.toContain(TOKEN);
  });

  test("`serve` verb: exits 2 naming the error, never binds, never prints the token", () => {
    const run = (env: Record<string, string>) => spawnSync("bun", [join(REPO, "src", "cli.ts"), "serve"], {
      env: { ...process.env, TK_SUPERVISOR_BIND: "", TK_SUPERVISOR_TOKEN: "", ...env }, encoding: "utf-8", timeout: 30_000,
    });
    for (const [env, name] of [
      [{ TK_SUPERVISOR_BIND: "0.0.0.0", TK_SUPERVISOR_TOKEN: TOKEN }, "ApiBindRefused"],
      [{ TK_SUPERVISOR_BIND: "192.168.1.5", TK_SUPERVISOR_TOKEN: TOKEN }, "ApiBindRefused"],
      [{ TK_SUPERVISOR_TOKEN: TOKEN }, "ApiBindMissing"],
      [{ TK_SUPERVISOR_BIND: "100.64.0.1" }, "ApiTokenMissing"],
    ] as const) {
      const res = run(env);
      expect(res.status).toBe(2);
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false });
      expect(JSON.parse(res.stdout).error).toStartWith(`${name}:`);
      expect(`${res.stdout}${res.stderr}`).not.toContain(TOKEN);
    }
  }, 60_000);
});

describe("auth (AC2)", () => {
  test("a missing or wrong token gets 401 on every route, unknown paths included; the token is never echoed", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    const routes: [string, string][] = [["GET", "/jobs"], ["POST", "/jobs"], ["GET", `/runs/${run.run_id}`], ["POST", `/runs/${run.run_id}/cancel`],
      ["GET", "/status"], ["GET", "/events?since=0"], ["GET", "/nope"], ["DELETE", "/status"]];
    for (const auth of [null, "", `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(0, -1)}`, TOKEN, `Basic ${TOKEN}`, "Bearer "]) {
      for (const [method, path] of routes) {
        const res = await fx.call(method, path, { auth, body: method === "POST" ? JSON.stringify({ project: "p", job: "j" }) : undefined });
        expect(res.status).toBe(401);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({ ok: false, error: "Unauthorized" });
        expect(text).not.toContain(TOKEN);
      }
    }
    // Nothing submitted, nothing cancelled.
    expect(fx.submitted).toEqual([]);
    expect(fx.queue.get(run.run_id)!.state).toBe("queued");
  });

  test("the right token passes; an unknown path is then a 404", async () => {
    const fx = fixture();
    expect((await fx.call("GET", "/status")).status).toBe(200);
    expect((await fx.call("GET", "/nope")).status).toBe(404);
  });

  test("the scheme matches case-insensitively (RFC 7235); the token still must match", async () => {
    const fx = fixture();
    for (const auth of [`bearer ${TOKEN}`, `BEARER ${TOKEN}`, `BeArEr ${TOKEN}`]) expect((await fx.call("GET", "/status", { auth })).status).toBe(200);
    for (const auth of [`bearer ${TOKEN}x`, `bearer  ${TOKEN}`, `bearer${TOKEN}`]) expect((await fx.call("GET", "/status", { auth })).status).toBe(401);
  });
});

describe("POST /jobs (AC3)", () => {
  test("malformed JSON → 400 naming the parse failure, nothing queued", async () => {
    const fx = fixture();
    const res = await fx.call("POST", "/jobs", { body: "{not json" });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, string>;
    expect(body).toMatchObject({ ok: false, error: "MalformedJson" });
    expect(body.detail).toContain("not JSON");
    expect(fx.submitted).toEqual([]);
    expect(fx.queue.runs()).toEqual([]);
  });

  test("schema errors → 400 naming the field, nothing queued", async () => {
    const fx = fixture();
    const cases: [unknown, string][] = [
      [{ job: "j" }, "'project'"], [{ project: "p" }, "'job'"], [{ project: "p", job: "j", branch: "x" }, "'branch'"],
      [{ project: "p", job: "j", tier: 5 }, "'tier'"], [{ project: "p", job: "j", base_ref: "" }, "'base_ref'"],
      [{ project: 1, job: "j" }, "'project'"], [[], "JSON object"], [null, "JSON object"],
    ];
    for (const [body, field] of cases) {
      const res = await fx.call("POST", "/jobs", { body: JSON.stringify(body) });
      expect(res.status).toBe(400);
      const out = await res.json() as Record<string, string>;
      expect(out.error).toBe("SchemaError");
      expect(out.detail).toContain(field);
    }
    expect(fx.submitted).toEqual([]);
    expect(fx.queue.runs()).toEqual([]);
    expect(checkSubmitBody({ project: "p", job: "j", base_ref: "main", tier: "sbx", model: "m", effort: "low" }).ok).toBe(true);
  });

  test("Story 22.3: editor_in_the_loop is a boolean field, passed to the submit path; any other type is a SchemaError", async () => {
    expect(checkSubmitBody({ project: "p", job: "j", editor_in_the_loop: true }).ok).toBe(true);
    expect(checkSubmitBody({ project: "p", job: "j", editor_in_the_loop: false }).ok).toBe(true);
    for (const bad of ["true", 1, null, ""]) {
      expect(checkSubmitBody({ project: "p", job: "j", editor_in_the_loop: bad })).toEqual({ ok: false, detail: "field 'editor_in_the_loop' must be a boolean" });
    }
    const fx = fixture();
    const res = await fx.call("POST", "/jobs", { body: JSON.stringify({ project: "p", job: "godot-job", editor_in_the_loop: true }) });
    expect(res.status).toBe(200);
    expect(fx.submitted).toEqual([{ project: "p", job: "godot-job", editor_in_the_loop: true }]);
  });

  test("each named refusal → 400 with its name; unknown project / job → 400 naming the refusal; nothing queued", async () => {
    let next: Error = new Error("unset");
    const fx = fixture({ submit: async () => { throw next; } });
    const refused = (msg: string) => { const e = new StartError(msg); e.refused = true; return e; };
    for (const [err, name] of [
      [refused("HostBypassRefused: permission mode 'bypassPermissions' is forbidden on the host"), "HostBypassRefused"],
      [refused("TierRefused: tier 'gpu' is not one of host|sbx"), "TierRefused"],
      [refused("SbxSandboxMissing: the sbx tier needs a sandbox name"), "SbxSandboxMissing"],
      [new StartError("SupervisorConfigInvalid: TK_SUPERVISOR_CONFIG 'x' is unreadable"), "SupervisorConfigInvalid"],
      [refused("VmPathUnderivable: cannot derive the sbx microVM path of 'x'"), "VmPathUnderivable"],
      [refused("WorkDirMissing: TK_SUPERVISOR_WORK is not set — an editor-in-the-loop run needs the work folder its snapshot lands in"), "WorkDirMissing"],
      [refused("registry: unknown project_id 'ghost'"), "SubmitRefused"],
      [refused("resolve: unknown job id 'nope'"), "SubmitRefused"],
    ] as const) {
      next = err;
      const res = await fx.call("POST", "/jobs", { body: JSON.stringify({ project: "ghost", job: "nope" }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: name, detail: err.message });
    }
    expect(fx.queue.runs()).toEqual([]);
  });

  test("valid submit → 200 with the queue run id, studio_run_id and base_ref stored on the run", async () => {
    const fx = fixture();
    const res = await fx.call("POST", "/jobs", { body: JSON.stringify({ project: "p", job: "studio-health", base_ref: "main", tier: "host", model: "m1", effort: "low" }) });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ ok: true, state: "queued", studio_run_id: null, base_ref: "main", minted: true });
    expect(body.run_id).toStartWith("q-studio-health-");
    expect(body.holder).toBeUndefined();
    expect(fx.submitted).toEqual([{ project: "p", job: "studio-health", base_ref: "main", tier: "host", model: "m1", effort: "low" }]);
    expect(fx.queue.get(body.run_id)).toMatchObject({ base_ref: "main", tier: "host", model: "m1", effort: "low", state: "queued" });
    const run = await (await fx.call("GET", `/runs/${body.run_id}`)).json() as Record<string, any>;
    expect(run.run.base_ref).toBe("main");
  });

  test("a checkout whose lock an ended run still keeps: queued, naming the holder", async () => {
    const now = Date.now();
    const fx = fixture({ now: () => now });
    const old = fx.enqueue("run-epic", { tier: "sbx", sandbox: "sb" });
    expect((await fx.queue.claim(old.run_id, A)).claimed).toBe(true);
    fx.queue.setWorker(old.run_id, 4242, "999", 600);
    fx.queue.end(old.run_id, "partial", "worker may still run", { holdLock: "sbx worker may still run" });
    expect(fx.queue.lock(fx.checkout)?.run_id).toBe(old.run_id);
    const res = await fx.call("POST", "/jobs", { body: JSON.stringify({ project: "p", job: "studio-health" }) });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body.state).toBe("queued");
    expect(body.holder).toMatchObject({ kind: "run", run_id: old.run_id, job_id: "run-epic" });
  });
});

describe("read routes (AC4)", () => {
  test("GET /jobs, GET /runs/{id} (events as stored), 404 on an unknown run", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    fx.queue.recordRunOptions(run.run_id, { model: "m2" });
    const jobs = await (await fx.call("GET", "/jobs")).json() as Record<string, any>;
    expect(jobs.jobs).toHaveLength(1);
    expect(jobs.jobs[0]).toMatchObject({ job_id: "studio-health", root: fx.checkout, definition: { id: "studio-health" } });
    const got = await (await fx.call("GET", `/runs/${run.run_id}`)).json() as Record<string, any>;
    expect(got).toMatchObject({ ok: true, run_id: run.run_id, studio_run_id: null, state: "queued" });
    expect(got.events).toEqual(JSON.parse(JSON.stringify(lifecycle(fx.queue, run.run_id))));
    expect(got.events.map((e: any) => e.kind)).toEqual(["enqueued", "run-options"]);
    expect((await fx.call("GET", "/runs/x")).status).toBe(404);
    expect((await fx.call("POST", "/runs/x/cancel")).status).toBe(404);
  });

  test("a malformed escape in a run id (e.g. %E0%A4) is 404, not a 500", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    for (const [method, path] of [["GET", "/runs/%E0%A4"], ["POST", "/runs/%E0%A4/cancel"], ["GET", "/runs/%ZZ"]] as const) {
      const res = await fx.call(method, path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ ok: false, error: "RunNotFound" });
    }
    expect(fx.queue.get(run.run_id)!.state).toBe("queued");
  });

  test("GET /status: counts per state, the live runs, the held locks with their holder", async () => {
    const fx = fixture();
    const a = fx.enqueue("a");
    fx.enqueue("b");
    const c = fx.enqueue("c");
    expect((await fx.queue.claim(a.run_id, A)).claimed).toBe(true);
    fx.queue.end(c.run_id, "blocked", "x");
    const body = await (await fx.call("GET", "/status")).json() as Record<string, any>;
    expect(body.counts).toEqual({ running: 1, queued: 1, blocked: 1 });
    expect(body.live.map((r: QueueRun) => r.job_id).sort()).toEqual(["a", "b"]);
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].holder).toMatchObject({ kind: "run", run_id: a.run_id, job_id: "a", pid: A.pid });
  });

  test("GET /events?since= polls events with seq > since; a bad since is 400", async () => {
    const fx = fixture();
    fx.enqueue("a");
    fx.enqueue("b");
    const all = lifecycle(fx.queue);
    const body = await (await fx.call("GET", "/events?since=0")).json() as Record<string, any>;
    expect(body.events).toEqual(JSON.parse(JSON.stringify(all)));
    const after = await (await fx.call("GET", `/events?since=${all[0].seq}`)).json() as Record<string, any>;
    expect(after.events.map((e: any) => e.seq)).toEqual(all.slice(1).map((e) => e.seq));
    expect(after.last_seq).toBe(all.at(-1)!.seq);
    expect((await fx.call("GET", "/events")).status).toBe(200);
    expect((await fx.call("GET", "/events?since=abc")).status).toBe(400);
  });

  test("GET /events?since= with an empty or blank value is the default 0: 200 with every event", async () => {
    const fx = fixture();
    fx.enqueue("a");
    const all = JSON.parse(JSON.stringify(lifecycle(fx.queue)));
    for (const q of ["", "%20"]) {
      const res = await fx.call("GET", `/events?since=${q}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, since: 0, events: all });
    }
  });

  test("GET /events as SSE: id:<seq> + data:<event json> per event, then new events as they land", async () => {
    const fx = fixture();
    fx.enqueue("a");
    const first = lifecycle(fx.queue)[0];
    const ctl = new AbortController();
    const res = await fx.handler(new Request(`${BASE}/events?since=0`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" }, signal: ctl.signal,
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!text.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    await readUntil(`id:${first.seq}\n`);
    expect(text).toContain(`id:${first.seq}\ndata:${JSON.stringify(first)}\n\n`);
    fx.enqueue("b");
    const second = lifecycle(fx.queue).at(-1)!;
    await readUntil(`id:${second.seq}\n`);
    expect(text).toContain(`id:${second.seq}\ndata:${JSON.stringify(second)}\n\n`);
    ctl.abort();
    await reader.cancel();
  });

  test("SSE: a valid Last-Event-ID (an EventSource reconnect) wins over ?since=; JSON keeps ?since=", async () => {
    const fx = fixture();
    fx.enqueue("a");
    fx.enqueue("b");
    const [first, second] = lifecycle(fx.queue);
    const ctl = new AbortController();
    const res = await fx.handler(new Request(`${BASE}/events?since=0`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream", "last-event-id": String(first.seq) }, signal: ctl.signal,
    }));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 5000;
    while (!text.includes(`id:${second.seq}\n`) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    expect(text).toContain(`id:${second.seq}\n`);
    expect(text).not.toContain(`id:${first.seq}\n`);
    ctl.abort();
    await reader.cancel();
    // An invalid Last-Event-ID leaves `since` in charge; the JSON form keeps `since` first.
    const bad = await fx.handler(new Request(`${BASE}/events?since=abc`, {
      headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream", "last-event-id": "x" },
    }));
    expect(bad.status).toBe(400);
    const polled = await (await fx.call("GET", "/events?since=0", { headers: { "last-event-id": String(first.seq) } })).json() as Record<string, any>;
    expect(polled.events.map((e: any) => e.seq)).toEqual([first.seq, second.seq]);
  });

  test("a JSON poll never reads Last-Event-ID: no since → from 0; a non-numeric header is no 400", async () => {
    const fx = fixture();
    fx.enqueue("a");
    fx.enqueue("b");
    const all = JSON.parse(JSON.stringify(lifecycle(fx.queue)));
    const five = await fx.call("GET", "/events", { headers: { "last-event-id": "5" } });
    expect(five.status).toBe(200);
    expect(await five.json()).toMatchObject({ ok: true, since: 0, events: all });
    const abc = await fx.call("GET", "/events", { headers: { "last-event-id": "abc" } });
    expect(abc.status).toBe(200);
    expect(await abc.json()).toMatchObject({ ok: true, since: 0, events: all });
  });

  test("every 405 carries the allowed methods in the Allow header and the body", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    for (const [method, path, allow] of [["DELETE", "/jobs", "GET, POST"], ["POST", "/status", "GET"], ["PUT", "/events", "GET"],
      ["GET", `/runs/${run.run_id}/cancel`, "POST"], ["DELETE", `/runs/${run.run_id}`, "GET"]] as const) {
      const res = await fx.call(method, path);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe(allow);
      expect(await res.json()).toEqual({ ok: false, error: "MethodNotAllowed", allow });
    }
  });
});

describe("cancel (AC4, AC5)", () => {
  test("cancel a queued run → cancelled through Queue.end with its ended event; a double cancel is 409, nothing changed", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    const res = await fx.call("POST", `/runs/${run.run_id}/cancel`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ ok: true, run_id: run.run_id, studio_run_id: null, state: "cancelled" });
    const ended = lifecycle(fx.queue, run.run_id).at(-1)!;
    expect(ended).toMatchObject({ kind: "ended", from_state: "queued", to_state: "cancelled" });
    expect(ended.detail).toMatchObject({ reason: CANCELLED_REASON, cancelled_by: "api" });

    const before = { run: fx.queue.get(run.run_id), events: lifecycle(fx.queue, run.run_id) };
    const again = await fx.call("POST", `/runs/${run.run_id}/cancel`);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ ok: false, error: "RunTerminal", state: "cancelled" });
    expect({ run: fx.queue.get(run.run_id), events: lifecycle(fx.queue, run.run_id) }).toEqual(before);
  });

  test("a running skill run: the studio run ended (status → finish), the host worker killed, the lock released", async () => {
    const kills: number[] = [];
    const fx = fixture({ killWorker: async (pid, start) => { kills.push(pid); return { pid, start, outcome: "killed" }; } });
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, A);
    fx.queue.setStudioRun(run.run_id, "studio-health-20260928T000000Z");
    fx.queue.setWorker(run.run_id, 5151, "777");
    const calls: string[][] = [];
    const verbRunner = async (_root: string, args: string[]) => {
      calls.push(args);
      return args[0] === "status" ? { ok: true, runs: [{ run_id: "studio-health-20260928T000000Z", state: "running" }] } : { ok: true, state: "partial" };
    };
    const ended = await cancelRun(fx.queue, run.run_id, { verbRunner, launchStop: async () => { throw new Error("no engine"); } });
    expect(ended.state).toBe("cancelled");
    expect(calls.map((c) => c[0])).toEqual(["status", "finish"]);
    expect(calls[1]).toContain(CANCELLED_REASON);
    expect(kills).toEqual([5151]);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    const ev = lifecycle(fx.queue, run.run_id).at(-1)!;
    expect(ev.detail).toMatchObject({ lock: "released", studio: { ok: true }, worker: { outcome: "killed" } });
  });

  test("a core run's studio end is `cancel`; an sbx worker within its in-VM deadline keeps the lock (holdLock)", async () => {
    const now = Date.now();
    const fx = fixture({ now: () => now });
    const run = fx.enqueue("core-job", { target: "core", tier: "sbx", sandbox: "sb" });
    await fx.queue.claim(run.run_id, A);
    fx.queue.setStudioRun(run.run_id, "core-job-20260928T000000Z");
    fx.queue.setWorker(run.run_id, 6161, "888", 600);
    const calls: string[][] = [];
    const verbRunner = async (_root: string, args: string[]) => {
      calls.push(args);
      return args[0] === "status" ? { ok: true, runs: [{ state: "running" }] } : { ok: true, cancelled: true };
    };
    const ended = await cancelRun(fx.queue, run.run_id, { verbRunner });
    expect(ended.state).toBe("cancelled");
    expect(calls.map((c) => c[0])).toEqual(["status", "cancel"]);
    expect(fx.queue.lock(fx.checkout)?.run_id).toBe(run.run_id);
    const ev = lifecycle(fx.queue, run.run_id).at(-1)!;
    expect(ev.detail).toMatchObject({ lock: { held: expect.stringContaining("in-VM deadline not passed") }, worker: { outcome: "in-VM deadline not passed" } });
  });

  test("a launch run with a live engine: launch stop --graceful, the lock handed to the engine", async () => {
    const fx = fixture({ engine: () => ({ live: true, run_ids: ["eng-1"] }) });
    const run = fx.enqueue("run-epic", { skill: "tk-studio-launch" });
    await fx.queue.claim(run.run_id, A);
    fx.queue.markVerbStarted(run.run_id, "wake", [], { target: "skill", definition: { id: "run-epic", target: { skill: "tk-studio-launch" } } });
    const stops: string[][] = [];
    const ended = await cancelRun(fx.queue, run.run_id, {
      verbRunner: async () => { throw new Error("no studio run: never called"); },
      launchStop: async (root, id) => { stops.push([root, id]); return { ok: true, detail: `engine ${id} stopping gracefully` }; },
    });
    expect(ended.state).toBe("cancelled");
    expect(stops).toEqual([[fx.checkout, "eng-1"]]);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "eng-1" });
    expect(lifecycle(fx.queue, run.run_id).at(-1)!.detail).toMatchObject({ engine_stop: { engine_run_id: "eng-1", ok: true } });
  });

  test("a run ended by its driver during the cancel is the same 409", async () => {
    const fx = fixture({ cancel: async (id) => { fx.queue.end(id, "complete", "raced"); return cancelRun(fx.queue, id); } });
    const run = fx.enqueue();
    const res = await fx.call("POST", `/runs/${run.run_id}/cancel`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "RunTerminal", state: "complete" });
  });

  test("a run ended during the cancel's own awaits: 409 carrying the side effects already done", async () => {
    const kills: number[] = [];
    const verbRunner = async (_root: string, args: string[]) => {
      if (args[0] === "status") return { ok: true, runs: [{ run_id: "studio-health-20260928T000001Z", state: "running" }] };
      // The driver ends the run while the studio end is in flight.
      fx.queue.end(run.run_id, "complete", "raced");
      return { ok: true, state: "partial" };
    };
    const fx = fixture({
      killWorker: async (pid, start) => { kills.push(pid); return { pid, start, outcome: "killed" }; },
      cancel: (id) => cancelRun(fx.queue, id, { verbRunner }),
    });
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, A);
    fx.queue.setStudioRun(run.run_id, "studio-health-20260928T000001Z");
    fx.queue.setWorker(run.run_id, 7171, "999");
    const res = await fx.call("POST", `/runs/${run.run_id}/cancel`);
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ ok: false, error: "RunTerminal", state: "complete",
      effects: { studio: { ok: true }, worker: { pid: 7171, outcome: "killed" } } });
    expect(kills).toEqual([7171]);
    expect(fx.queue.get(run.run_id)!.state).toBe("complete");
    // Directly: the raced refusal is a RunTerminal carrying the effects.
    const other = fx.enqueue("other");
    fx.queue.setStudioRun(other.run_id, "studio-health-20260928T000001Z");
    const direct = await cancelRun(fx.queue, other.run_id, { verbRunner: async (_r, args) => {
      if (args[0] !== "status") fx.queue.end(other.run_id, "blocked", "raced");
      return args[0] === "status" ? { ok: true, runs: [{ run_id: "studio-health-20260928T000001Z", state: "running" }] } : { ok: true };
    } }).catch((e) => e);
    expect(direct).toBeInstanceOf(CancelRaced);
    expect((direct as CancelRaced).effects).toMatchObject({ cancelled_by: "api", studio: { ok: true } });
  });

  test("a run claimed by its live driver during the cancel, no worker recorded: the lock is kept, never a bare release", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    fx.queue.setStudioRun(run.run_id, "studio-health-20260928T000002Z");
    const verbRunner = async (_root: string, args: string[]) => {
      // drain / the tick claims the queued run while the studio end is in flight.
      if (args[0] === "status") { expect((await fx.queue.claim(run.run_id, A)).claimed).toBe(true); return { ok: true, runs: [{ run_id: "studio-health-20260928T000002Z", state: "running" }] }; }
      return { ok: true, state: "partial" };
    };
    const ended = await cancelRun(fx.queue, run.run_id, { verbRunner });
    expect(ended.state).toBe("cancelled");
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "run", run_id: run.run_id, owner_pid: A.pid });
    expect(lifecycle(fx.queue, run.run_id).at(-1)!.detail).toMatchObject({ lock: { held: expect.stringContaining("driver") } });
    // Another run waits on it while that driver lives.
    const next = fx.enqueue("next");
    const waited = await fx.queue.claim(next.run_id, B);
    expect(waited).toMatchObject({ claimed: false, why: "lock", holder: { kind: "run", run_id: run.run_id } });
    // The driver's own end finds the run ended and frees the lock; the next claim takes it.
    await expect(fx.queue.endDriven(run.run_id, "complete", "done")).rejects.toThrow(/RunTerminal/);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    expect(lifecycle(fx.queue, run.run_id).at(-1)).toMatchObject({ kind: "lock-released" });
    expect((await fx.queue.claim(next.run_id, B)).claimed).toBe(true);
  });

  test("a failed engine stop is in the 200 answer (effects.engine_stop), not only the event", async () => {
    const fx = fixture({
      engine: () => ({ live: true, run_ids: ["eng-2"] }),
      cancel: (id) => cancelRun(fx.queue, id, {
        verbRunner: async () => { throw new Error("no studio run: never called"); },
        launchStop: async () => ({ ok: false, detail: "launch stop refused: engine busy" }),
      }),
    });
    const run = fx.enqueue("run-epic", { skill: "tk-studio-launch" });
    await fx.queue.claim(run.run_id, A);
    fx.queue.markVerbStarted(run.run_id, "wake", [], { target: "skill", definition: { id: "run-epic", target: { skill: "tk-studio-launch" } } });
    const res = await fx.call("POST", `/runs/${run.run_id}/cancel`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ ok: true, state: "cancelled",
      effects: { engine_stop: { engine_run_id: "eng-2", ok: false, detail: "launch stop refused: engine busy" }, lock: { handed_to_engine: "eng-2" } } });
  });
});

describe("cancel races with the driver (AC4, AC5)", () => {
  const LAUNCH = { target: "skill", definition: { id: "run-epic", target: { skill: "tk-studio-launch" } } };
  const studioVerbs = (sid: string, calls: string[][]) => async (_root: string, args: string[]) => {
    calls.push(args);
    return args[0] === "status" ? { ok: true, runs: [{ run_id: sid, state: "running" }] } : { ok: true, state: "partial" };
  };

  test("a studio run the driver records during the cancel's own awaits is the one the cancel ends", async () => {
    const sid = "run-epic-20260928T000003Z";
    // The driver's minting verb answers while the cancel probes the launch core.
    const fx = fixture({ engine: () => { if (!fx.queue.get(run.run_id)!.studio_run_id) fx.queue.setStudioRun(run.run_id, sid); return { live: false }; } });
    const run = fx.enqueue("run-epic", { skill: "tk-studio-launch" });
    await fx.queue.claim(run.run_id, A);
    fx.queue.markVerbStarted(run.run_id, "wake", [], LAUNCH);
    const calls: string[][] = [];
    const ended = await cancelRun(fx.queue, run.run_id, { verbRunner: studioVerbs(sid, calls) });
    expect(ended.state).toBe("cancelled");
    expect(calls.map((c) => c[0])).toEqual(["status", "finish"]);
    expect(calls[1]).toEqual(expect.arrayContaining([sid, CANCELLED_REASON]));
    expect(lifecycle(fx.queue, run.run_id).at(-1)!.detail).toMatchObject({ studio: { ok: true } });
  });

  test("a studio run minted after the cancel is ended by the driver (recordMinted), the refusal rethrown", async () => {
    const sid = "studio-health-20260928T000004Z";
    const fx = fixture();
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, A);
    fx.queue.markVerbStarted(run.run_id, "wake", [], { target: "skill", definition: { id: "studio-health", target: { skill: "tk-studio-activate" } } });
    // The cancel lands while the driver is inside its minting verb: no studio run to end yet.
    const cancelled = await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("no studio run yet: never called"); } });
    expect(cancelled.state).toBe("cancelled");
    const calls: string[][] = [];
    const err = await recordMinted(fx.queue, run.run_id, { runId: sid, woke: {} }, studioVerbs(sid, calls)).catch((e) => e);
    expect(err).toBeInstanceOf(RunTerminal);
    expect(calls.map((c) => c[0])).toEqual(["status", "finish"]);
    expect(calls[1]).toEqual(expect.arrayContaining([sid, CANCELLED_REASON]));
    expect(fx.queue.get(run.run_id)!.studio_run_id).toBeNull();
    // A run still running (another checkout) records the studio run and its wake, no verb called.
    const other = fixture();
    const live = other.enqueue("live");
    expect((await other.queue.claim(live.run_id, A)).claimed).toBe(true);
    await recordMinted(other.queue, live.run_id, { runId: "live-20260928T000005Z", woke: { state: "running" } },
      async () => { throw new Error("never called"); });
    expect(other.queue.get(live.run_id)!.studio_run_id).toBe("live-20260928T000005Z");
    expect(lifecycle(other.queue, live.run_id).at(-1)).toMatchObject({ kind: "woke" });
  });

  test("a worker the driver records after the cancel read the run is killed once the run ended, in effects.worker", async () => {
    const kills: number[] = [];
    let probes = 0;
    const fx = fixture({
      // The driver's `onSpawn` → `setWorker` lands between the cancel's worker check and `Queue.end` (the second engine probe).
      engine: () => { if (++probes === 2) fx.queue.setWorker(run.run_id, 9191, "222"); return { live: false }; },
      killWorker: async (pid, start) => { kills.push(pid); return { pid, start, outcome: "killed" }; },
      cancel: (id) => cancelRun(fx.queue, id, { verbRunner: async () => { throw new Error("no studio run: never called"); } }),
    });
    const run = fx.enqueue("run-epic", { skill: "tk-studio-launch" });
    await fx.queue.claim(run.run_id, A);
    fx.queue.markVerbStarted(run.run_id, "wake", [], LAUNCH);
    const res = await fx.call("POST", `/runs/${run.run_id}/cancel`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ ok: true, state: "cancelled", effects: { worker: { pid: 9191, outcome: "killed" }, lock: { held: expect.any(String) } } });
    expect(kills).toEqual([9191]);
    const evs = lifecycle(fx.queue, run.run_id);
    expect(evs.at(-2)).toMatchObject({ kind: "ended", to_state: "cancelled" });
    expect(evs.at(-1)).toMatchObject({ kind: "worker-kill", from_state: "cancelled", to_state: "cancelled", detail: { worker: { pid: 9191, outcome: "killed" } } });
    // The lock stays with the ended run: `claim` frees it once `recordedWorker` says the worker may no longer run.
    expect(fx.queue.lock(fx.checkout)?.run_id).toBe(run.run_id);
    await expect(fx.queue.endDriven(run.run_id, "complete", "done")).rejects.toThrow(RunTerminal);
    expect(fx.queue.lock(fx.checkout)?.run_id).toBe(run.run_id);
  });

  test("a worker spawned after the cancel, whose record is refused: killed before the refusal propagates; the driver's end frees the lock after the kill", async () => {
    const kills: number[] = [];
    const fx = fixture({ killWorker: async (pid, start) => { kills.push(pid); return { pid, start, outcome: "killed" }; } });
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, A);
    await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("no studio run: never called"); } });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ run_id: run.run_id, owner_pid: A.pid });
    expect(() => queueRecorder(fx.queue, run.run_id).worker(4343, 60)).toThrow(RunTerminal);
    expect(kills).toEqual([4343]);
    expect(fx.queue.get(run.run_id)!.worker_pid).toBeNull();
    expect(fx.queue.lock(fx.checkout)?.run_id).toBe(run.run_id);
    await expect(fx.queue.endDriven(run.run_id, "blocked", "worker record failed")).rejects.toThrow(RunTerminal);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    const evs = lifecycle(fx.queue, run.run_id);
    expect(evs.at(-2)).toMatchObject({ kind: "worker-kill", detail: { worker: { pid: 4343, outcome: "killed" } } });
    expect(evs.at(-1)).toMatchObject({ kind: "lock-released" });

    // A kill that may still run keeps the lock (never freed under it).
    const held = fixture({ killWorker: async (pid, start) => ({ pid, start, outcome: "kill failed", detail: "still running after wait" }) });
    const other = held.enqueue();
    await held.queue.claim(other.run_id, A);
    await cancelRun(held.queue, other.run_id, { verbRunner: async () => { throw new Error("never called"); } });
    expect(() => queueRecorder(held.queue, other.run_id).worker(4444)).toThrow(RunTerminal);
    await expect(held.queue.endDriven(other.run_id, "blocked", "worker record failed")).rejects.toThrow(RunTerminal);
    expect(held.queue.lock(held.checkout)?.run_id).toBe(other.run_id);
    expect(lifecycle(held.queue, other.run_id).at(-1)).toMatchObject({ kind: "worker-kill", detail: { worker: { outcome: "kill failed" } } });
  });

  test.skipIf(process.platform !== "linux")("the refused record's real child is killed by the recorded-worker kill (its process group, never by name)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-sup-api-kill-"));
    const queue = new Queue(join(dir, "q.db"), { ownerAlive: (w) => w.pid === A.pid, engineLive: async () => ({ live: false }) });
    const checkout = mkdtempSync(join(tmpdir(), "tk-sup-api-kill-co-"));
    const run = queue.enqueue({ jobId: "j", root: checkout, projectId: "p", target: "skill", definition: { id: "j", target: { skill: "s" } } }).run;
    await queue.claim(run.run_id, A);
    await cancelRun(queue, run.run_id, { verbRunner: async () => { throw new Error("never called"); } });
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const exited = new Promise<boolean>((r) => { child.on("exit", () => r(true)); setTimeout(() => r(false), 5000); });
    try {
      expect(() => queueRecorder(queue, run.run_id).worker(child.pid!)).toThrow(RunTerminal);
      expect(await exited).toBe(true);
      await expect(queue.endDriven(run.run_id, "blocked", "worker record failed")).rejects.toThrow(RunTerminal);
      expect(lifecycle(queue, run.run_id).find((e) => e.kind === "worker-kill")?.detail).toMatchObject({ worker: { pid: child.pid, outcome: "killed" } });
      expect(queue.lock(checkout)).toBeNull();
    } finally {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
      queue.close();
    }
  });

  test("mirror after a driver-live cancel: an unrecorded studio run is ended and the kept lock freed", async () => {
    const sid = "studio-health-20260928T000006Z";
    const fx = fixture();
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, A);
    await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("no studio run yet: never called"); } });
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ run_id: run.run_id, owner_pid: A.pid });
    // The wake failed and the driver adopted the studio run afterwards (`recoverAfterTimeout`): never recorded.
    const calls: string[][] = [];
    const summary: RunSummary = { ok: false, job_id: "studio-health", run_id: sid, state: "running", reason: "wake timed out" };
    const out = await mirror(fx.queue, run.run_id, { jobId: "studio-health", defn: { id: "studio-health" } }, summary, studioVerbs(sid, calls));
    expect(calls.map((c) => c[0])).toEqual(["status", "finish"]);
    expect(calls[1]).toEqual(expect.arrayContaining([sid, CANCELLED_REASON]));
    expect(fx.queue.lock(fx.checkout)).toBeNull();
    expect(lifecycle(fx.queue, run.run_id).at(-1)).toMatchObject({ kind: "lock-released" });
    expect(fx.queue.get(run.run_id)).toMatchObject({ state: "cancelled", studio_run_id: null });
    expect(out).toMatchObject({ run_id: run.run_id, studio_run_id: sid, state: "running" });
    expect(out.reason).toContain("queue: RunTerminal");
  });

  test("a running run whose dead driver started its minting verb: the studio run looked up by the restart rule's finder and ended", async () => {
    const mint = (ms: number) => `studio-health-${new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
    const fx = fixture({ cancel: (id) => cancelRun(fx.queue, id, { verbRunner }) });
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, B); // B's owner probe: dead
    fx.queue.markVerbStarted(run.run_id, "wake", ["studio-health-20200101T000000Z"], { target: "skill", definition: { id: "studio-health", target: { skill: "tk-studio-activate" } } });
    const sid = mint(Date.now() + 1000);
    const calls: string[][] = [];
    const verbRunner = async (_root: string, args: string[]) => {
      calls.push(args);
      if (args[0] !== "status") return { ok: true, state: "partial" };
      return args.includes("--run-id") ? { ok: true, runs: [{ run_id: sid, state: "running" }] }
        : { ok: true, runs: [{ run_id: "studio-health-20200101T000000Z", state: "complete" }, { run_id: sid, state: "running" }] };
    };
    const res = await fx.call("POST", `/runs/${run.run_id}/cancel`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ ok: true, state: "cancelled", studio_run_id: sid,
      effects: { lookup: { ok: true, adopted: sid }, studio: { ok: true }, lock: "released" } });
    expect(calls.map((c) => c[0])).toEqual(["status", "status", "finish"]);
    expect(calls[2]).toEqual(expect.arrayContaining([sid, CANCELLED_REASON]));

    // A failed lookup is recorded in the detail, never thrown: the run still ends cancelled.
    const failed = fixture();
    const other = failed.enqueue();
    await failed.queue.claim(other.run_id, B);
    failed.queue.markVerbStarted(other.run_id, "wake", [], { target: "skill", definition: { id: "studio-health", target: { skill: "tk-studio-activate" } } });
    const ended = await cancelRun(failed.queue, other.run_id, { verbRunner: async () => { throw new Error("jobrun unreachable"); } });
    expect(ended.state).toBe("cancelled");
    expect(lifecycle(failed.queue, other.run_id).at(-1)!.detail).toMatchObject({ lookup: { ok: false, detail: expect.stringContaining("jobrun unreachable") } });
    expect(lifecycle(failed.queue, other.run_id).at(-1)!.detail!.studio).toBeUndefined();
  });

  test("a launch engine started after the first probe is found once the worker is dead: stopped, and handed the lock", async () => {
    let killed = false;
    const fx = fixture({
      // The launch core starts its engine between the cancel's first probe and the worker kill.
      engine: () => (killed ? { live: true, run_ids: ["eng-late"] } : { live: false }),
      killWorker: async (pid, start) => { killed = true; return { pid, start, outcome: "killed" }; },
    });
    const run = fx.enqueue("run-epic", { skill: "tk-studio-launch" });
    await fx.queue.claim(run.run_id, A);
    fx.queue.markVerbStarted(run.run_id, "wake", [], LAUNCH);
    fx.queue.setWorker(run.run_id, 8181, "111");
    const stops: string[][] = [];
    const ended = await cancelRun(fx.queue, run.run_id, {
      verbRunner: async () => { throw new Error("no studio run: never called"); },
      launchStop: async (root, id) => { stops.push([root, id]); return { ok: true, detail: `engine ${id} stopping gracefully` }; },
    });
    expect(ended.state).toBe("cancelled");
    expect(killed).toBe(true);
    expect(stops).toEqual([[fx.checkout, "eng-late"]]);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "engine", engine_run_id: "eng-late" });
    expect(lifecycle(fx.queue, run.run_id).at(-1)!.detail).toMatchObject({
      engine: { handed_to_engine: "eng-late" }, engine_stop: { engine_run_id: "eng-late", ok: true }, worker: { pid: 8181, outcome: "killed" },
    });
  });
});

// The real `launchStopGraceful` against a fake `uv` on PATH: the argv it sends and how it reads the answer.
// win32 too (DW-5): the fake is a bun script behind `fakeBin` (`uv.exe` there).
describe("launchStopGraceful through runUv (AC4)", () => {
  test("stop --directory <root> --run-id <id> --graceful on lib/launch.py; ok, refused, no JSON", async () => {
    const bin = mkdtempSync(join(tmpdir(), "tk-sup-api-uv-"));
    const studio = mkdtempSync(join(tmpdir(), "tk-sup-api-studio-"));
    const root = mkdtempSync(join(tmpdir(), "tk-sup-api-root-"));
    // One argument per line into `argv`, then the canned answer from `out`.
    fakeBin(join(bin, "uv"), `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(join(bin, "argv"))}, process.argv.slice(2).map((a) => a + "\\n").join(""));
process.stdout.write(fs.readFileSync(${JSON.stringify(join(bin, "out"))}, "utf-8"));
`);
    const prev = { path: process.env.PATH, root: process.env.TK_STUDIO_ROOT };
    process.env.PATH = `${bin}${delimiter}${prev.path ?? ""}`;
    process.env.TK_STUDIO_ROOT = studio;
    const answer = (out: string) => { writeFileSync(join(bin, "out"), out); return launchStopGraceful(root, "eng-9"); };
    try {
      expect(await answer('{"ok":true}\n')).toEqual({ ok: true, detail: "engine eng-9 stopping gracefully" });
      expect(readFileSync(join(bin, "argv"), "utf-8").split("\n").slice(0, -1)).toEqual(
        ["run", join(studio, "plugins", "tk-studio", "lib", "launch.py"), "stop", "--directory", root, "--run-id", "eng-9", "--graceful"]);
      expect(await answer('{"ok":false,"error":"x"}\n')).toEqual({ ok: false, detail: "launch stop refused: x" });
      const none = await answer("not json\n");
      expect(none.ok).toBe(false);
      expect(none.detail).toContain("no JSON");
    } finally {
      process.env.PATH = prev.path;
      if (prev.root === undefined) delete process.env.TK_STUDIO_ROOT; else process.env.TK_STUDIO_ROOT = prev.root;
    }
  });
});

// The real submit path (registry `show` → `resolve` → enqueue) against a throwaway store.
// win32 too (DW-5): the Windows host runs this suite (no fake binary is exec'd here).
const canRunE2E = !!process.env.TK_STUDIO_ROOT && spawnSync("uv", ["--version"]).status === 0;

describe.skipIf(!canRunE2E)("POST /jobs through the real submit path", () => {
  const store = mkdtempSync(join(tmpdir(), "tk-sup-api-store-"));
  const project = mkdtempSync(join(tmpdir(), "tk-sup-api-proj-"));
  let prevHome: string | undefined, projectId = "";
  beforeAll(() => {
    prevHome = process.env.TK_STUDIO_HOME;
    process.env.TK_STUDIO_HOME = store;
    mkdirSync(join(project, ".tk-studio", "jobs"), { recursive: true });
    copyFileSync(join(REPO, ".tk-studio", "jobs", "studio-health.json"), join(project, ".tk-studio", "jobs", "studio-health.json"));
    const plugin = join(process.env.TK_STUDIO_ROOT!, "plugins", "tk-studio");
    const env = { ...process.env, TK_STUDIO_HOME: store };
    const reg = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "register", "--directory", project, "--writer", "onboard"], { env, encoding: "utf-8" });
    if (reg.status !== 0) throw new Error(`register failed: ${reg.stdout}${reg.stderr}`);
    const shown = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "show"], { env, encoding: "utf-8" });
    projectId = Object.keys(JSON.parse(shown.stdout.slice(shown.stdout.indexOf("{"))).projects)[0];
  });
  afterAll(() => { if (prevHome === undefined) delete process.env.TK_STUDIO_HOME; else process.env.TK_STUDIO_HOME = prevHome; });

  const real = () => {
    const queue = new Queue(join(mkdtempSync(join(tmpdir(), "tk-sup-api-q-")), "q.db"));
    const handler = createApi({ queue, token: TOKEN });
    const post = (body: unknown) => handler(new Request(`${BASE}/jobs`, { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${TOKEN}` } }));
    return { queue, post };
  };

  test("unknown project → 400 naming the registry refusal, nothing queued", async () => {
    const { queue, post } = real();
    const res = await post({ project: "no-such-project-xyz", job: "studio-health" });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, string>;
    expect(body.error).toBe("SubmitRefused");
    expect(body.detail).toStartWith("registry: ");
    expect(queue.runs()).toEqual([]);
  }, 60_000);

  test("unknown job → 400 naming the resolve refusal, nothing queued", async () => {
    const { queue, post } = real();
    const res = await post({ project: projectId, job: "no-such-job" });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, string>;
    expect(body.error).toBe("SubmitRefused");
    expect(body.detail).toStartWith("resolve: ");
    expect(queue.runs()).toEqual([]);
  }, 60_000);

  test("a named refusal from the real path (TierRefused) → 400, nothing queued", async () => {
    const { queue, post } = real();
    const res = await post({ project: projectId, job: "studio-health", tier: "gpu" });
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, string>).error).toBe("TierRefused");
    expect(queue.runs()).toEqual([]);
  }, 60_000);

  test("Story 22.3: a flagged run with no TK_SUPERVISOR_WORK → 400 WorkDirMissing, nothing queued; with it → queued, flagged", async () => {
    const prev = process.env.TK_SUPERVISOR_WORK;
    try {
      delete process.env.TK_SUPERVISOR_WORK;
      const { queue, post } = real();
      const res = await post({ project: projectId, job: "studio-health", editor_in_the_loop: true });
      expect(res.status).toBe(400);
      expect((await res.json() as Record<string, string>).error).toBe("WorkDirMissing");
      expect(queue.runs()).toEqual([]);
      process.env.TK_SUPERVISOR_WORK = mkdtempSync(join(tmpdir(), "tk-sup-api-work-"));
      const ok = await post({ project: projectId, job: "studio-health", editor_in_the_loop: true });
      expect(ok.status).toBe(200);
      const body = await ok.json() as Record<string, any>;
      expect(queue.get(body.run_id)).toMatchObject({ state: "queued", editor_in_the_loop: 1 });
    } finally { if (prev === undefined) delete process.env.TK_SUPERVISOR_WORK; else process.env.TK_SUPERVISOR_WORK = prev; }
  }, 60_000);

  test("valid → queued with the run id and base_ref stored", async () => {
    const { queue, post } = real();
    const res = await post({ project: projectId, job: "studio-health", base_ref: "main" });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ ok: true, state: "queued", studio_run_id: null, base_ref: "main", project_id: projectId });
    expect(queue.get(body.run_id)).toMatchObject({ state: "queued", base_ref: "main", job_id: "studio-health" });
  }, 60_000);
});

describe("Story 27.3: POST /runs/{id}/resume, and an external run's cancel (DW-26)", () => {
  test("cancel of an external run → 409 ExternalRun; the run stays external", async () => {
    const { queue, enqueue, call, checkout } = fixture();
    const first = enqueue("ext-job");
    queue.end(first.run_id, "cancelled", "test");
    const ext = queue.recordExternal("ext-job", checkout, "ext-job-20261016T101010Z", "running")!;
    const res = await call("POST", `/runs/${ext.run_id}/cancel`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "ExternalRun", run_id: ext.run_id });
    expect(queue.get(ext.run_id)!.state).toBe("external");
  });

  test("resume answers: 404 RunNotFound, 409 RunNotPaused / ExternalRun (the default verb), 400 SchemaError, 200 through the verb", async () => {
    const { queue, enqueue, call, checkout } = fixture();
    expect(await (await call("POST", "/runs/q-nope/resume")).json()).toMatchObject({ error: "RunNotFound" });
    expect((await call("POST", "/runs/q-nope/resume")).status).toBe(404);
    const queued = enqueue("resume-job");
    const notPaused = await call("POST", `/runs/${queued.run_id}/resume`, { body: "{}" });
    expect(notPaused.status).toBe(409);
    expect(await notPaused.json()).toMatchObject({ ok: false, error: "RunNotPaused", run_id: queued.run_id });
    queue.end(queued.run_id, "cancelled", "test");
    const ext = queue.recordExternal("resume-job", checkout, "resume-job-20261016T101010Z", "running")!;
    expect(await (await call("POST", `/runs/${ext.run_id}/resume`)).json()).toMatchObject({ error: "ExternalRun" });
    for (const body of ["[]", JSON.stringify({ restore_patch: "" }), JSON.stringify({ restore_patch: 1 }), JSON.stringify({ other: "x" })]) {
      const r = await call("POST", `/runs/${queued.run_id}/resume`, { body });
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ error: "SchemaError" });
    }
    expect((await call("POST", `/runs/${queued.run_id}/resume`, { body: "{nope" })).status).toBe(400);
    expect((await call("GET", `/runs/${queued.run_id}/resume`)).status).toBe(405);
    expect(checkResumeBody({ restore_patch: "p.patch" })).toEqual({ ok: true, body: { restore_patch: "p.patch" } });

    const seen: unknown[] = [];
    const ok = fixture({ resume: async (id, b) => { seen.push([id, b]); return { ok: true, run_id: id, state: "running", engine_run_id: "E1" }; } });
    const r = await ok.call("POST", "/runs/q-1/resume", { body: JSON.stringify({ restore_patch: "fix.patch" }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, run_id: "q-1", state: "running", engine_run_id: "E1" });
    expect(seen).toEqual([["q-1", { restore_patch: "fix.patch" }]]);
    const landed = fixture({ resume: async () => { throw new ResumeRefused("StoryLanded", "story 9-1 landed"); } });
    const l = await landed.call("POST", "/runs/q-1/resume");
    expect(l.status).toBe(409);
    expect(await l.json()).toMatchObject({ ok: false, error: "StoryLanded" });
    // Bearer only: no auth is 401.
    expect((await ok.call("POST", "/runs/q-1/resume", { auth: null })).status).toBe(401);
  });

  test("resume refuses a valid cookie session, even with the page's CSRF token: bearer only", async () => {
    const SECRET = "s".repeat(48);
    const queue = new Queue(":memory:");
    const seen: string[] = [];
    const handler = createApi({ queue, token: TOKEN, session: { secret: SECRET },
      resume: async (id) => { seen.push(id); return { ok: true, run_id: id, state: "running", engine_run_id: "E1" }; } });
    const cookie = signSession(SECRET, "token", Date.now());
    const csrf = csrfToken(SECRET, cookie);
    // The session is valid: it reads the page.
    expect((await handler(new Request(`${BASE}/status`, { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }))).status).toBe(200);
    for (const init of <{ headers: Record<string, string>; body: string }[]>[
      { headers: { cookie: `${SESSION_COOKIE}=${cookie}`, "x-csrf-token": csrf }, body: "{}" },
      { headers: { cookie: `${SESSION_COOKIE}=${cookie}`, "content-type": "application/x-www-form-urlencoded" }, body: `csrf=${encodeURIComponent(csrf)}` },
    ]) {
      const r = await handler(new Request(`${BASE}/runs/q-1/resume`, { method: "POST", ...init }));
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ ok: false, error: "Unauthorized" });
    }
    expect(seen).toEqual([]);
  });
});

describe("Story 27.5: the cancel's end re-reads the run (DW-12, DW-13)", () => {
  const LAUNCH = { target: "skill", definition: { id: "run-epic", target: { skill: "tk-studio-launch" } } };
  const studioVerbs = (calls: string[][], state = "running") => async (_root: string, args: string[]) => {
    calls.push(args);
    return args[0] === "status" ? { ok: true, runs: [{ run_id: args[args.indexOf("--run-id") + 1], state }] } : { ok: true, state: "partial" };
  };

  test("a studio run recorded after the cancel's last read is found by the end's re-read and ended after the commit (`studio-run-ended`, late)", async () => {
    const sid = "run-epic-20261016T000001Z";
    let probes = 0;
    // The driver's `setStudioRun` lands after the cancel's re-read, before `Queue.end` (on the second engine probe).
    const fx = fixture({ engine: () => { if (++probes === 2) fx.queue.setStudioRun(run.run_id, sid); return { live: false }; } });
    const run = fx.enqueue("run-epic", { skill: "tk-studio-launch" });
    await fx.queue.claim(run.run_id, A);
    fx.queue.markVerbStarted(run.run_id, "wake", [], LAUNCH);
    const calls: string[][] = [];
    const ended = await cancelRun(fx.queue, run.run_id, { verbRunner: studioVerbs(calls) });
    expect(ended).toMatchObject({ state: "cancelled", studio_run_id: sid });
    expect(calls.map((c) => c[0])).toEqual(["status", "finish"]);
    expect(calls[1]).toEqual(expect.arrayContaining([sid, CANCELLED_REASON]));
    const evs = lifecycle(fx.queue, run.run_id);
    expect(evs.find((e) => e.kind === "ended")!.detail).toMatchObject({ late_studio_run_id: sid });
    expect(evs.filter((e) => e.kind === "studio-run-ended").map((e) => e.detail)).toEqual([
      { studio_run_id: sid, late: true, by: "cancel", detail: `studio run ${sid} ended via finish`, state: "partial" },
    ]);
    // Nothing is left for the next recovery.
    expect(fx.queue.cancelledLeftovers()).toEqual([]);
  });

  test("a claim inside the window: the run ends cancelled keeping its lock for the claiming driver, whose own end frees it", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    // The driver claims the queued run after the cancel read it (inside the cancel's worker check).
    const check = fx.queue.recordedWorker.bind(fx.queue);
    fx.queue.recordedWorker = async (r, kill, opts) => {
      if (r.run_id === run.run_id && fx.queue.get(run.run_id)!.state === "queued") await fx.queue.claim(run.run_id, A);
      return check(r, kill, opts);
    };
    const ended = await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("no studio run: never called"); } });
    expect(ended.state).toBe("cancelled");
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "run", run_id: run.run_id, owner_pid: A.pid });
    expect(lifecycle(fx.queue, run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({
      claimed_during_cancel: { pid: A.pid }, lock: { held: expect.stringContaining("claimed by its driver") },
    });
    // The driver's next record is refused; its end frees the lock it kept.
    expect(() => fx.queue.markVerbStarted(run.run_id, "wake", [])).toThrow(RunTerminal);
    await expect(fx.queue.endDriven(run.run_id, "blocked", "cancelled under the driver")).rejects.toThrow(RunTerminal);
    expect(fx.queue.lock(fx.checkout)).toBeNull();
  });

  test("a claim inside the window on an sbx run: the cancel leaves the pin to the claiming driver (no `pin-released`, no `sbx stop`)", async () => {
    const fx = fixture();
    const run = fx.enqueue("studio-health", { tier: "sbx", sandbox: "sb-claimed" });
    fx.queue.note(run.run_id, "pinned", { sandbox: "sb-claimed" }); // an outstanding pin on the run's sandbox
    const check = fx.queue.recordedWorker.bind(fx.queue);
    fx.queue.recordedWorker = async (r, kill, opts) => {
      if (r.run_id === run.run_id && fx.queue.get(run.run_id)!.state === "queued") await fx.queue.claim(run.run_id, A);
      return check(r, kill, opts);
    };
    const sbx: string[][] = [];
    const ended = await cancelRun(fx.queue, run.run_id, {
      verbRunner: async () => { throw new Error("no studio run: never called"); },
      worktree: { sbx: { run: async (_bin, args) => { sbx.push(args); return { exit: 0, stdout: "", stderr: "" }; } } },
    });
    expect(ended.state).toBe("cancelled");
    expect(lifecycle(fx.queue, run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ claimed_during_cancel: { pid: A.pid } });
    expect(fx.queue.events(run.run_id).map((e) => e.kind)).not.toContain("pin-released");
    expect(sbx).toEqual([]);
    expect(fx.queue.lock(fx.checkout)).toMatchObject({ kind: "run", run_id: run.run_id, owner_pid: A.pid });
  });

  test("the next recovery ends a cancelled run's studio run the cancel left open (`studio-run-ended`, once)", async () => {
    const sid = "studio-health-20261016T000002Z";
    const fx = fixture();
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, A);
    fx.queue.setStudioRun(run.run_id, sid);
    // The cancel's own ender failed (the studio was unreachable): the studio run stays open.
    await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("studio unreachable"); } });
    expect(lifecycle(fx.queue, run.run_id).find((e) => e.kind === "ended")!.detail).toMatchObject({ studio: { ok: false } });
    expect(fx.queue.cancelledLeftovers().map((r) => r.run_id)).toEqual([run.run_id]);
    const calls: string[][] = [];
    expect(await endCancelledLeftovers(fx.queue, studioVerbs(calls))).toEqual([run.run_id]);
    expect(calls.map((c) => c[0])).toEqual(["status", "finish"]);
    expect(lifecycle(fx.queue, run.run_id).at(-1)).toMatchObject({
      kind: "studio-run-ended", from_state: "cancelled", to_state: "cancelled", detail: { studio_run_id: sid, late: true, by: "recover" },
    });
    expect(await endCancelledLeftovers(fx.queue, studioVerbs(calls))).toEqual([]);
    expect(calls).toHaveLength(2);
    // A cancel whose ender ended its studio run leaves nothing for the recovery.
    const other = fixture();
    const done = other.enqueue();
    await other.queue.claim(done.run_id, A);
    other.queue.setStudioRun(done.run_id, sid);
    await cancelRun(other.queue, done.run_id, { verbRunner: studioVerbs([]) });
    expect(other.queue.cancelledLeftovers()).toEqual([]);
  });
});

describe("Story 27.5 (P7): a leftover's outcome is recorded; a failed ender is retried, bounded", () => {
  test("already terminal → `studio-run-ended` with its state; an ender that fails → `studio-run-end-failed`, retried by the next recovery until it ends", async () => {
    const make = async (sid: string) => {
      const fx = fixture();
      const run = fx.enqueue();
      await fx.queue.claim(run.run_id, A);
      fx.queue.setStudioRun(run.run_id, sid);
      await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("studio unreachable"); } });
      return { fx, run };
    };
    const terminal = await make("studio-health-20261016T000003Z");
    const calls: string[][] = [];
    const already = async (_root: string, args: string[]) => { calls.push(args); return { ok: true, runs: [{ run_id: args[args.indexOf("--run-id") + 1], state: "complete" }] }; };
    expect(await endCancelledLeftovers(terminal.fx.queue, already)).toEqual([terminal.run.run_id]);
    expect(calls.map((c) => c[0])).toEqual(["status"]); // already terminal: nothing ended
    expect(lifecycle(terminal.fx.queue, terminal.run.run_id).at(-1)).toMatchObject({ kind: "studio-run-ended", detail: { late: true, by: "recover", state: "complete" } });
    expect(terminal.fx.queue.cancelledLeftovers()).toEqual([]);

    const failing = await make("studio-health-20261016T000004Z");
    const tries: string[][] = [];
    const broken = async (_root: string, args: string[]) => { tries.push(args); throw new Error("studio unreachable"); };
    expect(await endCancelledLeftovers(failing.fx.queue, broken)).toEqual([]);
    expect(lifecycle(failing.fx.queue, failing.run.run_id).at(-1)).toMatchObject({
      kind: "studio-run-end-failed", detail: { studio_run_id: "studio-health-20261016T000004Z", by: "recover", detail: expect.stringContaining("studio unreachable"), attempt: 1 },
    });
    expect(lifecycle(failing.fx.queue, failing.run.run_id).at(-1)!.detail).not.toHaveProperty("gave_up");
    // Still listed: the next recovery tries again (a short studio outage never leaves the studio run unended).
    expect(failing.fx.queue.cancelledLeftovers().map((r) => r.run_id)).toEqual([failing.run.run_id]);
    const n = tries.length;
    expect(await endCancelledLeftovers(failing.fx.queue, broken)).toEqual([]);
    expect(tries.length).toBeGreaterThan(n); // retried
    expect(lifecycle(failing.fx.queue, failing.run.run_id).filter((e) => e.kind === "studio-run-end-failed").map((e) => e.detail!.attempt)).toEqual([1, 2]);
    // The studio is back: the next recovery ends it, and the run is never listed again.
    const calls2: string[][] = [];
    const back = async (_root: string, args: string[]) => {
      calls2.push(args);
      return args[0] === "status" ? { ok: true, runs: [{ run_id: args[args.indexOf("--run-id") + 1], state: "running" }] } : { ok: true, state: "partial" };
    };
    expect(await endCancelledLeftovers(failing.fx.queue, back)).toEqual([failing.run.run_id]);
    expect(calls2.map((c) => c[0])).toEqual(["status", "finish"]);
    expect(lifecycle(failing.fx.queue, failing.run.run_id).at(-1)).toMatchObject({
      kind: "studio-run-ended", detail: { studio_run_id: "studio-health-20261016T000004Z", late: true, by: "recover" },
    });
    expect(failing.fx.queue.cancelledLeftovers()).toEqual([]);
  });

  test("an ender failing STUDIO_END_RETRY_LIMIT times gives up: the last `studio-run-end-failed` carries `gave_up: true`, never listed again", async () => {
    const fx = fixture();
    const run = fx.enqueue();
    await fx.queue.claim(run.run_id, A);
    fx.queue.setStudioRun(run.run_id, "studio-health-20261016T000005Z");
    await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("studio unreachable"); } });
    let tries = 0;
    const broken = async () => { tries++; throw new Error("studio unreachable"); };
    for (let i = 0; i < STUDIO_END_RETRY_LIMIT; i++) {
      expect(fx.queue.cancelledLeftovers().map((r) => r.run_id)).toEqual([run.run_id]);
      expect(await endCancelledLeftovers(fx.queue, broken)).toEqual([]);
    }
    const failed = lifecycle(fx.queue, run.run_id).filter((e) => e.kind === "studio-run-end-failed");
    expect(failed.map((e) => e.detail!.attempt)).toEqual(Array.from({ length: STUDIO_END_RETRY_LIMIT }, (_, i) => i + 1));
    expect(failed.filter((e) => e.detail!.gave_up === true).map((e) => e.detail!.attempt)).toEqual([STUDIO_END_RETRY_LIMIT]);
    expect(fx.queue.cancelledLeftovers()).toEqual([]);
    const n = tries;
    expect(await endCancelledLeftovers(fx.queue, broken)).toEqual([]);
    expect(tries).toBe(n); // given up: never tried again
    expect(lifecycle(fx.queue, run.run_id).filter((e) => e.kind === "studio-run-end-failed")).toHaveLength(STUDIO_END_RETRY_LIMIT);
  });
});

describe("Story 31.5: GET /inbox (contract 0.1.26 additive)", () => {
  const SECRET = "i".repeat(48);
  const ITEMS = [
    { issue: "TKS-3", entity: "ST-003", title: "Gamma", priority: "Highest", blocked_since: "2026-10-24T09:00:00+00:00",
      reason_comment: { id: "10001", body: "[~accountid:acc-owner] Blocked: x\nResolves when: y", created: "2026-10-24T09:00:00.000+0000" }, state: "open" },
    { issue: "TKS-1", priority: null, blocked_since: "2026-10-24T08:00:00+00:00", reason_comment: null, state: "resolved" },
  ];
  function routed(o: { file?: string | null } = {}) {
    const root = mkdtempSync(join(tmpdir(), "tk-sup-inbox-root-"));
    if (o.file !== null) {
      mkdirSync(join(root, "_bmad-output", "tracking"), { recursive: true });
      writeFileSync(join(root, "_bmad-output", "tracking", "inbox.json"), o.file ?? JSON.stringify({
        inbox_version: 1, generated_at: "2026-10-24T12:00:00+00:00", project_key: "TKS", items: ITEMS }));
    }
    const queue = new Queue(join(mkdtempSync(join(tmpdir(), "tk-sup-inbox-q-")), "q.db"), { ownerAlive: () => false, engineLive: async () => ({ live: false }) });
    const handler = createApi({
      queue, token: TOKEN, session: { secret: SECRET }, submit: async () => { throw new Error("never"); },
      registry: async () => ({ projects: { p: { root } } }),
    });
    const call = (method: string, path: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
      handler(new Request(`${BASE}${path}`, { method, headers }));
    return { root, call };
  }

  test("with the bearer: the file's items exactly as served; no project 400; unknown 404; POST 405", async () => {
    const fx = routed();
    const ok = await fx.call("GET", "/inbox?project=p");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, project: "p", generated_at: "2026-10-24T12:00:00+00:00", items: ITEMS });
    const none = await fx.call("GET", "/inbox");
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ ok: false, error: "ProjectRequired" });
    const unknown = await fx.call("GET", "/inbox?project=nope");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ ok: false, error: "UnknownProject", project: "nope" });
    const post = await fx.call("POST", "/inbox?project=p");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
  });

  test("with a session cookie: the same answer; no auth is 401", async () => {
    const fx = routed();
    const cookie = `${SESSION_COOKIE}=${signSession(SECRET, "token", Date.now())}`;
    const viaCookie = await fx.call("GET", "/inbox?project=p", { cookie });
    expect(viaCookie.status).toBe(200);
    expect(((await viaCookie.json()) as { items: unknown[] }).items).toEqual(ITEMS);
    const anon = await fx.call("GET", "/inbox?project=p", {});
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ ok: false, error: "Unauthorized" });
  });

  test("a missing file is an empty list with generated_at null, never a 404; a malformed one too", async () => {
    for (const file of [null, "{not json"]) {
      const fx = routed({ file });
      const res = await fx.call("GET", "/inbox?project=p");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, project: "p", generated_at: null, items: [] });
    }
  });
});
