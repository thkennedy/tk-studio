// The Inbox screen's rules (Story 31.6, design spec §6.9 item 2): pure functions vitest drives in
// `environment: "node"`. No DOM: `fetch` and the clock are injected. The composition is `InboxScreen.tsx`.
// The screen reads only `GET /inbox?project=<id>` per served project (plus the `/agents` project list the Office
// already reads): the open items, in the order served within each project, the projects in `projectsFrom` order.
import type { LiveState } from "../live/store";
import { refetchKey as boardRefetchKey } from "../board/model";
import { NONE } from "../office/model";

// ------------------------------------------------------------ the answer (mirrored from apps/supervisor, 0.1.26)

export interface ReasonComment { id: string; body: string; created: string | null }
export interface InboxItem {
  issue: string;
  entity?: string | null;
  title?: string | null;
  priority: string | null;
  blocked_since: string | null;
  reason_comment: ReasonComment | null;
  state: string;
}
export interface InboxAnswer { ok: true; project: string; generated_at: string | null; items: InboxItem[] }

// ------------------------------------------------------------ the read

/** Absolute: the page carries `<base href="/app/">`. */
export const INBOX_URL = "/inbox";
export const inboxUrl = (project: string): string => `${INBOX_URL}?project=${encodeURIComponent(project)}`;

/** The fetch seam: the answer's headers are read too (a cookie session's `X-CSRF-Token`). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>; headers?: { get(name: string): string | null };
}>;
export type InboxResult = { ok: true; inbox: InboxAnswer; csrf: string | null } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The supervisor's named `error` of a non-200 answer, as ` <error>` (empty when it sent none). */
export async function namedError(res: { json(): Promise<unknown> }): Promise<string> {
  try {
    const body = await res.json();
    return isObj(body) && typeof body.error === "string" ? ` ${body.error}` : "";
  } catch {
    return "";
  }
}

export const csrfOf = (res: { headers?: { get(name: string): string | null } }): string | null => {
  try {
    return res.headers?.get("x-csrf-token") || null;
  } catch {
    return null;
  }
};

/** `GET /inbox?project=<id>` on this origin with the session cookie. Never throws: a non-200 (naming the
 * supervisor's `error`), a network error or a malformed body is `{ok:false, error}`. */
export async function fetchInbox(project: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<InboxResult> {
  const url = inboxUrl(project);
  try {
    const res = await fetchFn(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, error: `${url} answered ${res.status}${await namedError(res)}` };
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !Array.isArray(body.items)) return { ok: false, error: `${url}: no inbox in the answer` };
    const items = (body.items as unknown[]).filter((i): i is InboxItem => isObj(i) && typeof i.issue === "string" && typeof i.state === "string");
    return {
      ok: true,
      inbox: { ok: true, project: typeof body.project === "string" ? body.project : project, generated_at: typeof body.generated_at === "string" ? body.generated_at : null, items },
      csrf: csrfOf(res),
    };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------ the rows

export interface InboxRow {
  project: string;
  key: string;
  title: string;
  priority: string;
  /** now − `blocked_since`, as `5m` / `3h` / `2d` (`—` when unknown). */
  waited: string;
  /** The first line of the reason comment's body, its Jira mentions removed (`—` when none). */
  reason: string;
}

/** A duration in ms as `Nm` (under an hour), `Nh` (under a day) or `Nd`; negative counts as 0. */
export function waitedText(blockedSince: string | null | undefined, now: number): string {
  const at = typeof blockedSince === "string" ? Date.parse(blockedSince.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
  if (Number.isNaN(at)) return NONE;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The first non-empty line of a body, trimmed; `—` when none. */
export function firstLine(body: string | null | undefined): string {
  const line = (body ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "");
  return line ?? NONE;
}

/** A Jira user mention (`[~accountid:…]`, or the older `[~name]`) with the spaces around it. */
const MENTION_RE = /[ \t]*\[~(?:accountid:)?[^\]\s]+\][ \t]*/g;

/** A row's reason: the body's first non-empty line once its Jira mentions are removed (the block comment opens with
 * `[~accountid:<owner>]`); `—` when nothing remains. Plain text reads as `firstLine`. */
export function reasonLine(body: string | null | undefined): string {
  return firstLine((body ?? "").replace(MENTION_RE, " "));
}

const text = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : NONE);

/** The rows: per answer (in the order given: `projectsFrom`), its `open` items in the order served. */
export function inboxRows(answers: readonly Pick<InboxAnswer, "project" | "items">[], now: number): InboxRow[] {
  return answers.flatMap((a) => a.items.filter((i) => i.state === "open").map((i) => ({
    project: a.project,
    key: i.issue,
    title: text(i.title),
    priority: text(i.priority),
    waited: waitedText(i.blocked_since, now),
    reason: reasonLine(i.reason_comment?.body),
  })));
}

export const LOADING_TEXT = "Loading…";
export const EMPTY_TEXT = "Nothing needs you.";
/** The screen's notice line: "Loading…" until the first load has finished (every project's inbox read answered, or
 * `/agents` failed), then "Nothing needs you." for no rows and no errors, else none. */
export function inboxNotice(loaded: boolean, rows: readonly InboxRow[], errors: readonly string[]): typeof LOADING_TEXT | typeof EMPTY_TEXT | null {
  if (!loaded) return LOADING_TEXT;
  return rows.length === 0 && errors.length === 0 ? EMPTY_TEXT : null;
}

/** The nav item's count: the row count, null for an empty inbox (no count shown). */
export const navCount = (rows: readonly InboxRow[]): number | null => (rows.length ? rows.length : null);

/** Every served project's inbox, in order. Never throws: a project whose read fails is named in `errors` and adds no
 * row. */
export async function fetchInboxRows(projects: readonly string[], now: number, fetchFn?: FetchLike): Promise<{ rows: InboxRow[]; errors: string[] }> {
  const results = await Promise.all(projects.map((p) => fetchInbox(p, fetchFn)));
  const answers: InboxAnswer[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.ok) answers.push(r.inbox);
    else errors.push(r.error);
  }
  return { rows: inboxRows(answers, now), errors };
}

// ------------------------------------------------------------ the refetch

/** What the inbox refetches on, as the Board does: each project's runs and `last_run` in the store (the Board's
 * `refetchKey`), plus the agents' `blocked_issue` (the office's "!" moves when the inbox file changes). */
export function inboxRefetchKey(state: LiveState, projects: readonly string[]): string {
  const agents = (state.view?.agents ?? []).map((a) => `${a.agent_id}:${a.blocked_issue?.issue ?? ""}:${a.blocked_issue?.state ?? ""}`);
  return JSON.stringify([projects.map((p) => boardRefetchKey(state, p)), agents]);
}
