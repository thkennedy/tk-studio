"""Exports the studio web's office sprite sheet (Story 30.7, D6: our own pixels).

Reads the sources under apps/studio-web/assets/ and writes apps/studio-web/public/sprites/office.png
plus its Pixi v8 spritesheet atlas office.json, byte-reproducibly (the same sources give the same bytes).
The format, the pipeline and the credits are recorded in kb/studio-web-assets.md.

Sources (all the art lives there; this script holds no pixels of its own):
- `palette.txt`: one `<char> <RRGGBBAA>` per line; every alpha is 00 or ff; `.` is transparent.
- `<region>.txt`: `[<header>]` lines, each followed by 16 rows of 16 palette chars. The regions are
  `floor` and `desk` (one header, `[0]`) and every registry role (`[<state>.<n>]`, n from 0).
- `<region>.png` in place of `<region>.txt` (an attended tool's export): floor and desk are one 16x16
  tile; a role is a grid with one row per office state in order and one column per frame, a fully
  transparent tile ending a row. RGBA8 or RGB8, any of the five filter types, no interlace.
Lines starting with `#` and blank lines are ignored in the text files.

The roles are read from apps/supervisor/src/registry.ts `ROLES` and the states from
apps/studio-web/src/live/store.ts `OFFICE_STATES`, so a new role or state fails the export until its
frames exist. Every role carries at least two frames in every state (all eight states loop).

Usage (from the repository root; `bun run sprites` from apps/studio-web runs the same):
  uv run --no-project python tools/sprites/export.py            # write office.png and office.json
  uv run --no-project python tools/sprites/export.py --check    # compare only; non-zero when stale
"""
from __future__ import annotations

import argparse
import binascii
import json
import re
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "apps" / "studio-web" / "assets"
OUT = ROOT / "apps" / "studio-web" / "public" / "sprites"
REGISTRY_TS = ROOT / "apps" / "supervisor" / "src" / "registry.ts"
STORE_TS = ROOT / "apps" / "studio-web" / "src" / "live" / "store.ts"

TILE = 16
COLUMNS = 16  # frames per sheet row
MIN_FRAMES = 2  # every state loops
PNG_NAME = "office.png"
ATLAS_NAME = "office.json"
SIGNATURE = b"\x89PNG\r\n\x1a\n"
# The IDAT zlib stream is written here as stored (uncompressed) deflate blocks, implementation-independent:
# no zlib build's compressor is involved, so the bytes cannot differ between hosts (zlib vs zlib-ng).
STORED_BLOCK = 65535  # the most bytes one stored deflate block holds
TILE_REGIONS = ("floor", "desk")

Pixel = bytes  # 4 bytes, RGBA
Frame = tuple  # TILE * TILE pixels, row-major


class SpriteError(Exception):
    """A source problem: names the file (and line) and the gap."""


# ------------------------------------------------------------ roles and states


def _ts_list(path: Path, name: str) -> list[str]:
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"export const {name}\s*=\s*\[([^\]]*)\]", text)
    if not m:
        raise SpriteError(f"{path}: no `export const {name} = [...]`")
    return re.findall(r'"([^"]+)"', m.group(1))


def registry_roles(path: Path = REGISTRY_TS) -> list[str]:
    return _ts_list(path, "ROLES")


def office_states(path: Path = STORE_TS) -> list[str]:
    return _ts_list(path, "OFFICE_STATES")


# ------------------------------------------------------------ text sources


def _read_source(path: Path) -> str:
    data = path.read_bytes()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as e:
        no = data.count(b"\n", 0, e.start) + 1
        raise SpriteError(f"{path}:{no}: not UTF-8 text (byte {data[e.start]:#04x} at offset {e.start})") from None


def parse_palette(path: Path) -> dict[str, Pixel]:
    palette: dict[str, Pixel] = {}
    for no, line in enumerate(_read_source(path).splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        m = re.fullmatch(r"(\S) ([0-9A-Fa-f]{8})\s*(?:#.*)?", line)
        if not m or m.group(1) in "#[":
            raise SpriteError(f"{path}:{no}: want `<char> <RRGGBBAA>`, got {line!r}")
        char, rgba = m.group(1), bytes.fromhex(m.group(2))
        if rgba[3] not in (0, 255):
            raise SpriteError(f"{path}:{no}: alpha {rgba[3]:02x} for {char!r} is not 00 or ff (no anti-aliased edges)")
        if char in palette:
            raise SpriteError(f"{path}:{no}: {char!r} is defined twice")
        palette[char] = rgba
    if palette.get(".", b"\0\0\0\xff")[3] != 0:
        raise SpriteError(f"{path}: `.` must be defined and transparent (alpha 00)")
    return palette


def parse_grid(path: Path, palette: dict[str, Pixel]) -> list[tuple[str, Frame, int]]:
    """The file's frames in file order: (header, pixels, header line)."""
    out: list[tuple[str, Frame, int]] = []
    header: tuple[str, int] | None = None
    rows: list[str] = []

    def close() -> None:
        if header is None:
            return
        if len(rows) != TILE:
            raise SpriteError(f"{path}:{header[1]}: [{header[0]}] has {len(rows)} rows, want {TILE}")
        pixels = tuple(palette[c] for row in rows for c in row)
        out.append((header[0], pixels, header[1]))

    for no, line in enumerate(_read_source(path).splitlines(), 1):
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"\[([^\]]+)\]", line)
        if m:
            close()
            header, rows = (m.group(1), no), []
            continue
        if header is None:
            raise SpriteError(f"{path}:{no}: a grid row before any [header]")
        if len(line) != TILE:
            raise SpriteError(f"{path}:{no}: row is {len(line)} pixels wide, want {TILE}")
        bad = [c for c in line if c not in palette]
        if bad:
            raise SpriteError(f"{path}:{no}: {bad[0]!r} is not in the palette")
        if len(rows) == TILE:
            raise SpriteError(f"{path}:{no}: [{header[0]}] has more than {TILE} rows")
        rows.append(line)
    close()
    return out


# ------------------------------------------------------------ png sources


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def decode_png(path: Path) -> tuple[int, int, list[Pixel]]:
    """(width, height, RGBA pixels row-major). RGBA8 or RGB8, non-interlaced, every filter type."""
    data = path.read_bytes()
    if not data.startswith(SIGNATURE):
        raise SpriteError(f"{path}: not a PNG (bad signature)")
    at, ihdr, idat = len(SIGNATURE), None, bytearray()
    ended = False
    while at < len(data):
        if at + 8 > len(data):
            raise SpriteError(f"{path}: truncated chunk at byte {at}")
        length, kind = struct.unpack(">I4s", data[at:at + 8])
        body = data[at + 8:at + 8 + length]
        crc = data[at + 8 + length:at + 12 + length]
        if len(body) != length or len(crc) != 4:
            raise SpriteError(f"{path}: truncated {kind!r} chunk")
        if struct.unpack(">I", crc)[0] != binascii.crc32(kind + body) & 0xFFFFFFFF:
            raise SpriteError(f"{path}: bad CRC in {kind.decode('latin1')!r}")
        if kind == b"IHDR":
            ihdr = body
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            ended = True
            break
        at += 12 + length
    if ihdr is None or len(ihdr) != 13 or not ended:
        raise SpriteError(f"{path}: malformed PNG (missing IHDR or IEND)")
    width, height, depth, ctype, _comp, _filt, interlace = struct.unpack(">IIBBBBB", ihdr)
    if depth != 8 or ctype not in (2, 6) or interlace:
        raise SpriteError(f"{path}: want 8-bit RGBA or RGB without interlace, got depth {depth} colour type {ctype}")
    bpp = 4 if ctype == 6 else 3
    try:
        raw = zlib.decompress(bytes(idat))
    except zlib.error as e:
        raise SpriteError(f"{path}: malformed PNG data ({e})") from None
    stride = width * bpp
    if len(raw) != height * (1 + stride):
        raise SpriteError(f"{path}: malformed PNG data ({len(raw)} bytes, want {height * (1 + stride)})")
    prev = bytearray(stride)
    pixels: list[Pixel] = []
    for y in range(height):
        base = y * (1 + stride)
        kind, line = raw[base], bytearray(raw[base + 1:base + 1 + stride])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if kind == 0:
                pass
            elif kind == 1:
                line[i] = (line[i] + a) & 0xFF
            elif kind == 2:
                line[i] = (line[i] + b) & 0xFF
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif kind == 4:
                line[i] = (line[i] + _paeth(a, b, c)) & 0xFF
            else:
                raise SpriteError(f"{path}: unknown filter type {kind} on scanline {y}")
        prev = line
        for x in range(width):
            px = bytes(line[x * bpp:x * bpp + bpp]) + (b"" if bpp == 4 else b"\xff")
            if px[3] not in (0, 255):
                raise SpriteError(f"{path}: pixel ({x}, {y}) has alpha {px[3]}, not 0 or 255 (no anti-aliased edges)")
            pixels.append(px)
    return width, height, pixels


def _tile(width: int, pixels: list[Pixel], col: int, row: int) -> Frame:
    return tuple(pixels[(row * TILE + y) * width + col * TILE + x] for y in range(TILE) for x in range(TILE))


def png_frames(path: Path, region: str, states: list[str]) -> list[tuple[str, Frame, int]]:
    width, height, pixels = decode_png(path)
    if region in TILE_REGIONS:
        if (width, height) != (TILE, TILE):
            raise SpriteError(f"{path}: {region} is one {TILE}x{TILE} tile, got {width}x{height}")
        return [("0", _tile(width, pixels, 0, 0), 0)]
    if width % TILE or height != TILE * len(states):
        raise SpriteError(f"{path}: want {TILE}-pixel columns and {len(states)} rows of {TILE} (one per office state), "
                          f"got {width}x{height}")
    out = []
    for row, state in enumerate(states):
        for col in range(width // TILE):
            frame = _tile(width, pixels, col, row)
            if all(px[3] == 0 for px in frame):
                break
            out.append((f"{state}.{col}", frame, 0))
    return out


# ------------------------------------------------------------ the sheet


def collect(assets: Path, roles: list[str], states: list[str]) -> list[tuple[str, Frame]]:
    """Every frame in the sheet's order: floor.0, desk.0, then roles x states x n. Fails naming the gap."""
    palette_path = assets / "palette.txt"
    if not palette_path.is_file():
        raise SpriteError(f"{palette_path}: missing (the palette)")
    palette = parse_palette(palette_path)
    regions = [*TILE_REGIONS, *roles]
    known = set(regions)
    for p in sorted(assets.iterdir()):
        if p.name == "palette.png":
            raise SpriteError(f"{p}: the palette is palette.txt only; a palette.png is never read")
        if p.suffix in (".txt", ".png") and p.stem not in known and p.name != "palette.txt":
            raise SpriteError(f"{p}: unknown region {p.stem!r} (want floor, desk or a registry role)")
    ordered: list[tuple[str, Frame]] = []
    for region in regions:
        png, txt = assets / f"{region}.png", assets / f"{region}.txt"
        if png.is_file():
            source, frames = png, png_frames(png, region, states)
        elif txt.is_file():
            source, frames = txt, parse_grid(txt, palette)
        else:
            raise SpriteError(f"{assets}: no source for {region!r} ({region}.txt or {region}.png)")
        by_name: dict[str, Frame] = {}
        for header, pixels, line in frames:
            where = f"{source}:{line}" if line else str(source)
            if region in TILE_REGIONS:
                if header != "0":
                    raise SpriteError(f"{where}: [{header}]: {region} has one frame, [0]")
            else:
                m = re.fullmatch(r"([a-z-]+)\.(\d+)", header)
                if not m or m.group(1) not in states:
                    raise SpriteError(f"{where}: [{header}] is not [<office state>.<n>]")
            if header in by_name:
                raise SpriteError(f"{where}: [{header}] appears twice")
            by_name[header] = pixels
        if region in TILE_REGIONS:
            if "0" not in by_name:
                raise SpriteError(f"{source}: {region} has no [0] frame")
            ordered.append((f"{region}.0", by_name["0"]))
            continue
        for state in states:
            n = 0
            while f"{state}.{n}" in by_name:
                ordered.append((f"{region}.{state}.{n}", by_name[f"{state}.{n}"]))
                n += 1
            extra = sorted(h for h in by_name if h.startswith(f"{state}.") and int(h.split(".")[1]) >= n)
            if extra:
                raise SpriteError(f"{source}: {region}.{state} frames are not contiguous from 0 ({extra[0]} after {n})")
            if n < MIN_FRAMES:
                raise SpriteError(f"{source}: {region}.{state} has {n} frame(s), want at least {MIN_FRAMES} (the state loops)")
    return ordered


def _chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", binascii.crc32(kind + body) & 0xFFFFFFFF)


def zlib_stored(raw: bytes) -> bytes:
    """A zlib stream of stored deflate blocks: header 78 01, blocks of at most 65535 bytes (BFINAL on
    the last only; each is one header byte, LEN and NLEN little-endian, the raw bytes), Adler-32 last."""
    out = bytearray(b"\x78\x01")
    chunks = [raw[i:i + STORED_BLOCK] for i in range(0, len(raw), STORED_BLOCK)] or [b""]
    for i, block in enumerate(chunks):
        out.append(1 if i == len(chunks) - 1 else 0)
        out += struct.pack("<HH", len(block), len(block) ^ 0xFFFF) + block
    out += struct.pack(">I", zlib.adler32(raw) & 0xFFFFFFFF)
    return bytes(out)


def encode_png(width: int, height: int, rgba: bytes) -> bytes:
    """RGBA8, no ancillary chunks, filter 0 on every scanline, one IDAT of stored deflate blocks."""
    stride = width * 4
    raw = b"".join(b"\0" + rgba[y * stride:(y + 1) * stride] for y in range(height))
    idat = zlib_stored(raw)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return SIGNATURE + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def build(assets: Path = ASSETS, roles: list[str] | None = None, states: list[str] | None = None) -> tuple[bytes, bytes]:
    """(office.png bytes, office.json bytes) for the sources."""
    roles = registry_roles() if roles is None else roles
    states = office_states() if states is None else states
    frames = collect(assets, roles, states)
    rows = -(-len(frames) // COLUMNS)
    width, height = COLUMNS * TILE, rows * TILE
    canvas = bytearray(width * height * 4)
    atlas: dict[str, dict] = {}
    for i, (name, pixels) in enumerate(frames):
        x0, y0 = (i % COLUMNS) * TILE, (i // COLUMNS) * TILE
        for y in range(TILE):
            at = ((y0 + y) * width + x0) * 4
            canvas[at:at + TILE * 4] = b"".join(pixels[y * TILE:(y + 1) * TILE])
        atlas[name] = {
            "frame": {"x": x0, "y": y0, "w": TILE, "h": TILE},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": TILE, "h": TILE},
            "sourceSize": {"w": TILE, "h": TILE},
        }
    doc = {"frames": atlas, "meta": {"image": PNG_NAME, "format": "RGBA8888", "size": {"w": width, "h": height}, "scale": "1"}}
    text = json.dumps(doc, sort_keys=True, indent=1, separators=(",", ": "), ensure_ascii=True) + "\n"
    return encode_png(width, height, bytes(canvas)), text.encode("ascii")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Export the office sprite sheet and its atlas from apps/studio-web/assets/.")
    ap.add_argument("--check", action="store_true", help="compare with the committed outputs; write nothing")
    ap.add_argument("--assets", type=Path, default=ASSETS, help=argparse.SUPPRESS)
    ap.add_argument("--out", type=Path, default=OUT, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    try:
        png, atlas = build(args.assets)
    except (SpriteError, OSError) as e:
        print(f"export.py: error: {e}", file=sys.stderr)
        return 2
    outputs = ((args.out / PNG_NAME, png), (args.out / ATLAS_NAME, atlas))
    if args.check:
        stale = [p for p, data in outputs if not p.is_file() or p.read_bytes() != data]
        for p in stale:
            print(f"export.py: stale: {p} differs from its sources (run tools/sprites/export.py)", file=sys.stderr)
        return 1 if stale else 0
    args.out.mkdir(parents=True, exist_ok=True)
    for p, data in outputs:
        p.write_bytes(data)
        print(f"wrote {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
