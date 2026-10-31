// Story 36.4 (B11): the claim-path `TierRequired` inside the host gate. `command-line.test.ts` drives it too, but the
// gate excludes that file, so this drives `runJob` in process over a `:memory:` queue. The stored definition's branch
// needs no process and always runs; the fresh `validate()` branch needs the studio verbs over uv, so it runs where it can.
// Also here, DW-112's preload default: a child `bun test` proves the 30 s bound and that a test's own timeout wins.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runJob } from "../src/cli";
import { Queue } from "../src/queue";
import { fakeBin } from "./fakes";
import { tempDir, track } from "./tmp";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const JOB = "run-epic-35";
const hasUv = spawnSync("uv", ["--version"]).status === 0;
const LOGIN_PROBE = "auth status --json"; // `maxLoginPreflight`'s argv; a worker's starts with `-p`

/** Every name set here, restored after: under a plain `bun test` the files share one process. */
function withEnv(values: () => Record<string, string>): void {
  const prev: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const [name, value] of Object.entries(values())) { prev[name] = process.env[name]; process.env[name] = value; }
  });
  afterAll(() => {
    for (const [name, value] of Object.entries(prev)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
}

/** A `claude` and an `sbx` that log every call to a file, and answer a logged-in login probe. */
function spawnLogged() {
  const dir = tempDir("tk-sup-drain-bin-");
  const log = join(dir, "spawned.log");
  const script = [
    `require("node:fs").appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(" ") + "\\n");`,
    `console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));`,
  ].join("\n");
  return { log, claude: fakeBin(join(dir, "fake-claude.js"), script), sbx: fakeBin(join(dir, "fake-sbx.js"), script) };
}

function refusalsAndClaims(q: Queue, runId: string) {
  const events = q.events(runId);
  return { refused: events.filter((e) => e.kind === "claim-refused"), kinds: events.map((e) => e.kind) };
}

describe("Story 36.4 (B11): a drained run whose definition requires a tier its placement lacks stays queued", () => {
  const bins = spawnLogged();
  withEnv(() => ({
    TK_STUDIO_ROOT: REPO_ROOT, TK_STUDIO_HOME: tempDir("tk-sup-drain-store-"), TK_SUPERVISOR_CONFIG: "",
    CLAUDE_BIN: bins.claude, SBX_BIN: bins.sbx,
  }));

  test("the stored definition: `placement:TierRequired` before the claim gate, one `claim-refused` across passes, no claim, no spawn", async () => {
    const root = tempDir("tk-sup-drain-proj-");
    const q = track(new Queue(":memory:"));
    const { run } = q.enqueue({ jobId: JOB, root, projectId: "p", definition: { requires: { tier: "sbx" } }, tier: "host" });
    for (let pass = 0; pass < 2; pass++) {
      const out = await runJob(JOB, root, undefined, { queue: q, runId: run.run_id, skipRecover: true, hygiene: { env: {} } });
      expect(out).toMatchObject({ ok: false, run_id: run.run_id, state: "queued", claim_refused: { reason: expect.stringContaining("TierRequired:") } });
    }
    expect(q.get(run.run_id)!.state).toBe("queued");
    const { refused, kinds } = refusalsAndClaims(q, run.run_id);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.detail).toMatchObject({ key: "placement:TierRequired" });
    expect(kinds).not.toContain("claimed");
    expect(existsSync(bins.log)).toBe(false);
  });

  describe.skipIf(!process.env.TK_STUDIO_ROOT || !hasUv)("with the studio root and uv", () => {
    test("the fresh `validate()` branch: a stored definition without `requires` is refused the same way, past the claim gate's probe, no worker", async () => {
      const root = tempDir("tk-sup-drain-proj-");
      mkdirSync(join(root, ".tk-studio", "jobs"), { recursive: true });
      writeFileSync(join(root, ".tk-studio", "jobs", `${JOB}.json`),
        JSON.stringify({ job_schema_version: 1, id: JOB, type: "run-epic", target: { payload: { epic: 35 } } }));
      const plugin = join(process.env.TK_STUDIO_ROOT!, "plugins", "tk-studio");
      const reg = spawnSync("uv", ["run", join(plugin, "lib", "registry.py"), "register", "--directory", root, "--writer", "onboard"],
        { env: process.env, encoding: "utf-8", timeout: 120_000 });
      if (reg.status !== 0) throw new Error(`register failed: ${reg.stdout}${reg.stderr}`);
      const q = track(new Queue(":memory:"));
      const { run } = q.enqueue({ jobId: JOB, root, projectId: "p", definition: {}, tier: "host" });
      const out = await runJob(JOB, root, undefined, { queue: q, runId: run.run_id, skipRecover: true, hygiene: { env: {} } });
      expect(out).toMatchObject({ ok: false, state: "queued", claim_refused: { reason: expect.stringContaining("TierRequired:") } });
      expect(q.get(run.run_id)!.state).toBe("queued");
      const { refused, kinds } = refusalsAndClaims(q, run.run_id);
      expect(refused).toHaveLength(1);
      expect(refused[0]!.detail).toMatchObject({ key: "placement:TierRequired" });
      expect(kinds).not.toContain("claimed");
      // no spawn: the fake `claude` is the claim gate's login probe too, so the log holds that probe and nothing else
      const logged = readFileSync(bins.log, "utf-8").split("\n").filter(Boolean);
      expect(logged).toContain(LOGIN_PROBE);
      expect(logged.filter((argv) => argv !== LOGIN_PROBE)).toEqual([]);
    }, 120_000);
  });
});

describe("Story 36.4 (DW-112): the preload's default test timeout in a child bun test", () => {
  const preload = resolve(import.meta.dir, "preload.ts");

  function runFixture(body: string): { status: number | null; out: string } {
    const fixtures = tempDir("tk-sup-drain-child-");
    writeFileSync(join(fixtures, "fixture.test.ts"), [`import { test } from "bun:test";`, body].join("\n"));
    const child = spawnSync(process.execPath, ["test", "--preload", preload, "./fixture.test.ts"], {
      cwd: fixtures, env: process.env, encoding: "utf-8", timeout: 60_000, killSignal: "SIGKILL",
    });
    return { status: child.status, out: `${child.stdout ?? ""}${child.stderr ?? ""}` };
  }

  test("a test with no timeout of its own outlasts bun's 5 s", () => {
    const { status, out } = runFixture(`test("slow", async () => { await new Promise((r) => setTimeout(r, 5_500)); });`);
    if (status !== 0) console.error(out);
    expect(status).toBe(0);
  }, 90_000); // its own bound: the preload's default reaches only a run's first file (see preload.ts)

  test("a test's own timeout wins", () => {
    const { status, out } = runFixture(`test("slow", async () => { await new Promise((r) => setTimeout(r, 2_000)); }, 100);`);
    expect(status).not.toBe(0);
    expect(out).toContain("timed out after 100ms");
  }, 90_000);
});
