// The Status screen (Story 30.6): the queue's counts, the agents, the office section, the ledger's last events and
// the supervisor's version — all from the one store (`statusView`, `model.ts`), re-rendered on a store change. The
// read-only page (no JavaScript) is linked at the absolute `/status`.
// Story 39.5 (CAP-17): the Queue section lists the live runs (`queueRows`) above the counts — queued, claimed, running,
// paused — each a link to its run page with its job, story, start and clock, Cancel (its consequence first), and for a
// paused run the reason in words and the inbox item that resolves it. `GET /status` and each live run's
// `GET /runs/{id}` are re-read on mount and whenever the store's live-run signature changes, never on a timer; the 1 s
// tick moves the clocks only. The old "Live runs" list is the queue now.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fetchInbox } from "../inbox/model";
import type { OfficeStore } from "../live/store";
import { safeHref } from "../office/model";
import { CANCEL_CONSEQUENCE, fetchRun, requestCancel, type RunAnswer } from "../run/model";
import { fetchStatus, LOADING_QUEUE, liveSignature, mergeDetails, queueRows, STATUS_PAGE_URL, statusView, type StatusAnswer } from "./model";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;
const card = { background: "#202020", padding: 8, borderRadius: 4, marginBottom: 8 } as const;
const h2 = { fontSize: 14, margin: "16px 0 8px" } as const;
const muted = { color: "#999" } as const;

export function StatusScreen({ store, onNavigate }: { store: OfficeStore; onNavigate?: (path: string) => void }) {
  const live = useSyncExternalStore(store.subscribe, store.getState);
  const v = useMemo(() => statusView(live), [live]);
  const signature = liveSignature(live);
  const [status, setStatus] = useState<StatusAnswer | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reads, setReads] = useState<{ details: Record<string, RunAnswer | undefined>; errors: Record<string, string> }>({ details: {}, errors: {} });
  const [wake, setWake] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [words, setWords] = useState<Record<string, string>>({});

  // The queue and each live non-queued run's detail: on mount, on a store change of the live runs, after a cancel.
  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then(async (r) => {
      if (cancelled) return;
      if (!r.ok) return setStatusError(r.error);
      setStatusError(null);
      setStatus(r.status);
      const ids = r.status.live.filter((x) => x.state !== "queued").map((x) => x.run_id);
      const results = await Promise.all(ids.map(async (run_id) => ({ run_id, result: await fetchRun(run_id) })));
      if (cancelled) return;
      // A failed re-read keeps the run's last answer (`mergeDetails`), never a loading label again.
      setReads((prev) => mergeDetails(prev.details, results));
    });
    return () => {
      cancelled = true;
    };
  }, [signature, wake]);

  // The clocks' tick (no read).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const queue = status ? queueRows(status, reads.details, live, now, reads.errors) : null;
  /** An in-app link through the router (a plain link without one). */
  const go = (path: string) => (e: { preventDefault(): void }) => {
    if (!onNavigate) return;
    e.preventDefault();
    onNavigate(path);
  };
  const cancel = async (runId: string, project: string | null) => {
    // No project, a failed inbox read or no token: refused up front in words, never a post without the token.
    const r = await requestCancel(runId, project, fetchInbox);
    setWords((w) => ({ ...w, [runId]: r.words }));
    setConfirming(null);
    if (r.ok) setWake((n) => n + 1);
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 48px", font, color: "#e8e8e8", background: "#161616" }}>
      <div>
        supervisor {v.version} ·{" "}
        <a href={STATUS_PAGE_URL} style={link}>
          the read-only page
        </a>
      </div>
      {!v.loaded && <div style={muted}>waiting for the office snapshot</div>}

      <h2 style={h2}>Queue{queue ? ` (${queue.length})` : ""}</h2>
      {statusError && <div style={{ color: "#ff8080" }}>{statusError}</div>}
      {queue === null ? (
        <div style={muted}>{LOADING_QUEUE}</div>
      ) : queue.length === 0 ? (
        <div style={muted}>no queued, claimed, running or paused runs</div>
      ) : (
        queue.map((q) => {
          const project = status?.live.find((r) => r.run_id === q.run_id)?.project_id ?? null;
          return (
            <div key={q.run_id} style={card}>
              <a href={q.href} onClick={go(q.href)} style={link}>
                {q.run_id}
              </a>{" "}
              · {q.state} · job {q.job} · story {q.story} · start {q.start} · {q.clock}
              {q.refused && <div style={{ color: "#e0b040" }}>{q.refused}</div>}
              {q.paused && (
                <div style={{ color: "#e0b040" }}>
                  {q.paused.reason}
                  {q.paused.inbox && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={q.paused.inbox.href} onClick={go(q.paused.inbox.href)} style={link}>
                        {q.paused.inbox.key}
                      </a>
                    </>
                  )}
                </div>
              )}
              {q.cancel.show && (
                <div>
                  {confirming === q.run_id ? (
                    <>
                      <div style={{ color: "#e0b040" }}>{CANCEL_CONSEQUENCE}</div>
                      <button type="button" style={{ font }} onClick={() => void cancel(q.run_id, project)}>
                        Cancel run {q.run_id}
                      </button>{" "}
                      <button type="button" style={{ font }} onClick={() => setConfirming(null)}>
                        Keep it running
                      </button>
                    </>
                  ) : (
                    <button type="button" style={{ font }} disabled={!q.cancel.enabled} title={q.cancel.note ?? undefined} onClick={() => setConfirming(q.run_id)}>
                      Cancel…
                    </button>
                  )}
                  {q.cancel.note && <span style={muted}> {q.cancel.note}</span>}
                </div>
              )}
              {words[q.run_id] && <div>{words[q.run_id]}</div>}
            </div>
          );
        })
      )}

      <h2 style={h2}>Counts</h2>
      {v.counts === null ? (
        <div style={muted}>no counts in the snapshot</div>
      ) : v.counts.length === 0 ? (
        <div style={muted}>no runs</div>
      ) : (
        <div>
          {v.counts.map((c) => `${c.state} ${c.count}`).join(" · ")} · total {v.total}
        </div>
      )}

      <h2 style={h2}>Agents ({v.agents.length})</h2>
      {v.agents.length === 0 ? (
        <div style={muted}>no agents</div>
      ) : (
        v.agents.map((a) => (
          <div key={a.agent_id}>
            {a.agent_id} · {a.state} · run {a.current_run} · story {a.current_story}
            {a.reason && <span style={{ color: "#e0b040" }}> · {a.reason}</span>}
          </div>
        ))
      )}

      <h2 style={h2}>Office</h2>
      {v.office.runs.map((r) => (
        <div key={r.run_id} style={card}>
          <strong>{r.run_id}</strong> · project {r.project} · epic {r.progress} · current story {r.current_story}
          {r.stories.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {r.stories.map((s) => (
                <li key={s.key}>
                  {s.key}
                  {s.title ? ` ${s.title}` : ""} — {s.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {v.office.runs.length === 0 && <div style={muted}>no live runs</div>}
      {v.office.lastRuns.map((l) => {
        const href = safeHref(l.pr);
        return (
          <div key={l.project}>
            last run {l.project}: {l.run_id} · {l.state} · {l.ended_at}{" "}
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" style={link}>
                PR
              </a>
            ) : (
              "no PR"
            )}
          </div>
        );
      })}
      {v.office.problems.map((p, i) => (
        <div key={i} style={{ color: "#ff8080" }}>
          {p}
        </div>
      ))}

      <h2 style={h2}>Ledger</h2>
      {v.ledger === null ? (
        <div style={muted}>no ledger in the snapshot</div>
      ) : "lines" in v.ledger ? (
        <>
          <div style={muted}>
            {v.ledger.path} (last {v.ledger.lines.length} lines)
          </div>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "4px 0 0" }}>{v.ledger.lines.join("\n")}</pre>
        </>
      ) : (
        <div style={muted}>{v.ledger.note}</div>
      )}
    </div>
  );
}
