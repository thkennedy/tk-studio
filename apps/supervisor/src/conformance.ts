#!/usr/bin/env bun
/**
 * tk-studio conformance suite THROUGH the connector (driver contract §8). "A connector implementing this contract SHOULD run the
 * same suite through itself — passing it is the definition of a conforming
 * driver."
 *
 * The shipped suite (`plugins/tk-studio/contracts/conformance/`) drives each
 * surface's deterministic core by direct invocation. This harness drives the
 * SAME manifest drives through the real connector: a live `server.ts` stdio
 * instance, one `tk_invoke` per drive. Translation is contract-sanctioned
 * — §2: "payload fields map 1:1 onto the named CLI's flags" — so a drive's
 * argv becomes the skill payload mechanically (flags → snake_case fields,
 * value-less flags → true, a leading positional verb kept only where §2
 * declares a `verb` payload field).
 *
 * Assertions per drive (§8): the run terminates with a valid §3 status block
 * (never a hang, never a prompt), `expect: "refusal"` ends `blocked` with the
 * declared marker named, `expect: "ok"` demands the chain succeeded (a
 * `complete` block — the skill-mediated analog of the direct runner's
 * ok=true), and the driver's own §1 auth preflight fires before any
 * backend-touching run. Drives the §2 payload cannot express — fixture CLIs
 * outside the surface's deterministic core (session's run-init, the job e2e
 * chain, the capture refusal) and run-workspace-mediated verbs (research's
 * seed|spine) — run direct via uv instead: the §1 pure-data allowance,
 * evaluated by the manifest's own expect semantics. Sandbox isolation
 * matches the direct runner: per-surface throwaway project dirs and one
 * throwaway TK_STUDIO_HOME store shared by connector children AND direct
 * runs (so ordered fixtures chain), nothing touching the real per-user
 * store.
 *
 * Static suite checks (status-block doc example, auth-preflight posture
 * wording) involve no driver and stay with the direct runner. Failure
 * emission stays studio-side too: the taxonomy names the direct runner as the
 * sole `headless-failure` emitter — this harness reports, it does not emit.
 *
 * CLI:
 *   bun run conformance.ts [--surface NAME]... [--timeout-s N] [--concurrency N]
 *                          [--json] [--keep-sandbox]
 *
 * Exit codes: 0 all checks pass; 1 failures; 2 the harness cannot run.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ConnectorClient, type InvokeOutcome } from "./client";
import { lastJsonObject, resolveStudioRoot } from "./server";

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_S = 600; // a skill-surface drive is a full claude -p run; research-class surfaces do real bounded work
const DEFAULT_CONCURRENCY = 3;

// ------------------------------------------------------------ manifest shapes

export interface Drive {
  assertion?: string;
  argv: string[];
  expect?: string;
  marker?: string;
}

interface SurfaceEntry {
  external_calls?: boolean;
  auth_preflight?: string;
  drives?: Drive[];
}

interface Check {
  assertion: string;
  ok: boolean;
  detail: string;
  seconds?: number;
}

// ------------------------------------------------------------ drive → payload translation

/** Surfaces whose §2 payload row declares a `verb` field — everywhere else the
 * CLI's positional verb is the core's dispatch detail, not a payload field.
 * (session and knowledge joined at contract 0.1.7 — Epic 9.) */
const VERB_SURFACES = new Set(["tk-studio-job", "tk-studio-migrate", "tk-studio-session", "tk-studio-knowledge"]);

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
};

/** Core verbs the §2 payload row does NOT declare — run-workspace-mediated
 * verbs an agent invokes mid-run (research's seed|spine land artifacts into a
 * live run), not driver-payload surface. */
const DIRECT_ONLY_VERBS: Record<string, string[]> = {
  "tk-studio-research": ["seed", "spine"],
};

/** True when a drive cannot be expressed as the surface's §2 payload and must
 * run direct via uv instead — the §1 allowance ("a driver MAY call those CLIs
 * directly for pure-data steps"). Direct drives share the suite's store, so
 * ordered fixtures (run-init before the session boundary drives) still chain. */
export function isDirectDrive(surface: string, drive: Drive): boolean {
  const basename = drive.argv[0]?.split("/").pop() ?? "";
  const cores = SURFACE_CORES[surface];
  if (cores && !cores.includes(basename)) return true;
  const verb = drive.argv[1] && !drive.argv[1].startsWith("--") ? drive.argv[1] : null;
  return verb !== null && (DIRECT_ONLY_VERBS[surface] ?? []).includes(verb);
}

export function translateDrive(surface: string, drive: Drive, sandbox: string): Record<string, unknown> {
  const argv = drive.argv.map((a) => a.replaceAll("{sandbox}", sandbox));
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
  const argv = drive.argv.map((a) => a.replaceAll("{sandbox}", sandbox));
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

interface Args {
  surfaces: string[];
  timeoutS: number;
  concurrency: number;
  json: boolean;
  keepSandbox: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { surfaces: [], timeoutS: DEFAULT_TIMEOUT_S, concurrency: DEFAULT_CONCURRENCY, json: false, keepSandbox: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--surface": args.surfaces.push(argv[++i]); break;
      case "--timeout-s": args.timeoutS = Number(argv[++i]); break;
      case "--concurrency": args.concurrency = Math.max(1, Number(argv[++i])); break;
      case "--json": args.json = true; break;
      case "--keep-sandbox": args.keepSandbox = true; break;
      default: throw new Error(`unknown argument '${argv[i]}'`);
    }
  }
  if (!Number.isFinite(args.timeoutS) || args.timeoutS <= 0) throw new Error("--timeout-s must be a positive number");
  return args;
}

async function driveSurface(
  client: ConnectorClient, surface: string, entry: SurfaceEntry, timeoutS: number, keepSandbox: boolean,
  pluginRoot: string, store: string,
): Promise<Check[]> {
  const checks: Check[] = [{ assertion: "registered", ok: true, detail: "" }];
  const sandbox = mkdtempSync(join(tmpdir(), `tk-conf-${surface}-`));
  try {
    const cache = new Map<string, InvokeOutcome>(); // identical payloads (e.g. detect's two drives) drive once
    for (const drive of entry.drives ?? []) {
      const started = Date.now();
      if (isDirectDrive(surface, drive)) {
        // A fixture the §2 payload cannot express — run it direct (§1 pure-
        // data allowance) against the shared store so ordered drives chain.
        const run = await runDirect(pluginRoot, store, drive, sandbox, timeoutS);
        checks.push({ ...evaluateDirect(drive, run), seconds: Math.round((Date.now() - started) / 1000) });
        continue;
      }
      let payload: Record<string, unknown>;
      try { payload = translateDrive(surface, drive, sandbox); }
      catch (e) {
        checks.push({ assertion: drive.assertion ?? "headless-drive", ok: false, detail: `untranslatable drive: ${e instanceof Error ? e.message : e}` });
        continue;
      }
      const key = JSON.stringify(payload);
      let outcome = cache.get(key);
      if (!outcome) {
        outcome = await client.callTool("tk_invoke", {
          directory: sandbox, skill: surface, payload, timeout_s: timeoutS,
        }, (timeoutS + 90) * 1000);
        cache.set(key, outcome);
      }
      checks.push({ ...evaluate(surface, drive, outcome), seconds: Math.round((Date.now() - started) / 1000) });
    }
  } finally {
    if (!keepSandbox) { try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ } }
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
  let manifest: { surfaces: Record<string, SurfaceEntry> };
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); }
  catch (e) { console.error(`conformance manifest unreadable at ${manifestPath}: ${e instanceof Error ? e.message : e}`); return 2; }
  if (!manifest.surfaces) { console.error(`${manifestPath} has no 'surfaces' map`); return 2; }

  // Shipped surfaces per §1: every plugins/tk-studio/skills/tk-studio-*/SKILL.md.
  const skillsDir = join(pluginRoot, "skills");
  const shipped = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "SKILL.md")))
    .map((d) => d.name).sort();

  const surfaces: Record<string, Check[]> = {};
  for (const name of shipped) {
    if (!manifest.surfaces[name]) {
      surfaces[name] = [{ assertion: "registered", ok: false, detail: "shipped surface has no conformance manifest entry (ST-5.4: unregistered surfaces fail the suite)" }];
    }
  }
  for (const name of Object.keys(manifest.surfaces)) {
    if (!shipped.includes(name)) {
      surfaces[name] = [{ assertion: "registered", ok: false, detail: "manifest entry has no shipped skill behind it (stale entry)" }];
    }
  }

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

    const drivable = shipped
      .filter((name) => manifest.surfaces[name])
      .filter((name) => args.surfaces.length === 0 || args.surfaces.includes(name));
    if (args.surfaces.length > 0) {
      for (const requested of args.surfaces) {
        if (!drivable.includes(requested)) { console.error(`--surface ${requested}: not a shipped+registered surface`); return 2; }
      }
    }

    // Worker pool: surfaces run concurrently, a surface's drives run in order.
    const queue = [...drivable];
    const workers = Array.from({ length: Math.min(args.concurrency, queue.length) }, async () => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        console.error(`driving ${name} ...`);
        surfaces[name] = await driveSurface(client, name, manifest.surfaces[name], args.timeoutS, args.keepSandbox, pluginRoot, store);
      }
    });
    await Promise.all(workers);

    const failures = Object.entries(surfaces)
      .flatMap(([surface, checks]) => checks.filter((c) => !c.ok).map((c) => ({ surface, assertion: c.assertion, detail: c.detail })));
    const report = {
      driver: "tk-studio-supervisor",
      conformance_version: (manifest as Record<string, unknown>).conformance_version ?? 1,
      ok: failures.length === 0,
      surfaces_checked: Object.keys(surfaces).length,
      checks_run: Object.values(surfaces).reduce((n, c) => n + c.length, 0),
      failures,
      surfaces,
    };

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const [surface, checks] of Object.entries(surfaces).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(surface);
        for (const c of checks) {
          const time = c.seconds !== undefined ? ` [${c.seconds}s]` : "";
          console.log(`  ${c.ok ? "pass" : "FAIL"}  ${c.assertion}${c.detail ? ` — ${c.detail}` : ""}${time}`);
        }
      }
      console.log(`\n${report.ok ? "PASS" : "FAIL"}: ${report.surfaces_checked} surfaces, ${report.checks_run} checks, ${failures.length} failure(s)`);
      for (const f of failures) console.log(`  FAIL ${f.surface} :: ${f.assertion} — ${f.detail}`);
    }
    exitCode = report.ok ? 0 : 1;
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
