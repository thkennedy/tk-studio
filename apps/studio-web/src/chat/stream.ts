// The chat stream (Story 32.7): one EventSource on the supervisor's `GET /chat/{id}?project=<id>` (frames
// `id: <seq>` / `event: chat` / data = the line), with the office stream's watchdog pattern (`live/stream.ts`): 15 s
// of silence, or the tab returning to visible (the iPad), closes and reopens it; a browser that gives up is retried
// after a capped backoff of 1–30 s. The browser's own reconnect resends `Last-Event-ID` (the last seq); a reopen of
// ours cannot set that header on a fresh EventSource, so it asks `?since=<last seq>`, which the route reads the same
// way. A line at or below the last seq (a replay's overlap) is ignored. The DOM pieces are injectable.
import { BACKOFF_MAX_MS, BACKOFF_MIN_MS, WATCHDOG_MS, type EventSourceCtor, type EventSourceLike, type VisibilitySource } from "../live/stream";
import { chatUrl, type ChatLine } from "./model";

export { WATCHDOG_MS };

const CONNECTING = 0;
const CLOSED = 2;

export type ChatStreamStatus = "connecting" | "live" | "reconnecting";

export interface ChatStreamDeps {
  EventSource?: EventSourceCtor;
  visibility?: VisibilitySource | null;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface ChatStreamOptions {
  project: string;
  id: string;
  /** The last seq already shown (the `GET /chat/{id}` read's `last_seq`): the stream replays only after it. */
  since: number;
  onLine: (line: ChatLine) => void;
  onStatus?: (status: ChatStreamStatus) => void;
}

export interface ChatStream {
  /** The last seq delivered. */
  lastSeq(): number;
  close(): void;
}

const isLine = (v: unknown): v is ChatLine => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.seq === "number" && Number.isSafeInteger(o.seq) && (o.author === "owner" || o.author === "planner") && typeof o.body === "string";
};

export function openChatStream(opts: ChatStreamOptions, deps: ChatStreamDeps = {}): ChatStream {
  const EventSource = deps.EventSource ?? (globalThis as { EventSource?: EventSourceCtor }).EventSource;
  const visibility =
    deps.visibility !== undefined
      ? deps.visibility
      : typeof document !== "undefined"
        ? (document as unknown as VisibilitySource)
        : null;
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));

  let source: EventSourceLike | null = null;
  let watchdog: unknown;
  let retry: unknown;
  let backoff = BACKOFF_MIN_MS;
  let closed = false;
  let last = Math.max(0, Math.floor(opts.since) || 0);
  let status: ChatStreamStatus | null = null;

  const setStatus = (s: ChatStreamStatus) => {
    if (status === s) return;
    status = s;
    opts.onStatus?.(s);
  };
  const clearWatchdog = () => {
    if (watchdog !== undefined) clearT(watchdog);
    watchdog = undefined;
  };
  const clearRetry = () => {
    if (retry !== undefined) clearT(retry);
    retry = undefined;
  };
  const armWatchdog = () => {
    clearWatchdog();
    watchdog = setT(fire, WATCHDOG_MS);
  };

  const onChat = (ev: MessageEvent) => {
    armWatchdog();
    setStatus("live");
    let data: unknown;
    try {
      data = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!isLine(data) || data.seq <= last) return; // a duplicate seq (the replay's overlap) is ignored
    last = data.seq;
    opts.onLine(data);
  };
  const onOpen = () => {
    if (closed || !source) return;
    backoff = BACKOFF_MIN_MS;
    setStatus("live");
  };
  const onError = () => {
    if (closed || !source) return;
    setStatus("reconnecting");
    if (source.readyState === CONNECTING) return; // the browser's own retry resends Last-Event-ID
    if (source.readyState !== CLOSED) return;
    detach();
    clearWatchdog();
    clearRetry();
    const wait = backoff;
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    retry = setT(() => {
      retry = undefined;
      if (!closed) open();
    }, wait);
  };

  function detach() {
    if (!source) return;
    const old = source;
    source = null;
    old.removeEventListener("chat", onChat);
    old.removeEventListener("error", onError);
    old.removeEventListener("open", onOpen);
    old.close();
  }

  function open() {
    detach(); // the old source is closed before the new one opens
    if (!EventSource) {
      setStatus("reconnecting");
      return;
    }
    const es = new EventSource(chatUrl(opts.project, opts.id, last));
    source = es;
    es.addEventListener("chat", onChat);
    es.addEventListener("error", onError);
    es.addEventListener("open", onOpen);
    armWatchdog();
  }

  /** The watchdog: close and reopen after the last seq. The server's `: heartbeat` is a comment the EventSource never
   * surfaces, so a quiet conversation reopens every 15 s: that reopen keeps the status shown (no "reconnecting"
   * flicker); only an error or a backoff reads as reconnecting. */
  function fire() {
    clearWatchdog();
    if (closed) return;
    clearRetry();
    open();
  }

  const onVisibility = () => {
    if (visibility?.visibilityState === "visible") fire();
  };

  visibility?.addEventListener("visibilitychange", onVisibility);
  setStatus("connecting");
  open();

  return {
    lastSeq: () => last,
    close() {
      if (closed) return;
      closed = true;
      clearWatchdog();
      clearRetry();
      visibility?.removeEventListener("visibilitychange", onVisibility);
      detach();
    },
  };
}
