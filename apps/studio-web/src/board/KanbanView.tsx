// The kanban (Story 39.4, addendum §3.1.7, D5 "desktop and iPad first"): one column per canonical status, a card per
// story, and HTML5 drag and drop — every card `draggable`, `dragover`/`drop` on each column; desktop browsers and iPadOS
// Safari (by long-press) support it natively, with no dependency. The dragged card is kept in component state;
// `dragstart` also sets the card id as `text/plain` on `dataTransfer` (Firefox and iPadOS Safari lift no drag without
// data), though the drop reads the state. From `dragstart` until the drop resolves the strip reads `DRAG_HINT`; `dropRule`
// decides: the same column nothing, `draft → ready` a post through `requestReady` (the CSRF token from `GET /inbox`; a
// failed inbox read posts nothing), anything else refused in the page with its reason (never posted). A card click opens `/app/story/<id>?project=<project>` through the router.
import { useState } from "react";
import type { LiveState } from "../live/store";
import { fetchInbox } from "../inbox/model";
import { DRAG_HINT, dropRule, kanbanColumns, requestingText, requestReady, statusAnswerText, type BoardAnswer, type KanbanCard } from "./model";

const link = { color: "#9cf" } as const;

export function KanbanView({ board, live, project, epic, onOpen, onRefetch }: {
  board: BoardAnswer; live: LiveState; project: string; epic: string | null;
  onOpen: (path: string) => void; onRefetch: () => void;
}) {
  const [dragged, setDragged] = useState<KanbanCard | null>(null);
  const [strip, setStrip] = useState<{ text: string; tone: "hint" | "refused" | "ok" } | null>(null);
  const [busy, setBusy] = useState(false);
  const columns = kanbanColumns(board, live, project, epic);

  const drop = async (to: string) => {
    const card = dragged;
    setDragged(null);
    if (!card) return;
    const rule = dropRule(card.status, to);
    if (rule.kind === "none") return setStrip(null);
    if (rule.kind === "refused") return setStrip({ text: rule.reason, tone: "refused" });
    setBusy(true);
    setStrip({ text: requestingText(card.id), tone: "hint" });
    const res = await requestReady(project, card.id, fetchInbox);
    setBusy(false);
    setStrip({ text: statusAnswerText(card.id, res), tone: res.ok ? "ok" : "refused" });
    // D9: the board re-read after any answered post (a 409 means the board may be stale); not after a network failure
    // or a failed token read (neither answered).
    if (res.ok || res.status !== null) onRefetch();
  };

  return (
    <div>
      {(dragged || strip) && (
        <div
          role="status"
          style={{ margin: "8px 0", padding: "4px 8px", borderRadius: 4, background: "#202020", color: strip?.tone === "refused" ? "#ff8080" : strip?.tone === "ok" ? "#80d080" : "#e0b040" }}
        >
          {dragged ? DRAG_HINT : strip?.text}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", alignItems: "flex-start", marginTop: 8 }}>
        {columns.map((c) => (
          <div
            key={c.status}
            data-column={c.status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) void drop(c.status);
            }}
            style={{ flex: "1 0 180px", minWidth: 180, minHeight: 120, background: "#202020", padding: 8, borderRadius: 4 }}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>
              {c.title} ({c.cards.length})
            </h3>
            {c.cards.map((card) => (
              <div
                key={card.id}
                data-story={card.id}
                draggable={!busy}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", card.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragged(card);
                  setStrip(null);
                }}
                onDragEnd={() => setDragged(null)}
                onClick={() => onOpen(card.path)}
                style={{ marginBottom: 8, padding: 6, background: "#2a2a2a", borderRadius: 4, cursor: "pointer", border: card.needsYou ? "1px solid #e0b040" : "1px solid transparent" }}
              >
                <div>
                  <span title={card.epic.title} style={{ fontSize: 11, padding: "0 4px", background: "#3a3a3a", borderRadius: 3 }}>
                    {card.epic.id}
                  </span>
                  {card.needsYou && <span style={{ marginLeft: 6, color: "#e0b040" }}>Needs you</span>}
                  {card.statusWord && <span style={{ marginLeft: 6, color: "#c9a227" }}>({card.statusWord})</span>}
                </div>
                <div>{card.heading}</div>
                <div>
                  <strong>{card.title}</strong>
                </div>
                <div style={{ color: "#aaa" }}>
                  {card.band} · {card.jira}
                </div>
                <div style={{ color: "#aaa" }}>
                  {card.pr.href ? (
                    <a href={card.pr.href} target="_blank" rel="noreferrer" style={link} onClick={(e) => e.stopPropagation()}>
                      {card.pr.text}
                    </a>
                  ) : (
                    card.pr.text
                  )}{" "}
                  · {card.cost}
                </div>
                {card.stage !== null && <div style={{ color: "#c9a227" }}>stage {card.stage}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
