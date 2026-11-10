// The Sandbox login card (Story 39.2, CAP-6): the sandbox's Claude login clock and its two-step renewal. It reads
// `GET /sandbox/login` and `GET /status` when shown and every minute while open (`POLL_MS`), and once more after a
// renewal. Renew (gated with its reason shown: `renewGate`) starts the sign-in; the card then shows the "Open sign-in"
// link (a new tab: the owner approves on whichever device holds his claude.ai session), the code field and Send; the
// result line says what happened. Renew stays shut while that sign-in is open (until its `expires_at`), and only an
// answer that closes the login takes the link and the field away. The URL and the code are component state only. The rules are in `login.ts`.
import { useEffect, useReducer, useState } from "react";
import {
  canSendCode, cardLine, CODE_LABEL, fetchHolders, fetchLogin, flowReducer, initialFlow, OPEN_SIGN_IN, POLL_MS, postCode, postStart, renewGate,
  type Flow, type FlowEvent, type LiveRun, type LoginReading,
} from "./login";

const font = "13px/1.4 ui-monospace, Menlo, Consolas, monospace";
const TONE = { plain: "#e8e8e8", amber: "#e0b040", red: "#ff6b6b" } as const;

export function LoginCard() {
  const [reading, setReading] = useState<LoginReading | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [holders, setHolders] = useState<LiveRun[]>([]);
  const [flow, dispatch] = useReducer((f: Flow, e: FlowEvent) => flowReducer(f, e), initialFlow);
  const [wake, setWake] = useState(0);

  // The read now, then every minute while the card is open; `wake` reads once more (after a renewal).
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const [r, live] = await Promise.all([fetchLogin(), fetchHolders()]);
      if (cancelled) return;
      if (r.csrf) setCsrf(r.csrf);
      setHolders(live);
      if (r.ok) { setReading(r.reading); setReadError(null); } else setReadError(r.error);
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wake]);

  useEffect(() => {
    if (flow.renewed) setWake((n) => n + 1);
  }, [flow.renewed]);

  const line = cardLine(reading, readError);
  const gate = renewGate({ csrf, reading, holders, inProgress: flow.inProgress, open: flow.start, busy: flow.busy, now: Date.now(), readError });

  const renew = async () => {
    if (!gate.enabled || !reading) return;
    dispatch({ type: "send" });
    dispatch({ type: "started", answer: await postStart(reading.sandbox, csrf) });
  };
  const send = async () => {
    if (!flow.start || !canSendCode(flow.code, flow.busy)) return;
    dispatch({ type: "send" });
    const r = await postCode(flow.start.login_id, flow.code, csrf);
    dispatch({ type: "coded", answer: r });
  };

  return (
    <section style={{ border: "1px solid #444", borderRadius: 6, padding: 12, marginBottom: 16, maxWidth: 720 }}>
      <h2 style={{ font: "bold 14px ui-monospace, Menlo, Consolas, monospace", margin: "0 0 8px" }}>Sandbox login{reading ? ` (${reading.sandbox})` : ""}</h2>
      <div style={{ color: TONE[line.tone] }}>{line.text}</div>
      <div style={{ marginTop: 8 }}>
        <button type="button" onClick={() => void renew()} disabled={!gate.enabled} style={{ font }}>Renew</button>
        {!gate.enabled && <span style={{ marginLeft: 8, color: "#aaa" }}>{gate.reason}</span>}
      </div>
      {flow.start && (
        <div style={{ marginTop: 8 }}>
          <div>
            <a href={flow.start.url} target="_blank" rel="noopener noreferrer" style={{ color: "#9cf" }}>{OPEN_SIGN_IN}</a>
          </div>
          <label style={{ display: "block", marginTop: 8 }}>
            {CODE_LABEL}
            <input
              type="text" value={flow.code} autoComplete="off" spellCheck={false}
              onChange={(e) => dispatch({ type: "typed", code: e.target.value })}
              style={{ display: "block", width: "100%", font, marginTop: 4 }}
            />
          </label>
          <button type="button" onClick={() => void send()} disabled={!canSendCode(flow.code, flow.busy)} style={{ font, marginTop: 4 }}>Send</button>
        </div>
      )}
      {flow.result !== null && <div style={{ marginTop: 8 }}>{flow.result}</div>}
    </section>
  );
}
