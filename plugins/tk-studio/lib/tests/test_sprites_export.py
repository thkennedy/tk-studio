"""The office sprite sheet is exported byte-reproducibly from our own sources (Story 30.7, D6).

tools/sprites/export.py is pinned here (repo-side, like rehearse in test_restructure_rehearse): two
exports give the same bytes and equal the committed office.png and office.json; the committed sheet
carries the floor, the desk and every registry role in every office state with at least two 16x16
frames, every alpha 0 or 255; stale outputs, coverage gaps, bad pixels and PNG sources behave as the
story's matrix says. ROLES and OFFICE_STATES are read from their source files, never copied.
"""
from __future__ import annotations

import io
import json
import re
import shutil
import struct
import sys
import tempfile
import unittest
import zlib
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
REPO = PLUGIN_ROOT.parents[1]
sys.path.insert(0, str(REPO / "tools" / "sprites"))
import export  # noqa: E402  (repo-side, like release_archive in test_release_roster)

ASSETS = REPO / "apps" / "studio-web" / "assets"
SPRITES = REPO / "apps" / "studio-web" / "public" / "sprites"
TILE = 16


def _ts_list(path: Path, name: str) -> list[str]:
    m = re.search(rf"export const {name}\s*=\s*\[([^\]]*)\]", path.read_text(encoding="utf-8"))
    assert m, f"{path}: no {name}"
    return re.findall(r'"([^"]+)"', m.group(1))


ROLES = _ts_list(REPO / "apps" / "supervisor" / "src" / "registry.ts", "ROLES")
STATES = _ts_list(REPO / "apps" / "studio-web" / "src" / "live" / "store.ts", "OFFICE_STATES")


def run(*argv: str) -> tuple[int, str]:
    err = io.StringIO()
    with redirect_stderr(err), redirect_stdout(io.StringIO()):
        code = export.main(list(argv))
    return code, err.getvalue()


def png_bytes(width: int, height: int, rows: list[bytes], filters: list[int] | None = None, ctype: int = 6) -> bytes:
    """A PNG from raw pixel rows, each scanline written with the given filter type (encoded here)."""
    bpp = 4 if ctype == 6 else 3
    raw, prev = bytearray(), bytes(width * bpp)
    for y, row in enumerate(rows):
        kind = (filters or [0] * height)[y]
        out = bytearray()
        for i, v in enumerate(row):
            a = row[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            pred = [0, a, b, (a + b) // 2, export._paeth(a, b, c)][kind]
            out.append((v - pred) & 0xFF)
        raw += bytes([kind]) + out
        prev = row
    ihdr = struct.pack(">IIBBBBB", width, height, 8, ctype, 0, 0, 0)
    return (export.SIGNATURE + export._chunk(b"IHDR", ihdr) + export._chunk(b"IDAT", zlib.compress(bytes(raw)))
            + export._chunk(b"IEND", b""))


def frames_to_png(frames: list[list[bytes]], cols: int, rows: int) -> tuple[int, int, list[bytes]]:
    """Tiles (each 256 RGBA pixels) laid row-major on a cols x rows grid; missing tiles transparent."""
    width, height = cols * TILE, rows * TILE
    blank = [b"\0\0\0\0"] * (TILE * TILE)
    grid = frames + [blank] * (cols * rows - len(frames))
    out = []
    for y in range(height):
        line = b""
        for col in range(cols):
            tile = grid[(y // TILE) * cols + col]
            line += b"".join(tile[(y % TILE) * TILE:(y % TILE + 1) * TILE])
        out.append(line)
    return width, height, out


class Committed(unittest.TestCase):
    """The committed sources and outputs."""

    def test_two_exports_are_byte_identical_and_equal_the_committed_outputs(self):
        first = export.build(ASSETS)
        second = export.build(ASSETS)
        self.assertEqual(first, second)
        self.assertEqual(first[0], (SPRITES / "office.png").read_bytes())
        self.assertEqual(first[1], (SPRITES / "office.json").read_bytes())
        self.assertEqual(run("--check")[0], 0)

    def test_the_exporter_reads_the_same_roles_and_states(self):
        self.assertEqual(export.registry_roles(), ROLES)
        self.assertEqual(export.office_states(), STATES)
        self.assertEqual(len(STATES), 8)

    def test_the_sheet_carries_floor_desk_and_every_role_in_every_state(self):
        atlas = json.loads((SPRITES / "office.json").read_text(encoding="utf-8"))
        names = set(atlas["frames"])
        self.assertIn("floor.0", names)
        self.assertIn("desk.0", names)
        for role in ROLES:
            for state in STATES:
                n = sum(1 for name in names if name.startswith(f"{role}.{state}."))
                self.assertGreaterEqual(n, 2, f"{role}.{state}")
                self.assertEqual({f"{role}.{state}.{i}" for i in range(n)},
                                 {name for name in names if name.startswith(f"{role}.{state}.")})
        pattern = re.compile(r"(floor|desk)\.0|([a-z]+)\.([a-z-]+)\.(\d+)")
        for name in names:
            self.assertTrue(pattern.fullmatch(name), name)

    def test_every_frame_is_a_16px_tile_inside_the_sheet_and_every_alpha_is_binary(self):
        raw = (SPRITES / "office.png").read_bytes()
        width, height, pixels = export.decode_png(SPRITES / "office.png")
        # RGBA8, no ancillary chunks: IHDR, IDAT, IEND only.
        kinds, at = [], 8
        while at < len(raw):
            length, kind = struct.unpack(">I4s", raw[at:at + 8])
            kinds.append(kind)
            at += 12 + length
        self.assertEqual(kinds, [b"IHDR", b"IDAT", b"IEND"])
        self.assertEqual(raw[24:26], b"\x08\x06")
        # Filter 0 on every scanline.
        inflated = zlib.decompress(raw[41:41 + struct.unpack(">I", raw[33:37])[0]])
        self.assertTrue(all(inflated[y * (1 + width * 4)] == 0 for y in range(height)))
        self.assertTrue(all(px[3] in (0, 255) for px in pixels))
        atlas = json.loads((SPRITES / "office.json").read_text(encoding="utf-8"))
        self.assertEqual(atlas["meta"], {"image": "office.png", "format": "RGBA8888",
                                         "size": {"w": width, "h": height}, "scale": "1"})
        seen = set()
        for name, entry in atlas["frames"].items():
            f = entry["frame"]
            self.assertEqual((f["w"], f["h"]), (TILE, TILE), name)
            self.assertTrue(0 <= f["x"] <= width - TILE and 0 <= f["y"] <= height - TILE, name)
            self.assertEqual((f["x"] % TILE, f["y"] % TILE), (0, 0), name)
            self.assertNotIn((f["x"], f["y"]), seen, name)
            seen.add((f["x"], f["y"]))
            self.assertEqual(entry["sourceSize"], {"w": TILE, "h": TILE})
            self.assertFalse(entry["rotated"])
            self.assertFalse(entry["trimmed"])

    def test_the_frame_order_is_floor_desk_then_roles_by_states_by_n(self):
        frames = export.collect(ASSETS, ROLES, STATES)
        names = [n for n, _ in frames]
        self.assertEqual(names[:2], ["floor.0", "desk.0"])
        keys = [(ROLES.index(r), STATES.index(s), int(i)) for r, s, i in (n.split(".") for n in names[2:])]
        self.assertEqual(keys, sorted(keys))
        atlas = json.loads((SPRITES / "office.json").read_text(encoding="utf-8"))
        positions = [(atlas["frames"][n]["frame"]["y"], atlas["frames"][n]["frame"]["x"]) for n in names]
        self.assertEqual(positions, sorted(positions))
        text = (SPRITES / "office.json").read_text(encoding="utf-8")
        self.assertTrue(text.endswith("}\n"))
        self.assertEqual(list(json.loads(text)["frames"]), sorted(atlas["frames"]))


class Sources(unittest.TestCase):
    """A scratch copy of the sources, edited per case."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.assets = self.tmp / "assets"
        self.out = self.tmp / "out"
        shutil.copytree(ASSETS, self.assets)

    def export(self, *extra: str) -> tuple[int, str]:
        return run("--assets", str(self.assets), "--out", str(self.out), *extra)

    def edit(self, name: str, old: str, new: str, count: int = 1) -> None:
        p = self.assets / name
        text = p.read_text(encoding="utf-8")
        self.assertIn(old, text)
        p.write_text(text.replace(old, new, count), encoding="utf-8", newline="\n")

    def test_writes_then_checks_clean(self):
        self.assertEqual(self.export()[0], 0)
        self.assertEqual((self.out / "office.png").read_bytes(), (SPRITES / "office.png").read_bytes())
        self.assertEqual(self.export("--check"), (0, ""))

    def test_stale_outputs_fail_the_check_naming_the_file(self):
        self.assertEqual(self.export()[0], 0)
        self.edit("session.txt", "[idle.0]\n................", "[idle.0]\nk...............")
        code, err = self.export("--check")
        self.assertNotEqual(code, 0)
        self.assertIn("office.png", err)
        self.assertNotIn("office.json", err)
        code, err = self.export("--check", "--out", str(self.tmp / "nowhere"))
        self.assertNotEqual(code, 0)
        self.assertIn("office.png", err)
        self.assertIn("office.json", err)

    def test_a_state_with_one_frame_fails_naming_the_gap(self):
        text = (self.assets / "planner.txt").read_text(encoding="utf-8")
        start = text.index("[typing.1]")
        end = text.index("[", start + 1)
        (self.assets / "planner.txt").write_text(text[:start] + text[end:], encoding="utf-8", newline="\n")
        code, err = self.export()
        self.assertNotEqual(code, 0)
        self.assertIn("planner.typing has 1 frame", err)
        self.assertFalse((self.out / "office.png").exists())

    def test_a_missing_role_state_floor_or_desk_fails_naming_it(self):
        for name, needle in (("advisor.txt", "'advisor'"), ("floor.txt", "'floor'"), ("desk.txt", "'desk'")):
            with self.subTest(name):
                moved = self.tmp / name
                (self.assets / name).rename(moved)
                code, err = self.export()
                self.assertNotEqual(code, 0)
                self.assertIn(needle, err)
                moved.rename(self.assets / name)
        self.edit("consult.txt", "[blocked.0]", "[xblocked.0]")
        code, err = self.export()
        self.assertNotEqual(code, 0)
        self.assertIn("consult.txt:", err)
        self.assertIn("[xblocked.0]", err)
        self.edit("consult.txt", "[xblocked.0]", "[blocked.2]")
        code, err = self.export()
        self.assertNotEqual(code, 0)
        self.assertIn("consult.blocked", err)

    def test_a_new_registry_role_fails_until_its_frames_exist(self):
        with self.assertRaisesRegex(export.SpriteError, "no source for 'janitor'"):
            export.build(self.assets, roles=[*ROLES, "janitor"], states=STATES)

    def test_bad_pixels_fail_naming_file_and_line(self):
        lines = (self.assets / "reviewer.txt").read_text(encoding="utf-8").splitlines()
        no = lines.index("[idle.0]") + 2  # 1-based line of the first grid row
        cases = [
            (lines[no - 1], "Z" + lines[no - 1][1:], "'Z' is not in the palette"),
            (lines[no - 1], lines[no - 1] + ".", "17 pixels wide"),
        ]
        for old, new, why in cases:
            with self.subTest(why):
                self.edit("reviewer.txt", "[idle.0]\n" + old, "[idle.0]\n" + new)
                code, err = self.export()
                self.assertNotEqual(code, 0)
                self.assertIn(f"reviewer.txt:{no}:", err)
                self.assertIn(why, err)
                self.edit("reviewer.txt", "[idle.0]\n" + new, "[idle.0]\n" + old)
        self.edit("reviewer.txt", "[idle.0]\n" + lines[no - 1] + "\n", "[idle.0]\n")
        code, err = self.export()
        self.assertIn(f"reviewer.txt:{no - 1}: [idle.0] has 15 rows", err)

    def test_a_palette_alpha_other_than_0_or_255_fails_naming_file_and_line(self):
        lines = (self.assets / "palette.txt").read_text(encoding="utf-8").splitlines()
        no = next(i for i, l in enumerate(lines, 1) if l.startswith("s "))
        old = lines[no - 1]
        self.edit("palette.txt", old, old[:8] + "80" + old[10:])
        code, err = self.export()
        self.assertNotEqual(code, 0)
        self.assertIn(f"palette.txt:{no}:", err)
        self.assertIn("alpha 80", err)

    def test_a_non_utf8_region_or_palette_fails_naming_the_file(self):
        for name in ("desk.txt", "palette.txt"):
            with self.subTest(name):
                p = self.assets / name
                good = p.read_bytes()
                lines = good.count(b"\n") + (0 if good.endswith(b"\n") else 1)
                p.write_bytes(good + b"\xff\n")
                with self.assertRaisesRegex(export.SpriteError, rf"{re.escape(name)}:{lines + 1}: not UTF-8"):
                    export.collect(self.assets, ROLES, STATES)
                code, err = self.export()
                self.assertEqual(code, 2)
                self.assertIn(f"{name}:{lines + 1}: not UTF-8", err)
                self.assertNotIn("Traceback", err)
                p.write_bytes(good)

    def test_png_sources_pack_into_the_same_names_deterministically(self):
        frames = dict(export.collect(ASSETS, ROLES, STATES))
        # floor as a one-tile PNG (filter 1), a role as a states-by-frames grid using all five filters.
        w, h, rows = frames_to_png([list(frames["floor.0"])], 1, 1)
        (self.assets / "floor.png").write_bytes(png_bytes(w, h, rows, [1] * h))
        tiles = []
        for state in STATES:
            tiles += [list(frames[f"session.{state}.0"]), list(frames[f"session.{state}.1"]), [b"\0\0\0\0"] * 256]
        w, h, rows = frames_to_png(tiles, 3, len(STATES))
        (self.assets / "session.png").write_bytes(png_bytes(w, h, rows, [y % 5 for y in range(h)]))
        self.assertEqual(export.build(self.assets), export.build(ASSETS))
        # RGB (no alpha channel) reads as opaque.
        w, h, rows = frames_to_png([list(frames["desk.0"])], 1, 1)
        (self.assets / "desk.png").write_bytes(png_bytes(w, h, [b"".join(r[i:i + 3] for i in range(0, len(r), 4)) for r in rows], ctype=2))
        png, _ = export.build(self.assets)
        self.assertEqual(png, export.build(self.assets)[0])

    def test_a_palette_png_is_rejected_naming_the_file(self):
        (self.assets / "palette.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        code, err = self.export()
        self.assertNotEqual(code, 0)
        self.assertIn("palette.png", err)
        self.assertFalse((self.out / "office.png").exists())

    def test_the_idat_is_stored_deflate_blocks_independent_of_the_zlib_build(self):
        for size in (0, 1, 65535, 65536, 200000):
            raw = bytes(i * 7 % 251 for i in range(size))
            stream = export.zlib_stored(raw)
            self.assertEqual(stream[:2], b"\x78\x01")
            self.assertEqual(zlib.decompress(stream), raw)
            blocks = max(1, -(-size // 65535))
            self.assertEqual(len(stream), 2 + 5 * blocks + size + 4)
        raw = (SPRITES / "office.png").read_bytes()
        idat = raw[41:41 + struct.unpack(">I", raw[33:37])[0]]
        self.assertEqual(idat[:2], b"\x78\x01")
        self.assertEqual(idat[2] & 0b110, 0)  # BTYPE 00: stored

    def test_a_malformed_png_or_non_binary_alpha_fails_naming_the_file(self):
        (self.assets / "desk.png").write_bytes(b"\x89PNG\r\n\x1a\nnot really")
        code, err = self.export()
        self.assertNotEqual(code, 0)
        self.assertIn("desk.png", err)
        rows = [b"\x10\x20\x30\x80" * TILE] * TILE
        (self.assets / "desk.png").write_bytes(png_bytes(TILE, TILE, rows))
        code, err = self.export()
        self.assertNotEqual(code, 0)
        self.assertIn("desk.png", err)
        self.assertIn("alpha 128", err)


if __name__ == "__main__":
    unittest.main()
