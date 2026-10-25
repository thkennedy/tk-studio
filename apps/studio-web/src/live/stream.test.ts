import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOfficeStore, type OfficeStore } from "./store";
import { openOfficeStream, WATCHDOG_MS, type EventSourceLike, type VisibilitySource } from "./stream";

type Fn = (ev: MessageEvent) => void;

/** A fake EventSource: records each instance, its URL and close(), and dispatches named events. */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  listeners = new Map<string, Set<Fn>>();
  lastEventId = "";
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Fn) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  /** The connection opens (first connect, or the browser's own reconnect after `fail(0)`). */
  connect() {
    this.readyState = 1;
    for (const fn of [...(this.listeners.get("open") ?? [])]) fn({} as MessageEvent);
  }
  /** A frame `id:<id>\nevent:<kind>\ndata:<json>`; a still-connecting source opens first. */
  emit(kind: string, id: string, data: unknown) {
    if (this.readyState === 0) this.connect();
    this.lastEventId = id;
    const ev = { data: typeof data === "string" ? data : JSON.stringify(data), lastEventId: id } as MessageEvent;
    for (const fn of [...(this.listeners.get(kind) ?? [])]) fn(ev);
  }
  /** A dropped connection: CONNECTING is the browser's own retry, CLOSED is the browser giving up. */
  fail(readyState: 0 | 2) {
    this.readyState = readyState;
    for (const fn of [...(this.listeners.get("error") ?? [])]) fn({} as MessageEvent);
  }
  listenerCount() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

class FakeVisibility implements VisibilitySource {
  visibilityState = "visible";
  fns = new Set<() => void>();
  addEventListener(_t: "visibilitychange", fn: () => void) {
    this.fns.add(fn);
  }
  removeEventListener(_t: "visibilitychange", fn: () => void) {
    this.fns.delete(fn);
  }
  set(state: string) {
    this.visibilityState = state;
    for (const fn of [...this.fns]) fn();
  }
}

const snap = (id: string) => ({
  at: "t",
  agents: [{ agent_id: "p/dev", project: "p", role: "dev", state: "idle", current_run: null, current_story: null }],
  runs: [{ run_id: "r1", project: "p", state: "running", engine_run_id: "e1", epic: { spec_folder: null, done: 0, deferred: 0, failed: 0, total: 3, current_story: null }, stories: [] }],
  problems: [],
  id,
});
const agent = (state: string) => ({ agent_id: "p/dev", state, from: "idle", at: "t", current_run: "r1", current_story: null });

let store: OfficeStore;
let vis: FakeVisibility;
const latest = () => FakeEventSource.instances.at(-1)!;
const open = () => FakeEventSource.instances.filter((s) => !s.closed);
const start = () => openOfficeStream(store, { EventSource: FakeEventSource, visibility: vis });

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  store = createOfficeStore();
  vis = new FakeVisibility();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the office stream", () => {
  it("opens one EventSource on the absolute /office/events and applies the snapshot then deltas", () => {
    start();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().url).toBe("/office/events");
    expect(store.getState().status).toBe("connecting");
    latest().emit("snapshot", "b-5", snap("b-5"));
    latest().emit("office.agent", "b-6", agent("typing"));
    latest().emit("office.progress", "b-7", { run_id: "r1", epic: { spec_folder: null, done: 1, deferred: 0, failed: 0, total: 3, current_story: null } });
    latest().emit("office.run", "b-8", { run_id: "r1", project: "p", state: "paused", from: "running" });
    const s = store.getState();
    expect(s.status).toBe("live");
    expect(s.lastId).toBe("b-8");
    expect(s.view?.agents[0].state).toBe("typing");
    expect(s.view?.runs[0].epic.done).toBe(1);
    expect(s.view?.runs[0].state).toBe("paused");
  });

  it("Story 32.7: listens for office.engagement deltas", () => {
    start();
    latest().emit("snapshot", "b-5", { ...snap("b-5"), engagements: [{ id: "ENG-001", project: "p", state: "intake", title: "t", needs_you: false }] });
    latest().emit("office.engagement", "b-6", { id: "ENG-001", project: "p", state: "quoted", from: "scoping", title: "t", needs_you: true });
    expect(store.getState().view?.engagements).toEqual([{ id: "ENG-001", project: "p", state: "quoted", title: "t", needs_you: true }]);
    expect(store.getState().lastId).toBe("b-6");
  });

  it("fills a gap by the browser's resume: reconnecting, then the replay applies, the overlap ignored", () => {
    start();
    const es = latest();
    es.emit("snapshot", "b-5", snap("b-5"));
    es.emit("office.agent", "b-6", agent("typing"));
    es.fail(0); // the drop: the browser retries on the same object, resending Last-Event-ID b-6
    expect(store.getState().status).toBe("reconnecting");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.closed).toBe(false);
    es.connect(); // the browser's reconnect opens before the replay
    const applied = vi.fn();
    store.subscribe(applied);
    es.emit("office.agent", "b-6", agent("blocked")); // the overlapping duplicate
    expect(applied).not.toHaveBeenCalled();
    expect(store.getState().view?.agents[0].state).toBe("typing");
    es.emit("office.agent", "b-7", agent("reading"));
    es.emit("office.agent", "b-8", agent("running"));
    es.emit("office.agent", "b-9", agent("waiting-for-human"));
    const s = store.getState();
    expect(s.lastId).toBe("b-9");
    expect(s.status).toBe("live");
    expect(s.view?.agents[0].state).toBe("waiting-for-human");
  });

  it("goes live on the browser's own reconnect with no replay (a quiet office), the view intact", () => {
    start();
    const es = latest();
    es.connect();
    expect(store.getState().status).toBe("connecting"); // a fresh source's first open is not live
    es.emit("snapshot", "b-5", snap("b-5"));
    const view = store.getState().view;
    es.fail(0); // the drop: the browser retries on the same object
    expect(store.getState().status).toBe("reconnecting");
    es.connect(); // resumed with Last-Event-ID b-5; the supervisor has nothing to replay
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(store.getState().status).toBe("live");
    expect(store.getState().view).toBe(view);
    expect(store.getState().lastId).toBe("b-5");
  });

  it("keeps a watchdog reopen's first open reconnecting until the snapshot", () => {
    start();
    latest().emit("snapshot", "b-5", snap("b-5"));
    const view = store.getState().view;
    vi.advanceTimersByTime(WATCHDOG_MS);
    expect(FakeEventSource.instances).toHaveLength(2);
    latest().connect();
    expect(store.getState().status).toBe("reconnecting");
    expect(store.getState().view).toBe(view);
    latest().emit("snapshot", "b-6", snap("b-6"));
    expect(store.getState().status).toBe("live");
  });

  it("reopens after 15 s with no event, reconnecting with the view intact until the snapshot", () => {
    start();
    const first = latest();
    first.emit("snapshot", "b-5", snap("b-5"));
    vi.advanceTimersByTime(WATCHDOG_MS - 1);
    first.emit("office.agent", "b-6", agent("typing")); // an event re-arms the watchdog
    vi.advanceTimersByTime(WATCHDOG_MS - 1);
    expect(FakeEventSource.instances).toHaveLength(1);
    const view = store.getState().view;
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
    expect(first.listenerCount()).toBe(0);
    expect(open()).toEqual([latest()]);
    expect(latest().url).toBe("/office/events");
    expect(store.getState().status).toBe("reconnecting");
    expect(store.getState().view).toBe(view);
    expect(store.getState().lastId).toBe("b-6");
    latest().emit("snapshot", "b-7", snap("b-7"));
    expect(store.getState().status).toBe("live");
    expect(store.getState().lastId).toBe("b-7");
  });

  it("reopens when the tab returns to visible, not when it is hidden", () => {
    start();
    latest().emit("snapshot", "b-5", snap("b-5"));
    const view = store.getState().view;
    vis.set("hidden");
    expect(FakeEventSource.instances).toHaveLength(1);
    vis.set("visible");
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(open()).toHaveLength(1);
    expect(store.getState().status).toBe("reconnecting");
    expect(store.getState().view).toBe(view);
    latest().emit("snapshot", "b-9", snap("b-9"));
    expect(store.getState().status).toBe("live");
  });

  it("keeps one open source at a time across repeated reopens", () => {
    start();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(WATCHDOG_MS);
      vis.set("visible");
    }
    expect(FakeEventSource.instances).toHaveLength(11);
    expect(open()).toHaveLength(1);
  });

  it("backs off after the browser gives up (CLOSED): 1 s doubling to 30 s, reset by a snapshot", () => {
    start();
    latest().emit("snapshot", "b-5", snap("b-5"));
    const view = store.getState().view;
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = FakeEventSource.instances.length;
      latest().fail(2);
      expect(store.getState().status).toBe("reconnecting");
      expect(store.getState().view).toBe(view);
      let waited = 0;
      while (FakeEventSource.instances.length === n) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
      expect(open()).toHaveLength(1);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    latest().emit("snapshot", "b-6", snap("b-6"));
    const n = FakeEventSource.instances.length;
    latest().fail(2);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(n + 1);
  });

  it("ignores bad JSON without throwing", () => {
    start();
    latest().emit("snapshot", "b-5", snap("b-5"));
    expect(() => latest().emit("office.agent", "b-6", "{not json")).not.toThrow();
    expect(store.getState().lastId).toBe("b-5");
  });

  it("close() closes the source and clears every timer and listener", () => {
    const stream = start();
    const es = latest();
    es.emit("snapshot", "b-5", snap("b-5"));
    stream.close();
    expect(es.closed).toBe(true);
    expect(es.listenerCount()).toBe(0);
    expect(vis.fns.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(WATCHDOG_MS * 4);
    vis.set("visible");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("close() during a backoff cancels the retry", () => {
    const stream = start();
    latest().fail(2);
    stream.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
