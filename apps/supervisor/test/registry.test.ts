// Story 29.2: the agent registry — the role → leg mapping, the persona bindings, the live leg, the rebuild points,
// the `GET /agents` route and the status page's Agents section. The host registry and the resolver are injected:
// no `uv`, no real registry.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createApi } from "../src/api";
import { SESSION_COOKIE, signSession } from "../src/auth";
import { cancelRun, drainQueue, rebuildQuietly, recoverQueue } from "../src/cli";
import { gatherPage, renderPage } from "../src/page";
import { Queue, type Owner, type Probes, type WorkerKill } from "../src/queue";
import {
  loadPersonas, OFFLINE, PERSONAS_PATH, readAgents, rebuildAgents, ROLE_LEGS, ROLES, rowsFor, type RebuildDeps, type RebuildResult, type Route,
} from "../src/registry";
import { tempDir, track } from "./tmp";

const TOKEN = "tok-29-2-registry-secret";
const SECRET = "s".repeat(48);
const ME: Owner = { pid: process.pid, host: hostname(), nonce: "registry-test" };

/** A resolve route with distinct values per leg (contract §5.1 legs), `consult` missing its effort. */
const ROUTE: Route = {
  session: { model: "claude-opus-5-5", effort: "high", advisor: "fable" },
  implementer: { model: "claude-sonnet-5", effort: "medium", advisor: "off" },
  reviewers: { model: "claude-opus-5", effort: "low", advisor: "opus" },
  consult: { model: "claude-fable-5-1" },
  seam: { model: "seam-model", effort: "low" },
  review: { model: "review-model", effort: "high" },
  triage: { model: "triage-model", effort: "low" },
  supervise: { model: "claude-haiku-4-5-20251001", effort: "medium", advisor: "off" },
  planner: { model: "claude-fable-5-1", effort: "high", advisor: "fable" },
};

function fixture() {
  const dir = tempDir("tk-sup-agents-");
  const probes: Probes = {
    ownerAlive: (o) => o.nonce === ME.nonce,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
  };
  const queue = track(new Queue(join(dir, "q.db"), probes));
  const roots: Record<string, string> = {
    p: tempDir("tk-sup-agents-p-"), q: tempDir("tk-sup-agents-q-"),
  };
  let projects: string[] = ["p", "q"];
  let tick = 0;
  const resolved: string[] = [];
  const deps: Partial<RebuildDeps> & { registry: RebuildDeps["registry"]; resolve: RebuildDeps["resolve"] } = {
    registry: async () => ({ ok: true, projects: Object.fromEntries(projects.map((id) => [id, { root: roots[id] }])) }),
    resolve: async (root, id) => { resolved.push(`${id}@${root}`); return ROUTE; },
    now: () => `2026-10-18T00:00:${String(++tick).padStart(2, "0")}.000Z`,
  };
  const setProjects = (ids: string[]) => { projects = ids; };
  return { dir, queue, roots, deps, setProjects, resolved, db: join(dir, "q.db") };
}

const byRole = (rows: { role: string }[]) => Object.fromEntries(rows.map((r) => [r.role, r])) as Record<string, any>;

describe("the mapping from a resolved route (AC1)", () => {
  test("seven rows per project per ROLE_LEGS: orchestrator ← supervise, reviewer ← reviewers, advisor ← session.advisor", () => {
    const rows = rowsFor("p", ROUTE, { session: "Session" }, null);
    expect(rows.map((r) => r.agent_id)).toEqual(ROLES.map((r) => `p/${r}`));
    const r = byRole(rows);
    expect(r.orchestrator).toMatchObject({ model: "claude-haiku-4-5-20251001", effort: "medium", advisor: "off" });
    expect(r.session).toMatchObject({ model: "claude-opus-5-5", effort: "high", advisor: "fable" });
    expect(r.implementer).toMatchObject({ model: "claude-sonnet-5", effort: "medium", advisor: "off" });
    expect(r.reviewer).toMatchObject({ model: "claude-opus-5", effort: "low", advisor: "opus" });
    expect(r.consult).toMatchObject({ model: "claude-fable-5-1", effort: null, advisor: null }); // missing → null
    expect(r.advisor).toMatchObject({ model: "fable", effort: null, advisor: null });
    expect(r.planner).toMatchObject({ model: "claude-fable-5-1", effort: "high", advisor: "fable" });
    for (const row of rows) {
      expect(row).toMatchObject({ project: "p", live_state: OFFLINE, jira_account: "", current_run: null, current_story: null });
      for (const v of ["seam-model", "review-model", "triage-model"]) expect(JSON.stringify(row)).not.toContain(v);
    }
    expect(r.session.persona).toBe("Session");
    expect(r.planner.persona).toBeNull();
    expect(Object.values(ROLE_LEGS).map((m) => m.leg)).not.toContain("seam");
  });

  test("a null route (a refusing resolve) keeps the ids with null model, effort and advisor", () => {
    const rows = rowsFor("p", null, {}, null);
    expect(rows.map((r) => r.agent_id)).toEqual(ROLES.map((r) => `p/${r}`));
    for (const row of rows) expect(row).toMatchObject({ model: null, effort: null, advisor: null, persona: null });
  });
});

describe("personas (AC1)", () => {
  test("the shipped personas.json names all seven roles", () => {
    const shipped = JSON.parse(readFileSync(PERSONAS_PATH, "utf-8"));
    expect(Object.keys(shipped).sort()).toEqual([...ROLES].sort());
    const { personas, problem } = loadPersonas();
    expect(problem).toBeUndefined();
    for (const role of ROLES) expect(typeof personas[role]).toBe("string");
    for (const v of Object.values(shipped) as Record<string, unknown>[]) expect(Object.keys(v)).toEqual(["display_name"]);
  });

  test("a missing role or file is persona null; malformed JSON is PersonasInvalid and the rebuild still writes rows", async () => {
    const dir = tempDir("tk-sup-personas-");
    const partial = join(dir, "partial.json");
    writeFileSync(partial, JSON.stringify({ session: { display_name: "Sess" } }));
    expect(loadPersonas(partial).personas).toMatchObject({ session: "Sess", planner: null });
    expect(loadPersonas(join(dir, "absent.json"))).toEqual({ personas: {} });
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    const fx = fixture();
    const res = await rebuildAgents(fx.queue, { ...fx.deps, personas: bad });
    expect(res.rebuilt).toBe(true);
    if (!res.rebuilt) throw new Error("not rebuilt");
    expect(res.problems.some((p) => p.startsWith("PersonasInvalid:"))).toBe(true);
    const { agents } = readAgents(fx.queue);
    expect(agents).toHaveLength(14);
    expect(agents.every((a) => a.persona === null)).toBe(true);
  });
});

describe("rebuildAgents: projects, the live leg, failures (AC1)", () => {
  test("the live run's routing.current.json supplies the legs, current_run and current_story; after its end resolve again", async () => {
    const fx = fixture();
    const run = fx.queue.enqueue({ jobId: "j", root: fx.roots.p, projectId: "p", definition: { id: "j" }, owner: ME }).run;
    expect((await fx.queue.claim(run.run_id, ME)).claimed).toBe(true);
    const wt = tempDir("tk-sup-agents-wt-");
    fx.queue.recordWorktree(run.run_id, wt, { branch: `supervisor/run-${run.run_id}`, base_ref: "main" });
    mkdirSync(join(wt, ".bmad-loop"), { recursive: true });
    writeFileSync(join(wt, ".bmad-loop", "routing.current.json"), JSON.stringify({
      story: "29-1", written_at: new Date(Date.parse(run.created) + 1000).toISOString(), ...ROUTE, session: { model: "claude-sonnet-5", effort: "low", advisor: "opus" },
      consult_triggers: [], consult_scope: "", matched_rule: null, story_override: false, sources: {},
    }));
    let res = await rebuildAgents(fx.queue, fx.deps);
    expect(res).toMatchObject({ rebuilt: true, projects: ["p", "q"], problems: [] });
    const p = byRole(readAgents(fx.queue, "p").agents);
    expect(p.session).toMatchObject({ model: "claude-sonnet-5", effort: "low", advisor: "opus", current_run: run.run_id, current_story: "29-1" });
    expect(p.advisor).toMatchObject({ model: "opus", current_run: run.run_id, current_story: "29-1" });
    expect(fx.resolved.some((r) => r.startsWith("p@"))).toBe(false); // the file, not resolve
    expect(byRole(readAgents(fx.queue, "q").agents).session).toMatchObject({ model: "claude-opus-5-5", current_run: null });

    fx.queue.end(run.run_id, "complete", null);
    res = await rebuildAgents(fx.queue, fx.deps);
    const after = byRole(readAgents(fx.queue, "p").agents);
    expect(after.session).toMatchObject({ model: "claude-opus-5-5", effort: "high", current_run: null, current_story: null });
    expect(fx.resolved.some((r) => r === `p@${fx.roots.p}`)).toBe(true);
  });

  test("a routing.current.json written before the run was created (copied from the checkout) is no file: resolve, no live leg, no problem", async () => {
    const fx = fixture();
    const run = fx.queue.enqueue({ jobId: "j", root: fx.roots.p, projectId: "p", definition: { id: "j" }, owner: ME }).run;
    expect((await fx.queue.claim(run.run_id, ME)).claimed).toBe(true);
    const wt = tempDir("tk-sup-agents-wt-");
    fx.queue.recordWorktree(run.run_id, wt, { branch: `supervisor/run-${run.run_id}`, base_ref: "main" });
    mkdirSync(join(wt, ".bmad-loop"), { recursive: true });
    const earlier = new Date(Date.parse(run.created) - 60_000).toISOString().replace("Z", "+00:00");
    writeFileSync(join(wt, ".bmad-loop", "routing.current.json"), JSON.stringify({
      story: "old", written_at: earlier, ...ROUTE, session: { model: "claude-sonnet-5", effort: "low", advisor: "opus" },
    }));
    const res = await rebuildAgents(fx.queue, fx.deps);
    expect(res).toMatchObject({ rebuilt: true, problems: [] });
    expect(fx.resolved.some((r) => r === `p@${fx.roots.p}`)).toBe(true);
    for (const a of readAgents(fx.queue, "p").agents) expect(a).toMatchObject({ current_run: null, current_story: null });
    expect(byRole(readAgents(fx.queue, "p").agents).session).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
  });

  test("a routing.current.json written in the run's created second (written_at to the second, created sub-second) is the live leg", async () => {
    const fx = fixture();
    const run = fx.queue.enqueue({ jobId: "j", root: fx.roots.p, projectId: "p", definition: { id: "j" }, owner: ME }).run;
    expect((await fx.queue.claim(run.run_id, ME)).claimed).toBe(true);
    // Force a non-zero millisecond part on `created`, so written_at (its second) is numerically earlier than it.
    const second = Math.floor(Date.parse(run.created) / 1000) * 1000;
    const created = new Date(second + 456).toISOString();
    const db = new Database(fx.db);
    db.query("UPDATE runs SET created = ? WHERE run_id = ?").run(created, run.run_id);
    db.close();
    const wt = tempDir("tk-sup-agents-wt-");
    fx.queue.recordWorktree(run.run_id, wt, { branch: `supervisor/run-${run.run_id}`, base_ref: "main" });
    expect(fx.queue.runs().find((r) => r.run_id === run.run_id)?.created).toBe(created);
    mkdirSync(join(wt, ".bmad-loop"), { recursive: true });
    const writtenAt = new Date(second).toISOString().replace(".000Z", "+00:00"); // pipeline.py: timespec="seconds"
    writeFileSync(join(wt, ".bmad-loop", "routing.current.json"), JSON.stringify({
      story: "29-2", written_at: writtenAt, ...ROUTE, session: { model: "claude-sonnet-5", effort: "low", advisor: "opus" },
    }));
    const res = await rebuildAgents(fx.queue, fx.deps);
    expect(res).toMatchObject({ rebuilt: true, problems: [] });
    const p = byRole(readAgents(fx.queue, "p").agents);
    expect(p.session).toMatchObject({ model: "claude-sonnet-5", effort: "low", advisor: "opus", current_run: run.run_id, current_story: "29-2" });
    expect(p.advisor).toMatchObject({ model: "opus", current_run: run.run_id, current_story: "29-2" });
  });

  test("an unreadable routing.current.json falls back to resolve and is named", async () => {
    const fx = fixture();
    const run = fx.queue.enqueue({ jobId: "j", root: fx.roots.p, projectId: "p", definition: { id: "j" }, owner: ME }).run;
    expect((await fx.queue.claim(run.run_id, ME)).claimed).toBe(true);
    const wt = tempDir("tk-sup-agents-wt-");
    fx.queue.recordWorktree(run.run_id, wt, { branch: `supervisor/run-${run.run_id}`, base_ref: "main" });
    mkdirSync(join(wt, ".bmad-loop"), { recursive: true });
    writeFileSync(join(wt, ".bmad-loop", "routing.current.json"), "{ broken");
    const res = await rebuildAgents(fx.queue, fx.deps);
    if (!res.rebuilt) throw new Error("not rebuilt");
    expect(res.problems.some((p) => p.startsWith("RoutingCurrentUnreadable: p:"))).toBe(true);
    expect(byRole(readAgents(fx.queue, "p").agents).session).toMatchObject({ model: "claude-opus-5-5", current_run: null });
  });

  test("a dropped project disappears; a failing registry leaves the table unchanged; a refusing resolve keeps null rows", async () => {
    const fx = fixture();
    await rebuildAgents(fx.queue, fx.deps);
    expect(readAgents(fx.queue).agents).toHaveLength(14);
    fx.setProjects(["p"]);
    await rebuildAgents(fx.queue, fx.deps);
    expect(readAgents(fx.queue, "q").agents).toEqual([]);
    expect(readAgents(fx.queue).agents.map((a) => a.agent_id)).toEqual(ROLES.map((r) => `p/${r}`));

    const before = readAgents(fx.queue);
    for (const registry of [async () => { throw new Error("registry unreadable"); }, async () => ({ ok: false, error: "refused" })]) {
      const res = await rebuildAgents(fx.queue, { ...fx.deps, registry });
      expect(res.rebuilt).toBe(false);
      expect(res).toHaveProperty("problem");
      expect(readAgents(fx.queue)).toEqual(before);
    }

    const res = await rebuildAgents(fx.queue, { ...fx.deps, resolve: async () => { throw new Error("route refused: pairing"); } });
    if (!res.rebuilt) throw new Error("not rebuilt");
    expect(res.problems).toEqual([expect.stringMatching(/^RouteResolveFailed: p: .*route refused: pairing/)]);
    const rows = readAgents(fx.queue).agents;
    expect(rows.map((a) => a.agent_id)).toEqual(ROLES.map((r) => `p/${r}`));
    for (const a of rows) expect(a).toMatchObject({ model: null, effort: null, advisor: null });
    expect(fx.queue.serviceEvents()).toEqual([]); // a rebuild never writes service_events
  });

  test("a rebuild over zero projects records its time: rebuilt_at is non-null with no rows", async () => {
    const fx = fixture();
    fx.setProjects([]);
    const res = await rebuildAgents(fx.queue, fx.deps);
    expect(res).toMatchObject({ rebuilt: true, projects: [], problems: [] });
    if (!res.rebuilt) throw new Error("not rebuilt");
    expect(readAgents(fx.queue)).toEqual({ rebuilt_at: res.rebuilt_at, agents: [] });
  });

  test("overlapping rebuilds: the snapshot time is taken before the reads, and an older snapshot never overwrites a newer one", async () => {
    const fx = fixture();
    const order: string[] = [];
    let clock = 0;
    const now = () => { order.push("now"); return `2026-10-18T01:00:${String(++clock).padStart(2, "0")}.000Z`; };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // A: snapshot 01:00:01, its registry read held until B has written.
    const slow = rebuildAgents(fx.queue, { ...fx.deps, now, registry: async () => { order.push("registry"); await gate; return fx.deps.registry(); } });
    expect(order).toEqual(["now", "registry"]);
    // B: snapshot 01:00:02, written first, with q dropped.
    fx.setProjects(["p"]);
    const fast = await rebuildAgents(fx.queue, { ...fx.deps, now, registry: async () => ({ ok: true, projects: { p: { root: fx.roots.p } } }) });
    expect(fast).toMatchObject({ rebuilt: true, rebuilt_at: "2026-10-18T01:00:02.000Z" });
    fx.setProjects(["p", "q"]);
    release();
    const stale = await slow;
    expect(stale).toEqual({ rebuilt: false, problem: expect.stringMatching(/^RebuildSuperseded: .*2026-10-18T01:00:01\.000Z/) });
    const after = readAgents(fx.queue);
    expect(after.rebuilt_at).toBe("2026-10-18T01:00:02.000Z");
    expect(after.agents.map((a) => a.agent_id)).toEqual(ROLES.map((r) => `p/${r}`)); // B's rows, not A's
    // A later snapshot still writes.
    expect(await rebuildAgents(fx.queue, { ...fx.deps, now })).toMatchObject({ rebuilt: true, rebuilt_at: "2026-10-18T01:00:03.000Z" });
    expect(readAgents(fx.queue).agents).toHaveLength(14);
  });

  test("a stored rebuilt_at in the future (the clock moved back) never blocks: a present-day snapshot writes", async () => {
    const fx = fixture();
    expect(await rebuildAgents(fx.queue, { ...fx.deps, now: () => "2099-01-01T00:00:00.000Z" })).toMatchObject({ rebuilt: true });
    fx.setProjects(["p"]);
    const present = new Date().toISOString();
    expect(await rebuildAgents(fx.queue, { ...fx.deps, now: () => present })).toMatchObject({ rebuilt: true, rebuilt_at: present });
    const after = readAgents(fx.queue);
    expect(after.rebuilt_at).toBe(present);
    expect(after.agents.map((a) => a.agent_id)).toEqual(ROLES.map((r) => `p/${r}`));
    // The injected clock: a stored stamp not after it still refuses an older snapshot.
    expect(fx.queue.replaceAgents([], "2020-01-01T00:00:00.000Z", "2099-06-01T00:00:00.000Z")).toBe(false);
    expect(fx.queue.replaceAgents([], "2020-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z")).toBe(true);
  });

  test("the runs are read once per rebuild, not once per project", async () => {
    const fx = fixture();
    const runs = fx.queue.runs.bind(fx.queue);
    let reads = 0;
    fx.queue.runs = ((...a: Parameters<typeof runs>) => { reads++; return runs(...a); }) as typeof runs;
    await rebuildAgents(fx.queue, fx.deps);
    expect(readAgents(fx.queue).agents).toHaveLength(14);
    expect(reads).toBe(1);
  });
});

describe("the rebuild points (AC1)", () => {
  test("rebuildQuietly: injected deps rebuild; false and an uninjected call under bun test skip; a throwing registry never throws", async () => {
    const fx = fixture();
    expect(await rebuildQuietly(fx.queue, false)).toBeNull();
    expect(await rebuildQuietly(fx.queue)).toBeNull();
    expect(readAgents(fx.queue).rebuilt_at).toBeNull();
    const res = await rebuildQuietly(fx.queue, fx.deps);
    expect(res).toMatchObject({ rebuilt: true });
    const at = readAgents(fx.queue).rebuilt_at;
    expect(at).not.toBeNull();
    const failed = await rebuildQuietly(fx.queue, { ...fx.deps, registry: async () => { throw new Error("StudioRootMissing: TK_STUDIO_ROOT is not set"); } });
    expect(failed).toMatchObject({ rebuilt: false });
    expect(readAgents(fx.queue).rebuilt_at).toBe(at);
  });

  test("an end (cancelRun) rebuilds: rebuilt_at advances", async () => {
    const fx = fixture();
    await rebuildAgents(fx.queue, fx.deps);
    const first = readAgents(fx.queue).rebuilt_at!;
    const run = fx.queue.enqueue({ jobId: "j", root: fx.roots.p, projectId: "p", definition: { id: "j" } }).run;
    const ended = await cancelRun(fx.queue, run.run_id, { verbRunner: async () => { throw new Error("never called"); }, agents: fx.deps });
    expect(ended.state).toBe("cancelled");
    const second = readAgents(fx.queue).rebuilt_at!;
    expect(second > first).toBe(true);
  });

  test("the HTTP cancel answers before the rebuild finishes; the rebuild still runs and is never awaited by the answer", async () => {
    const fx = fixture();
    await rebuildAgents(fx.queue, fx.deps);
    const first = readAgents(fx.queue).rebuilt_at!;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const rebuilds: Promise<RebuildResult | null>[] = [];
    const handler = createApi({
      queue: fx.queue, token: TOKEN, submit: async () => { throw new Error("never"); },
      agents: { ...fx.deps, registry: async () => { await gate; return fx.deps.registry(); } },
      onAgentsRebuild: (p) => { rebuilds.push(p); },
    });
    const run = fx.queue.enqueue({ jobId: "j", root: fx.roots.p, projectId: "p", definition: { id: "j" } }).run;
    const res = await handler(new Request(`http://100.64.0.1:8787/runs/${run.run_id}/cancel`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).state).toBe("cancelled");
    expect(rebuilds).toHaveLength(1); // started by the cancel's end
    expect(readAgents(fx.queue).rebuilt_at).toBe(first); // the answer came while the rebuild still waits
    release();
    expect(await rebuilds[0]).toMatchObject({ rebuilt: true });
    expect(readAgents(fx.queue).rebuilt_at! > first).toBe(true);
  });

  // `recoverQueue` and `drainQueue` need the studio root (`requireStudio`); the claim's rebuild runs inside `runJob`,
  // which needs the real studio verbs and a worker — pinned here through `rebuildQuietly` above.
  describe.skipIf(!process.env.TK_STUDIO_ROOT || spawnSync("uv", ["--version"]).status !== 0)("with the studio root", () => {
    test("recoverQueue (every tick) and drainQueue rebuild: rebuilt_at advances", async () => {
      const fx = fixture();
      const home = tempDir("tk-sup-agents-home-");
      const opts = { queue: fx.queue, owner: ME, hygiene: { env: {} }, worktree: { env: { ...process.env, TK_STUDIO_HOME: home } }, agents: fx.deps };
      const verbs = async () => ({ ok: true, runs: [] });
      await recoverQueue(opts, verbs);
      const first = readAgents(fx.queue).rebuilt_at!;
      expect(first).not.toBeNull();
      await recoverQueue(opts, verbs);
      const second = readAgents(fx.queue).rebuilt_at!;
      expect(second > first).toBe(true);
      await drainQueue(opts, verbs);
      expect(readAgents(fx.queue).rebuilt_at! > second).toBe(true);
    }, 60_000);
  });
});

describe("GET /agents (AC2)", () => {
  async function populated() {
    const fx = fixture();
    await rebuildAgents(fx.queue, fx.deps);
    const handler = createApi({ queue: fx.queue, token: TOKEN, session: { secret: SECRET }, submit: async () => { throw new Error("never"); } });
    const call = (method: string, path: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
      handler(new Request(`http://100.64.0.1:8787${path}`, { method, headers }));
    return { ...fx, call };
  }

  test("the bearer reads every row with the rebuild time; ?project filters; an unknown project is []", async () => {
    const fx = await populated();
    const all = await fx.call("GET", "/agents");
    expect(all.status).toBe(200);
    const body = await all.json() as any;
    expect(body.ok).toBe(true);
    expect(body.rebuilt_at).toBe(readAgents(fx.queue).rebuilt_at);
    expect(body.agents.map((a: any) => a.agent_id)).toEqual([...ROLES.map((r) => `p/${r}`), ...ROLES.map((r) => `q/${r}`)]);
    expect(body.agents[0]).toEqual({
      agent_id: "p/orchestrator", project: "p", role: "orchestrator", model: "claude-haiku-4-5-20251001", effort: "medium", advisor: "off",
      persona: expect.any(String), live_state: "offline", current_run: null, current_story: null, jira_account: "",
    });
    const one = await (await fx.call("GET", "/agents?project=q")).json() as any;
    expect(one.agents.map((a: any) => a.agent_id)).toEqual(ROLES.map((r) => `q/${r}`));
    const none = await fx.call("GET", "/agents?project=nope");
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ ok: true, rebuilt_at: body.rebuilt_at, agents: [] });
  });

  test("a session cookie reads it; no auth is 401 JSON; POST is 405 Allow: GET", async () => {
    const fx = await populated();
    const cookie = `${SESSION_COOKIE}=${signSession(SECRET, "token", Date.now())}`;
    const viaCookie = await fx.call("GET", "/agents?project=p", { cookie });
    expect(viaCookie.status).toBe(200);
    expect(((await viaCookie.json()) as any).agents).toHaveLength(7);
    const anon = await fx.call("GET", "/agents", {});
    expect(anon.status).toBe(401);
    expect(anon.headers.get("content-type")).toStartWith("application/json");
    expect(await anon.json()).toMatchObject({ ok: false, error: "Unauthorized" });
    const post = await fx.call("POST", "/agents");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
  });

  test("GET writes nothing: the table bytes and rebuilt_at are unchanged after the reads", async () => {
    const fx = await populated();
    fx.queue.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const dump = () => JSON.stringify(fx.queue.db.query("SELECT * FROM agents ORDER BY agent_id").all());
    const bytes = () => readFileSync(fx.db).toString("base64") + (existsSync(`${fx.db}-wal`) ? readFileSync(`${fx.db}-wal`).toString("base64") : "");
    const before = { rows: dump(), at: readAgents(fx.queue).rebuilt_at, bytes: bytes() };
    for (const path of ["/agents", "/agents?project=p", "/agents?project=nope", "/"]) expect((await fx.call("GET", path)).status).toBe(200);
    expect({ rows: dump(), at: readAgents(fx.queue).rebuilt_at, bytes: bytes() }).toEqual(before);
    expect(fx.resolved).toHaveLength(2); // the one rebuild's resolves only
  });
});

describe("the status page's Agents section (AC2)", () => {
  test("<section id=\"agents\"> lists each project's roles as text; the page never calls the resolver", async () => {
    const fx = fixture();
    await rebuildAgents(fx.queue, fx.deps);
    const calls = fx.resolved.length;
    const data = await gatherPage({ queue: fx.queue, token: TOKEN, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" } });
    const html = renderPage(data);
    const section = html.slice(html.indexOf('<section id="agents">'), html.indexOf("</section>", html.indexOf('<section id="agents">')));
    expect(section).toContain("<h2>Agents</h2>");
    for (const id of ["p", "q"]) for (const role of ROLES) expect(section).toContain(`${id}/${role}`);
    expect(section).toContain("claude-haiku-4-5-20251001");
    expect(section).toContain("offline");
    expect(section).not.toContain("<script");
    expect(fx.resolved.length).toBe(calls);
  });

  test("after a rebuild over zero projects GET /agents carries rebuilt_at and the section does not say \"not rebuilt yet\"", async () => {
    const fx = fixture();
    fx.setProjects([]);
    const res = await rebuildAgents(fx.queue, fx.deps);
    if (!res.rebuilt) throw new Error("not rebuilt");
    const handler = createApi({ queue: fx.queue, token: TOKEN, submit: async () => { throw new Error("never"); } });
    const body = await (await handler(new Request("http://100.64.0.1:8787/agents", { headers: { authorization: `Bearer ${TOKEN}` } }))).json();
    expect(body).toEqual({ ok: true, rebuilt_at: res.rebuilt_at, agents: [] });
    const html = renderPage(await gatherPage({ queue: fx.queue, token: TOKEN, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" } }));
    expect(html).not.toContain("no agent registry rebuilt yet");
    expect(html).toContain('<section id="agents"><h2>Agents</h2><p class="note">no agents: the registry serves no projects</p></section>');
  });

  test("before any rebuild the section says so", async () => {
    const fx = fixture();
    const html = renderPage(await gatherPage({ queue: fx.queue, token: TOKEN, env: {}, registry: async () => ({ projects: {} }), ledger: { user: "u", machine: "m" } }));
    expect(html).toContain('<section id="agents"><h2>Agents</h2><p class="note">no agent registry rebuilt yet</p></section>');
  });
});
