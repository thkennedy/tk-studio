// Story 36.1: the fake assets and playable steps of a slice run's host leg, lifted from hostverify.test.ts so its cases
// and the sweep-driven close-out in worktree.test.ts read one fake. Its `sheet` answers bare frame names, as
// `playable.py sheet` does; its report names `<FRAMES_DIR>/<name>`, as `playable.py run` does.
import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRAMES_DIR } from "../../src/hostverify";

export const SLICE_REPORT = {
  schema: 1, verdict: "pass", failed: null, seed: 7, ticks: 120, ticks_run: 120, capture_every: 30, mode: "movie",
  frames: [{ tick: 0, file: `${FRAMES_DIR}/tick-000000.png` }, { tick: 30, file: `${FRAMES_DIR}/tick-000030.png` }],
  moments: [], frame_time_ms: { max: 20, mean: 16.6 }, log_errors: [],
};

type Answer = { exit: number | null; stdout: string; stderr: string };
export interface SliceRecorderOptions {
  exits?: number[];
  assets?: Record<string, number>;
  sheet?: number;
  /** Story 35.3: a verb's own stdout block (null: none, a crash's traceback). */
  blocks?: Record<string, Record<string, unknown> | null>;
  report?: Record<string, unknown>;
  /** `playable.py run` exits 0 with a passing block and the rubric answers, so the leg reaches the judge (default: exits 1). */
  passing?: boolean;
  /** The runner of every other command (default: `git show` answering `config`, as a leg alone needs). */
  through?: (bin: string, args: string[], o: any) => Promise<Answer>;
}

/** The runner: the config; the host and engine steps exit per `exits`; `assets.py <verb>` exits per `assets`; `playable.py
 * run` writes the report and frames; `playable.py sheet` writes the sheet and names the sampled frames. */
export function sliceRecorder(config: string, o: SliceRecorderOptions = {}) {
  const steps: string[][] = [];
  const timeouts: number[] = [];
  let plain = 0;
  const run = async (bin: string, args: string[], ro: { timeoutS: number }) => {
    if (o.through && bin !== process.execPath) return o.through(bin, args, ro);
    if (bin === "git") return { exit: 0, stdout: config, stderr: "" };
    const spec = JSON.parse(readFileSync(args[2]!, "utf-8"));
    const argv = spec.argv as string[];
    steps.push(argv);
    timeouts.push(ro.timeoutS);
    const script = String(argv[2] ?? "");
    const status = (exit: number, block?: Record<string, unknown>) => {
      writeFileSync(spec.out, block ? JSON.stringify(block, null, 2) + "\n" : `step\n`);
      writeFileSync(spec.status, JSON.stringify({ exit, signal: null }));
      return { exit: 0, stdout: "", stderr: "" };
    };
    if (script.endsWith("assets.py")) {
      const exit = o.assets?.[argv[3]!] ?? 0;
      const own = o.blocks?.[argv[3]!];
      if (own === null) {
        writeFileSync(spec.err, "Traceback (most recent call last):\nKeyError: 'colour'\n");
        return status(exit);
      }
      return status(exit, own ?? { ok: exit === 0, entries: [], status: exit === 0 ? "complete" : exit === 1 ? "partial" : "blocked", intent: "assets", artifacts: [], reason: exit ? `${argv[3]} not ok` : null });
    }
    if (script.endsWith("playable.py") && argv[3] === "sheet") {
      const out = argv[argv.indexOf("--out") + 1]!;
      expect(argv).not.toContain("--frames"); // Story 35.3: the report's citable frames only
      expect(existsSync(argv[argv.indexOf("--report") + 1]!)).toBe(true);
      const exit = o.sheet ?? 0;
      if (exit === 0) writeFileSync(out, "sheet-png");
      return status(exit, { ok: exit === 0, frames: ["tick-000000.png", "tick-000030.png"], status: exit === 0 ? "complete" : "blocked", intent: "playable", artifacts: [], reason: null });
    }
    if (script.endsWith("playable.py")) {
      const out = argv[argv.indexOf("--out") + 1]!;
      mkdirSync(join(out, FRAMES_DIR), { recursive: true });
      for (const f of SLICE_REPORT.frames) writeFileSync(join(out, f.file), "png");
      writeFileSync(join(out, "report.json"), JSON.stringify(o.report ?? SLICE_REPORT));
      writeFileSync(join(out, "log.txt"), "log\n");
      if (o.passing) return status(0, { ok: true, verdict: "pass", failed: null, status: "complete", intent: "playable", artifacts: [], reason: null });
      return status(1, { ok: false, verdict: "fail", failed: null, status: "partial", intent: "playable", artifacts: [], reason: "harness" });
    }
    if (o.passing && script.endsWith("playable_judge.py") && argv[3] === "rubric") {
      return status(0, { ok: true, ids: ["scene-loaded", "player-visible"], status: "complete", intent: "playable-judge", artifacts: [], reason: null });
    }
    return status(o.exits?.[plain++] ?? 0);
  };
  return { steps, timeouts, run };
}
