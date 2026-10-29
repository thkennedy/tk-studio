#!/usr/bin/env bun
/**
 * tk-studio conformance suite THROUGH the studio supervisor (driver contract
 * §8): "A connector implementing this contract SHOULD run the same suite
 * through itself — passing it is the definition of a conforming driver."
 *
 * The shipped suite (`plugins/tk-studio/contracts/conformance/`) drives each
 * surface's deterministic core by direct invocation. This harness drives the
 * SAME manifest drives through the supervisor: a live `server.ts` stdio
 * instance, one `tk_invoke` per drive. Translation is contract-sanctioned
 * — §2: "payload fields map 1:1 onto the named CLI's flags" — so a drive's
 * argv becomes the skill payload mechanically (flags → snake_case fields,
 * value-less flags → true, a leading positional verb kept only where §2
 * declares a `verb` payload field). A relative `--directory` value (one
 * without `{sandbox}`) is resolved against the plugin root — the direct
 * runner's cwd — before translation; a drive routed through `tk_invoke` then
 * gets a copy of that fixture staged inside its sandbox, so the worker never
 * points at the installed plugin (direct drives keep the plugin path).
 *
 * Checks per surface mirror `runner.py run` one for one, so the two reports
 * compare: `registered`, `status-block`, `unrunnable-core`, `auth-preflight`
 * (static checks over contract-published files only — SKILL.md, the
 * manifest, `status-block.schema.json`), then one check per manifest drive.
 *
 * Assertions per drive (§8): the run terminates with a valid §3 status block
 * (never a hang, never a prompt), `expect: "refusal"` ends `blocked` with the
 * declared marker named, `expect: "ok"` demands the chain succeeded (a
 * `complete` block — the skill-mediated analog of the direct runner's
 * ok=true), and the driver's own §1 auth preflight fires before any
 * backend-touching run. Drives the §2 payload cannot express — fixture CLIs
 * outside the surface's deterministic core (session's run-init, the job e2e
 * chain, the capture refusal) and run-workspace-mediated or non-payload
 * verbs (research's seed|spine, launch's pipeline.py resolve|apply) — run
 * direct via uv instead: the §1 pure-data allowance, evaluated by the
 * manifest's own expect semantics. Sandbox isolation matches the direct
 * runner: per-surface throwaway project dirs and one throwaway TK_STUDIO_HOME
 * store shared by supervisor children AND direct runs (so ordered fixtures
 * chain), nothing touching the real per-user store.
 *
 * Harness drives (`expect: harness-blocked`) are spend-bearing: without
 * `--harness` each is one ok check naming the skip; with it the surface runs
 * through the supervisor's worker path (host mode `auto`, no API key, the
 * drive's deny-only `settings` profile forwarded as `--settings`), bounded by
 * the drive's `timeout` or 180 s, and is judged per §8. The report carries
 * `harness_pass: {declared, state}` like the runner.
 *
 * `--compare-direct` also runs `runner.py run --no-emit` (`--harness`
 * forwarded iff given) and compares: both ok, same surfaces, same per-surface
 * check count and assertion names; any divergence fails the pass.
 *
 * Failure emission stays studio-side: the taxonomy names the direct runner as
 * the sole `headless-failure` emitter — this harness reports, it does not emit.
 *
 * CLI:
 *   bun src/conformance.ts [--surface NAME]... [--timeout-s N] [--concurrency N]
 *                          [--harness] [--compare-direct] [--json] [--keep-sandbox]
 *
 * Exit codes: 0 all checks pass; 1 failures or a divergence; 2 the harness
 * (or, under --compare-direct, the direct runner) cannot run.
 */
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { ConnectorClient, type InvokeOutcome } from "./client";
import { lastJsonObject, resolveStudioRoot } from "./server";

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_S = 600; // a skill-surface drive is a full claude -p run; research-class surfaces do real bounded work
const DEFAULT_CONCURRENCY = 3;
/** The §8 harness bound when a drive declares no `timeout` (the runner's HARNESS_TIMEOUT). */
export const HARNESS_TIMEOUT_S = 180;
/** The direct runner's whole-suite wall clock under --compare-direct. */
const DIRECT_RUNNER_TIMEOUT_S = 3600;
/** The report's `driver`: this suite runs through the studio supervisor. */
export const DRIVER_NAME = "tk-studio-supervisor";

// ------------------------------------------------------------ manifest shapes

export interface Drive {
  assertion?: string;
  argv?: string[];
  prompt?: string;
  settings?: string;
  timeout?: number;
  expect?: string;
  marker?: string;
}

export interface SurfaceEntry {
  external_calls?: boolean;
  auth_preflight?: string;
  drives?: Drive[];
}

export interface Check {
  assertion: string;
  ok: boolean;
  detail: string;
  seconds?: number;
}

/** The parts of `status-block.schema.json` the checks read. */
export interface StatusSchema {
  required: string[];
  properties: Record<string, { enum?: string[] } & Record<string, unknown>>;
}

// ------------------------------------------------------------ drive → payload translation

/** Surfaces whose §2 payload row declares a `verb` field — everywhere else the
 * CLI's positional verb is the core's dispatch detail, not a payload field.
 * (session and knowledge joined at contract 0.1.7 — Epic 9.) */
const VERB_SURFACES = new Set([
  "tk-studio-job", "tk-studio-migrate", "tk-studio-session", "tk-studio-knowledge", "tk-studio-evolve", "tk-studio-launch",
  "tk-studio-track", // contract 0.1.26 (Story 31.5): verb `block`
]);

/** Each surface's §2 deterministic-core CLI basenames — the same hand-mirrored
 * contract knowledge as VERB_SURFACES. A drive whose argv[0] is any OTHER CLI
 * is a suite fixture (e.g. session's run-init via lib/job.py, the job e2e
 * chain, the capture refusal via lib/reconcile.py) and cannot be faithfully
 * expressed as a §2 skill payload. */
const SURFACE_CORES: Record<string, string[]> = {
  "tk-studio-activate": ["drift_check.py"],
  "tk-studio-install": ["install_base.py"],
  "tk-studio-base-update": ["base_update.py"],
  "tk-studio-detect": ["inventory.py", "detect.py"],
  "tk-studio-onboard": ["recommend.py"],
  "tk-studio-orchestrator": ["orchestrate.py"],
  "tk-studio-plan-sync": ["plansync.py"],
  "tk-studio-job": ["jobrun.py"],
  "tk-studio-session": ["session.py"],
  "tk-studio-knowledge": ["promote.py"],
  "tk-studio-observe": ["observe.py"],
  "tk-studio-research": ["research.py"],
  "tk-studio-measure-push": ["measurepush.py"],
  "tk-studio-consolidate": ["consolidate.py"],
  "tk-studio-migrate": ["migrate.py"],
  "tk-studio-report": ["report.py"],
  "tk-studio-evolve": ["evolve.py"],
  "tk-studio-launch": ["launch.py", "pipeline.py"],
  "tk-studio-track": ["track.py"], // contract 0.1.26 (Story 31.5)
  "tk-studio-playable-judge": ["playable_judge.py"], // Story 34.3
  "gds-engine-godot-4": ["engine_pin.py"], // Story 34.4
  "tk-studio-evals": ["evals.py"], // Story 35.5
};

/** Core verbs the §2 payload row does NOT declare — run-workspace-mediated
 * verbs an agent invokes mid-run (research's seed|spine land artifacts into a
 * live run), and launch's per-leg routing verbs (§2's launch payload declares
 * `start|status|stop`; `pipeline.py resolve|apply` cannot be expressed as it),
 * not driver-payload surface. */
const DIRECT_ONLY_VERBS: Record<string, string[]> = {
  "tk-studio-research": ["seed", "spine"],
  "tk-studio-launch": ["resolve", "apply"],
};

/** A spend-bearing §8 harness drive (a prompt + settings profile, no argv). */
export function isHarnessDrive(drive: Drive): boolean {
  return drive.expect === "harness-blocked";
}

/** True when a drive cannot be expressed as the surface's §2 payload and must
 * run direct via uv instead — the §1 allowance ("a driver MAY call those CLIs
 * directly for pure-data steps"). Direct drives share the suite's store, so
 * ordered fixtures (run-init before the session boundary drives) still chain. */
export function isDirectDrive(surface: string, drive: Drive): boolean {
  const argv = drive.argv ?? [];
  const basename = argv[0]?.split("/").pop() ?? "";
  const cores = SURFACE_CORES[surface];
  if (cores && !cores.includes(basename)) return true;
  const verb = argv[1] && !argv[1].startsWith("--") ? argv[1] : null;
  return verb !== null && (DIRECT_ONLY_VERBS[surface] ?? []).includes(verb);
}

/** The drive's argv with `{sandbox}` substituted and any relative
 * `--directory` value that did not name the sandbox resolved against the
 * plugin root (the direct runner's cwd) — so a plugin-shipped fixture
 * directory means the same thing through the supervisor as direct. */
export function resolveDriveArgv(drive: Drive, sandbox: string, pluginRoot: string): string[] {
  const raw = drive.argv;
  if (!raw || raw.length === 0) throw new Error("drive declares no argv");
  return raw.map((a, i) => {
    const value = a.replaceAll("{sandbox}", sandbox);
    if (i > 0 && raw[i - 1] === "--directory" && !a.includes("{sandbox}") && !isAbsolute(value)) {
      return join(pluginRoot, value);
    }
    return value;
  });
}

export function translateDrive(surface: string, drive: Drive, sandbox: string, pluginRoot: string): Record<string, unknown> {
  const argv = resolveDriveArgv(drive, sandbox, pluginRoot);
  const payload: Record<string, unknown> = {};
  let i = 1; // argv[0] names the deterministic core — the surface key already identifies the skill
  if (i < argv.length && !argv[i].startsWith("--")) {
    const verb = argv[i++];
    if (VERB_SURFACES.has(surface)) payload.verb = verb;
  }
  while (i < argv.length) {
    const token = argv[i++];
    if (!token.startsWith("--")) throw new Error(`${surface}: unexpected positional '${token}' in drive argv`);
    const key = token.slice(2).replaceAll("-", "_");
    let value: unknown = true; // value-less flag (--dry-run) → boolean true
    if (i < argv.length && !argv[i].startsWith("--")) {
      const raw = argv[i++];
      value = raw;
      if (raw.startsWith("{") || raw.startsWith("[")) {
        try { value = JSON.parse(raw); } catch { /* stays a string */ }
      }
    }
    payload[key] = value;
  }
  return payload;
}

/** True when `path` lies at or under `root`. */
function isWithin(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Stage a supervisor-routed drive's plugin-relative fixture: when the
 * payload's `directory` lies under the plugin root (and not the sandbox), copy
 * it to `<sandbox>/fixtures/<plugin-relative path>` and point the payload at
 * the copy — an auto-mode worker must never be aimed inside the installed
 * plugin. The copy is refreshed per call (a prior drive's worker may have
 * written to it) and its path is deterministic per sandbox, so identical
 * drives still share one payload key. A missing fixture throws — the caller
 * reports it as an untranslatable drive. */
export function stagePluginFixture(payload: Record<string, unknown>, pluginRoot: string, sandbox: string): Record<string, unknown> {
  const dir = payload.directory;
  if (typeof dir !== "string" || !isWithin(pluginRoot, dir) || isWithin(sandbox, dir)) return payload;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`fixture directory '${relative(pluginRoot, dir)}' does not exist in the plugin`);
  const staged = join(sandbox, "fixtures", relative(resolve(pluginRoot), resolve(dir)) || "plugin-root");
  rmSync(staged, { recursive: true, force: true });
  cpSync(dir, staged, { recursive: true });
  return { ...payload, directory: staged };
}

// ------------------------------------------------------------ drive-result evaluation

export type { InvokeOutcome };

const STATUS_ENUM = new Set(["complete", "partial", "blocked"]);

function blockProblem(block: unknown, surface: string): string | null {
  if (!block || typeof block !== "object") return "run produced no §3 status block";
  const b = block as Record<string, unknown>;
  if (typeof b.status !== "string" || !STATUS_ENUM.has(b.status)) return `status '${b.status}' outside the §3 enum`;
  if (b.intent !== surface) return `block intent '${b.intent}' does not name the surface '${surface}'`;
  if (!Array.isArray(b.artifacts)) return "block has no artifacts[] array";
  if (b.status !== "complete" && (typeof b.reason !== "string" || !b.reason.trim())) {
    return `status '${b.status}' without the §3-required reason`;
  }
  return null;
}

/** Judge one tk_invoke outcome against the drive's declared expectation.
 * expect "json"    → the surface actually ran and terminated with a valid block.
 * expect "ok"      → the drive's internal chain succeeded, not merely answered —
 *                    through the skill surface that is a `complete` §3 block
 *                    (the skill-mediated analog of the direct runner's ok=true).
 * expect "refusal" → a clean named refusal: a `blocked` block carrying the
 *                    declared marker, a driver-level named error (the direct
 *                    runner's nonzero-exit analog), or the driver's own §1
 *                    backend-auth preflight block (mandated to fire first). */
export function evaluate(surface: string, drive: Drive, out: InvokeOutcome): Check {
  const assertion = drive.assertion ?? "headless-drive";
  const expect = drive.expect ?? "json";
  const fail = (detail: string): Check => ({ assertion, ok: false, detail });
  const pass = (detail: string): Check => ({ assertion, ok: true, detail });

  if (out.toolError) {
    const err = out.toolError;
    if (/timed out/i.test(err)) return fail(`hang: ${err.slice(0, 300)}`);
    if (expect === "refusal") {
      return pass(drive.marker && !err.includes(drive.marker)
        ? `driver-level refusal (declared marker '${drive.marker}' not named): ${err.slice(0, 200)}`
        : `driver-level refusal: ${err.slice(0, 200)}`);
    }
    return fail(`driver error instead of a run: ${err.slice(0, 300)}`);
  }

  const r = out.result ?? {};
  if (typeof r.conformance_failure === "string") return fail(r.conformance_failure);
  const block = r.status_block as Record<string, unknown> | undefined;
  const problem = blockProblem(block, surface);
  if (problem) return fail(problem);
  const status = String(block!.status);
  const reason = String(block!.reason ?? "");

  if (r.ran === false) {
    // The driver's own §1 preflight refused before spawning. A backend-auth gap
    // is the contract-mandated refusal shape; a harness-auth gap means nothing
    // was actually driven — that is a harness failure whatever the expectation.
    if (/harness auth/i.test(reason)) return fail(`driver preflight blocked on harness auth — nothing was driven: ${reason}`);
    if (expect === "refusal") return pass(`driver §1 preflight refusal: ${reason.slice(0, 200)}`);
    return fail(`driver preflight refused a drive expected to run: ${reason.slice(0, 200)}`);
  }

  if (expect === "json") return pass(`terminal block, status '${status}'`);
  if (expect === "ok") {
    return status === "complete"
      ? pass("terminal block, status 'complete' — the chain succeeded")
      : fail(`expect ok: the chain must succeed, got status '${status}'${reason ? ` (${reason.slice(0, 200)})` : ""}`);
  }
  if (expect === "refusal") {
    if (status !== "blocked") return fail(`expected a blocked refusal, got status '${status}'`);
    if (drive.marker) {
      const haystack = JSON.stringify(block) + String(r.output_tail ?? "");
      if (!haystack.includes(drive.marker)) {
        return fail(`blocked, but declared marker '${drive.marker}' absent from reason/output`);
      }
    }
    return pass(`blocked: ${reason.slice(0, 200)}`);
  }
  return fail(`manifest declares unknown expect '${expect}'`);
}

// ------------------------------------------------------------ static checks (mirrors runner.py)

/** SKILL.md documents its terminal status block, and the first line starting
 * `{"status"` validates against status-block.schema.json with the right intent. */
export function checkStatusBlockDoc(surface: string, skillMd: string, schema: StatusSchema): Check {
  const fail = (detail: string): Check => ({ assertion: "status-block", ok: false, detail });
  const example = skillMd.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('{"status"'));
  if (example === undefined) return fail("SKILL.md documents no status-block example");
  let block: Record<string, unknown>;
  try { block = JSON.parse(example); }
  catch (e) { return fail(`status-block example is not valid JSON: ${e instanceof Error ? e.message : e}`); }
  if (!block || typeof block !== "object" || Array.isArray(block)) return fail("status-block example is not a JSON object");
  const problem = schemaKeyProblem(block, schema);
  if (problem) return fail(`example vs schema: ${problem}`);
  const statuses = schema.properties.status?.enum ?? [];
  if (!statuses.includes(block.status as string)) return fail(`status '${block.status}' outside the enum`);
  if (block.intent !== surface) return fail(`example intent '${block.intent}' does not name the surface '${surface}'`);
  return { assertion: "status-block", ok: true, detail: "" };
}

function schemaKeyProblem(block: Record<string, unknown>, schema: StatusSchema): string | null {
  const missing = schema.required.filter((k) => !(k in block));
  const extra = Object.keys(block).filter((k) => !(k in schema.properties));
  return missing.length || extra.length ? `missing [${missing.join(", ")}], extra [${extra.join(", ")}]` : null;
}

/** SKILL.md carries the canonical unrunnable-core paragraph (§8, AD-11). */
export function checkUnrunnableCoreDoc(skillMd: string): Check {
  return skillMd.includes("If the deterministic core is unrunnable")
    ? { assertion: "unrunnable-core", ok: true, detail: "" }
    : {
      assertion: "unrunnable-core", ok: false,
      detail: "SKILL.md does not document the unrunnable-core discipline (the canonical 'If the deterministic core is unrunnable' paragraph — end blocked with the status block naming the gap, AD-11)",
    };
}

/** The manifest declares an auth-preflight posture; a surface making
 * external calls may not declare "none". */
export function checkAuthPreflight(entry: SurfaceEntry): Check {
  const declared = (entry.auth_preflight ?? "").trim();
  if (!declared) return { assertion: "auth-preflight", ok: false, detail: "manifest entry declares no auth_preflight posture" };
  if (entry.external_calls && declared.toLowerCase().startsWith("none")) {
    return { assertion: "auth-preflight", ok: false, detail: "surface makes external calls but declares no auth preflight" };
  }
  return { assertion: "auth-preflight", ok: true, detail: "" };
}

// ------------------------------------------------------------ harness drives (§8 harness pass)

/** A harness drive without --harness: one ok check naming the skip. */
export function harnessSkip(drive: Drive): Check {
  return {
    assertion: drive.assertion ?? "harness-blocked", ok: true,
    detail: "skipped: harness pass not enabled (--harness) — spend-bearing drive",
  };
}

/** The report's `harness_pass.state` — the runner's wording. */
export function harnessState(declared: number, harness: boolean): string {
  if (declared === 0) return "none declared";
  return harness ? "ran" : "skipped: --harness not given (spend-bearing)";
}

/** Judge a harness drive's tk_invoke outcome per §8: a schema-valid terminal
 * block, `blocked`, intent naming the surface, a non-empty reason, the
 * declared marker inside it. A missing block (question / free text), a
 * `complete` block under denial, a hang, or a supervisor preflight refusal
 * (nothing was driven) each fail with the gap named. */
export function evaluateHarness(surface: string, drive: Drive, out: InvokeOutcome, schema: StatusSchema): Check {
  const assertion = drive.assertion ?? "harness-blocked";
  const fail = (detail: string): Check => ({ assertion, ok: false, detail: `harness (§8): ${detail}` });
  if (out.toolError) {
    const err = out.toolError;
    if (/timed out|no reply to/i.test(err)) return fail(`hang: ${err.slice(0, 300)}`);
    return fail(`supervisor refused the drive — nothing was driven: ${err.slice(0, 300)}`);
  }
  const r = out.result ?? {};
  const block = r.status_block as Record<string, unknown> | undefined;
  if (r.ran === false) {
    return fail(`supervisor preflight refused — nothing was driven: ${String(block?.reason ?? "").slice(0, 200)}`);
  }
  if (typeof r.conformance_failure === "string" || !block || typeof block !== "object") {
    return fail("transcript ends without a terminal status block — a question or free text is not a refusal (AD-11: the block names the gap)");
  }
  const problem = schemaKeyProblem(block, schema);
  if (problem) return fail(`terminal block vs schema: ${problem}`);
  if (block.status !== "blocked") return fail(`expected status 'blocked' under a denied core, got '${block.status}'`);
  if (block.intent !== surface) return fail(`block intent '${block.intent}' does not name the surface '${surface}'`);
  const reason = block.reason;
  if (typeof reason !== "string" || !reason.trim()) return fail("blocked block carries no reason naming the unrunnable core");
  if (/^harness auth/i.test(reason)) return fail(`worker hit the Max-login gate — nothing was driven: ${reason.slice(0, 200)}`);
  if (drive.marker && !reason.includes(drive.marker)) {
    return fail(`reason does not name the declared marker '${drive.marker}': got '${reason.slice(0, 120)}'`);
  }
  return { assertion, ok: true, detail: `harness (§8): blocked — ${reason.slice(0, 200)}` };
}

/** The tk_invoke arguments for a harness drive: the surface with an empty
 * payload (directory defaults to the sandbox), bounded by the drive's
 * `timeout` or HARNESS_TIMEOUT_S, the drive's deny-only `settings` profile
 * as an absolute `deny_profile` under the plugin's conformance directory. */
export function harnessInvokeArgs(surface: string, drive: Drive, sandbox: string, pluginRoot: string): Record<string, unknown> {
  const bound = typeof drive.timeout === "number" && drive.timeout > 0 ? drive.timeout : HARNESS_TIMEOUT_S;
  return {
    directory: sandbox, skill: surface, payload: {}, timeout_s: bound,
    ...(drive.settings ? { deny_profile: join(pluginRoot, "contracts", "conformance", drive.settings) } : {}),
  };
}

// ------------------------------------------------------------ report + comparison

export interface Report {
  driver?: string;
  conformance_version?: unknown;
  ok: boolean;
  surfaces_checked: number;
  checks_run: number;
  harness_pass: { declared: number; state: string };
  failures: { surface: string; assertion: string; detail: string }[];
  surfaces: Record<string, Check[]>;
  comparison?: Comparison;
}

export interface Comparison { ok: boolean; divergences: string[] }

export function buildReport(
  conformanceVersion: unknown, surfaces: Record<string, Check[]>, harnessPass: { declared: number; state: string },
): Report {
  const failures = Object.entries(surfaces)
    .flatMap(([surface, checks]) => checks.filter((c) => !c.ok).map((c) => ({ surface, assertion: c.assertion, detail: c.detail })));
  return {
    driver: DRIVER_NAME,
    conformance_version: conformanceVersion ?? 1,
    ok: failures.length === 0,
    surfaces_checked: Object.keys(surfaces).length,
    checks_run: Object.values(surfaces).reduce((n, c) => n + c.length, 0),
    harness_pass: harnessPass,
    failures,
    surfaces,
  };
}

/** Compare the supervisor-driven report with `runner.py run` direct: both
 * ok, the same surface set, and per surface the same check count and
 * assertion names in order. Every difference is a named divergence. */
export function compareReports(supervisor: Pick<Report, "ok" | "surfaces">, direct: Pick<Report, "ok" | "surfaces">): Comparison {
  const divergences: string[] = [];
  if (supervisor.ok !== true) divergences.push("supervisor-driven report is not ok");
  if (direct.ok !== true) divergences.push("direct runner report is not ok");
  const sup = supervisor.surfaces ?? {};
  const dir = direct.surfaces ?? {};
  for (const name of Object.keys(dir).sort()) {
    if (!(name in sup)) divergences.push(`${name}: checked direct, not through the supervisor`);
  }
  for (const name of Object.keys(sup).sort()) {
    if (!(name in dir)) { divergences.push(`${name}: checked through the supervisor, not direct`); continue; }
    const a = sup[name].map((c) => c.assertion);
    const b = dir[name].map((c) => c.assertion);
    if (a.length !== b.length) divergences.push(`${name}: ${a.length} checks through the supervisor vs ${b.length} direct`);
    else if (a.some((x, i) => x !== b[i])) divergences.push(`${name}: assertions differ — supervisor [${a.join(", ")}] vs direct [${b.join(", ")}]`);
  }
  return { ok: divergences.length === 0, divergences };
}

/** One process run for the direct runner: stdout and exit, or `timedOut`. */
export type RunnerExec = (cmd: string, args: string[], opts: { cwd: string; timeoutS: number }) =>
  Promise<{ stdout: string; exit: number; timedOut: boolean; error?: string }>;

const execRunner: RunnerExec = async (cmd, args, opts) => {
  try {
    const { stdout } = await execFileP(cmd, args, {
      cwd: opts.cwd, timeout: opts.timeoutS * 1000, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    return { stdout: String(stdout), exit: 0, timedOut: false };
  } catch (e) {
    const err = e as { stdout?: string; code?: number | string; killed?: boolean; signal?: string; message?: string };
    return {
      stdout: String(err.stdout ?? ""), exit: typeof err.code === "number" ? err.code : 2,
      timedOut: Boolean(err.killed || err.signal === "SIGTERM"), error: err.message,
    };
  }
};

/** `runner.py run --no-emit [--harness]` direct — the comparison baseline.
 * Answers the report on exit 0 or 1; throws (exit 2 upstream) on a timeout,
 * any other exit, or stdout carrying no report. */
export async function runDirectRunner(pluginRoot: string, harness: boolean, exec: RunnerExec = execRunner): Promise<Report> {
  const runner = join(pluginRoot, "contracts", "conformance", "runner.py");
  const args = ["run", runner, "run", "--no-emit", ...(harness ? ["--harness"] : [])];
  const res = await exec("uv", args, { cwd: pluginRoot, timeoutS: DIRECT_RUNNER_TIMEOUT_S });
  if (res.timedOut) throw new Error(`runner.py timed out after ${DIRECT_RUNNER_TIMEOUT_S}s`);
  if (res.exit !== 0 && res.exit !== 1) {
    throw new Error(`runner.py exited ${res.exit}: ${(res.stdout || res.error || "").slice(0, 400)}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(res.stdout); } catch { parsed = lastJsonObject(res.stdout); }
  const report = parsed as Report | null;
  if (!report || typeof report !== "object" || typeof report.surfaces !== "object" || report.surfaces === null) {
    throw new Error(`runner.py answered no report (exit ${res.exit}): ${res.stdout.slice(0, 400)}`);
  }
  return report;
}

// ------------------------------------------------------------ direct fixture drives (§1 pure-data allowance)

export interface DirectRun {
  stdout: string;
  exit: number;
  timedOut: boolean;
}

/** Judge a direct uv run against the manifest's own expect semantics (the
 * direct runner's rules): json → stdout carries a JSON object; ok → that
 * object carries ok=true; refusal → clean refusal (nonzero exit or ok=false)
 * with the declared marker named in stdout. */
export function evaluateDirect(drive: Drive, run: DirectRun): Check {
  const assertion = drive.assertion ?? "headless-drive";
  const expect = drive.expect ?? "json";
  const fail = (detail: string): Check => ({ assertion, ok: false, detail: `direct (§1 pure-data run): ${detail}` });
  const pass = (detail: string): Check => ({ assertion, ok: true, detail: `direct (§1 pure-data run): ${detail}` });
  if (run.timedOut) return fail("hang: run timed out");
  const parsed = lastJsonObject(run.stdout) as Record<string, unknown> | null;
  if (expect === "refusal") {
    const refused = run.exit !== 0 || (parsed !== null && parsed.ok === false);
    if (!refused) return fail(`expected a clean refusal, got exit ${run.exit}`);
    if (drive.marker && !run.stdout.includes(drive.marker)) {
      return fail(`refused, but declared marker '${drive.marker}' absent from stdout`);
    }
    return pass(`clean refusal (exit ${run.exit})`);
  }
  if (parsed === null) return fail(`no JSON object on stdout (exit ${run.exit})`);
  if (expect === "ok") {
    return parsed.ok === true
      ? pass("ok=true — the chain succeeded")
      : fail(`expect ok: parsed object carries ok=${JSON.stringify(parsed.ok)}`);
  }
  if (expect === "json") return pass(`JSON answered (exit ${run.exit})`);
  return fail(`manifest declares unknown expect '${expect}'`);
}

async function runDirect(pluginRoot: string, store: string, drive: Drive, sandbox: string, timeoutS: number): Promise<DirectRun> {
  const argv = resolveDriveArgv(drive, sandbox, pluginRoot);
  try {
    const { stdout } = await execFileP("uv", ["run", join(pluginRoot, argv[0]), ...argv.slice(1)], {
      cwd: pluginRoot, timeout: timeoutS * 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, TK_STUDIO_HOME: store },
    });
    return { stdout: String(stdout), exit: 0, timedOut: false };
  } catch (e) {
    const err = e as { stdout?: string; code?: number | string; killed?: boolean; signal?: string };
    return {
      stdout: String(err.stdout ?? ""),
      exit: typeof err.code === "number" ? err.code : 1,
      timedOut: Boolean(err.killed || err.signal === "SIGTERM"),
    };
  }
}

// ------------------------------------------------------------ suite

export interface Args {
  surfaces: string[];
  timeoutS: number;
  concurrency: number;
  json: boolean;
  keepSandbox: boolean;
  harness: boolean;
  compareDirect: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    surfaces: [], timeoutS: DEFAULT_TIMEOUT_S, concurrency: DEFAULT_CONCURRENCY, json: false, keepSandbox: false,
    harness: false, compareDirect: false,
  };
  const value = (i: number): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--surface": args.surfaces.push(value(i)); i++; break;
      case "--timeout-s": args.timeoutS = Number(value(i)); i++; break;
      case "--concurrency": args.concurrency = Math.max(1, Number(value(i))); i++; break;
      case "--json": args.json = true; break;
      case "--keep-sandbox": args.keepSandbox = true; break;
      case "--harness": args.harness = true; break;
      case "--compare-direct": args.compareDirect = true; break;
      default: throw new Error(`unknown argument '${argv[i]}'`);
    }
  }
  if (!Number.isFinite(args.timeoutS) || args.timeoutS <= 0) throw new Error("--timeout-s must be a positive number");
  if (!Number.isFinite(args.concurrency)) throw new Error("--concurrency must be a number");
  if (args.compareDirect && args.surfaces.length > 0) {
    throw new Error("--compare-direct compares the whole suite — it cannot be combined with --surface");
  }
  return args;
}

interface SuiteContext {
  client: ConnectorClient;
  pluginRoot: string;
  store: string;
  schema: StatusSchema;
  timeoutS: number;
  keepSandbox: boolean;
  harness: boolean;
}

async function driveSurface(ctx: SuiteContext, surface: string, entry: SurfaceEntry): Promise<Check[]> {
  const skillMd = readFileSync(join(ctx.pluginRoot, "skills", surface, "SKILL.md"), "utf-8");
  const checks: Check[] = [
    { assertion: "registered", ok: true, detail: "" },
    checkStatusBlockDoc(surface, skillMd, ctx.schema),
    checkUnrunnableCoreDoc(skillMd),
    checkAuthPreflight(entry),
  ];
  const sandbox = mkdtempSync(join(tmpdir(), `tk-conf-${surface}-`));
  try {
    const cache = new Map<string, InvokeOutcome>(); // identical payloads (e.g. detect's two drives) drive once
    for (const drive of entry.drives ?? []) {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);
      if (isHarnessDrive(drive)) {
        if (!ctx.harness) { checks.push(harnessSkip(drive)); continue; }
        // §8 harness pass through the supervisor's worker path: host mode
        // auto, no API key, the drive's deny-only profile as --settings.
        const invokeArgs = harnessInvokeArgs(surface, drive, sandbox, ctx.pluginRoot);
        const outcome = await ctx.client.callTool("tk_invoke", invokeArgs, ((invokeArgs.timeout_s as number) + 90) * 1000);
        checks.push({ ...evaluateHarness(surface, drive, outcome, ctx.schema), seconds: seconds() });
        continue;
      }
      if (isDirectDrive(surface, drive)) {
        // A fixture the §2 payload cannot express — run it direct (§1 pure-
        // data allowance) against the shared store so ordered drives chain.
        let run: DirectRun;
        try { run = await runDirect(ctx.pluginRoot, ctx.store, drive, sandbox, ctx.timeoutS); }
        catch (e) {
          checks.push({ assertion: drive.assertion ?? "headless-drive", ok: false, detail: `unrunnable drive: ${e instanceof Error ? e.message : e}` });
          continue;
        }
        checks.push({ ...evaluateDirect(drive, run), seconds: seconds() });
        continue;
      }
      let payload: Record<string, unknown>;
      try { payload = stagePluginFixture(translateDrive(surface, drive, sandbox, ctx.pluginRoot), ctx.pluginRoot, sandbox); }
      catch (e) {
        checks.push({ assertion: drive.assertion ?? "headless-drive", ok: false, detail: `untranslatable drive: ${e instanceof Error ? e.message : e}` });
        continue;
      }
      const key = JSON.stringify(payload);
      let outcome = cache.get(key);
      if (!outcome) {
        outcome = await ctx.client.callTool("tk_invoke", {
          directory: sandbox, skill: surface, payload, timeout_s: ctx.timeoutS,
        }, (ctx.timeoutS + 90) * 1000);
        cache.set(key, outcome);
      }
      checks.push({ ...evaluate(surface, drive, outcome), seconds: seconds() });
    }
  } finally {
    if (!ctx.keepSandbox) { try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  return checks;
}

async function main(): Promise<number> {
  let args: Args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(String(e instanceof Error ? e.message : e)); return 2; }

  let studioRoot: string;
  try { studioRoot = resolveStudioRoot(); }
  catch (e) { console.error(`cannot resolve the studio root: ${e instanceof Error ? e.message : e}`); return 2; }

  const pluginRoot = join(studioRoot, "plugins", "tk-studio");
  const manifestPath = join(pluginRoot, "contracts", "conformance", "manifest.json");
  let manifest: { surfaces: Record<string, SurfaceEntry>; conformance_version?: unknown };
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); }
  catch (e) { console.error(`conformance manifest unreadable at ${manifestPath}: ${e instanceof Error ? e.message : e}`); return 2; }
  if (!manifest.surfaces) { console.error(`${manifestPath} has no 'surfaces' map`); return 2; }
  const schemaPath = join(pluginRoot, "contracts", "status-block.schema.json");
  let schema: StatusSchema;
  try { schema = JSON.parse(readFileSync(schemaPath, "utf-8")); }
  catch (e) { console.error(`status-block schema unreadable at ${schemaPath}: ${e instanceof Error ? e.message : e}`); return 2; }

  // Shipped surfaces per §1: every plugins/tk-studio/skills/tk-studio-*/SKILL.md.
  const skillsDir = join(pluginRoot, "skills");
  const shipped = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "SKILL.md")))
    .map((d) => d.name).sort();

  const drivable = shipped
    .filter((name) => manifest.surfaces[name])
    .filter((name) => args.surfaces.length === 0 || args.surfaces.includes(name));
  for (const requested of args.surfaces) {
    if (!drivable.includes(requested)) { console.error(`--surface ${requested}: not a shipped+registered surface`); return 2; }
  }

  const driven: Record<string, Check[]> = {};
  const store = mkdtempSync(join(tmpdir(), "tk-conf-store-"));
  const client = new ConnectorClient({ TK_STUDIO_ROOT: studioRoot, TK_STUDIO_HOME: store });
  let exitCode = 1;
  try {
    await client.init("tk-conformance-harness");
    const contract = await client.callTool("tk_contract", {}, 60_000);
    if (contract.toolError || contract.result?.compatible !== true) {
      console.error(`contract gate failed: ${contract.toolError ?? JSON.stringify(contract.result)}`);
      return 2;
    }

    // The direct baseline after the contract gate, before the supervisor's
    // drives: neither side spends on a pass that cannot run (both exit 2).
    let direct: Report | null = null;
    if (args.compareDirect) {
      console.error("running runner.py run --no-emit direct ...");
      try { direct = await runDirectRunner(pluginRoot, args.harness); }
      catch (e) { console.error(`direct runner unrunnable: ${e instanceof Error ? e.message : e}`); return 2; }
    }

    const ctx: SuiteContext = { client, pluginRoot, store, schema, timeoutS: args.timeoutS, keepSandbox: args.keepSandbox, harness: args.harness };
    // Worker pool: surfaces run concurrently, a surface's drives run in order.
    const queue = [...drivable];
    const workers = Array.from({ length: Math.min(args.concurrency, queue.length) }, async () => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        console.error(`driving ${name} ...`);
        driven[name] = await driveSurface(ctx, name, manifest.surfaces[name]);
      }
    });
    await Promise.all(workers);

    // Report order mirrors the runner: shipped surfaces sorted, then stale entries.
    const surfaces: Record<string, Check[]> = {};
    for (const name of shipped) {
      if (!manifest.surfaces[name]) {
        surfaces[name] = [{ assertion: "registered", ok: false, detail: "shipped surface has no conformance manifest entry (ST-5.4: unregistered surfaces fail the suite)" }];
      } else if (driven[name]) {
        surfaces[name] = driven[name];
      }
    }
    for (const name of Object.keys(manifest.surfaces).sort()) {
      if (!shipped.includes(name)) {
        surfaces[name] = [{ assertion: "registered", ok: false, detail: "manifest entry has no shipped skill behind it (stale entry)" }];
      }
    }
    const declared = drivable.reduce((n, name) => n + (manifest.surfaces[name].drives ?? []).filter(isHarnessDrive).length, 0);
    const report = buildReport(manifest.conformance_version, surfaces, { declared, state: harnessState(declared, args.harness) });
    if (direct) report.comparison = compareReports(report, direct);
    const passed = report.ok && (report.comparison?.ok ?? true);

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const [surface, checks] of Object.entries(surfaces)) {
        console.log(surface);
        for (const c of checks) {
          const time = c.seconds !== undefined ? ` [${c.seconds}s]` : "";
          console.log(`  ${c.ok ? "pass" : "FAIL"}  ${c.assertion}${c.detail ? ` — ${c.detail}` : ""}${time}`);
        }
      }
      console.log(`\n${report.ok ? "PASS" : "FAIL"}: ${report.surfaces_checked} surfaces, ${report.checks_run} checks, ${report.failures.length} failure(s) — driver ${report.driver}; harness pass: ${report.harness_pass.state}`);
      for (const f of report.failures) console.log(`  FAIL ${f.surface} :: ${f.assertion} — ${f.detail}`);
      if (report.comparison) {
        console.log(`comparison with runner.py direct: ${report.comparison.ok ? "equal" : "DIVERGES"}`);
        for (const d of report.comparison.divergences) console.log(`  DIVERGENCE ${d}`);
      }
    }
    exitCode = passed ? 0 : 1;
  } finally {
    client.close();
    if (!args.keepSandbox) { try { rmSync(store, { recursive: true, force: true }); } catch { /* best effort */ } }
    else console.error(`sandbox store kept at ${store}`);
  }
  return exitCode;
}

if (import.meta.main) {
  main().then((code) => setTimeout(() => process.exit(code), 100));
}
