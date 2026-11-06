// Story 37.6 (AC1, DW-162, the retrospective's A2): one stop path for an engine. One table of the two tiers pins the
// builder (`engineStopArgv`) and every caller that stops or arms an engine (`armStop`, `rearmStop`, `launchStopGraceful`,
// `stopSweepEngine`): each executes the builder's argv, `--directory` present on both tiers, the sweep's stop without
// `--graceful`. A Windows studio root (`C:\GitHub\tk-studio`) keeps the sbx POSIX tail pinned (never a `path.join`).
// win32 too (DW-5): the fakes are bun scripts behind `fakeBin` (`uv.exe`, `sbx.exe` there).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { delimiter, join } from "node:path";
import { launchStopGraceful } from "../src/cli";
import { armStop, gracefulStopCommand, rearmStop } from "../src/closeout";
import { Queue, type EngineWhere } from "../src/queue";
import { engineStopArgv } from "../src/runners";
import type { RunResult } from "../src/server";
import { stopSweepEngine } from "../src/sweep";
import { fakeBin } from "./fakes";
import { tempDir, track } from "./tmp";

const E = "20261106-101010-ab12";
const STUDIO = "C:\\GitHub\\tk-studio";
const me = { pid: process.pid, host: hostname(), nonce: "runners-test" };
const OK: RunResult = { exit: 0, stdout: JSON.stringify({ ok: true, graceful: true }), stderr: "" };
/** A story run's definition (`runsStories`): the arming fixtures carry the launch target, as `closeout.test.ts`'s. */
const RUN_EPIC = { id: "run-epic-37", type: "run-epic", target: { skill: "tk-studio-launch", payload: { verb: "start", epic: 37 } }, stop: { after_stories: 1 } };

type Row = [string, EngineWhere, () => string, (root: string) => { bin: string; argv: string[] }];
const ROWS: Row[] = [
  ["host", { tier: "host", sandbox: null }, () => tempDir("tk-sup-runners-root-"),
    (root) => ({ bin: "uv", argv: ["run", join(STUDIO, "plugins", "tk-studio", "lib", "launch.py"), "stop", "--directory", root, "--run-id", E, "--graceful"] })],
  ["sbx", { tier: "sbx", sandbox: "claude-p" }, () => "C:\\work\\p",
    () => ({ bin: "sbx", argv: ["exec", "claude-p", "uv", "run", "/c/GitHub/tk-studio/plugins/tk-studio/lib/launch.py", "stop", "--directory", "/c/work/p", "--run-id", E, "--graceful"] })],
];
const hard = (argv: string[]) => argv.filter((a) => a !== "--graceful");

/** A launched run on `where`'s tier at `root` (its worktree too, no prefix: `engineRoot` and `servedRoot` agree). */
async function launched(root: string, where: EngineWhere) {
  const queue = track(new Queue(":memory:", { ownerAlive: (o) => o.nonce === me.nonce, engineLive: async () => ({ live: false, run_ids: [] }) }));
  const run0 = queue.enqueue({ jobId: "run-epic-37", root, projectId: "p37", definition: RUN_EPIC, owner: me, tier: where.tier!, ...(where.sandbox ? { sandbox: where.sandbox } : {}) }).run;
  if (!(await queue.claim(run0.run_id, me)).claimed) throw new Error("not claimed");
  queue.recordWorktree(run0.run_id, root, { branch: `supervisor/run-${run0.run_id}`, base_ref: "main" });
  queue.markLaunched(run0.run_id, E, { status_block: { status: "complete" }, end: { state: "complete", reason: null } });
  return { queue, run: () => queue.get(run0.run_id)! };
}

/** The injected seams (`deps.uv` on the host, `deps.sbx.run` on sbx): each call recorded as the command it would run. */
function seams() {
  const calls: { bin: string; argv: string[] }[] = [];
  const env = { TK_STUDIO_ROOT: STUDIO, TK_SUPERVISOR_NOTIFY: "" };
  return {
    calls,
    deps: {
      env,
      uv: async (_root: string, script: string, args: string[]) => { calls.push({ bin: "uv", argv: ["run", script, ...args] }); return OK; },
      sbx: { run: async (bin: string, argv: string[]) => { calls.push({ bin, argv }); return OK; } },
    },
  };
}

/** The real `launchStopGraceful` (it reads `process.env`) against fake `uv` (on PATH) and `sbx` (`SBX_BIN`), each
 * writing its argv; the studio root set there; all restored. */
async function withFakes<T>(body: (argv: (name: "uv" | "sbx") => string[], sbxBin: string) => Promise<T>): Promise<T> {
  const bin = tempDir("tk-sup-runners-bin-");
  const fake = (name: string) => fakeBin(join(bin, name), `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(join(bin, `${name}.argv`))}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ ok: true, graceful: true }) + "\\n");
`);
  fake("uv");
  const sbx = fake("sbx.js");
  const prev = { path: process.env.PATH, root: process.env.TK_STUDIO_ROOT, sbx: process.env.SBX_BIN };
  process.env.PATH = `${bin}${delimiter}${prev.path ?? ""}`;
  process.env.TK_STUDIO_ROOT = STUDIO;
  process.env.SBX_BIN = sbx;
  const restore = (k: "PATH" | "TK_STUDIO_ROOT" | "SBX_BIN", v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try { return await body((name) => JSON.parse(readFileSync(join(bin, name === "uv" ? "uv.argv" : "sbx.js.argv"), "utf-8")) as string[], sbx); }
  finally { restore("PATH", prev.path); restore("TK_STUDIO_ROOT", prev.root); restore("SBX_BIN", prev.sbx); }
}

describe("Story 37.6: one stop builder, routed by tier, `--directory` always present", () => {
  test.each(ROWS)("%s: engineStopArgv is the argv; --graceful only on request", (_tier, where, rootOf, expected) => {
    const root = rootOf(), want = expected(root), env = { TK_STUDIO_ROOT: STUDIO };
    expect(engineStopArgv(root, E, where, { graceful: true, env })).toEqual(want);
    expect(engineStopArgv(root, E, where, { env })).toEqual({ bin: want.bin, argv: hard(want.argv) });
    expect(engineStopArgv(root, E, where, { graceful: true, env }).argv).toContain("--directory");
  });

  test.each(ROWS)("%s: armStop, rearmStop and stopSweepEngine execute the builder's argv (the sweep without --graceful)", async (_tier, where, rootOf, expected) => {
    const root = rootOf(), want = expected(root);
    const armed = seams(), a = await launched(root, where);
    await armStop(a.queue, a.run(), 1, armed.deps);
    expect(armed.calls).toEqual([want]);
    expect(a.queue.events(a.run().run_id).filter((e) => e.kind === "stop-armed").map((e) => e.detail?.ok)).toEqual([true]);

    const rearmed = seams(), r = await launched(root, where);
    await rearmStop(r.queue, r.run(), rearmed.deps, true);
    expect(rearmed.calls).toEqual([want]);
    expect(r.queue.events(r.run().run_id).filter((e) => e.kind === "graceful-stop").map((e) => e.detail?.ok)).toEqual([true]);

    const swept = seams(), s = await launched(root, where);
    expect(await stopSweepEngine(s.run(), swept.deps)).toBe("stopped");
    expect(swept.calls).toEqual([{ bin: want.bin, argv: hard(want.argv) }]);
  });

  test.each(ROWS)("%s: launchStopGraceful (the real one) executes the builder's argv", async (tier, where, rootOf, expected) => {
    const root = rootOf(), want = expected(root);
    await withFakes(async (argv, sbxBin) => {
      expect(await launchStopGraceful(root, E, where)).toEqual({ ok: true, detail: `engine ${E} stopping gracefully` });
      expect(argv(tier === "sbx" ? "sbx" : "uv")).toEqual(want.argv);
      expect(engineStopArgv(root, E, where, { graceful: true }).bin).toBe(tier === "sbx" ? sbxBin : "uv");
    });
  });

  test.each(ROWS)("%s: the text form (gracefulStopCommand, the re-arm's and the arming's re-issue) is the builder's argv", async (tier, where, rootOf, expected) => {
    const root = rootOf(), want = expected(root), a = await launched(root, where);
    const text = gracefulStopCommand(a.run(), E, { TK_STUDIO_ROOT: STUDIO });
    expect(text).toBe(`${tier === "sbx" ? "MSYS_NO_PATHCONV=1 " : ""}${[want.bin, ...want.argv].join(" ")}`);
  });

  test("the builder throws where a path cannot be derived; the text form keeps placeholders", () => {
    const sbx: EngineWhere = { tier: "sbx", sandbox: "claude-p" };
    expect(() => engineStopArgv("C:\\work\\p", E, sbx, { env: {} })).toThrow(/StudioRoot/);
    expect(() => engineStopArgv("relative/p", E, sbx, { env: { TK_STUDIO_ROOT: STUDIO } })).toThrow(/VmPathUnderivable/);
    expect(() => engineStopArgv("/w/p", E, { tier: "host" }, { env: {} })).toThrow(/StudioRoot/);
    expect(engineStopArgv("relative/p", E, sbx, { env: {}, placeholders: true }).argv)
      .toEqual(["exec", "claude-p", "uv", "run", "<studio-root>/plugins/tk-studio/lib/launch.py", "stop", "--directory", "relative/p", "--run-id", E]);
  });
});
