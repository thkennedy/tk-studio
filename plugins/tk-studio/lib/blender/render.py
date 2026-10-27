"""tk-studio render — the visual gate's Blender half (Story 34.7,
plans/34-7.md §Settled shape 6).

Runs only inside Blender, headless, on the host:

    <blender> -b --python <plugin>/lib/blender/render.py -- --spec <json>

The spec (written by `assets.py`) holds exactly `input, camera, bounds,
size, output`. This script resets Blender to an empty scene, imports the
`.glb` named by `input`, and renders it with the Workbench engine (flat
lighting, a single colour, no anti-aliasing, a transparent film) at `size`
x `size` from an orthographic camera at the manifest camera's `yaw` and
`pitch` (degrees) to the PNG `output` (RGBA, 8 bit). `assets.py` reads the
silhouette from its alpha.

The frame is set from the entry's `bounds`, never from the mesh, so the
greybox render and the candidate render of one entry share one frame: the
camera looks at the world origin and the orthographic scale is twice the
bounds' diagonal, which holds the box whatever the origin rule (every
corner lies within one diagonal of the origin). Yaw 0 looks from the front
(glTF +Z, Blender -Y); a positive pitch looks down.

The framing helpers import without Blender, so the lib suite tests them.
Run outside Blender the script exits 2 with a message naming the call.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import traceback

SPEC_KEYS = ("input", "camera", "bounds", "size", "output")


# ------------------------------------------------------------ pure helpers

def parse_spec(argv: list[str]) -> dict:
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser(prog="render.py")
    parser.add_argument("--spec", required=True)
    ns = parser.parse_args(args)
    with open(ns.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    missing = [k for k in SPEC_KEYS if k not in spec]
    if missing:
        raise ValueError("spec is missing " + ", ".join(missing))
    return spec


def diagonal(bounds: dict) -> float:
    return math.sqrt(sum(float(bounds[a]) ** 2 for a in ("x", "y", "z")))


def frame(bounds: dict, yaw: float, pitch: float) -> dict:
    """The camera for ``bounds`` at ``yaw``/``pitch`` degrees (Blender
    axes): ``{location, rotation, ortho_scale, clip_end}``."""
    diag = diagonal(bounds)
    distance = 2 * diag + 1.0
    y, p = math.radians(yaw), math.radians(pitch)
    direction = (math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))
    return {"location": tuple(distance * d for d in direction),
            "rotation": (math.pi / 2 - p, 0.0, y),
            "ortho_scale": 2 * diag,
            "clip_end": 2 * distance + 2 * diag}


# --------------------------------------------------------- the Blender part

def render(bpy, spec: dict) -> None:
    result = bpy.ops.import_scene.gltf(filepath=spec["input"])
    if "FINISHED" not in result:
        raise RuntimeError(f"import of {spec['input']} did not finish: {result}")
    scene = bpy.context.scene
    for obj in [o for o in scene.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(obj, do_unlink=True)
    cam = frame(spec["bounds"], float(spec["camera"]["yaw"]), float(spec["camera"]["pitch"]))
    data = bpy.data.cameras.new("tk-render")
    data.type = "ORTHO"
    data.ortho_scale = cam["ortho_scale"]
    data.clip_start = 0.001
    data.clip_end = cam["clip_end"]
    camera = bpy.data.objects.new("tk-render", data)
    camera.location = cam["location"]
    camera.rotation_euler = cam["rotation"]
    scene.collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "SINGLE"
    scene.display.render_aa = "OFF"
    scene.render.film_transparent = True
    size = int(spec["size"])
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = spec["output"]
    bpy.ops.render.render(write_still=True)


def main(argv: list[str]) -> int:
    try:
        import bpy  # Blender's own module
    except ImportError:  # outside Blender: fail clearly, never half-run
        sys.stderr.write("render.py runs only inside Blender: "
                         "blender -b --python render.py -- --spec <json>\n")
        return 2
    try:
        spec = parse_spec(argv)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        render(bpy, spec)
    except SystemExit as exc:  # argparse
        return int(exc.code or 2)
    except Exception:  # noqa: BLE001 - any failure is a nonzero exit with its trace
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
