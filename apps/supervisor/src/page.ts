/**
 * The read-only status page (Story 22.2): `GET /` on the API's bind, behind its bearer check.
 *
 * `gatherPage` only reads — the queue (`runs`, `jobs`, `events`, `locks`, `resumeCount`,
 * `recordedWorker(run, false)`, the owner probe `ownerAlive`), the per-user store (`run.json`, `handoff.json`, the tail of
 * this machine's ledger file) and the registry's published read path (`registry.py show`).
 * `renderPage` turns that into escaped HTML with inline CSS, a viewport meta and no script.
 * Every rendered string passes `redactCredentials` (NFR5: the supervisor's own redaction).
 */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { basename, join } from "node:path";
import { studioHome } from "./env";
import { isTerminal, type Holder, type LockRow, type Queue, type QueueEvent, type QueueRun } from "./queue";
import { readAgents, type AgentRow } from "./registry";
import { readProjectConfig } from "./server";

type Env = Record<string, string | undefined>;

export interface PageDeps {
  queue: Queue;
  /** The API token (never rendered). */
  token: string;
  /** The environment: the store root (`TK_STUDIO_HOME`), the ledger identity, the `TK_SUPERVISOR_*TOKEN*`/`*SECRET*` values to redact. */
  env?: Env;
  /** The registry's projects through its published read path (`registryShow`). */
  registry: () => Promise<Record<string, any>>;
  /** This machine's ledger identity (default: getpass order for the user, the hostname for the machine). */
  ledger?: { user: string; machine: string };
}

/** A lock's holder, as a waiting run names it (`/status` and the page alike). */
export function holderOf(lock: LockRow): Holder {
  return lock.kind === "engine"
    ? { kind: "engine", run_id: lock.run_id, job_id: lock.job_id, engine_run_id: lock.engine_run_id }
    : { kind: "run", run_id: lock.run_id, job_id: lock.job_id, pid: lock.owner_pid, host: lock.owner_host };
}

/** How much the page shows. */
const RUNS_SHOWN = 50, EVENTS_PER_RUN = 30, STATUS_BLOCKS = 5, LEDGER_LINES = 20;

/** A store file read: its parsed value, or a note naming the store-relative path tried. */
type Read = { ok: true; value: unknown } | { ok: false; note: string };

export interface KeptLock {
  /** The holder's project root (`locks.root`): what the card is titled with — a nested project names itself, not its repository. */
  root: string;
  /** The lock key (the git top-level's checkout key, Story 28.5), shown as a secondary line. */
  checkout: string; kind: "run" | "engine"; run_id: string; holder: Holder; acquired: string;
  run_state: string | null;
  /** The run's own reason (null for an engine lock or a run not in the queue). */
  reason: string | null;
  /** Why the lock is kept, as text ("kept for its live driver", "held by a running run", …). */
  kept: string;
  /** sbx: the recorded worker's in-VM deadline (only where one exists). */
  deadline: string | null;
}

export interface PageRun {
  run: QueueRun; resumes: number; cost: number | null; events: QueueEvent[]; eventsOmitted: number;
  workspace: string | null; runJson: Read; handoff: Read;
}

export interface PageData {
  generated: string;
  counts: Record<string, number>;
  jobs: ReturnType<Queue["jobs"]>;
  runs: PageRun[];
  runsOmitted: number;
  locks: KeptLock[];
  statusBlocks: { run_id: string; studio_run_id: string; block: unknown }[];
  ledger: { path: string; lines: string[] } | { path: string; note: string };
  registry: { ok: true; projects: Record<string, Record<string, unknown>> } | { ok: false; note: string };
  /** Story 29.2: the agent registry as the last rebuild left it (read from the queue's `agents` table, never
   * rebuilt here), grouped by project. Absent: the section notes no registry. */
  agents?: { rebuilt_at: string | null; byProject: Record<string, AgentRow[]> };
  /** For the renderer's redaction. */
  secrets: { token: string; env: Env };
}

/** The studio's `safe_name`: every character outside `[A-Za-z0-9._-]` becomes `_`. */
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._\-]/g, "_");

/** The project key the studio's workspace uses: the run's own project id, else the checkout's
 * `.tk-studio/config.yaml` `project_id`, else the checkout's basename. */
function projectKey(run: QueueRun): string {
  if (run.project_id) return safeName(run.project_id);
  const pid = readProjectConfig(run.root).config.project_id;
  return safeName((typeof pid === "string" || typeof pid === "number") && String(pid) ? String(pid) : basename(run.root));
}

/** getpass order: LOGNAME, USER, LNAME, USERNAME, then the account name. */
function ledgerUser(env: Env): string {
  for (const k of ["LOGNAME", "USER", "LNAME", "USERNAME"]) if (env[k]) return env[k]!;
  try { return userInfo().username; } catch { return "unknown"; }
}

/** Absolute machine paths out of free text (AD-15): the store root → `~/.tk-studio`, `TK_STUDIO_ROOT`
 * → `<studio>`, the home directory → `~`; longest first, in both separator forms and the doubled-backslash
 * form of a Python repr, a drive letter in either case; only where the path ends (a longer sibling such
 * as `/home/timothy` for `/home/tim` is left as it is). */
function machinePathsOut(text: string, store: string, env: Env): string {
  const subs: [string, string][] = [];
  for (const [p, to] of [[store, "~/.tk-studio"], [env.TK_STUDIO_ROOT?.trim() ?? "", "<studio>"], [homedir(), "~"]] as const) {
    const bare = p.replace(/[\\/]+$/, "");
    if (bare.length < 2) continue;
    for (const form of new Set([bare, bare.replace(/\\/g, "/"), bare.replace(/\//g, "\\"), bare.replace(/[\\/]/g, "\\\\")])) subs.push([form, to]);
  }
  let out = text;
  for (const [from, to] of subs.sort((a, b) => b[0].length - a[0].length)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A drive letter matches in either case; the rest of the path as configured.
    const pattern = /^[A-Za-z]:/.test(from) ? `[${from[0].toLowerCase()}${from[0].toUpperCase()}]${escaped.slice(1)}` : escaped;
    out = out.replace(new RegExp(`${pattern}(?![A-Za-z0-9_.\\-])`, "g"), () => to);
  }
  return out;
}

function readJson(store: string, rel: string[]): Read {
  const shown = rel.join("/");
  let text: string;
  try { text = readFileSync(join(store, ...rel), "utf-8"); }
  catch (e) { return { ok: false, note: (e as NodeJS.ErrnoException).code === "ENOENT" ? `${shown} not found` : `${shown} unreadable` }; }
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false, note: `${shown} is not valid JSON` }; }
}

/** Byte-level lines of `buf` (split on 0x0A) holding anything but CR, space or tab. */
function nonBlankLines(buf: Buffer): number {
  let count = 0, blank = true;
  for (const b of buf) {
    if (b === 0x0a) { if (!blank) count++; blank = true; }
    else if (b !== 0x0d && b !== 0x20 && b !== 0x09) blank = false;
  }
  return blank ? count : count + 1;
}

/** The last `n` lines of a file, read backwards from its end in chunks (never the whole file).
 * The raw bytes are collected and decoded once, so a multi-byte character straddling a chunk
 * boundary stays whole. */
export function tailLines(path: string, n: number): string[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const chunk = 8192;
    let pos = size, bytes = Buffer.alloc(0);
    while (pos > 0 && nonBlankLines(bytes) <= n) {
      const len = Math.min(chunk, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      bytes = Buffer.concat([buf, bytes]);
    }
    // A partial first line (the read stopped mid-file) is dropped, at the byte level.
    if (pos > 0) {
      const nl = bytes.indexOf(0x0a);
      bytes = nl < 0 ? Buffer.alloc(0) : bytes.subarray(nl + 1);
    }
    return bytes.toString("utf-8").split(/\r?\n/).filter((l) => l.trim()).slice(-n);
  } finally { closeSync(fd); }
}

/** Everything the page shows — reads only: nothing is written to the queue or the store. */
export async function gatherPage(deps: PageDeps): Promise<PageData> {
  const { queue } = deps;
  const env = deps.env ?? process.env;
  const store = studioHome(env);
  const all = queue.runs();
  const counts: Record<string, number> = {};
  for (const r of all) counts[r.state] = (counts[r.state] ?? 0) + 1;
  const newest = [...all].reverse();
  const shown = newest.slice(0, RUNS_SHOWN);

  const runs: PageRun[] = shown.map((run) => {
    const events = queue.events(run.run_id);
    let workspace: string | null = null, runJson: Read, handoff: Read;
    if (!run.studio_run_id) {
      runJson = handoff = { ok: false, note: "no studio run recorded" };
    } else {
      let key: string | null = null;
      try { key = projectKey(run); } catch { /* no key: noted below */ }
      if (key === null) {
        runJson = handoff = { ok: false, note: "the project key could not be read" };
      } else {
        const rel = ["projects", key, "runs", safeName(run.studio_run_id)];
        workspace = rel.join("/");
        runJson = readJson(store, [...rel, "run.json"]);
        handoff = readJson(store, [...rel, "handoff.json"]);
      }
    }
    const rj = runJson.ok && runJson.value && typeof runJson.value === "object" ? runJson.value as Record<string, unknown> : null;
    const cost = rj && typeof rj.total_cost_usd === "number" && Number.isFinite(rj.total_cost_usd) ? rj.total_cost_usd : null;
    return {
      run, resumes: queue.resumeCount(run.run_id), cost,
      events: events.slice(-EVENTS_PER_RUN), eventsOmitted: Math.max(0, events.length - EVENTS_PER_RUN),
      workspace, runJson, handoff,
    };
  });

  // Kept checkout locks, read only through `Queue.locks()`, named as `/status` names them.
  const locks: KeptLock[] = [];
  for (const l of queue.locks()) {
    const run = l.kind === "run" ? queue.get(l.run_id) : null;
    let kept: string, deadline: string | null = null;
    if (l.kind === "engine") kept = `handed to bmad-loop engine ${l.engine_run_id ?? "(unverified)"}`;
    else if (!run) kept = "its run is not in the queue";
    else {
      const hasWorker = run.worker_pid !== null && run.worker_pid !== undefined;
      let mayRun: boolean | null = null;
      if (hasWorker && (run.tier === "sbx" || isTerminal(run.state))) {
        // A probe only (`kill` false): sbx, the in-VM deadline against the queue's clock; host, the
        // pid + start time probe. Never a signal. A throw leaves `mayRun` unknown.
        try {
          const w = await queue.recordedWorker(run, false);
          deadline = w.worker?.deadline ?? null;
          mayRun = w.mayRun;
        } catch { /* unknown */ }
      }
      if (!isTerminal(run.state)) kept = `held by its ${run.state} run`;
      else if (!hasWorker) {
        // The driver is the lock's recorded owner: the owner probe `claim`/`recover` ask (no signal,
        // no write) on the run with the lock's owner (the ended run's own owner fields are cleared).
        const driverAlive = queue.ownerAlive({ ...run, owner_pid: l.owner_pid, owner_host: l.owner_host, owner_nonce: l.owner_nonce, owner_start: l.owner_start });
        kept = driverAlive ? "kept for its live driver" : "kept by a driver no longer alive: the next claim or recover frees it";
      } else if (run.tier === "sbx") {
        kept = mayRun === null ? "kept for its sbx worker (deadline unknown)"
          : mayRun ? "kept until its sbx worker's in-VM deadline" : "in-VM deadline passed: the next claim or recover frees it";
      } else {
        const pid = run.worker_pid;
        kept = mayRun === null ? `kept for its recorded worker (pid ${pid}) (liveness unknown)`
          : mayRun ? `kept while its recorded worker (pid ${pid}) may run` : `recorded worker (pid ${pid}) is gone: the next claim or recover frees it`;
      }
    }
    // An engine lock's `root` is where the engine is probed (the served root in the worktree): the card
    // is titled with the handing run's project root, `l.root` only when that run is not in the queue.
    const root = l.kind === "engine" ? queue.get(l.run_id)?.root ?? l.root : l.root;
    locks.push({ root, checkout: l.checkout, kind: l.kind, run_id: l.run_id, holder: holderOf(l), acquired: l.acquired, run_state: run?.state ?? null, reason: run?.reason ?? null, kept, deadline });
  }

  const statusBlocks: PageData["statusBlocks"] = [];
  for (const r of runs) {
    if (statusBlocks.length >= STATUS_BLOCKS) break;
    if (!r.runJson.ok || !r.runJson.value || typeof r.runJson.value !== "object") continue;
    const block = (r.runJson.value as Record<string, unknown>).status_block;
    if (block !== undefined && block !== null) statusBlocks.push({ run_id: r.run.run_id, studio_run_id: r.run.studio_run_id!, block });
  }

  const who = deps.ledger ?? { user: ledgerUser(env), machine: hostname() };
  const ledgerRel = `measurements/${safeName(who.user)}-${safeName(who.machine)}.jsonl`;
  let ledger: PageData["ledger"];
  try { ledger = { path: ledgerRel, lines: tailLines(join(store, ...ledgerRel.split("/")), LEDGER_LINES) }; }
  catch (e) { ledger = { path: ledgerRel, note: (e as NodeJS.ErrnoException).code === "ENOENT" ? `${ledgerRel} not found` : `${ledgerRel} unreadable` }; }

  let registry: PageData["registry"];
  try {
    const shownReg = await deps.registry();
    const projects = shownReg?.projects;
    registry = projects && typeof projects === "object" ? { ok: true, projects } : { ok: false, note: "registry show answered no projects" };
  } catch (e) {
    registry = { ok: false, note: `registry show failed: ${machinePathsOut(e instanceof Error ? e.message : String(e), store, env)}` };
  }

  // Story 29.2: the `agents` table read as it stands (the page never rebuilds it, never resolves a route).
  const read = readAgents(queue);
  const byProject: Record<string, AgentRow[]> = {};
  for (const a of read.agents) (byProject[a.project] ??= []).push(a);

  return {
    generated: new Date().toISOString(), counts, jobs: queue.jobs(), runs, runsOmitted: Math.max(0, all.length - shown.length),
    locks, statusBlocks, ledger, registry, agents: { rebuilt_at: read.rebuilt_at, byProject }, secrets: { token: deps.token, env },
  };
}

// ------------------------------------------------------------ redaction (NFR5)

/** A credential-named key: token, secret, password, api key, private key, session key, cookie,
 * authorization, credential (a whole word; `total_tokens` and `session_id` are not). A camelCase
 * key that starts with the word counts too (`secretKey`, `SecretAccessKey`, `tokenValue`), except
 * a count-shaped one (`tokenCount`, `tokensUsed`). */
export function credentialKey(k: string): boolean {
  return /(?:^|[^a-z])(?:token|secret|password|passwd|api[_\-.]?key|private[_\-.]?key|session[_\-.]?key|cookies?|authorization|credentials?)(?:$|[^a-z])/i.test(k)
    || /[a-z0-9](?:Token|Secret|Password|ApiKey|PrivateKey|SessionKey|Cookies?|Authorization|Credentials?)$/.test(k)
    || /^(?:[Tt]oken|[Ss]ecret|[Pp]assword|[Pp]asswd|[Aa]pi[_\-.]?[Kk]ey|[Pp]rivate[_\-.]?[Kk]ey|[Ss]ession[_\-.]?[Kk]ey|[Cc]ookies?|[Aa]uthorization|[Cc]redentials?)(?!(?:Counts?|Usage|Used|Limits?|Totals?|Budget)(?:[A-Z]|$))[A-Z]/.test(k);
}

/** Values under credential-named keys replaced, recursively; every string leaf passes `text`
 * (the text redaction), so JSON embedded in a string (escaped once stringified) never renders. */
function redactValue(v: unknown, text: (s: string) => string): unknown {
  if (typeof v === "string") return text(v);
  if (Array.isArray(v)) return v.map((x) => redactValue(x, text));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, credentialKey(k) ? "[redacted]" : redactValue(x, text)]));
  }
  return v;
}

const KEY_SHAPES: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_\-]+/g,
  /\bsk-[A-Za-z0-9_\-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bxox[abprs]-[A-Za-z0-9\-]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(?<![0-9])\d{6,}:[A-Za-z0-9_\-]{30,}/g, // a Telegram bot token (also right after `/bot` in an API URL)
];

/** The supervisor's own redaction: the API token and every `TK_SUPERVISOR_*TOKEN*` / `TK_SUPERVISOR_*SECRET*`
 * value (the session secret and the OAuth client secrets, Story 22.5), values under
 * credential-named keys (JSON `"key": value`, `KEY=value`, `key: value`), `Bearer`/`Basic` credentials,
 * and common key-shaped strings. */
export function redactCredentials(text: string, env: Env, token: string): string {
  const exact = [token, ...Object.entries(env).filter(([k]) => /^TK_SUPERVISOR_.*(?:TOKEN|SECRET)/i.test(k)).map(([, v]) => v?.trim() ?? "")]
    .filter((v) => v.length > 0).sort((a, b) => b.length - a.length);
  let out = text;
  for (const v of exact) out = out.split(v).join("[redacted]");
  out = out.replace(/\b(Bearer)(\s+)[^\s"',;]+/gi, (_m, s: string, sp: string) => `${s}${sp}[redacted]`);
  out = out.replace(/\b(Basic)(\s+)[A-Za-z0-9+/=]{8,}/gi, (_m, s: string, sp: string) => `${s}${sp}[redacted]`);
  out = redactKeyValues(out);
  for (const re of KEY_SHAPES) out = out.replace(re, "[redacted]");
  return out;
}

/** Values under credential-named keys (`"key": value`, `KEY=value`, `key: value`), with the quotes
 * plain or backslash-escaped to any depth (JSON stringified once, twice, … inside free text). A
 * non-credential key's value is scanned too, so a credential nested in it is found. */
function redactKeyValues(text: string): string {
  // A key, optionally quoted by `\\*["']` (the same sequence on both sides), then `:` or `=`.
  const keySep = /((?:\\*["'])?)([A-Za-z0-9_.\-]+)\1(\s*[:=]\s*)/g;
  let out = "", from = 0, m: RegExpExecArray | null;
  while ((m = keySep.exec(text)) !== null) {
    if (!credentialKey(m[2])) continue; // scanning resumes at the value: nested keys are found
    const at = m.index + m[0].length;
    const v = credentialValue(text, at);
    if (!v) continue;
    out += text.slice(from, at) + v.shown;
    from = keySep.lastIndex = v.end;
  }
  return out + text.slice(from);
}

/** The value starting at `at`: its end and its redacted form, or null (nothing to redact, or already
 * `[redacted]`). A quoted value opened by `b` backslashes and a quote (escape depth d: b = 2^d - 1)
 * closes at the next such quote preceded by `b + k·2(b+1)` backslashes — deeper-escaped quotes and
 * literal backslashes inside it are skipped. An unclosed quoted value is redacted to the end. */
function credentialValue(text: string, at: number): { end: number; shown: string } | null {
  const open = /(\\*)(["'])/y;
  open.lastIndex = at;
  const o = open.exec(text);
  if (o) {
    const b = o[1].length, start = at + o[0].length;
    for (let j = text.indexOf(o[2], start); j >= 0; j = text.indexOf(o[2], j + 1)) {
      let r = 0;
      while (j - r - 1 >= start && text[j - r - 1] === "\\") r++;
      if (r >= b && (r - b) % (2 * (b + 1)) === 0) {
        return text.slice(start, j - b) === "[redacted]" ? null : { end: j + 1, shown: `${o[0]}[redacted]${o[0]}` };
      }
    }
    return { end: text.length, shown: `${o[0]}[redacted]` };
  }
  const bare = /[^\s,;}&"']+/y;
  bare.lastIndex = at;
  const u = bare.exec(text);
  return !u || u[0] === "[redacted]" ? null : { end: at + u[0].length, shown: "[redacted]" };
}

// ------------------------------------------------------------ render

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box;overflow-wrap:anywhere}
body{margin:0;padding:.75rem;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e4e4e4;background:#141414;max-width:60rem}
a{color:#8ab4f8}
h1{font-size:1.25rem;margin:.25rem 0}h2{font-size:1.05rem;margin:1.25rem 0 .5rem;border-bottom:1px solid #333}
.card{background:#1e1e1e;border:1px solid #333;border-radius:6px;padding:.5rem .65rem;margin:.5rem 0}
.meta{color:#a3a3a3;font-size:.85rem}.note{color:#e0a458;font-style:italic}
.st{display:inline-block;padding:0 .4rem;border-radius:4px;background:#2c2c2c;font-weight:600}
.reason{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:.25rem 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-size:.8rem;background:#1a1a1a;padding:.4rem;border-radius:4px;margin:.25rem 0}
ul{padding-left:1.1rem;margin:.25rem 0}li{margin:.15rem 0}
details summary{cursor:pointer;color:#cfcfcf}
form.cancel{margin:.35rem 0}form.cancel button{padding:.35rem .8rem;font-size:.95rem;background:#2a2a2a;color:#e4e4e4;border:1px solid #555;border-radius:4px}
@media (min-width:48rem){body{padding:1.25rem}}
`;

/** The escaped, credential-redacted HTML. With a CSRF token (a cookie session's page, Story 22.5) each
 * live run carries a cancel form (`POST /runs/<id>/cancel`, the token in a hidden `csrf` field). */
export function renderPage(data: PageData, opts: { csrf?: string } = {}): string {
  const { token, env } = data.secrets;
  const redact = (s: string) => redactCredentials(s, env, token);
  const t = (s: unknown) => escapeHtml(redact(String(s ?? "")));
  const j = (v: unknown) => t(JSON.stringify(redactValue(v, redact), null, 2) ?? "null");
  const note = (s: string) => `<p class="note">${t(s)}</p>`;
  const read = (label: string, r: Read) => r.ok ? `<details><summary>${t(label)}</summary><pre>${j(r.value)}</pre></details>` : `<p class="meta">${t(label)}: <span class="note">${t(r.note)}</span></p>`;

  const cancelForm = (r: QueueRun) => opts.csrf && !isTerminal(r.state)
    ? `<form class="cancel" method="post" action="/runs/${escapeHtml(encodeURIComponent(r.run_id))}/cancel"><input type="hidden" name="csrf" value="${escapeHtml(opts.csrf)}"><button type="submit">Cancel run</button></form>`
    : "";

  const counts = Object.entries(data.counts).map(([s, n]) => `<span class="st">${t(s)} ${n}</span>`).join(" ") || "no runs";

  const jobs = data.jobs.length ? data.jobs.map((jb) => {
    const d = jb.definition ?? {};
    const target = d.target && typeof d.target === "object" ? JSON.stringify(redactValue(d.target, redact)) : "";
    return `<div class="card"><strong>${t(jb.job_id)}</strong> <span class="meta">project ${t(jb.project_id ?? "-")}</span>
<div class="meta">trigger ${t(d.trigger ?? "-")} · target ${t(target || "-")} · updated ${t(jb.updated)}</div></div>`;
  }).join("\n") : note("no jobs submitted");

  // Story 27.3: a paused run whose latest pass event is `awaiting-ruling` waits for a human's ruling (a newer
  // `paused` — a fresh pause after a resume — needs its own record, written by the next pass).
  const ruling = (p: PageRun) => {
    if (p.run.state !== "paused") return "";
    const last = p.events.findLast((e) => ["awaiting-ruling", "close-out", "close-out-failed", "engine-resume", "paused"].includes(e.kind));
    if (last?.kind !== "awaiting-ruling") return "";
    const d = (last.detail ?? {}) as Record<string, unknown>;
    return `<p class="reason">awaiting a ruling: story ${t(d.story_key ?? "?")} — ${t(d.reason ?? "")}</p>`;
  };

  const runs = data.runs.length ? data.runs.map((p) => {
    const r = p.run;
    const evs = p.events.map((e) => `<li><span class="meta">#${e.seq} ${t(e.at)}</span> <strong>${t(e.kind)}</strong> ${t(e.from_state ?? "")}→${t(e.to_state)}${e.detail ? `<pre>${j(e.detail)}</pre>` : ""}</li>`).join("");
    return `<div class="card" id="run-${t(r.run_id)}"><strong>${t(r.run_id)}</strong> <span class="st">${t(r.state)}</span>
<div class="meta">job ${t(r.job_id)} · project ${t(r.project_id ?? "-")} · tier ${t(r.tier ?? "host")} · studio run ${t(r.studio_run_id ?? "-")}</div>
<div class="meta">resumes ${p.resumes} · cost ${p.cost === null ? "absent" : `$${t(p.cost.toFixed(4))}`} · created ${t(r.created)} · updated ${t(r.updated)}</div>
${r.reason ? `<p class="reason">${t(r.reason)}</p>` : ""}${ruling(p)}${cancelForm(r)}
<details><summary>events (${p.events.length + p.eventsOmitted})</summary>${p.eventsOmitted ? note(`${p.eventsOmitted} older events not shown`) : ""}<ul>${evs}</ul></details></div>`;
  }).join("\n") + (data.runsOmitted ? note(`${data.runsOmitted} older runs not shown`) : "") : note("no runs");

  const locks = data.locks.length ? data.locks.map((l) => {
    const h = l.holder;
    const who = h.kind === "engine" ? `engine ${h.engine_run_id ?? "(unverified)"} (run ${h.run_id}, job ${h.job_id})`
      : `run ${h.run_id} (job ${h.job_id}, pid ${h.pid ?? "?"}${h.host ? `@${h.host}` : ""})`;
    return `<div class="card"><strong>${t(l.root)}</strong>
<div class="meta">checkout ${t(l.checkout)}</div>
<div>holder: ${t(who)}${l.run_state ? ` · run <span class="st">${t(l.run_state)}</span>` : ""}</div>
<div>${t(l.kept)}${l.deadline ? ` · deadline ${t(l.deadline)}` : ""}</div>
${l.reason ? `<p class="reason">${t(l.reason)}</p>` : ""}
<div class="meta">acquired ${t(l.acquired)}</div></div>`;
  }).join("\n") : note("no checkout locks held");

  const blocks = data.statusBlocks.length ? data.statusBlocks.map((b) =>
    `<div class="card"><div class="meta">run ${t(b.run_id)} · studio run ${t(b.studio_run_id)}</div><pre>${j(b.block)}</pre></div>`).join("\n")
    : note("no status blocks in the newest runs' run.json");

  const workspaces = data.runs.length ? data.runs.map((p) => `<div class="card"><strong>${t(p.run.run_id)}</strong>
<div class="meta">${t(p.workspace ?? "no workspace")}</div>${read("run.json", p.runJson)}${read("handoff.json", p.handoff)}</div>`).join("\n") : note("no runs");

  const ledger = "lines" in data.ledger
    ? (data.ledger.lines.length ? `<p class="meta">${t(data.ledger.path)} (last ${data.ledger.lines.length} lines)</p><pre>${data.ledger.lines.map((l) => {
      try { return j(JSON.parse(l)).replace(/\n\s*/g, " "); } catch { return t(l); }
    }).join("\n")}</pre>` : note(`${data.ledger.path} is empty`))
    : note(data.ledger.note);

  const registry = data.registry.ok
    ? (Object.keys(data.registry.projects).length ? Object.entries(data.registry.projects).map(([id, e]) =>
      `<div class="card"><strong>${t(id)}</strong><div class="meta">root ${t(e?.root ?? "-")}${e?.vcs ? ` · vcs ${t(e.vcs)}` : ""}${e?.planning_backend ? ` · planning ${t(e.planning_backend)}` : ""}</div></div>`).join("\n")
      : note("no registered projects"))
    : note(data.registry.note);

  const agentProjects = data.agents ? Object.entries(data.agents.byProject) : [];
  const agents = agentProjects.length ? `<p class="meta">rebuilt ${t(data.agents!.rebuilt_at ?? "-")}</p>` + agentProjects.map(([project, rows]) =>
    `<div class="card"><strong>${t(project)}</strong><ul>${rows.map((a) =>
      `<li><strong>${t(a.role)}</strong> <span class="meta">${t(a.agent_id)}</span> · model ${t(a.model ?? "-")} · effort ${t(a.effort ?? "-")} · advisor ${t(a.advisor ?? "-")} · persona ${t(a.persona ?? "-")} · <span class="st">${t(a.live_state)}</span>${a.current_story ? ` · story ${t(a.current_story)}` : ""}${a.current_run ? ` · run ${t(a.current_run)}` : ""}</li>`).join("")}</ul></div>`).join("\n")
    : note(data.agents?.rebuilt_at ? "no agents: the registry serves no projects" : "no agent registry rebuilt yet");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>tk-studio supervisor</title><style>${CSS}</style></head>
<body><h1>tk-studio supervisor</h1><p class="meta">generated ${t(data.generated)} · ${counts}</p>
<section id="jobs"><h2>Jobs</h2>${jobs}</section>
<section id="runs"><h2>Runs</h2>${runs}</section>
<section id="locks"><h2>Kept locks</h2>${locks}</section>
<section id="status-blocks"><h2>Latest status blocks</h2>${blocks}</section>
<section id="workspaces"><h2>Run workspaces</h2>${workspaces}</section>
<section id="ledger"><h2>Ledger tail</h2>${ledger}</section>
<section id="registry"><h2>Registry projects</h2>${registry}</section>
<section id="agents"><h2>Agents</h2>${agents}</section>
</body></html>`;
}
