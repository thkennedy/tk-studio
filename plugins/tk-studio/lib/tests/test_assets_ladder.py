"""Tests for the asset ladder's cc0 and generated rungs (Story 34.7, AC1 to AC3).

Fakes only: Blender is an injected `assets.run_blender` that answers each
script (`normalise.py` writes a `.glb`, `render.py` a 128x128 RGBA PNG), the
generator is an injected `assets.make_client`, and the ledger lands in a
temp store (`TK_STUDIO_HOME`). A module-wide guard replaces
`urllib.request.urlopen` and `subprocess.Popen` with functions that fail the
test, so nothing here reaches the network or a real `blender` (the Windows
rule: nothing generates on the host).
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import struct
import subprocess
import sys
import unittest
import urllib.request
import zlib
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import assets  # noqa: E402
import ledger  # noqa: E402
import test_assets as t34  # noqa: E402

LIB = Path(__file__).resolve().parents[1]


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, LIB / "blender" / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


normalise_script = _load("tk_normalise", "normalise.py")
render_script = _load("tk_render", "render.py")


# --------------------------------------------------------------- the guard

class Unreachable(AssertionError):
    pass


def _no_network(*args, **kwargs):
    raise Unreachable("a test reached urllib.request.urlopen (the network)")


def _no_process(*args, **kwargs):
    raise Unreachable(f"a test started a process ({args[0] if args else kwargs})")


_GUARDS: list = []


def setUpModule():
    for target, fake in ((urllib.request, _no_network), (subprocess, _no_process)):
        name = "urlopen" if target is urllib.request else "Popen"
        patcher = mock.patch.object(target, name, fake)
        patcher.start()
        _GUARDS.append(patcher)


def tearDownModule():
    while _GUARDS:
        _GUARDS.pop().stop()


# --------------------------------------------------------------- fixtures

def png(mask_rows: list[list[int]], *, ctype: int = 6, filters=(0,)) -> bytes:
    """An 8-bit PNG of ``mask_rows`` (1 opaque, 0 transparent), colour type
    ``ctype``, each row filtered by the next of ``filters`` (0 to 4)."""
    height, width = len(mask_rows), len(mask_rows[0])
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    rows = []
    for y, row in enumerate(mask_rows):
        line = bytearray()
        for x, on in enumerate(row):
            grey = (x * 7 + y * 3) & 0xFF
            line += {0: bytes([grey]), 2: bytes([grey, 255 - grey, 9]),
                     4: bytes([grey, 255 if on else 0]),
                     6: bytes([grey, 9, 255 - grey, 200 if on else 0])}[ctype]
        rows.append(bytes(line))
    raw = bytearray()
    prev = bytes(width * channels)
    for y, line in enumerate(rows):
        kind = filters[y % len(filters)]
        out = bytearray()
        for i, value in enumerate(line):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if kind == 0:
                pred = 0
            elif kind == 1:
                pred = a
            elif kind == 2:
                pred = b
            elif kind == 3:
                pred = (a + b) >> 1
            else:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            out.append((value - pred) & 0xFF)
        raw += bytes([kind]) + out
        prev = line
    ihdr = struct.pack(">IIBBBBB", width, height, 8, ctype, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + assets._png_chunk(b"IHDR", ihdr)
            + assets._png_chunk(b"IDAT", zlib.compress(bytes(raw)))
            + assets._png_chunk(b"IEND", b""))


def square(lo: int, hi: int, size: int = assets.RENDER_SIZE) -> bytes:
    """A ``size`` RGBA render, opaque on ``[lo, hi)`` in both axes."""
    return png([[1 if lo <= x < hi and lo <= y < hi else 0 for x in range(size)]
                for y in range(size)], filters=(0, 1, 2, 3, 4))


GREY_RENDER = square(32, 96)          # the greybox's silhouette (4096 px)
GOOD_RENDER = square(30, 98)          # covers it
SMALL_RENDER = square(60, 70)         # coverage 100/4096: below 0.6
BLANK_RENDER = square(0, 0)           # nothing: fill 0


class LadderBlender:
    """An injected `run_blender` that answers by script: `normalise.py`
    writes a two-material cube sized to the spec's bounds (or ``glb(spec)``;
    the placeholder has one material), `render.py`
    the greybox render for the placeholder and ``render`` for the
    candidate. Records every call's argv and spec."""

    def __init__(self, *, glb=None, render=GOOD_RENDER, code=0, fail_script=None):
        self.glb, self.render, self.code, self.fail_script = glb, render, code, fail_script
        self.calls: list[dict] = []

    def __call__(self, argv, *, cwd, log_path, timeout_s):
        spec = json.loads(Path(argv[argv.index("--spec") + 1]).read_text(encoding="utf-8"))
        script = Path(argv[argv.index("--python") + 1]).name
        self.calls.append({"argv": list(argv), "script": script, "spec": spec})
        Path(log_path).write_text("blender 5.2\n", encoding="utf-8")
        if self.fail_script == script:
            return 3, False, 5
        if script == "normalise.py":
            b = spec["bounds"]
            data = (self.glb(spec) if self.glb
                    else t34.cube_glb((b["x"], b["y"], b["z"]), spec["origin"], materials=2))
            Path(spec["output"]).write_bytes(data)
        elif script == "render.py":
            placeholder = not Path(spec["input"]).parent.name == assets.CANDIDATES_DIR
            Path(spec["output"]).write_bytes(GREY_RENDER if placeholder else self.render)
        return self.code, False, 5

    def scripts(self) -> list[str]:
        return [c["script"] for c in self.calls]


ENTRY_CC0 = """\
  - name: crate-small   # the crate
    category: prop
    tri_budget: 500
    bounds: {x: 0.5, y: 0.5, z: 0.5}
    origin: base-center
    collision: box
    licence: greybox    # until accepted
    rung: cc0
    status: placeholder
    tags: [box, wooden]
"""
ENTRY_GEN_A = """\
  - name: lamp-post
    category: environment
    tri_budget: 500
    bounds: {x: 0.4, y: 3.0, z: 0.4}
    origin: base-center
    collision: box
    licence: greybox
    rung: generated
    status: placeholder
    prompt: a rusty street lamp
"""
ENTRY_GEN_B = ENTRY_GEN_A.replace("lamp-post", "lamp-bent").replace(
    "    prompt: a rusty street lamp\n", "")


class FakeClient:
    """An injected generator client: ``tasks`` answers per prompt order
    (``"ok"``, ``"ok-credits"`` reporting 12 credits, ``"fail"``,
    ``"raise"`` raising ``error``); records every call."""

    def __init__(self, tasks=("ok",), glb=None, charge=12, error="HTTP 402 from meshy"):
        self.tasks = list(tasks)
        self.charge = charge
        self.error = error
        self.glb = glb or t34.cube_glb((0.4, 3.0, 0.4))
        self.calls: list[tuple] = []
        self.n = 0

    def submit(self, prompt, *, timeout):
        self.calls.append(("submit", prompt))
        kind = self.tasks[min(self.n, len(self.tasks) - 1)]
        self.n += 1
        if kind == "raise":
            raise assets.GeneratorError(self.error)
        return {"task_id": f"task-{self.n}", "kind": kind}

    def poll(self, task_id, *, timeout):
        self.calls.append(("poll", task_id))
        kind = self.tasks[min(int(task_id.split("-")[1]) - 1, len(self.tasks) - 1)]
        if kind == "fail":
            return {"state": "failed", "reason": "task failed: no model"}
        out = {"state": "complete", "url": f"https://assets.example/{task_id}.glb"}
        if kind == "ok-credits":
            out["credits"] = self.charge
        return out

    def download(self, url, *, timeout):
        self.calls.append(("download", url))
        return self.glb


class Base(t34.Base):
    def setUp(self):
        super().setUp()
        self.mirror = self.root / "mirror"
        default = mock.patch.object(assets, "DEFAULT_MIRROR", str(self.root / "no-such-mirror"))
        default.start()
        self.addCleanup(default.stop)
        hkcu = mock.patch.object(assets, "_hkcu_value", lambda name: None)
        hkcu.start()
        self.addCleanup(hkcu.stop)
        environ = mock.patch.dict(os.environ)
        environ.start()
        self.addCleanup(environ.stop)  # restores both variables after the test
        for var in (assets.MIRROR_ENV, assets.KEY_ENV):
            os.environ.pop(var, None)

    def kit(self, name="kenney-crates", files=("Models/GLB format/crateWooden01.glb",
                                              "Models/barrel.fbx", "Source/crate.blend"),
            licence="License.txt", category="prop", index=True) -> Path:
        kit = self.mirror / name
        kit.mkdir(parents=True)
        if licence:
            (kit / licence).write_text("CC0 1.0\n", encoding="utf-8")
        for rel in files:
            path = kit / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(t34.cube_glb())
        if index:
            result, code = assets.mirror_index(kit=str(kit), category=category)
            self.assertEqual(code, 0, result)
        return kit

    def place_greybox(self, name="crate-small", size=(0.5, 0.5, 0.5), category="prop") -> Path:
        art = self.art()
        art.mkdir(parents=True, exist_ok=True)
        glb = assets.asset_file(art, name)
        glb.write_bytes(t34.cube_glb(size))
        assets.label_file(art, name).write_bytes(
            assets.label_png(name, assets.DEFAULT_COLOURS[category]))
        return glb

    def match(self, fake=None, **kw):
        kw.setdefault("blender", str(self.blender))
        kw.setdefault("mirror", str(self.mirror))
        with mock.patch.object(assets, "run_blender", fake or LadderBlender()):
            return assets.match(directory=str(self.project), **kw)

    def bands(self, text: str):
        path = self.project / ".tk-studio" / "budget-bands.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def generate(self, client=None, fake=None, key="sk-test-secret-0123456789", **kw):
        kw.setdefault("blender", str(self.blender))
        kw.setdefault("run_id", "20261027-160745-e3b8")
        env = dict(os.environ)
        if key:
            env[assets.KEY_ENV] = key
        factory = mock.Mock(side_effect=lambda k: client or FakeClient())
        with mock.patch.object(assets, "run_blender", fake or LadderBlender()), \
                mock.patch.object(assets, "make_client", factory), \
                mock.patch.object(assets, "POLL_INTERVAL_S", 0):
            result, code = assets.generate(directory=str(self.project), env=env, **kw)
        return result, code, factory

    def ledger_lines(self) -> list[dict]:
        path = ledger.ledger_path()
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


# ------------------------------------------------------------- the guard

class GuardTests(unittest.TestCase):
    def test_no_test_reaches_the_network_or_a_process(self):
        with self.assertRaises(Unreachable):
            urllib.request.urlopen("https://api.meshy.ai/")
        with self.assertRaises(Unreachable):
            subprocess.Popen(["blender", "-b"])
        with self.assertRaises(Unreachable):
            assets.MeshyClient("k").submit("a crate", timeout=1)


# ------------------------------------------------------------ the reader

class ReaderTests(unittest.TestCase):
    def test_tags_prompt_and_camera_are_optional_and_validated(self):
        text = "schema: 1\ncamera: {yaw: 90, pitch: -10}\nassets:\n" + ENTRY_CC0 + ENTRY_GEN_A
        doc = assets.validate(assets.parse_manifest(text))
        self.assertEqual(doc["camera"], {"yaw": 90.0, "pitch": -10.0})
        crate, lamp = doc["assets"]
        self.assertEqual(crate["tags"], ["box", "wooden"])
        self.assertIsNone(crate["prompt"])
        self.assertEqual(lamp["prompt"], "a rusty street lamp")
        old = assets.validate(assets.parse_manifest(t34.manifest_text(t34.ENTRY_CRATE)))
        self.assertEqual(old["camera"], {"yaw": 45.0, "pitch": 30.0})
        self.assertEqual(old["assets"][0]["tags"], [])
        self.assertEqual(assets.default_prompt(lamp), "lamp post, environment, low poly game asset")

    def test_flow_lists_take_plain_scalars_only(self):
        self.assertEqual(assets.parse_manifest("schema: 1\nassets: []\nx: [a, b-c]\n")["x"],
                         ["a", "b-c"])
        for text in ("x: [a, {b: c}]\n", "x: [[a]]\n", "x: [a, ]\n", "x: [a\n"):
            with self.subTest(text=text), self.assertRaises(assets.Refusal):
                assets.parse_manifest(text)

    def test_bad_ladder_keys_refuse_naming_the_field(self):
        for old, new, needle in (
                ("tags: [box, wooden]", "tags: [Box]", "tags"),
                ("tags: [box, wooden]", "tags: box", "tags"),
                ("tags: [box, wooden]", "prompt: 7", "prompt")):
            with self.subTest(new=new), self.assertRaises(assets.Refusal) as ctx:
                assets.validate(assets.parse_manifest(
                    "schema: 1\nassets:\n" + ENTRY_CC0.replace(old, new)))
            self.assertIn(needle, str(ctx.exception))
        for camera, needle in (("{yaw: 1, roll: 2}", "roll"), ("{pitch: 90}", "camera.pitch"),
                               ("{yaw: north}", "camera.yaw")):
            with self.subTest(camera=camera), self.assertRaises(assets.Refusal) as ctx:
                assets.validate(assets.parse_manifest(
                    f"schema: 1\ncamera: {camera}\nassets: []\n"))
            self.assertIn(needle, str(ctx.exception))

    def test_schema_carries_the_ladder_keys(self):
        schema = json.loads(assets.SCHEMA_PATH.read_text(encoding="utf-8"))
        props = schema["$defs"]["asset"]["properties"]
        self.assertEqual(props["tags"]["items"]["pattern"], assets.NAME_PATTERN.pattern)
        self.assertEqual(props["prompt"]["type"], "string")
        self.assertIn("meshy:<task id>", props["source"]["description"])
        self.assertEqual(sorted(schema["properties"]), sorted(assets.TOP_KEYS))
        self.assertEqual(sorted(schema["properties"]["camera"]["properties"]),
                         sorted(assets.CAMERA_KEYS))


# ------------------------------------------------------------ the index

class IndexTests(Base):
    def test_tags_are_tokens_of_folders_and_stem(self):
        self.assertEqual(assets.path_tags("Models/GLB format/crateWooden01.glb"),
                         ["crate", "format", "glb", "models", "wooden"])
        self.assertEqual(assets.tag_tokens("crate-small_2 Big.Box"),
                         ["crate", "small", "big", "box"])
        self.assertEqual(assets.tag_tokens("HTMLParser"), ["html", "parser"])

    def test_mirror_index_is_deterministic_sorted_and_skips_blend(self):
        kit = self.kit(index=False)
        result, code = assets.mirror_index(kit=str(kit), category="prop")
        self.assertEqual(code, 0, result)
        self.t34_block(result)
        first = (kit / "index.json").read_bytes()
        index = json.loads(first)
        self.assertEqual(list(index), ["schema", "kit", "licence", "licence_file", "assets"])
        self.assertEqual(index["kit"], "kenney-crates")
        self.assertEqual(index["licence"], "cc0")
        self.assertEqual(index["licence_file"], "License.txt")
        self.assertEqual([a["path"] for a in index["assets"]],
                         ["Models/GLB format/crateWooden01.glb", "Models/barrel.fbx"])
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["artifacts"], [str(kit.resolve() / "index.json")])
        _, code = assets.mirror_index(kit=str(kit), category="prop")
        self.assertEqual((kit / "index.json").read_bytes(), first)

    def test_mirror_index_refusals(self):
        kit = self.kit(licence=None, index=False)
        self.blocked(*assets.mirror_index(kit=str(kit), category="prop"), "no licence file")
        self.assertFalse((kit / "index.json").exists())
        (kit / "cc0-licence.txt").write_text("CC0", encoding="utf-8")
        self.blocked(*assets.mirror_index(kit=str(kit), category="monster"), "--category")
        self.blocked(*assets.mirror_index(kit=str(kit), category="prop", licence="cc-by"),
                     "--licence")
        self.blocked(*assets.mirror_index(kit=str(self.root / "nope"), category="prop"),
                     "--kit")
        self.assertEqual(assets.mirror_index(kit=str(kit), category="prop")[1], 0)

    def test_licence_files_match_either_spelling_in_any_case(self):
        for name in ("LICENCE.txt", "licence.md", "license", "LICENSE", "License.txt",
                     "Licence", "cc0-LICENCE.TXT", "kit_license.txt"):
            with self.subTest(name=name):
                kit = self.root / "kits" / name.replace(".", "_")
                kit.mkdir(parents=True)
                (kit / name).write_text("CC0", encoding="utf-8")
                self.assertEqual(assets._licence_file(kit), kit / name)
        kit = self.root / "kits" / "none"
        kit.mkdir(parents=True)
        (kit / "README.md").write_text("x", encoding="utf-8")
        self.assertIsNone(assets._licence_file(kit))
        self.blocked(*assets.mirror_index(kit=str(kit), category="prop"),
                     "LICENSE* or LICENCE* in any case")

    def test_index_paths_leaving_the_kit_refuse(self):
        kit = self.kit()
        index_path = kit / "index.json"
        good = json.loads(index_path.read_text(encoding="utf-8"))
        for bad in ("../other-kit/crate.glb", "Models/../../crate.glb", "/etc/crate.glb",
                    "C:/crate.glb", "C:crate.glb", "\\server\\share\\crate.glb",
                    "Models\\..\\..\\crate.glb"):
            with self.subTest(path=bad):
                doc = {**good, "assets": [{**good["assets"][0], "path": bad}]}
                index_path.write_text(json.dumps(doc), encoding="utf-8")
                with self.assertRaises(assets.Refusal) as ctx:
                    assets.load_mirror(self.mirror)
                self.assertIn("kenney-crates", str(ctx.exception))
                self.assertIn(repr(bad), str(ctx.exception))
                with self.assertRaises(assets.Refusal):
                    assets.kit_source(self.mirror, "kenney-crates", bad)
        self.assertEqual(assets.kit_source(self.mirror, "k", "a/b..c.glb"),
                         self.mirror / "k" / "a/b..c.glb")

    def test_index_paths_with_a_backslash_refuse_at_load(self):
        kit = self.kit()
        index_path = kit / "index.json"
        good = json.loads(index_path.read_text(encoding="utf-8"))
        bad = "Models\\GLB format\\crateWooden01.glb"
        doc = {**good, "assets": [{**good["assets"][0], "path": bad}]}
        index_path.write_text(json.dumps(doc), encoding="utf-8")
        with self.assertRaises(assets.Refusal) as ctx:
            assets.load_mirror(self.mirror)
        self.assertIn("kenney-crates", str(ctx.exception))
        self.assertIn(repr(bad), str(ctx.exception))
        self.assertIn("not a posix path", str(ctx.exception))
        self.assertIn("mirror-index", str(ctx.exception))

    def test_matching_tokenises_entry_tags_as_the_index_does(self):
        mirror = [
            {"kit": "a-kit", "licence": "cc0", "path": "street/lamp.glb", "category": "prop",
             "tags": assets.path_tags("street/lamp.glb")},
            {"kit": "a-kit", "licence": "cc0", "path": "barrel.glb", "category": "prop",
             "tags": ["barrel"]},
        ]
        self.assertEqual(mirror[0]["tags"], ["lamp", "street"])
        entry = {"name": "post-one", "category": "prop", "tags": ["street-lamp"]}
        best = assets.match_asset(entry, mirror)
        self.assertEqual((best["path"], best["score"]), ("street/lamp.glb", 2))
        entry = {"name": "keg", "category": "prop", "tags": ["barrel2"]}
        best = assets.match_asset(entry, mirror)
        self.assertEqual((best["path"], best["score"]), ("barrel.glb", 1))

    def test_matching_scores_then_kit_then_path(self):
        mirror = [
            {"kit": "b-kit", "licence": "cc0", "path": "crate.glb", "category": "prop",
             "tags": ["crate"]},
            {"kit": "a-kit", "licence": "cc0", "path": "z/crate.glb", "category": "prop",
             "tags": ["crate"]},
            {"kit": "a-kit", "licence": "cc0", "path": "a/crate.glb", "category": "prop",
             "tags": ["crate"]},
            {"kit": "c-kit", "licence": "cc0", "path": "crate-wooden.glb", "category": "prop",
             "tags": ["crate", "wooden"]},
            {"kit": "a-kit", "licence": "cc0", "path": "tree.glb", "category": "environment",
             "tags": ["crate", "wooden", "small"]},
        ]
        entry = {"name": "crate-small", "category": "prop", "tags": []}
        self.assertEqual(assets.match_asset(entry, mirror)["path"], "a/crate.glb")
        entry["tags"] = ["wooden"]
        best = assets.match_asset(entry, mirror)
        self.assertEqual((best["kit"], best["score"]), ("c-kit", 2))
        self.assertIsNone(assets.match_asset({"name": "lamp", "category": "prop", "tags": []},
                                             mirror))

    def test_the_mirror_root_resolution(self):
        self.mirror.mkdir()
        self.assertEqual(assets.resolve_mirror(str(self.mirror), {})[0], self.mirror.resolve())
        with self.assertRaises(assets.Refusal):
            assets.resolve_mirror(str(self.root / "absent"), {})
        self.assertEqual(assets.resolve_mirror(None, {assets.MIRROR_ENV: str(self.mirror)})[0],
                         self.mirror.resolve())
        root, why = assets.resolve_mirror(None, {assets.MIRROR_ENV: str(self.root / "x")})
        self.assertIsNone(root)
        self.assertIn("no mirror", why)
        self.assertEqual(assets.resolve_mirror(None, {}), (None, "no mirror"))
        with mock.patch.object(assets, "DEFAULT_MIRROR", str(self.mirror)):
            self.assertEqual(assets.resolve_mirror(None, {})[0], self.mirror)

    def test_the_mirror_variable_is_read_from_hkcu_first(self):
        self.mirror.mkdir()
        other = self.root / "other-mirror"
        other.mkdir()
        seen = []

        def hkcu(name):
            seen.append(name)
            return str(self.mirror) if name == assets.MIRROR_ENV else None

        with mock.patch.object(assets, "_hkcu_value", hkcu):
            root, why = assets.resolve_mirror(None, {assets.MIRROR_ENV: str(other)})
            self.assertEqual((root, why), (self.mirror.resolve(), None))
            # a User variable set per the runbook, with no process env at all
            self.assertEqual(assets.resolve_mirror(None, {})[0], self.mirror.resolve())
        self.assertIn(assets.MIRROR_ENV, seen)
        # no HKCU value: the process env still counts
        self.assertEqual(assets.resolve_mirror(None, {assets.MIRROR_ENV: str(other)})[0],
                         other.resolve())

    def t34_block(self, result):
        self.assert_block(result)
        self.assertEqual(result["status"], "complete")


# ------------------------------------------------------------ the masks

class MaskTests(unittest.TestCase):
    def test_png_unfilter_every_filter_and_colour_type(self):
        rows = [[(x + y) % 3 == 0 for x in range(9)] for y in range(6)]
        rows = [[1 if v else 0 for v in r] for r in rows]
        for ctype in (0, 2, 4, 6):
            for filters in ((0,), (1,), (2,), (3,), (4,), (0, 1, 2, 3, 4)):
                with self.subTest(ctype=ctype, filters=filters):
                    data = png(rows, ctype=ctype, filters=filters)
                    width, height, channels, _ = assets.png_pixels(data)
                    self.assertEqual((width, height, channels),
                                     (9, 6, {0: 1, 2: 3, 4: 2, 6: 4}[ctype]))
                    if ctype in (4, 6):
                        self.assertEqual(assets.alpha_mask(data),
                                         (9, 6, [bool(v) for r in rows for v in r]))
                    else:  # no alpha channel: no mask, never "every pixel opaque"
                        self.assertIsNone(assets.alpha_mask(data))
                    plain = assets.png_pixels(png(rows, ctype=ctype))
                    self.assertEqual(assets.png_pixels(png(rows, ctype=ctype,
                                                           filters=filters)), plain)

    def test_unreadable_pngs_are_none(self):
        self.assertIsNone(assets.alpha_mask(b"not a png"))
        sixteen = (b"\x89PNG\r\n\x1a\n" + assets._png_chunk(
            b"IHDR", struct.pack(">IIBBBBB", 1, 1, 16, 6, 0, 0, 0))
            + assets._png_chunk(b"IDAT", zlib.compress(b"\x00" + b"\x00" * 8))
            + assets._png_chunk(b"IEND", b""))
        self.assertIsNone(assets.alpha_mask(sixteen))

    def test_visual_gate_coverage_and_fill(self):
        self.assertEqual(assets.VISUAL_COVERAGE_MIN, 0.6)
        self.assertEqual(assets.VISUAL_FILL_MIN, 0.005)
        reasons, metrics = assets.visual_gate(GOOD_RENDER, GREY_RENDER)
        self.assertEqual(reasons, [])
        self.assertEqual(metrics["coverage"], 1.0)
        reasons, metrics = assets.visual_gate(SMALL_RENDER, GREY_RENDER)
        self.assertEqual(len(reasons), 1)
        self.assertIn("coverage", reasons[0])
        reasons, _ = assets.visual_gate(BLANK_RENDER, GREY_RENDER)
        self.assertTrue(any("fill" in r for r in reasons))
        reasons, _ = assets.visual_gate(GOOD_RENDER, BLANK_RENDER)
        self.assertTrue(any("greybox render is blank" in r for r in reasons))
        reasons, _ = assets.visual_gate(square(1, 5, size=16), GREY_RENDER)
        self.assertIn("16x16", reasons[0])

    def test_a_render_without_alpha_fails_the_visual_gate(self):
        size = assets.RENDER_SIZE
        for ctype in (0, 2):
            opaque = png([[0] * size for _ in range(size)], ctype=ctype)
            with self.subTest(ctype=ctype):
                reasons, metrics = assets.visual_gate(opaque, GREY_RENDER)
                self.assertEqual(len(reasons), 1)
                self.assertIn("candidate render", reasons[0])
                self.assertIn("alpha channel", reasons[0])
                self.assertEqual(metrics, {"coverage": None, "fill": None})
                reasons, _ = assets.visual_gate(GOOD_RENDER, opaque)
                self.assertIn("greybox render", reasons[0])


# ------------------------------------------------------------ DW-74

def nodes_glb(nodes, scene_nodes=None, *, scenes=True) -> bytes:
    """``t34.cube_glb`` (a 1 m centred cube) with ``nodes`` in place of its
    single identity node."""
    data = t34.cube_glb((1.0, 1.0, 1.0), "center")
    doc, binary = assets.read_glb(data)
    doc["nodes"] = nodes
    if scenes:
        doc["scenes"] = [{"nodes": scene_nodes if scene_nodes is not None else [0]}]
    else:
        doc.pop("scenes", None)
        doc.pop("scene", None)
    js = json.dumps(doc).encode("utf-8")
    js += b" " * (-len(js) % 4)
    body = (struct.pack("<II", len(js), assets.CHUNK_JSON) + js
            + struct.pack("<II", len(binary), assets.CHUNK_BIN) + binary)
    return struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body


class NodeFactsTests(unittest.TestCase):
    def test_world_bounds_and_per_instance_triangles(self):
        data = nodes_glb([{"children": [1, 2], "scale": [2, 1, 1]},
                          {"mesh": 0, "translation": [0, 0.5, 0]},
                          {"mesh": 0, "translation": [0, 0.5, 3]}])
        facts = assets.facts_of(data)
        self.assertEqual(facts["triangles"], 24)
        self.assertEqual(facts["bounds"], {"x": 2.0, "y": 1.0, "z": 4.0})
        self.assertEqual(facts["min"], [-1.0, 0.0, -0.5])

    def test_rotation_and_matrix_and_root_nodes(self):
        quarter = [0, 0.7071067811865476, 0, 0.7071067811865476]  # 90 degrees about Y
        facts = assets.facts_of(nodes_glb([{"mesh": 0, "rotation": quarter,
                                            "scale": [3, 1, 1]}]))
        self.assertAlmostEqual(facts["bounds"]["z"], 3.0, places=5)
        self.assertAlmostEqual(facts["bounds"]["x"], 1.0, places=5)
        matrix = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]
        facts = assets.facts_of(nodes_glb([{"mesh": 0, "matrix": matrix}], scenes=False))
        self.assertEqual(facts["bounds"], {"x": 1.0, "y": 2.0, "z": 1.0})
        self.assertEqual(facts["min"], [-0.5, 0.0, -0.5])
        self.assertEqual(facts["origin"], "base-center")

    def test_greybox_output_facts_are_unchanged(self):
        for size, origin in (((0.5, 0.5, 0.5), "base-center"), ((1.2, 0.75, 0.6), "center"),
                             ((0.3, 2.0, 0.4), "base-min-corner")):
            data = t34.cube_glb(size, origin)
            doc, _ = assets.read_glb(data)
            mesh_only = nodes_glb([], scenes=False)  # no nodes: the 34.6 reading
            with self.subTest(size=size):
                facts = assets.facts_of(data)
                self.assertEqual(facts["bounds"], {a: round(v, 6)
                                                   for a, v in zip(assets.AXES, size)})
                self.assertEqual(facts["origin"], origin)
                self.assertEqual(facts["triangles"], 12)
                self.assertEqual(doc["nodes"], [{"mesh": 0}])
        self.assertEqual(assets.facts_of(mesh_only)["triangles"], 12)

    def test_non_list_children_are_a_malformed_glb(self):
        for children in (5, "12", {"0": 1}, None, [1.0], [True], ["1"]):
            for scenes in (True, False):
                with self.subTest(children=children, scenes=scenes), \
                        self.assertRaises(assets.Refusal) as ctx:
                    assets.facts_of(nodes_glb([{"mesh": 0, "children": children},
                                               {"mesh": 0}], scenes=scenes))
                self.assertIn("malformed GLB: node 0 children", str(ctx.exception))

    def test_a_node_cycle_or_bad_mesh_refuses(self):
        with self.assertRaises(assets.Refusal):
            assets.facts_of(nodes_glb([{"children": [0], "mesh": 0}]))
        with self.assertRaises(assets.Refusal):
            assets.facts_of(nodes_glb([{"mesh": 5}]))


# ------------------------------------------------------------ write-back

class WriteBackTests(unittest.TestCase):
    TEXT = ("﻿# the slice\r\nschema: 1\r\nassets:\r\n"
            + ENTRY_CC0.replace("\n", "\r\n")
            + "  - name: other   # untouched\r\n    category: prop\r\n    tri_budget: 12\r\n"
            "    bounds: {x: 1, y: 1, z: 1}\r\n    origin: center\r\n    collision: box\r\n"
            "    licence: greybox\r\n    rung: cc0\r\n    status: placeholder\r\n"
            "    source: \"\"  # none yet")

    def test_only_status_licence_and_source_lines_change(self):
        new = assets.rewrite_manifest(self.TEXT, {
            "crate-small": {"status": "accepted", "licence": "cc0",
                            "source": "kenney-crates/Models/GLB format/crateWooden01.glb"},
            "other": {"status": "accepted", "licence": "cc0", "source": "k/other.glb"}})
        old_lines, new_lines = self.TEXT.split("\r\n"), new.split("\r\n")
        self.assertTrue(new.startswith("﻿# the slice\r\n"))
        changed = [(a, b) for a, b in zip(old_lines, new_lines) if a != b]
        self.assertIn(("    licence: greybox    # until accepted",
                       "    licence: cc0    # until accepted"), changed)
        self.assertIn(("    status: placeholder", "    status: accepted"), changed)
        self.assertEqual(new_lines[-1], '    source: "k/other.glb"  # none yet')
        inserted = new_lines.index("    status: accepted") + 1
        self.assertEqual(new_lines[inserted],
                         '    source: "kenney-crates/Models/GLB format/crateWooden01.glb"')
        self.assertEqual(len(new_lines), len(old_lines) + 1)
        rest = new_lines[:inserted] + new_lines[inserted + 1:]
        diff = [i for i, (a, b) in enumerate(zip(old_lines, rest)) if a != b]
        self.assertEqual(len(diff), 5)  # two status, two licence, one source in place
        doc = assets.validate(assets.parse_manifest(new.lstrip("﻿")))
        self.assertEqual(doc["assets"][0]["source"],
                         "kenney-crates/Models/GLB format/crateWooden01.glb")

    def test_status_only_move_keeps_every_other_byte(self):
        new = assets.rewrite_manifest(self.TEXT, {"crate-small": {"status": "candidate"}})
        self.assertEqual(new, self.TEXT.replace("status: placeholder\r\n    tags",
                                                "status: candidate\r\n    tags"))

    def test_an_unmappable_manifest_refuses(self):
        with self.assertRaises(assets.Refusal):
            assets.map_manifest("schema: 1\nassets: [a]\n")
        with self.assertRaises(ValueError):
            assets.rewrite_manifest(self.TEXT, {"crate-small": {"rung": "greybox"}})


# ------------------------------------------------------------ match

class MatchTests(Base):
    def setup_project(self, entry=ENTRY_CC0, greybox=True):
        text = "# the slice\nschema: 1\ncamera: {yaw: 30, pitch: 20}\nassets:\n" + entry
        self.write_manifest(text)
        if greybox:
            self.place_greybox()
        self.kit()
        return text

    def test_match_happy_path_accepts_and_records_provenance(self):
        text = self.setup_project()
        placeholder = assets.asset_file(self.art(), "crate-small").read_bytes()
        fake = LadderBlender()
        result, code = self.match(fake)
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        self.assertEqual(result["status"], "complete")
        row = result["entries"][0]
        self.assertEqual(row["action"], "accepted")
        self.assertEqual(row["match"]["path"], "Models/GLB format/crateWooden01.glb")
        self.assertEqual(fake.scripts(), ["normalise.py", "render.py", "render.py"])
        norm = fake.calls[0]
        self.assertEqual(norm["argv"][:4], [str(self.blender), "-b", "--python",
                                            str(assets.NORMALISE_SCRIPT)])
        self.assertEqual(norm["argv"][4:6], ["--", "--spec"])
        self.assertEqual(tuple(norm["spec"]), assets.NORMALISE_SPEC_KEYS)
        self.assertEqual(norm["spec"]["input"], str(
            self.mirror.resolve() / "kenney-crates" / "Models/GLB format/crateWooden01.glb"))
        self.assertEqual(norm["spec"]["tri_budget"], 500)
        render = fake.calls[1]
        self.assertEqual(render["argv"][3], str(assets.RENDER_SCRIPT))
        self.assertEqual(tuple(render["spec"]), assets.RENDER_SPEC_KEYS)
        self.assertEqual(render["spec"]["camera"], {"yaw": 30.0, "pitch": 20.0})
        self.assertEqual(render["spec"]["size"], 128)
        self.assertEqual(Path(render["spec"]["input"]), assets.asset_file(self.art(), "crate-small"))
        glb = assets.asset_file(self.art(), "crate-small").read_bytes()
        self.assertNotEqual(glb, placeholder)
        self.assertEqual(glb, t34.cube_glb((0.5, 0.5, 0.5), "base-center", materials=2))
        self.assertFalse(assets.candidate_file(self.art(), "crate-small").exists())
        self.assertTrue((self.art() / ".candidates" / "crate-small.render.png").is_file())
        self.assertTrue((self.art() / ".candidates" / "crate-small.greybox.png").is_file())
        new = (self.project / "assets/manifest.yaml").read_text(encoding="utf-8")
        self.assertEqual(new, text.replace("licence: greybox    # until accepted",
                                           "licence: cc0    # until accepted").replace(
            "    status: placeholder\n",
            "    status: accepted\n"
            '    source: "kenney-crates/Models/GLB format/crateWooden01.glb"\n'))
        self.assertIn("assets/manifest.yaml", result["artifacts"])
        self.assertIn("art/greybox/crate-small.glb", result["artifacts"])
        # an accepted entry is skipped on the next run
        result, code = self.match(LadderBlender())
        self.assertEqual(result["entries"][0]["action"], "skipped")

    def test_no_mirror_is_complete_with_skipped_entries(self):
        self.write_manifest("schema: 1\nassets:\n" + ENTRY_CC0 + t34.ENTRY_CRATE.replace(
            "crate-small", "crate-big"))
        fake = LadderBlender()
        with mock.patch.dict(os.environ, {"PATH": ""}):
            result, code = self.match(fake, mirror=None, blender=None)
        self.assertEqual(code, 0, result)
        self.assertEqual(result["status"], "complete")
        self.assertEqual([(e["name"], e["action"], e["reason"]) for e in result["entries"]],
                         [("crate-small", "skipped", "no mirror")])
        self.assertEqual(fake.calls, [])

    def test_unmatched_and_no_greybox_are_not_failures(self):
        self.write_manifest("schema: 1\nassets:\n"
                            + ENTRY_CC0.replace("crate-small", "lamp").replace(
                                "tags: [box, wooden]", "tags: [light]")
                            + ENTRY_CC0.replace("crate-small", "crate-big"))
        self.place_greybox("lamp")
        self.kit()
        before = (self.project / "assets/manifest.yaml").read_bytes()
        fake = LadderBlender()
        result, code = self.match(fake)
        self.assertEqual(code, 0, result)
        rows = {e["name"]: e for e in result["entries"]}
        self.assertEqual(rows["lamp"]["action"], "unmatched")
        self.assertEqual((rows["crate-big"]["action"], rows["crate-big"]["reason"]),
                         ("skipped", "run greybox first"))
        self.assertEqual(fake.calls, [])
        self.assertEqual((self.project / "assets/manifest.yaml").read_bytes(), before)

    def gate_fails(self, fake, needle):
        text = self.setup_project()
        glb = assets.asset_file(self.art(), "crate-small")
        placeholder = glb.read_bytes()
        result, code = self.match(fake)
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        row = result["entries"][0]
        self.assertEqual(row["action"], "candidate")
        self.assertTrue(any(needle in r for r in row["reasons"]), row["reasons"])
        self.assertEqual(glb.read_bytes(), placeholder)
        self.assertTrue(assets.candidate_file(self.art(), "crate-small").is_file())
        new = (self.project / "assets/manifest.yaml").read_text(encoding="utf-8")
        self.assertEqual(new, text.replace("status: placeholder", "status: candidate"))
        return result, fake

    def test_facts_gate_failure_keeps_the_placeholder(self):
        _, fake = self.gate_fails(LadderBlender(glb=lambda spec: t34.cube_glb((0.5, 0.9, 0.5))),
                                  "facts: bounds.y")
        self.assertEqual(fake.scripts(), ["normalise.py"])  # no render once facts fail

    def test_coverage_failure_keeps_the_placeholder(self):
        result, _ = self.gate_fails(LadderBlender(render=SMALL_RENDER), "coverage")
        self.assertLess(result["entries"][0]["coverage"], 0.6)

    def test_blank_render_failure_keeps_the_placeholder(self):
        self.gate_fails(LadderBlender(render=BLANK_RENDER), "fill")

    def setup_candidate(self):
        """An entry an earlier run left at ``candidate``, its candidate kept."""
        text = self.setup_project(ENTRY_CC0.replace("status: placeholder", "status: candidate"))
        stale = assets.candidate_file(self.art(), "crate-small")
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_bytes(b"an earlier run's candidate")
        return text, stale

    def test_a_candidate_whose_gates_fail_again_is_unmoved(self):
        text, stale = self.setup_candidate()
        glb = assets.asset_file(self.art(), "crate-small")
        placeholder = glb.read_bytes()
        manifest = (self.project / "assets/manifest.yaml").read_bytes()
        result, code = self.match(LadderBlender(render=SMALL_RENDER))
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["entries"][0]["action"], "candidate")
        self.assertEqual((self.project / "assets/manifest.yaml").read_bytes(), manifest)
        self.assertIn("status: candidate", text)
        self.assertEqual(glb.read_bytes(), placeholder)
        # this run's candidate replaced the earlier one
        self.assertEqual(stale.read_bytes(),
                         t34.cube_glb((0.5, 0.5, 0.5), "base-center", materials=2))

    def test_a_candidate_whose_gates_pass_is_accepted(self):
        text, stale = self.setup_candidate()
        glb = assets.asset_file(self.art(), "crate-small")
        result, code = self.match(LadderBlender())
        self.assertEqual(code, 0, result)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["entries"][0]["action"], "accepted")
        self.assertEqual(glb.read_bytes(), t34.cube_glb((0.5, 0.5, 0.5), "base-center",
                                                        materials=2))
        self.assertFalse(stale.exists())  # moved over the placeholder, no stale copy left
        new = (self.project / "assets/manifest.yaml").read_text(encoding="utf-8")
        self.assertEqual(new, text.replace("licence: greybox    # until accepted",
                                           "licence: cc0    # until accepted").replace(
            "    status: candidate\n",
            "    status: accepted\n"
            '    source: "kenney-crates/Models/GLB format/crateWooden01.glb"\n'))

    def test_a_blender_failure_leaves_the_entry_unmoved(self):
        text = self.setup_project()
        result, code = self.match(LadderBlender(fail_script="normalise.py"))
        self.assertEqual(code, 1)
        self.assertEqual(result["entries"][0]["action"], "failed")
        self.assertIn("blender exit 3", result["entries"][0]["reason"])
        self.assertEqual((self.project / "assets/manifest.yaml").read_text(encoding="utf-8"), text)

    def test_a_stale_label_fails_with_the_greybox_reason(self):
        self.setup_project()
        assets.label_file(self.art(), "crate-small").write_bytes(
            assets.label_png("crate-small", "#123456"))
        fake = LadderBlender()
        result, code = self.match(fake)
        self.assertEqual(code, 1)
        row = result["entries"][0]
        self.assertEqual(row["action"], "failed")
        self.assertIn("label: stale", row["reason"])
        self.assertIn("remove it first, then run greybox again", row["reason"])
        self.assertEqual(fake.calls, [])

    def test_an_unmappable_manifest_refuses_before_any_work(self):
        self.setup_project()
        fake = LadderBlender()
        with mock.patch.object(assets, "map_manifest", lambda text, label="m": []):
            result, code = self.match(fake)
        self.blocked(result, code, "cannot be mapped line by line")
        self.assertEqual(fake.calls, [])

    def test_a_failed_write_back_places_nothing(self):
        text = self.setup_project()
        glb = assets.asset_file(self.art(), "crate-small")
        placeholder = glb.read_bytes()
        real = assets._write_atomic

        def refuse_manifest(path, data):
            if Path(path).name == "manifest.yaml":
                raise OSError("disk full")
            return real(path, data)

        with mock.patch.object(assets, "_write_atomic", refuse_manifest):
            result, code = self.match()
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertIn("not rewritten (disk full)", result["writeback"])
        row = result["entries"][0]
        self.assertEqual(row["action"], "failed")
        self.assertIn("not placed", row["reason"])
        self.assertEqual(glb.read_bytes(), placeholder)
        self.assertTrue(assets.candidate_file(self.art(), "crate-small").is_file())
        self.assertEqual((self.project / "assets/manifest.yaml").read_text(encoding="utf-8"),
                         text)
        self.assertNotIn("art/greybox/crate-small.glb", result["artifacts"])
        self.assertNotIn("assets/manifest.yaml", result["artifacts"])
        self.assertIn("art/greybox/.candidates/crate-small.glb", result["artifacts"])

    def refuse_placeholder_replace(self):
        """An ``os.replace`` that fails only for the candidate over the
        placeholder (the manifest's atomic writes still go through)."""
        real = os.replace

        def fake(src, dst):
            if Path(src).parent.name == assets.CANDIDATES_DIR and Path(dst).name == "crate-small.glb":
                raise OSError("file in use")
            return real(src, dst)
        return mock.patch.object(assets.os, "replace", fake)

    def test_a_failed_replace_rolls_the_entry_back(self):
        text = self.setup_project()
        mpath = self.project / "assets/manifest.yaml"
        before = mpath.read_bytes()
        glb = assets.asset_file(self.art(), "crate-small")
        placeholder = glb.read_bytes()
        with self.refuse_placeholder_replace():
            result, code = self.match()
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["writeback"])
        row = result["entries"][0]
        self.assertEqual(row["action"], "failed")
        self.assertIn("not replaced after the write-back: file in use", row["reason"])
        self.assertEqual(row["reasons"], [row["reason"]])
        self.assertNotIn("compensating", row["reason"])
        # the entry's status, licence and source lines are back: the inserted
        # source line removed, the file byte for byte what it was
        self.assertEqual(mpath.read_bytes(), before)
        self.assertEqual(mpath.read_text(encoding="utf-8"), text)
        self.assertEqual(glb.read_bytes(), placeholder)
        self.assertTrue(assets.candidate_file(self.art(), "crate-small").is_file())
        self.assertIn("art/greybox/.candidates/crate-small.glb", result["artifacts"])
        self.assertNotIn("art/greybox/crate-small.glb", result["artifacts"])

    def test_a_failed_compensating_write_back_is_reported(self):
        self.setup_project()
        mpath = self.project / "assets/manifest.yaml"
        glb = assets.asset_file(self.art(), "crate-small")
        placeholder = glb.read_bytes()
        real = assets._write_atomic
        writes = []

        def second_manifest_write_fails(path, data):
            if Path(path).name == "manifest.yaml":
                writes.append(data)
                if len(writes) > 1:
                    raise OSError("disk full")
            return real(path, data)

        with self.refuse_placeholder_replace(), \
                mock.patch.object(assets, "_write_atomic", second_manifest_write_fails):
            result, code = self.match()
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(writes), 2)
        row = result["entries"][0]
        self.assertEqual(row["action"], "failed")
        self.assertEqual(len(row["reasons"]), 2)
        self.assertIn("not replaced after the write-back: file in use", row["reasons"][0])
        self.assertIn("compensating write-back failed", row["reasons"][1])
        self.assertIn("not rolled back (disk full)", row["reasons"][1])
        self.assertEqual(row["reason"], "; ".join(row["reasons"]))
        self.assertIn("not rolled back (disk full)", result["reason"])
        # the compensation did not land: the manifest still says accepted
        self.assertIn("status: accepted", mpath.read_text(encoding="utf-8"))
        self.assertEqual(glb.read_bytes(), placeholder)
        self.assertTrue(assets.candidate_file(self.art(), "crate-small").is_file())

    def test_no_blender_refuses_when_there_is_work(self):
        self.setup_project()
        with mock.patch.dict(os.environ, {"PATH": "", "BLENDER": ""}):
            result, code = self.match(blender=None)
        self.blocked(result, code, "no blender")


# ------------------------------------------------------------ generate

class GenerateTests(Base):
    def setup_project(self, *entries):
        text = "schema: 1\nassets:\n" + "".join(entries or (ENTRY_GEN_A,))
        self.write_manifest(text)
        for entry in entries or (ENTRY_GEN_A,):
            name = entry.split("name: ")[1].split("\n")[0].strip()
            self.place_greybox(name, (0.4, 3.0, 0.4), "environment")
        return text

    def assert_untouched(self, text):
        self.assertEqual((self.project / "assets/manifest.yaml").read_text(encoding="utf-8"), text)
        self.assertFalse((self.art() / ".candidates").exists())
        self.assertEqual(self.ledger_lines(), [])

    def test_no_cap_refuses_before_any_call_or_write(self):
        text = self.setup_project()
        for bands in (None, "epics: {}\n", "assets:\n  credit_cap: 0\n",
                      "assets:\n  other: 3\n"):
            with self.subTest(bands=bands):
                if bands is not None:
                    self.bands(bands)
                result, code, factory = self.generate()
                self.blocked(result, code, "assets.credit_cap")
                factory.assert_not_called()
                self.assert_untouched(text)

    def test_no_key_refuses_naming_the_variable(self):
        text = self.setup_project()
        self.bands("assets:\n  credit_cap: 100\n")
        result, code, factory = self.generate(key=None)
        self.blocked(result, code, "TK_ASSETS_MESHY_KEY")
        factory.assert_not_called()
        self.assert_untouched(text)

    def test_the_key_is_read_from_hkcu_first_and_never_printed(self):
        with mock.patch.object(assets, "_hkcu_value", lambda name: " from-registry "):
            self.assertEqual(assets.user_env(assets.KEY_ENV, {assets.KEY_ENV: "env"}),
                             "from-registry")
        self.assertEqual(assets.user_env(assets.KEY_ENV, {assets.KEY_ENV: " env "}), "env")
        self.assertIsNone(assets.user_env(assets.KEY_ENV, {assets.KEY_ENV: "  "}))
        self.setup_project()
        self.bands("assets:\n  credit_cap: 100\n")
        key = "sk-very-secret-key-0000"
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
                mock.patch.dict(os.environ, {assets.KEY_ENV: key}), \
                mock.patch.object(assets, "run_blender", LadderBlender()), \
                mock.patch.object(assets, "make_client", lambda k: FakeClient(("raise",))), \
                mock.patch.object(assets, "POLL_INTERVAL_S", 0):
            assets.main(["generate", "--directory", str(self.project), "--run-id", "r1",
                         "--blender", str(self.blender)])
        self.assertNotIn(key, out.getvalue())
        self.assertNotIn(key, ledger.ledger_path().read_text(encoding="utf-8"))

    def test_a_client_error_carrying_the_key_is_scrubbed(self):
        self.setup_project()
        self.bands("assets:\n  credit_cap: 100\n")
        key = "sk-very-secret-key-0000"
        client = FakeClient(("raise",), error=f"HTTP 401 from meshy: bad key {key}")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
                mock.patch.dict(os.environ, {assets.KEY_ENV: key}), \
                mock.patch.object(assets, "run_blender", LadderBlender()), \
                mock.patch.object(assets, "make_client", lambda k: client), \
                mock.patch.object(assets, "POLL_INTERVAL_S", 0):
            assets.main(["generate", "--directory", str(self.project), "--run-id", "r1",
                         "--blender", str(self.blender)])
        self.assertNotIn(key, out.getvalue())
        row = json.loads(out.getvalue())["entries"][0]
        self.assertEqual((row["action"], row["reason"]),
                         ("failed", "meshy: HTTP 401 from meshy: bad key [redacted]"))
        self.assertNotIn(key, ledger.ledger_path().read_text(encoding="utf-8"))
        self.assertEqual([line["payload"]["reason"] for line in self.ledger_lines()],
                         ["HTTP 401 from meshy: bad key [redacted]"])

    def test_generate_accepts_and_records_the_call(self):
        text = self.setup_project()
        self.bands("assets:\n  credit_cap: 100\n")
        client = FakeClient(("ok-credits",))
        fake = LadderBlender()
        result, code, factory = self.generate(client, fake)
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        row = result["entries"][0]
        self.assertEqual((row["action"], row["task_id"], row["credits"]),
                         ("accepted", "task-1", 12))
        self.assertEqual(client.calls[0], ("submit", "a rusty street lamp"))
        self.assertEqual(fake.scripts(), ["normalise.py", "render.py", "render.py"])
        self.assertTrue(fake.calls[0]["spec"]["input"].endswith("lamp-post.generated.glb"))
        lines = self.ledger_lines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["event"], "asset-generation")
        self.assertEqual(lines[0]["project"], "project")
        self.assertEqual(lines[0]["payload"], {
            "run_id": "20261027-160745-e3b8", "asset": "lamp-post", "provider": "meshy",
            "credits": 12, "state": "complete", "task_id": "task-1"})
        new = (self.project / "assets/manifest.yaml").read_text(encoding="utf-8")
        self.assertEqual(new, text.replace("    licence: greybox\n", "    licence: generated\n")
                         .replace("    status: placeholder\n",
                                  '    status: accepted\n    source: "meshy:task-1"\n'))

    def test_failed_calls_are_recorded_with_the_estimate(self):
        self.setup_project(ENTRY_GEN_A, ENTRY_GEN_B)
        self.bands("assets:\n  credit_cap: 100\n")
        result, code, _ = self.generate(FakeClient(("raise", "fail")))
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "partial")
        self.assertEqual([e["action"] for e in result["entries"]], ["failed", "failed"])
        lines = [line["payload"] for line in self.ledger_lines()]
        self.assertEqual(lines, [
            {"run_id": "20261027-160745-e3b8", "asset": "lamp-post", "provider": "meshy",
             "credits": assets.MESHY_CREDITS_PER_TASK, "state": "failed", "estimated": True,
             "reason": "HTTP 402 from meshy"},
            {"run_id": "20261027-160745-e3b8", "asset": "lamp-bent", "provider": "meshy",
             "credits": assets.MESHY_CREDITS_PER_TASK, "state": "failed", "estimated": True,
             "task_id": "task-2", "reason": "task failed: no model"}])
        self.assertEqual(result["credits_spent"], 2 * assets.MESHY_CREDITS_PER_TASK)

    def test_the_cap_is_never_crossed(self):
        text = self.setup_project(ENTRY_GEN_A, ENTRY_GEN_B)
        self.bands("assets:\n  credit_cap: 30\n")
        client = FakeClient(("ok",))
        result, code, _ = self.generate(client)
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        rows = result["entries"]
        self.assertEqual([(r["action"], r["reason"]) for r in rows],
                         [("accepted", None), ("not-run", "credit cap")])
        self.assertEqual(len(self.ledger_lines()), 1)
        self.assertLessEqual(result["credits_spent"], 30)
        self.assertEqual([c[0] for c in client.calls], ["submit", "poll", "download"])
        self.assertIn("status: accepted", (self.project / "assets/manifest.yaml")
                      .read_text(encoding="utf-8"))
        self.assertIn("lamp-bent", text)

    def test_a_charge_above_the_estimate_stops_the_run_partial(self):
        entry_c = ENTRY_GEN_B.replace("lamp-bent", "lamp-tall")
        self.setup_project(ENTRY_GEN_A, ENTRY_GEN_B, entry_c)
        self.bands("assets:\n  credit_cap: 20\n")
        client = FakeClient(("ok-credits",), charge=25)
        result, code, _ = self.generate(client)
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual([(r["action"], r["reason"]) for r in result["entries"]],
                         [("accepted", None), ("not-run", "credit cap"),
                          ("not-run", "credit cap")])
        self.assertEqual(result["credits_spent"], 25)
        self.assertIn("credit cap: spent 25 credits, over the cap of 20", result["reason"])
        self.assertEqual([c[0] for c in client.calls], ["submit", "poll", "download"])

    def test_a_reported_charge_of_zero_or_less_falls_back_to_the_estimate(self):
        for charge in (0, -5, 0.0, float("nan"), True):
            with self.subTest(charge=charge):
                call = assets._generate_one(
                    FakeClient(("ok-credits",), charge=charge),
                    {"name": "lamp-post", "category": "environment", "prompt": "a lamp"},
                    assets._Run(project=self.project, art=self.art(), binary="b",
                                temp=self.root, wall_s=60, camera={}), "k")
                self.assertEqual((call["credits"], call.get("estimated")),
                                 (assets.MESHY_CREDITS_PER_TASK, True))
        self.setup_project(ENTRY_GEN_A, ENTRY_GEN_B)
        self.bands("assets:\n  credit_cap: 40\n")
        result, code, _ = self.generate(FakeClient(("ok-credits",), charge=-3))
        self.assertEqual(code, 0, result)
        self.assertEqual([(r["action"], r["credits"], r.get("estimated"))
                          for r in result["entries"]],
                         [("accepted", 20, True), ("accepted", 20, True)])
        self.assertEqual(result["credits_spent"], 40)
        self.assertEqual([line["payload"]["credits"] for line in self.ledger_lines()], [20, 20])
        self.assertNotIn(-3, [r["credits"] for r in result["entries"]])

    def test_a_reported_charge_above_the_estimate_raises_the_next_pre_check(self):
        self.setup_project(ENTRY_GEN_A, ENTRY_GEN_B)
        # 30 + the estimate (20) fits 55, but 30 + the charge seen (30) does not
        self.bands("assets:\n  credit_cap: 55\n")
        client = FakeClient(("ok-credits",), charge=30)
        result, code, _ = self.generate(client)
        self.assertEqual(code, 1, result)
        self.assertEqual([(r["action"], r["reason"]) for r in result["entries"]],
                         [("accepted", None), ("not-run", "credit cap")])
        self.assertEqual(result["credits_spent"], 30)
        self.assertNotIn("over the cap", result["reason"])
        self.assertEqual(len(self.ledger_lines()), 1)

    def test_a_ledger_failure_ends_the_run_partial_naming_the_entry(self):
        self.setup_project()
        self.bands("assets:\n  credit_cap: 100\n")
        with mock.patch.object(ledger, "emit", side_effect=OSError("ledger locked")):
            result, code, _ = self.generate(FakeClient(("ok-credits",)))
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["ok"])
        row = result["entries"][0]
        self.assertEqual(row["action"], "accepted")
        self.assertEqual(row["ledger_error"], "ledger locked")
        self.assertIn("lamp-post: ledger line not written (ledger locked)", result["reason"])

    def test_no_call_is_made_once_a_ledger_line_fails(self):
        self.setup_project(ENTRY_GEN_A, ENTRY_GEN_B)
        self.bands("assets:\n  credit_cap: 100\n")
        client = FakeClient(("ok-credits",))
        with mock.patch.object(ledger, "emit", side_effect=OSError("ledger locked")):
            result, code, factory = self.generate(client)
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual([(r["action"], r["reason"]) for r in result["entries"]],
                         [("accepted", None), ("not-run", "ledger unwritable")])
        self.assertEqual([c[0] for c in client.calls], ["submit", "poll", "download"])
        factory.assert_called_once()
        self.assertEqual(result["credits_spent"], 12)
        self.assertIn("lamp-post: ledger line not written (ledger locked)", result["reason"])
        self.assertIn("lamp-bent: ledger unwritable", result["reason"])

    def test_a_failed_write_back_leaves_the_generated_placeholder(self):
        text = self.setup_project()
        self.bands("assets:\n  credit_cap: 100\n")
        glb = assets.asset_file(self.art(), "lamp-post")
        placeholder = glb.read_bytes()
        with mock.patch.object(assets, "_write_back", lambda *a: "manifest not rewritten (x)"):
            result, code, _ = self.generate(FakeClient(("ok-credits",)))
        self.assertEqual(code, 1, result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["entries"][0]["action"], "failed")
        self.assertEqual(glb.read_bytes(), placeholder)
        self.assertTrue(assets.candidate_file(self.art(), "lamp-post").is_file())
        self.assertEqual((self.project / "assets/manifest.yaml").read_text(encoding="utf-8"),
                         text)

    def test_generated_gates_fail_keeps_the_placeholder(self):
        self.setup_project()
        self.bands("assets:\n  credit_cap: 100\n")
        glb = assets.asset_file(self.art(), "lamp-post")
        placeholder = glb.read_bytes()
        result, code, _ = self.generate(FakeClient(), LadderBlender(render=BLANK_RENDER))
        self.assertEqual(code, 1)
        self.assertEqual(result["entries"][0]["action"], "candidate")
        self.assertEqual(glb.read_bytes(), placeholder)
        self.assertEqual(len(self.ledger_lines()), 1)
        self.assertIn("status: candidate", (self.project / "assets/manifest.yaml")
                      .read_text(encoding="utf-8"))

    def test_the_meshy_client_sends_the_key_only_in_the_api_header(self):
        seen = []

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def fake_urlopen(req, timeout):
            seen.append(req)
            if req.full_url.endswith("text-to-3d"):
                return Resp(b'{"result": "t-9"}')
            if req.full_url.endswith("/t-9"):
                return Resp(b'{"status": "SUCCEEDED", "model_urls": '
                            b'{"glb": "https://cdn.example/m.glb"}}')
            return Resp(b"glb-bytes")

        client = assets.MeshyClient("sk-key")
        with mock.patch.object(urllib.request, "urlopen", fake_urlopen):
            self.assertEqual(client.submit("a lamp", timeout=5), {"task_id": "t-9"})
            polled = client.poll("t-9", timeout=5)
            self.assertEqual(polled, {"state": "complete", "url": "https://cdn.example/m.glb"})
            self.assertEqual(client.download(polled["url"], timeout=5), b"glb-bytes")
        self.assertEqual(seen[0].get_header("Authorization"), "Bearer sk-key")
        self.assertEqual(json.loads(seen[0].data), {"mode": "preview", "prompt": "a lamp"})
        self.assertIsNone(seen[2].get_header("Authorization"))
        for req in seen:
            self.assertNotIn("sk-key", req.full_url)

    def test_the_taxonomy_declares_the_event(self):
        events = ledger.load_taxonomy()["events"]
        self.assertIn("lib/assets.py generate", events["asset-generation"]["emitter"])
        ledger.validate("asset-generation", {"run_id": "r", "asset": "a", "provider": "meshy",
                                             "credits": 20, "estimated": True,
                                             "state": "failed", "reason": "x"})


# ------------------------------------------------------------ the scripts

class ScriptTests(unittest.TestCase):
    def test_normalise_helpers(self):
        self.assertEqual(normalise_script.SPEC_KEYS, assets.NORMALISE_SPEC_KEYS)
        self.assertEqual(normalise_script.importer_for("a/B.GLB"), "gltf")
        self.assertEqual(normalise_script.importer_for("a.fbx"), "fbx")
        self.assertEqual(normalise_script.importer_for("a.obj"), "obj")
        with self.assertRaises(ValueError):
            normalise_script.importer_for("a.blend")
        size = normalise_script.blender_size({"x": 1.0, "y": 2.0, "z": 3.0})
        self.assertEqual(size, (1.0, 3.0, 2.0))
        centre, factors, offset = normalise_script.fit((-1, -1, 0), (1, 3, 4), size,
                                                       "base-center")
        self.assertEqual(centre, (0.0, 1.0, 2.0))
        self.assertEqual(factors, (0.5, 0.75, 0.5))
        self.assertEqual(offset, (0.0, 0.0, 1.0))
        self.assertEqual(normalise_script.decimate_ratio(100, 500), 1.0)
        self.assertLess(normalise_script.decimate_ratio(1000, 500), 0.5)

    def test_render_frames_on_the_bounds(self):
        self.assertEqual(render_script.SPEC_KEYS, assets.RENDER_SPEC_KEYS)
        cam = render_script.frame({"x": 3, "y": 4, "z": 12}, 0, 0)
        self.assertEqual(cam["ortho_scale"], 26.0)
        self.assertAlmostEqual(cam["location"][1], -27.0)
        self.assertAlmostEqual(cam["location"][2], 0.0)
        top = render_script.frame({"x": 1, "y": 1, "z": 1}, 90, 30)
        self.assertGreater(top["location"][0], 0)
        self.assertGreater(top["location"][2], 0)

    def test_scripts_refuse_outside_blender(self):
        for module, name in ((normalise_script, "normalise.py"), (render_script, "render.py")):
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                self.assertEqual(module.main(["x", "--", "--spec", "s.json"]), 2)
            self.assertIn(f"{name} runs only inside Blender", err.getvalue())

    def test_normalise_exports_with_greybox_options(self):
        text = assets.NORMALISE_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("from greybox import _offset, export", text)
        self.assertIn('"COLLAPSE"', text)
        self.assertIn("read_factory_settings(use_empty=True)", text)
        text = assets.RENDER_SCRIPT.read_text(encoding="utf-8")
        for phrase in ('"BLENDER_WORKBENCH"', '"FLAT"', '"SINGLE"', "film_transparent = True",
                       '"ORTHO"', '"RGBA"'):
            self.assertIn(phrase, text)


# ------------------------------------------------------------ the cli

class CliTests(Base):
    def run_main(self, *argv) -> tuple[int, dict]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = assets.main(list(argv))
        return code, json.loads(out.getvalue())

    def test_every_ladder_verb_ends_in_the_status_block(self):
        kit = self.kit(index=False)
        code, result = self.run_main("mirror-index", "--kit", str(kit), "--category", "prop")
        self.assertEqual(code, 0, result)
        self.assert_block(result)
        self.write_manifest("schema: 1\nassets:\n" + ENTRY_CC0)
        code, result = self.run_main("match", "--directory", str(self.project))
        self.assertEqual((code, result["status"]), (0, "complete"))
        self.assert_block(result)
        code, result = self.run_main("generate", "--directory", str(self.project),
                                     "--run-id", "r1")
        self.assertEqual((code, result["status"]), (2, "blocked"))
        self.assert_block(result)
        code, result = self.run_main("generate", "--directory", str(self.project))
        self.assertEqual(code, 2)
        self.assert_block(result)


if __name__ == "__main__":
    unittest.main()
