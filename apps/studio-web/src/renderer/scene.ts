// The spike's scene (Story 30.1): one PixiJS v8 Application, a floor of tiles and one character
// from the placeholder sheet, drawn at the integer zoom of `pickZoom`. The builders below take a
// Container and Textures only, so later stories' tests can drive them without WebGL (30.4).
import { Application, Assets, Container, Rectangle, Sprite, Texture, TextureSource } from "pixi.js";
import { pickZoom } from "./pickZoom";

/** Source tile size in pixels. */
export const TILE = 16;
/** The committed placeholder sheet (our own pixels, D6): floor tile at x 0, character at x 16. */
export const SHEET_URL = "sprites/placeholder.png";

export interface Sheet {
  floor: Texture;
  character: Texture;
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

/** Loads the placeholder sheet and cuts its two 16x16 frames by Rectangle. */
export async function loadSheet(url: string = SHEET_URL): Promise<Sheet> {
  const sheet: Texture = await Assets.load(url);
  const source = sheet.source;
  source.scaleMode = "nearest";
  return {
    floor: new Texture({ source, frame: new Rectangle(0, 0, TILE, TILE) }),
    character: new Texture({ source, frame: new Rectangle(TILE, 0, TILE, TILE) }),
  };
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
