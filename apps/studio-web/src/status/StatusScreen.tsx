// The Status screen (Story 30.6): the queue's counts and live runs, the agents, the office section, the ledger's
// last events and the supervisor's version — all from the one store (`statusView`, `model.ts`), re-rendered on a
// store change, never on a timer. The read-only page (no JavaScript) is linked at the absolute `/status`.
import { useMemo, useSyncExternalStore } from "react";
import type { OfficeStore } from "../live/store";
import { safeHref } from "../office/model";
import { STATUS_PAGE_URL, statusView } from "./model";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;
const card = { background: "#202020", padding: 8, borderRadius: 4, marginBottom: 8 } as const;
const h2 = { fontSize: 14, margin: "16px 0 8px" } as const;
const muted = { color: "#999" } as const;

export function StatusScreen({ store }: { store: OfficeStore }) {
  const live = useSyncExternalStore(store.subscribe, store.getState);
  const v = useMemo(() => statusView(live), [live]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 48px", font, color: "#e8e8e8", background: "#161616" }}>
      <div>
        supervisor {v.version} ·{" "}
        <a href={STATUS_PAGE_URL} style={link}>
          the read-only page
        </a>
      </div>
      {!v.loaded && <div style={muted}>waiting for the office snapshot</div>}

      <h2 style={h2}>Queue</h2>
      {v.counts === null ? (
        <div style={muted}>no counts in the snapshot</div>
      ) : v.counts.length === 0 ? (
        <div style={muted}>no runs</div>
      ) : (
        <div>
          {v.counts.map((c) => `${c.state} ${c.count}`).join(" · ")} · total {v.total}
        </div>
      )}

      <h2 style={h2}>Live runs ({v.liveRuns.length})</h2>
      {v.liveRuns.length === 0 ? (
        <div style={muted}>no live runs</div>
      ) : (
        v.liveRuns.map((r) => (
          <div key={r.run_id}>
            {r.run_id} · {r.project} · {r.state} · engine {r.engine_run_id}
          </div>
        ))
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
