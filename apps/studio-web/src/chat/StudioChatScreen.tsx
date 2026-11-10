// The studio chat (Story 39.3, addendum §3.8, F-C): `/app/chat` is a conversation with the studio, not with an
// engagement (those stay at `/app/chat/<id>`, `ChatScreen.tsx`). A served project is chosen (`GET /agents`, the
// remembered office project); its CSRF token is the one `GET /inbox?project=` answers; the lines are `GET /chat?project=`,
// kept live by the chat stream without an id (`event: chat` lines, `event: chat-delta` reply text). The screen shows the
// owner's lines, the planner's replies with each proposal as a button, the press lines, the streaming reply with a
// cursor, and the pending label with the queue position. Send posts `POST /chat {project, text}`; a press sends the
// typed request its kind maps to (`model.ts proposalAction`), then records the press line (a `queue` press's line is
// recorded by the supervisor's `POST /jobs` gate itself); `open` navigates through the
// router (the `onNavigate` callback). The rules are in `model.ts`, the stream in `stream.ts`.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchInbox } from "../inbox/model";
import { fetchAgents, projectsFrom, rememberedProject, rememberProject } from "../office/model";
import {
  codePoints, CURSOR, fetchEngagements, fetchStudioChat, LINE_COUNT_FROM, LINE_MAX_CHARS, pendingLabel, press, pressedKeys, postStudioLine, rememberedSent, rememberSent, sentUnrecordedText, studioButtons,
  withDelta, withoutAnswered, type ChatLine, type Engagement, type StudioButton, type StudioLine, type Streams,
} from "./model";
import { routePath } from "../screen";
import { openChatStream, type ChatStreamStatus } from "./stream";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;
const box = { width: "100%", boxSizing: "border-box", font, background: "#101010", color: "#e8e8e8", border: "1px solid #333" } as const;
const page = { position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 56px", font, color: "#e8e8e8", background: "#161616" } as const;
const note = { color: "#e0b040" } as const;
const muted = { color: "#999" } as const;

/** Lines merged by seq (a duplicate seq ignored, the first kept), in seq order. */
function merge(have: readonly StudioLine[], incoming: readonly StudioLine[]): StudioLine[] {
  const seen = new Set(have.map((l) => l.seq));
  const add = incoming.filter((l) => !seen.has(l.seq) && (seen.add(l.seq), true));
  return add.length ? [...have, ...add].sort((a, b) => a.seq - b.seq) : (have as StudioLine[]);
}

export function StudioChatScreen({ onNavigate }: {
  /** The `open` press: navigates through the 39.1 router (`router.navigate`). */
  onNavigate: (route: string) => void;
}) {
  const [wake, setWake] = useState(0);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [lines, setLines] = useState<StudioLine[]>([]);
  const [streams, setStreams] = useState<Streams>({});
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [streamStatus, setStreamStatus] = useState<ChatStreamStatus | null>(null);
  // The two reads' errors, kept apart (both shown): a `GET /agents` answer never hides a failed `GET /chat`.
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Presses whose request went out (2xx) but whose press line failed, as `<reply seq>:<index>`: kept disabled here,
  // since a second press would repeat the request (a reply or an engagement; a `queue` press's line is the
  // supervisor's), and remembered per project in this tab's sessionStorage, so a reload keeps them disabled.
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const linesRef = useRef<StudioLine[]>(lines);
  linesRef.current = lines;
  // The shown project, read after an await: a send or press answered after a project switch writes nothing.
  const projectRef = useRef<string | null>(project);
  projectRef.current = project;
  // A failed first `GET /chat?project=` is read again on a wake (focus/visibility): `retry` re-runs the lines effect
  // only while no read of this project has landed (`chatLoaded`), so a healthy stream is never reopened.
  const [retry, setRetry] = useState(0);
  const chatLoaded = useRef(false);
  const resetFor = useRef<string | null | undefined>(undefined);

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

  // The served projects (`GET /agents`); the shown one is the remembered office project while it is served.
  useEffect(() => {
    let cancelled = false;
    void fetchAgents(null).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) return setAgentsError(ans.error);
      setAgentsError(null);
      const served = projectsFrom(ans.agents);
      setProjects((old) => (old && old.join("\n") === served.join("\n") ? old : served));
      setProject((p) => (p !== null && served.includes(p) ? p : rememberedProject(served)));
    });
    return () => {
      cancelled = true;
    };
  }, [wake]);

  // The project's CSRF token (`GET /inbox?project=`), read again on a wake; none disables Send and every press.
  useEffect(() => {
    if (project === null) return;
    let cancelled = false;
    void fetchInbox(project).then((ans) => {
      if (cancelled || !ans.ok) return;
      setCsrf(ans.csrf);
    });
    return () => {
      cancelled = true;
    };
  }, [project, wake]);

  // The project's engagements, for the "Engagement chats:" line.
  useEffect(() => {
    if (project === null) return;
    let cancelled = false;
    void fetchEngagements(project).then((ans) => {
      if (!cancelled && ans.ok) setEngagements(ans.engagements);
    });
    return () => {
      cancelled = true;
    };
  }, [project, wake]);

  useEffect(() => {
    if (project !== null && !chatLoaded.current) setRetry((n) => n + 1);
    // (on a wake only: the chat read has not landed for the shown project, whatever `GET /agents` answered)
  }, [wake]);

  // The lines (`GET /chat?project=`), then the stream after the last seq (lines and the reply text's deltas). The
  // screen's state is cleared on a project change only, not on a retry.
  useEffect(() => {
    if (resetFor.current !== project) {
      resetFor.current = project;
      setLines([]);
      setStreams({});
      setNotes({});
      setSent(project === null ? new Set() : rememberedSent(project));
      setChatError(null);
      setCsrf(null);
      setEngagements([]);
    }
    chatLoaded.current = false;
    if (project === null) return;
    let cancelled = false;
    let stream: { close(): void } | null = null;
    void fetchStudioChat(project).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) {
        setChatError(ans.error);
        return;
      }
      chatLoaded.current = true;
      setChatError(null);
      // the ref takes the fetched lines now: a frame arriving before the next render merges into them, not a stale ref
      linesRef.current = ans.lines;
      setLines(ans.lines);
      stream = openChatStream({
        project,
        since: ans.last_seq,
        onLine: (line: ChatLine) => {
          const next = merge(linesRef.current, [line as StudioLine]);
          linesRef.current = next;
          setLines(next);
          setStreams((s) => withoutAnswered(s, next));
        },
        onDelta: (delta) => setStreams((s) => withDelta(s, delta, linesRef.current)),
        onStatus: setStreamStatus,
      });
    });
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [project, retry]);

  const pressed = useMemo(() => new Set([...pressedKeys(lines), ...sent]), [lines, sent]);
  const length = codePoints(text);
  const canSend = project !== null && csrf !== null && !sending && text.trim() !== "" && length <= LINE_MAX_CHARS;

  const send = async () => {
    if (!canSend || project === null) return;
    const shown = project;
    setSending(true);
    setError(null);
    const r = await postStudioLine(shown, text, csrf);
    setSending(false);
    if (projectRef.current !== shown) return; // switched meanwhile: nothing lands on the other project's lines
    if (!r.ok) return setError(r.error); // the text is kept (LineTooLong, ChatBusy named)
    setText("");
    if (r.note) setNotes((n) => ({ ...n, [r.seq]: r.note! }));
  };

  const onPress = async (reply: StudioLine, b: StudioButton) => {
    if (project === null || sending || !b.enabled) return;
    const shown = project;
    setSending(true);
    setError(null);
    const r = await press(shown, reply.seq, b.index, b.action, csrf);
    setSending(false);
    if (!r.ok) {
      if (r.sent) {
        // remembered for the pressed project even after a switch; shown only while it is still the shown one
        const next = new Set(rememberedSent(shown)).add(`${reply.seq}:${b.index}`);
        rememberSent(shown, next);
        if (projectRef.current === shown) setSent((s) => new Set(s).add(`${reply.seq}:${b.index}`));
      }
      if (projectRef.current !== shown) return;
      return setError(r.sent ? sentUnrecordedText(r.error) : r.error);
    }
    if (projectRef.current !== shown) return;
    if (b.action.kind === "navigate") onNavigate(b.action.route);
  };

  const choose = (p: string) => {
    rememberProject(p);
    setProject(p);
  };

  return (
    <div style={page}>
      <div>
        Studio chat{" "}
        {projects && projects.length > 1 ? (
          <select value={project ?? ""} onChange={(e) => choose(e.target.value)} style={{ font }}>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        ) : (
          <span>{project ?? ""}</span>
        )}
        <span style={muted}> {project === null ? (projects === null ? "Loading…" : "No served project") : streamStatus ?? ""}</span>
      </div>
      {engagements.length > 0 && project !== null && (
        <div style={{ marginTop: 4 }}>
          Engagement chats:{" "}
          {engagements.map((e, i) => (
            <span key={e.id}>
              {i > 0 ? ", " : ""}
              <a
                href={routePath({ name: "engagement", id: e.id, project })}
                style={link}
                onClick={(ev) => {
                  ev.preventDefault();
                  onNavigate(routePath({ name: "engagement", id: e.id, project }));
                }}
              >
                {e.id}
              </a>
            </span>
          ))}
        </div>
      )}
      {agentsError && <div style={{ color: "#ff8080" }}>{agentsError}</div>}
      {chatError && <div style={{ color: "#ff8080" }}>{chatError}</div>}
      <div style={{ marginTop: 12 }}>
        {project !== null && lines.length === 0 && !chatError && <div style={muted}>No lines yet: ask the studio anything.</div>}
        {lines.map((line) => {
          const label = line.author === "owner" && !line.pressed ? pendingLabel(lines, line.seq) : null;
          const streaming = line.author === "owner" ? streams[line.seq] : undefined;
          return (
            <div key={line.seq} style={{ marginTop: 8 }}>
              <div style={{ color: line.author === "owner" ? "#9cf" : line.failed ? "#ff8080" : "#e8e8e8", whiteSpace: "pre-wrap" }}>
                <span style={muted}>{line.author === "owner" ? "you" : "studio"}: </span>
                {line.body}
              </div>
              {line.author === "planner" && (
                <div>
                  {studioButtons(project ?? "", line, pressed).map((b) => (
                    <button key={b.index} type="button" style={{ font, marginRight: 4, marginTop: 4 }} disabled={!b.enabled || sending || csrf === null} title={b.note ?? undefined} onClick={() => void onPress(line, b)}>
                      {b.label}
                      {b.note ? ` (${b.note})` : ""}
                    </button>
                  ))}
                </div>
              )}
              {notes[line.seq] && <div style={note}>{notes[line.seq]}</div>}
              {streaming && (
                <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                  <span style={muted}>studio: </span>
                  {streaming.text}
                  {CURSOR}
                </div>
              )}
              {label && !streaming && <div style={note}>{label}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <textarea
          value={text}
          rows={3}
          style={box}
          placeholder="Ask the studio: what is running, queue 38.2, answer DW-87 with A…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <div>
          <button type="button" style={{ font }} disabled={!canSend} onClick={() => void send()}>
            {sending ? "Sending…" : "Send"}
          </button>
          {length > LINE_COUNT_FROM && (
            <span style={length > LINE_MAX_CHARS ? { color: "#ff8080" } : muted}> {length.toLocaleString("en-US")} / {LINE_MAX_CHARS.toLocaleString("en-US")}</span>
          )}
          {csrf === null && project !== null && <span style={muted}> Waiting for the page's token…</span>}
        </div>
        {error && <div style={{ color: "#ff8080", whiteSpace: "pre-wrap" }}>{error}</div>}
      </div>
    </div>
  );
}
