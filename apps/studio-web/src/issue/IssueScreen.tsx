// The Issue screen (Story 31.6, design spec §6.9 items 3 and 4): one issue shown the way Jira would — its status,
// the story's run and PR when the plan links one, the cost from the ledger when known, and the comments in order
// with author and time — then a reply box with Send (disabled while empty) and Done. A reply or Done goes through the
// supervisor's `POST /inbox/{key}/reply` (posted as the owner, with the owner's host-only token) with the CSRF token
// the read answered; on success the screen says "sent; it leaves the Inbox on the next sync-back" and writes no local
// state. With no issue chosen it says "Choose an item in the Inbox". Send and Done wait for the loaded view and its
// CSRF token, and stay disabled once a reply was sent — or once a refusal or retry says the comment landed (its error
// still shown) — until another issue is chosen; choosing another issue clears
// the reply box, the notice and the token. The rules are in `model.ts`.
import { useEffect, useMemo, useRef, useState } from "react";
import { CHOOSE_TEXT, canAct, canSendReply, fetchIssue, issueView, postReply, sentAfter, type IssueAnswer, type IssueRef, type ReplyPayload } from "./model";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const link = { color: "#9cf" } as const;

export function IssueScreen({ issue }: { issue: IssueRef | null }) {
  const [answer, setAnswer] = useState<IssueAnswer | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [wake, setWake] = useState(0);
  const current = useRef<string | null>(null);
  const refOf = (r: IssueRef | null) => (r ? JSON.stringify([r.project, r.key]) : null);

  // Another issue chosen: nothing typed, sent or authorised for the last one carries over.
  useEffect(() => {
    current.current = refOf(issue);
    setText("");
    setNotice(null);
    setCsrf(null);
    setError(null);
    setAnswer(null);
    setSent(false);
    setSending(false);
  }, [issue?.project, issue?.key]);

  useEffect(() => {
    if (!issue) return;
    let cancelled = false;
    void fetchIssue(issue.project, issue.key).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setError(r.error);
      setError(null);
      setAnswer(r.answer);
      setCsrf(r.csrf);
    });
    return () => {
      cancelled = true;
    };
  }, [issue?.project, issue?.key, wake]);

  const shown = answer && issue && answer.project === issue.project && answer.issue.key === issue.key ? answer : null;
  const view = useMemo(() => (shown ? issueView(shown) : null), [shown]);

  const gate = { loaded: view !== null, csrf, sending, sent };
  const send = async (payload: ReplyPayload) => {
    if (!issue || !canAct(gate)) return;
    const target = refOf(issue);
    setSending(true);
    setNotice(null);
    const r = await postReply(issue.project, issue.key, payload, csrf);
    if (current.current !== target) return; // the issue changed meanwhile: this answer is not shown
    setSending(false);
    if (!r.ok) {
      setError(r.error);
      // The comment landed before the refusal or retry: another press would post a duplicate.
      if (sentAfter(r)) {
        setSent(true);
        setText("");
        setWake((n) => n + 1);
      }
      return;
    }
    setError(null);
    setNotice(r.notice);
    setSent(true);
    setText("");
    setWake((n) => n + 1);
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "48px 16px 16px", font, color: "#e8e8e8", background: "#161616" }}>
      {!issue ? (
        <div style={{ color: "#9a9a9a" }}>{CHOOSE_TEXT}</div>
      ) : (
        <>
          <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>
            {issue.key} {view ? `· ${view.title}` : ""}
          </h2>
          <div style={{ color: "#9a9a9a" }}>project {issue.project}</div>
          {error && <div style={{ color: "#ff8080" }}>error {error}</div>}
          {notice && <div style={{ color: "#7fd18a" }}>{notice}</div>}
          {view && (
            <>
              <div style={{ marginTop: 8 }}>
                status <strong>{view.status}</strong>
              </div>
              <div>
                {view.run ? (
                  <>
                    run {view.run.run_id} · {view.run.state} ·{" "}
                    {view.run.href ? (
                      <a href={view.run.href} target="_blank" rel="noreferrer" style={link}>
                        PR
                      </a>
                    ) : (
                      "no PR"
                    )}
                  </>
                ) : (
                  "no run"
                )}
              </div>
              <div>cost {view.cost}</div>
              <section style={{ marginTop: 12 }}>
                {view.comments.map((c) => (
                  <div key={c.id} style={{ marginBottom: 10, padding: 8, background: c.author === "owner" ? "#1f2a36" : "#222", borderRadius: 4 }}>
                    <div style={{ color: "#9a9a9a" }}>
                      {c.author} · {c.time}
                      {c.edited ? " · edited" : ""}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
                  </div>
                ))}
              </section>
            </>
          )}
          <section style={{ marginTop: 12 }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Reply as the owner"
              style={{ width: "100%", boxSizing: "border-box", font, background: "#101010", color: "#e8e8e8", border: "1px solid #333" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="button" disabled={!canSendReply(text, gate)} onClick={() => void send({ body: text })} style={{ font }}>
                Send
              </button>
              <button type="button" disabled={!canAct(gate)} onClick={() => void send({ done: true })} style={{ font }}>
                Done
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
