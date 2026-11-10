// The run page (Story 39.5, CAP-16, addendum §3.2 F-A): `/app/run/<id>` — the header (job, project, state, the story
// link), the clock against the guard that applies, the timeline (a bar of segments proportional to their spans, the
// engine's sessions under it, the host leg's suites as sub-cells), the cost per stage (else the run total), Cancel with
// its consequence first (or the ended run's final state in words), and the events with `detail` folded.
// `GET /runs/{id}` is read on mount and again when the store's row for the run changes (its state, stage or open host-verify
// `leg`: `runRowKey`), never on a
// timer and never once the run has ended; the story's Stage Log (`GET /stories/{id}`) when a `plan-status` event names
// it. A 1 s tick drives the clock only, while the run is live. The rules are `model.ts`.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fetchInbox } from "../inbox/model";
import type { OfficeStore } from "../live/store";
import {
  CANCEL_CONSEQUENCE, canCancel, costView, eventRows, fetchRun, fetchStoryStages, isTerminalState, LOADING_RUN, NO_STORY_YET, requestCancel, runClock, runRowKey, runTimeline,
  runWindow, storyIdOf, type RunAnswer, type Segment, type StageRowLike,
} from "./model";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;
const h2 = { fontSize: 14, margin: "16px 0 8px" } as const;
const muted = { color: "#999" } as const;
const TONE: Record<Segment["kind"], string> = {
  queued: "#555", launch: "#6a5acd", worker: "#6a5acd", engine: "#2f6f9f", session: "#3f8f5f", "host-leg": "#9f7f2f", "re-run": "#9f7f2f",
  "close-out": "#7f4f9f", paused: "#a05050", ended: "#ccc",
};

export function RunScreen({ store, id, onNavigate }: { store: OfficeStore; id: string; onNavigate: (path: string) => void }) {
  const live = useSyncExternalStore(store.subscribe, store.getState);
  const row = live.view?.runs.find((r) => r.run_id === id) ?? null;
  const liveStage = row?.stage ?? null;
  const rowKey = runRowKey(row);
  const [answer, setAnswer] = useState<RunAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wake, setWake] = useState(0);
  const [stages, setStages] = useState<{ story: string; rows: StageRowLike[] | null; error: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  const [cancelWords, setCancelWords] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const shown = answer && answer.run_id === id ? answer : null;
  const ended = shown !== null && isTerminalState(shown.state);

  // Another run: its read is pending, never the last one's answer or error.
  useEffect(() => {
    setAnswer(null);
    setError(null);
    setStages(null);
    setConfirming(false);
    setCancelWords(null);
  }, [id]);

  // The run: on mount, on the store's row changing, after a cancel; never once it has ended.
  useEffect(() => {
    if (ended) return;
    let cancelled = false;
    void fetchRun(id).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setError(r.error);
      setError(null);
      setAnswer(r.answer);
    });
    return () => {
      cancelled = true;
    };
    // `ended` stops the re-reads; the row key and the wake trigger them.
  }, [id, rowKey, wake]);

  const storyId = shown ? storyIdOf(shown.events) : null;
  const project = shown?.run.project_id ?? null;
  const lastSeq = shown?.events.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (storyId === null || project === null) return;
    let cancelled = false;
    setStages((s) => (s && s.story === storyId ? s : { story: storyId, rows: null, error: null }));
    void fetchStoryStages(project, storyId).then((r) => {
      if (cancelled) return;
      setStages(r.ok ? { story: storyId, rows: r.rows, error: null } : { story: storyId, rows: null, error: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, [storyId, project, lastSeq]);

  // The clock's tick, while the run is live.
  useEffect(() => {
    if (ended) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ended]);

  const rowsForStory = stages && stages.story === storyId ? stages : null;
  const timeline = useMemo(
    () => (shown ? runTimeline({ run: shown.run, events: shown.events, stageRows: rowsForStory?.rows ?? null, liveStage, now }) : null),
    [shown, rowsForStory, liveStage, now],
  );
  const page = { position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 48px", font, color: "#e8e8e8", background: "#161616" } as const;
  if (!shown || !timeline) return <div style={page}>{error ? <span style={{ color: "#ff8080" }}>{error}</span> : LOADING_RUN}</div>;

  const run = shown.run;
  const clock = runClock(shown, now);
  const cost = costView({
    storyId, project, stageRows: rowsForStory?.rows ?? null, error: rowsForStory?.error ?? null, cost_usd: shown.cost_usd, window: runWindow(shown.events), now,
  });
  const gate = canCancel(run);
  const go = (path: string) => (e: { preventDefault(): void }) => {
    e.preventDefault();
    onNavigate(path);
  };
  const doCancel = async () => {
    // No project, a failed inbox read or no token: refused up front in words, never a post without the token.
    setCancelling(true);
    const r = await requestCancel(id, project, fetchInbox);
    setCancelling(false);
    setCancelWords(r.words);
    setConfirming(false);
    if (r.ok) setWake((n) => n + 1);
  };

  // The bar: the top-level segments by span; the sessions on a row under the engine.
  const t0 = Date.parse(timeline.segments[0]?.start ?? run.created);
  const tEnd = Math.max(t0 + 1000, ...timeline.segments.map((s) => (s.end === null ? now : Date.parse(s.end))));
  const span = tEnd - t0;
  const place = (s: Segment) => {
    const a = Date.parse(s.start), b = s.end === null ? now : Date.parse(s.end);
    return { left: `${((a - t0) / span) * 100}%`, width: `${Math.max(0.4, ((b - a) / span) * 100)}%` };
  };
  const top = timeline.segments.filter((s) => s.kind !== "session" && s.kind !== "ended");
  const sessions = timeline.segments.filter((s) => s.kind === "session");
  const cellStyle = (s: Segment) => ({
    position: "absolute" as const, top: 0, bottom: 0, ...place(s), background: TONE[s.kind], overflow: "hidden", whiteSpace: "nowrap" as const,
    fontSize: 11, padding: "2px 4px", boxSizing: "border-box" as const, borderRight: "1px solid #161616", display: "flex", flexDirection: "column" as const,
  });

  return (
    <div style={page}>
      {error && <div style={{ color: "#ff8080" }}>{error}</div>}
      <header>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>run {run.run_id}</h2>
        <div>
          job {run.job_id} · project {run.project_id ?? "none"} · {run.state} · story{" "}
          {storyId ? (
            <a href={`/app/story/${storyId}${project ? `?project=${encodeURIComponent(project)}` : ""}`} onClick={go(`/app/story/${storyId}${project ? `?project=${encodeURIComponent(project)}` : ""}`)} style={link}>
              {storyId}
            </a>
          ) : (
            NO_STORY_YET
          )}
          {liveStage && !ended ? ` · ${liveStage}` : ""}
        </div>
      </header>

      <h2 style={h2}>Clock</h2>
      <div style={{ fontSize: 18, color: clock.over ? "#ff8080" : "#e8e8e8" }}>{clock.label}</div>
      {clock.context && <div style={muted}>{clock.context}</div>}

      <h2 style={h2}>Timeline</h2>
      <div style={{ position: "relative", height: 34, background: "#202020" }}>
        {top.map((s, i) => (
          <div key={`${s.kind}-${i}`} title={`${s.label}${s.outcome ? ` · ${s.outcome}` : ""}`} style={cellStyle(s)}>
            <span>
              {s.label}
              {s.outcome ? ` · ${s.outcome}` : ""}
            </span>
            {s.suites && s.suites.length > 0 && (
              <div style={{ display: "flex", flex: 1, marginTop: 2 }}>
                {s.suites.map((x) => (
                  <div key={x.name} title={`${x.name} ${x.seconds}s`} style={{ flex: Math.max(x.seconds, 1), background: "rgba(0,0,0,0.25)", borderRight: "1px solid #9f7f2f", overflow: "hidden", fontSize: 10 }}>
                    {x.name} {x.seconds}s
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {sessions.length > 0 && (
        <div style={{ position: "relative", height: 20, background: "#1c1c1c", marginTop: 2 }}>
          {sessions.map((s, i) => (
            <div key={`session-${i}`} title={s.label} style={cellStyle(s)}>
              {s.label}
            </div>
          ))}
        </div>
      )}
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {timeline.segments.map((s, i) => (
          <li key={i} style={s.kind === "session" ? { marginLeft: 16 } : undefined}>
            {s.label} · {new Date(s.start).toLocaleTimeString()} → {s.end === null ? "now" : new Date(s.end).toLocaleTimeString()}
            {s.outcome ? ` · ${s.outcome}` : ""}
            {s.suites ? ` · ${s.suites.map((x) => `${x.name} ${x.seconds}s`).join(", ")}` : ""}
          </li>
        ))}
      </ul>

      <h2 style={h2}>Cost</h2>
      <div>{cost.label}</div>
      {cost.stages.map((s) => (
        <div key={s.stage}>
          {s.stage} ${s.usd.toFixed(4)}
        </div>
      ))}
      {cost.total !== null && <div>total ${cost.total.toFixed(4)}</div>}

      <h2 style={h2}>{timeline.ended ? "Ended" : "Cancel"}</h2>
      {timeline.ended ? (
        <div>{timeline.ended.words}</div>
      ) : gate.show ? (
        <div>
          {!confirming ? (
            <button type="button" style={{ font }} disabled={!gate.enabled || cancelling} title={gate.note ?? undefined} onClick={() => setConfirming(true)}>
              Cancel…
            </button>
          ) : (
            <>
              <div style={{ color: "#e0b040", marginBottom: 4 }}>{CANCEL_CONSEQUENCE}</div>
              <button type="button" style={{ font }} disabled={cancelling} onClick={() => void doCancel()}>
                Cancel run {run.run_id}
              </button>{" "}
              <button type="button" style={{ font }} disabled={cancelling} onClick={() => setConfirming(false)}>
                Keep it running
              </button>
            </>
          )}
          {gate.note && <div style={muted}>{gate.note}</div>}
        </div>
      ) : null}
      {cancelWords && <div>{cancelWords}</div>}

      <h2 style={h2}>Events ({shown.events.length})</h2>
      {eventRows(shown.events).map((e) => (
        <details key={e.seq}>
          <summary>{e.summary}</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "2px 0 6px 16px" }}>{e.body}</pre>
        </details>
      ))}
    </div>
  );
}
