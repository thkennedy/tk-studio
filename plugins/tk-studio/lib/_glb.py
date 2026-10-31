"""The GLB reader and the entry gate: the header and chunks, the node and mesh
walk, the facts and the bounds gate (Story 36.7, DW-87).

Split out of `assets.py`, which re-exports the names. A leaf but for
`_core.Refusal`. Stdlib-only (NFR9).
"""
from __future__ import annotations

import json
import math
import struct

from _core import Refusal

AXES = ("x", "y", "z")
BOUNDS_TOLERANCE = 0.01
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


_IDENTITY = ((1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0),
             (0.0, 0.0, 0.0, 1.0))


def _mat_mul(a, b):
    return tuple(tuple(sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4))
                 for r in range(4))


def _node_matrix(node: dict, where: str):
    """A node's local transform (row-major 4x4): its ``matrix`` (glTF's
    column-major 16 numbers), else ``T * R * S``."""
    if "matrix" in node:
        m = node["matrix"]
        if not isinstance(m, list) or len(m) != 16 or not all(_number(v) for v in m):
            raise Refusal(f"malformed GLB: {where} matrix is not sixteen numbers")
        return tuple(tuple(float(m[c * 4 + r]) for c in range(4)) for r in range(4))
    t = _vec3(node.get("translation", [0, 0, 0]), f"{where} translation")
    s = _vec3(node.get("scale", [1, 1, 1]), f"{where} scale")
    q = node.get("rotation", [0, 0, 0, 1])
    if not isinstance(q, list) or len(q) != 4 or not all(_number(v) for v in q):
        raise Refusal(f"malformed GLB: {where} rotation is not four numbers")
    x, y, z, w = (float(v) for v in q)
    rot = ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
           (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
           (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))
    return tuple(tuple(rot[r][c] * s[c] for c in range(3)) + (t[r],) for r in range(3)) \
        + ((0.0, 0.0, 0.0, 1.0),)


def _mesh_instances(doc: dict, mesh_count: int) -> list:
    """``[(mesh index, world matrix)]`` for every node that instances a
    mesh under the default scene (``scene``, else scene 0, else every root
    node), transforms composed down the tree (DW-74, plans/34-7.md §Settled
    shape 9). Empty when the file has no nodes."""
    nodes = doc.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return []
    for ni, node in enumerate(nodes):
        if not isinstance(node, dict):
            raise Refusal(f"malformed GLB: node {ni} is not an object")
        kids = node.get("children", [])
        if not isinstance(kids, list) or any(
                not isinstance(c, int) or isinstance(c, bool) for c in kids):
            raise Refusal(f"malformed GLB: node {ni} children is not a list of node indices")
    scenes = doc.get("scenes")
    roots = None
    if isinstance(scenes, list) and scenes:
        index = doc.get("scene", 0)
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(scenes):
            index = 0
        scene = scenes[index]
        roots = scene.get("nodes", []) if isinstance(scene, dict) else None
        if not isinstance(roots, list):
            raise Refusal(f"malformed GLB: scene {index} nodes is not a list")
    if roots is None:
        children = {c for node in nodes for c in node.get("children", [])}
        roots = [i for i in range(len(nodes)) if i not in children]
    out = []
    stack = [(r, _IDENTITY, ()) for r in reversed(roots)]
    while stack:
        ni, parent, path = stack.pop()
        if not isinstance(ni, int) or isinstance(ni, bool) or not 0 <= ni < len(nodes):
            raise Refusal(f"malformed GLB: a node reference names no node ({ni!r})")
        if ni in path:
            raise Refusal(f"malformed GLB: node {ni} is its own ancestor")
        node = nodes[ni]
        world = _mat_mul(parent, _node_matrix(node, f"node {ni}"))
        if "mesh" in node:
            mi = node["mesh"]
            if not isinstance(mi, int) or isinstance(mi, bool) or not 0 <= mi < mesh_count:
                raise Refusal(f"malformed GLB: node {ni} names no mesh ({mi!r})")
            out.append((mi, world))
        kids = node.get("children") or []
        if not isinstance(kids, list):
            raise Refusal(f"malformed GLB: node {ni} children is not a list")
        stack.extend((c, world, path + (ni,)) for c in reversed(kids))
    return out


def facts_of(data: bytes) -> dict:
    """The facts of one GLB: triangles, bounds, origin, uv, materials.
    Bounds are world bounds: every node instancing a mesh transforms that
    mesh's POSITION box corners, and its triangles count once per instance
    (DW-74); a file with no nodes (or none instancing a mesh) keeps the
    mesh-only reading."""
    doc, _binary = read_glb(data)
    meshes = doc.get("meshes")
    if not isinstance(meshes, list) or not meshes:
        raise Refusal("malformed GLB: no meshes")
    uv = False
    per_mesh = []
    for mi, mesh in enumerate(meshes):
        prims = mesh.get("primitives") if isinstance(mesh, dict) else None
        if not isinstance(prims, list) or not prims:
            raise Refusal(f"malformed GLB: mesh {mi} has no primitives")
        tris = 0
        mlo = [math.inf] * 3
        mhi = [-math.inf] * 3
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
            mlo = [min(a, b) for a, b in zip(mlo, pmin)]
            mhi = [max(a, b) for a, b in zip(mhi, pmax)]
            if "TEXCOORD_0" in attrs:
                uv = True
            count = (_accessor(doc, prim["indices"], f"{where} indices")["count"]
                     if "indices" in prim else pos["count"])
            mode = prim.get("mode", 4)
            if mode == 4:
                tris += count // 3
            elif mode in (5, 6):
                tris += max(0, count - 2)
        per_mesh.append((tris, mlo, mhi))
    instances = _mesh_instances(doc, len(meshes))
    triangles = 0
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    if not instances:
        for tris, mlo, mhi in per_mesh:
            triangles += tris
            lo = [min(a, b) for a, b in zip(lo, mlo)]
            hi = [max(a, b) for a, b in zip(hi, mhi)]
    for mi, world in instances:
        tris, mlo, mhi = per_mesh[mi]
        triangles += tris
        for corner in ((x, y, z) for x in (mlo[0], mhi[0]) for y in (mlo[1], mhi[1])
                       for z in (mlo[2], mhi[2])):
            p = [world[r][0] * corner[0] + world[r][1] * corner[1] + world[r][2] * corner[2]
                 + world[r][3] for r in range(3)]
            lo = [min(a, b) for a, b in zip(lo, p)]
            hi = [max(a, b) for a, b in zip(hi, p)]
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


def _number(value) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value))
