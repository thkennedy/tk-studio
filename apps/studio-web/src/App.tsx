// The page. Story 30.1's spike: a container filling the viewport, the PixiJS canvas inside it, and a
// React DOM debug HUD over the canvas showing the zoom, the device pixel ratio and the frame rate.
// Story 30.3: the tab's one office stream folds into one store; the debug HUD shows the stream's status.
// Story 30.4: the canvas is the Office screen (`office/OfficeScreen.tsx`), fed by that one store.
// Story 30.5: a minimal Office / Board switch mounting one screen at a time; both screens read the one store, and the
// one stream stays open across the switch.
// Story 30.6: the web is the home (`GET /` answers this index.html). The Status screen joins the switch, and the
// screen shown is remembered per browser (`screen.ts`, Office by default). Still one screen mounted at a time: the
// Office canvas (the one Pixi Application) exists only while the Office screen is shown.
// Story 31.6: the Inbox and the Issue screens join the switch. The inbox rows are read here (`useInbox`), so the
// open-item count sits on the Inbox nav item whichever screen is shown (no count for an empty inbox); choosing a row
// opens the Issue screen for it, remembered per browser (`issue/model.ts`).
// Story 32.7: the Chat screen joins the switch. Its nav count is the office store's engagements (snapshot +
// `office.engagement` deltas) in `awaiting-answers` or `quoted`, across projects (none: no count, as the Inbox); the
// same rows are passed to the Chat screen, which refetches its list and open record when they change.
// Story 39.1: the web has addresses (addendum §3.3). The screen is the URL under `/app` (`screen.ts`'s route table,
// read through one module-level router over the History API with `useSyncExternalStore`): the nav pushes its path,
// back and forward switch screens, `/app` (and a client-side `/`) is replaced by `/app/office`, the screens not built
// yet show "Not built yet: Story 39.N", and `/app/chat` keeps the engagement Chat screen under that strip. The two
// remembered keys (`tk-studio.web.screen`, `tk-studio.web.issue`) are migrated once at load and never written again.
// Story 39.2: `/app/settings` mounts the Settings screen (the Sandbox login card first, then 39.8's named placeholder).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createOfficeStore, LIVE_RUN_STATES } from "./live/store";
import { openOfficeStream } from "./live/stream";
import { BoardScreen } from "./board/BoardScreen";
import { ChatScreen } from "./chat/ChatScreen";
import { chatNavCount, rememberedEngagement } from "./chat/model";
import { InboxScreen, useInbox } from "./inbox/InboxScreen";
import { navCount } from "./inbox/model";
import { IssueScreen } from "./issue/IssueScreen";
import { OfficeScreen, type CanvasStats } from "./office/OfficeScreen";
import {
  createRouter, engagementRefFor, isLanding, issueRefFor, migrateRemembered, NAV, navActive, notFoundText, PLACEHOLDER, routePath, type Route,
} from "./screen";
import { SettingsScreen } from "./settings/SettingsScreen";
import { StatusScreen } from "./status/StatusScreen";

/** The tab's one store (module-level: it outlives StrictMode's remount, so the view is never cleared). */
const officeStore = createOfficeStore();
/** The tab's one router (module-level, beside the store); the remembered screen is carried once onto the landing. */
const router = createRouter(window);
const carried = migrateRemembered();
if (carried !== null && isLanding(router.current().route)) router.navigate(carried, { replace: true });
const STREAM_LABEL = { live: "stream live", connecting: "connecting", reconnecting: "reconnecting" } as const;
const font = "12px ui-monospace, Menlo, Consolas, monospace";
const pageText = { position: "absolute", inset: 0, padding: "48px 16px 16px", font: "13px/1.4 ui-monospace, Menlo, Consolas, monospace", color: "#e8e8e8", background: "#161616" } as const;

const go = (route: Route, replace = false) => router.navigate(routePath(route), { replace });

export function App() {
  const [hud, setHud] = useState<CanvasStats>({ zoom: 0, ratio: window.devicePixelRatio || 1, fps: 0 });
  const live = useSyncExternalStore(officeStore.subscribe, officeStore.getState);
  const { route, path } = useSyncExternalStore(router.subscribe, router.current);
  const inbox = useInbox(officeStore);
  const count = navCount(inbox.rows);
  const chatCount = chatNavCount(live.view?.engagements);
  const openIssue = (project: string, key: string) => go({ name: "issue", key, project });
  // `/app/chat/<id>`'s engagement (`?project=`, else the store's single project for the id, else, once the store's
  // snapshot is in, the remembered one; before the snapshot no project, so the Chat screen waits).
  const resolved = route.name === "engagement" ? engagementRefFor(route, live.view?.engagements, rememberedEngagement()?.project ?? null) : null;
  const openId = resolved?.id ?? null;
  const openProject = resolved?.project ?? null;
  const open = useMemo(() => (openId === null ? null : { id: openId, project: openProject }), [openId, openProject]);

  // One EventSource per mount, closed in the cleanup: StrictMode's double mount leaves one open.
  useEffect(() => {
    const stream = openOfficeStream(officeStore);
    return () => stream.close();
  }, []);

  return (
    <>
      {route.name === "office" ? (
        <OfficeScreen store={officeStore} onStats={setHud} project={route.project} onProject={(p, replace) => go({ name: "office", project: p }, replace)} />
      ) : route.name === "board" ? (
        <BoardScreen store={officeStore} project={route.project} onProject={(p, replace) => go({ name: "board", project: p }, replace)} />
      ) : route.name === "inbox" ? (
        <InboxScreen rows={inbox.rows} errors={inbox.errors} loaded={inbox.loaded} onOpen={openIssue} />
      ) : route.name === "issue" ? (
        <IssueRoute route={route} rows={inbox.rows} errors={inbox.errors} loaded={inbox.loaded} />
      ) : route.name === "chat" || route.name === "engagement" ? (
        <>
          <ChatScreen engagements={live.view?.engagements} open={open} onOpen={(ref) => go({ name: "engagement", id: ref.id, project: ref.project })} onClose={(replace) => go({ name: "chat" }, replace)} />
          {route.name === "chat" && (
            <div style={{ position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", padding: "4px 8px", font, color: "#e0b040", background: "rgba(0, 0, 0, 0.6)", borderRadius: 4, zIndex: 2 }}>
              {PLACEHOLDER.chat}
            </div>
          )}
        </>
      ) : route.name === "status" ? (
        <StatusScreen store={officeStore} />
      ) : route.name === "settings" ? (
        <SettingsScreen />
      ) : route.name === "story" || route.name === "run" || route.name === "checkin" ? (
        <div style={pageText}>{PLACEHOLDER[route.name]}</div>
      ) : (
        <div style={pageText}>{notFoundText(route.path)}</div>
      )}
      <nav style={{ position: "fixed", bottom: 8, left: 8, display: "flex", gap: 4, zIndex: 2 }}>
        {NAV.map((n) => (
          <button key={n.path} type="button" onClick={() => router.navigate(n.path)} disabled={navActive(route, n)} style={{ font }}>
            {n.label}
            {n.count === "inbox" && count !== null ? ` (${count})` : ""}
            {n.count === "chat" && chatCount !== null ? ` (${chatCount})` : ""}
          </button>
        ))}
      </nav>
      <div
        style={{
          position: "fixed",
          top: 8,
          left: 8,
          padding: "4px 8px",
          font: "12px/1.4 ui-monospace, Menlo, Consolas, monospace",
          color: "#f4f4f4",
          background: "rgba(0, 0, 0, 0.6)",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        <div>zoom {hud.zoom}x</div>
        <div>ratio {hud.ratio}</div>
        <div>fps {hud.fps.toFixed(0)}</div>
        <div>
          {STREAM_LABEL[live.status]} · agents {live.view?.agents.length ?? 0} · live runs {live.view?.runs.filter((r) => r.state !== null && LIVE_RUN_STATES.has(r.state)).length ?? 0}
        </div>
      </div>
    </>
  );
}

/** `/app/inbox/<KEY>`: the Issue screen once the project is known (`?project=`, else the inbox row's; once resolved for
 * the key it is kept while the route stays on it, so an answered issue whose row leaves the inbox stays open). */
function IssueRoute({ route, rows, errors, loaded }: { route: { key: string; project: string | null }; rows: readonly { project: string; key: string }[]; errors: readonly string[]; loaded: boolean }) {
  const kept = useRef<{ key: string; project: string } | null>(null);
  const r = issueRefFor(route, rows, loaded, errors, kept.current?.key === route.key ? kept.current.project : null);
  const project = "ref" in r ? r.ref.project : null;
  if (project !== null) kept.current = { key: route.key, project };
  const issue = useMemo(() => (project !== null ? { project, key: route.key } : null), [project, route.key]);
  if (!("ref" in r)) return <div style={{ ...pageText, whiteSpace: "pre-wrap" }}>{r.text}</div>;
  return <IssueScreen issue={issue} />;
}
