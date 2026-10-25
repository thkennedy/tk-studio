// The Chat screen (Story 32.7, design spec §6.3 Chat, F2): the engagement conversation in the web. A served project
// is chosen; its engagements are listed by state (`GET /engagements?project=`), with a New engagement form
// (`POST /engagements`). The open engagement shows its state as a stepper (the side exits marked), its transcript
// (`GET /chat/{id}`, kept live by the chat stream; owner and planner lines, the planner's run cost on hover or focus
// from `GET /runs/{id}` `cost_usd`), a message box (`POST /chat/{id}`), and the typed inputs the table allows for its
// state (`POST /engagements/{id}/input`): the question cards (`answer`), the scope page's link and a Revise box, the
// quote as the band with Approve and the autonomy choice, Go (with a cap in `partial`), a question, Cancel, and each
// planner proposal as a button sending exactly that input. Every send carries the CSRF token `GET /inbox?project=`
// answered (read again when the project changes) and is disabled without it. Refetched on focus and on
// `visibilitychange` to visible, and when the office store's `office.engagement` rows for the project change (the
// `engagements` prop), never on a timer. The rules are in `model.ts`, the stream in `stream.ts`.
import { useEffect, useMemo, useRef, useState } from "react";
import type { OfficeEngagement } from "../live/store";
import { fetchInbox } from "../inbox/model";
import { fetchAgents, projectsFrom } from "../office/model";
import {
  allows, answerInput, approveInput, autonomyChoice, byState, cancelInput, canSendInput, canSendText, createCostCache, fetchChat, fetchEngagement, fetchEngagements,
  goInput, mergeLines, postChat, postEngagement, postInput, proposalButtons, questionCards, questionInput, quoteView, rememberedEngagement,
  rememberEngagement, reviseInput, scopeHref, stateNote, stepper, type ChatLine, type Engagement, type Input,
} from "./model";
import { openChatStream, type ChatStreamStatus } from "./stream";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;
const box = { width: "100%", boxSizing: "border-box", font, background: "#101010", color: "#e8e8e8", border: "1px solid #333" } as const;
const section = { marginTop: 12, padding: 8, border: "1px solid #2a2a2a", borderRadius: 4 } as const;
const STEP_COLOR = { done: "#7fd18a", current: "#e0b040", left: "#ff8080", todo: "#666" } as const;

export function ChatScreen({ engagements }: { engagements?: readonly OfficeEngagement[] } = {}) {
  const remembered = useMemo(() => rememberedEngagement(), []);
  const [wake, setWake] = useState(0);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [project, setProject] = useState<string | null>(remembered?.project ?? null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [list, setList] = useState<Engagement[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [listBump, setListBump] = useState(0);
  const [id, setId] = useState<string | null>(remembered?.id ?? null);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [engBump, setEngBump] = useState(0);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [streamStatus, setStreamStatus] = useState<ChatStreamStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Each read's own error slot: a later successful read clears its own, never a send's error.
  const [readErrors, setReadErrors] = useState<Record<"agents" | "list" | "engagement" | "chat", string | null>>({ agents: null, list: null, engagement: null, chat: null });
  const readError = (k: keyof typeof readErrors, e: string | null) => setReadErrors((m) => (m[k] === e ? m : { ...m, [k]: e }));
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // the boxes
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState("");
  const [reviseBody, setReviseBody] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [reason, setReason] = useState("");
  const [cap, setCap] = useState("");
  const [autonomy, setAutonomy] = useState("steady");
  const [baseRef, setBaseRef] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [, setCostTick] = useState(0);
  const costs = useMemo(() => createCostCache(undefined, () => setCostTick((n) => n + 1)), []);
  const current = useRef<string | null>(null);
  const projectRef = useRef<string | null>(project);
  projectRef.current = project;
  // Bumped whenever a post's record is applied: a record read started before it is older and is dropped.
  const applied = useRef(0);

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

  // The served projects (`GET /agents`).
  useEffect(() => {
    let cancelled = false;
    void fetchAgents(null).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) return readError("agents", ans.error);
      readError("agents", null);
      const served = projectsFrom(ans.agents);
      setProjects((old) => (old && old.join("\n") === served.join("\n") ? old : served));
      const p = projectRef.current;
      if (!p || !served.includes(p)) {
        // A remembered project no longer served: its engagement is not shown either.
        setProject(served[0] ?? null);
        setId(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wake]);

  // The project's CSRF token (Settled shape 2): cleared and read again when the project changes, and read again on a
  // wake (focus, visible) so a transient `GET /inbox` failure does not leave every send disabled; a failed read keeps
  // the token held for the same project; none disables them. The last project's list is cleared with it.
  useEffect(() => {
    setCsrf(null);
    setList([]);
    setProblems([]);
    readError("list", null);
  }, [project]);
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void fetchInbox(project).then((r) => {
      if (!cancelled && projectRef.current === project && r.ok) setCsrf(r.csrf);
    });
    return () => {
      cancelled = true;
    };
  }, [project, wake]);

  // The project's engagements.
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void fetchEngagements(project).then((r) => {
      if (cancelled) return;
      if (!r.ok) return readError("list", r.error);
      readError("list", null);
      setList(r.engagements);
      setProblems(r.problems);
    });
    return () => {
      cancelled = true;
    };
  }, [project, wake, listBump]);

  // Another engagement (or project) chosen: nothing typed or shown for the last one carries over.
  useEffect(() => {
    current.current = project && id ? JSON.stringify([project, id]) : null;
    setEngagement(null);
    setLines([]);
    setError(null);
    setReadErrors((m) => ({ ...m, engagement: null, chat: null }));
    setNotice(null);
    setSending(false);
    setMessage("");
    setReviseBody("");
    setQuestionText("");
    setReason("");
    setCap("");
    setBaseRef("");
    setAutonomy("steady");
    setChoices({});
    if (project && id) rememberEngagement({ project, id });
  }, [project, id]);

  // The office store's rows (snapshot + `office.engagement` deltas): a change of the project's ids or states refetches
  // the list, a change of the open engagement's state refetches its record. Keyed on derived strings, so a snapshot
  // re-render that changes nothing here refetches nothing; no rows yet (null) is not a change.
  const listKey = engagements && project ? engagements.filter((e) => e.project === project).map((e) => `${e.id}:${e.state}`).sort().join("\n") : null;
  const openKey = engagements && project && id ? engagements.find((e) => e.project === project && e.id === id)?.state ?? "" : null;
  const seenOffice = useRef<{ project: string | null; id: string | null; list: string | null; open: string | null } | null>(null);
  useEffect(() => {
    const was = seenOffice.current;
    seenOffice.current = { project, id, list: listKey, open: openKey };
    if (!was || was.project !== project) return; // another project: its own reads run
    if (was.list !== null && listKey !== null && was.list !== listKey) setListBump((n) => n + 1);
    if (was.id === id && was.open !== null && openKey !== null && was.open !== openKey) setEngBump((n) => n + 1);
  }, [project, id, listKey, openKey]);

  // The open engagement's record (an answer older than a post's applied record is dropped).
  useEffect(() => {
    if (!project || !id) return;
    let cancelled = false;
    const started = applied.current;
    void fetchEngagement(project, id).then((r) => {
      if (cancelled || applied.current !== started) return;
      if (!r.ok) return readError("engagement", r.error);
      readError("engagement", null);
      setEngagement(r.engagement);
    });
    return () => {
      cancelled = true;
    };
  }, [project, id, wake, engBump]);

  // The transcript: the read, then the stream after its last seq (a planner line refetches the record).
  useEffect(() => {
    if (!project || !id) return;
    let cancelled = false;
    let stream: ReturnType<typeof openChatStream> | null = null;
    void fetchChat(project, id, 0).then((r) => {
      if (cancelled) return;
      if (!r.ok) readError("chat", r.error);
      else {
        readError("chat", null);
        setLines((have) => mergeLines(have, r.lines));
      }
      stream = openChatStream({
        project, id, since: r.ok ? r.last_seq : 0,
        onLine: (line) => {
          readError("chat", null); // the stream replays what the read missed
          setLines((have) => mergeLines(have, [line]));
          if (line.author === "planner") setEngBump((n) => n + 1);
        },
        onStatus: setStreamStatus,
      });
    });
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [project, id]);

  const shown = engagement && project && engagement.project === project && engagement.id === id ? engagement : null;
  const gate = { loaded: shown !== null, csrf, sending };
  const createGate = { loaded: project !== null, csrf, sending };
  const cards = useMemo(() => questionCards(shown?.questions), [shown]);
  const quote = useMemo(() => quoteView(shown?.quote), [shown]);
  const steps = useMemo(() => (shown ? stepper(shown) : null), [shown]);
  const state = shown?.state ?? "";
  const can = (verb: string) => shown !== null && allows(state, verb);
  // The autonomy shown is the autonomy sent: always one of the quote's offered levels.
  const offered = quote?.autonomy ?? [];
  const chosenAutonomy = autonomyChoice(offered, autonomy);

  const send = async (input: Input | null, after?: () => void) => {
    if (!project || !id || !input || !canSendInput(input, gate)) return;
    const target = current.current;
    setSending(true);
    setNotice(null);
    const r = await postInput(project, id, input, csrf);
    if (current.current !== target) return;
    setSending(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setNotice(`${input.verb}: ${r.from} → ${r.to}`);
    applied.current += 1;
    setEngagement(r.engagement);
    setListBump((n) => n + 1);
    after?.();
  };

  const sendMessage = async () => {
    if (!project || !id || !canSendText(message, gate)) return;
    const target = current.current;
    setSending(true);
    setNotice(null);
    const r = await postChat(project, id, message, csrf);
    if (current.current !== target) return;
    setSending(false);
    if (!r.ok) return setError(r.error); // the text is kept (ChatBusy is retryable)
    setError(null);
    setMessage("");
  };

  const create = async () => {
    if (!project || !canSendText(request, createGate)) return;
    const target = project;
    setSending(true);
    const r = await postEngagement(project, request, csrf);
    if (projectRef.current !== target) return; // the project changed meanwhile: do not open the id under another
    setSending(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setRequest("");
    setListBump((n) => n + 1);
    setId(r.engagement.id);
  };

  const groups = byState(list);
  const button = (label: string, input: Input | null, after?: () => void) => (
    <button type="button" disabled={!canSendInput(input, gate)} onClick={() => void send(input, after)} style={{ font }}>
      {label}
    </button>
  );

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 56px", font, color: "#e8e8e8", background: "#161616", display: "flex", gap: 16 }}>
      <aside style={{ width: 260, flex: "0 0 auto" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Chat</h2>
        <select value={project ?? ""} onChange={(e) => { setProject(e.target.value || null); setId(null); }} style={{ font, width: "100%" }}>
          {(projects ?? []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {!csrf && project && <div style={{ color: "#9a9a9a" }}>no CSRF token for {project}: sending is disabled</div>}
        {problems.map((p) => (
          <div key={p} style={{ color: "#e0b040" }}>
            {p}
          </div>
        ))}
        {groups.map((g) => (
          <div key={g.state} style={{ marginTop: 8 }}>
            <div style={{ color: "#9a9a9a" }}>{g.state}</div>
            {g.engagements.map((e) => (
              <button key={e.id} type="button" disabled={e.id === id} onClick={() => setId(e.id)} style={{ font, display: "block", width: "100%", textAlign: "left" }}>
                {e.id} · {e.request.split("\n")[0].slice(0, 60)}
              </button>
            ))}
          </div>
        ))}
        <section style={section}>
          <div>New engagement</div>
          <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={4} placeholder="What should the studio build?" style={box} />
          <button type="button" disabled={!canSendText(request, createGate)} onClick={() => void create()} style={{ font }}>
            Create
          </button>
        </section>
      </aside>
      <main style={{ flex: "1 1 auto", minWidth: 0 }}>
        {[...Object.values(readErrors), error].filter((e): e is string => !!e).map((e) => (
          <div key={e} style={{ color: "#ff8080" }}>
            error {e}
          </div>
        ))}
        {notice && <div style={{ color: "#7fd18a" }}>{notice}</div>}
        {!id ? (
          <div style={{ color: "#9a9a9a" }}>Choose an engagement, or start a new one</div>
        ) : !shown ? (
          <div style={{ color: "#9a9a9a" }}>Loading {id}…</div>
        ) : (
          <>
            <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>
              {shown.id} · {shown.state}
            </h2>
            <div style={{ whiteSpace: "pre-wrap", color: "#c8c8c8" }}>{shown.request}</div>
            {steps && (
              <ol style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", padding: 0 }}>
                {steps.steps.map((s) => (
                  <li key={s.state} style={{ color: STEP_COLOR[s.status] }}>
                    {s.status === "done" ? "✓" : s.status === "current" ? "●" : s.status === "left" ? "✕" : "○"} {s.state}
                    {s.status === "left" && steps.exit ? ` → ${steps.exit.state}` : ""}
                  </li>
                ))}
              </ol>
            )}
            {stateNote(shown) && <div style={{ color: "#e0b040" }}>{stateNote(shown)}</div>}

            <section style={section}>
              {lines.map((l) => (
                <div
                  key={l.seq}
                  tabIndex={l.author === "planner" && l.run_id ? 0 : undefined}
                  onMouseEnter={() => l.author === "planner" && l.run_id && void costs.request(l.run_id)}
                  onFocus={() => l.author === "planner" && l.run_id && void costs.request(l.run_id)}
                  title={l.author === "planner" && l.run_id ? costs.text(l.run_id) ?? undefined : undefined}
                  style={{ marginBottom: 8, padding: 8, background: l.author === "owner" ? "#1f2a36" : "#222", borderRadius: 4 }}
                >
                  <div style={{ color: "#9a9a9a" }}>
                    {l.author} · {l.at}
                    {l.author === "planner" && l.run_id && costs.text(l.run_id) ? ` · cost ${costs.text(l.run_id)}` : ""}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{l.body}</div>
                  {l.author === "planner" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      {proposalButtons(state, l).map((p, i) => (
                        <button key={i} type="button" disabled={!p.enabled || !canSendInput(p.input, gate)} title={p.note ?? undefined} onClick={() => void send(p.input)} style={{ font }}>
                          {p.label}
                          {p.note ? ` (${p.note})` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div style={{ color: "#9a9a9a" }}>{streamStatus ? `stream ${streamStatus}` : ""}</div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Message the planner" style={box} />
              <button type="button" disabled={!canSendText(message, gate)} onClick={() => void sendMessage()} style={{ font }}>
                Send
              </button>
            </section>

            {can("answer") && cards.length > 0 && (
              <section style={section}>
                <div>Questions</div>
                {cards.map((c) => (
                  <fieldset key={c.id} style={{ border: "1px solid #333", marginTop: 6 }}>
                    <legend>
                      {c.id}: {c.text}
                    </legend>
                    <div style={{ color: "#9a9a9a" }}>impact {c.impact}</div>
                    {c.options.map((o) => (
                      <label key={o.label} style={{ display: "block" }}>
                        <input
                          type="radio"
                          name={`q-${c.id}`}
                          disabled={c.answered}
                          checked={(choices[c.id] ?? c.selected) === o.label}
                          onChange={() => setChoices((m) => ({ ...m, [c.id]: o.label }))}
                        />{" "}
                        {o.label}
                        {o.isDefault ? " (default)" : ""}
                      </label>
                    ))}
                    {c.answered && <div style={{ color: "#7fd18a" }}>answered {c.selected}</div>}
                  </fieldset>
                ))}
                {button("Answer", answerInput(cards, choices), () => setChoices({}))}
              </section>
            )}

            {(scopeHref(shown) || can("revise")) && (
              <section style={section}>
                {scopeHref(shown) ? (
                  <a href={scopeHref(shown)!} target="_blank" rel="noreferrer" style={link}>
                    Scope of Work{shown.scope_page?.version ? ` (v${shown.scope_page.version})` : ""}
                  </a>
                ) : (
                  <div style={{ color: "#9a9a9a" }}>no scope page yet</div>
                )}
                {can("revise") && (
                  <>
                    <textarea value={reviseBody} onChange={(e) => setReviseBody(e.target.value)} rows={4} placeholder="Revise: the new scope.md (optional)" style={box} />
                    {button("Revise", reviseInput(reviseBody), () => setReviseBody(""))}
                  </>
                )}
              </section>
            )}

            {quote && (
              <section style={section}>
                <div>Quote</div>
                <table style={{ borderCollapse: "collapse" }}>
                  <tbody>
                    {quote.bands.map((b) => (
                      <tr key={b.name}>
                        <td style={{ padding: "2px 8px" }}>{b.name}%</td>
                        <td style={{ padding: "2px 8px" }}>{b.usd}</td>
                        <td style={{ padding: "2px 8px", color: "#9a9a9a" }}>{b.share} of the weekly window</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>cap {quote.cap}</div>
                <div style={{ color: "#9a9a9a" }}>autonomy {quote.autonomy.join(" · ")}</div>
                {quote.notes.map((n) => (
                  <div key={n} style={{ color: "#9a9a9a" }}>
                    {n}
                  </div>
                ))}
                {can("approve") && (
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <select value={chosenAutonomy ?? ""} onChange={(e) => setAutonomy(e.target.value)} style={{ font }}>
                      {quote.autonomy.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    <input value={baseRef} onChange={(e) => setBaseRef(e.target.value)} placeholder="base_ref (optional)" style={{ font }} />
                    {button("Approve", chosenAutonomy ? approveInput(chosenAutonomy, baseRef, offered) : null)}
                  </div>
                )}
              </section>
            )}

            {(can("go") || can("question") || can("cancel")) && (
              <section style={{ ...section, display: "flex", flexDirection: "column", gap: 6 }}>
                {can("go") && (
                  <div style={{ display: "flex", gap: 6 }}>
                    {state === "partial" && <input value={cap} onChange={(e) => setCap(e.target.value)} placeholder="new cap ($)" style={{ font }} />}
                    {button("Go", goInput(state, cap), () => setCap(""))}
                  </div>
                )}
                {can("question") && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={questionText} onChange={(e) => setQuestionText(e.target.value)} placeholder="Ask the planner (no state change)" style={{ font, flex: 1 }} />
                    {button("Ask", questionInput(questionText), () => setQuestionText(""))}
                  </div>
                )}
                {can("cancel") && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason (optional)" style={{ font, flex: 1 }} />
                    {button("Cancel", cancelInput(reason), () => setReason(""))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
