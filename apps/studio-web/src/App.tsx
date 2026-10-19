// The page. Story 30.1's spike: a container filling the viewport, the PixiJS canvas inside it, and a
// React DOM debug HUD over the canvas showing the zoom, the device pixel ratio and the frame rate.
// Story 30.3: the tab's one office stream folds into one store; the debug HUD shows the stream's status.
// Story 30.4: the canvas is the Office screen (`office/OfficeScreen.tsx`), fed by that one store.
// Story 30.5: a minimal Office / Board switch mounting one screen at a time; both screens read the one store, and the
// one stream stays open across the switch.
// Story 30.6: the web is the home (`GET /` answers this index.html). The Status screen joins the switch, and the
// screen shown is remembered per browser (`screen.ts`, Office by default). Still one screen mounted at a time: the
// Office canvas (the one Pixi Application) exists only while the Office screen is shown.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createOfficeStore, LIVE_RUN_STATES } from "./live/store";
import { openOfficeStream } from "./live/stream";
import { BoardScreen } from "./board/BoardScreen";
import { OfficeScreen, type CanvasStats } from "./office/OfficeScreen";
import { rememberedScreen, rememberScreen, SCREENS, type Screen } from "./screen";
import { StatusScreen } from "./status/StatusScreen";

/** The tab's one store (module-level: it outlives StrictMode's remount, so the view is never cleared). */
const officeStore = createOfficeStore();
const STREAM_LABEL = { live: "stream live", connecting: "connecting", reconnecting: "reconnecting" } as const;
const SCREEN_LABEL: Record<Screen, string> = { office: "Office", board: "Board", status: "Status" };

export function App() {
  const [hud, setHud] = useState<CanvasStats>({ zoom: 0, ratio: window.devicePixelRatio || 1, fps: 0 });
  const live = useSyncExternalStore(officeStore.subscribe, officeStore.getState);
  const [screen, setScreenState] = useState<Screen>(() => rememberedScreen());
  const setScreen = (s: Screen) => {
    setScreenState(s);
    rememberScreen(s);
  };

  // One EventSource per mount, closed in the cleanup: StrictMode's double mount leaves one open.
  useEffect(() => {
    const stream = openOfficeStream(officeStore);
    return () => stream.close();
  }, []);

  return (
    <>
      {screen === "office" ? (
        <OfficeScreen store={officeStore} onStats={setHud} />
      ) : screen === "board" ? (
        <BoardScreen store={officeStore} />
      ) : (
        <StatusScreen store={officeStore} />
      )}
      <nav style={{ position: "fixed", bottom: 8, left: 8, display: "flex", gap: 4, zIndex: 2 }}>
        {SCREENS.map((s) => (
          <button key={s} type="button" onClick={() => setScreen(s)} disabled={s === screen} style={{ font: "12px ui-monospace, Menlo, Consolas, monospace" }}>
            {SCREEN_LABEL[s]}
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
