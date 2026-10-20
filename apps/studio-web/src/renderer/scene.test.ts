// Story 30.4: the scene's desk and pose builders on a bare Container with Textures (no renderer,
// no WebGL): eight distinct looping frame sets, one character per agent at a desk, and a pose swap
// in place on the same sprite object. Story 30.7: the sheet is built from the committed atlas
// (office.json) by name, per role, and the visible-loop check reads office.png through it.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Container, Rectangle, Texture } from "pixi.js";
import { OFFICE_STATES } from "../live/store";
import { deskSetKey, placeDesks, ROLES, setPose, sheetFromAtlas, STATE_FRAMES, syncDesks, TILE } from "./scene";

interface AtlasFrame { frame: { x: number; y: number; w: number; h: number } }
const atlas = JSON.parse(readFileSync(new URL("../../public/sprites/office.json", import.meta.url), "utf8")) as {
  frames: Record<string, AtlasFrame>;
  meta: { image: string; size: { w: number; h: number } };
};
const source = new Texture().source;
const texturesOf = (frames: Record<string, AtlasFrame>) =>
  Object.fromEntries(Object.entries(frames).map(([name, { frame: f }]) => [name, new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) })]));
const sheet = () => sheetFromAtlas(texturesOf(atlas.frames));
const frameKey = (t: Texture) => `${t.frame.x},${t.frame.y},${t.frame.width},${t.frame.height}`;
const atlasKey = (name: string) => {
  const f = atlas.frames[name]!.frame;
  return `${f.x},${f.y},${f.w},${f.h}`;
};

describe("the sheet's frame sets, from the atlas by name", () => {
  it("builds every role's eight looping sets, ordered by n, apart from the floor and the desk", () => {
    const s = sheet();
    expect(atlas.meta.image).toBe("office.png");
    expect(frameKey(s.floor)).toBe(atlasKey("floor.0"));
    expect(frameKey(s.desk)).toBe(atlasKey("desk.0"));
    const seen = new Set([frameKey(s.floor), frameKey(s.desk)]);
    expect(seen.size).toBe(2);
    expect(Object.keys(s.roles).sort()).toEqual([...ROLES].sort());
    // the exporter lays frames out in its order (floor, desk, ROLES x states x n) row-major, and the
    // JSON keys are written sorted, so the roles' order is read from the sheet position (y, then x)
    const bySheet = Object.entries(atlas.frames)
      .sort(([, a], [, b]) => a.frame.y - b.frame.y || a.frame.x - b.frame.x)
      .map(([name]) => name);
    expect(bySheet.slice(0, 2)).toEqual(["floor.0", "desk.0"]);
    expect([...new Set(bySheet.slice(2).map((name) => name.split(".")[0]))]).toEqual([...ROLES]);
    for (const role of ROLES) {
      for (const state of OFFICE_STATES) {
        const set = s.roles[role]![state]!;
        expect(set.length, `${role}.${state}`).toBeGreaterThanOrEqual(STATE_FRAMES);
        for (const [n, t] of set.entries()) {
          expect(frameKey(t)).toBe(atlasKey(`${role}.${state}.${n}`));
          expect(t.frame.width).toBe(TILE);
          expect(seen.has(frameKey(t))).toBe(false);
          seen.add(frameKey(t));
        }
      }
    }
    expect(seen.size).toBe(Object.keys(atlas.frames).length);
    // the shared sets and the spike's character are the first role's
    for (const state of OFFICE_STATES) expect(s.frames[state]).toBe(s.roles[ROLES[0]]![state]);
    expect(s.character).toBe(s.roles[ROLES[0]]!.idle![0]);
  });

  it("orders by n, takes the shared set from the first ROLES role that has it, and ignores an unparseable name with a warning", () => {
    const at = (x: number): AtlasFrame => ({ frame: { x: x * TILE, y: 0, w: TILE, h: TILE } });
    const warnings: string[] = [];
    const s = sheetFromAtlas(
      texturesOf({
        "floor.0": at(0), "desk.0": at(1),
        "planner.idle.1": at(2), "planner.idle.0": at(3), "planner.typing.0": at(4),
        "session.typing.1": at(5), "session.typing.0": at(6),
        bogus: at(7), "planner.dancing.0": at(8),
      }),
      (m) => warnings.push(m),
    );
    expect(s.roles.planner!.idle!.map((t) => t.frame.x)).toEqual([3 * TILE, 2 * TILE]);
    expect(s.frames.typing.map((t) => t.frame.x)).toEqual([6 * TILE, 5 * TILE]);
    expect(s.frames.idle).toBe(s.roles.planner!.idle);
    // a state no role has reads the shared idle
    expect(s.frames.blocked).toBe(s.roles.planner!.idle);
    expect(s.character).toBe(s.roles.planner!.idle![0]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"bogus"');
    expect(warnings[1]).toContain('"planner.dancing.0"');
  });
});

describe("placeDesks", () => {
  const agents = [
    { agent_id: "p/orchestrator", role: "orchestrator", state: "waiting-for-human" },
    { agent_id: "p/session", role: "session", state: "typing" },
    { agent_id: "p/planner", role: "planner", state: "offline" },
  ];

  it("stands one looping character at one desk per agent, in row order, posed by state", () => {
    const s = sheet();
    const world = new Container();
    const { container, desks } = placeDesks(world, s, agents, { cols: 5, autoUpdate: false });
    expect(world.children).toContain(container);
    expect(desks.map((d) => d.agent_id)).toEqual(agents.map((a) => a.agent_id));
    expect(container.children).toHaveLength(agents.length * 2);
    // cols 5: two desks per row, two tiles apart
    expect(desks.map((d) => [d.col, d.row])).toEqual([[1, 1], [3, 1], [1, 3]]);
    for (const [i, d] of desks.entries()) {
      expect(d.character.textures).toEqual(s.roles[agents[i].role]![agents[i].state as keyof typeof s.frames]);
      expect(d.character.playing).toBe(true);
      expect(d.character.loop).toBe(true);
      expect(d.desk.texture).toBe(s.desk);
      expect(container.getChildIndex(d.desk)).toBeGreaterThan(container.getChildIndex(d.character));
    }
  });
});

describe("setPose", () => {
  it("swaps the frame set in place on the same sprite object, never re-added", () => {
    const s = sheet();
    const world = new Container();
    const { container, desks } = placeDesks(world, s, agents(), { autoUpdate: false });
    const sprite = desks[0].character;
    const index = container.getChildIndex(sprite);
    for (const state of OFFICE_STATES) {
      setPose(sprite, s.frames[state]);
      expect(desks[0].character).toBe(sprite);
      expect(sprite.destroyed).toBe(false);
      expect(sprite.parent).toBe(container);
      expect(container.getChildIndex(sprite)).toBe(index);
      expect(sprite.textures).toEqual(s.frames[state]);
      // the new set's first frame shows at once (within one frame), and it loops
      expect(sprite.texture).toBe(s.frames[state][0]);
      expect(sprite.playing).toBe(true);
    }
  });

  it("the same set again is a no-op; an empty set is ignored", () => {
    const s = sheet();
    const { desks } = placeDesks(new Container(), s, agents(), { autoUpdate: false });
    const sprite = desks[0].character;
    setPose(sprite, s.frames.idle);
    sprite.gotoAndPlay(1);
    setPose(sprite, [...s.frames.idle]);
    expect(sprite.currentFrame).toBe(1);
    setPose(sprite, []);
    expect(sprite.textures).toEqual(s.frames.idle);
  });

  function agents() {
    return [{ agent_id: "p/session", role: "session", state: "idle" }];
  }
});

describe("syncDesks", () => {
  const set = (states: string[], ids = ["p/orchestrator", "p/session"]) =>
    ids.map((agent_id, i) => ({ agent_id, role: agent_id.slice(2), state: states[i] ?? "idle" }));

  it("a state-only change keeps the same placed desks and sprite objects, posed in place", () => {
    const s = sheet();
    const world = new Container();
    const first = syncDesks(world, s, null, set(["idle", "typing"]), { autoUpdate: false });
    expect(first.key).toBe(deskSetKey(set([])));
    const sprites = first.desks.map((d) => d.character);
    const next = syncDesks(world, s, first, set(["waiting-for-human", "blocked"]), { autoUpdate: false });
    expect(next).toBe(first);
    expect(next.desks.map((d) => d.character)).toEqual(sprites);
    for (const [i, d] of next.desks.entries()) {
      expect(d.character).toBe(sprites[i]);
      expect(d.character.destroyed).toBe(false);
    }
    expect(sprites[0].textures).toEqual(s.roles.orchestrator!["waiting-for-human"]);
    expect(sprites[1].textures).toEqual(s.roles.session!.blocked);
    expect(world.children).toEqual([first.container]);
  });

  it("a changed agent set rebuilds: new sprites, the old desks destroyed and removed", () => {
    const s = sheet();
    const world = new Container();
    const first = syncDesks(world, s, null, set(["idle", "typing"]), { autoUpdate: false });
    const old = first.desks.map((d) => d.character);
    const next = syncDesks(world, s, first, set(["idle", "idle", "idle"], ["p/orchestrator", "p/session", "p/planner"]), { autoUpdate: false });
    expect(next).not.toBe(first);
    expect(next.desks.map((d) => d.agent_id)).toEqual(["p/orchestrator", "p/session", "p/planner"]);
    for (const d of next.desks) expect(old).not.toContain(d.character);
    expect(old.every((c) => c.destroyed)).toBe(true);
    expect(world.children).toEqual([next.container]);
  });
});

/** The committed sheet's RGBA pixels, decoded (it is written with filter 0 on every scanline). */
function decodeSheet(): { width: number; at: (x: number, y: number) => number[] } {
  const bytes = readFileSync(new URL(`../../public/sprites/${atlas.meta.image}`, import.meta.url));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let width = 0;
  for (let at = 8; at < bytes.length; ) {
    const len = view.getUint32(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "IHDR") width = view.getUint32(at + 8);
    if (type === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 4;
  return {
    width,
    at: (x, y) => {
      expect(raw[y * stride]).toBe(0);
      return [...raw.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)];
    },
  };
}

describe("the committed sheet's poses at a desk", () => {
  it("loops every role in every state visibly: its first two frames differ at a pixel the desk does not cover", () => {
    const png = decodeSheet();
    expect(png.width).toBe(atlas.meta.size.w);
    const s = sheet();
    // The desk's offset in front of its character, as placeDesks stands them.
    const [{ desk, character }] = placeDesks(new Container(), s, [{ agent_id: "a", role: "session", state: "idle" }], { autoUpdate: false }).desks;
    const dy = desk.y - character.y;
    const origin = (name: string): [number, number] => [atlas.frames[name]!.frame.x, atlas.frames[name]!.frame.y];
    const [deskX, deskY] = origin("desk.0");
    const deskCovers = (x: number, y: number) => y - dy >= 0 && png.at(deskX + x, deskY + y - dy)[3] !== 0;
    const tile = (name: string) => {
      const [ox, oy] = origin(name);
      return Array.from({ length: TILE * TILE }, (_, i) => png.at(ox + (i % TILE), oy + Math.floor(i / TILE)).join(",")).join(";");
    };
    for (const role of ROLES) {
      const sets = new Set<string>();
      for (const state of OFFICE_STATES) {
        const [ax, ay] = origin(`${role}.${state}.0`);
        const [bx, by] = origin(`${role}.${state}.1`);
        const visible: [number, number][] = [];
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            const differs = png.at(ax + x, ay + y).join() !== png.at(bx + x, by + y).join();
            if (differs && !deskCovers(x, y)) visible.push([x, y]);
          }
        }
        expect(visible.length, `${role}.${state}`).toBeGreaterThan(0);
        sets.add(tile(`${role}.${state}.0`) + "|" + tile(`${role}.${state}.1`));
      }
      expect(sets.size, role).toBe(OFFICE_STATES.length);
    }
  });
});
