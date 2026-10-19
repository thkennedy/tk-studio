// Writes public/sprites/placeholder.png (Story 30.1, D6: our own pixels, provenance in the repo).
// A 48x144 RGBA sheet of 16x16 tiles. Row 0: the floor tile at x 0, the spike's character at x 16
// and a desk at x 32 (Story 30.4). Rows 1-8: one row per office state in `STATES` order (the
// renderer's `OFFICE_STATES`), two looping frames at x 0 and x 16 (x 32 left transparent). Every
// state's set shares one body with its own shirt colour and marker, so the eight sets are distinct.
// Flat colours, every pixel fully opaque or fully transparent, no anti-aliasing. No dependencies:
// node:zlib for the deflate stream and a hand CRC32; the same script gives the same bytes. Story
// 30.7 deletes the sheet.
//
// Run: bun run sprites   (from apps/studio-web)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type RGBA = [number, number, number, number];

const PALETTE: Record<string, RGBA> = {
  ".": [0, 0, 0, 0], // transparent
  a: [92, 64, 51, 255], // floor plank
  b: [74, 50, 40, 255], // floor plank, dark
  c: [56, 38, 31, 255], // floor seam
  k: [24, 20, 28, 255], // outline
  s: [236, 188, 150, 255], // skin
  h: [70, 44, 30, 255], // hair
  t: [64, 120, 200, 255], // shirt
  p: [44, 48, 72, 255], // trousers
  w: [250, 250, 250, 255], // eye
  g: [128, 128, 136, 255], // shirt, offline
  u: [140, 90, 200, 255], // shirt, thinking
  n: [70, 160, 90, 255], // shirt, reading
  o: [230, 130, 40, 255], // shirt, typing
  q: [40, 190, 200, 255], // shirt, running
  y: [240, 210, 60, 255], // shirt and marker, waiting-for-human
  r: [210, 50, 50, 255], // shirt and marker, blocked
  l: [200, 200, 220, 255], // book page, thought dot
  e: [150, 100, 60, 255], // desk top
  d: [110, 72, 44, 255], // desk front
  m: [40, 44, 56, 255], // monitor
  v: [90, 200, 255, 255], // monitor screen
};

// 16x16, one character per pixel.
const FLOOR = [
  "aaaaaaacaaaaaaac",
  "aaaaaaacaaaaaaac",
  "aaaaaaacaaaaaaac",
  "cccccccccccccccc",
  "bbbcbbbbbbbcbbbb",
  "bbbcbbbbbbbcbbbb",
  "bbbcbbbbbbbcbbbb",
  "cccccccccccccccc",
  "aaaaaaacaaaaaaac",
  "aaaaaaacaaaaaaac",
  "aaaaaaacaaaaaaac",
  "cccccccccccccccc",
  "bbbcbbbbbbbcbbbb",
  "bbbcbbbbbbbcbbbb",
  "bbbcbbbbbbbcbbbb",
  "cccccccccccccccc",
];

const CHARACTER = [
  "................",
  ".....kkkkkk.....",
  "....khhhhhhk....",
  "....khhhhhhk....",
  "....kssssssk....",
  "....kswsswsk....",
  "....kssssssk....",
  ".....kkkkkk.....",
  "....kttttttk....",
  "...kttttttttk...",
  "...ksttttttsk...",
  "...kkttttttkk...",
  "....kppppppk....",
  "....kppkkppk....",
  "....kppk.kppk...",
  "....kkk...kkk...",
];

const TILE = 16;

const DESK = [
  "................",
  "................",
  "....mmmmmmmm....",
  "....mvvvvvvm....",
  "....mvvvvvvm....",
  "....mmmmmmmm....",
  ".......mm.......",
  "keeeeeeeeeeeeeek",
  "keeeeeeeeeeeeeek",
  "kkkkkkkkkkkkkkkk",
  "kddddddddddddddk",
  "kddddddddddddddk",
  "kddkkkkkkkkkkddk",
  "kddk........kddk",
  "kddk........kddk",
  "kkkk........kkkk",
];

type Edit = [x: number, y: number, key: string];

/** CHARACTER with the shirt recoloured to `shirt` and the pixel edits applied. */
function body(shirt: string, edits: Edit[] = []): string[] {
  const rows = CHARACTER.map((r) => r.replaceAll("t", shirt).split(""));
  for (const [x, y, key] of edits) rows[y]![x] = key;
  return rows.map((r) => r.join(""));
}

const EYES_SHUT: Edit[] = [[6, 5, "k"], [9, 5, "k"]];

/** The eight office states (design spec §7.3), in the renderer's order; two frames each, looping.
 * The desk stands half a tile low in front of the character, so its monitor hides character rows
 * 10-13 at x 4-11 (and row 14 at x 7-8, row 15): every set's frames differ somewhere outside that. */
const STATES: [state: string, frames: [string[], string[]]][] = [
  ["offline", [body("g", [...EYES_SHUT, [13, 3, "l"]]), body("g", [...EYES_SHUT, [14, 1, "l"], [13, 3, "l"]])]],
  ["idle", [body("t"), body("t", [[6, 5, "s"], [9, 5, "s"]])]],
  ["thinking", [body("u", [[12, 4, "l"], [13, 2, "l"]]), body("u", [[12, 4, "l"], [13, 2, "l"], [14, 0, "l"], [15, 0, "l"]])]],
  ["reading", [
    body("n", [[5, 9, "l"], [6, 9, "l"], [7, 9, "k"], [8, 9, "l"], [9, 9, "l"], [10, 9, "l"]]),
    body("n", [[5, 9, "l"], [6, 9, "l"], [7, 9, "l"], [8, 9, "k"], [9, 9, "l"], [10, 9, "l"]]),
  ]],
  ["typing", [body("o"), body("o", [[4, 9, "s"], [11, 9, "s"], [4, 10, "o"], [11, 10, "o"]])]],
  ["running", [
    body("q"),
    body("q", [[6, 13, "p"], [7, 13, "p"], [8, 14, "k"], [9, 14, "p"], [10, 14, "p"], [11, 14, "k"], [9, 15, "k"], [10, 15, "k"], [11, 15, "."], [12, 15, "."]]),
  ]],
  ["waiting-for-human", [body("y", [[13, 0, "y"], [13, 1, "y"], [13, 2, "y"], [13, 4, "y"]]), body("y")]],
  ["blocked", [body("r", [[12, 0, "r"], [14, 0, "r"], [13, 1, "r"], [12, 2, "r"], [14, 2, "r"]]), body("r")]],
];

const BLANK = ".".repeat(TILE);
const TILE_ROWS: string[][][] = [
  [FLOOR, CHARACTER, DESK],
  ...STATES.map(([, [a, b]]) => [a, b, Array.from({ length: TILE }, () => BLANK)]),
];

const WIDTH = TILE * 3;
const HEIGHT = TILE * TILE_ROWS.length;

function pixels(): Uint8Array {
  // Each scanline is a filter byte (0, none) followed by WIDTH RGBA pixels.
  const raw = new Uint8Array(HEIGHT * (1 + WIDTH * 4));
  for (let y = 0; y < HEIGHT; y++) {
    const row = TILE_ROWS[Math.floor(y / TILE)]!.map((tile) => tile[y % TILE]).join("");
    if (row.length !== WIDTH) throw new Error(`row ${y} is ${row.length} pixels, want ${WIDTH}`);
    const base = y * (1 + WIDTH * 4);
    raw[base] = 0;
    for (let x = 0; x < WIDTH; x++) {
      const colour = PALETTE[row[x]];
      if (!colour) throw new Error(`row ${y} col ${x}: unknown palette key ${row[x]!}`);
      raw.set(colour, base + 1 + x * 4);
    }
  }
  return raw;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, WIDTH);
  view.setUint32(4, HEIGHT);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace: none
  const idat = new Uint8Array(deflateSync(pixels(), { level: 9 }));
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const target = join(import.meta.dir, "..", "public", "sprites", "placeholder.png");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png());
console.log(`wrote ${target}`);
