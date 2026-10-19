// The spike's page (Story 30.1): a container filling the viewport, the PixiJS canvas inside it,
// and a React DOM HUD over the canvas showing the zoom, the device pixel ratio and the frame rate.
import { useEffect, useRef, useState } from "react";
import type { Application } from "pixi.js";
import { createApp, layoutScene, loadSheet, type Scene, type Sheet } from "./renderer/scene";

interface Hud {
  zoom: number;
  ratio: number;
  fps: number;
}

const currentRatio = (): number => window.devicePixelRatio || 1;

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({ zoom: 0, ratio: currentRatio(), fps: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let app: Application | null = null;
    let sheet: Sheet | null = null;
    let scene: Scene | undefined;
    let fpsTimer: number | undefined;
    let ratioQuery: MediaQueryList | null = null;

    // A ratio change with no window resize (a drag to another monitor) fires only a media query
    // change: relayout at the new ratio, then re-arm the query for that ratio.
    const onRatioChange = () => {
      relayout();
      watchRatio();
    };
    const watchRatio = () => {
      ratioQuery?.removeEventListener("change", onRatioChange);
      ratioQuery = window.matchMedia(`(resolution: ${currentRatio()}dppx)`);
      ratioQuery.addEventListener("change", onRatioChange);
    };

    const relayout = () => {
      if (!app || !sheet) return;
      const ratio = currentRatio();
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (app.renderer.resolution !== ratio) app.renderer.resize(width, height, ratio);
      scene = layoutScene(app.stage, sheet, ratio, width, height, scene);
      setHud((h) => ({ ...h, zoom: scene!.zoom, ratio }));
    };

    (async () => {
      try {
        const created = await createApp(container, currentRatio());
        if (cancelled) {
          created.destroy(true, { children: true });
          return;
        }
        app = created;
        sheet = await loadSheet();
        if (cancelled) return;
        relayout();
        app.renderer.on("resize", relayout);
        fpsTimer = window.setInterval(() => {
          if (app) setHud((h) => ({ ...h, fps: app!.ticker.FPS }));
        }, 1000);
      } catch (exc) {
        if (!cancelled) setError(String(exc));
      }
    })();

    window.addEventListener("resize", relayout);
    watchRatio();
    return () => {
      cancelled = true;
      window.removeEventListener("resize", relayout);
      ratioQuery?.removeEventListener("change", onRatioChange);
      ratioQuery = null;
      if (fpsTimer !== undefined) window.clearInterval(fpsTimer);
      if (app) {
        app.renderer.off("resize", relayout);
        app.destroy(true, { children: true });
        app = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "4px 8px",
          font: "12px/1.4 ui-monospace, Menlo, Consolas, monospace",
          color: "#f4f4f4",
          background: "rgba(0, 0, 0, 0.6)",
          borderRadius: 4,
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        <div>zoom {hud.zoom}x</div>
        <div>ratio {hud.ratio}</div>
        <div>fps {hud.fps.toFixed(0)}</div>
        {error && <div style={{ color: "#ff8080" }}>error {error}</div>}
      </div>
    </div>
  );
}
