"""tk-studio normalise — the Blender half of `assets.py match` and
`assets.py generate` (Story 34.7, plans/34-7.md §Settled shape 4).

Runs only inside Blender, headless, on the host:

    <blender> -b --python <plugin>/lib/blender/normalise.py -- --spec <json>

The spec (written by `assets.py`) holds exactly `name, input, bounds,
origin, tri_budget, output`. This script resets Blender to an empty scene,
imports `input` by its extension (`.glb`/`.gltf`, `.fbx`, `.obj`), applies
every object's transform, joins the meshes into one, decimates it
(collapse) until its triangles are at most `tri_budget`, scales it
non-uniformly so its extents equal `bounds`, places the origin per
`origin`, and exports one binary glTF to `output` with greybox's fixed
options.

Axes: `bounds` are glTF axes (Y up), mapped to Blender X, Z, Y as in
greybox (Blender X = bounds.x, Blender Y = bounds.z, Blender Z = bounds.y);
the origin rule is greybox's `_offset`. Decimation runs before the fit, so
the extents are exact after it.

The pure helpers (the spec, the importer choice, the size, the fit, the
decimate ratio) import without Blender, so the lib suite tests them. Run
outside Blender the script exits 2 with a message naming the call.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from greybox import _offset, export  # noqa: E402  (greybox imports without bpy)

SPEC_KEYS = ("name", "input", "bounds", "origin", "tri_budget", "output")
IMPORTERS = {".glb": "gltf", ".gltf": "gltf", ".fbx": "fbx", ".obj": "obj"}
DECIMATE_PASSES = 8


# ------------------------------------------------------------ pure helpers

def parse_spec(argv: list[str]) -> dict:
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(prog="normalise.py")
    parser.add_argument("--spec", required=True)
    ns = parser.parse_args(args)
    with open(ns.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    missing = [k for k in SPEC_KEYS if k not in spec]
    if missing:
        raise ValueError("spec is missing " + ", ".join(missing))
    return spec


def importer_for(path: str) -> str:
    """The importer for ``path`` by its extension."""
    suffix = Path(path).suffix.lower()
    if suffix not in IMPORTERS:
        raise ValueError(f"no importer for {suffix or 'a file without extension'} "
                         "(.glb, .gltf, .fbx, .obj)")
    return IMPORTERS[suffix]


def blender_size(bounds: dict) -> tuple[float, float, float]:
    """glTF's Y-up bounds as Blender (X, Y, Z) sizes."""
    return float(bounds["x"]), float(bounds["z"]), float(bounds["y"])


def fit(lo, hi, size, origin: str):
    """``(centre, factors, offset)``: a vertex ``v`` maps to ``(v - centre)
    * factors + offset``, so the box ``lo..hi`` becomes ``size`` with the
    origin per the rule. A flat axis keeps factor 1."""
    centre = tuple((a + b) / 2 for a, b in zip(lo, hi))
    factors = tuple((s / (b - a)) if (b - a) > 1e-12 else 1.0
                    for a, b, s in zip(lo, hi, size))
    return centre, factors, _offset(origin, *size)


def decimate_ratio(triangles: int, budget: int) -> float:
    """The collapse ratio aiming at ``budget`` (1.0 when within it)."""
    if triangles <= budget:
        return 1.0
    return max(0.0001, budget / triangles * 0.98)


# --------------------------------------------------------- the Blender part

def _triangles(mesh) -> int:
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def _import(bpy, path: str) -> None:
    kind = importer_for(path)
    if kind == "gltf":
        result = bpy.ops.import_scene.gltf(filepath=path)
    elif kind == "fbx":
        result = bpy.ops.import_scene.fbx(filepath=path)
    else:
        result = bpy.ops.wm.obj_import(filepath=path)
    if "FINISHED" not in result:
        raise RuntimeError(f"import of {path} did not finish: {result}")


def normalise(bpy, spec: dict):
    _import(bpy, spec["input"])
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"{spec['input']} holds no mesh")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in scene.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    for obj in [o for o in scene.objects if o.type != "MESH"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = spec["name"]
    budget = int(spec["tri_budget"])
    for _ in range(DECIMATE_PASSES):
        tris = _triangles(obj.data)
        if tris <= budget:
            break
        mod = obj.modifiers.new(name="decimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.use_collapse_triangulate = True
        mod.ratio = decimate_ratio(tris, budget)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if _triangles(obj.data) > budget:
        raise RuntimeError(f"decimation left {_triangles(obj.data)} triangles, "
                           f"over tri_budget {budget}")
    coords = [v.co for v in obj.data.vertices]
    lo = tuple(min(c[i] for c in coords) for i in range(3))
    hi = tuple(max(c[i] for c in coords) for i in range(3))
    centre, factors, offset = fit(lo, hi, blender_size(spec["bounds"]), spec["origin"])
    for vert in obj.data.vertices:
        vert.co = tuple((vert.co[i] - centre[i]) * factors[i] + offset[i] for i in range(3))
    obj.data.update()
    return obj


def main(argv: list[str]) -> int:
    try:
        import bpy  # Blender's own module
    except ImportError:  # outside Blender: fail clearly, never half-run
        sys.stderr.write("normalise.py runs only inside Blender: "
                         "blender -b --python normalise.py -- --spec <json>\n")
        return 2
    try:
        spec = parse_spec(argv)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        normalise(bpy, spec)
        export(bpy, spec["output"])
    except SystemExit as exc:  # argparse
        return int(exc.code or 2)
    except Exception:  # noqa: BLE001 - any failure is a nonzero exit with its trace
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
