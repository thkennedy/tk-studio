// The story page (Story 39.4, addendum §3.1.7): `/app/story/<id>` — one story's header (epic badge, key, id, title,
// status, band, the Jira key as a link, the PR), the "Needs you" strip, the plan text (pre-wrapped text, never HTML), the
// Stage Log table and its total line, the runs (each linking `/app/run/<id>`) and the open findings. The project is
// `?project=`, else the board's remembered choice among `GET /agents`' projects. Fetched on mount, on focus or
// visibility, and when the project's runs in the store change (`refetchKey`); never on a timer. The rules are `model.ts`.
import { useEffect, useState, useSyncExternalStore } from "react";
import { refetchKey } from "../board/model";
import type { OfficeStore } from "../live/store";
import { fetchAgents, projectsFrom, rememberedProject } from "../office/model";
import {
  fetchStory, findingText, LOADING_STORY, NO_PROJECT_STORY, needsYouStrip, projectOfSearch, runLine, stageRowText, storyView, totalLine, type StoryAnswer,
} from "./model";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;
const cell = { padding: "2px 8px", borderBottom: "1px solid #333", textAlign: "left" as const, whiteSpace: "nowrap" as const };

export function StoryScreen({ store, id, search, onNavigate }: { store: OfficeStore; id: string; search: string; onNavigate: (path: string) => void }) {
  const live = useSyncExternalStore(store.subscribe, store.getState);
  const addressed = projectOfSearch(search);
  const [remembered, setRemembered] = useState<string | null>(null);
  // `GET /agents` answered and served no project to remember (only read when the address names none).
  const [noProject, setNoProject] = useState(false);
  const project = addressed ?? remembered;
  const key = refetchKey(live, project);
  const [wake, setWake] = useState(0);
  const [story, setStory] = useState<StoryAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No `?project=`: the board's remembered choice among the served projects.
  useEffect(() => {
    if (addressed !== null) return;
    let cancelled = false;
    void fetchAgents(null).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) return setError(ans.error);
      const chosen = rememberedProject(projectsFrom(ans.agents));
      setRemembered(chosen);
      setNoProject(chosen === null);
    });
    return () => {
      cancelled = true;
    };
  }, [addressed, wake]);

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

  // Another story or project: its read is pending ("Loading the story…") until it lands, never the last one's error.
  useEffect(() => {
    setError(null);
  }, [project, id]);

  useEffect(() => {
    if (project === null) return;
    let cancelled = false;
    void fetchStory(project, id).then((ans) => {
      if (cancelled) return;
      // A failed refetch keeps the last loaded story and shows the error above it (as the board keeps its last board);
      // only a failure with no story yet is the error page.
      if (!ans.ok) return setError(ans.error);
      setError(null);
      setStory(ans.story);
    });
    return () => {
      cancelled = true;
    };
  }, [project, id, key, wake]);

  const shown = story && story.story.id === id && story.project === project ? story : null;
  const page = { position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 16px", font, color: "#e8e8e8", background: "#161616" } as const;
  if (!shown) {
    const pending = project === null && addressed === null && noProject ? NO_PROJECT_STORY : LOADING_STORY;
    return <div style={page}>{error ? <span style={{ color: "#ff8080" }}>{error}</span> : pending}</div>;
  }

  const head = storyView(shown);
  const strip = needsYouStrip(shown);
  const go = (path: string) => (e: { preventDefault(): void }) => {
    e.preventDefault();
    onNavigate(path);
  };
  return (
    <div style={page}>
      {error && <div style={{ color: "#ff8080" }}>{error}</div>}
      <header>
        <div>
          {head.badge && (
            <span title={head.badge.title} style={{ fontSize: 11, padding: "0 4px", background: "#3a3a3a", borderRadius: 3, marginRight: 6 }}>
              {head.badge.text}
            </span>
          )}
          {head.heading} · {head.status} · {head.band}
        </div>
        <h2 style={{ margin: "4px 0", fontSize: 16 }}>{head.title}</h2>
        <div>
          {head.jira.href ? (
            <a href={head.jira.href} target="_blank" rel="noreferrer" style={link}>
              {head.jira.text}
            </a>
          ) : (
            head.jira.text
          )}{" "}
          ·{" "}
          {head.pr.href ? (
            <a href={head.pr.href} target="_blank" rel="noreferrer" style={link}>
              {head.pr.text}
            </a>
          ) : (
            head.pr.text
          )}
        </div>
      </header>

      {strip && (
        <div style={{ margin: "8px 0", padding: "4px 8px", border: "1px solid #e0b040", borderRadius: 4 }}>
          Needs you:{" "}
          <a href={strip.path} onClick={go(strip.path)} style={link}>
            {strip.text}
          </a>
        </div>
      )}

      <section style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14 }}>Plan</h3>
        <div style={{ whiteSpace: "pre-wrap" }}>{shown.plan_text}</div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14 }}>Stage Log</h3>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["stage", "started", "span", "model", "tokens", "cost", "outcome", "Jira"].map((h) => (
                <th key={h} style={cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.stage_log.rows.map((r, i) => {
              const t = stageRowText(r);
              return (
                <tr key={`${r.spec}-${i}`}>
                  <td style={cell}>{t.stage}</td>
                  <td style={cell}>{t.started}</td>
                  <td style={cell}>{t.span}</td>
                  <td style={cell}>{t.model}</td>
                  <td style={cell}>{t.tokens}</td>
                  <td style={cell}>{t.cost}</td>
                  <td style={cell}>{t.outcome}</td>
                  <td style={cell}>{t.posted}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 4 }}>{totalLine(shown.stage_log.total)}</div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14 }}>Runs</h3>
        {shown.runs.length === 0 && <div>no runs</div>}
        {shown.runs.map((r) => {
          const l = runLine(r);
          return (
            <div key={r.run_id}>
              <a href={l.path} onClick={go(l.path)} style={link}>
                {l.text}
              </a>{" "}
              ·{" "}
              {l.pr.href ? (
                <a href={l.pr.href} target="_blank" rel="noreferrer" style={link}>
                  {l.pr.text}
                </a>
              ) : (
                l.pr.text
              )}
            </div>
          );
        })}
      </section>

      <section style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 14 }}>Findings</h3>
        {shown.findings.length === 0 && <div>no open findings</div>}
        {shown.findings.map((f) => (
          <div key={f.id}>{findingText(f)}</div>
        ))}
      </section>
    </div>
  );
}
