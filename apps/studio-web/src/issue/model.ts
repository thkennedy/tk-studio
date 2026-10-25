// The Issue screen's rules (Story 31.6, design spec §6.9 items 3 and 4): pure functions vitest drives in
// `environment: "node"`. No DOM: `fetch` and `localStorage` are injected. The composition is `IssueScreen.tsx`.
// The screen reads `GET /inbox?project=<id>&issue=<KEY>` and posts `POST /inbox/{key}/reply` — the supervisor's two
// inbox surfaces, nothing else. The reply carries the CSRF token the read's `X-CSRF-Token` header gave.
import { csrfOf, namedError, type FetchLike, type InboxItem } from "../inbox/model";
import { NONE, safeHref, type StorageLike } from "../office/model";

// ------------------------------------------------------------ the answer (mirrored from apps/supervisor/src/inbox.ts)

export interface IssueComment { id: string; author: string | null; update_author?: string | null; body: string; created: string | null; updated: string | null }
export interface IssueRun { run_id: string; state: string; pr: string | null; host_verify: string | null; ended_at: string | null }
export interface IssueAnswer {
  ok: true;
  project: string;
  generated_at: string | null;
  items: InboxItem[];
  issue: { key: string; entity: string | null; title: string | null; status: string | null; run: IssueRun | null; cost_usd: number | null; comments: IssueComment[] };
}

// ------------------------------------------------------------ the remembered issue

export const ISSUE_KEY = "tk-studio.web.issue";
export interface IssueRef { project: string; key: string }
export const CHOOSE_TEXT = "Choose an item in the Inbox";

const defaultStorage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The stored `(project, key)`, else null (absent, malformed, or a storage that throws). */
export function rememberedIssue(storage: StorageLike | null = defaultStorage()): IssueRef | null {
  try {
    const raw = storage?.getItem(ISSUE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isObj(v) && typeof v.project === "string" && v.project && typeof v.key === "string" && v.key ? { project: v.project, key: v.key } : null;
  } catch {
    return null;
  }
}

/** Stores the choice; a storage that throws is ignored. */
export function rememberIssue(ref: IssueRef, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(ISSUE_KEY, JSON.stringify({ project: ref.project, key: ref.key }));
  } catch {
    /* in memory only */
  }
}

// ------------------------------------------------------------ the read

export const issueUrl = (project: string, key: string): string =>
  `/inbox?project=${encodeURIComponent(project)}&issue=${encodeURIComponent(key)}`;
export type IssueResult = { ok: true; answer: IssueAnswer; csrf: string | null } | { ok: false; error: string };

/** `GET /inbox?project=<id>&issue=<KEY>` on this origin with the session cookie. Never throws. */
export async function fetchIssue(project: string, key: string, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<IssueResult> {
  const url = issueUrl(project, key);
  try {
    const res = await fetchFn(url, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, error: `${url} answered ${res.status}${await namedError(res)}` };
    const body = await res.json();
    if (!isObj(body) || body.ok !== true || !isObj(body.issue) || !Array.isArray(body.issue.comments) || !Array.isArray(body.items)) {
      return { ok: false, error: `${url}: no issue in the answer` };
    }
    return { ok: true, answer: body as unknown as IssueAnswer, csrf: csrfOf(res) };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ------------------------------------------------------------ the view

export interface CommentView { id: string; author: "owner" | "agent"; time: string; body: string; edited: boolean }
export interface IssueViewModel {
  key: string;
  title: string;
  status: string;
  /** The story's latest run: its state and its PR as a link target (`safeHref`), else null ("no run"). */
  run: { run_id: string; state: string; href: string | null } | null;
  /** `$0.00`, else "not metered". */
  cost: string;
  comments: CommentView[];
}

export const NOT_METERED = "not metered";
export const costText = (usd: number | null | undefined): string =>
  typeof usd === "number" && Number.isFinite(usd) && usd >= 0 ? `$${usd.toFixed(2)}` : NOT_METERED;

/** A comment-log line is the owner's only when both its `author` and its `update_author` are (the driver contract's
 * 31.5 clause); an absent `update_author` (an older line) leaves `author` alone. Otherwise it is the agent's. */
export const commentAuthor = (c: Pick<IssueComment, "author" | "update_author">): "owner" | "agent" =>
  c.author === "owner" && (c.update_author == null || c.update_author === "owner") ? "owner" : "agent";

/** The issue Jira-like: status, run and PR, cost, and the comments in the order served with author and time. */
export function issueView(answer: IssueAnswer): IssueViewModel {
  const i = answer.issue;
  return {
    key: i.key,
    title: i.title?.trim() || NONE,
    status: i.status?.trim() || NONE,
    run: i.run ? { run_id: i.run.run_id, state: i.run.state, href: safeHref(i.run.pr) } : null,
    cost: costText(i.cost_usd),
    comments: i.comments.map((c) => ({
      id: c.id,
      author: commentAuthor(c),
      time: c.created ?? NONE,
      body: c.body,
      edited: !!c.updated && !!c.created && c.updated !== c.created,
    })),
  };
}

// ------------------------------------------------------------ the reply

export type ReplyPayload = { body: string } | { done: true };
/** A failure's `commented` is true only when the supervisor's answer says the comment landed (a `409 ReplyRefused`
 * after the comment, or a `503 ReplyRetry`): pressing again would post a duplicate. */
export type ReplyResult = { ok: true; notice: string; commented: boolean; transitioned: boolean } | { ok: false; error: string; commented: boolean };
export const SENT_NOTICE = "sent; it leaves the Inbox on the next sync-back";

/** Send is enabled only with a non-blank reply. */
export const canSend = (text: string): boolean => text.trim() !== "";

/** What the two actions are gated on: the issue's view loaded, the CSRF token its read answered, no post in flight,
 * and no reply already sent for this issue (until the issue changes). */
export interface ActionGate { loaded: boolean; csrf: string | null; sending: boolean; sent: boolean }
/** Done (and Send, with a non-blank reply) is enabled only once the view and the CSRF token are known, while nothing
 * is in flight and nothing was sent yet. */
export const canAct = (g: ActionGate): boolean => g.loaded && !!g.csrf && !g.sending && !g.sent;
export const canSendReply = (text: string, g: ActionGate): boolean => canAct(g) && canSend(text);
/** Whether a reply's outcome counts as sent for the gate: a success, or a failure whose comment already landed (the
 * error is still shown, but Send and Done stay disabled until another issue is chosen). */
export const sentAfter = (r: ReplyResult): boolean => r.ok || r.commented;

export const replyUrl = (key: string): string => `/inbox/${encodeURIComponent(key)}/reply`;

/** `POST /inbox/{key}/reply` with the CSRF header and `{project, body}` or `{project, done: true}`. Never throws: a
 * non-200 names the supervisor's `error` and carries its `commented`, a network error or a malformed answer is
 * `{ok:false, error, commented:false}`. */
export async function postReply(project: string, key: string, payload: ReplyPayload, csrf: string | null,
  fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<ReplyResult> {
  const url = replyUrl(key);
  const body = "done" in payload ? { project, done: true } : { project, body: payload.body };
  try {
    const res = await fetchFn(url, {
      method: "POST", credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let failed: unknown = null;
      try { failed = await res.json(); } catch { /* no body */ }
      const name = isObj(failed) && typeof failed.error === "string" ? ` ${failed.error}` : "";
      return { ok: false, error: `${url} answered ${res.status}${name}`, commented: isObj(failed) && failed.commented === true };
    }
    const answer = await res.json();
    if (!isObj(answer) || answer.ok !== true) return { ok: false, error: `${url}: no reply in the answer`, commented: false };
    return { ok: true, notice: SENT_NOTICE, commented: answer.commented === true, transitioned: answer.transitioned === true };
  } catch (e) {
    return { ok: false, error: `${url}: ${e instanceof Error ? e.message : String(e)}`, commented: false };
  }
}
