// Writes public/sprites/placeholder.png (Story 30.1, D6: our own pixels, provenance in the repo).
// A 32x16 RGBA sheet: a 16x16 floor tile at x 0 and a 16x16 character at x 16. Flat colours, every
// pixel fully opaque or fully transparent, no anti-aliasing. No dependencies: node:zlib for the
// deflate stream and a hand CRC32; the same script gives the same bytes. Story 30.7 deletes the sheet.
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
const WIDTH = TILE * 2;
const HEIGHT = TILE;

function pixels(): Uint8Array {
  // Each scanline is a filter byte (0, none) followed by WIDTH RGBA pixels.
  const raw = new Uint8Array(HEIGHT * (1 + WIDTH * 4));
  for (let y = 0; y < HEIGHT; y++) {
    const row = FLOOR[y] + CHARACTER[y];
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
