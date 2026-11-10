// The story page's rules (Story 39.4, addendum §3.1.7, `/app/story/<id>`): pure functions vitest drives in
// `environment: "node"`. No DOM: `fetch` is injected. The composition is `StoryScreen.tsx`. The page reads only
// `GET /stories/{id}?project=<id>` (and the `/agents` project list when the address names no project). Every link is an
// in-app path for the router (`/app/run/<id>`, `/app/inbox/<KEY>`) or an `http(s)` target (`safeHref`); the plan text is
// shown as text, never as HTML.
import type { FetchLike } from "../inbox/model";
import { safeHref } from "../office/model";

// ------------------------------------------------------------ the answer (mirrored from apps/supervisor/src/stories.ts)

export interface StageLogRow {
  spec: string; stage: string | null; pass: string | null; started: string | null; ended: string | null; session_id: string | null;
  model: string | null; effort: string | null; tokens_in: number | null; tokens_out: number | null; cost_usd: number | null;
  outcome: string | null; buffered: boolean; posted: boolean | null;
}
export interface StageLogTotal { rows: number; priced: number; tokens_in: number | null; tokens_out: number | null; cost_usd: number | null; seconds: number }
export interface StoryView {
  id: string; key: string | null; title: string; status: string; parent: string | null;
  epic: { id: string; number: string | null; title: string } | null; band: "S" | "M" | "L" | null;
  jira_key: string | null; jira_url: string | null; updated: string | null;
}
export interface StoryRun {
  run_id: string; studio_run_id: string | null; job_id: string; state: string; pr: string | null;
  host_verify: string | null; created: string; ended_at: string | null; cost_usd: number | null;
}
export interface StoryAnswer {
  ok: true; project: string; built_at: string; story: StoryView; plan_text: string;
  stage_log: { specs: string[]; rows: StageLogRow[]; total: StageLogTotal };
  runs: StoryRun[]; pr: string | null; findings: { id: string; title: string; severity: string | null }[];
  needs_you: { run_ids: string[]; inbox: Record<string, unknown> | null } | null;
}

export const LOADING_STORY = "Loading the story…";
/** No `?project=` and `GET /agents` serves no project to remember. */
export const NO_PROJECT_STORY = "No project: open the story from the board";

// ------------------------------------------------------------ the read

/** Absolute: the page carries `<base href="/app/">`. */
export const storyUrl = (project: string, id: string): string => `/stories/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`;

export type StoryResult = { ok: true; story: StoryAnswer } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isStoryShape = (b: Record<string, unknown>): boolean =>
  b.ok === true && isObj(b.story) && typeof b.story.id === "string" && typeof b.plan_text === "string"
  && isObj(b.stage_log) && Array.isArray(b.stage_log.rows) && isObj(b.stage_log.total)
  && Array.isArray(b.runs) && Array.isArray(b.findings);

/** `GET /stories/{id}?project=<id>` with the session cookie. Never throws: a refusal reads `<error>: <detail>` (the
 * supervisor's), else `<url> answered <status>`; a network error or a malformed body names itself. */
export async function fetchStory(project: string, id: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<StoryResult> {
  const url = storyUrl(project, id);
  try {
    const res = await fetchFn(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      if (isObj(body) && typeof body.error === "string") {
        const detail = typeof body.detail === "string" ? body.detail : typeof body.story === "string" ? body.story : null;
        return { ok: false, error: detail ? `${body.error}: ${detail}` : body.error };
      }
      return { ok: false, error: `${url} answered ${res.status}` };
    }
    if (!isObj(body) || !isStoryShape(body)) return { ok: false, error: `${url}: no story in the answer` };
    return { ok: true, story: body as unknown as StoryAnswer };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------ the view

const num = (n: number): string => n.toLocaleString("en-US");
const usd4 = (n: number): string => `$${n.toFixed(4)}`;
const usd2 = (n: number): string => `$${n.toFixed(2)}`;
const prNumber = (url: string | null): string | null => (url ? /\/pull\/(\d+)/.exec(url)?.[1] ?? null : null);

/** A span in seconds: `41m 39s`, `2h 3m 4s`, `30s`. */
export function spanText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

export interface Link { text: string; href: string | null }
export interface StoryHeader {
  badge: { text: string; title: string } | null;
  heading: string;
  title: string;
  status: string;
  band: string;
  jira: Link;
  pr: Link;
}

/** The header: the epic badge, `N.M · ST-NNN`, the title, the status, the band, the Jira key (a link to `jira_url`, plain
 * text without one) and the PR link. */
export function storyView(a: StoryAnswer): StoryHeader {
  const s = a.story;
  const n = prNumber(a.pr);
  return {
    badge: s.epic ? { text: s.epic.id, title: s.epic.title } : null,
    heading: s.key ? `${s.key} · ${s.id}` : s.id,
    title: s.title,
    status: s.status,
    band: s.band ? `band ${s.band}` : "no band",
    jira: s.jira_key ? { text: s.jira_key, href: safeHref(s.jira_url) } : { text: "no Jira key", href: null },
    pr: a.pr ? { text: n ? `PR #${n}` : "PR", href: safeHref(a.pr) } : { text: "no PR", href: null },
  };
}

export interface StageRowText { stage: string; started: string; span: string; model: string; tokens: string; cost: string; outcome: string; posted: string }

const localTime = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
};

/** One Stage Log row as shown (`local` formats the started stamp; default the browser's locale). */
export function stageRowText(r: StageLogRow, local: (iso: string) => string = localTime): StageRowText {
  const a = r.started ? Date.parse(r.started) : NaN, b = r.ended ? Date.parse(r.ended) : NaN;
  return {
    stage: r.pass ? `${r.stage ?? "?"} ${r.pass}` : r.stage ?? "?",
    started: r.started ? local(r.started) : "",
    span: r.ended === null ? "running" : Number.isNaN(a) || Number.isNaN(b) ? "" : spanText((b - a) / 1000),
    model: r.model ? (r.effort ? `${r.model} ${r.effort}` : r.model) : "host",
    tokens: r.tokens_in === null && r.tokens_out === null ? "none" : `${num(r.tokens_in ?? 0)} in / ${num(r.tokens_out ?? 0)} out`,
    cost: r.cost_usd === null ? "none" : usd4(r.cost_usd),
    outcome: r.outcome ?? "",
    posted: r.posted === true ? "posted to Jira" : r.posted === false ? "not posted" : "",
  };
}

/** The total line under the table. */
export function totalLine(t: StageLogTotal): string {
  if (t.priced === 0 || t.cost_usd === null) return `Total: no priced rows yet (${t.rows} rows)`;
  return `Total: ${usd2(t.cost_usd)} over ${t.priced} priced of ${t.rows} rows · ${num(t.tokens_in ?? 0)} in / ${num(t.tokens_out ?? 0)} out · ${spanText(t.seconds)}`;
}

/** The "Needs you" strip: the inbox item (`<issue> <title> (<state>)` → `/app/inbox/<issue>?project=`), else the first
 * waiting run (`run <id> waits on you` → `/app/run/<id>`); null when the story does not need the owner. */
export function needsYouStrip(a: StoryAnswer): { text: string; path: string } | null {
  const n = a.needs_you;
  if (!n) return null;
  const item = n.inbox;
  if (item && typeof item.issue === "string") {
    const title = typeof item.title === "string" && item.title ? ` ${item.title}` : "";
    const state = typeof item.state === "string" ? item.state : "open";
    return { text: `${item.issue}${title} (${state})`, path: `/app/inbox/${encodeURIComponent(item.issue)}?project=${encodeURIComponent(a.project)}` };
  }
  const run = n.run_ids[0];
  return run ? { text: `run ${run} waits on you`, path: runPath(run) } : null;
}

export const runPath = (id: string): string => `/app/run/${encodeURIComponent(id)}`;

/** One run line: `run <id> · <state> · <cost> · PR`, its path and its PR link. */
export function runLine(r: StoryRun): { text: string; path: string; pr: Link } {
  const cost = r.cost_usd === null ? "unmetered" : usd2(r.cost_usd);
  const n = prNumber(r.pr);
  return { text: `run ${r.run_id} · ${r.state} · ${cost}`, path: runPath(r.run_id), pr: r.pr ? { text: n ? `PR #${n}` : "PR", href: safeHref(r.pr) } : { text: "no PR", href: null } };
}

export const findingText = (f: { id: string; title: string; severity: string | null }): string => `${f.id} ${f.title}${f.severity ? ` (${f.severity})` : ""}`;

/** `?project=` of the address, trimmed (the supervisor trims it, and `story.project` is the trimmed id), else null. */
export function projectOfSearch(search: string): string | null {
  try {
    const p = new URLSearchParams(search).get("project")?.trim();
    return p ? p : null;
  } catch {
    return null;
  }
}
