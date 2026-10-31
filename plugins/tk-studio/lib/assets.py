"""tk-studio assets — the asset manifest and the ladder: the greybox rung
(Story 34.6, CAP-11 and CAP-12; plans/34-6.md §Settled shape), the cc0 and
generated rungs (Story 34.7, CAP-13 and CAP-14; plans/34-7.md §Settled
shape 1 to 10).

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
  uv run assets.py mirror-index --kit DIR --category CAT [--licence cc0]
  uv run assets.py match    --directory DIR [--manifest PATH] [--art-path PATH]
                           [--mirror DIR] [--blender PATH] [--wall S]
  uv run assets.py generate --directory DIR --run-id ID [--manifest PATH]
                           [--art-path PATH] [--blender PATH] [--wall S]

Guarantees:
  - The manifest is `--manifest`, else the project config's
    `assets.manifest` (default `assets/manifest.yaml`); the art path is
    `--art-path`, else `assets.art_path` (default `art/greybox`; TUA's is
    `art/world/greybox`). A relative value is relative to `--directory`.
  - The manifest is read by this module's own narrow reader (the manifest
    subset only: a top `schema`, a `categories` mapping, an optional top
    `camera: {yaw:, pitch:}` flow map, an `assets` list of mappings,
    `bounds: {x:, y:, z:}` flow maps, `tags: [a, b]` flow lists of plain
    scalars, scalars (a `prompt` among them) and comments; anything else is
    a refusal naming the line) and validated against the
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
  - `mirror-index` writes `<kit>/index.json` (`{schema: 1, kit, licence,
    licence_file, assets: [{path, category, tags[]}]}`, sorted by path; the
    `.glb`, `.gltf`, `.fbx` and `.obj` files; `.blend` counted in
    `skipped`); a kit without a licence file is a refusal.
  - `match` (the cc0 rung) and `generate` (the generated rung, refused
    unless `.tk-studio/budget-bands.yaml` sets `assets.credit_cap` and
    `TK_ASSETS_MESHY_KEY` exists as a User environment variable) normalise
    the replacement through `lib/blender/normalise.py`, publish it to
    `<art_path>/.candidates/<name>.glb`, run the `facts` gate and the
    visual gate (`lib/blender/render.py`: coverage >= 0.25 of the greybox's
    silhouette, fill >= 0.005) and only then replace the placeholder
    (`os.replace`); they rewrite only the moved entries' `status`,
    `licence` and `source` lines. `generate` records every call through
    the ledger (`asset-generation`); the key is never printed or written.
  - The status block keys close every result, in order: `status`
    (`complete`, `partial`, `blocked`), `intent` ("assets"), `artifacts`,
    `reason`.

Exit codes: 0 ok; 1 gate red or a Blender failure; 2 refusal or bad
invocation. Stdlib-only (NFR9). Blender runs only on the host.
"""
from __future__ import annotations

import argparse
import errno
import fnmatch
import json
import math
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path, PurePosixPath, PureWindowsPath

import _core
import config
import ledger
import miniyaml
from _core import Refusal, _hkcu_value, _write_atomic
from _glb import (AXES, BOUNDS_TOLERANCE, CHUNK_BIN, CHUNK_JSON, GLB_MAGIC, _IDENTITY, _accessor, _close,
                  _mat_mul, _mesh_instances, _node_matrix, _number, _vec3, classify_origin,
                  facts_of, gate, read_glb)
from _png import alpha_mask, png_chunk as _png_chunk, png_encode, png_image as _png_image, png_pixels
from _proc import run_logged

INTENT = "assets"
BLOCK_KEYS = _core.BLOCK_KEYS

LIB = Path(__file__).resolve().parent
PLUGIN_ROOT = LIB.parent
GREYBOX_SCRIPT = LIB / "blender" / "greybox.py"
NORMALISE_SCRIPT = LIB / "blender" / "normalise.py"
RENDER_SCRIPT = LIB / "blender" / "render.py"
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
# Story 34.7 adds `tags` and `prompt` (entry) and `camera` (top level),
# all optional: a 34.6 manifest stays valid (plans/34-7.md §Settled shape 1)
OPTIONAL_FIELDS = ("source", "tags", "prompt")
TOP_KEYS = ("schema", "categories", "assets", "camera")
CAMERA_KEYS = ("yaw", "pitch")
DEFAULT_CAMERA = {"yaw": 45.0, "pitch": 30.0}
MAX_PITCH = 89
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

DEFAULT_WALL_S = 600
MAX_WALL_S = 86400
LOG_TAIL = 10


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
        return _flow_list(text, where)
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


def _flow_list(text: str, where: str) -> list:
    """``[a, b]`` of plain scalars (Story 34.7's ``tags``); a nested value
    (``[a, {b: c}]``, ``[[a]]``) is still a refusal."""
    if not text.endswith("]"):
        raise Refusal(f"{where}: unterminated flow list {text}")
    inner = text[1:-1].strip()
    if not inner:
        return []
    if any(c in inner for c in "{}[]"):
        raise Refusal(f"{where}: flow lists of plain scalars only (nested values are not "
                      "part of the manifest subset)")
    out = []
    for part in inner.split(","):
        if not part.strip():
            raise Refusal(f"{where}: empty item in flow list {text}")
        out.append(_scalar(part, where))
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
    camera = doc.get("camera")
    if camera is None:
        camera = {}
    if not isinstance(camera, dict):
        raise Refusal(f"{label}: camera: must be {{yaw:, pitch:}} in degrees")
    for key in camera:
        if key not in CAMERA_KEYS:
            raise Refusal(f"{label}: camera: unknown key {key} (yaw, pitch)")
    resolved = dict(DEFAULT_CAMERA)
    for key, value in camera.items():
        if not _number(value):
            raise Refusal(f"{label}: camera.{key}: {value!r} is not a number of degrees")
        resolved[key] = float(value)
    if not -MAX_PITCH <= resolved["pitch"] <= MAX_PITCH:
        raise Refusal(f"{label}: camera.pitch: {resolved['pitch']:g} is outside "
                      f"[-{MAX_PITCH}, {MAX_PITCH}]")
    seen: set[str] = set()
    entries = []
    for index, entry in enumerate(assets):
        entries.append(_validate_entry(entry, index, label, seen))
    return {"schema": SCHEMA_VERSION, "colours": colours, "camera": resolved, "assets": entries}


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
    tags = entry.get("tags")
    if tags is None:
        tags = []
    if not isinstance(tags, list):
        raise Refusal(f"{who}: tags: {tags!r} is not a flow list [a, b]")
    for tag in tags:
        if not isinstance(tag, str) or not NAME_PATTERN.match(tag):
            raise Refusal(f"{who}: tags: {tag!r} does not match [a-z0-9-]+")
    prompt = entry.get("prompt")
    if prompt is not None and (not isinstance(prompt, str) or not prompt.strip()):
        raise Refusal(f"{who}: prompt: {prompt!r} is not a non-empty string")
    out = {k: entry[k] for k in REQUIRED_FIELDS}
    out["bounds"] = {a: float(bounds[a]) for a in AXES}
    out["source"] = source
    out["tags"] = list(tags)
    out["prompt"] = prompt.strip() if prompt is not None else None
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
    return png_encode(raw, size, size)


# ------------------------------------------------------------- the status

def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    return _core.with_block(result, status, artifacts, reason, intent=INTENT)


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
    got = _core.resolve_binary(arg, env, "BLENDER", flag="--blender", allow_which="blender")
    if got.path is not None:
        return str(Path(got.path).resolve())  # resolved on both branches (Windows' which answers in PATHEXT's case)
    if got.problem == "unset":
        raise Refusal("no blender: BLENDER is unset and no blender is on PATH "
                      "(set BLENDER to blender.exe, runbook §2)")
    raise Refusal(f"no blender: {got.name} names {got.value!r}, which is not a file "
                  "(set BLENDER to blender.exe, runbook §2)")


def blender_argv(blender: str, spec_path: Path, script: Path = GREYBOX_SCRIPT) -> list[str]:
    """``<blender> -b --python <script> -- --spec <json>``; the script is
    greybox's, normalise's or render's (Story 34.7)."""
    return [blender, "-b", "--python", str(script), "--", "--spec", str(spec_path)]


def run_blender(argv: list[str], *, cwd: Path, log_path: Path,
                timeout_s: float) -> tuple[int | None, bool, int]:
    """Start Blender with its output in ``log_path``; kill its tree on
    overrun. Returns ``(exit | None, timed_out, duration_ms)``.
    Module-level so tests inject a fake."""
    code, timed_out, duration_ms, _confirmed = run_logged(
        argv, cwd=cwd, log_path=log_path, timeout_s=timeout_s)
    return code, timed_out, duration_ms


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


# ======================================================= the ladder (34.7)
#
# The cc0 and generated rungs (Story 34.7, CAP-13 and CAP-14; plans/34-7.md
# §Settled shape 1 to 10): `mirror-index` writes a kit's index, `match`
# replaces a placeholder with a matched kit asset, `generate` with a
# generated mesh behind the owner's credit cap. Both rungs normalise through
# headless Blender, publish the candidate beside the art, and replace the
# placeholder only after the facts gate and the visual gate pass.

MIRROR_ENV = "TK_ASSETS_MIRROR"
DEFAULT_MIRROR = r"C:\agent-work\assets"
INDEX_NAME = "index.json"
INDEX_SCHEMA = 1
MODEL_SUFFIXES = (".glb", ".gltf", ".fbx", ".obj")
SKIPPED_SUFFIXES = (".blend",)
# matched against the lowercased file name: either spelling, any case
LICENCE_GLOBS = ("license*", "licence*", "*license*.txt", "*licence*.txt")
MIRROR_LICENCES = ("cc0",)
CANDIDATES_DIR = ".candidates"
MATCH_ACTIONS = ("accepted", "candidate", "unmatched", "skipped", "failed", "not-run")
GENERATE_ACTIONS = ("accepted", "candidate", "skipped", "failed", "not-run")

# The visual gate (Settled shape 6). The coverage floor was retuned on the box
# (2026-10-27, kb/asset-ladder.md §The operator's box step for Story 34.7):
# normalise.py scales every candidate into the entry's bounds, so coverage
# measures how much of its box greybox a real asset fills, and Kenney's lamp
# post, bench and pine measured 0.38, 0.52 and 0.34 (a synthetic 0.1 m pole
# 0.28). The planner's 0.6 passed only boxy replacements; 0.25 keeps the
# floor as the mis-framed-or-wrong-shape check it is meant to be.
RENDER_SIZE = 128
VISUAL_COVERAGE_MIN = 0.25
VISUAL_FILL_MIN = 0.005

# The generated rung (Settled shape 7).
KEY_ENV = "TK_ASSETS_MESHY_KEY"
CAP_KEY = "assets.credit_cap"
BANDS_REL = Path(".tk-studio") / "budget-bands.yaml"
PROVIDER = "meshy"
MESHY_API = "https://api.meshy.ai/openapi/v2/text-to-3d"
# Meshy's text-to-3D preview charge in credits, the estimate when a
# response reports none (unverified here: the operator's box run checks it)
MESHY_CREDITS_PER_TASK = 20
POLL_INTERVAL_S = 5.0
DEFAULT_PROMPT_TAIL = "low poly game asset"
LEDGER_EVENT = "asset-generation"

NORMALISE_SPEC_KEYS = ("name", "input", "bounds", "origin", "tri_budget", "output")
RENDER_SPEC_KEYS = ("input", "camera", "bounds", "size", "output")

_CAMEL = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+")


def tag_tokens(text: str) -> list[str]:
    """The lowercase tokens of ``text`` split on ``-``, ``_``, space, ``.``
    (and any other non-alphanumeric) and camelCase, digits dropped."""
    out = []
    for part in re.split(r"[^A-Za-z0-9]+", text):
        for token in _CAMEL.findall(part):
            token = re.sub(r"[0-9]+", "", token).lower()
            if token and token not in out:
                out.append(token)
    return out


def path_tags(rel: str) -> list[str]:
    """The tags of a kit file: the tokens of its folders and its stem."""
    parts = rel.split("/")
    stem = parts[-1].rsplit(".", 1)[0]
    tags: list[str] = []
    for part in parts[:-1] + [stem]:
        for token in tag_tokens(part):
            if token not in tags:
                tags.append(token)
    return sorted(tags)


# ---------------------------------------------------------- the index

def _licence_file(kit: Path) -> Path | None:
    names = sorted(p.name for p in kit.iterdir() if p.is_file())
    for name in names:
        if any(fnmatch.fnmatchcase(name.lower(), g) for g in LICENCE_GLOBS):
            return kit / name
    return None


def build_index(kit: Path, category: str, licence: str) -> tuple[dict, int]:
    """``(index, skipped)``: every model file under ``kit`` sorted by path,
    ``.blend`` files counted in ``skipped``, never indexed."""
    found = _licence_file(kit)
    if found is None:
        raise Refusal(f"no licence file in {kit} (LICENSE* or LICENCE* in any case, or a "
                      "*license*.txt or *licence*.txt, at the kit root): mirror only kits "
                      "whose licence ships with them")
    assets_out = []
    skipped = 0
    for path in kit.rglob("*"):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in SKIPPED_SUFFIXES:
            skipped += 1
            continue
        if suffix not in MODEL_SUFFIXES:
            continue
        rel = path.relative_to(kit).as_posix()
        assets_out.append({"path": rel, "category": category, "tags": path_tags(rel)})
    assets_out.sort(key=lambda a: a["path"])
    index = {"schema": INDEX_SCHEMA, "kit": kit.name, "licence": licence,
             "licence_file": found.name, "assets": assets_out}
    return index, skipped


def index_bytes(index: dict) -> bytes:
    return (json.dumps(index, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def mirror_index(*, kit: str, category: str, licence: str = "cc0") -> tuple[dict, int]:
    """Write ``<kit>/index.json``: deterministic, atomic, stdlib."""
    try:
        root = Path(kit)
        if not root.is_dir():
            raise Refusal(f"--kit: not a directory: {kit}")
        root = root.resolve()
        if category not in CATEGORIES:
            raise Refusal(f"--category: {category!r} is not one of " + " | ".join(CATEGORIES))
        if licence not in MIRROR_LICENCES:
            raise Refusal(f"--licence: {licence!r} is not one of " + " | ".join(MIRROR_LICENCES))
        index, skipped = build_index(root, category, licence)
    except Refusal as exc:
        return _blocked(exc)
    except OSError as exc:
        return _blocked(Refusal(f"kit {kit} unreadable ({exc})"))
    path = root / INDEX_NAME
    try:
        _write_atomic(path, index_bytes(index))
    except OSError as exc:
        return _blocked(Refusal(f"{path} not written ({exc})"))
    result = {"ok": True, "kit": index["kit"], "index": str(path), "licence": licence,
              "licence_file": index["licence_file"], "category": category,
              "assets": len(index["assets"]), "skipped": skipped}
    return with_block(result, "complete", [str(path)], None), 0


# ---------------------------------------------------------- the mirror

def resolve_mirror(arg: str | None, env=None) -> tuple[Path | None, str | None]:
    """``(mirror root, None)`` or ``(None, why there is none)``: ``--mirror``
    (a refusal when it names no folder), else ``TK_ASSETS_MIRROR``, else
    ``C:\\agent-work\\assets`` when it exists. ``TK_ASSETS_MIRROR`` is read
    like the key: ``HKCU\\Environment``, then the process env."""
    if arg is not None:
        path = Path(arg)
        if not path.is_dir():
            raise Refusal(f"--mirror: not a directory: {arg}")
        return path.resolve(), None
    value = user_env(MIRROR_ENV, env)
    if value:
        path = Path(value)
        if path.is_dir():
            return path.resolve(), None
        return None, f"no mirror ({MIRROR_ENV} names {value!r}, which is not a folder)"
    path = Path(DEFAULT_MIRROR)
    if path.is_dir():
        return path, None
    return None, "no mirror"


def _kit_relative(rel: str) -> bool:
    """True when an index ``path`` stays inside its kit: relative (no root,
    no drive) and without a ``..`` segment."""
    if not rel or PurePosixPath(rel).is_absolute() or PureWindowsPath(rel).drive \
            or PureWindowsPath(rel).root:
        return False
    return ".." not in re.split(r"[\\/]", rel)


def kit_source(root: Path, kit: str, rel: str) -> Path:
    """The file an index entry names; a refusal naming the kit and the path
    when it would leave the kit, or when it is not a posix path (a backslash
    would pass the gates and then fail the manifest write-back of
    ``source``)."""
    if not _kit_relative(rel):
        raise Refusal(f"mirror kit {kit}: index path {rel!r} leaves the kit (absolute or "
                      "with a .. segment)")
    if "\\" in rel:
        raise Refusal(f"mirror kit {kit}: index path {rel!r} is not a posix path (run "
                      "assets.py mirror-index on the kit)")
    return root / kit / rel


def load_mirror(root: Path) -> list[dict]:
    """Every kit's indexed assets as ``{kit, licence, path, category,
    tags}``; a kit folder without an index is not part of the mirror."""
    out = []
    for kit in sorted(p for p in root.iterdir() if p.is_dir()):
        index_path = kit / INDEX_NAME
        if not index_path.is_file():
            continue
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise Refusal(f"mirror index {index_path} unreadable ({exc})") from None
        if (not isinstance(index, dict) or index.get("schema") != INDEX_SCHEMA
                or not isinstance(index.get("assets"), list)
                or not isinstance(index.get("licence"), str)):
            raise Refusal(f"mirror index {index_path} is not a schema {INDEX_SCHEMA} index "
                          "(run assets.py mirror-index on the kit)")
        for item in index["assets"]:
            if (not isinstance(item, dict) or not isinstance(item.get("path"), str)
                    or not isinstance(item.get("tags"), list)):
                raise Refusal(f"mirror index {index_path}: an asset without path or tags")
            kit_source(root, kit.name, item["path"])
            out.append({"kit": kit.name, "licence": index["licence"], "path": item["path"],
                        "category": item.get("category"),
                        "tags": [t for t in item["tags"] if isinstance(t, str)]})
    return out


def match_asset(entry: dict, mirror: list[dict]) -> dict | None:
    """The best kit asset for ``entry`` (Settled shape 3): the same
    category and a cc0 kit, scored by ``|(tag tokens ∪ name tokens) ∩ asset
    tags|`` (at least 1), each tag tokenised as the index's tags are
    (``street-lamp`` is ``street`` and ``lamp``, ``barrel2`` is ``barrel``);
    ties to the higher score, then the kit name, then the path. None:
    unmatched."""
    wanted = ({t for tag in entry.get("tags") or [] for t in tag_tokens(tag)}
              | set(tag_tokens(entry["name"])))
    best = None
    for asset in mirror:
        if asset["category"] != entry["category"] or asset["licence"] not in MIRROR_LICENCES:
            continue
        score = len(wanted & set(asset["tags"]))
        if score < 1:
            continue
        key = (-score, asset["kit"], asset["path"])
        if best is None or key < best[0]:
            best = (key, {**asset, "score": score})
    return None if best is None else best[1]


# ---------------------------------------------------------- the masks

def visual_gate(candidate_png: bytes, greybox_png: bytes) -> tuple[list[str], dict]:
    """``(reasons, {coverage, fill})``: the candidate's silhouette must cover
    the greybox's (``|C ∩ G| / |G| >= VISUAL_COVERAGE_MIN``) and not be
    blank (``|C| / size² >= VISUAL_FILL_MIN``)."""
    cand, grey = alpha_mask(candidate_png), alpha_mask(greybox_png)
    reasons: list[str] = []
    metrics = {"coverage": None, "fill": None}
    for what, mask in (("candidate", cand), ("greybox", grey)):
        if mask is None:
            reasons.append(f"visual: the {what} render is not a readable 8-bit PNG "
                           "with an alpha channel")
        elif mask[:2] != (RENDER_SIZE, RENDER_SIZE):
            reasons.append(f"visual: the {what} render is {mask[0]}x{mask[1]}, "
                           f"not {RENDER_SIZE}x{RENDER_SIZE}")
    if reasons:
        return reasons, metrics
    c, g = cand[2], grey[2]
    filled = sum(c)
    reference = sum(g)
    both = sum(1 for a, b in zip(c, g) if a and b)
    fill = filled / (RENDER_SIZE * RENDER_SIZE)
    coverage = both / reference if reference else 0.0
    metrics = {"coverage": round(coverage, 4), "fill": round(fill, 4)}
    if not reference:
        reasons.append("visual: the greybox render is blank (no reference silhouette)")
    elif coverage < VISUAL_COVERAGE_MIN:
        reasons.append(f"visual: coverage {coverage:.3f} below {VISUAL_COVERAGE_MIN} "
                       "(the silhouette misses the greybox's)")
    if fill < VISUAL_FILL_MIN:
        reasons.append(f"visual: fill {fill:.4f} below {VISUAL_FILL_MIN} (a blank render)")
    return reasons, metrics


# ---------------------------------------------------------- the write-back

_REWRITE_LINE = re.compile(r"^(\s*(?:-\s+)?)([A-Za-z0-9_-]+):")


def map_manifest(text: str, label: str = "manifest") -> list[dict]:
    """Per entry, in order: ``{"keys": {key: line index}, "values": {key:
    value}, "indent": key column}`` over ``text.splitlines(True)``; a
    refusal when the reader's entries cannot be mapped line by line."""
    lines = text.splitlines(keepends=True)
    entries: list[dict] = []
    in_assets = False
    dash = None
    for idx, raw in enumerate(lines):
        line = raw.rstrip("\r\n")
        if idx == 0 and line.startswith("\ufeff"):
            line = line[1:]
        body = _strip_comment(line).rstrip()
        if not body.strip():
            continue
        where = f"{label} line {idx + 1}"
        indent = len(body) - len(body.lstrip())
        content = body.strip()
        item = content == "-" or content.startswith("- ")
        if indent == 0 and not item:
            key, rest = _key_value(content, where)
            in_assets = key == "assets"
            dash = None
            if in_assets and rest is not None and rest.strip().replace(" ", "") != "[]":
                raise Refusal(f"{where}: the manifest cannot be mapped line by line "
                              "(assets is not a block list)")
            continue
        if not in_assets:
            continue
        if item and (dash is None or indent == dash):
            dash = indent
            entries.append({"keys": {}, "values": {}, "indent": dash + 2})
            content = content[1:].strip()
            if not content:
                continue
        elif dash is None or indent != dash + 2:
            raise Refusal(f"{where}: the manifest cannot be mapped line by line")
        key, rest = _key_value(content, where)
        entries[-1]["keys"][key] = idx
        entries[-1]["values"][key] = None if rest is None else _scalar(rest, where)
    return entries


def _yaml_string(value: str) -> str:
    if '"' not in value and "\\" not in value:
        return f'"{value}"'
    if "'" not in value and "\\" not in value:
        return f"'{value}'"
    raise ValueError(f"{value!r} cannot be written as a manifest scalar")


def rewrite_manifest(text: str, moves: dict, label: str = "manifest") -> str:
    """``text`` with only the ``status``, ``licence`` and ``source`` lines of
    the moved entries rewritten (``moves``: name -> {field: value}); an
    absent ``source`` is inserted after ``status`` at the entry's indent.
    Every other byte is kept. The result re-reads as the same manifest
    with those fields changed, or this raises."""
    mapped = map_manifest(text, label)
    lines = text.splitlines(keepends=True)
    inserts: dict[int, str] = {}
    by_name = {m["values"].get("name"): m for m in mapped}
    for name, fields in moves.items():
        entry = by_name.get(name)
        if entry is None:
            raise Refusal(f"{label}: entry {name} cannot be mapped line by line")
        for field, value in fields.items():
            if field not in ("status", "licence", "source"):
                raise ValueError(f"write-back touches only status, licence and source, not {field}")
            text_value = _yaml_string(value) if field == "source" else value
            if field in entry["keys"]:
                idx = entry["keys"][field]
                raw = lines[idx]
                stripped = raw.rstrip("\r\n")
                eol = raw[len(stripped):]
                bom = "\ufeff" if idx == 0 and stripped.startswith("\ufeff") else ""
                stripped = stripped[len(bom):]
                body = _strip_comment(stripped)
                comment = stripped[len(body):]
                gap = body[len(body.rstrip()):]
                m = _REWRITE_LINE.match(body)
                if m is None or m.group(2) != field:
                    raise Refusal(f"{label} line {idx + 1}: {field} cannot be rewritten in place")
                lines[idx] = (bom + m.group(1) + field + ": " + text_value
                              + (gap + comment if comment else "") + eol)
            elif field == "source":
                after = entry["keys"]["status"]
                raw = lines[after]
                eol = raw[len(raw.rstrip("\r\n")):] or "\n"
                if not raw.endswith(("\n", "\r")):
                    lines[after] = raw + eol
                inserts[after] = " " * entry["indent"] + "source: " + text_value + eol
            else:
                raise Refusal(f"{label}: entry {name}: no {field} line to rewrite")
    out = []
    for idx, line in enumerate(lines):
        out.append(line)
        if idx in inserts:
            out.append(inserts[idx])
    new_text = "".join(out)
    before = parse_manifest(text.lstrip("\ufeff"), label)
    after_doc = parse_manifest(new_text.lstrip("\ufeff"), label)
    for item in before.get("assets") or []:
        item.update(moves.get(item.get("name"), {}))
    if before != after_doc:
        raise Refusal(f"{label}: the write-back would change more than the moved fields")
    return new_text


def _read_ladder_manifest(mpath: Path, project: Path) -> tuple[dict, str]:
    """The validated manifest and its text, mapped line by line (a refusal
    before any work otherwise)."""
    doc = load_manifest(mpath, project)
    label = _rel(mpath, project)
    try:
        text = mpath.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise Refusal(f"manifest {label} unreadable ({exc})") from None
    mapped = map_manifest(text, label)
    names = [m["values"].get("name") for m in mapped]
    if names != [e["name"] for e in doc["assets"]] or any(
            "status" not in m["keys"] or "licence" not in m["keys"] for m in mapped):
        raise Refusal(f"{label}: the manifest cannot be mapped line by line "
                      "(each entry's name, status and licence lines)")
    return doc, text


def _write_back(mpath: Path, project: Path, text: str, moves: dict) -> str | None:
    """Apply ``moves`` to the manifest; the reason when it could not."""
    if not moves:
        return None
    label = _rel(mpath, project)
    try:
        if mpath.read_bytes().decode("utf-8") != text:
            return f"{label} changed during the run; not rewritten"
        new_text = rewrite_manifest(text, moves, label)
        _write_atomic(mpath, new_text.encode("utf-8"))
    except (Refusal, ValueError, OSError, UnicodeDecodeError) as exc:
        return f"{label} not rewritten ({exc})"
    return None


def _roll_back(mpath: Path, project: Path, text: str, moves: dict,
               undone: list[str]) -> str | None:
    """The compensating write-back: return the ``undone`` entries' lines to
    what they were in ``text`` (an inserted ``source`` line removed), keeping
    the other moves; the reason when it could not."""
    label = _rel(mpath, project)
    kept = {name: fields for name, fields in moves.items() if name not in undone}
    try:
        written = rewrite_manifest(text, moves, label)
        target = rewrite_manifest(text, kept, label) if kept else text
        if mpath.read_bytes().decode("utf-8") != written:
            return f"{label} changed during the run; not rolled back"
        _write_atomic(mpath, target.encode("utf-8"))
    except (Refusal, ValueError, OSError, UnicodeDecodeError) as exc:
        return f"{label} not rolled back ({exc})"
    return None


# ---------------------------------------------------------- the placement

def candidate_file(art: Path, name: str) -> Path:
    return art / CANDIDATES_DIR / f"{name}.glb"


def _label_state(art: Path, name: str, colour: str) -> str | None:
    """``stale`` when the greybox label present differs from this
    manifest's (or does not decode); None otherwise."""
    label = label_file(art, name)
    if not label.exists():
        return None
    try:
        present = _png_image(label.read_bytes())
    except OSError:
        return "stale"
    return None if present is not None and present == _png_image(label_png(name, colour)) \
        else "stale"


def _stale_reason(art: Path, name: str, project: Path) -> str:
    return (f"label: stale ({_rel(label_file(art, name), project)} differs from this "
            "manifest's label; remove it first, then run greybox again)")


class _Run:
    """One `match` or `generate` run: the layout, Blender, the temp folder
    and the wall clock its entries share."""

    def __init__(self, *, project: Path, art: Path, binary: str, temp: Path,
                 wall_s: float, camera: dict):
        self.project, self.art, self.binary, self.temp = project, art, binary, temp
        self.wall_s, self.camera = wall_s, camera
        self.deadline = time.monotonic() + wall_s
        self.spent = False
        self.artifacts: list[str] = []
        # accepted candidates, placed only once the manifest write-back lands
        self.placements: list[tuple[dict, Path, Path]] = []

    def remaining(self) -> float:
        return self.deadline - time.monotonic()

    def blender(self, script: Path, spec: dict, stem: str, row: dict) -> str | None:
        """One Blender call; the reason it failed, else None."""
        remaining = self.remaining()
        if self.spent or remaining <= 0:
            self.spent = True
            return "wall clock spent"
        spec_path = self.temp / f"{stem}.spec.json"
        try:
            spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
        except OSError as exc:
            return f"spec not written: {exc}"
        log_path = self.temp / f"{stem}.log"
        argv = blender_argv(self.binary, spec_path, script)
        row.setdefault("calls", []).append({"script": script.name, "argv": argv})
        try:
            code, timed_out, duration_ms = run_blender(argv, cwd=self.project,
                                                       log_path=log_path, timeout_s=remaining)
        except OSError as exc:
            return f"could not start {self.binary}: {exc}"
        row["calls"][-1].update(exit=code, duration_ms=duration_ms)
        if timed_out:
            self.spent = True
            return f"wall clock: {self.wall_s:g}s exceeded (blender killed)"
        if code != 0:
            return f"blender exit {code}: {_tail(log_path)}".rstrip(": ")
        if not Path(spec["output"]).is_file():
            return f"blender exit 0 but wrote no {Path(spec['output']).name}"
        return None

    def place(self, entry: dict, source: Path, row: dict) -> tuple[str, list[str]]:
        """Normalise ``source``, publish the candidate and run both gates.
        ``(action, reasons)``: ``accepted`` (both passed; the replace waits
        for the write-back, ``settle``), ``candidate`` (a gate failed; the
        placeholder kept) or ``failed`` (a tool failed; the entry unmoved)."""
        name = entry["name"]
        glb = asset_file(self.art, name)
        normalised = self.temp / f"{name}.normalised.glb"
        spec = {"name": name, "input": str(source), "bounds": entry["bounds"],
                "origin": entry["origin"], "tri_budget": entry["tri_budget"],
                "output": str(normalised)}
        reason = self.blender(NORMALISE_SCRIPT, spec, f"{name}.normalise", row)
        if reason:
            return "failed", [f"normalise: {reason}"]
        try:
            data = normalised.read_bytes()
            folder = self.art / CANDIDATES_DIR
            folder.mkdir(parents=True, exist_ok=True)
            candidate = candidate_file(self.art, name)
            if candidate.exists():
                candidate.unlink()  # an earlier run's candidate: ours to replace
            if not _publish_new(candidate, data):
                return "failed", [f"{_rel(candidate, self.project)} appeared during the run"]
        except OSError as exc:
            return "failed", [f"candidate not written: {exc}"]
        row["candidate"] = _rel(candidate, self.project)
        self.artifacts.append(row["candidate"])
        try:
            row["facts"] = facts_of(data)
            reasons = gate(entry, row["facts"])
        except (Refusal, ValueError, TypeError, KeyError) as exc:
            reasons = [f"unreadable glb ({exc})"]
        if reasons:
            return "candidate", ["facts: " + r for r in reasons]
        renders = {}
        for kind, model in (("greybox", glb), ("render", candidate)):
            out = self.temp / f"{name}.{kind}.png"
            spec = {"input": str(model), "camera": dict(self.camera), "bounds": entry["bounds"],
                    "size": RENDER_SIZE, "output": str(out)}
            reason = self.blender(RENDER_SCRIPT, spec, f"{name}.{kind}", row)
            if reason:
                return "failed", [f"render ({kind}): {reason}"]
            try:
                png = out.read_bytes()
                beside = folder / f"{name}.{kind}.png"
                _write_atomic(beside, png)
            except OSError as exc:
                return "failed", [f"render ({kind}) not kept: {exc}"]
            row[f"{kind}_png"] = _rel(beside, self.project)
            self.artifacts.append(row[f"{kind}_png"])
            renders[kind] = png
        reasons, metrics = visual_gate(renders["render"], renders["greybox"])
        row.update(metrics)
        if reasons:
            return "candidate", reasons
        self.placements.append((row, candidate, glb))
        return "accepted", []

    def settle(self, mpath: Path, text: str, moves: dict) -> str | None:
        """Write the manifest back, then replace each accepted placeholder;
        the write-back's failure reason, else None. When the write-back
        fails no placeholder is touched and every candidate stays in
        ``.candidates/``, so the manifest and the files agree. When a
        replace fails after the write-back, a compensating write-back
        returns that entry's ``status``, ``licence`` and ``source`` lines to
        their prior bytes and the candidate stays in ``.candidates/``; once
        that compensation lands they agree again. If it too fails, the
        manifest names the entry ``accepted`` over the placeholder and the
        row's reason says so."""
        writeback = _write_back(mpath, self.project, text, moves)
        unplaced: list[dict] = []
        for row, candidate, glb in self.placements:
            if writeback:
                row["action"] = "failed"
                row["reason"] = "not placed: the manifest was not rewritten"
                row["reasons"] = [row["reason"]]
                continue
            try:
                os.replace(candidate, glb)  # the one sanctioned replace of a placeholder
            except OSError as exc:
                row["action"] = "failed"
                row["reason"] = (f"{_rel(glb, self.project)} not replaced after the "
                                 f"write-back: {exc}")
                row["reasons"] = [row["reason"]]
                unplaced.append(row)
                continue
            self.artifacts.remove(row["candidate"])
            self.artifacts.append(_rel(glb, self.project))
        if unplaced:
            rollback = _roll_back(mpath, self.project, text, moves,
                                  [row["name"] for row in unplaced])
            for row in unplaced:
                if rollback:
                    row["reasons"].append(f"compensating write-back failed: {rollback}")
                    row["reason"] = "; ".join(row["reasons"])
        return writeback


def _wall(wall) -> float:
    try:
        wall_s = float(wall)
    except (TypeError, ValueError):
        raise Refusal(f"--wall {wall!r} is not a number") from None
    if not (math.isfinite(wall_s) and 0 < wall_s <= MAX_WALL_S):
        raise Refusal(f"--wall {wall_s:g} must be a finite number of seconds "
                      f"> 0 and <= {MAX_WALL_S}")
    return wall_s


def _prepare(entry: dict, doc: dict, art: Path, project: Path, row: dict) -> bool:
    """The checks before any work on a ladder entry; False when the row is
    settled (skipped, or failed on a stale label)."""
    name = entry["name"]
    if not asset_file(art, name).is_file():
        row["action"], row["reason"] = "skipped", "run greybox first"
        return False
    if _label_state(art, name, doc["colours"][entry["category"]]) == "stale":
        row["action"], row["reason"] = "failed", _stale_reason(art, name, project)
        return False
    return True


def _ladder_result(entries: list[dict], counts_of: tuple, base: dict, artifacts: list[str],
                   writeback: str | None, verb: str, extra: list[str] | None = None):
    """The run's result; ``extra``: further reasons the run is ``partial``
    (a ledger line that did not land, a credit-cap overshoot)."""
    failed = [e for e in entries if e["action"] in ("failed", "candidate", "not-run")]
    counts = {a: sum(1 for e in entries if e["action"] == a) for a in counts_of}
    extra = list(extra or [])
    result = {**base, "ok": not failed and writeback is None and not extra,
              "entries": entries, "counts": counts, "writeback": writeback}
    if failed or writeback or extra:
        parts = [f"{e['name']}: {e['reason']}" for e in failed]
        if writeback:
            parts.append(writeback)
        parts.extend(extra)
        return with_block(result, "partial", artifacts, f"{verb}: " + "; ".join(parts)), 1
    return with_block(result, "complete", artifacts, None), 0


def match(*, directory: str, manifest: str | None = None, art_path: str | None = None,
          mirror: str | None = None, blender: str | None = None,
          wall: str | float = DEFAULT_WALL_S, env=None) -> tuple[dict, int]:
    """The cc0 rung: replace each matched placeholder once both gates pass."""
    env = os.environ if env is None else env
    try:
        wall_s = _wall(wall)
        project, mpath, art = resolve_layout(directory, manifest, art_path)
        doc, text = _read_ladder_manifest(mpath, project)
        root, no_mirror = resolve_mirror(mirror, env)
        kits = load_mirror(root) if root is not None else []
    except Refusal as exc:
        return _blocked(exc)
    except OSError as exc:
        return _blocked(Refusal(f"mirror unreadable ({exc})"))
    work = [e for e in doc["assets"] if e["rung"] == "cc0"]
    entries: list[dict] = []
    base = {"manifest": _rel(mpath, project), "art_path": _rel(art, project),
            "mirror": str(root) if root is not None else None}
    if root is None:
        for entry in work:
            entries.append({"name": entry["name"], "rung": "cc0", "action": "skipped",
                            "reason": no_mirror})
        return _ladder_result(entries, MATCH_ACTIONS, base, [], None, "match")
    todo = []
    for entry in work:
        row = {"name": entry["name"], "rung": "cc0", "action": None, "reason": None,
               "reasons": [], "match": None}
        entries.append(row)
        if entry["status"] == "accepted":
            row["action"], row["reason"] = "skipped", "accepted"
            continue
        if not _prepare(entry, doc, art, project, row):
            continue
        found = match_asset(entry, kits)
        if found is None:
            row["action"], row["reason"] = "unmatched", "no kit asset of the category shares a tag"
            continue
        row["match"] = {"kit": found["kit"], "path": found["path"], "licence": found["licence"],
                        "score": found["score"]}
        todo.append((entry, row, found))
    if not todo:
        return _ladder_result(entries, MATCH_ACTIONS, base, [], None, "match")
    try:
        binary = resolve_blender(blender, env)
    except Refusal as exc:
        return _blocked(exc)
    try:
        temp = Path(tempfile.mkdtemp(prefix="tk-match-"))
    except OSError as exc:
        return _blocked(Refusal(f"no temp directory for the match run: {exc}"))
    run = _Run(project=project, art=art, binary=binary, temp=temp, wall_s=wall_s,
               camera=doc["camera"])
    moves: dict[str, dict] = {}
    try:
        for entry, row, found in todo:
            if run.spent:
                row["action"], row["reason"] = "not-run", "wall clock spent"
                continue
            try:
                source_path = kit_source(root, found["kit"], found["path"])
            except Refusal as exc:
                row["action"], row["reason"] = "failed", str(exc)
                row["reasons"] = [row["reason"]]
                continue
            action, reasons = run.place(entry, source_path, row)
            row["action"], row["reasons"] = action, reasons
            row["reason"] = "; ".join(reasons) or None
            if action == "accepted":
                moves[entry["name"]] = {"status": "accepted", "licence": found["licence"],
                                        "source": f"{found['kit']}/{found['path']}"}
            elif action == "candidate" and entry["status"] != "candidate":
                moves[entry["name"]] = {"status": "candidate"}
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    writeback = run.settle(mpath, text, moves)
    artifacts = list(run.artifacts) + ([base["manifest"]] if moves and writeback is None else [])
    base.update(blender=binary, wall_s=wall_s)
    return _ladder_result(entries, MATCH_ACTIONS, base, artifacts, writeback, "match")


# ---------------------------------------------------------- the generator

def credit_cap(project: Path) -> float:
    """The project's ``assets.credit_cap`` (Meshy credits > 0) from
    ``.tk-studio/budget-bands.yaml``; a refusal naming it otherwise: its
    absence is the rung's off-by-default."""
    path = project / BANDS_REL
    off = (f"{CAP_KEY}: {BANDS_REL.as_posix()} sets no {CAP_KEY} (Meshy credits > 0); the "
           "generated rung is off until the owner sets one (kb/asset-ladder.md)")
    if not path.is_file():
        raise Refusal(off)
    try:
        doc = miniyaml.load(path)
    except (miniyaml.MiniYamlError, OSError, UnicodeDecodeError) as exc:
        raise Refusal(f"{CAP_KEY}: {BANDS_REL.as_posix()} is not YAML the studio reads "
                      f"({exc})") from None
    section = doc.get("assets") if isinstance(doc, dict) else None
    cap = section.get("credit_cap") if isinstance(section, dict) else None
    if not _number(cap) or cap <= 0:
        raise Refusal(off)
    return float(cap)


def user_env(name: str, env=None) -> str | None:
    """`_core.user_env`, reading this module's `_hkcu_value` (tests stub it)."""
    return _core.user_env(name, env, read=_hkcu_value)


class GeneratorError(Exception):
    """A generator call failed; the message never carries the key."""


class MeshyClient:
    """The Meshy text-to-3D seam (`submit`, `poll`, `download`), urllib,
    each request bounded by ``timeout``. The key travels only in the
    Authorization header of the API requests (never to the download URL);
    tests replace ``make_client``."""

    def __init__(self, key: str):
        self._key = key

    def _request(self, url: str, *, body: dict | None, timeout: float, auth: bool) -> bytes:
        import urllib.error
        import urllib.request
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = f"Bearer {self._key}"
        req = urllib.request.Request(url, data=data, headers=headers,
                                     method="POST" if body is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=max(1.0, timeout)) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            raise GeneratorError(f"HTTP {exc.code} from {PROVIDER}") from None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise GeneratorError(f"{PROVIDER} unreachable ({type(exc).__name__})") from None

    def _json(self, raw: bytes) -> dict:
        try:
            doc = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise GeneratorError(f"{PROVIDER} answered with no JSON") from None
        if not isinstance(doc, dict):
            raise GeneratorError(f"{PROVIDER} answered with no JSON object")
        return doc

    def submit(self, prompt: str, *, timeout: float) -> dict:
        """``{"task_id", "credits"?}`` for a new preview task."""
        doc = self._json(self._request(MESHY_API, body={"mode": "preview", "prompt": prompt},
                                       timeout=timeout, auth=True))
        task = doc.get("result")
        if not isinstance(task, str) or not task:
            raise GeneratorError(f"{PROVIDER} returned no task id")
        out = {"task_id": task}
        if _charge(doc.get("credits")) is not None:
            out["credits"] = doc["credits"]
        return out

    def poll(self, task_id: str, *, timeout: float) -> dict:
        """``{"state": "pending" | "complete" | "failed", "url"?, "credits"?,
        "reason"?}``."""
        doc = self._json(self._request(f"{MESHY_API}/{task_id}", body=None, timeout=timeout,
                                       auth=True))
        status = doc.get("status")
        out: dict = {}
        if _charge(doc.get("credits")) is not None:
            out["credits"] = doc["credits"]
        if status == "SUCCEEDED":
            url = (doc.get("model_urls") or {}).get("glb")
            if not isinstance(url, str) or not url.startswith("https://"):
                return {**out, "state": "failed", "reason": "no glb url in the finished task"}
            return {**out, "state": "complete", "url": url}
        if status in ("FAILED", "CANCELED", "EXPIRED"):
            message = (doc.get("task_error") or {}).get("message") or status.lower()
            return {**out, "state": "failed", "reason": f"task {status.lower()}: {message}"}
        return {**out, "state": "pending"}

    def download(self, url: str, *, timeout: float) -> bytes:
        return self._request(url, body=None, timeout=timeout, auth=False)


def _charge(value):
    """A reported charge counts only when it is a number > 0; None else."""
    return value if _number(value) and value > 0 else None


def make_client(key: str):
    """The generator client; module-level so tests inject a fake."""
    return MeshyClient(key)


def default_prompt(entry: dict) -> str:
    """The name's words, then the category, then ``low poly game asset``."""
    return ", ".join([" ".join(entry["name"].split("-")), entry["category"],
                      DEFAULT_PROMPT_TAIL])


def _scrub(text: str, key: str) -> str:
    return text.replace(key, "[redacted]") if key else text


def _generate_one(client, entry: dict, run: _Run, key: str) -> dict:
    """One generation task: ``{state, task_id?, credits, estimated?,
    reason?, file?}``; never raises."""
    out: dict = {"state": "failed"}
    prompt = entry["prompt"] or default_prompt(entry)
    try:
        submitted = client.submit(prompt, timeout=run.remaining())
        out["task_id"] = submitted["task_id"]
        if "credits" in submitted:
            out["credits"] = submitted["credits"]
        while True:
            if run.remaining() <= 0:
                run.spent = True
                raise GeneratorError(f"wall clock: {run.wall_s:g}s spent waiting on the task")
            polled = client.poll(out["task_id"], timeout=run.remaining())
            if "credits" in polled:
                out["credits"] = polled["credits"]
            if polled["state"] == "complete":
                data = client.download(polled["url"], timeout=max(1.0, run.remaining()))
                break
            if polled["state"] == "failed":
                raise GeneratorError(polled.get("reason") or "task failed")
            time.sleep(min(POLL_INTERVAL_S, max(0.0, run.remaining())))
        path = run.temp / f"{entry['name']}.generated.glb"
        path.write_bytes(data)
        out["file"] = path
        out["state"] = "complete"
    except GeneratorError as exc:
        out["reason"] = _scrub(str(exc), key)
    except Exception as exc:  # noqa: BLE001 - a client failure is a failed call, never a crash
        out["reason"] = _scrub(f"{type(exc).__name__}: {exc}", key)
    if _charge(out.get("credits")) is None:
        # no charge reported, or one that is no number > 0: the estimate
        out["credits"] = MESHY_CREDITS_PER_TASK
        out["estimated"] = True
    return out


def _ledger_line(run_id: str, entry: dict, call: dict, project_key: str | None) -> str | None:
    """One `asset-generation` line through the ledger (AD-12); the error
    when it did not land."""
    payload = {"run_id": run_id, "asset": entry["name"], "provider": PROVIDER,
               "credits": call["credits"], "state": call["state"]}
    if call.get("task_id"):
        payload["task_id"] = call["task_id"]
    if call.get("estimated"):
        payload["estimated"] = True
    if call.get("reason"):
        payload["reason"] = call["reason"]
    try:
        ledger.emit(LEDGER_EVENT, payload, project=project_key)
    except Exception as exc:  # noqa: BLE001 - the ledger never masks the verb
        return str(exc)
    return None


def generate(*, directory: str, run_id: str, manifest: str | None = None,
             art_path: str | None = None, blender: str | None = None,
             wall: str | float = DEFAULT_WALL_S, env=None) -> tuple[dict, int]:
    """The generated rung behind the owner's credit cap."""
    env = os.environ if env is None else env
    try:
        if not isinstance(run_id, str) or not run_id.strip():
            raise Refusal("--run-id: missing")
        wall_s = _wall(wall)
        project, mpath, art = resolve_layout(directory, manifest, art_path)
        doc, text = _read_ladder_manifest(mpath, project)
        cap = credit_cap(project)
        key = user_env(KEY_ENV, env)
        if key is None:
            raise Refusal(f"{KEY_ENV}: no such User environment variable (HKCU\\Environment "
                          "or the process env); set the generator's key by name, never in a "
                          "file (kb/asset-ladder.md)")
        binary = resolve_blender(blender, env)
    except Refusal as exc:
        return _blocked(exc)
    try:
        project_key = config.project_key(project)
    except Exception:  # noqa: BLE001 - an unkeyed project still records its calls
        project_key = None
    try:
        temp = Path(tempfile.mkdtemp(prefix="tk-generate-"))
    except OSError as exc:
        return _blocked(Refusal(f"no temp directory for the generate run: {exc}"))
    run = _Run(project=project, art=art, binary=binary, temp=temp, wall_s=wall_s,
               camera=doc["camera"])
    entries: list[dict] = []
    moves: dict[str, dict] = {}
    spent = 0.0
    highest = 0.0  # the highest charge reported this invocation
    capped = False
    ledger_errors: list[str] = []
    client = None
    try:
        for entry in doc["assets"]:
            if entry["rung"] != "generated":
                continue
            row = {"name": entry["name"], "rung": "generated", "action": None, "reason": None,
                   "reasons": [], "task_id": None, "credits": None}
            entries.append(row)
            if entry["status"] == "accepted":
                row["action"], row["reason"] = "skipped", "accepted"
                continue
            if ledger_errors:
                # a call the ledger cannot record is never made (AC2)
                row["action"], row["reason"] = "not-run", "ledger unwritable"
                continue
            if capped or spent + max(MESHY_CREDITS_PER_TASK, highest) > cap:
                # this entry and every later one: the pre-check uses the
                # estimate (or a higher charge already seen), so a call
                # priced above it can overshoot by at most one call
                capped = True
                row["action"], row["reason"] = "not-run", "credit cap"
                continue
            if not _prepare(entry, doc, art, project, row):
                continue
            if run.spent or run.remaining() <= 0:
                run.spent = True
                row["action"], row["reason"] = "not-run", "wall clock spent"
                continue
            if client is None:
                client = make_client(key)
            call = _generate_one(client, entry, run, key)
            spent += call["credits"]
            if not call.get("estimated"):
                highest = max(highest, float(call["credits"]))
            if spent >= cap:
                capped = True  # every later entry: not-run: credit cap
            row["task_id"], row["credits"] = call.get("task_id"), call["credits"]
            if call.get("estimated"):
                row["estimated"] = True
            error = _ledger_line(run_id, entry, call, project_key)
            if error:
                row["ledger_error"] = error
                ledger_errors.append(f"{entry['name']}: ledger line not written ({error})")
            if call["state"] != "complete":
                row["action"], row["reason"] = "failed", f"{PROVIDER}: {call['reason']}"
                row["reasons"] = [row["reason"]]
                continue
            action, reasons = run.place(entry, call["file"], row)
            row["action"], row["reasons"] = action, reasons
            row["reason"] = "; ".join(reasons) or None
            if action == "accepted":
                moves[entry["name"]] = {"status": "accepted", "licence": "generated",
                                        "source": f"{PROVIDER}:{call['task_id']}"}
            elif action == "candidate" and entry["status"] != "candidate":
                moves[entry["name"]] = {"status": "candidate"}
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    writeback = run.settle(mpath, text, moves)
    artifacts = list(run.artifacts) + ([_rel(mpath, project)] if moves and writeback is None
                                       else [])
    extra = list(ledger_errors)
    if spent > cap:
        extra.append(f"credit cap: spent {spent:g} credits, over the cap of {cap:g} (a call "
                     f"priced above the {MESHY_CREDITS_PER_TASK}-credit estimate)")
    base = {"manifest": _rel(mpath, project), "art_path": _rel(art, project),
            "run_id": run_id, "provider": PROVIDER, "credit_cap": cap,
            "credits_spent": spent, "blender": binary, "wall_s": wall_s}
    return _ladder_result(entries, GENERATE_ACTIONS, base, artifacts, writeback, "generate",
                          extra)


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
    parser = _Parser(description="tk-studio assets — the asset manifest and the ladder")
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
    p = sub.add_parser("mirror-index", help="write a mirrored kit's index.json")
    p.add_argument("--kit", required=True, help="the kit folder under the mirror")
    p.add_argument("--category", required=True, help=" | ".join(CATEGORIES))
    p.add_argument("--licence", default="cc0", help="the kit's licence (default cc0)")
    for verb, text in (("match", "replace cc0-rung placeholders with matched kit assets"),
                       ("generate", "replace generated-rung placeholders behind the credit cap")):
        p = sub.add_parser(verb, help=text)
        p.add_argument("--directory", required=True, help="the project root")
        p.add_argument("--manifest", help=f"the manifest (default: {KEY_MANIFEST}, "
                                          f"else {DEFAULT_MANIFEST})")
        p.add_argument("--art-path", help=f"the art folder (default: {KEY_ART_PATH}, "
                                          f"else {DEFAULT_ART_PATH})")
        if verb == "match":
            p.add_argument("--mirror", help=f"the mirror root (default: {MIRROR_ENV}, "
                                            f"else {DEFAULT_MIRROR} when present)")
        else:
            p.add_argument("--run-id", required=True, help="the run the calls are charged to")
        p.add_argument("--blender", help="the Blender binary (default: BLENDER, "
                                         "else blender on PATH)")
        p.add_argument("--wall", default=DEFAULT_WALL_S,
                       help=f"seconds for the whole run (default {DEFAULT_WALL_S})")
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
    elif args.command == "mirror-index":
        result, code = mirror_index(kit=args.kit, category=args.category, licence=args.licence)
    elif args.command == "match":
        result, code = match(directory=args.directory, manifest=args.manifest,
                             art_path=args.art_path, mirror=args.mirror, blender=args.blender,
                             wall=args.wall)
    elif args.command == "generate":
        result, code = generate(directory=args.directory, run_id=args.run_id,
                                manifest=args.manifest, art_path=args.art_path,
                                blender=args.blender, wall=args.wall)
    else:
        result, code = facts(args.file)
    _emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
