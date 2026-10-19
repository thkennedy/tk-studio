// The office stream (Story 30.3): the tab's one EventSource on the supervisor's `GET /office/events`,
// folded into the store, with a watchdog (15 s of silence, or the tab returning to visible) and a
// capped backoff when the browser gives up. The DOM pieces are injectable so vitest needs no browser.
import type { OfficeStore } from "./store";

/** Absolute: the page carries `<base href="/app/">`, so a relative URL would hit the SPA fallback. */
export const OFFICE_EVENTS_URL = "/office/events";
export const WATCHDOG_MS = 15_000;
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

const DELTA_KINDS = ["office.agent", "office.progress", "office.run"] as const;
const CONNECTING = 0;
const CLOSED = 2;

/** The slice of `EventSource` the stream uses. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, fn: (ev: MessageEvent) => void): void;
  removeEventListener(type: string, fn: (ev: MessageEvent) => void): void;
  close(): void;
}
export type EventSourceCtor = new (url: string) => EventSourceLike;

/** The slice of `document` the watchdog uses. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
}

export interface StreamDeps {
  EventSource?: EventSourceCtor;
  visibility?: VisibilitySource | null;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface OfficeStream {
  close(): void;
}

export function openOfficeStream(store: OfficeStore, deps: StreamDeps = {}): OfficeStream {
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
  // Per source: has it been open before, and has it delivered an event (so the browser holds a
  // Last-Event-ID to resend)? A later `open` on the same object is then the browser's own resume.
  let sourceOpened = false;
  let sourceHeard = false;

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

  const parse = (ev: MessageEvent): unknown => {
    try {
      return JSON.parse(String(ev.data));
    } catch {
      return undefined;
    }
  };

  const onSnapshot = (ev: MessageEvent) => {
    sourceHeard = true;
    armWatchdog();
    const data = parse(ev);
    if (data === undefined) return;
    store.applySnapshot(ev.lastEventId, data);
    if (store.getState().lastId === ev.lastEventId) backoff = BACKOFF_MIN_MS;
  };
  const onDelta = (kind: string) => (ev: MessageEvent) => {
    sourceHeard = true;
    armWatchdog();
    const data = parse(ev);
    if (data === undefined) return;
    store.applyDelta(ev.lastEventId, kind, data);
  };
  const deltaListeners = DELTA_KINDS.map((kind) => [kind, onDelta(kind)] as const);

  /**
   * The browser's own reconnect resends Last-Event-ID and the supervisor replays only what was
   * missed, which on a quiet office is nothing: the resumed stream is healthy, so it is live. The
   * first `open` of a fresh source (mount, watchdog, backoff) stays as-is until its snapshot.
   */
  const onOpen = () => {
    if (closed || !source) return;
    const resumed = sourceOpened && sourceHeard;
    sourceOpened = true;
    if (resumed && store.getState().lastId !== null) store.setStatus("live");
  };

  const onError = () => {
    if (closed || !source) return;
    store.setStatus("reconnecting");
    if (source.readyState === CONNECTING) return; // the browser's own retry resends Last-Event-ID
    if (source.readyState !== CLOSED) return;
    // The browser gave up (401, 503, a non-stream answer): retry ourselves after a capped backoff.
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
    old.removeEventListener("snapshot", onSnapshot);
    for (const [kind, fn] of deltaListeners) old.removeEventListener(kind, fn);
    old.removeEventListener("error", onError);
    old.removeEventListener("open", onOpen);
    old.close();
  }

  function open() {
    detach(); // the old source is closed before the new one opens
    if (!EventSource) {
      store.setStatus("reconnecting");
      return;
    }
    const es = new EventSource("/office/events"); // OFFICE_EVENTS_URL, literal for the one-source grep
    source = es;
    sourceOpened = false;
    sourceHeard = false;
    es.addEventListener("snapshot", onSnapshot);
    for (const [kind, fn] of deltaListeners) es.addEventListener(kind, fn);
    es.addEventListener("error", onError);
    es.addEventListener("open", onOpen);
    armWatchdog();
  }

  /** The watchdog: close and reopen; the store keeps its view until the new snapshot replaces it. */
  function fire() {
    clearWatchdog(); // also when fired by visibilitychange, with the timer still pending
    if (closed) return;
    clearRetry();
    store.setStatus("reconnecting");
    open();
  }

  const onVisibility = () => {
    if (visibility?.visibilityState === "visible") fire();
  };

  visibility?.addEventListener("visibilitychange", onVisibility);
  open();

  return {
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
