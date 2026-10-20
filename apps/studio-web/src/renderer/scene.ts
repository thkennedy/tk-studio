// The spike's scene (Story 30.1): one PixiJS v8 Application, a floor of tiles and one character
// from the office sheet, drawn at the integer zoom of `pickZoom`. The builders below take a
// Container and Textures only, so later stories' tests can drive them without WebGL (30.4).
// Story 30.4: the sheet also holds a desk and one two-frame looping set per office state (§7.3);
// `placeDesks` stands a character at a desk per agent and `setPose` swaps a character's frame set
// in place on the same sprite (no destroy, no re-add, no `layoutScene`).
// Story 30.7: the sheet is our own (tools/sprites/export.py, kb/studio-web-assets.md), loaded through
// its atlas; every frame set comes from the atlas by name, per role (`sheetFromAtlas`).
import { AnimatedSprite, Application, Assets, Container, Sprite, Texture, TextureSource, type Spritesheet } from "pixi.js";
import { OFFICE_STATES, type OfficeState } from "../live/store";
import { framesFor } from "../office/model";
import { pickZoom } from "./pickZoom";

/** Source tile size in pixels. */
export const TILE = 16;
/** The committed sheet's atlas (our own pixels, D6): Pixi v8 spritesheet JSON naming `floor.0`,
 * `desk.0` and `<role>.<state>.<n>`; it loads `office.png` beside it through `meta.image`. */
export const SHEET_URL = "sprites/office.json";
/** The least frames every looping state carries per role on the sheet (all eight states loop). */
export const STATE_FRAMES = 2;
/** The registry's roles in order (apps/supervisor/src/registry.ts `ROLES`): mirrored, never imported
 * across apps. The shared set for a state is the first of these roles that has it. */
export const ROLES = ["orchestrator", "session", "implementer", "reviewer", "consult", "advisor", "planner"] as const;

export interface Sheet {
  floor: Texture;
  /** The spike's lone character: the first role's `idle.0`. */
  character: Texture;
  desk: Texture;
  /** The shared looping frame set per office state, for a role the sheet does not carry. */
  frames: Record<OfficeState, Texture[]>;
  /** Each role's looping frame sets by office state, ordered by `n`. */
  roles: Record<string, Partial<Record<OfficeState, Texture[]>>>;
}

export interface Scene {
  /** Scaled by zoom / ratio so one source pixel is `zoom` device pixels. */
  world: Container;
  floor: Container;
  character: Sprite;
  zoom: number;
}

/** One Application filling `container`, resolution from the device pixel ratio, nearest scaling. */
export async function createApp(container: HTMLElement, ratio: number): Promise<Application> {
  TextureSource.defaultOptions.scaleMode = "nearest";
  const app = new Application();
  await app.init({
    resizeTo: container,
    resolution: ratio,
    autoDensity: true,
    antialias: false,
    roundPixels: true,
    background: "#1b1b24",
  });
  app.canvas.style.display = "block";
  container.appendChild(app.canvas);
  return app;
}

const FRAME_NAME = /^([a-z][a-z0-9-]*)\.([a-z-]+)\.(\d+)$/;

/** Builds the sheet from the atlas's textures by name (pure: no loading). `floor.0` and `desk.0` are
 * the tiles; `<role>.<state>.<n>` go to `roles[role][state]` ordered by `n`; `frames[state]` is the
 * first role (`ROLES` order, then the others by name) that has the state, else the shared `idle`.
 * A name that does not parse is ignored with a warning through `warn`. */
export function sheetFromAtlas(textures: Readonly<Record<string, Texture>>, warn: (message: string) => void = console.warn): Sheet {
  const found: Record<string, Partial<Record<OfficeState, [number, Texture][]>>> = {};
  for (const [name, texture] of Object.entries(textures)) {
    if (name === "floor.0" || name === "desk.0") continue;
    const m = FRAME_NAME.exec(name);
    const state = m?.[2] as OfficeState | undefined;
    if (!m || !(OFFICE_STATES as readonly string[]).includes(state!)) {
      warn(`office sheet: ignoring atlas frame "${name}" (want <role>.<state>.<n>)`);
      continue;
    }
    ((found[m[1]!] ??= {})[state!] ??= []).push([Number(m[3]), texture]);
  }
  const roles: Sheet["roles"] = {};
  for (const [role, sets] of Object.entries(found)) {
    roles[role] = Object.fromEntries(
      Object.entries(sets).map(([state, list]) => [state, list!.sort((a, b) => a[0] - b[0]).map(([, t]) => t)]),
    );
  }
  const order = [...ROLES.filter((r) => roles[r]), ...Object.keys(roles).filter((r) => !(ROLES as readonly string[]).includes(r)).sort()];
  const shared = (state: OfficeState) => roles[order.find((r) => roles[r]![state]?.length) ?? ""]?.[state];
  const idle = shared("idle");
  const tile = (name: string) => {
    const t = textures[name];
    if (!t) throw new Error(`office sheet: the atlas has no ${name}`);
    return t;
  };
  if (!idle?.length) throw new Error("office sheet: the atlas has no idle frames for any role");
  const frames = Object.fromEntries(OFFICE_STATES.map((state) => [state, shared(state) ?? idle])) as Record<OfficeState, Texture[]>;
  return { floor: tile("floor.0"), character: idle[0]!, desk: tile("desk.0"), frames, roles };
}

/** Loads the sheet through its atlas (the one loader) and builds the frame sets by name (`sheetFromAtlas`). */
export async function loadSheet(url: string = SHEET_URL): Promise<Sheet> {
  const atlas: Spritesheet = await Assets.load(url);
  atlas.textureSource.scaleMode = "nearest";
  return sheetFromAtlas(atlas.textures);
}

/** A cols x rows floor of `tile`-pixel sprites at whole source-pixel positions, added to `world`. */
export function drawFloor(world: Container, texture: Texture, cols: number, rows: number, tile: number = TILE): Container {
  const floor = new Container({ label: "floor" });
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sprite = new Sprite(texture);
      sprite.position.set(col * tile, row * tile);
      floor.addChild(sprite);
    }
  }
  world.addChildAt(floor, 0);
  return floor;
}

/** One character sprite standing on the tile at (col, row), added to `world` above the floor. */
export function placeCharacter(world: Container, texture: Texture, col: number, row: number, tile: number = TILE): Sprite {
  const character = new Sprite(texture);
  character.label = "character";
  character.position.set(col * tile, row * tile);
  world.addChild(character);
  return character;
}

/** Floor size in tiles covering a CSS-pixel container at `zoom` device pixels per source pixel. */
export function floorSize(ratio: number, width: number, height: number, zoom: number, tile: number = TILE): [number, number] {
  const span = tile * zoom;
  return [Math.max(1, Math.ceil((width * ratio) / span)), Math.max(1, Math.ceil((height * ratio) / span))];
}

/** Builds (or rebuilds) the floor and the character for the container's size; returns the scene. */
export function layoutScene(stage: Container, sheet: Sheet, ratio: number, width: number, height: number, previous?: Scene): Scene {
  if (previous) {
    stage.removeChild(previous.world);
    previous.world.destroy({ children: true });
  }
  const zoom = pickZoom(ratio, width, height, TILE);
  const world = new Container({ label: "world" });
  world.scale.set(zoom / ratio);
  const [cols, rows] = floorSize(ratio, width, height, zoom);
  const floor = drawFloor(world, sheet.floor, cols, rows);
  const character = placeCharacter(world, sheet.character, Math.floor(cols / 2), Math.floor(rows / 2));
  stage.addChild(world);
  return { world, floor, character, zoom };
}

/** One agent at its desk. */
export interface DeskSprites {
  agent_id: string;
  desk: Sprite;
  character: AnimatedSprite;
  col: number;
  row: number;
}

export interface DeskOptions {
  /** Floor width in tiles: desks fill rows of `floor((cols - 1) / 2)`, two tiles apart (default 16). */
  cols?: number;
  /** Drive the animation from the shared ticker (default true; tests pass false: no WebGL, no rAF). */
  autoUpdate?: boolean;
  tile?: number;
}

/** Frames advance at this fraction of a tick (about four frames a second at 60 fps). */
export const POSE_SPEED = 1 / 15;

/** Stands one looping character at one desk per agent, in `agents` order, in a `desks` container
 * added to `world` above the floor. Each character starts on its pose (`framesFor`). */
export function placeDesks(
  world: Container,
  sheet: Sheet,
  agents: readonly { agent_id: string; role: string; state: string }[],
  opts: DeskOptions = {},
): { container: Container; desks: DeskSprites[] } {
  const tile = opts.tile ?? TILE;
  const perRow = Math.max(1, Math.floor(((opts.cols ?? 16) - 1) / 2));
  const container = new Container({ label: "desks" });
  const desks = agents.map((a, i) => {
    const col = 1 + (i % perRow) * 2;
    const row = 1 + Math.floor(i / perRow) * 2;
    const character = new AnimatedSprite({
      textures: [...framesFor(sheet, a.role, a.state)],
      animationSpeed: POSE_SPEED,
      loop: true,
      autoUpdate: opts.autoUpdate ?? true,
    });
    character.label = `character:${a.agent_id}`;
    character.position.set(col * tile, row * tile);
    // The desk stands in front of the character's legs.
    const desk = new Sprite(sheet.desk);
    desk.label = `desk:${a.agent_id}`;
    desk.position.set(col * tile, row * tile + Math.floor(tile / 2));
    container.addChild(character, desk);
    character.play();
    return { agent_id: a.agent_id, desk, character, col, row };
  });
  world.addChild(container);
  return { container, desks };
}

/** Swaps a character's frame set in place: the same sprite, its first new frame shown at once and
 * looping (no destroy, no re-add, so no flicker). Setting the same set again is a no-op. */
export function setPose(sprite: AnimatedSprite, frames: readonly Texture[]): void {
  if (!frames.length) return;
  const current = sprite.textures as Texture[];
  if (current.length === frames.length && current.every((t, i) => t === frames[i])) return;
  sprite.textures = [...frames];
  sprite.play();
}

/** The desks placed for one desk set: `key` names the set (`deskSetKey`). */
export interface PlacedDesks {
  key: string;
  container: Container;
  desks: DeskSprites[];
}

/** The desk set's identity: its agents and roles, in order (a state is not part of it). */
export const deskSetKey = (agents: readonly { agent_id: string; role: string }[]): string =>
  agents.map((a) => `${a.agent_id}:${a.role}`).join("|");

/** Brings the floor's desks to `agents`: when `placed` holds the same desk set, each character's pose
 * is swapped in place (`setPose`) and `placed` itself is returned, the same sprite objects; otherwise
 * (none placed, or the agent set changed) the old desks are destroyed and new ones placed. */
export function syncDesks(
  world: Container,
  sheet: Sheet,
  placed: PlacedDesks | null,
  agents: readonly { agent_id: string; role: string; state: string }[],
  opts: DeskOptions = {},
): PlacedDesks {
  const key = deskSetKey(agents);
  if (placed && placed.key === key) {
    for (const [i, a] of agents.entries()) setPose(placed.desks[i]!.character, framesFor(sheet, a.role, a.state));
    return placed;
  }
  if (placed) {
    world.removeChild(placed.container);
    placed.container.destroy({ children: true });
  }
  return { key, ...placeDesks(world, sheet, agents, opts) };
}
