// The Inbox screen (Story 31.6, design spec §6.9 item 2): what needs the owner — the open items of every served
// project's `GET /inbox?project=<id>` (the projects in `projectsFrom` order, the items in the order served), each
// row naming the project, the issue key and title, the priority, how long it has waited and the reason's first
// line. Story 38.4: a sweep decision row carries a `Decision` tag and its state (`open`, or `resolved`: answered,
// awaiting the ingest). Choosing a row opens the Issue screen. The rows (and so the nav count) come from `useInbox`, which `App.tsx`
// owns so the count sits on the nav item whichever screen is shown; it refetches as the Board does — on a change of
// the projects' runs or an agent's `blocked_issue` in the store, and when the window regains focus or the page
// becomes visible — never on a timer. The rules are in `model.ts`.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { OfficeStore } from "../live/store";
import { fetchAgents, projectsFrom } from "../office/model";
import { fetchInboxRows, INBOX_COLUMNS, inboxNotice, inboxRefetchKey, type InboxRow } from "./model";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";

/** The inbox rows and the read errors, refetched as the Board refetches; `loaded` once the first load has finished
 * (every project's inbox read answered, or `/agents` failed). */
export function useInbox(store: OfficeStore): { rows: InboxRow[]; errors: string[]; loaded: boolean } {
  const live = useSyncExternalStore(store.subscribe, store.getState);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [wake, setWake] = useState(0);
  const [state, setState] = useState<{ rows: InboxRow[]; errors: string[] }>({ rows: [], errors: [] });
  // Its own slot: the inbox read replaces `state` whole, which must not erase a failed `/agents` read.
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const key = inboxRefetchKey(live, projects ?? []);

  useEffect(() => {
    const bump = () => setWake((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // The served projects (`GET /agents`), read again on a wake.
  useEffect(() => {
    let cancelled = false;
    void fetchAgents(null).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) {
        setAgentsError(ans.error);
        setLoaded(true);
        return;
      }
      setAgentsError(null);
      const list = projectsFrom(ans.agents);
      setProjects((old) => (old && old.join("\n") === list.join("\n") ? old : list));
    });
    return () => {
      cancelled = true;
    };
  }, [wake]);

  useEffect(() => {
    if (projects === null) return;
    let cancelled = false;
    void fetchInboxRows(projects, Date.now()).then((out) => {
      if (cancelled) return;
      setState(out);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projects, key, wake]);

  return useMemo(
    () => ({ rows: state.rows, errors: agentsError === null ? state.errors : [agentsError, ...state.errors], loaded }),
    [state, agentsError, loaded],
  );
}

export function InboxScreen({ rows, errors, loaded, onOpen }: { rows: InboxRow[]; errors: string[]; loaded: boolean; onOpen: (project: string, key: string) => void }) {
  const notice = inboxNotice(loaded, rows, errors);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 16px", font, color: "#e8e8e8", background: "#161616" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Inbox ({rows.length})</h2>
      {errors.map((e) => (
        <div key={e} style={{ color: "#ff8080" }}>
          error {e}
        </div>
      ))}
      {notice && <div style={{ color: "#9a9a9a" }}>{notice}</div>}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        {rows.length > 0 && (
          <thead>
            <tr style={{ borderBottom: "1px solid #2a2a2a" }}>
              {INBOX_COLUMNS.map((c) => (
                <th key={c} style={{ padding: "6px 8px", textAlign: "left", fontWeight: "normal", color: "#9a9a9a" }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.project}/${r.key}`}
              data-issue={r.key}
              onClick={() => onOpen(r.project, r.key)}
              style={{ cursor: "pointer", borderBottom: "1px solid #2a2a2a" }}
            >
              <td style={{ padding: "6px 8px", color: "#9a9a9a" }}>{r.project}</td>
              <td style={{ padding: "6px 8px" }}>
                <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(r.project, r.key); }} style={{ font }}>
                  {r.key}
                </button>
              </td>
              <td style={{ padding: "6px 8px" }}>
                {r.kind === "decision" && (
                  <span data-tag="decision" style={{ marginRight: 6, padding: "0 4px", border: "1px solid #6aa0ff", color: "#6aa0ff" }}>
                    Decision
                  </span>
                )}
                {r.title}
              </td>
              <td style={{ padding: "6px 8px", color: "#9a9a9a" }}>{r.state}</td>
              <td style={{ padding: "6px 8px", color: "#e0b040" }}>{r.priority}</td>
              <td style={{ padding: "6px 8px" }}>{r.waited}</td>
              <td style={{ padding: "6px 8px", color: "#c8c8c8" }}>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
