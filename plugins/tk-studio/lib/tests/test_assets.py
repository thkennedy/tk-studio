"""Tests for the asset manifest and the greybox rung (Story 34.6, AC1, AC2).

Blender is a fake throughout: `assets.run_blender` is injected with a
callable that reads the spec the argv names and writes a hand-built `.glb`
to the spec's output, as `blender/greybox.py` does, and two tests run the
real `run_blender` against a fake `blender` executable (a Python script):
one that exports, one that hangs past the wall clock. `facts` reads a cube
`.glb` built here byte by byte.
"""
from __future__ import annotations

import contextlib
import errno
import importlib.util
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import zlib
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import assets  # noqa: E402

LIB = Path(__file__).resolve().parents[1]


def _load_greybox():
    """`blender/greybox.py` imported as a plain module: its geometry is
    plain Python; only its `main` needs Blender."""
    spec = importlib.util.spec_from_file_location("tk_greybox", LIB / "blender" / "greybox.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


greybox_script = _load_greybox()
BLOCK_KEYS = ["status", "intent", "artifacts", "reason"]

ENTRY_CRATE = """\
  - name: crate-small  # the id
    category: prop
    tri_budget: 500
    bounds: {x: 0.5, y: 0.5, z: 0.5}   # metres
    origin: base-center
    collision: box
    licence: greybox
    rung: greybox
    status: placeholder
    source: ""
"""
ENTRY_BARREL = """\
  - name: barrel
    category: environment
    tri_budget: 200
    bounds: {x: 0.6, y: 1.0, z: 0.6}
    origin: base-center
    collision: capsule
    licence: greybox
    rung: greybox
    status: placeholder
"""


def manifest_text(*entries: str, categories: str = "") -> str:
    head = "# the slice's assets\nschema: 1\n"
    if categories:
        head += "categories:            # overrides\n" + categories
    return head + "assets:\n" + "".join(entries)


def cube_glb(size=(0.5, 0.5, 0.5), origin="base-center", *, uv=True, materials=1,
             extra_triangles=0) -> bytes:
    """A minimal binary glTF cube (8 vertices, 12 triangles plus
    ``extra_triangles`` repeated ones) sized ``size`` on glTF axes."""
    sx, sy, sz = size
    lo = {"center": (-sx / 2, -sy / 2, -sz / 2), "base-center": (-sx / 2, 0.0, -sz / 2),
          "base-min-corner": (0.0, 0.0, 0.0)}[origin]
    hi = (lo[0] + sx, lo[1] + sy, lo[2] + sz)
    corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    indices = [i for a, b, c, d in quads for i in (a, b, c, a, c, d)]
    indices += [0, 1, 3] * extra_triangles
    pos = b"".join(struct.pack("<3f", *c) for c in corners)
    idx = struct.pack(f"<{len(indices)}H", *indices)
    idx += b"\x00" * (-len(idx) % 4)
    tex = b"".join(struct.pack("<2f", (c[0] - lo[0]) / sx, (c[1] - lo[1]) / sy) for c in corners)
    blob = pos + idx + (tex if uv else b"")
    views = [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos)},
             {"buffer": 0, "byteOffset": len(pos), "byteLength": len(indices) * 2}]
    accessors = [
        {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3",
         "min": list(lo), "max": list(hi)},
        {"bufferView": 1, "componentType": 5123, "count": len(indices), "type": "SCALAR"},
    ]
    attributes = {"POSITION": 0}
    if uv:
        views.append({"buffer": 0, "byteOffset": len(pos) + len(idx), "byteLength": len(tex)})
        accessors.append({"bufferView": 2, "componentType": 5126, "count": 8, "type": "VEC2"})
        attributes["TEXCOORD_0"] = 2
    doc = {"asset": {"version": "2.0", "generator": "test_assets"},
           "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
           "meshes": [{"primitives": [{"attributes": attributes, "indices": 1, "mode": 4,
                                       **({"material": 0} if materials else {})}]}],
           "materials": [{"name": f"m{i}"} for i in range(materials)],
           "accessors": accessors, "bufferViews": views,
           "buffers": [{"byteLength": len(blob)}]}
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    blob += b"\x00" * (-len(blob) % 4)
    body = (struct.pack("<II", len(js), assets.CHUNK_JSON) + js
            + struct.pack("<II", len(blob), assets.CHUNK_BIN) + blob)
    return struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body


class FakeBlender:
    """An injected `run_blender`: records the argv and the spec it names
    (the spec file is removed after the run), writes a cube `.glb` sized
    to the spec's bounds to its output unless told not to, and returns
    ``code`` / ``timed_out``."""

    def __init__(self, *, code=0, timed_out=False, write=True, log="blender 5.2\n",
                 during=None, output=None):
        self.code, self.timed_out, self.write, self.log = code, timed_out, write, log
        self.during, self.output = during, output
        self.calls: list[dict] = []

    def __call__(self, argv, *, cwd, log_path, timeout_s):
        spec_path = Path(argv[argv.index("--spec") + 1])
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        self.calls.append({"argv": list(argv), "spec": spec, "cwd": cwd, "timeout_s": timeout_s,
                           "label_bytes": Path(spec["label"]).read_bytes()})
        if self.during:
            self.during(spec)
        Path(log_path).write_text(self.log, encoding="utf-8")
        if self.write and self.code == 0 and not self.timed_out:
            b = spec["bounds"]
            data = (self.output(spec) if self.output
                    else cube_glb((b["x"], b["y"], b["z"]), spec["origin"]))
            Path(spec["output"]).write_bytes(data)
        return (None if self.timed_out else self.code), self.timed_out, 7


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.project = self.root / "project"
        self.project.mkdir()
        home = self.root / "home"
        home.mkdir()
        patcher = mock.patch.dict(os.environ, {"TK_STUDIO_HOME": str(home)})
        patcher.start()
        self.addCleanup(patcher.stop)
        # The platform's executable name: shutil.which on Windows finds only PATHEXT names
        # (the fake is never spawned; run_blender is mocked).
        self.blender = self.root / "bin" / ("blender.exe" if sys.platform == "win32" else "blender")
        self.blender.parent.mkdir()
        self.blender.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        self.blender.chmod(0o755)

    def tearDown(self):
        self._tmp.cleanup()

    def write_manifest(self, text: str, rel: str = "assets/manifest.yaml") -> Path:
        path = self.project / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def art(self, rel: str = "art/greybox") -> Path:
        return self.project / rel

    def assert_block(self, result: dict):
        self.assertEqual(list(result)[-4:], BLOCK_KEYS)
        self.assertEqual(result["intent"], "assets")

    def blocked(self, result, code, *needles):
        self.assertEqual(code, 2, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "blocked")
        for needle in needles:
            self.assertIn(needle, result["reason"])

    def greybox(self, fake=None, **kw):
        kw.setdefault("blender", str(self.blender))
        with mock.patch.object(assets, "run_blender", fake or FakeBlender()):
            return assets.greybox(directory=str(self.project), **kw)


# ---------------------------------------------------------------- schema

class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.schema = json.loads(assets.SCHEMA_PATH.read_text(encoding="utf-8"))
        self.entry = self.schema["$defs"]["asset"]

    def test_schema_is_draft_2020_12_and_closed(self):
        self.assertEqual(self.schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertFalse(self.schema["additionalProperties"])
        self.assertFalse(self.entry["additionalProperties"])
        self.assertFalse(self.entry["properties"]["bounds"]["additionalProperties"])
        self.assertEqual(self.schema["properties"]["schema"], {"const": 1})

    def test_value_sets_agree_with_the_code(self):
        props = self.entry["properties"]
        for field, allowed in assets.ENUMS.items():
            with self.subTest(field=field):
                self.assertEqual(tuple(props[field]["enum"]), allowed)
        self.assertEqual(tuple(self.schema["properties"]["categories"]["propertyNames"]["enum"]),
                         assets.CATEGORIES)
        self.assertEqual(tuple(sorted(assets.DEFAULT_COLOURS)), tuple(sorted(assets.CATEGORIES)))
        self.assertEqual(tuple(self.entry["required"]), assets.REQUIRED_FIELDS)
        self.assertEqual(sorted(props), sorted(assets.REQUIRED_FIELDS + assets.OPTIONAL_FIELDS))
        self.assertEqual(props["name"]["pattern"], assets.NAME_PATTERN.pattern)
        self.assertEqual(self.schema["properties"]["categories"]["additionalProperties"]["pattern"],
                         assets.COLOUR_PATTERN.pattern)
        self.assertEqual(props["tri_budget"], {**props["tri_budget"], "type": "integer",
                                               "exclusiveMinimum": 0})
        for axis in assets.AXES:
            self.assertEqual(props["bounds"]["properties"][axis],
                             {"type": "number", "exclusiveMinimum": 0})

    def test_default_colours_are_the_ruled_table_and_never_magenta(self):
        self.assertEqual(assets.DEFAULT_COLOURS, {
            "prop": "#8a8a8a", "character": "#d98c3f", "environment": "#5b8c5a",
            "vehicle": "#4a78b5", "ui": "#c7b84a", "fx": "#9a5bb5"})
        self.assertNotIn("#ff00ff", assets.DEFAULT_COLOURS.values())


# ---------------------------------------------------------------- reader

class ReaderTests(unittest.TestCase):
    def test_reads_the_manifest_subset(self):
        doc = assets.parse_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL,
                                                  categories='  prop: "#112233"\n'))
        self.assertEqual(doc["schema"], 1)
        self.assertEqual(doc["categories"], {"prop": "#112233"})
        self.assertEqual([a["name"] for a in doc["assets"]], ["crate-small", "barrel"])
        self.assertEqual(doc["assets"][0]["bounds"], {"x": 0.5, "y": 0.5, "z": 0.5})
        self.assertEqual(doc["assets"][0]["source"], "")
        self.assertEqual(doc["assets"][0]["tri_budget"], 500)
        self.assertEqual(assets.parse_manifest("schema: 1\nassets: []\n"),
                         {"schema": 1, "assets": []})

    def test_refuses_anything_outside_the_subset(self):
        for text, needle in (
                ("schema: 1\nassets:\n  - name: a\n    bounds:\n      x: 1\n", "nested blocks"),
                ("schema: 1\nassets: [a, b]\n", "flow lists"),
                ("schema: 1\nassets:\n\t- name: a\n", "tab indentation"),
                ("schema: 1\nschema: 1\n", "duplicate key schema"),
                ("schema: 1\nassets:\n  - name: a\n    name: b\n", "duplicate key name"),
                ("schema: 1\nassets:\n  - bounds: {x: {y: 1}}\n", "nested flow"),
                ("just text\n", "expected 'key: value'"),
                ("schema: 1\n  extra: 2\n", "unexpected indentation")):
            with self.subTest(text=text):
                with self.assertRaises(assets.Refusal) as ctx:
                    assets.parse_manifest(text, "m.yaml")
                self.assertIn(needle, str(ctx.exception))
                self.assertIn("m.yaml line", str(ctx.exception))

    def test_an_apostrophe_inside_a_plain_value_is_text(self):
        doc = assets.parse_manifest(
            "schema: 1\nassets:\n  - name: a\n    source: Kenney's kit  # cc0 pack\n"
            "    licence: 'cc0 # not a comment'\n    status: \"a # b\"  # comment\n"
            "    bounds: {x: 'p # q', y: 1}\n")
        entry = doc["assets"][0]
        self.assertEqual(entry["source"], "Kenney's kit")
        self.assertEqual(entry["licence"], "cc0 # not a comment")
        self.assertEqual(entry["status"], "a # b")
        self.assertEqual(entry["bounds"], {"x": "p # q", "y": 1})

    def test_an_indentless_block_list_reads_as_the_indented_one(self):
        indented = manifest_text(ENTRY_CRATE, ENTRY_BARREL)
        indentless = "".join((line[2:] if line.startswith("  ") and not
                              line.startswith("  prop") else line) + "\n"
                             for line in indented.splitlines())
        self.assertIn("\n- name: crate-small", indentless)
        self.assertEqual(assets.parse_manifest(indentless), assets.parse_manifest(indented))
        # anything else at column 0 after a bare key is still a key line
        with self.assertRaises(assets.Refusal) as ctx:
            assets.parse_manifest("schema: 1\nassets:\n- name: a\nplain text\n", "m.yaml")
        self.assertIn("expected 'key: value'", str(ctx.exception))

    def test_a_leading_dash_is_text_unless_it_is_a_sequence_indicator(self):
        doc = assets.parse_manifest("a: -crate\nb: -3\nc: -0.5\n")
        self.assertEqual(doc, {"a": "-crate", "b": -3, "c": -0.5})
        for text in ("a: - x\n", "a: -\n"):
            with self.subTest(text=text):
                with self.assertRaises(assets.Refusal) as ctx:
                    assets.parse_manifest(text, "m.yaml")
                self.assertIn("unsupported value", str(ctx.exception))


# ----------------------------------------------------------------- check

class CheckTests(Base):
    def test_a_name_with_a_leading_dash_is_valid(self):
        self.write_manifest(manifest_text(ENTRY_CRATE.replace("name: crate-small",
                                                              "name: -crate")))
        result, code = assets.check(directory=str(self.project))
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        self.assertEqual(result["entries"][0]["name"], "-crate")
        self.assertEqual(result["entries"][0]["verdict"], "missing")

    def test_check_valid_reports_rung_status_and_facts_or_missing(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))
        self.art().mkdir(parents=True)
        (self.art() / "crate-small.glb").write_bytes(cube_glb())
        result, code = assets.check(directory=str(self.project))
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "complete")
        self.assertIsNone(result["reason"])
        self.assertEqual(result["manifest"], "assets/manifest.yaml")
        self.assertEqual(result["art_path"], "art/greybox")
        crate, barrel = result["entries"]
        self.assertEqual(sorted(crate), sorted(["name", "rung", "status", "file", "present",
                                                "facts", "verdict", "reasons"]))
        self.assertEqual((crate["rung"], crate["status"], crate["verdict"]),
                         ("greybox", "placeholder", "pass"))
        self.assertEqual(crate["file"], "art/greybox/crate-small.glb")
        self.assertEqual(crate["facts"]["triangles"], 12)
        self.assertEqual((barrel["present"], barrel["facts"], barrel["verdict"]),
                         (False, None, "missing"))
        self.assertEqual(result["counts"], {"pass": 1, "fail": 0, "missing": 1})

    def test_check_bad_values_refuse_naming_entry_and_field(self):
        cases = (
            (ENTRY_CRATE.replace("category: prop", "category: monster"), "",
             ("entry crate-small", "category", "monster")),
            (ENTRY_CRATE.replace("collision: box", "collision: cone"), "",
             ("entry crate-small", "collision", "cone")),
            (ENTRY_CRATE + ENTRY_CRATE, "", ("entry crate-small", "name", "duplicate")),
            (ENTRY_CRATE.replace("tri_budget: 500", "tri_budget: 8"), "",
             ("entry crate-small", "tri_budget", "below 12")),
            (ENTRY_CRATE.replace("tri_budget: 500", "tri_budget: 0"), "",
             ("entry crate-small", "tri_budget", "> 0")),
            (ENTRY_CRATE, '  prop: "#GG0000"\n', ("categories.prop", "#rrggbb")),
            (ENTRY_CRATE, '  monster: "#112233"\n', ("categories", "monster")),
            (ENTRY_CRATE.replace("x: 0.5", "x: 0"), "", ("entry crate-small", "bounds.x")),
            (ENTRY_CRATE.replace("name: crate-small", "name: Crate_Small"), "",
             ("entry #1", "name")),
            (ENTRY_CRATE.replace("    status: placeholder\n", ""), "",
             ("entry crate-small", "status: missing")),
            (ENTRY_CRATE.replace("rung: greybox", "rung: hero"), "", ("rung", "hero")),
            (ENTRY_CRATE.replace("licence: greybox", "licence: mit"), "", ("licence",)),
            (ENTRY_CRATE.replace("origin: base-center", "origin: top"), "", ("origin",)),
            (ENTRY_CRATE.replace("status: placeholder", "status: done"), "", ("status",)),
            (ENTRY_CRATE + "    colour: red\n", "", ("unknown field colour",)),
        )
        for entries, cats, needles in cases:
            with self.subTest(needles=needles):
                self.write_manifest(manifest_text(entries, categories=cats))
                result, code = assets.check(directory=str(self.project))
                self.blocked(result, code, "assets/manifest.yaml", *needles)

    def test_check_refuses_a_wrong_schema_or_unknown_top_key(self):
        self.write_manifest("schema: 2\nassets: []\n")
        self.blocked(*assets.check(directory=str(self.project)), "schema")
        self.write_manifest("schema: 1\nassets: []\nextra: 1\n")
        self.blocked(*assets.check(directory=str(self.project)), "extra")

    def test_check_gate_red_on_budget_or_bounds(self):
        self.write_manifest(manifest_text(ENTRY_CRATE.replace("tri_budget: 500", "tri_budget: 12"),
                                          ENTRY_BARREL))
        self.art().mkdir(parents=True)
        (self.art() / "crate-small.glb").write_bytes(cube_glb(extra_triangles=1))
        (self.art() / "barrel.glb").write_bytes(cube_glb((0.6, 1.02, 0.6)))
        result, code = assets.check(directory=str(self.project))
        self.assertEqual(code, 1, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["ok"])
        crate, barrel = result["entries"]
        self.assertEqual(crate["verdict"], "fail")
        self.assertIn("triangles 13 over tri_budget 12", crate["reasons"][0])
        self.assertEqual(barrel["verdict"], "fail")
        self.assertIn("bounds.y", barrel["reasons"][0])
        self.assertIn("crate-small", result["reason"])
        self.assertIn("barrel", result["reason"])

    def test_check_gate_red_on_a_malformed_present_file(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        self.art().mkdir(parents=True)
        (self.art() / "crate-small.glb").write_bytes(b"not a glb at all")
        result, code = assets.check(directory=str(self.project))
        self.assertEqual(code, 1)
        self.assertIn("malformed GLB", result["entries"][0]["reasons"][0])

    def test_bounds_tolerance_is_one_percent_both_sides(self):
        entry = {"tri_budget": 12, "bounds": {"x": 1.0, "y": 1.0, "z": 1.0}}
        for got, ok in ((1.0099, True), (0.9901, True), (1.0, True),
                        (1.0101, False), (0.9899, False)):
            with self.subTest(got=got):
                facts = {"triangles": 12, "bounds": {"x": got, "y": 1.0, "z": 1.0}}
                self.assertEqual(assets.gate(entry, facts) == [], ok)
        self.assertEqual(assets.gate(entry, {"triangles": 13, "bounds": entry["bounds"]}),
                         ["triangles 13 over tri_budget 12"])

    def test_no_manifest_refuses_naming_the_path(self):
        result, code = assets.check(directory=str(self.project))
        self.blocked(result, code, "no manifest", "assets/manifest.yaml")

    def test_config_keys_set_the_manifest_and_art_path(self):
        conf = self.project / ".tk-studio" / "config.yaml"
        conf.parent.mkdir()
        conf.write_text("assets:\n  manifest: game/assets.yaml\n  art_path: art/world/greybox\n",
                        encoding="utf-8")
        self.write_manifest(manifest_text(ENTRY_CRATE), "game/assets.yaml")
        art = self.art("art/world/greybox")
        art.mkdir(parents=True)
        (art / "crate-small.glb").write_bytes(cube_glb())
        result, code = assets.check(directory=str(self.project))
        self.assertEqual(code, 0, result)
        self.assertEqual(result["manifest"], "game/assets.yaml")
        self.assertEqual(result["entries"][0]["file"], "art/world/greybox/crate-small.glb")
        # the flags override the config keys
        self.write_manifest(manifest_text(ENTRY_BARREL), "other.yaml")
        result, code = assets.check(directory=str(self.project), manifest="other.yaml",
                                    art_path="elsewhere")
        self.assertEqual(code, 0, result)
        self.assertEqual(result["entries"][0]["file"], "elsewhere/barrel.glb")

    def test_derived_path(self):
        art = Path("/p/art/greybox")
        self.assertEqual(assets.asset_file(art, "crate-small"), art / "crate-small.glb")
        self.assertEqual(assets.label_file(art, "crate-small"), art / "crate-small.label.png")


# --------------------------------------------------------------- greybox

class GreyboxTests(Base):
    def test_greybox_calls_blender_once_per_entry_with_the_spec(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL,
                                          categories='  environment: "#123456"\n'))
        fake = FakeBlender()
        result, code = self.greybox(fake)
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(len(fake.calls), 2)
        for call, name in zip(fake.calls, ("crate-small", "barrel")):
            argv = call["argv"]
            self.assertEqual(argv[:5], [str(self.blender.resolve()), "-b", "--python",
                                        str(LIB / "blender" / "greybox.py"), "--"])
            self.assertEqual(argv[5], "--spec")
            self.assertEqual(len(argv), 7)
            spec = call["spec"]
            self.assertEqual(sorted(spec), sorted(assets.SPEC_KEYS))
            self.assertEqual(spec["name"], name)
            self.assertEqual(Path(spec["label"]), self.art() / f"{name}.label.png")
            self.assertEqual(call["cwd"], self.project.resolve())
        crate, barrel = (c["spec"] for c in fake.calls)
        self.assertEqual((crate["category"], crate["colour"]), ("prop", "#8a8a8a"))
        self.assertEqual((barrel["category"], barrel["colour"]), ("environment", "#123456"))
        self.assertEqual(crate["bounds"], {"x": 0.5, "y": 0.5, "z": 0.5})
        self.assertEqual((barrel["origin"], barrel["collision"], barrel["tri_budget"]),
                         ("base-center", "capsule", 200))
        for name in ("crate-small", "barrel"):
            png = (self.art() / f"{name}.label.png").read_bytes()
            self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertTrue((self.art() / f"{name}.glb").is_file())
        # the spec's temp folder is gone; the art path holds only the outputs
        self.assertFalse(Path(crate["output"]).parent.exists())
        self.assertEqual(sorted(p.name for p in self.art().iterdir()),
                         ["barrel.glb", "barrel.label.png", "crate-small.glb",
                          "crate-small.label.png"])
        self.assertEqual(sorted(result["artifacts"]), sorted(
            ["art/greybox/crate-small.glb", "art/greybox/crate-small.label.png",
             "art/greybox/barrel.glb", "art/greybox/barrel.label.png"]))
        self.assertEqual(result["counts"]["written"], 2)
        # and check is green over what greybox wrote
        result, code = assets.check(directory=str(self.project))
        self.assertEqual(code, 0, result)
        self.assertEqual([e["verdict"] for e in result["entries"]], ["pass", "pass"])

    def test_greybox_never_touches_an_existing_file(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))
        self.art().mkdir(parents=True)
        glb = self.art() / "crate-small.glb"
        glb.write_bytes(b"hand-made, not ours")
        label = self.art() / "barrel.label.png"
        label.write_bytes(assets.label_png("barrel", "#5b8c5a"))  # this manifest's label
        old = time.time() - 3600
        os.utime(glb, (old, old))
        os.utime(label, (old, old))
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (glb, label)}
        fake = FakeBlender()
        result, code = self.greybox(fake)
        self.assertEqual(code, 0, result)
        self.assertEqual([c["spec"]["name"] for c in fake.calls], ["barrel"])
        crate, barrel = result["entries"]
        self.assertEqual(crate["action"], "skipped")
        self.assertEqual(barrel["action"], "written")
        for path, (data, mtime) in before.items():
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(path.stat().st_mtime_ns, mtime)
        self.assertFalse((self.art() / "crate-small.label.png").exists())
        self.assertNotIn("art/greybox/barrel.label.png", result["artifacts"])

    def test_label_png_same_bytes_across_two_runs(self):
        firsts = []
        for run in ("one", "two"):
            self.project = self.root / run
            self.project.mkdir()
            self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))
            result, code = self.greybox()
            self.assertEqual(code, 0, result)
            firsts.append([(self.art() / f"{n}.label.png").read_bytes()
                           for n in ("crate-small", "barrel")])
        self.assertEqual(firsts[0], firsts[1])
        self.assertNotEqual(firsts[0][0], firsts[0][1])

    def test_label_png_is_a_256_rgb_png_with_no_time_or_text(self):
        data = assets.label_png("crate-small", "#8a8a8a")
        self.assertEqual(data, assets.label_png("crate-small", "#8a8a8a"))
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        chunks, offset = [], 8
        while offset < len(data):
            length, kind = struct.unpack_from(">I4s", data, offset)
            chunks.append((kind, data[offset + 8:offset + 8 + length]))
            offset += 12 + length
        self.assertEqual([k for k, _ in chunks], [b"IHDR", b"IDAT", b"IEND"])
        self.assertEqual(struct.unpack(">IIBBBBB", chunks[0][1]), (256, 256, 8, 2, 0, 0, 0))
        raw = zlib.decompress(chunks[1][1])
        self.assertEqual(len(raw), 256 * (1 + 256 * 3))
        rows = [raw[r * 769:(r + 1) * 769] for r in range(256)]
        self.assertTrue(all(row[0] == 0 for row in rows))  # filter 0
        self.assertEqual(rows[0][1:4], b"\x00\x00\x00")  # the border
        self.assertEqual(rows[4][1 + 3 * 4:1 + 3 * 5], bytes.fromhex("8a8a8a"))  # the fill
        self.assertIn(b"\x00\x00\x00", b"".join(rows[100:156]))  # the name

    def test_long_names_break_onto_two_lines(self):
        self.assertEqual(assets.label_lines("crate-small")[0], ["crate-small"])
        lines, scale = assets.label_lines("a-very-long-environment-rock-name")
        self.assertEqual(lines, ["a-very-long-", "environment-rock-name"])
        self.assertGreaterEqual(scale, 1)

    def test_the_longest_names_shrink_inside_the_margins(self):
        self.assertEqual((assets.LABEL_MAX_LINE, assets.LABEL_MAX_NAME), (56, 112))
        fill = bytes.fromhex("8a8a8a")
        for name in ("a" * 56, "b" * 57, "c" * 112, "-".join(["ab"] * 37) + "c",
                     "a-" + "b" * 100):
            with self.subTest(n=len(name)):
                lines, scale = assets.label_lines(name)
                self.assertEqual("".join(lines), name)
                self.assertGreaterEqual(scale, 1)
                for line in lines:
                    self.assertLessEqual((4 * len(line) - 1) * scale, assets.LABEL_ROOM)
                raw = zlib.decompress(self._idat(assets.label_png(name, "#8a8a8a")))
                rows = [raw[r * 769 + 1:(r + 1) * 769] for r in range(256)]
                # the band between the border and the margin is fill only
                for y in range(256):
                    for x in list(range(4, 16)) + list(range(240, 252)):
                        if 4 <= y < 252:
                            self.assertEqual(rows[y][3 * x:3 * x + 3], fill, (x, y))
                for y in list(range(4, 16)) + list(range(240, 252)):
                    self.assertEqual(rows[y][12:3 * 252], fill * 248, y)
        self.assertIsNone(assets.label_lines("d" * 113))

    @staticmethod
    def _idat(data: bytes) -> bytes:
        offset = 8
        while offset < len(data):
            length, kind = struct.unpack_from(">I4s", data, offset)
            if kind == b"IDAT":
                return data[offset + 8:offset + 8 + length]
            offset += 12 + length
        raise AssertionError("no IDAT")

    def test_a_name_past_the_label_is_a_check_refusal(self):
        self.write_manifest(manifest_text(ENTRY_CRATE.replace("crate-small", "c" * 112)))
        result, code = assets.check(directory=str(self.project))
        self.assertEqual(code, 0, result)
        self.write_manifest(manifest_text(ENTRY_CRATE.replace("crate-small", "c" * 113)))
        result, code = assets.check(directory=str(self.project))
        self.blocked(result, code, "entry " + "c" * 113, "name:", "113 characters",
                     "at most 112")

    def test_a_stale_label_fails_the_entry_without_blender(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))
        self.art().mkdir(parents=True)
        label = self.art() / "crate-small.label.png"
        stale = assets.label_png("crate-small", "#123456")  # an earlier colour
        label.write_bytes(stale)
        old = time.time() - 3600
        os.utime(label, (old, old))
        mtime = label.stat().st_mtime_ns
        fake = FakeBlender()
        result, code = self.greybox(fake)
        self.assertEqual(code, 1, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual([c["spec"]["name"] for c in fake.calls], ["barrel"])
        self.assertEqual(label.read_bytes(), stale)
        self.assertEqual(label.stat().st_mtime_ns, mtime)
        self.assertFalse((self.art() / "crate-small.glb").exists())
        crate, barrel = result["entries"]
        self.assertEqual((crate["action"], crate["label_state"]), ("failed", "stale"))
        self.assertIn("label: stale", crate["reason"])
        self.assertIn("art/greybox/crate-small.label.png", crate["reason"])
        self.assertIn("remove it first", crate["reason"])
        self.assertIn("crate-small", result["reason"])
        self.assertNotIn(crate["label"], result["artifacts"])
        self.assertEqual(barrel["action"], "written")
        # a present label with this manifest's bytes is simply reused
        label.write_bytes(assets.label_png("crate-small", "#8a8a8a"))
        fake = FakeBlender()
        result, code = self.greybox(fake)
        self.assertEqual(code, 0, result)
        self.assertEqual(Path(fake.calls[0]["spec"]["label"]), label)
        self.assertEqual(result["entries"][0]["label_state"], "kept")
        self.assertIsNone(result["entries"][0]["reason"])

    def test_a_label_with_the_same_pixels_but_other_compression_is_kept(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        self.art().mkdir(parents=True)
        label = self.art() / "crate-small.label.png"
        fresh = assets.label_png("crate-small", "#8a8a8a")
        ihdr, raw = assets._png_image(fresh)
        other = (b"\x89PNG\r\n\x1a\n" + assets._png_chunk(b"IHDR", ihdr)
                 + assets._png_chunk(b"IDAT", zlib.compress(raw, 1))
                 + assets._png_chunk(b"IEND", b""))
        self.assertNotEqual(other, fresh)  # another zlib build's bytes, same image
        label.write_bytes(other)
        old = time.time() - 3600
        os.utime(label, (old, old))
        mtime = label.stat().st_mtime_ns
        fake = FakeBlender()
        result, code = self.greybox(fake)
        self.assertEqual(code, 0, result)
        self.assertEqual(len(fake.calls), 1)
        (row,) = result["entries"]
        self.assertEqual((row["label_state"], row["action"]), ("kept", "written"))
        self.assertEqual(label.read_bytes(), other)
        self.assertEqual(label.stat().st_mtime_ns, mtime)

    def test_an_unreadable_label_is_stale_without_raising(self):
        fresh = assets.label_png("crate-small", "#8a8a8a")
        for junk in (fresh[:len(fresh) // 2], b"garbage, not a png", b"",
                     fresh[:-12],  # no IEND
                     fresh[:40] + bytes([fresh[40] ^ 0xFF]) + fresh[41:]):  # bad CRC
            with self.subTest(size=len(junk)):
                project = self.root / f"p{len(junk)}-{junk[:4].hex()}"
                project.mkdir()
                self.project = project
                self.write_manifest(manifest_text(ENTRY_CRATE))
                self.art().mkdir(parents=True)
                label = self.art() / "crate-small.label.png"
                label.write_bytes(junk)
                fake = FakeBlender()
                result, code = self.greybox(fake)
                self.assertEqual(code, 1, result)
                self.assertEqual(fake.calls, [])
                (row,) = result["entries"]
                self.assertEqual((row["action"], row["label_state"]), ("failed", "stale"))
                self.assertEqual(label.read_bytes(), junk)
                self.assertFalse((self.art() / "crate-small.glb").exists())

    def test_publish_never_overwrites_an_existing_destination(self):
        dest = self.root / "dest.glb"
        self.assertTrue(assets._publish_new(dest, b"first"))
        self.assertFalse(assets._publish_new(dest, b"second"))
        self.assertEqual(dest.read_bytes(), b"first")
        self.assertEqual(sorted(p.name for p in self.root.iterdir() if p.name.startswith("dest")),
                         ["dest.glb"])
        # where hard links are unsupported, an exclusive create stands in
        other = self.root / "other.glb"
        with mock.patch.object(assets.os, "link",
                               side_effect=OSError(errno.EPERM, "no hard links")):
            self.assertTrue(assets._publish_new(other, b"one"))
            self.assertFalse(assets._publish_new(other, b"two"))
        self.assertEqual(other.read_bytes(), b"one")

    def test_a_failed_exclusive_create_write_leaves_no_partial_file(self):
        dest = self.root / "partial.glb"
        real_fdopen = os.fdopen

        class Failing:
            def __init__(self, fh):
                self.fh = fh

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                self.fh.close()
                return False

            def write(self, data):
                self.fh.write(data[:2])
                raise OSError(errno.ENOSPC, "No space left on device")

        with mock.patch.object(assets.os, "link", side_effect=PermissionError("no links")), \
                mock.patch.object(assets.os, "fdopen",
                                  side_effect=lambda fd, mode: Failing(real_fdopen(fd, mode))):
            with self.assertRaises(OSError):
                assets._publish_new(dest, b"whole bytes")
        self.assertFalse(dest.exists())
        self.assertEqual([p.name for p in self.root.iterdir() if p.name.startswith("partial")],
                         [])
        # an existing file is still never touched by the fallback
        dest.write_bytes(b"theirs")
        with mock.patch.object(assets.os, "link", side_effect=PermissionError("no links")):
            self.assertFalse(assets._publish_new(dest, b"ours"))
        self.assertEqual(dest.read_bytes(), b"theirs")

    def test_no_temp_directory_is_a_blocked_status_block(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        fake = FakeBlender()
        with mock.patch.object(assets.tempfile, "mkdtemp",
                               side_effect=OSError(errno.ENOSPC, "No space left on device")):
            result, code = self.greybox(fake)
        self.blocked(result, code, "temp directory", "No space left")
        self.assertEqual(fake.calls, [])
        self.assertFalse((self.art() / "crate-small.glb").exists())

    def test_a_spec_write_failure_fails_that_entry_and_the_run_continues(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))
        real_write_text = Path.write_text

        def write_text(path, *args, **kwargs):
            if path.name == "crate-small.spec.json":
                raise OSError(errno.ENOSPC, "No space left on device")
            return real_write_text(path, *args, **kwargs)

        fake = FakeBlender()
        with mock.patch.object(assets.Path, "write_text", autospec=True,
                               side_effect=write_text):
            result, code = self.greybox(fake)
        self.assertEqual(code, 1, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "partial")
        crate, barrel = result["entries"]
        self.assertEqual(crate["action"], "failed")
        self.assertIn("spec not written", crate["reason"])
        self.assertNotIn("argv", crate)
        self.assertEqual(barrel["action"], "written")
        self.assertEqual([c["spec"]["name"] for c in fake.calls], ["barrel"])
        self.assertFalse((self.art() / "crate-small.glb").exists())

    def test_a_glb_created_during_the_run_is_never_overwritten(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        glb = self.art() / "crate-small.glb"
        fake = FakeBlender(during=lambda spec: glb.write_bytes(b"someone else's"))
        result, code = self.greybox(fake)
        self.assertEqual(code, 0, result)
        self.assertEqual(glb.read_bytes(), b"someone else's")
        self.assertEqual(result["entries"][0]["action"], "skipped")
        self.assertIn("appeared during the run", result["entries"][0]["reason"])

    def test_no_blender_refuses_before_any_write(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        fake = FakeBlender()
        with mock.patch.object(assets, "run_blender", fake):
            result, code = assets.greybox(directory=str(self.project),
                                          env={"PATH": str(self.root / "empty")})
            self.blocked(result, code, "BLENDER is unset", "no blender is on PATH")
            result, code = assets.greybox(directory=str(self.project),
                                          env={"BLENDER": str(self.root / "nope.exe")})
            self.blocked(result, code, "BLENDER", "nope.exe")
        self.assertEqual(fake.calls, [])
        self.assertFalse(self.art().exists())

    def test_blender_found_on_path_when_blender_is_unset(self):
        self.assertEqual(assets.resolve_blender(None, {"PATH": str(self.blender.parent)}),
                         str(self.blender.resolve()))
        self.assertEqual(assets.resolve_blender(None, {"BLENDER": f" {self.blender} ",
                                                       "PATH": ""}),
                         str(self.blender.resolve()))

    def test_blender_nonzero_fails_the_entry(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))
        result, code = self.greybox(FakeBlender(code=1, log="Traceback: boom\n"))
        self.assertEqual(code, 1, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual([e["action"] for e in result["entries"]], ["failed", "failed"])
        self.assertIn("blender exit 1", result["entries"][0]["reason"])
        self.assertIn("boom", result["entries"][0]["reason"])
        self.assertFalse((self.art() / "crate-small.glb").exists())
        # exit 0 without an output is a failure too
        result, code = self.greybox(FakeBlender(write=False))
        self.assertEqual(code, 1)
        self.assertIn("wrote no", result["entries"][0]["reason"])

    def test_an_export_failing_the_facts_gate_is_not_placed(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))

        def export(spec):
            b = spec["bounds"]
            if spec["name"] == "crate-small":  # over its 500 budget
                return cube_glb((b["x"], b["y"], b["z"]), spec["origin"], extra_triangles=600)
            return cube_glb((b["x"] * 2, b["y"], b["z"]), spec["origin"])  # off its bounds
        fake = FakeBlender(output=export)
        result, code = self.greybox(fake)
        self.assertEqual(code, 1, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(fake.calls), 2)
        crate, barrel = result["entries"]
        for row in (crate, barrel):
            self.assertEqual(row["action"], "failed")
            self.assertTrue(row["reason"].startswith("gate: "), row["reason"])
            self.assertNotIn(row["file"], result["artifacts"])
            self.assertEqual(row["label_state"], "written")
        self.assertIn("over tri_budget 500", crate["reason"])
        self.assertIn("bounds.x", barrel["reason"])
        self.assertFalse((self.art() / "crate-small.glb").exists())
        self.assertFalse((self.art() / "barrel.glb").exists())
        self.assertEqual(result["counts"]["failed"], 2)
        # nothing was placed, so the next run tries again (and a good export lands)
        result, code = self.greybox(FakeBlender())
        self.assertEqual(code, 0, result)
        self.assertEqual([e["action"] for e in result["entries"]], ["written", "written"])

    def test_an_unreadable_export_is_not_placed(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        result, code = self.greybox(FakeBlender(output=lambda spec: b"not a glb at all"))
        self.assertEqual(code, 1, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "partial")
        (row,) = result["entries"]
        self.assertEqual(row["action"], "failed")
        self.assertTrue(row["reason"].startswith("gate: unreadable glb ("), row["reason"])
        self.assertIn("malformed GLB", row["reason"])
        self.assertFalse((self.art() / "crate-small.glb").exists())
        self.assertNotIn(row["file"], result["artifacts"])

    def test_blender_overrun_fails_and_stops_the_run(self):
        self.write_manifest(manifest_text(ENTRY_CRATE, ENTRY_BARREL))
        fake = FakeBlender(timed_out=True)
        result, code = self.greybox(fake, wall="30")
        self.assertEqual(code, 1, result)
        self.assertEqual(len(fake.calls), 1)
        self.assertLessEqual(fake.calls[0]["timeout_s"], 30)
        crate, barrel = result["entries"]
        self.assertEqual(crate["action"], "failed")
        self.assertIn("wall clock: 30s exceeded", crate["reason"])
        self.assertEqual(barrel["action"], "not-run")

    def test_wall_must_be_finite_and_bounded(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        for raw in ("0", "-1", "nan", "inf", "86401", "soon"):
            with self.subTest(raw=raw):
                self.blocked(*self.greybox(wall=raw), "--wall")

    def test_greybox_refuses_a_bad_manifest_before_blender(self):
        self.write_manifest(manifest_text(ENTRY_CRATE.replace("category: prop",
                                                              "category: monster")))
        fake = FakeBlender()
        self.blocked(*self.greybox(fake), "category")
        self.assertEqual(fake.calls, [])


@unittest.skipIf(os.name == "nt", "the fake blender is a shebang script")
class RealRunnerTests(Base):
    """The real `run_blender` against a fake `blender` executable."""

    def fake_exe(self, body: str) -> Path:
        exe = self.root / "bin" / "fake-blender"
        exe.write_text(f"#!{sys.executable}\nimport json, sys, time\n{body}", encoding="utf-8")
        exe.chmod(0o755)
        return exe

    def test_a_fake_blender_writes_the_glb(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        glb = cube_glb()
        exe = self.fake_exe(
            "argv = sys.argv[1:]\n"
            "assert argv[:2] == ['-b', '--python'] and argv[3:5] == ['--', '--spec'], argv\n"
            "spec = json.load(open(argv[5]))\n"
            f"open(spec['output'], 'wb').write({glb!r})\n")
        result, code = assets.greybox(directory=str(self.project), env={"BLENDER": str(exe)})
        self.assertEqual(code, 0, result)
        self.assertEqual((self.art() / "crate-small.glb").read_bytes(), glb)

    def test_a_hung_blender_is_killed_at_the_wall_clock(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        exe = self.fake_exe("print('hung', flush=True)\ntime.sleep(60)\n")
        started = time.monotonic()
        result, code = assets.greybox(directory=str(self.project), blender=str(exe), wall="1")
        self.assertLess(time.monotonic() - started, 20)
        self.assertEqual(code, 1, result)
        self.assertEqual(result["entries"][0]["action"], "failed")
        self.assertIn("wall clock", result["entries"][0]["reason"])
        self.assertFalse((self.art() / "crate-small.glb").exists())


# ------------------------------------------------------- the real geometry

def _newell(pts):
    n = [0.0, 0.0, 0.0]
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n[0] += (p[1] - q[1]) * (p[2] + q[2])
        n[1] += (p[2] - q[2]) * (p[0] + q[0])
        n[2] += (p[0] - q[0]) * (p[1] + q[1])
    return n


class GeometryTests(unittest.TestCase):
    """`blender/greybox.py`'s geometry, without Blender: what the export
    carries (Blender (x, y, z) is glTF (x, z, -y))."""

    BUDGETS = (12, 13, 50, 100, 200, 300, 500, 1000, 5000)
    BOUNDS = ({"x": 0.6, "y": 1.0, "z": 0.6},   # the fixture barrel
              {"x": 0.5, "y": 0.5, "z": 0.5}, {"x": 2.0, "y": 0.3, "z": 1.1},
              {"x": 0.25, "y": 3.0, "z": 0.4})

    def spec(self, collision, budget, bounds, origin="base-center"):
        return {"name": "a", "category": "prop", "colour": "#8a8a8a", "bounds": bounds,
                "origin": origin, "collision": collision, "tri_budget": budget,
                "label": "a.label.png", "output": "a.glb"}

    @staticmethod
    def gltf(verts):
        return [(x, z, -y) for x, y, z in verts]

    def test_extents_equal_bounds_and_triangles_fit_the_budget(self):
        for collision in ("box", "none", "mesh", "sphere", "capsule"):
            for budget in self.BUDGETS:
                for bounds in self.BOUNDS:
                    with self.subTest(collision=collision, budget=budget, bounds=bounds):
                        verts, faces, _uvs = greybox_script.geometry(
                            self.spec(collision, budget, bounds))
                        self.assertLessEqual(greybox_script.triangles(faces), budget)
                        pts = self.gltf(verts)
                        for axis, name in enumerate("xyz"):
                            lo = min(p[axis] for p in pts)
                            hi = max(p[axis] for p in pts)
                            self.assertAlmostEqual(hi - lo, bounds[name], places=9)
                        lo = [min(p[a] for p in pts) for a in range(3)]
                        hi = [max(p[a] for p in pts) for a in range(3)]
                        facts = {"triangles": greybox_script.triangles(faces),
                                 "bounds": {n: hi[a] - lo[a] for a, n in enumerate("xyz")}}
                        self.assertEqual(assets.gate({"tri_budget": budget, "bounds": bounds},
                                                     facts), [])
        sphere = greybox_script.geometry(self.spec("sphere", 1000, self.BOUNDS[0]))[1]
        self.assertGreater(greybox_script.triangles(sphere), 500)  # not needlessly coarse

    def test_every_origin_rule_classifies_as_itself(self):
        for collision in ("box", "sphere", "capsule"):
            for origin in assets.ORIGINS:
                for bounds in self.BOUNDS:
                    with self.subTest(collision=collision, origin=origin, bounds=bounds):
                        verts, _faces, _uvs = greybox_script.geometry(
                            self.spec(collision, 200, bounds, origin))
                        pts = self.gltf(verts)
                        lo = [min(p[a] for p in pts) for a in range(3)]
                        hi = [max(p[a] for p in pts) for a in range(3)]
                        self.assertEqual(assets.classify_origin(lo, hi), origin)

    def test_uvs_stay_inside_the_label_interior_and_cover_every_face(self):
        border = assets.LABEL_BORDER / assets.LABEL_SIZE
        for collision in ("box", "sphere", "capsule"):
            for budget in (12, 200, 1000):
                with self.subTest(collision=collision, budget=budget):
                    _verts, faces, uvs = greybox_script.geometry(
                        self.spec(collision, budget, self.BOUNDS[2]))
                    self.assertEqual(len(uvs), len(faces))
                    for face, corners in zip(faces, uvs):
                        self.assertEqual(len(corners), len(face))
                        for u, v in corners:
                            for c in (u, v):
                                self.assertGreater(c, border)
                                self.assertLess(c, 1 - border)
                        area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in
                                       zip(corners, corners[1:] + corners[:1])))
                        self.assertGreater(area, 0, (collision, face))
        # the cube's front and back carry the whole interior: the name shows there
        verts, faces, uvs = greybox_script.geometry(self.spec("box", 12, self.BOUNDS[1]))
        inset = greybox_script.UV_INSET
        for face, corners in zip(faces, uvs):
            normal = _newell([verts[i] for i in face])
            if abs(normal[1]) > max(abs(normal[0]), abs(normal[2])):
                self.assertAlmostEqual(min(c[0] for c in corners), inset)
                self.assertAlmostEqual(max(c[0] for c in corners), 1 - inset)
                self.assertAlmostEqual(min(c[1] for c in corners), inset)
                self.assertAlmostEqual(max(c[1] for c in corners), 1 - inset)

    def test_every_side_face_reads_left_to_right_from_outside(self):
        for bounds in self.BOUNDS:
            with self.subTest(bounds=bounds):
                verts, faces, uvs = greybox_script.geometry(self.spec("box", 12, bounds,
                                                                      "center"))
                seen = set()
                for face, corners in zip(faces, uvs):
                    pts = [verts[i] for i in face]
                    n = _newell(pts)
                    axis = max(range(3), key=lambda a: abs(n[a]))
                    if axis == 2:
                        continue  # top and bottom
                    seen.add((axis, n[axis] > 0))
                    right = (-n[1], n[0], 0.0)  # the outward viewer's right: (-n) x Z
                    along = [p[0] * right[0] + p[1] * right[1] for p in pts]
                    left = min(range(len(pts)), key=lambda k: along[k])
                    far = max(range(len(pts)), key=lambda k: along[k])
                    self.assertAlmostEqual(corners[left][0], greybox_script.UV_INSET)
                    self.assertAlmostEqual(corners[far][0], 1 - greybox_script.UV_INSET)
                    low = min(range(len(pts)), key=lambda k: pts[k][2])
                    high = max(range(len(pts)), key=lambda k: pts[k][2])
                    self.assertLess(corners[low][1], corners[high][1])  # upright
                self.assertEqual(seen, {(0, True), (0, False), (1, True), (1, False)})

    def test_faces_wind_outward_and_none_is_degenerate(self):
        for collision in ("box", "sphere", "capsule"):
            for bounds in self.BOUNDS + ({"x": 1.0, "y": 0.5, "z": 1.0},
                                         {"x": 1.0, "y": 1.0, "z": 1.0}):
                with self.subTest(collision=collision, bounds=bounds):
                    verts, faces, _uvs = greybox_script.geometry(
                        self.spec(collision, 200, bounds, "center"))
                    for face in faces:
                        pts = [verts[i] for i in face]
                        normal = _newell(pts)
                        self.assertGreater(sum(c * c for c in normal), 1e-18)
                        centre = [sum(p[a] for p in pts) / len(pts) for a in range(3)]
                        self.assertGreater(sum(n * c for n, c in zip(normal, centre)), 0)

    def test_a_capsule_without_a_cylinder_has_one_equator_ring(self):
        for bounds in ({"x": 1.0, "y": 0.5, "z": 1.0}, {"x": 1.0, "y": 1.0, "z": 1.0}):
            with self.subTest(bounds=bounds):
                verts, faces, _uvs = greybox_script.geometry(self.spec("capsule", 200, bounds))
                u, k = greybox_script.capsule_segments(200)
                self.assertEqual(len(verts), 2 + u * (2 * k - 1))
                self.assertEqual(greybox_script.triangles(faces), 4 * u * k - 2 * u)
        verts, faces, _uvs = greybox_script.geometry(
            self.spec("capsule", 200, {"x": 0.6, "y": 1.0, "z": 0.6}))
        u, k = greybox_script.capsule_segments(200)
        self.assertEqual(len(verts), 2 + u * 2 * k)
        self.assertEqual(greybox_script.triangles(faces), 4 * u * k)

    def test_segment_choice_fits_every_budget_from_twelve(self):
        for budget in range(12, 3000, 7):
            u, v = greybox_script.sphere_segments(budget)
            self.assertLessEqual(2 * u * (v - 1), budget)
            u, k = greybox_script.capsule_segments(budget)
            self.assertLessEqual(4 * u * k, budget)

    def test_export_options_core_known_or_refused(self):
        everything = set(greybox_script.EXPORT_OPTIONS)
        options, applied, dropped = greybox_script.select_export_options(
            everything - {"export_anim"})
        self.assertEqual(dropped, ["export_anim"])
        self.assertNotIn("export_anim", options)
        self.assertEqual(options["export_format"], "GLB")
        self.assertEqual(applied, list(options))
        for core in greybox_script.CORE_EXPORT_OPTIONS:
            with self.subTest(core=core):
                with self.assertRaises(ValueError) as ctx:
                    greybox_script.select_export_options(everything - {core})
                self.assertIn(core, str(ctx.exception))
        options, _applied, dropped = greybox_script.select_export_options(
            set(greybox_script.CORE_EXPORT_OPTIONS) | {"filepath"})
        self.assertEqual(sorted(options), sorted(greybox_script.CORE_EXPORT_OPTIONS))
        self.assertEqual(len(dropped), len(everything) - 3)


# ----------------------------------------------------------------- facts

class FactsTests(Base):
    def test_facts_on_a_hand_built_cube(self):
        path = self.root / "cube.glb"
        path.write_bytes(cube_glb((0.5, 1.0, 0.25)))
        result, code = assets.facts(str(path))
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["triangles"], 12)
        self.assertEqual(result["bounds"], {"x": 0.5, "y": 1.0, "z": 0.25})
        self.assertEqual(result["origin"], "base-center")
        self.assertIs(result["uv"], True)
        self.assertEqual(result["materials"], 1)

    def test_facts_origins_uv_and_materials(self):
        for origin in ("center", "base-center", "base-min-corner"):
            with self.subTest(origin=origin):
                self.assertEqual(assets.facts_of(cube_glb(origin=origin))["origin"], origin)
        facts = assets.facts_of(cube_glb(uv=False, materials=0))
        self.assertEqual((facts["uv"], facts["materials"]), (False, 0))
        self.assertEqual(assets.classify_origin([1, 1, 1], [2, 2, 2]), "other")

    def test_malformed_glb_refuses(self):
        good = cube_glb()
        for data, needle in ((b"", "12-byte header"), (b"GLTF" + good[4:], "magic"),
                             (good[:-4], "file size"),
                             (good[:12] + struct.pack("<II", 4, assets.CHUNK_BIN) + good[20:],
                              "")):
            with self.subTest(needle=needle):
                path = self.root / "bad.glb"
                path.write_bytes(data)
                result, code = assets.facts(str(path))
                self.blocked(result, code, "malformed GLB", needle)
        self.blocked(*assets.facts(str(self.root / "absent.glb")), "no file")


# ------------------------------------------------------------- cli + bpy

class CliTests(Base):
    def run_main(self, *argv) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = assets.main(list(argv))
        return code, json.loads(out.getvalue())

    def test_every_verb_ends_in_the_status_block(self):
        self.write_manifest(manifest_text(ENTRY_CRATE))
        code, result = self.run_main("check", "--directory", str(self.project))
        self.assertEqual(code, 0)
        self.assert_block(result)
        path = self.root / "cube.glb"
        path.write_bytes(cube_glb())
        code, result = self.run_main("facts", str(path))
        self.assertEqual(code, 0)
        self.assert_block(result)
        with mock.patch.object(assets, "run_blender", FakeBlender()):
            code, result = self.run_main("greybox", "--directory", str(self.project),
                                         "--blender", str(self.blender))
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        code, result = self.run_main("nope")
        self.assertEqual(code, 2)
        self.assert_block(result)
        self.assertEqual(result["status"], "blocked")

    def test_greybox_script_refuses_outside_blender(self):
        proc = subprocess.run([sys.executable, str(assets.GREYBOX_SCRIPT), "--", "--spec", "x"],
                              stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              timeout=30)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("runs only inside Blender", proc.stderr)

    def test_greybox_script_carries_the_fixed_export_options(self):
        text = assets.GREYBOX_SCRIPT.read_text(encoding="utf-8")
        for phrase in ('"export_format": "GLB"', '"export_copyright": ""',
                       '"export_extras": False', '"export_yup": True', '"export_apply": True',
                       '"export_animations": False', '"export_lights": False',
                       '"export_cameras": False', "read_factory_settings(use_empty=True)"):
            self.assertIn(phrase, text)
        for key in assets.SPEC_KEYS:
            self.assertIn(f'"{key}"', text)


if __name__ == "__main__":
    unittest.main()
