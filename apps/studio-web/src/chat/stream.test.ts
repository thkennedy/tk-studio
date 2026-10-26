// Story 32.7: the chat stream — `event: chat` lines after `since`, a duplicate seq ignored, the watchdog on 15 s of
// silence and on `visibilitychange` to visible (the iPad) reopening after the last seq, the capped backoff after the
// browser gives up, and close() clearing everything. The EventSource, the visibility and the timers are fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSourceLike, VisibilitySource } from "../live/stream";
import type { ChatLine } from "./model";
import { openChatStream, WATCHDOG_MS, type ChatStreamStatus } from "./stream";

type Fn = (ev: MessageEvent) => void;

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  listeners = new Map<string, Set<Fn>>();
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
  connect() {
    this.readyState = 1;
    for (const fn of [...(this.listeners.get("open") ?? [])]) fn({} as MessageEvent);
  }
  emit(line: unknown) {
    if (this.readyState === 0) this.connect();
    const ev = { data: typeof line === "string" ? line : JSON.stringify(line), lastEventId: String((line as ChatLine).seq ?? "") } as MessageEvent;
    for (const fn of [...(this.listeners.get("chat") ?? [])]) fn(ev);
  }
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

const line = (seq: number, author: "owner" | "planner" = "planner"): ChatLine => ({ seq, at: "t", author, body: `line ${seq}` });

let vis: FakeVisibility;
let got: ChatLine[];
let statuses: ChatStreamStatus[];
const latest = () => FakeEventSource.instances.at(-1)!;
const open = () => FakeEventSource.instances.filter((s) => !s.closed);
const start = (since = 0) =>
  openChatStream({ project: "p", id: "ENG-001", since, onLine: (l) => got.push(l), onStatus: (s) => statuses.push(s) }, { EventSource: FakeEventSource, visibility: vis });

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vis = new FakeVisibility();
  got = [];
  statuses = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the chat stream", () => {
  it("opens one source on /chat/{id}?project=&since= and delivers each new line once", () => {
    const s = start(3);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().url).toBe("/chat/ENG-001?project=p&since=3");
    expect(statuses).toEqual(["connecting"]);
    latest().emit(line(3)); // at or below since: already shown
    latest().emit(line(4, "owner"));
    latest().emit(line(5));
    latest().emit(line(5)); // a duplicate seq
    latest().emit("{not json");
    latest().emit({ seq: 6, author: "robot", body: "x" });
    expect(got.map((l) => l.seq)).toEqual([4, 5]);
    expect(s.lastSeq()).toBe(5);
    expect(statuses).toEqual(["connecting", "live"]);
  });

  it("opens from the start with no since", () => {
    start();
    expect(latest().url).toBe("/chat/ENG-001?project=p");
  });

  it("15 s of silence reopens after the last seq; a line re-arms the watchdog", () => {
    start(1);
    const first = latest();
    first.emit(line(2));
    vi.advanceTimersByTime(WATCHDOG_MS - 1);
    first.emit(line(3));
    vi.advanceTimersByTime(WATCHDOG_MS - 1);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
    expect(first.listenerCount()).toBe(0);
    expect(open()).toEqual([latest()]);
    expect(latest().url).toBe("/chat/ENG-001?project=p&since=3");
    expect(statuses).toEqual(["connecting", "live"]); // a silence reopen never shows reconnecting
    latest().emit(line(3)); // the overlap of a replay
    latest().emit(line(4));
    expect(got.map((l) => l.seq)).toEqual([2, 3, 4]);
    expect(statuses.at(-1)).toBe("live");
  });

  it("reopens when the tab returns to visible (the iPad), not when hidden", () => {
    start();
    latest().emit(line(1));
    vis.set("hidden");
    expect(FakeEventSource.instances).toHaveLength(1);
    vis.set("visible");
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(open()).toHaveLength(1);
    expect(latest().url).toBe("/chat/ENG-001?project=p&since=1");
    expect(statuses).toEqual(["connecting", "live"]);
  });

  it("a quiet conversation's repeated watchdog reopens keep the status live; an error then reads reconnecting", () => {
    start();
    latest().connect();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(WATCHDOG_MS);
      latest().connect();
    }
    expect(FakeEventSource.instances).toHaveLength(4);
    expect(statuses).toEqual(["connecting", "live"]);
    latest().fail(2);
    expect(statuses.at(-1)).toBe("reconnecting");
  });

  it("the browser's own retry (CONNECTING) keeps the source; a give-up (CLOSED) backs off 1 s doubling to 30 s, reset by an open", () => {
    start();
    latest().emit(line(1));
    latest().fail(0);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(statuses.at(-1)).toBe("reconnecting");
    latest().connect();
    expect(statuses.at(-1)).toBe("live");
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const n = FakeEventSource.instances.length;
      latest().fail(2);
      let waited = 0;
      while (FakeEventSource.instances.length === n) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
      expect(open()).toHaveLength(1);
      expect(latest().url).toBe("/chat/ENG-001?project=p&since=1");
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    latest().connect();
    const n = FakeEventSource.instances.length;
    latest().fail(2);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(n + 1);
  });

  it("close() closes the source and clears every timer and listener", () => {
    const s = start();
    const es = latest();
    es.emit(line(1));
    s.close();
    expect(es.closed).toBe(true);
    expect(es.listenerCount()).toBe(0);
    expect(vis.fns.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(WATCHDOG_MS * 4);
    vis.set("visible");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("close() during a backoff cancels the retry", () => {
    const s = start();
    latest().fail(2);
    s.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
