"""tk-studio greybox — the Blender half of `assets.py greybox` (Story 34.6,
plans/34-6.md §Settled shape 3, 6 and 8).

Runs only inside Blender, headless, on the host:

    <blender> -b --python <plugin>/lib/blender/greybox.py -- --spec <json>

The spec (written by `assets.py`, the one source of the colour table) holds
exactly `name, category, colour, bounds, origin, collision, tri_budget,
label, output`. This script resets Blender to an empty scene, builds the
primitive chosen by `collision` (`box`, `none` and `mesh` a cube, `capsule`
a capsule, `sphere` a UV sphere) sized exactly to `bounds`, places the
origin per `origin`, gives it a flat material in `colour` whose base colour
is the `label` image, reduces the sphere's or capsule's segments until the
triangle count fits `tri_budget`, and exports one binary glTF to `output`
with fixed options (no copyright, no extras, Y up, modifiers applied, no
animation, lights or cameras), so the same spec gives the same bytes under
the same Blender version.

Axes: the manifest's bounds are glTF axes (Y up), so Blender X = bounds.x,
Blender Y (depth) = bounds.z and Blender Z (up) = bounds.y; the exporter's
Y-up conversion maps Blender (x, y, z) to glTF (x, z, -y). The mesh is built
in place with the object at the world origin (identity transform), so the
exported positions carry the origin rule.

The geometry (`geometry`, the segment choice, the UVs, the export option
selection) is plain Python above the Blender part, so the lib suite tests
it without Blender. Run outside Blender the script exits 2 with a message
naming the call; inside, it exits nonzero on any error (Blender passes
`sys.exit` through in `-b`).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import traceback

SPEC_KEYS = ("name", "category", "colour", "bounds", "origin", "collision", "tri_budget",
             "label", "output")
CUBE_COLLISIONS = ("box", "none", "mesh")
MAX_SEGMENTS = 32
MIN_SEGMENTS = 3

# The label's interior in UV space: the 256 px label has a 4 px black
# border; every UV stays at least 8 px inside the edge, so with Closest
# sampling no face shows the border band.
LABEL_PX = 256
UV_INSET = 8 / LABEL_PX

# The exporter's fixed options (ruling (e)). The core ones must be known to
# the running exporter or the export fails; the others are applied when
# known and reported as dropped when not (option names move between
# exporter versions: `export_animations` was `export_anim`).
EXPORT_OPTIONS = {
    "export_format": "GLB",
    "export_copyright": "",
    "export_extras": False,
    "export_yup": True,
    "export_apply": True,
    "export_animations": False,
    "export_anim": False,
    "export_skins": False,
    "export_morph": False,
    "export_lights": False,
    "export_cameras": False,
    "export_texcoords": True,
    "export_normals": True,
    "export_materials": "EXPORT",
    "export_image_format": "AUTO",
    "use_selection": False,
    "use_visible": False,
    "use_renderable": False,
}
CORE_EXPORT_OPTIONS = ("export_format", "export_yup", "export_apply")


# ------------------------------------------------------------ the geometry

def parse_spec(argv: list[str]) -> dict:
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(prog="greybox.py")
    parser.add_argument("--spec", required=True)
    ns = parser.parse_args(args)
    with open(ns.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    missing = [k for k in SPEC_KEYS if k not in spec]
    if missing:
        raise ValueError("spec is missing " + ", ".join(missing))
    return spec


def sphere_segments(budget: int) -> tuple[int, int]:
    """``(u, v)`` for a UV sphere of ``2u(v-1)`` triangles within budget."""
    for u in range(MAX_SEGMENTS, MIN_SEGMENTS - 1, -1):
        v = max(3, u // 2)
        if 2 * u * (v - 1) <= budget:
            return u, v
    return MIN_SEGMENTS, 3


def capsule_segments(budget: int) -> tuple[int, int]:
    """``(u, k)`` for a capsule of at most ``4uk`` triangles within budget
    (k rings per hemisphere)."""
    for u in range(MAX_SEGMENTS, MIN_SEGMENTS - 1, -1):
        k = max(1, u // 4)
        if 4 * u * k <= budget:
            return u, k
    return MIN_SEGMENTS, 1


def _cube(sx: float, sy: float, sz: float):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    verts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
             (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return verts, faces


def _sphere(sx: float, sy: float, sz: float, u: int, v: int):
    rx, ry, rz = sx / 2, sy / 2, sz / 2
    verts = [(0.0, 0.0, rz)]
    for ring in range(1, v):
        theta = math.pi * ring / v
        for seg in range(u):
            phi = 2 * math.pi * seg / u
            verts.append((rx * math.sin(theta) * math.cos(phi),
                          ry * math.sin(theta) * math.sin(phi), rz * math.cos(theta)))
    verts.append((0.0, 0.0, -rz))
    return verts, _ring_faces(len(verts) - 1, u, v - 1)


def _capsule(sx: float, sy: float, sz: float, u: int, k: int):
    """A capsule along Z: elliptic cross-section ``sx`` by ``sy``, total
    height ``sz``, caps of height ``min(sx, sy, sz) / 2``. When the height
    leaves no cylinder (``sz <= min(sx, sy)``) the two equator rings would
    coincide, so one ring stands for both (no zero-area faces)."""
    rx, ry = sx / 2, sy / 2
    cap = min(sx, sy, sz) / 2
    half = sz / 2 - cap
    verts = [(0.0, 0.0, sz / 2)]
    rings = [(math.pi / 2 * ring / k, half) for ring in range(1, k + 1)]  # pole to equator
    bottom_from = k if half > 1e-9 else k - 1
    rings += [(math.pi - math.pi / 2 * ring / k, -half) for ring in range(bottom_from, 0, -1)]
    for theta, shift in rings:
        for seg in range(u):
            phi = 2 * math.pi * seg / u
            verts.append((rx * math.sin(theta) * math.cos(phi),
                          ry * math.sin(theta) * math.sin(phi),
                          cap * math.cos(theta) + shift))
    verts.append((0.0, 0.0, -sz / 2))
    return verts, _ring_faces(len(verts) - 1, u, len(rings))


def _ring_faces(bottom: int, u: int, rings: int):
    """Pole fans and ring quads, wound counter-clockwise seen from outside
    (outward normals: Godot culls back faces)."""
    faces = [(0, 1 + s, 1 + (s + 1) % u) for s in range(u)]
    for r in range(rings - 1):
        a, b = 1 + r * u, 1 + (r + 1) * u
        for s in range(u):
            n = (s + 1) % u
            faces.append((a + s, b + s, b + n, a + n))
    last = 1 + (rings - 1) * u
    faces += [(bottom, last + (s + 1) % u, last + s) for s in range(u)]
    return faces


def _fit_extents(verts, size):
    """Map each axis's actual ``[min, max]`` onto ``[-s/2, s/2]``: a ring
    whose segments miss the axis (``u`` not a multiple of 4, an odd ring
    count) would otherwise leave the extent short of the bounds."""
    out = [list(v) for v in verts]
    for axis, s in enumerate(size):
        lo = min(v[axis] for v in verts)
        hi = max(v[axis] for v in verts)
        for v in out:
            v[axis] = (v[axis] - lo) / (hi - lo) * s - s / 2
    return [tuple(v) for v in out]


def _offset(origin: str, sx: float, sy: float, sz: float) -> tuple[float, float, float]:
    """The shift from a centred primitive to the origin rule (Blender axes;
    glTF z is Blender -y, so glTF's min corner is Blender's max y)."""
    if origin == "center":
        return 0.0, 0.0, 0.0
    if origin == "base-center":
        return 0.0, 0.0, sz / 2
    if origin == "base-min-corner":
        return sx / 2, -sy / 2, sz / 2
    raise ValueError(f"unknown origin {origin!r}")


def triangles(faces) -> int:
    return sum(len(f) - 2 for f in faces)


def face_uvs(verts, faces, size):
    """Box-projected UVs per face corner (centred ``verts``): each face is
    projected along its dominant normal axis onto the other two, scaled by
    the bounds into the label's interior ``[UV_INSET, 1 - UV_INSET]``. Every
    side face (Blender ±X, ±Y) shows the name upright and reading
    left-to-right to a viewer outside it: ``u`` runs along the viewer's
    right, ``(-n) x Z``, so the across coordinate is flipped (``u -> 1 - u``
    inside the inset span) on the +Y (back) and -X faces. Top and bottom
    keep x across, y up. Every face samples the category colour, never the
    border."""
    span = 1 - 2 * UV_INSET
    out = []
    for face in faces:
        pts = [verts[i] for i in face]
        n = [0.0, 0.0, 0.0]  # Newell's normal
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            n[0] += (p[1] - q[1]) * (p[2] + q[2])
            n[1] += (p[2] - q[2]) * (p[0] + q[0])
            n[2] += (p[0] - q[0]) * (p[1] + q[1])
        dominant = max(range(3), key=lambda a: (abs(n[a]), -a))
        across, up = {0: (1, 2), 1: (0, 2), 2: (0, 1)}[dominant]
        # the outward viewer's right is (-n) x Z = (-n_y, n_x, 0): along
        # -x on the +Y face and along -y on the -X face
        flip = (dominant == 0 and n[0] < 0) or (dominant == 1 and n[1] > 0)
        uvs = []
        for p in pts:
            t = p[across] / size[across] + 0.5
            uvs.append((UV_INSET + span * ((1 - t) if flip else t),
                        UV_INSET + span * (p[up] / size[up] + 0.5)))
        out.append(uvs)
    return out


def geometry(spec: dict):
    """``(verts, faces, uvs)`` in Blender axes for ``spec``: the primitive
    sized exactly to the bounds, the origin per the rule, triangles within
    ``tri_budget``; ``uvs`` per face corner."""
    bounds = spec["bounds"]
    # Blender axes from glTF's Y-up bounds
    size = (float(bounds["x"]), float(bounds["z"]), float(bounds["y"]))
    budget = int(spec["tri_budget"])
    collision = spec["collision"]
    if collision in CUBE_COLLISIONS:
        verts, faces = _cube(*size)
    elif collision == "sphere":
        verts, faces = _sphere(*size, *sphere_segments(budget))
    elif collision == "capsule":
        verts, faces = _capsule(*size, *capsule_segments(budget))
    else:
        raise ValueError(f"unknown collision {collision!r}")
    if triangles(faces) > budget:
        raise ValueError(f"{collision} greybox needs {triangles(faces)} triangles, "
                         f"over tri_budget {budget}")
    verts = _fit_extents(verts, size)
    uvs = face_uvs(verts, faces, size)
    ox, oy, oz = _offset(spec["origin"], *size)
    verts = [(x + ox, y + oy, z + oz) for x, y, z in verts]
    return verts, faces, uvs


def select_export_options(known) -> tuple[dict, list[str], list[str]]:
    """``(options, applied, dropped)`` for an exporter that knows the
    option names ``known``; a ValueError when a core option is unknown."""
    known = set(known)
    missing = [k for k in CORE_EXPORT_OPTIONS if k not in known]
    if missing:
        raise ValueError("the glTF exporter does not know the core option(s) "
                         + ", ".join(missing))
    options = {k: v for k, v in EXPORT_OPTIONS.items() if k in known}
    dropped = [k for k in EXPORT_OPTIONS if k not in known]
    return options, list(options), dropped


def _colour(hexcode: str) -> tuple[float, float, float, float]:
    """``#rrggbb`` as linear RGBA (Blender's colour sockets are linear)."""
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    rgb = [int(hexcode[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return (lin(rgb[0]), lin(rgb[1]), lin(rgb[2]), 1.0)


# --------------------------------------------------------- the Blender part

def build(bpy, spec: dict):
    verts, faces, uvs = geometry(spec)
    name = spec["name"]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = False
    layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for corner, loop_index in enumerate(poly.loop_indices):
            layer.data[loop_index].uv = uvs[poly.index][corner]

    material = bpy.data.materials.new(name=f"{name}-greybox")
    material.diffuse_color = _colour(spec["colour"])
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = _colour(spec["colour"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    image = bpy.data.images.load(spec["label"], check_existing=False)
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Closest"
    material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mesh.materials.append(material)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def export(bpy, output: str) -> None:
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    options, applied, dropped = select_export_options(known)
    sys.stderr.write("greybox: export options applied: " + ", ".join(applied) + "\n")
    sys.stderr.write("greybox: export options dropped (unknown to this exporter): "
                     + (", ".join(dropped) or "none") + "\n")
    result = bpy.ops.export_scene.gltf(filepath=output, **options)
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export did not finish: {result}")


def main(argv: list[str]) -> int:
    try:
        import bpy  # Blender's own module
    except ImportError:  # outside Blender: fail clearly, never half-run
        sys.stderr.write("greybox.py runs only inside Blender: "
                         "blender -b --python greybox.py -- --spec <json>\n")
        return 2
    try:
        spec = parse_spec(argv)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        build(bpy, spec)
        export(bpy, spec["output"])
    except SystemExit as exc:  # argparse
        return int(exc.code or 2)
    except Exception:  # noqa: BLE001 - any failure is a nonzero exit with its trace
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
