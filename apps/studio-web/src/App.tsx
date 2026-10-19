// The page. Story 30.1's spike: a container filling the viewport, the PixiJS canvas inside it, and a
// React DOM debug HUD over the canvas showing the zoom, the device pixel ratio and the frame rate.
// Story 30.3: the tab's one office stream folds into one store; the debug HUD shows the stream's status.
// Story 30.4: the canvas is the Office screen (`office/OfficeScreen.tsx`), fed by that one store.
import { useEffect, useState, useSyncExternalStore } from "react";
import { createOfficeStore, LIVE_RUN_STATES } from "./live/store";
import { openOfficeStream } from "./live/stream";
import { OfficeScreen, type CanvasStats } from "./office/OfficeScreen";

/** The tab's one store (module-level: it outlives StrictMode's remount, so the view is never cleared). */
const officeStore = createOfficeStore();
const STREAM_LABEL = { live: "stream live", connecting: "connecting", reconnecting: "reconnecting" } as const;

export function App() {
  const [hud, setHud] = useState<CanvasStats>({ zoom: 0, ratio: window.devicePixelRatio || 1, fps: 0 });
  const live = useSyncExternalStore(officeStore.subscribe, officeStore.getState);

  // One EventSource per mount, closed in the cleanup: StrictMode's double mount leaves one open.
  useEffect(() => {
    const stream = openOfficeStream(officeStore);
    return () => stream.close();
  }, []);

  return (
    <>
      <OfficeScreen store={officeStore} onStats={setHud} />
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
