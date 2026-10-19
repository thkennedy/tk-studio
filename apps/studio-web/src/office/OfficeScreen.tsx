// The Office screen (Story 30.4, design spec §6.3, §7.3): the selected project's registry agents
// (`GET /agents?project=<id>`) as characters at desks on the PixiJS floor, posed by the store's
// office state; a React DOM bubble over a `waiting-for-human` or `blocked` character naming the
// projection's reason; the HUD (the run in flight, or the last ended run); the project switcher
// (`GET /agents`, remembered per browser). The rules are in `model.ts`, the canvas in `scene.ts`:
// a state change is `setPose` on the same sprite, never a rebuild.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Application } from "pixi.js";
import type { OfficeStore } from "../live/store";
import {
  createApp, layoutScene, loadSheet, syncDesks, TILE, type PlacedDesks, type Scene, type Sheet,
} from "../renderer/scene";
import {
  bubbleFor, desksFrom, fetchAgents, hudModel, projectsFrom, rememberedProject, rememberProject, type RegistryRow,
} from "./model";

export interface CanvasStats {
  zoom: number;
  ratio: number;
  fps: number;
}

const currentRatio = (): number => window.devicePixelRatio || 1;

/** A desk's anchors in CSS pixels: the character's top centre and the desk's bottom. */
interface Spot {
  agent_id: string;
  x: number;
  y: number;
  bottom: number;
}

const panel = {
  position: "absolute",
  padding: "4px 8px",
  font: "12px/1.4 ui-monospace, Menlo, Consolas, monospace",
  color: "#f4f4f4",
  background: "rgba(0, 0, 0, 0.6)",
  borderRadius: 4,
  zIndex: 1,
} as const;

/** Bubbles stack above the HUD panel (1) and App's debug panel (2). */
const BUBBLE_Z = 3;

export function OfficeScreen({ store, onStats }: { store: OfficeStore; onStats?: (s: CanvasStats) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const live = useSyncExternalStore(store.subscribe, store.getState);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The canvas's own failure (Pixi startup, the sheet): never cleared by the fetches. */
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [spots, setSpots] = useState<Spot[]>([]);

  const desks = useMemo(() => desksFrom(rows, live.view?.agents), [rows, live.view]);
  const desksRef = useRef(desks);
  desksRef.current = desks;
  /** Re-sync the canvas to the latest desks (set by the Pixi effect once the sheet is loaded). */
  const syncRef = useRef<(() => void) | null>(null);

  // The project list (`GET /agents`) and the remembered choice.
  useEffect(() => {
    let cancelled = false;
    void fetchAgents(null).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) return setError(ans.error);
      const list = projectsFrom(ans.agents);
      setProjects(list);
      setProject(rememberedProject(list));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The selected project's desks (`GET /agents?project=<id>`).
  useEffect(() => {
    if (project === null) return;
    // The old project's desks and bubbles leave at once, not when the new fetch resolves.
    setRows([]);
    let cancelled = false;
    void fetchAgents(project).then((ans) => {
      if (cancelled) return;
      if (!ans.ok) {
        setError(ans.error);
        setRows([]);
        return;
      }
      setError(null);
      setRows(ans.agents);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  // "The time since the last event" ticks once a second.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // A pose change swaps frames in place; a new desk set rebuilds only the desks.
  useEffect(() => {
    syncRef.current?.();
  }, [desks]);

  // The one canvas: the floor, the desks, the poses.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let app: Application | null = null;
    let sheet: Sheet | null = null;
    let scene: Scene | undefined;
    let placed: PlacedDesks | null = null;
    let fpsTimer: number | undefined;
    let ratioQuery: MediaQueryList | null = null;
    let stats: CanvasStats = { zoom: 0, ratio: currentRatio(), fps: 0 };
    const report = (s: Partial<CanvasStats>) => {
      stats = { ...stats, ...s };
      onStats?.(stats);
    };

    /** The desks to the latest desk set (`syncDesks`: poses in place, a new set rebuilt); `fresh` drops the
     * placed desks first (a relayout). The spots follow a rebuild only. */
    const sync = (fresh = false) => {
      if (!scene || !sheet) return;
      if (fresh && placed) {
        placed.container.destroy({ children: true });
        placed = null;
      }
      const before = placed;
      const cols = Math.max(3, Math.floor(container.clientWidth * currentRatio() / (TILE * scene.zoom)));
      placed = syncDesks(scene.world, sheet, placed, desksRef.current, { cols });
      if (placed === before) return;
      const scale = scene.world.scale.x;
      setSpots(placed.desks.map((d) => ({
        agent_id: d.agent_id,
        x: (d.col * TILE + TILE / 2) * scale,
        y: d.row * TILE * scale,
        bottom: (d.row * TILE + TILE + TILE / 2) * scale,
      })));
    };

    const onRatioChange = () => {
      relayout();
      watchRatio();
    };
    const watchRatio = () => {
      ratioQuery?.removeEventListener("change", onRatioChange);
      ratioQuery = window.matchMedia(`(resolution: ${currentRatio()}dppx)`);
      ratioQuery.addEventListener("change", onRatioChange);
    };

    // A resize rebuilds the world (`layoutScene`), then the desks; a pose change never does.
    const relayout = () => {
      if (!app || !sheet) return;
      const ratio = currentRatio();
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (app.renderer.resolution !== ratio) app.renderer.resize(width, height, ratio);
      placed = null; // destroyed with the old world
      scene = layoutScene(app.stage, sheet, ratio, width, height, scene);
      scene.character.visible = false; // the spike's lone character: the desks hold the agents now
      sync(true);
      report({ zoom: scene.zoom, ratio });
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
        syncRef.current = () => sync();
        app.renderer.on("resize", relayout);
        fpsTimer = window.setInterval(() => {
          if (app) report({ fps: app.ticker.FPS });
        }, 1000);
      } catch (exc) {
        if (!cancelled) setCanvasError(String(exc));
      }
    })();

    window.addEventListener("resize", relayout);
    watchRatio();
    return () => {
      cancelled = true;
      syncRef.current = null;
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
  }, [onStats]);

  const hud = project !== null ? hudModel(live, project, now) : null;
  const spotOf = new Map(spots.map((s) => [s.agent_id, s]));

  return (
    // Absolute, not fixed: a fixed root would be its own stacking context, so no bubble could rise
    // above the debug panel (App) laid over it.
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {desks.map((d) => {
        const spot = spotOf.get(d.agent_id);
        if (!spot) return null;
        const bubble = bubbleFor(d);
        return (
          <div key={d.agent_id}>
            {bubble !== null && (
              <div
                data-agent={d.agent_id}
                style={{
                  ...panel,
                  left: spot.x,
                  top: spot.y - 4,
                  transform: "translate(-50%, -100%)",
                  maxWidth: 220,
                  whiteSpace: "normal",
                  background: d.state === "blocked" ? "rgba(140, 20, 20, 0.85)" : "rgba(120, 90, 0, 0.85)",
                  pointerEvents: "none",
                  // Above every panel (the HUD here, the debug panel in App), never hidden under one.
                  zIndex: BUBBLE_Z,
                }}
              >
                {bubble}
              </div>
            )}
            <div
              style={{
                position: "absolute",
                left: spot.x,
                top: spot.bottom + 2,
                transform: "translate(-50%, 0)",
                font: "11px/1 ui-monospace, Menlo, Consolas, monospace",
                color: "#f4f4f4",
                textShadow: "0 1px 2px #000",
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              {d.role}
            </div>
          </div>
        );
      })}
      <div style={{ ...panel, top: 8, right: 8 }}>
        <label>
          project{" "}
          <select
            value={project ?? ""}
            onChange={(e) => {
              setProject(e.target.value);
              rememberProject(e.target.value);
            }}
          >
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {hud && (
          <div>
            <div>project {hud.project}</div>
            {hud.live ? (
              <>
                <div>
                  run {hud.live.run_id} · {hud.live.state}
                </div>
                <div>
                  story {hud.live.story} · {hud.live.phase}
                </div>
                <div>
                  done {hud.live.done} · failed {hud.live.failed} · total {hud.live.total}
                </div>
                <div>engine {hud.live.engine_run_id}</div>
              </>
            ) : hud.last ? (
              <div>
                last run {hud.last.run_id} · {hud.last.state} ·{" "}
                {hud.last.href ? (
                  <a href={hud.last.href} target="_blank" rel="noreferrer" style={{ color: "#9cf" }}>
                    PR
                  </a>
                ) : hud.last.pr ? (
                  `PR ${hud.last.pr}`
                ) : (
                  "no PR"
                )}
              </div>
            ) : (
              <div>no run yet</div>
            )}
            <div>last event {hud.since}</div>
          </div>
        )}
        {error && <div style={{ color: "#ff8080" }}>error {error}</div>}
        {canvasError && <div style={{ color: "#ff8080" }}>canvas error {canvasError}</div>}
      </div>
    </div>
  );
}
