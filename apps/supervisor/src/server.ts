#!/usr/bin/env bun
/**
 * tk-studio supervisor core — drives tk-studio through its published driver
 * contract (consumed at 0.1.18, pinned to the pre-1.0 `0.1` line — the
 * contract renumbered 1.N.0 → 0.1.N on 2026-08-07).
 *
 * AD-2 boundary: this file consumes ONLY the published contract surface —
 * per-skill headless invocation, the §4 job verbs, the §6 drift check, the
 * registry read path (`registry.py show`), and the project-config keys the
 * contract itself names (§1 preflight, §2 plan-sync row). It never reads
 * studio internals.
 *
 * Library: the pure builders (worker command line, worker env, status-block
 * extraction, Max-login preflight) and `invokeSkill` are exported for the CLI.
 * Protocol (when run directly): tools-only JSON-RPC 2.0 over stdio, one
 * message per line — the in-repo client (client.ts) drives it.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { load as loadYaml } from "js-yaml";
import { claudeBin, pluginRoot as envPluginRoot, studioRoot as envStudioRoot } from "./env";

const CONSUMED_CONTRACT = "0.1.18";
/** Pre-1.0 contract semver: the compatibility line is major.minor (`0.1`) —
 * breaking studio changes bump it (0.2.0), additive ones ride the patch. */
const PINNED_LINE = "0.1";
const SERVER_INFO = { name: "tk-studio-supervisor", version: "0.1.0" };
const PROTOCOL_VERSION = "2024-11-05";

const DRIVER_JOB_VERBS = ["submit", "status", "resolve", "cancel", "wake"] as const;
/** §2 also names the executing wrapper's verbs ("plus account/finish for the
 * executing wrapper"). A driver that executes a wake directive (invoke-skill)
 * becomes that run's executing wrapper — `finish` terminal-izes the run it
 * drove. `account` stays unexposed and the `max_turns` guard unenforced here:
 * both belong to Story 21.5 (guards) and are not wired in this story;
 * wall-clock is enforced by the driver's own run timeout. */
const WRAPPER_JOB_VERBS = ["finish"] as const;
const RUN_TERMINAL_STATES = ["complete", "partial", "blocked", "cancelled"] as const;
const JIRA_TOUCHING_SKILLS = new Set(["tk-studio-plan-sync", "tk-studio-migrate"]);
/** The failed-run login signals: real auth-failure signals only — a bare 401,
 * an authenticate/authentication failure, "not logged in", the CLI's "/login"
 * hint, an expired login/session/token, an invalid API key. Words that merely
 * contain "auth"/"login" ("author", "OAuth scope", "authorize") do not count.
 * Applied (like AUTH_FAIL_RE) to a failed run's result text and stderr only. */
const IS_ERROR_AUTH_RE = /\b401\b|authenticat(?:e|ion)|not logged in|\/login\b|(?:oauth|login|session|token)[^\n]{0,20}expired|invalid[_\s-]?(?:api[_\s-]?key|x-api-key)/i;
/** Auth-failure shapes worth blocking on (§1: a 401 fails the run `blocked`, never silently).
 * Bare "401" needs http-ish context so line numbers/ids in ordinary output don't false-block. */
const AUTH_FAIL_RE = /unauthorized|authentication[_\s-]?error|invalid[_\s-]?(?:api[_\s-]?key|x-api-key)|(?:http|status|error)[^\n]{0,20}\b401\b/i;

// ------------------------------------------------------------ registry (contract read path)

interface RegistryProject {
  root: string;
  vcs?: string;
  planning_backend?: string;
  vault_link?: string;
  [k: string]: unknown;
}

/** The registry through its published read path — `registry.py show
 * [--project-id]` — never the registry file itself. `ok: false` (unknown id,
 * unreadable registry) is thrown as the studio's own named error. */
export async function registryShow(projectId?: string): Promise<Record<string, any>> {
  const script = join(pluginRoot(), "lib", "registry.py");
  const res = await runUv(process.cwd(), script, ["show", ...(projectId ? ["--project-id", projectId] : [])]);
  const parsed = lastJsonObject(res.stdout) as Record<string, any> | null;
  if (parsed === null) throw new Error(`registry show emitted no JSON (exit ${res.exit}): ${res.stderr.slice(0, 400)}`);
  if (parsed.ok !== true) throw new Error(`registry: ${parsed.error ?? "show refused"}`);
  return parsed;
}

function entryRoot(id: string, entry: RegistryProject): string {
  if (typeof entry.root !== "string" || !entry.root.trim()) {
    throw new Error(`registry entry '${id}' has no usable root (registry.schema.json requires a non-empty string)`);
  }
  return entry.root;
}

/** Resolve the target project root: explicit directory > project_id > sole registry entry. */
async function resolveRoot(args: { directory?: unknown; project_id?: unknown }): Promise<{ root: string; project_id?: string }> {
  if (args.directory !== undefined) {
    if (typeof args.directory !== "string" || !args.directory.trim()) throw new Error("`directory` must be a non-empty path");
    if (!existsSync(args.directory)) throw new Error(`directory does not exist: ${args.directory}`);
    return { root: args.directory, project_id: typeof args.project_id === "string" ? args.project_id : undefined };
  }
  if (args.project_id !== undefined) {
    const pid = String(args.project_id);
    return { root: entryRoot(pid, (await registryShow(pid)).entry), project_id: pid };
  }
  const projects = ((await registryShow()).projects ?? {}) as Record<string, RegistryProject>;
  const ids = Object.keys(projects);
  if (ids.length === 1) return { root: entryRoot(ids[0], projects[ids[0]]), project_id: ids[0] };
  throw new Error(`registry has ${ids.length} projects — pass project_id (${ids.join(", ")})`);
}

// ------------------------------------------------------------ studio root & contract pin

const CONTRACT_REL = join("plugins", "tk-studio", "contracts", "driver-contract.md");

function publishesContract(root: string): boolean {
  return existsSync(join(root, CONTRACT_REL));
}

let studioRootCache: string | null = null;

/** The studio repo root (where the published contract + plugin live) is NOT the
 * target project root: registry entries are arbitrary onboarded projects.
 * Resolution: TK_STUDIO_ROOT only (AD-15) — unset is the named StudioRootMissing.
 * Exported for the through-connector conformance harness (conformance.ts). */
export function resolveStudioRoot(): string {
  if (studioRootCache) return studioRootCache;
  const env = envStudioRoot();
  if (!publishesContract(env)) throw new Error(`TK_STUDIO_ROOT=${env} does not publish ${CONTRACT_REL}`);
  return (studioRootCache = env);
}

/** The plugin root through env.ts's one resolver (AD-15), after the studio
 * root is verified to publish the contract. */
function pluginRoot(): string {
  resolveStudioRoot();
  return envPluginRoot();
}

let contractCheck: { studio_root: string; studio_version: string; compatible: boolean; detail: string } | null = null;

function checkContract(): { studio_root: string; studio_version: string; compatible: boolean; detail: string } {
  const studioRoot = resolveStudioRoot();
  if (contractCheck && contractCheck.studio_root === studioRoot) return contractCheck;
  const path = join(studioRoot, CONTRACT_REL);
  let version = "unknown";
  if (existsSync(path)) {
    const match = readFileSync(path, "utf-8").match(/Contract version\*{0,2}\s*\|\s*\*{0,2}(\d+)\.(\d+)\.(\d+)/);
    if (match) version = `${match[1]}.${match[2]}.${match[3]}`;
  }
  const line = version.split(".").slice(0, 2).join(".");
  const compatible = line === PINNED_LINE;
  contractCheck = {
    studio_root: studioRoot,
    studio_version: version,
    compatible,
    detail: compatible
      ? `studio publishes ${version}; connector consumes ${CONSUMED_CONTRACT} (pinned to the ${PINNED_LINE} line)`
      : `studio publishes '${version}' — connector is pinned to the ${PINNED_LINE} line and refuses to drive it`,
  };
  return contractCheck;
}

export function requireCompatible(): void {
  const check = checkContract();
  if (!check.compatible) throw new Error(`contract pin violation: ${check.detail}`);
}

// ------------------------------------------------------------ spawn helpers (async — the
// protocol loop must stay responsive during long runs, and a timeout must kill the whole
// process tree, not just the direct child/shell)

export interface RunResult {
  exit: number | null;
  stdout: string;
  stderr: string;
}

function killTree(pid: number | undefined, child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32" && pid) {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true });
  } else {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

function runProcess(
  cmd: string, args: string[],
  opts: { cwd?: string; input?: string; timeoutS: number; shell?: boolean; env?: Record<string, string | undefined> },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd, windowsHide: true, shell: opts.shell ?? false,
      env: (opts.env as NodeJS.ProcessEnv) ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child.pid, child);
      reject(new Error(`${cmd} timed out after ${opts.timeoutS}s (process tree killed); stdout tail: ${stdout.slice(-400)}`));
    }, opts.timeoutS * 1000);
    child.stdout!.setEncoding("utf-8");
    child.stderr!.setEncoding("utf-8");
    child.stdout!.on("data", (c: string) => { stdout += c; });
    child.stderr!.on("data", (c: string) => { stderr += c; });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exit: code, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin!.end(opts.input);
    else child.stdin!.end();
  });
}

async function runUv(projectRoot: string, script: string, args: string[], timeoutS = 120): Promise<RunResult> {
  try {
    return await runProcess("uv", ["run", script, ...args], {
      cwd: projectRoot, timeoutS,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
  } catch (e) {
    throw e instanceof Error && !/timed out/.test(e.message) ? new Error(`uv spawn failed: ${e.message}`) : e;
  }
}

/** One §4 jobrun verb through `uv run <plugin>/lib/jobrun.py <verb> --directory …`. */
export async function runJobVerb(root: string, cliArgs: string[], timeoutS = 120): Promise<Record<string, any>> {
  const res = await runUv(root, join(pluginRoot(), "lib", "jobrun.py"), cliArgs, timeoutS);
  const parsed = lastJsonObject(res.stdout);
  if (parsed === null) throw new Error(`jobrun emitted no JSON (exit ${res.exit}): ${res.stderr.slice(0, 400)}`);
  return parsed as Record<string, any>;
}

const PERMISSION_MODES = ["auto", "acceptEdits", "default", "plan", "bypassPermissions"] as const;
/** Host default (AD-2 ruling): `auto` — the operator's settings.json
 * `permissions.deny` applies untouched; no flag here ever overrides it. */
export const HOST_PERMISSION_MODE = "auto";

/** A bypass request on the host — refused before any process starts. */
export class HostBypassRefused extends Error {
  constructor(mode: string) {
    super(`HostBypassRefused: permission mode '${mode}' is forbidden on the host — the worker runs under '${HOST_PERMISSION_MODE}' with settings.json permissions.deny intact`);
    this.name = "HostBypassRefused";
  }
}

export interface WorkerCommand { bin: string; argv: string[] }

/** The `claude -p` command line: `--output-format json` always (the status
 * block rides `result`, the cost rides `total_cost_usd`); model/effort
 * forwarded verbatim when present (§5 — never escalated). */
export function buildWorkerCommand(opts: {
  prompt: string; permissionMode?: string; model?: string; effort?: string; bin?: string;
}): WorkerCommand {
  const mode = opts.permissionMode ?? HOST_PERMISSION_MODE;
  if (mode === "bypassPermissions") throw new HostBypassRefused(mode);
  if (!(PERMISSION_MODES as readonly string[]).includes(mode)) {
    throw new Error(`permission_mode must be one of ${PERMISSION_MODES.filter((m) => m !== "bypassPermissions").join("|")}`);
  }
  const argv = ["-p", opts.prompt, "--output-format", "json", "--permission-mode", mode];
  if (opts.model) argv.push("--model", opts.model);
  if (opts.effort) argv.push("--effort", opts.effort);
  return { bin: opts.bin ?? claudeBin(), argv };
}

/** The worker's env: the parent's, minus ANTHROPIC_API_KEY (ruling 3 — the
 * Max login pays). TK_STUDIO_HOME and the rest pass through untouched. */
export function buildWorkerEnv(parent: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export type Spawner = (cmd: string, args: string[], opts: { cwd?: string; timeoutS: number; env?: Record<string, string | undefined> }) => Promise<RunResult>;

async function runClaude(cmd: WorkerCommand, cwd: string, timeoutS: number, spawner: Spawner): Promise<RunResult> {
  try {
    return await spawner(cmd.bin, cmd.argv, { cwd, timeoutS, env: buildWorkerEnv() });
  } catch (e) {
    throw e instanceof Error && !/timed out/.test(e.message) ? new Error(`claude spawn failed: ${e.message}`) : e;
  }
}

// ------------------------------------------------------------ status block (§3)

// ------------------------------------------------------------ KB injection (§4 directive, contract 0.1.7)

/** "~/x" → homedir()/x — the §1 sanitization posture emits per-user-store
 * paths home-relativized; the driver expands them back. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

export interface KnowledgeInjection {
  preamble: string;
  injected: string[];
  skipped: { artifact: string; reason: string }[];
}

/** Per-artifact injection cap: spines/seeds are compact by design (the studio
 * budgets them); a runaway file must not blow the segment prompt. */
const MAX_KNOWLEDGE_ARTIFACT_CHARS = 131_072;

/** Build the provisional-knowledge preamble from a §4 KB-injection directive
 * ({spine|seed: {path, present}}). The injection ACT is this driver's (AD-2:
 * the studio names paths, never renders our prompts). Aid, not gate: absent,
 * pathless, unreadable, or oversize artifacts are skipped and reported —
 * never a reason to fail or delay the run. */
export function buildKnowledgeInjection(
  knowledge: unknown,
  readArtifact: (path: string) => string = (p) => readFileSync(expandHome(p), "utf-8"),
): KnowledgeInjection {
  const result: KnowledgeInjection = { preamble: "", injected: [], skipped: [] };
  if (!knowledge || typeof knowledge !== "object" || Array.isArray(knowledge)) return result;
  const sections: string[] = [];
  for (const name of ["spine", "seed"] as const) {
    const entry = (knowledge as Record<string, any>)[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (entry.present !== true) { result.skipped.push({ artifact: name, reason: "absent" }); continue; }
    if (typeof entry.path !== "string" || !entry.path) { result.skipped.push({ artifact: name, reason: "no path" }); continue; }
    let text: string;
    try { text = readArtifact(entry.path); }
    catch (e) { result.skipped.push({ artifact: name, reason: `unreadable: ${e instanceof Error ? e.message : e}` }); continue; }
    if (text.length > MAX_KNOWLEDGE_ARTIFACT_CHARS) {
      result.skipped.push({ artifact: name, reason: `over the ${MAX_KNOWLEDGE_ARTIFACT_CHARS}-char injection cap` });
      continue;
    }
    sections.push(`--- provisional ${name} (${entry.path}) ---\n${text.trimEnd()}`);
    result.injected.push(name);
  }
  if (sections.length) {
    result.preamble =
      "PROVISIONAL KNOWLEDGE (driver contract §4 KB-injection directive): the artifacts below are " +
      "mission-scoped and supersede canonical knowledge for this run. Treat their anchored claims as " +
      "current; corrections belong in handoff deltas citing the anchor ids, never edits to these artifacts.\n\n" +
      sections.join("\n\n") + "\n\n";
  }
  return result;
}

/** Last balanced top-level JSON object on stdout — string-aware forward scan.
 * An unbalanced `{` in chatter opens a candidate that never closes; when that
 * happens the scan restarts just past that `{` so a real trailing block still wins. */
export function lastJsonObject(text: string): unknown | null {
  let from = 0;
  while (from < text.length) {
    let last: unknown | null = null;
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"' && depth > 0) { inStr = true; continue; }
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}" && depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          try { last = JSON.parse(text.slice(start, i + 1)); } catch { /* not JSON — skip */ }
          start = -1;
        }
      }
    }
    if (last !== null) return last;
    if (depth > 0 && start >= 0) { from = start + 1; continue; } // unclosed candidate swallowed the tail — rescan past it
    return null;
  }
  return null;
}

function isStatusBlock(value: unknown): value is { status: string; intent: string } {
  return !!value && typeof value === "object"
    && typeof (value as Record<string, unknown>).status === "string"
    && typeof (value as Record<string, unknown>).intent === "string";
}

/** Every balanced top-level JSON object in `text`, in order (string-aware;
 * an unclosed `{` restarts the scan just past it, keeping earlier finds). */
export function balancedJsonObjects(text: string): unknown[] {
  const found: unknown[] = [];
  let from = 0;
  while (from < text.length) {
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = from; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"' && depth > 0) { inStr = true; continue; }
      if (ch === "{") { if (depth === 0) start = i; depth++; }
      else if (ch === "}" && depth > 0 && --depth === 0 && start >= 0) {
        // Not JSON (a stray brace/quote in chatter threw off the match) →
        // rescan just past its opening brace.
        try { found.push(JSON.parse(text.slice(start, i + 1))); } catch { i = start; }
        start = -1;
      }
    }
    if (depth > 0 && start >= 0) { from = start + 1; continue; }
    break;
  }
  return found;
}

/** §3: the LAST balanced JSON object whose `status` and `intent` are strings. */
export function extractStatusBlock(text: string): { status: string; intent: string; [k: string]: unknown } | null {
  const blocks = balancedJsonObjects(text).filter(isStatusBlock);
  return (blocks.at(-1) as { status: string; intent: string }) ?? null;
}

/** AD-11: a headless run without a status block is a named conformance failure. */
export const MISSING_STATUS_BLOCK = "conformance failure (AD-11): run terminated without a JSON status block (§3)";
export const MAX_LOGIN_MISSING = "harness auth: Max login missing or expired";

/** The worker's `--output-format json` result: the text the status block
 * rides in, the error flag, and the cost when reported. */
export function parseWorkerResult(stdout: string): { text: string; isError: boolean; totalCostUsd?: number } {
  let parsed: any = null;
  try { parsed = JSON.parse(stdout.trim()); } catch { parsed = lastJsonObject(stdout); }
  const cost = parsed && typeof parsed === "object" && typeof parsed.total_cost_usd === "number"
    && Number.isFinite(parsed.total_cost_usd) ? parsed.total_cost_usd as number : undefined;
  const withCost = cost !== undefined ? { totalCostUsd: cost } : {};
  if (!parsed || typeof parsed !== "object" || typeof parsed.result !== "string") {
    return { text: stdout, isError: parsed?.is_error === true, ...withCost };
  }
  return { text: parsed.result, isError: parsed.is_error === true, ...withCost };
}

/** The status-block.schema.json `status` enum. */
const BLOCK_STATUSES = ["complete", "partial", "blocked"] as const;

/** Block status → finish state: the schema's complete|partial|blocked pass
 * through; anything else (`cancelled` included) is `partial` (the block is
 * still recorded). */
export function finishStateFor(status: string): "complete" | "partial" | "blocked" {
  return (BLOCK_STATUSES as readonly string[]).includes(status) ? (status as "complete") : "partial";
}

// ------------------------------------------------------------ auth preflight (§1)

export function readProjectConfig(projectRoot: string): { config: Record<string, unknown>; unreadable?: string } {
  const path = join(projectRoot, ".tk-studio", "config.yaml");
  if (!existsSync(path)) return { config: {} };
  try { return { config: (loadYaml(readFileSync(path, "utf-8")) as Record<string, unknown>) ?? {} }; }
  catch (e) { return { config: {}, unreadable: `${path}: ${e instanceof Error ? e.message : e}` }; }
}

/** Judge `claude auth status --json` (a non-billing probe): only the claude.ai
 * subscription login passes (ruling 3). Returns the gap, or null. Neither an
 * API key nor a working `--version` is ever proof. */
export function judgeAuthStatus(exit: number | null, stdout: string): string | null {
  if (exit !== 0) return `${MAX_LOGIN_MISSING} (\`claude auth status\` exited ${exit})`;
  let s: any;
  try { s = JSON.parse(stdout.trim()); } catch { return `${MAX_LOGIN_MISSING} (\`claude auth status --json\` unparseable)`; }
  if (!s || s.loggedIn !== true) return `${MAX_LOGIN_MISSING} (not logged in)`;
  if (s.authMethod !== "claude.ai") return `${MAX_LOGIN_MISSING} (auth method '${s.authMethod}' is not the claude.ai subscription login)`;
  return null;
}

/** The Max-login preflight: probe `$CLAUDE_BIN auth status --json` with the
 * worker's env (no API key) and judge it. */
export async function maxLoginPreflight(spawner: Spawner = runProcess): Promise<string | null> {
  try {
    const res = await spawner(claudeBin(), ["auth", "status", "--json"], { timeoutS: 30, env: buildWorkerEnv() });
    return judgeAuthStatus(res.exit, res.stdout);
  } catch (e) {
    return `${MAX_LOGIN_MISSING} (probe failed: ${e instanceof Error ? e.message : e})`;
  }
}

/** §1 preflight. The only config keys read are the ones the contract itself names
 * (planning.backend, planning.jira.site, planning.jira.email — §1/§2 plan-sync row). */
async function authPreflight(skill: string, payload: Record<string, unknown>, projectRoot: string, spawner: Spawner = runProcess): Promise<string[]> {
  const gaps: string[] = [];
  const login = await maxLoginPreflight(spawner);
  if (login) gaps.push(login);
  if (!JIRA_TOUCHING_SKILLS.has(skill)) return gaps;

  const { config, unreadable } = readProjectConfig(projectRoot);
  if (unreadable) gaps.push(`backend auth: project config unreadable — cannot determine planning backend (${unreadable})`);
  const planning = (config.planning ?? {}) as Record<string, unknown>;
  const jira = (planning.jira ?? {}) as Record<string, unknown>;
  // Effective backend: runtime payload override wins over project config (§5 precedence shape).
  const effectiveBackend = payload.backend !== undefined ? payload.backend : planning.backend;
  // migrate IS the jira migration (contract §2): run touches jira regardless of the
  // not-yet-cut-over backend value; status/clear only read/clear local migration state.
  const verb = String(payload.verb ?? "run");
  const touchesJira = skill === "tk-studio-migrate"
    ? verb !== "status" && verb !== "clear"
    : effectiveBackend === "jira";
  if (!touchesJira) return gaps;

  if (!process.env.JIRA_API_TOKEN) gaps.push("backend auth: JIRA_API_TOKEN unset (API token, not OAuth)");
  const email = process.env.JIRA_EMAIL ?? (typeof jira.email === "string" ? jira.email : undefined);
  if (!email) gaps.push("backend auth: JIRA_EMAIL unset and no planning.jira.email");

  // §1 MUST: verify the org-admin API-token toggle is enabled — best-effort live probe
  // when site + credentials are all present (a failure here is a named gap, not a hang).
  const site = typeof jira.site === "string" ? jira.site : undefined;
  if (gaps.length === 0 && site && email && process.env.JIRA_API_TOKEN) {
    const base = site.startsWith("http") ? site : `https://${site}`;
    try {
      const res = await fetch(`${base.replace(/\/+$/, "")}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${Buffer.from(`${email}:${process.env.JIRA_API_TOKEN}`).toString("base64")}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 || res.status === 403) {
        gaps.push(`backend auth: Jira probe returned ${res.status} — token invalid, or org-admin API-token access disabled`);
      }
    } catch (e) {
      gaps.push(`backend auth: Jira probe against ${base} failed (${e instanceof Error ? e.message : e}) — cannot verify org-admin API-token toggle`);
    }
  }
  return gaps;
}

// ------------------------------------------------------------ drift-at-start (§6 SHOULD)

/** Lazy per-project drift snapshot: first tk_invoke against a root runs the §6 check
 * for that root. Only successes are cached — a transient failure is retried next call. */
const driftByRoot = new Map<string, unknown>();

async function driftCheck(projectRoot: string, guided = false, timeoutS = 120): Promise<unknown> {
  const script = join(pluginRoot(), "skills", "tk-studio-activate", "scripts", "drift_check.py");
  const args = ["--directory", projectRoot, ...(guided ? ["--guided"] : [])];
  const res = await runUv(projectRoot, script, args, timeoutS);
  const parsed = lastJsonObject(res.stdout);
  if (parsed === null) throw new Error(`drift check emitted no JSON (exit ${res.exit}): ${res.stderr.slice(0, 400)}`);
  return parsed;
}

// ------------------------------------------------------------ tools

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

const locatorProps = {
  project_id: { type: "string", description: "registry project id (default: sole registry entry)" },
  directory: { type: "string", description: "explicit project root (overrides project_id)" },
};

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const TOOLS: ToolDef[] = [
  {
    name: "tk_projects",
    description: "List tk-studio registered projects through the registry read path (read-only): id, root, planning backend, vault-link state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => registryShow(),
  },
  {
    name: "tk_contract",
    description: "Report the driver-contract version this connector consumes vs. what the studio publishes, with the compatibility verdict.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => ({ consumed: CONSUMED_CONTRACT, pinned_line: PINNED_LINE, ...checkContract() }),
  },
  {
    name: "tk_drift_check",
    description: "Run the tk-studio three-way drift check (read-only, contract §6). Surfaces per-plane status and fixes[] verbatim; emits the studio's own drift-detection event.",
    inputSchema: {
      type: "object",
      properties: { ...locatorProps, guided: { type: "boolean", description: "mark as onboarding-funnel variant" } },
      additionalProperties: false,
    },
    handler: async (args) => {
      const { root } = await resolveRoot(args);
      requireCompatible();
      return driftCheck(root, args.guided === true);
    },
  },
  {
    name: "tk_job",
    description: "tk-studio job verbs (contract §4): submit | status | resolve | cancel | wake on the harness-native substrate, plus `finish` (§2 executing-wrapper verb) to terminal-ize a skill-target run this driver executed from a wake/submit invoke-skill directive. `resolve` (0.1.12) serves declared jobs with type extension applied by the studio-side resolver — substrate-side discovery classifies trigger/cadence from it, never from raw `.tk-studio/jobs/<id>.json` files.",
    inputSchema: {
      type: "object",
      properties: {
        ...locatorProps,
        verb: { type: "string", enum: [...DRIVER_JOB_VERBS, ...WRAPPER_JOB_VERBS] },
        id: { type: "string", description: "submit: job definition id (shipped or project job instance)" },
        job_id: { type: "string", description: "status/cancel/wake: the job id; resolve: optional — omit to serve every declared job in config order" },
        run_id: { type: "string", description: "status/cancel: optional specific run; finish: the run to terminal-ize (required)" },
        state: { type: "string", enum: [...RUN_TERMINAL_STATES], description: "finish: terminal run state" },
        reason: { type: "string", description: "finish: §4-required when state is partial|blocked|cancelled" },
        status_block: { type: "object", description: "finish: the run's terminal §3 status block" },
      },
      required: ["verb"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const verb = String(args.verb ?? "");
      const verbs: readonly string[] = [...DRIVER_JOB_VERBS, ...WRAPPER_JOB_VERBS];
      if (!verbs.includes(verb)) throw new Error(`verb must be one of ${verbs.join("|")}`);
      const { root } = await resolveRoot(args);
      requireCompatible();
      const script = join(pluginRoot(), "lib", "jobrun.py");
      const cliArgs = [verb, "--directory", root];
      if (verb === "submit") {
        if (!args.id) throw new Error("submit requires `id`");
        cliArgs.push("--id", String(args.id));
      } else if (verb === "finish") {
        if (!args.run_id) throw new Error("finish requires `run_id`");
        const state = String(args.state ?? "");
        if (!(RUN_TERMINAL_STATES as readonly string[]).includes(state)) {
          throw new Error(`finish requires \`state\` in ${RUN_TERMINAL_STATES.join("|")}`);
        }
        cliArgs.push("--run-id", String(args.run_id), "--state", state);
        if (args.reason !== undefined) cliArgs.push("--reason", String(args.reason));
        if (args.status_block !== undefined) {
          if (typeof args.status_block !== "object" || args.status_block === null || Array.isArray(args.status_block)) {
            throw new Error("`status_block` must be a JSON object (§3 shape)");
          }
          cliArgs.push("--status-block", JSON.stringify(args.status_block));
        }
      } else if (verb === "resolve") {
        if (args.run_id !== undefined) throw new Error("resolve takes no run_id (contract §4: resolve serves declared definitions, not runs)");
        if (args.job_id !== undefined) cliArgs.push("--job-id", String(args.job_id));
      } else {
        if (!args.job_id) throw new Error(`${verb} requires \`job_id\``);
        cliArgs.push("--job-id", String(args.job_id));
        if (args.run_id !== undefined) {
          if (verb === "wake") throw new Error("wake takes no run_id (contract §4: wake fires the job's next iteration)");
          cliArgs.push("--run-id", String(args.run_id));
        }
      }
      return runJobVerb(root, cliArgs);
    },
  },
  {
    name: "tk_invoke",
    description: "Invoke a tk-studio skill surface headless (contract §1/§2) and return the terminal status block (§3) plus output. Runs the auth preflight first; on first use per project also runs the §6 drift check and attaches it.",
    inputSchema: {
      type: "object",
      properties: {
        ...locatorProps,
        skill: { type: "string", description: "surface name, e.g. tk-studio-detect (tk-studio- prefix optional)" },
        payload: { type: "object", description: "payload fields per the contract §2 table (directory defaults to the resolved project root)" },
        model: { type: "string", description: "§5 runtime model override — forwarded, never escalated" },
        effort: { type: "string", description: "§5 runtime effort override" },
        timeout_s: { type: "number", description: "run timeout in seconds (default 600)" },
        permission_mode: { type: "string", enum: [...PERMISSION_MODES], description: "claude -p permission mode (default auto; bypassPermissions is refused on the host — HostBypassRefused)" },
        knowledge: { type: "object", description: "§4 KB-injection directive from a submit/wake invoke-skill directive ({spine|seed: {path, present}}) — present artifacts' contents are injected into the run prompt as provisional knowledge (aid, not gate: absent/unreadable artifacts are skipped and reported)" },
      },
      required: ["skill"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { root } = await resolveRoot(args);
      requireCompatible();
      if (typeof args.skill !== "string" || !args.skill.trim()) throw new Error("`skill` must be a non-empty surface name");
      const bare = args.skill.startsWith("tk-studio-") ? args.skill.slice("tk-studio-".length) : args.skill;
      if (!SKILL_NAME_RE.test(bare)) throw new Error(`invalid skill name '${args.skill}' — expected kebab-case (contract §2 surface table)`);
      const skill = `tk-studio-${bare}`;
      if (args.payload !== undefined && (typeof args.payload !== "object" || args.payload === null || Array.isArray(args.payload))) {
        throw new Error("`payload` must be a JSON object (contract §2 payload fields)");
      }
      return invokeSkill(root, skill, args);
    },
  },
];

export interface InvokeArgs {
  payload?: unknown; model?: unknown; effort?: unknown; timeout_s?: unknown;
  permission_mode?: unknown; knowledge?: unknown;
}

/** The §1 headless prompt. It always STARTS with the skill line —
 * `/tk-studio:<skill> <payload JSON>` — or `claude -p` does not invoke the
 * skill as a slash command. The §4 KB-injection preamble (present provisional
 * artifacts; the act is ours, AD-2, aid not gate) follows the skill line.
 * The §1 mode is the driver's to declare: nothing in a bare `claude -p` run
 * tells the skill it is headless, and an undeclared mode reproducibly yields
 * attended-style behavior (asking instead of a §3 terminal block). */
export function buildSkillPrompt(skill: string, payload: Record<string, unknown>, injection: KnowledgeInjection): string {
  return `/tk-studio:${skill} ${JSON.stringify(payload)}\n` +
    injection.preamble +
    "HEADLESS driver invocation (driver contract §1): never prompt or ask questions; " +
    "end the run with the terminal JSON status block (§3) as the last JSON object on stdout; " +
    "on ambiguity end blocked with the gap named in reason.";
}

/** Headless skill run (§1): command line built first (a host bypass throws
 * HostBypassRefused before any process starts), then the Max-login preflight,
 * then the worker. Answers the tool result: status block, cost, or the named
 * conformance failure. */
export async function invokeSkill(root: string, skill: string, args: InvokeArgs, spawner: Spawner = runProcess): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...(args.payload as Record<string, unknown> ?? {}) };
  if (payload.directory === undefined) payload.directory = root; // §2: nearly every surface requires it; the registry already resolved it
  if (args.model) payload.model = args.model;
  if (args.effort) payload.effort = args.effort;

  const injection = buildKnowledgeInjection(args.knowledge);
  const prompt = buildSkillPrompt(skill, payload, injection);
  const timeoutS = typeof args.timeout_s === "number" && args.timeout_s > 0 ? args.timeout_s : 600;
  const cmd = buildWorkerCommand({
    prompt,
    permissionMode: args.permission_mode === undefined ? undefined : String(args.permission_mode),
    model: typeof args.model === "string" ? args.model : undefined,
    effort: typeof args.effort === "string" ? args.effort : undefined,
  });

  const gaps = await authPreflight(skill, payload, root, spawner);
  if (gaps.length) {
    return {
      status_block: { status: "blocked", intent: skill, artifacts: [], reason: `auth preflight: ${gaps.join("; ")}` },
      preflight: gaps, ran: false,
    };
  }
  if (!driftByRoot.has(root)) {
    try { driftByRoot.set(root, await driftCheck(root)); }
    catch (e) { /* not cached — retried on the next invoke */ void e; }
  }

  const res = await runClaude(cmd, root, timeoutS, spawner);
  const worker = parseWorkerResult(res.stdout);
  const block = extractStatusBlock(worker.text);
  const result: Record<string, unknown> = {
    ran: true, exit: res.exit, startup_drift: driftByRoot.get(root) ?? null,
    output_tail: worker.text.slice(-2000),
    ...(worker.totalCostUsd !== undefined ? { total_cost_usd: worker.totalCostUsd } : {}),
  };
  if (args.knowledge !== undefined) {
    result.knowledge_injected = injection.injected;
    if (injection.skipped.length) result.knowledge_skipped = injection.skipped;
  }
  // §1 MUST: a 401 fails the run `blocked`, never silently — scan the result
  // AND stderr (CLI auth failures characteristically land on stderr, or in
  // non-JSON stdout); a failed run carrying a real auth-failure signal is the
  // Max login gone. Only a failed run (is_error or a non-zero exit) is scanned:
  // healthy output that merely mentions "unauthorized" or "status 401" is not
  // an auth failure.
  const failed = worker.isError || res.exit !== 0;
  const authFailed = failed && [worker.text, res.stderr].some((s) => AUTH_FAIL_RE.test(s) || IS_ERROR_AUTH_RE.test(s));
  const authReason = `${MAX_LOGIN_MISSING} — worker answered 401/auth failure (§1)`;
  const authBlock = { status: "blocked", intent: skill, artifacts: [], reason: authReason };
  if (block) {
    if (authFailed && block.status !== "blocked") {
      result.status_block = authBlock;
      result.run_status_block = block; // the run's own block, preserved for inspection
    } else if (authFailed) {
      // Already blocked: the reason still names the Max login, the worker's own after it.
      const own = typeof block.reason === "string" && block.reason ? `; ${block.reason}` : "";
      result.status_block = { ...block, reason: `${authReason}${own}` };
    } else {
      result.status_block = block;
    }
  } else if (authFailed) {
    result.status_block = authBlock;
    result.stderr_tail = res.stderr.slice(-1000);
  } else {
    // §3 / AD-11: a run ending without a status block is itself a conformance failure.
    result.conformance_failure = MISSING_STATUS_BLOCK;
    result.stderr_tail = res.stderr.slice(-1000);
  }
  return result;
}

// ------------------------------------------------------------ JSON-RPC plumbing

function reply(id: unknown, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id: unknown, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }) + "\n");
}

async function handle(msg: unknown): Promise<void> {
  if (Array.isArray(msg)) { replyError(null, -32600, "batch requests not supported (stdio: one message per line)"); return; }
  if (typeof msg !== "object" || msg === null) { replyError(null, -32600, "invalid request"); return; }
  const { id, method, params } = msg as { id?: unknown; method?: string; params?: Record<string, unknown> };
  const isNotification = id === undefined;
  if (method === undefined) {
    if (!isNotification) replyError(id, -32600, "invalid request: missing method");
    return;
  }
  // Notifications (no id) never get a reply — and never execute request methods.
  if (isNotification) return;
  try {
    switch (method) {
      case "initialize":
        reply(id, {
          // Always the version we actually implement — echoing an unknown client
          // version would claim support we don't have; the client negotiates down.
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;
      case "ping":
        reply(id, {});
        return;
      case "tools/list":
        reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        return;
      case "tools/call": {
        const name = params?.name as string;
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) { replyError(id, -32602, `unknown tool: ${name}`); return; }
        try {
          const result = await tool.handler((params?.arguments as Record<string, unknown>) ?? {});
          reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (e) {
          reply(id, { content: [{ type: "text", text: String(e instanceof Error ? e.message : e) }], isError: true });
        }
        return;
      }
      default:
        replyError(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    replyError(id, -32603, String(e instanceof Error ? e.message : e));
  }
}

const inFlight = new Set<Promise<void>>();

function dispatchLine(line: string): void {
  let msg: unknown;
  try { msg = JSON.parse(line); }
  catch { replyError(null, -32700, "parse error"); return; }
  // Fire-and-forget: long tool calls must not block ping/tools/list on later lines.
  const p = handle(msg).finally(() => inFlight.delete(p));
  inFlight.add(p);
}

// One JSON-RPC message per line on stdin.
if (import.meta.main) {
  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      dispatchLine(line);
    }
  });
  process.stdin.on("end", () => {
    const tail = buffer.trim();
    if (tail) dispatchLine(tail); // last line may arrive without a trailing newline
    // Drain in-flight tool calls (their child processes finish cleanly), then exit.
    Promise.allSettled([...inFlight]).then(() => setTimeout(() => process.exit(0), 20));
  });
}
