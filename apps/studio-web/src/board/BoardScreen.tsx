// The Board screen (Story 30.5, design spec §6.3): the selected project's `GET /board?project=<id>` as rows of
// phased bars (one segment per story, coloured by status), the open findings count, the spend bar against the
// epic's band, and the Needs-you / Working / Done triage of its runs, each linking its PR and naming the ruling it
// waits for. The rules are in `model.ts`. Fetched on a project change, again when the project's runs in the store
// change (an `office.run` or `office.progress` delta), and when the window regains focus or the page becomes
// visible (a closed finding, a plan edit, new spend or a new local day reach no delta), never on a timer.
// Story 39.1: the project is the address's (`/app/board/<project>`, the `project` prop); with none, the remembered
// choice is picked and replaces the address (`onProject(p, true)`); the switcher pushes it (`onProject(p, false)`). A
// served address project is remembered as the switcher's is; one not served is replaced as none is.
// Story 39.4: the kanban is the default view (`KanbanView.tsx`); `?view=rows` is the row view and triage above,
// unchanged. The `?view=` and `?epic=` toggles keep the address project and navigate with `replace` (the address's
// query is the `search` prop; `onNavigate` is the router's navigation); a card opens the story page through it.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { OfficeStore } from "../live/store";
import { fetchAgents, projectsFrom, rememberedProject, rememberProject } from "../office/model";
import { addressProject } from "../screen";
import { KanbanView } from "./KanbanView";
import { boardColumns, boardPath, boardQuery, boardRows, fetchBoard, refetchKey, shownEpic, type BoardAnswer } from "./model";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;

export function BoardScreen({ store, project, onProject, search = "", onNavigate }: {
  store: OfficeStore; project: string | null; onProject: (project: string, replace: boolean) => void;
  /** Story 39.4: the address's query (`?view=`, `?epic=`) and the router's navigation. */
  search?: string; onNavigate: (path: string, replace?: boolean) => void;
}) {
  const { view, epic } = boardQuery(search);
  const live = useSyncExternalStore(store.subscribe, store.getState);
  const [projects, setProjects] = useState<string[]>([]);
  const onProjectRef = useRef(onProject);
  onProjectRef.current = onProject;
  const key = refetchKey(live, project);
  const [wake, setWake] = useState(0);
  const [board, setBoard] = useState<BoardAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The project list (`GET /agents`) and, with no project in the address, the choice the Office remembers (replacing
  // the address); read again on a wake while no list or no project is held (a failed read, or none served yet), never
  // on a timer.
  const listed = projects.length > 0;
  useEffect(() => {
    if (project !== null && listed) return;
    let cancelled = false;
    void fetchAgents(null).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) return setError(ans.error);
      setError(null);
      setProjects(projectsFrom(ans.agents));
    });
    return () => {
      cancelled = true;
    };
  }, [project, listed, wake]);

  // The address's project against the served list: a served one is remembered (the shown and the remembered project
  // agree); none, or one not served, is replaced by the remembered choice (`addressProject`).
  useEffect(() => {
    const next = addressProject(project, projects, rememberedProject(projects));
    if (next === null) return;
    if ("remember" in next) rememberProject(next.remember);
    else onProjectRef.current(next.replace, true);
  }, [project, projects]);

  // A refetch when the window regains focus or the page becomes visible again.
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

  // The board: on a project change, a change of the project's runs in the store, and a wake.
  useEffect(() => {
    if (project === null) return;
    let cancelled = false;
    void fetchBoard(project).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) return setError(ans.error);
      setError(null);
      setBoard(ans.board);
    });
    return () => {
      cancelled = true;
    };
  }, [project, key, wake]);

  const shown = board && board.project === project ? board : null;
  const rows = useMemo(() => (shown ? boardRows(shown) : []), [shown]);
  const columns = useMemo(() => (shown ? boardColumns(shown) : []), [shown]);
  const epicShown = shown ? shownEpic(shown, epic) : epic;

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 16px", font, color: "#e8e8e8", background: "#161616" }}>
      <label>
        project{" "}
        <select
          value={project ?? ""}
          onChange={(e) => {
            setBoard(null);
            rememberProject(e.target.value);
            onProject(e.target.value, false);
          }}
        >
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {project !== null && (
        <>
          {" "}
          <label>
            view{" "}
            <select value={view} onChange={(e) => onNavigate(boardPath(project, e.target.value === "rows" ? "rows" : "kanban", epic), true)}>
              <option value="kanban">kanban</option>
              <option value="rows">rows</option>
            </select>
          </label>
          {view === "kanban" && shown && (
            <>
              {" "}
              <label>
                epic{" "}
                <select value={epicShown ?? "all"} onChange={(e) => onNavigate(boardPath(project, view, e.target.value), true)}>
                  {shown.epics.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.id} {ep.title}
                    </option>
                  ))}
                  <option value="all">all epics</option>
                </select>
              </label>
            </>
          )}
        </>
      )}
      {error && <div style={{ color: "#ff8080" }}>error {error}</div>}
      {shown?.plan.reason && <div style={{ color: "#c9a227" }}>{shown.plan.reason}</div>}

      {view === "kanban" && shown && project !== null && (
        <KanbanView board={shown} live={live} project={project} epic={epic} onOpen={(path) => onNavigate(path)} onRefetch={() => setWake((n) => n + 1)} />
      )}

      {view === "rows" && (
      <>
      <section style={{ marginTop: 12 }}>
        {rows.map((r) => (
          <div key={r.id} data-epic={r.id} style={{ marginBottom: 12 }}>
            <div>
              <strong>{r.id}</strong> {r.title} <span style={{ color: r.colour }}>({r.status})</span> · {r.findingsText}
            </div>
            <div style={{ display: "flex", gap: 2, height: 18, marginTop: 4 }}>
              {r.segments.map((s) => {
                const label = `${s.key || s.id} ${s.title} — ${s.status}${s.findings ? ` · ${s.findings} open` : ""}`;
                const body = (
                  <div title={label} style={{ height: "100%", background: s.colour, fontSize: 11, padding: "0 4px", overflow: "hidden", whiteSpace: "nowrap", color: "#fff" }}>
                    {s.key || s.id}
                    {s.findings ? ` ·${s.findings}` : ""}
                  </div>
                );
                return (
                  <div key={s.id} style={{ flex: 1, minWidth: 0 }}>
                    {s.href ? (
                      <a href={s.href} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                        {body}
                      </a>
                    ) : (
                      body
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <div style={{ width: 200, height: 8, background: "#333", borderRadius: 4, overflow: "hidden" }}>
                {r.spend.fill !== null && (
                  <div style={{ width: `${r.spend.fill * 100}%`, height: "100%", background: r.spend.over ? "#b03030" : "#3f9a4a" }} />
                )}
              </div>
              <span>spend {r.spend.text}</span>
            </div>
          </div>
        ))}
      </section>

      <section style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        {columns.map((c) => (
          <div key={c.key} data-column={c.key} style={{ flex: "1 1 220px", minWidth: 220, background: "#202020", padding: 8, borderRadius: 4 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>
              {c.title} ({c.items.length})
            </h3>
            {c.items.map((i) => (
              <div key={i.run_id} style={{ marginBottom: 8 }}>
                <div>
                  run {i.run_id} · {i.state}
                </div>
                <div>story {i.story}</div>
                <div>
                  {i.href ? (
                    <a href={i.href} target="_blank" rel="noreferrer" style={link}>
                      PR
                    </a>
                  ) : (
                    "no PR"
                  )}
                </div>
                {i.ruling && <div style={{ color: "#e0b040" }}>{i.ruling}</div>}
              </div>
            ))}
          </div>
        ))}
      </section>
      </>
      )}
    </div>
  );
}
