"""tk-studio assets — the asset manifest and the ladder's first rung, the
greybox (Story 34.6, CAP-11 and CAP-12; plans/34-6.md §Settled shape).

Every asset a slice needs is declared once, in the project's manifest
(schema 1, `contracts/asset-manifest.schema.json`), and the greybox rung
makes each declared asset exist as a placeholder before any art does: a
primitive sized to its bounds, its origin per the rule, a flat material in
its category's colour with its name baked into a label texture, written as
one binary glTF through headless Blender on the host.

Verbs (each ends with JSON on stdout and the AD-11 status block; never
prompts):
  uv run assets.py check   --directory DIR [--manifest PATH] [--art-path PATH]
  uv run assets.py greybox --directory DIR [--manifest PATH] [--art-path PATH]
                           [--blender PATH] [--wall S]
  uv run assets.py facts   FILE

Guarantees:
  - The manifest is `--manifest`, else the project config's
    `assets.manifest` (default `assets/manifest.yaml`); the art path is
    `--art-path`, else `assets.art_path` (default `art/greybox`; TUA's is
    `art/world/greybox`). A relative value is relative to `--directory`.
  - The manifest is read by this module's own narrow reader (the manifest
    subset only: a top `schema`, a `categories` mapping, an `assets` list of
    mappings, `bounds: {x:, y:, z:}` flow maps, scalars and comments;
    anything else is a refusal naming the line) and validated against the
    schema's rules in code: closed value sets, `name` `[a-z0-9-]+` and
    unique, `tri_budget` an int >= 12 (a cube), every bound > 0, colour
    overrides `#rrggbb`. A violation is a refusal naming the entry and the
    field (exit 2).
  - An entry's file is derived, never declared: `<art_path>/<name>.glb`.
    `check` runs the `facts` gate on it when it exists (red when its
    triangles exceed `tri_budget` or a bound is off by more than 1 %) and
    reports `missing` when it does not (not a failure: greybox not yet run).
  - `greybox` finds Blender through `--blender`, else `BLENDER`, else
    `blender` on PATH; none (or one naming no file) is a refusal naming it
    before anything is written. For every entry whose `.glb` is absent it
    writes the label PNG `<art_path>/<name>.label.png` (reused when present
    with this manifest's decoded image; a present one with other pixels,
    or one that does not decode, is `stale`:
    left untouched, Blender is not run for the entry and it fails, naming
    the label the operator must remove first), hands Blender one JSON spec (`name, category, colour,
    bounds, origin, collision, tri_budget, label, output`) as
    `<blender> -b --python <plugin>/lib/blender/greybox.py -- --spec <json>`
    and hard-links the exported `.glb` into place (a name that exists by
    then is never overwritten). It never overwrites an existing `.glb` or
    label.
  - A name longer than the label's two lines (112 characters: two lines of
    56 glyphs of the 3x5 font at scale 1) is a `check` refusal on `name`. The whole run is bounded by `--wall`
    (default 600 s); an overrun kills Blender's tree and fails the entry.
  - The label PNG is drawn here with the stdlib (256x256 8-bit RGB, filter
    0, no tIME or text chunks): the category colour, a 4 px black border,
    the name in a 3x5 bitmap font in black, two lines when long. The same
    manifest gives the same bytes.
  - `facts` reads the `.glb` itself (header, JSON chunk, BIN chunk), never
    Blender: triangles from the primitives' index accessors (else their
    position counts), bounds from the position accessors' `min`/`max`, the
    origin as the bounds' relation to zero, UV presence (`TEXCOORD_0`) and
    the material count. Bounds are glTF axes (Y up): `y` is the height.
  - The status block keys close every result, in order: `status`
    (`complete`, `partial`, `blocked`), `intent` ("assets"), `artifacts`,
    `reason`.

Exit codes: 0 ok; 1 gate red or a Blender failure; 2 refusal or bad
invocation. Stdlib-only (NFR9). Blender runs only on the host.
"""
from __future__ import annotations

import argparse
import errno
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

import config
import playable

INTENT = "assets"
BLOCK_KEYS = ("status", "intent", "artifacts", "reason")

LIB = Path(__file__).resolve().parent
PLUGIN_ROOT = LIB.parent
GREYBOX_SCRIPT = LIB / "blender" / "greybox.py"
SCHEMA_PATH = PLUGIN_ROOT / "contracts" / "asset-manifest.schema.json"

# The project-layout config keys (ruling (b)) and their defaults.
KEY_MANIFEST = "assets.manifest"
KEY_ART_PATH = "assets.art_path"
DEFAULT_MANIFEST = "assets/manifest.yaml"
DEFAULT_ART_PATH = "art/greybox"

# The closed value sets (ruling (c)); the schema file carries the same ones
# (test_assets pins the agreement).
SCHEMA_VERSION = 1
CATEGORIES = ("prop", "character", "environment", "vehicle", "ui", "fx")
ORIGINS = ("base-center", "center", "base-min-corner")
COLLISIONS = ("none", "box", "capsule", "sphere", "mesh")
LICENCES = ("greybox", "cc0", "cc-by", "generated", "proprietary")
RUNGS = ("greybox", "cc0", "generated")
STATUSES = ("placeholder", "candidate", "accepted")
ENUMS = {"category": CATEGORIES, "origin": ORIGINS, "collision": COLLISIONS,
         "licence": LICENCES, "rung": RUNGS, "status": STATUSES}
REQUIRED_FIELDS = ("name", "category", "tri_budget", "bounds", "origin", "collision",
                   "licence", "rung", "status")
OPTIONAL_FIELDS = ("source",)
TOP_KEYS = ("schema", "categories", "assets")
AXES = ("x", "y", "z")
NAME_PATTERN = re.compile(r"^[a-z0-9-]+$")
COLOUR_PATTERN = re.compile(r"^#[0-9a-f]{6}$")
# a cube is 12 triangles: the smallest greybox there is (plan §6)
MIN_TRI_BUDGET = 12

# The category colour map (ruling (a), CAP-11): the one default table; the
# resolved colour travels to Blender in the spec. Never magenta (the
# judge's missing-texture signal, 34.3).
DEFAULT_COLOURS = {
    "prop": "#8a8a8a",
    "character": "#d98c3f",
    "environment": "#5b8c5a",
    "vehicle": "#4a78b5",
    "ui": "#c7b84a",
    "fx": "#9a5bb5",
}

# The Blender spec's keys, exactly (Design Notes).
SPEC_KEYS = ("name", "category", "colour", "bounds", "origin", "collision", "tri_budget",
             "label", "output")

BOUNDS_TOLERANCE = 0.01
DEFAULT_WALL_S = 600
MAX_WALL_S = 86400
LOG_TAIL = 10


class Refusal(Exception):
    """A refusal: nothing written (status blocked, exit 2)."""


# ------------------------------------------------------------- the reader

_KEY_LINE = re.compile(r"^([A-Za-z0-9_-]+):(?:\s+(.*))?$")
_INT = re.compile(r"^[-+]?\d+$")
_FLOAT = re.compile(r"^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$")


def _strip_comment(line: str) -> str:
    """``line`` without its ``#`` comment (a ``#`` at the start or after
    whitespace, outside quotes). A quote opens only where it begins a value:
    the first character after ``key: ``, after a ``- `` item marker, or
    inside a flow mapping after ``{``, ``,`` or ``:``; elsewhere (``Kenney's``)
    it is ordinary text."""
    quote = None
    flow = 0
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            prev = line[:i].rstrip()
            spaced = i > 0 and line[i - 1] in " \t"
            if (not prev or prev.strip() == "-"
                    or (prev[-1] == ":" and (spaced or flow))
                    or (flow and prev[-1] in "{,")):
                quote = ch
        elif ch == "{":
            flow += 1
        elif ch == "}" and flow:
            flow -= 1
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            return line[:i]
    return line


def _scalar(text: str, where: str):
    text = text.strip()
    if text.startswith('"') or text.startswith("'"):
        q = text[0]
        if len(text) < 2 or not text.endswith(q) or q in text[1:-1] or "\\" in text[1:-1]:
            raise Refusal(f"{where}: unsupported quoted value {text}")
        return text[1:-1]
    if text.startswith("{"):
        return _flow_map(text, where)
    if text.startswith("["):
        if text.replace(" ", "") == "[]":
            return []
        raise Refusal(f"{where}: flow lists are not part of the manifest subset")
    if text in ("true", "false"):
        return text == "true"
    if text in ("null", "~"):
        return None
    if _INT.match(text):
        return int(text)
    if _FLOAT.match(text):
        return float(text)
    if text.startswith(("&", "*", "!", "|", ">", "%", "@", "`")):
        raise Refusal(f"{where}: unsupported value {text}")
    if text == "-" or (text.startswith("-") and text[1] in " \t"):
        # a sequence indicator, not a value; ``-crate`` is a plain string
        raise Refusal(f"{where}: unsupported value {text}")
    return text


def _flow_map(text: str, where: str) -> dict:
    if not text.endswith("}"):
        raise Refusal(f"{where}: unterminated flow mapping {text}")
    inner = text[1:-1].strip()
    out: dict = {}
    if not inner:
        return out
    for part in inner.split(","):
        key, sep, value = part.partition(":")
        key = key.strip()
        if not sep or not re.match(r"^[A-Za-z0-9_-]+$", key):
            raise Refusal(f"{where}: bad flow mapping item {part.strip()!r}")
        if any(c in value for c in "{}[]"):
            raise Refusal(f"{where}: nested flow values are not part of the manifest subset")
        if key in out:
            raise Refusal(f"{where}: duplicate key {key}")
        out[key] = _scalar(value, where)
    return out


def _key_value(content: str, where: str):
    m = _KEY_LINE.match(content)
    if not m:
        raise Refusal(f"{where}: expected 'key: value', got {content!r}")
    key, rest = m.group(1), m.group(2)
    return key, (None if rest is None or not rest.strip() else rest)


def parse_manifest(text: str, label: str = "manifest") -> dict:
    """The manifest subset as plain data; anything outside it is a
    refusal naming ``label`` and the line."""
    lines: list[tuple[int, int, str]] = []
    for no, raw in enumerate(text.splitlines(), 1):
        body = _strip_comment(raw).rstrip()
        if not body.strip():
            continue
        lead = body[:len(body) - len(body.lstrip())]
        if "\t" in lead:
            raise Refusal(f"{label} line {no}: tab indentation")
        lines.append((no, len(lead), body.strip()))
    doc: dict = {}
    i = 0
    while i < len(lines):
        no, indent, content = lines[i]
        where = f"{label} line {no}"
        if indent != 0:
            raise Refusal(f"{where}: unexpected indentation")
        key, rest = _key_value(content, where)
        if key in doc:
            raise Refusal(f"{where}: duplicate key {key}")
        i += 1
        if rest is not None:
            doc[key] = _scalar(rest, where)
            continue
        block = []
        while i < len(lines) and lines[i][1] > 0:
            block.append(lines[i])
            i += 1
        if not block:
            # an indentless block list (PyYAML's default dump: ``assets:``
            # then ``- name: crate`` at column 0) with its deeper lines
            while i < len(lines) and (
                    lines[i][1] > 0 or lines[i][2] == "-" or lines[i][2].startswith("- ")):
                block.append(lines[i])
                i += 1
        if not block:
            doc[key] = None
        elif block[0][2] == "-" or block[0][2].startswith("- "):
            doc[key] = _block_list(block, label)
        else:
            doc[key] = _block_map(block, label)
    return doc


def _block_map(block, label) -> dict:
    out: dict = {}
    indent = block[0][1]
    for no, ind, content in block:
        where = f"{label} line {no}"
        if ind != indent:
            raise Refusal(f"{where}: nested blocks are not part of the manifest subset")
        key, rest = _key_value(content, where)
        if key in out:
            raise Refusal(f"{where}: duplicate key {key}")
        out[key] = None if rest is None else _scalar(rest, where)
    return out


def _block_list(block, label) -> list:
    items: list[dict] = []
    dash = block[0][1]
    key_indent = None
    for no, ind, content in block:
        where = f"{label} line {no}"
        if ind == dash and (content == "-" or content.startswith("- ")):
            items.append({})
            content = content[1:].strip()
            key_indent = dash + 2
            if not content:
                continue
        elif ind != key_indent or not items:
            raise Refusal(f"{where}: nested blocks are not part of the manifest subset")
        key, rest = _key_value(content, where)
        if key in items[-1]:
            raise Refusal(f"{where}: duplicate key {key}")
        items[-1][key] = None if rest is None else _scalar(rest, where)
    return items


# ---------------------------------------------------------- the validator

def _number(value) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))


def validate(doc, label: str = "manifest") -> dict:
    """The manifest normalised (``categories`` resolved to the full colour
    map); a refusal naming the entry and the field otherwise."""
    if not isinstance(doc, dict):
        raise Refusal(f"{label}: not a mapping")
    for key in doc:
        if key not in TOP_KEYS:
            raise Refusal(f"{label}: unknown top-level key {key} (one of "
                          + ", ".join(TOP_KEYS) + ")")
    if doc.get("schema") != SCHEMA_VERSION or isinstance(doc.get("schema"), bool):
        raise Refusal(f"{label}: schema: {doc.get('schema')!r} is not {SCHEMA_VERSION}")
    overrides = doc.get("categories")
    if overrides is None:
        overrides = {}
    if not isinstance(overrides, dict):
        raise Refusal(f"{label}: categories: not a mapping")
    colours = dict(DEFAULT_COLOURS)
    for cat, colour in overrides.items():
        if cat not in CATEGORIES:
            raise Refusal(f"{label}: categories: {cat!r} is not one of " + " | ".join(CATEGORIES))
        if not isinstance(colour, str) or not COLOUR_PATTERN.match(colour):
            raise Refusal(f"{label}: categories.{cat}: {colour!r} is not a '#rrggbb' colour "
                          "(lower-case hex)")
        colours[cat] = colour
    assets = doc.get("assets")
    if not isinstance(assets, list):
        raise Refusal(f"{label}: assets: missing or not a list")
    seen: set[str] = set()
    entries = []
    for index, entry in enumerate(assets):
        entries.append(_validate_entry(entry, index, label, seen))
    return {"schema": SCHEMA_VERSION, "colours": colours, "assets": entries}


def _validate_entry(entry, index: int, label: str, seen: set) -> dict:
    name = entry.get("name") if isinstance(entry, dict) else None
    who = (f"{label}: entry {name}" if isinstance(name, str) and NAME_PATTERN.match(name)
           else f"{label}: entry #{index + 1}")
    if not isinstance(entry, dict):
        raise Refusal(f"{who}: not a mapping")
    for key in entry:
        if key not in REQUIRED_FIELDS + OPTIONAL_FIELDS:
            raise Refusal(f"{who}: unknown field {key}")
    for key in REQUIRED_FIELDS:
        if entry.get(key) is None:
            raise Refusal(f"{who}: {key}: missing")
    if not isinstance(name, str) or not NAME_PATTERN.match(name):
        raise Refusal(f"{who}: name: {name!r} does not match [a-z0-9-]+")
    if name in seen:
        raise Refusal(f"{who}: name: duplicate name {name}")
    if label_lines(name) is None:
        raise Refusal(f"{who}: name: {len(name)} characters do not fit the label texture "
                      f"(at most {LABEL_MAX_NAME}: two lines of {LABEL_MAX_LINE})")
    seen.add(name)
    for key, allowed in ENUMS.items():
        if entry[key] not in allowed or not isinstance(entry[key], str):
            raise Refusal(f"{who}: {key}: {entry[key]!r} is not one of " + " | ".join(allowed))
    budget = entry["tri_budget"]
    if not isinstance(budget, int) or isinstance(budget, bool) or budget <= 0:
        raise Refusal(f"{who}: tri_budget: {budget!r} is not an integer > 0")
    if budget < MIN_TRI_BUDGET:
        raise Refusal(f"{who}: tri_budget: {budget} is below {MIN_TRI_BUDGET} "
                      "(a greybox cube is 12 triangles)")
    bounds = entry["bounds"]
    if not isinstance(bounds, dict) or sorted(bounds) != sorted(AXES):
        raise Refusal(f"{who}: bounds: must be {{x:, y:, z:}} in metres")
    for axis in AXES:
        if not _number(bounds[axis]) or bounds[axis] <= 0:
            raise Refusal(f"{who}: bounds.{axis}: {bounds[axis]!r} is not a number > 0")
    source = entry.get("source", "")
    if source is None:
        source = ""
    if not isinstance(source, str):
        raise Refusal(f"{who}: source: {source!r} is not a string")
    out = {k: entry[k] for k in REQUIRED_FIELDS}
    out["bounds"] = {a: float(bounds[a]) for a in AXES}
    out["source"] = source
    return out


# --------------------------------------------------------------- the paths

def _config_path(key: str, default: str, project: Path) -> str:
    try:
        value, _scope = config.resolve(key, project)
    except config.ConfigError as exc:
        if str(exc).startswith(f"key '{key}' is not defined"):
            return default
        raise Refusal(f"config: {exc}") from None
    if not isinstance(value, str) or not value.strip():
        raise Refusal(f"config: {key}: {value!r} is not a path")
    return value.strip()


def _under(project: Path, value: str) -> Path:
    path = Path(value)
    return (path if path.is_absolute() else project / path).resolve()


def _rel(path: Path, project: Path) -> str:
    try:
        return path.resolve().relative_to(project).as_posix()
    except ValueError:
        return str(path)


def resolve_layout(directory: str, manifest: str | None,
                   art_path: str | None) -> tuple[Path, Path, Path]:
    """``(project, manifest file, art folder)``."""
    project = Path(directory).resolve()
    if not project.is_dir():
        raise Refusal(f"--directory: not a directory: {project}")
    m = manifest if manifest is not None else _config_path(KEY_MANIFEST, DEFAULT_MANIFEST, project)
    a = art_path if art_path is not None else _config_path(KEY_ART_PATH, DEFAULT_ART_PATH, project)
    return project, _under(project, m), _under(project, a)


def load_manifest(path: Path, project: Path) -> dict:
    label = _rel(path, project)
    if not path.is_file():
        raise Refusal(f"no manifest: {label} does not exist")
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise Refusal(f"manifest {label} unreadable ({exc})") from None
    return validate(parse_manifest(text, label), label)


def asset_file(art: Path, name: str) -> Path:
    """The entry's derived file (ruling (d))."""
    return art / f"{name}.glb"


def label_file(art: Path, name: str) -> Path:
    return art / f"{name}.label.png"


# ------------------------------------------------------------ the label PNG

LABEL_SIZE = 256
LABEL_BORDER = 4
LABEL_MARGIN = 16
LABEL_MAX_SCALE = 8
# below this scale on one line the name breaks onto two
LABEL_TWO_LINE_BELOW = 4

FONT = {
    "a": ("010", "101", "111", "101", "101"), "b": ("110", "101", "110", "101", "110"),
    "c": ("011", "100", "100", "100", "011"), "d": ("110", "101", "101", "101", "110"),
    "e": ("111", "100", "110", "100", "111"), "f": ("111", "100", "110", "100", "100"),
    "g": ("011", "100", "101", "101", "011"), "h": ("101", "101", "111", "101", "101"),
    "i": ("111", "010", "010", "010", "111"), "j": ("001", "001", "001", "101", "010"),
    "k": ("101", "101", "110", "101", "101"), "l": ("100", "100", "100", "100", "111"),
    "m": ("101", "111", "111", "101", "101"), "n": ("110", "101", "101", "101", "101"),
    "o": ("010", "101", "101", "101", "010"), "p": ("110", "101", "110", "100", "100"),
    "q": ("010", "101", "101", "110", "011"), "r": ("110", "101", "110", "101", "101"),
    "s": ("011", "100", "010", "001", "110"), "t": ("111", "010", "010", "010", "010"),
    "u": ("101", "101", "101", "101", "111"), "v": ("101", "101", "101", "101", "010"),
    "w": ("101", "101", "111", "111", "101"), "x": ("101", "101", "010", "101", "101"),
    "y": ("101", "101", "010", "010", "010"), "z": ("111", "001", "010", "100", "111"),
    "0": ("111", "101", "101", "101", "111"), "1": ("010", "110", "010", "010", "111"),
    "2": ("110", "001", "010", "100", "111"), "3": ("110", "001", "010", "001", "110"),
    "4": ("101", "101", "111", "001", "001"), "5": ("111", "100", "110", "001", "110"),
    "6": ("011", "100", "111", "101", "111"), "7": ("111", "001", "010", "010", "010"),
    "8": ("111", "101", "111", "101", "111"), "9": ("111", "101", "111", "001", "110"),
    "-": ("000", "000", "111", "000", "000"),
}


LABEL_ROOM = LABEL_SIZE - 2 * LABEL_MARGIN
# the longest line the 3x5 font fits at scale 1 (a glyph is 3 px plus 1 px
# spacing), and so the longest name the label carries on its two lines
LABEL_MAX_LINE = (LABEL_ROOM + 1) // 4
LABEL_MAX_NAME = 2 * LABEL_MAX_LINE


def _fit(lines: list[str]) -> int:
    """The largest glyph scale (at most ``LABEL_MAX_SCALE``) that fits
    ``lines`` inside the label's margins; 0 when none does."""
    widest = max(len(line) for line in lines)
    by_width = LABEL_ROOM // max(1, 4 * widest - 1)
    by_height = LABEL_ROOM // (5 * len(lines) + 2 * (len(lines) - 1))
    return min(LABEL_MAX_SCALE, by_width, by_height)


def label_lines(name: str) -> tuple[list[str], int] | None:
    """The name's lines and the font scale: one line, else two broken at
    the hyphen nearest the middle (kept on the first line), else at the
    middle; None when the name fits no two lines even at scale 1 (longer
    than ``LABEL_MAX_NAME``)."""
    lines = [name]
    scale = _fit(lines)
    if scale < LABEL_TWO_LINE_BELOW and len(name) > 1:
        mid = len(name) / 2
        cuts = [i for i, ch in enumerate(name) if ch == "-" and 0 < i < len(name) - 1]
        options = []
        if cuts:
            cut = min(cuts, key=lambda i: (abs(i + 1 - mid), i)) + 1
            options.append([name[:cut], name[cut:]])
        cut = math.ceil(mid)
        options.append([name[:cut], name[cut:]])
        for two in options:
            two_scale = _fit(two)
            if two_scale >= 1 and (two_scale > scale or scale < 1):
                lines, scale = two, two_scale
                break
    if scale < 1:
        return None
    return lines, scale


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))


def label_png(name: str, colour: str) -> bytes:
    """The label texture's PNG bytes, deterministic (ruling (f))."""
    size = LABEL_SIZE
    fill = bytes.fromhex(colour[1:])
    black = b"\x00\x00\x00"
    pixels = [bytearray(fill * size) for _ in range(size)]
    for y in range(size):
        for x in range(size):
            if x < LABEL_BORDER or y < LABEL_BORDER or x >= size - LABEL_BORDER \
                    or y >= size - LABEL_BORDER:
                pixels[y][3 * x:3 * x + 3] = black
    fitted = label_lines(name)
    if fitted is None:
        raise ValueError(f"name {name!r} is longer than the label carries ({LABEL_MAX_NAME})")
    lines, scale = fitted
    block_h = (5 * len(lines) + 2 * (len(lines) - 1)) * scale
    top = (size - block_h) // 2
    for row, line in enumerate(lines):
        width = (4 * len(line) - 1) * scale
        left = (size - width) // 2
        y0 = top + row * 7 * scale
        for ci, ch in enumerate(line):
            glyph = FONT.get(ch, FONT["-"])
            gx = left + ci * 4 * scale
            for gy, bits in enumerate(glyph):
                for bx, bit in enumerate(bits):
                    if bit != "1":
                        continue
                    for dy in range(scale):
                        py = y0 + gy * scale + dy
                        if not LABEL_BORDER <= py < size - LABEL_BORDER:
                            continue
                        for dx in range(scale):
                            px = gx + bx * scale + dx
                            if LABEL_BORDER <= px < size - LABEL_BORDER:
                                pixels[py][3 * px:3 * px + 3] = black
    raw = b"".join(b"\x00" + bytes(r) for r in pixels)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr)
            + _png_chunk(b"IDAT", zlib.compress(raw, 9)) + _png_chunk(b"IEND", b""))


def _png_image(data: bytes):
    """A PNG's decoded image ``(IHDR, decompressed IDAT data)``, or None when
    ``data`` is not a readable PNG; independent of the zlib build."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    offset, ihdr, idat, ended = 8, None, [], False
    while offset + 12 <= len(data):
        length, kind = struct.unpack_from(">I4s", data, offset)
        end = offset + 12 + length
        if end > len(data):
            return None
        body = data[offset + 8:offset + 8 + length]
        if struct.unpack_from(">I", data, end - 4)[0] != zlib.crc32(kind + body) & 0xFFFFFFFF:
            return None
        if kind == b"IHDR":
            ihdr = body
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            ended = True
            break
        offset = end
    if ihdr is None or not idat or not ended:
        return None
    try:
        return ihdr, zlib.decompress(b"".join(idat))
    except zlib.error:
        return None


# ------------------------------------------------------------ the GLB reader

GLB_MAGIC = b"glTF"
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def _accessor(doc: dict, index, what: str) -> dict:
    accessors = doc.get("accessors")
    if not isinstance(index, int) or isinstance(index, bool) or not isinstance(accessors, list) \
            or not 0 <= index < len(accessors) or not isinstance(accessors[index], dict):
        raise Refusal(f"malformed GLB: {what} names no accessor ({index!r})")
    acc = accessors[index]
    if not isinstance(acc.get("count"), int) or acc["count"] < 0:
        raise Refusal(f"malformed GLB: accessor {index} has no count")
    return acc


def _vec3(value, what: str) -> list[float]:
    if not isinstance(value, list) or len(value) != 3 or not all(_number(v) for v in value):
        raise Refusal(f"malformed GLB: {what} is not three numbers")
    return [float(v) for v in value]


def _close(value: float, extent: float) -> bool:
    return abs(value) <= max(1e-6, BOUNDS_TOLERANCE * extent)


def classify_origin(lo: list[float], hi: list[float]) -> str:
    """The bounds' relation to zero: ``center``, ``base-center`` (Y up),
    ``base-min-corner``, else ``other``."""
    ext = [h - l for l, h in zip(lo, hi)]
    mid = [(l + h) / 2 for l, h in zip(lo, hi)]
    if all(_close(m, e) for m, e in zip(mid, ext)):
        return "center"
    if _close(lo[1], ext[1]) and _close(mid[0], ext[0]) and _close(mid[2], ext[2]):
        return "base-center"
    if all(_close(l, e) for l, e in zip(lo, ext)):
        return "base-min-corner"
    return "other"


def read_glb(data: bytes) -> tuple[dict, bytes | None]:
    """``(json document, BIN chunk or None)``; a refusal when malformed."""
    if len(data) < 12:
        raise Refusal("malformed GLB: shorter than its 12-byte header")
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != GLB_MAGIC:
        raise Refusal("malformed GLB: no glTF magic")
    if version != 2:
        raise Refusal(f"malformed GLB: version {version} (expected 2)")
    if length != len(data):
        raise Refusal(f"malformed GLB: header length {length} is not the file size {len(data)}")
    chunks = []
    offset = 12
    while offset < length:
        if offset + 8 > length:
            raise Refusal("malformed GLB: truncated chunk header")
        clen, ctype = struct.unpack_from("<II", data, offset)
        if offset + 8 + clen > length:
            raise Refusal("malformed GLB: chunk runs past the end")
        chunks.append((ctype, data[offset + 8:offset + 8 + clen]))
        offset += 8 + clen
    if not chunks or chunks[0][0] != CHUNK_JSON:
        raise Refusal("malformed GLB: the first chunk is not JSON")
    try:
        doc = json.loads(chunks[0][1].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Refusal(f"malformed GLB: JSON chunk unreadable ({exc})") from None
    if not isinstance(doc, dict):
        raise Refusal("malformed GLB: JSON chunk is not an object")
    binary = next((c for t, c in chunks[1:] if t == CHUNK_BIN), None)
    return doc, binary


def facts_of(data: bytes) -> dict:
    """The facts of one GLB: triangles, bounds, origin, uv, materials."""
    doc, _binary = read_glb(data)
    meshes = doc.get("meshes")
    if not isinstance(meshes, list) or not meshes:
        raise Refusal("malformed GLB: no meshes")
    triangles = 0
    uv = False
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for mi, mesh in enumerate(meshes):
        prims = mesh.get("primitives") if isinstance(mesh, dict) else None
        if not isinstance(prims, list) or not prims:
            raise Refusal(f"malformed GLB: mesh {mi} has no primitives")
        for pi, prim in enumerate(prims):
            where = f"mesh {mi} primitive {pi}"
            attrs = prim.get("attributes") if isinstance(prim, dict) else None
            if not isinstance(attrs, dict) or "POSITION" not in attrs:
                raise Refusal(f"malformed GLB: {where} has no POSITION")
            pos = _accessor(doc, attrs["POSITION"], f"{where} POSITION")
            if "min" not in pos or "max" not in pos:
                raise Refusal(f"malformed GLB: {where} POSITION has no min/max")
            pmin = _vec3(pos["min"], f"{where} POSITION min")
            pmax = _vec3(pos["max"], f"{where} POSITION max")
            lo = [min(a, b) for a, b in zip(lo, pmin)]
            hi = [max(a, b) for a, b in zip(hi, pmax)]
            if "TEXCOORD_0" in attrs:
                uv = True
            count = (_accessor(doc, prim["indices"], f"{where} indices")["count"]
                     if "indices" in prim else pos["count"])
            mode = prim.get("mode", 4)
            if mode == 4:
                triangles += count // 3
            elif mode in (5, 6):
                triangles += max(0, count - 2)
    materials = doc.get("materials")
    extent = [h - l for l, h in zip(lo, hi)]
    return {
        "triangles": triangles,
        "bounds": {a: round(e, 6) for a, e in zip(AXES, extent)},
        "min": [round(v, 6) for v in lo],
        "max": [round(v, 6) for v in hi],
        "origin": classify_origin(lo, hi),
        "uv": uv,
        "materials": len(materials) if isinstance(materials, list) else 0,
    }


def gate(entry: dict, facts: dict) -> list[str]:
    """Why ``facts`` break ``entry``'s budget or bounds (empty: pass)."""
    reasons = []
    if facts["triangles"] > entry["tri_budget"]:
        reasons.append(f"triangles {facts['triangles']} over tri_budget {entry['tri_budget']}")
    for axis in AXES:
        want = entry["bounds"][axis]
        got = facts["bounds"][axis]
        if abs(got - want) > BOUNDS_TOLERANCE * want + 1e-9:
            reasons.append(f"bounds.{axis} {got:g} off {want:g} by more than 1 %")
    return reasons


# ------------------------------------------------------------- the status

def with_block(result: dict, status: str, artifacts: list[str], reason: str | None) -> dict:
    out = {k: v for k, v in result.items() if k not in BLOCK_KEYS}
    out.update(status=status, intent=INTENT, artifacts=list(artifacts), reason=reason)
    return out


def _blocked(exc: Exception) -> tuple[dict, int]:
    return with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)), 2


def _publish_new(path: Path, data: bytes) -> bool:
    """Write ``data`` to ``path`` only if ``path`` does not exist, whole or
    not at all: the bytes go to a temp file beside it, which is hard-linked
    into place (``os.link`` fails on an existing name, so a file created in
    between is never overwritten). Where hard links are unsupported, an
    exclusive create stands in. Returns False (nothing touched) when
    ``path`` exists."""
    tmp = path.with_name(f"{path.name}.tk-studio-{os.getpid()}.tmp")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        try:
            os.link(tmp, path)
            return True
        except FileExistsError:
            return False
        except (AttributeError, NotImplementedError, PermissionError) as exc:
            del exc  # no hard links here: exclusive create instead
        except OSError as exc:
            if exc.errno not in (errno.EPERM, errno.ENOTSUP, errno.EOPNOTSUPP, errno.ENOSYS,
                                 errno.EXDEV, errno.EMLINK):
                raise
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0))
        except FileExistsError:
            return False
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
        except BaseException:
            # the exclusive create made this name, so a partial file here is
            # ours: remove it rather than leave a truncated asset behind
            try:
                path.unlink()
            except OSError:
                pass
            raise
        return True
    finally:
        if tmp.exists():
            tmp.unlink()


# ------------------------------------------------------------------ verbs

def check(*, directory: str, manifest: str | None = None,
          art_path: str | None = None) -> tuple[dict, int]:
    """Validate the manifest; report every entry, gating present files."""
    try:
        project, mpath, art = resolve_layout(directory, manifest, art_path)
        doc = load_manifest(mpath, project)
    except Refusal as exc:
        return _blocked(exc)
    entries = []
    for entry in doc["assets"]:
        path = asset_file(art, entry["name"])
        row = {"name": entry["name"], "rung": entry["rung"], "status": entry["status"],
               "file": _rel(path, project), "present": path.is_file(), "facts": None,
               "verdict": "missing", "reasons": []}
        if row["present"]:
            try:
                row["facts"] = facts_of(path.read_bytes())
                row["reasons"] = gate(entry, row["facts"])
            except Refusal as exc:
                row["reasons"] = [str(exc)]
            except OSError as exc:
                row["reasons"] = [f"unreadable ({exc})"]
            row["verdict"] = "fail" if row["reasons"] else "pass"
        entries.append(row)
    failed = [e for e in entries if e["verdict"] == "fail"]
    counts = {v: sum(1 for e in entries if e["verdict"] == v) for v in ("pass", "fail", "missing")}
    result = {"ok": not failed, "manifest": _rel(mpath, project), "art_path": _rel(art, project),
              "entries": entries, "counts": counts}
    if failed:
        reason = "facts gate red: " + "; ".join(
            f"{e['name']}: {', '.join(e['reasons'])}" for e in failed)
        return with_block(result, "partial", [], reason), 1
    return with_block(result, "complete", [], None), 0


def resolve_blender(arg: str | None, env=None) -> str:
    """``--blender``, else ``BLENDER`` (stripped), else ``blender`` on PATH."""
    env = os.environ if env is None else env
    if arg is not None or (env.get("BLENDER") or "").strip():
        name = "--blender" if arg is not None else "BLENDER"
        value = (arg if arg is not None else env["BLENDER"]).strip()
        path = Path(value)
        if not value or not path.is_file():
            raise Refusal(f"no blender: {name} names {value!r}, which is not a file "
                          "(set BLENDER to blender.exe, runbook §2)")
        return str(path.resolve())
    found = shutil.which("blender", path=env.get("PATH"))
    if found is None:
        raise Refusal("no blender: BLENDER is unset and no blender is on PATH "
                      "(set BLENDER to blender.exe, runbook §2)")
    return str(Path(found).resolve())  # resolved like the BLENDER branch (Windows' which answers in PATHEXT's case)


def blender_argv(blender: str, spec_path: Path) -> list[str]:
    return [blender, "-b", "--python", str(GREYBOX_SCRIPT), "--", "--spec", str(spec_path)]


def run_blender(argv: list[str], *, cwd: Path, log_path: Path,
                timeout_s: float) -> tuple[int | None, bool, int]:
    """Start Blender with its output in ``log_path``; kill its tree on
    overrun. Returns ``(exit | None, timed_out, duration_ms)``.
    Module-level so tests inject a fake."""
    started = time.monotonic()
    extra = {} if os.name == "nt" else {"start_new_session": True}
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(argv, cwd=str(cwd), stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, **extra)
        try:
            code: int | None = proc.wait(timeout=timeout_s)
            timed_out = False
        except subprocess.TimeoutExpired:
            playable.kill_tree(proc)
            code, timed_out = None, True
    return code, timed_out, int((time.monotonic() - started) * 1000)


def _tail(log_path: Path) -> str:
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return " | ".join(line.strip() for line in lines[-LOG_TAIL:] if line.strip())


def greybox(*, directory: str, manifest: str | None = None, art_path: str | None = None,
            blender: str | None = None, wall: str | float = DEFAULT_WALL_S,
            env=None) -> tuple[dict, int]:
    """Write the greybox of every entry whose ``.glb`` is absent."""
    try:
        try:
            wall_s = float(wall)
        except (TypeError, ValueError):
            raise Refusal(f"--wall {wall!r} is not a number") from None
        if not (math.isfinite(wall_s) and 0 < wall_s <= MAX_WALL_S):
            raise Refusal(f"--wall {wall_s:g} must be a finite number of seconds "
                          f"> 0 and <= {MAX_WALL_S}")
        project, mpath, art = resolve_layout(directory, manifest, art_path)
        doc = load_manifest(mpath, project)
        binary = resolve_blender(blender, env)
    except Refusal as exc:
        return _blocked(exc)

    deadline = time.monotonic() + wall_s
    entries: list[dict] = []
    artifacts: list[str] = []
    try:
        temp = Path(tempfile.mkdtemp(prefix="tk-greybox-"))
    except OSError as exc:
        return _blocked(Refusal(f"no temp directory for the greybox run: {exc}"))
    try:
        spent = False
        for entry in doc["assets"]:
            name = entry["name"]
            glb, label = asset_file(art, name), label_file(art, name)
            row = {"name": name, "file": _rel(glb, project), "label": _rel(label, project),
                   "label_state": None, "action": None, "reason": None}
            entries.append(row)
            if glb.exists():
                row["action"] = "skipped"
                row["reason"] = "file exists"
                continue
            if spent:
                row["action"], row["reason"] = "not-run", "wall clock spent"
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                spent = True
                row["action"], row["reason"] = "not-run", "wall clock spent"
                continue
            colour = doc["colours"][entry["category"]]
            fresh = label_png(name, colour)
            try:
                art.mkdir(parents=True, exist_ok=True)
                if _publish_new(label, fresh):
                    row["label_state"] = "written"
                    artifacts.append(row["label"])
                elif _png_image(label.read_bytes()) == _png_image(fresh):
                    # the decoded image, not the file bytes: the compressed
                    # IDAT differs between zlib builds for the same pixels
                    row["label_state"] = "kept"
                else:
                    # an earlier run's label (another category or colour):
                    # never touched, never embedded, and no greybox over it
                    row["label_state"] = "stale"
            except OSError as exc:
                row["action"], row["reason"] = "failed", f"label not written: {exc}"
                continue
            if row["label_state"] == "stale":
                row["action"] = "failed"
                row["reason"] = (f"label: stale ({row['label']} differs from this manifest's "
                                 "label; remove it first, then run greybox again)")
                continue
            output = temp / f"{name}.glb"
            spec = {"name": name, "category": entry["category"], "colour": colour,
                    "bounds": entry["bounds"], "origin": entry["origin"],
                    "collision": entry["collision"], "tri_budget": entry["tri_budget"],
                    "label": str(label), "output": str(output)}
            spec_path = temp / f"{name}.spec.json"
            try:
                spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
            except OSError as exc:
                row["action"], row["reason"] = "failed", f"spec not written: {exc}"
                continue
            log_path = temp / f"{name}.log"
            argv = blender_argv(binary, spec_path)
            row["argv"] = argv
            try:
                code, timed_out, duration_ms = run_blender(argv, cwd=project, log_path=log_path,
                                                           timeout_s=remaining)
            except OSError as exc:
                row["action"], row["reason"] = "failed", f"could not start {binary}: {exc}"
                continue
            row["exit"], row["duration_ms"] = code, duration_ms
            if timed_out:
                spent = True
                row["action"] = "failed"
                row["reason"] = f"wall clock: {wall_s:g}s exceeded (blender killed)"
                continue
            if code != 0:
                row["action"] = "failed"
                row["reason"] = f"blender exit {code}: {_tail(log_path)}".rstrip(": ")
                continue
            if not output.is_file():
                row["action"] = "failed"
                row["reason"] = f"blender exit 0 but wrote no {output.name}"
                continue
            try:
                data = output.read_bytes()
            except OSError as exc:
                row["action"], row["reason"] = "failed", f"{output.name} unreadable: {exc}"
                continue
            # the facts gate before placing: an export over budget, off its
            # bounds or malformed is never published (a later run would skip it)
            try:
                reasons = gate(entry, facts_of(data))
            except (Refusal, ValueError, TypeError, KeyError) as exc:
                row["action"], row["reason"] = "failed", f"gate: unreadable glb ({exc})"
                continue
            if reasons:
                row["action"], row["reason"] = "failed", "gate: " + "; ".join(reasons)
                continue
            try:
                placed = _publish_new(glb, data)
            except OSError as exc:
                row["action"], row["reason"] = "failed", f"{row['file']} not written: {exc}"
                continue
            if not placed:
                row["action"], row["reason"] = "skipped", "file appeared during the run"
                continue
            row["action"] = "written"
            artifacts.append(row["file"])
    finally:
        shutil.rmtree(temp, ignore_errors=True)

    failed = [e for e in entries if e["action"] in ("failed", "not-run")]
    counts = {a: sum(1 for e in entries if e["action"] == a)
              for a in ("written", "skipped", "failed", "not-run")}
    result = {"ok": not failed, "manifest": _rel(mpath, project), "art_path": _rel(art, project),
              "blender": binary, "wall_s": wall_s, "entries": entries, "counts": counts}
    if failed:
        reason = "greybox failed: " + "; ".join(f"{e['name']}: {e['reason']}" for e in failed)
        return with_block(result, "partial", artifacts, reason), 1
    return with_block(result, "complete", artifacts, None), 0


def facts(file: str) -> tuple[dict, int]:
    """The facts of one ``.glb``, read with the stdlib."""
    path = Path(file)
    try:
        if not path.is_file():
            raise Refusal(f"no file: {file}")
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise Refusal(f"{file} unreadable ({exc})") from None
        result = {"ok": True, "file": str(path), **facts_of(data)}
    except Refusal as exc:
        return _blocked(exc)
    return with_block(result, "complete", [], None), 0


# -------------------------------------------------------------------- cli

class _Parser(argparse.ArgumentParser):
    def error(self, message: str):  # noqa: D401 - argparse hook
        raise Refusal(f"bad invocation: {message}")


def _emit(result: dict) -> None:
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = _Parser(description="tk-studio assets — the asset manifest and the greybox rung")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    for verb, text in (("check", "validate the manifest and gate every present file"),
                       ("greybox", "write the greybox of every entry without a file")):
        p = sub.add_parser(verb, help=text)
        p.add_argument("--directory", required=True, help="the project root")
        p.add_argument("--manifest", help=f"the manifest (default: {KEY_MANIFEST}, "
                                          f"else {DEFAULT_MANIFEST})")
        p.add_argument("--art-path", help=f"the art folder (default: {KEY_ART_PATH}, "
                                          f"else {DEFAULT_ART_PATH})")
        if verb == "greybox":
            p.add_argument("--blender", help="the Blender binary (default: BLENDER, "
                                             "else blender on PATH)")
            p.add_argument("--wall", default=DEFAULT_WALL_S,
                           help=f"seconds for the whole run (default {DEFAULT_WALL_S})")
    p = sub.add_parser("facts", help="the facts of one .glb, from the file itself")
    p.add_argument("file")
    try:
        args = parser.parse_args(argv)
    except Refusal as exc:
        _emit(_blocked(exc)[0])
        return 2
    if args.command == "check":
        result, code = check(directory=args.directory, manifest=args.manifest,
                             art_path=args.art_path)
    elif args.command == "greybox":
        result, code = greybox(directory=args.directory, manifest=args.manifest,
                               art_path=args.art_path, blender=args.blender, wall=args.wall)
    else:
        result, code = facts(args.file)
    _emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
