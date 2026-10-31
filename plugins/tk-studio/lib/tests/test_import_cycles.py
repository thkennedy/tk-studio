"""Story 36.7 (DW-85): the lib's module graph, pinned.

`build_graph` reads each `lib/*.py`'s top-level imports by AST (a lazy import
in a function runs after every module has loaded, so it closes no cycle at
load; `assets`/`playable` are also checked at every depth, the old cycle being
a lazy one). The non-trivial SCCs equal the allowlist exactly: a new cycle, or a
cut one left on the list, fails until the allowlist is edited knowingly.

Each module also imports alone in a child: `python -I` ignores `PYTHONPATH` and
the cwd, so the child puts `lib/` on `sys.path` itself.
"""
from __future__ import annotations

import ast
import subprocess
import sys
import unittest
from pathlib import Path

LIB = Path(__file__).resolve().parents[1]

# The stated residual (DW-85), exact.
ALLOWLIST = {frozenset({"inbox", "syncback"})}
NAMED = frozenset({"assets", "playable"})
LEAVES = ("_core", "_glb", "_png", "_proc")


def _imported(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Import):
        return [a.name.split(".")[0] for a in node.names]
    if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
        return [node.module.split(".")[0]]
    return []


def _top_level(tree: ast.Module) -> set[str]:
    """Imports that run at import time: anywhere but inside a function (a
    `try`, `if`, `with` or class body at module level still runs)."""
    out: set[str] = set()
    stack: list[ast.AST] = list(tree.body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        out.update(_imported(node))
        stack.extend(ast.iter_child_nodes(node))
    return out


def _any_depth(tree: ast.Module) -> set[str]:
    return {name for node in ast.walk(tree) for name in _imported(node)}


def build_graph(sources: dict[str, str], *, reader=_top_level) -> dict[str, set[str]]:
    """Module -> the lib modules it imports (a self-import is no edge)."""
    return {m: (reader(ast.parse(text)) & set(sources)) - {m} for m, text in sources.items()}


def sccs(graph: dict[str, set[str]]) -> set[frozenset[str]]:
    """The strongly connected components of more than one module (Tarjan)."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    stack: list[str] = []
    on: set[str] = set()
    out: set[frozenset[str]] = set()

    def visit(v: str) -> None:
        index[v] = low[v] = len(index)
        stack.append(v)
        on.add(v)
        for w in sorted(graph.get(v, ())):
            if w not in index:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            scc = set()
            while True:
                w = stack.pop()
                on.discard(w)
                scc.add(w)
                if w == v:
                    break
            if len(scc) > 1:
                out.add(frozenset(scc))

    for v in sorted(graph):
        if v not in index:
            visit(v)
    return out


def faults(graph: dict[str, set[str]], allowlist=frozenset(ALLOWLIST)) -> list[str]:
    """One line naming each fault; empty when the graph holds."""
    found = sccs(graph)
    out = []
    for scc in sorted(found, key=sorted):
        if NAMED <= scc:
            out.append(f"named cycle assets <-> playable is back, in the SCC {sorted(scc)}")
        elif scc not in allowlist:
            out.append(f"a new SCC {sorted(scc)}: cut it, or edit the allowlist knowingly")
    for scc in sorted(set(allowlist) - found, key=sorted):
        out.append(f"the allowlisted SCC {sorted(scc)} is gone: edit the allowlist")
    return out


def _sources() -> dict[str, str]:
    return {p.stem: p.read_text(encoding="utf-8") for p in sorted(LIB.glob("*.py"))}


class TheTree(unittest.TestCase):
    def test_no_named_cycle_and_the_sccs_equal_the_allowlist(self):
        self.assertEqual(faults(build_graph(_sources())), [])

    def test_assets_and_playable_never_import_each_other_at_any_depth(self):
        graph = build_graph(_sources(), reader=_any_depth)
        self.assertNotIn("playable", graph["assets"])
        self.assertNotIn("assets", graph["playable"])

    def test_they_share_the_proc_and_png_leaves(self):
        graph = build_graph(_sources())
        for module in NAMED:
            self.assertLessEqual({"_proc", "_png"}, graph[module], module)

    def test_the_leaves_are_leaves(self):
        graph = build_graph(_sources())
        self.assertEqual(graph["_core"], set())
        self.assertEqual(graph["_png"], set())
        self.assertEqual(graph["_proc"], set())
        self.assertEqual(graph["_glb"], {"_core"})

    def test_each_module_imports_alone(self):
        for path in sorted(LIB.glob("*.py")):
            code = f"import sys; sys.path.insert(0, {str(LIB)!r}); import {path.stem}"
            done = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True,
                                  text=True, encoding="utf-8", errors="replace",
                                  timeout=120, check=False)
            with self.subTest(module=path.stem):
                self.assertEqual(done.returncode, 0, f"{path.stem}: {done.stderr}")


class TheCheckItself(unittest.TestCase):
    def test_a_planted_back_edge_fails(self):
        graph = {"assets": {"playable"}, "playable": {"assets"}}
        self.assertEqual(faults(graph, frozenset()),
                         ["named cycle assets <-> playable is back, in the SCC ['assets', 'playable']"])

    def test_a_planted_back_edge_in_the_tree_fails(self):
        graph = build_graph(_sources())
        graph["playable"] = graph["playable"] | {"assets"}
        graph["assets"] = graph["assets"] | {"playable"}
        self.assertIn("assets <-> playable", "\n".join(faults(graph)))

    def test_a_lazy_import_is_no_top_level_edge_but_a_try_is(self):
        sources = {"a": "def f():\n    import b\n", "b": "try:\n    import a\nexcept ImportError:\n    pass\n"}
        self.assertEqual(build_graph(sources), {"a": set(), "b": {"a"}})
        self.assertEqual(build_graph(sources, reader=_any_depth), {"a": {"b"}, "b": {"a"}})

    def test_the_allowlist_is_exact(self):
        pair = {"a": {"b"}, "b": {"a"}}
        self.assertEqual(faults(pair, frozenset({frozenset("ab")})), [])
        self.assertIn("a new SCC", faults(pair, frozenset())[0])
        self.assertIn("is gone", faults({"a": set()}, frozenset({frozenset("ab")}))[0])


if __name__ == "__main__":
    unittest.main()
