"""No host-suite test pins the exact state of a live planning artifact (Story 36.4, DW-111, hole 96).

The planner rewrites what lives under `_bmad-output` story by story: a lib test that
pinned the live epic-35 SPEC's design-note set exactly turned the host leg red on the
loop's own planner. Shape tests read fixtures; a real-artifact test asserts only what
cannot change (the count of `caps`, a subscript against a scalar constant).

Two sweeps: an AST sweep over `lib/tests/*.py`, and a textual one over the supervisor's
`test/*.ts` (stdlib has no TypeScript parser), which needs only to catch a test joining
the real repo root to `_bmad-output` and asserting equality. Temp roots are not flagged.
"""
from __future__ import annotations

import ast
import re
import tempfile
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
REPO_ROOT = TESTS.parents[3]
SUPERVISOR_TESTS = REPO_ROOT / "apps" / "supervisor" / "test"

# How many steps above a `lib/tests/*.py` file a path sits: tests, lib, tk-studio, plugins, the checkout.
ROOT_LEVEL = 5
KNOWN_LEVELS = {"REPO": ROOT_LEVEL, "REPO_ROOT": ROOT_LEVEL, "PLUGIN_ROOT": 3}
ALWAYS_EXACT = {"assertSetEqual", "assertCountEqual", "assertListEqual", "assertDictEqual", "assertSequenceEqual",
                "assertTupleEqual"}
ALLOWED_COUNT_KEYS = {"caps"}  # the only counts that cannot change: a planner-rewritten set's count moves with its next note
WHOLE_VALUE_CALLS = {"set", "frozenset", "sorted", "list", "tuple", "dict"}
LITERAL_COLLECTIONS = (ast.Set, ast.List, ast.Dict, ast.Tuple)
ARTIFACTS = "_bmad-output"
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)
TS_UP = r'import\.meta\.dir(?:name)?(?:\s*,\s*["\']?(?:\.\./?)+["\']?)+'
TS_ROOT_JOIN = re.compile(rf"(?:join|resolve)\(\s*({TS_UP})\s*,?[^;)]*?{ARTIFACTS}")
TS_ROOT_TEMPLATE = re.compile(rf"`\$\{{\s*import\.meta\.dir(?:name)?\s*\}}/((?:\.\./)+)[^`]*?{ARTIFACTS}")
TS_BIND = r"(?:const|let|var)\s+(\w+)(?:\s*:\s*\w+)?\s*=\s*"
TS_ROOT_ALIAS = re.compile(rf"{TS_BIND}(?:join|resolve)\(\s*({TS_UP})\s*,?\s*\)")
TS_TEMPLATE_ALIAS = re.compile(rf"{TS_BIND}`\$\{{\s*import\.meta\.dir(?:name)?\s*\}}/((?:\.\./?)+)`")
TS_EXACT = re.compile(r"\.(?:toEqual|toStrictEqual)\(")


class _Scope:
    """What one piece of code sees: its class (for `self.x`), and the keys its own bare names resolve to."""

    def __init__(self, reach: "_Reach", klass: str | None = None, func: str | None = None, bound: set[str] = frozenset()):
        self.reach, self.klass, self.func, self.bound = reach, klass, func, bound

    def keys(self, node: ast.AST) -> list[str]:
        """The keys `node` may be stored under: a local, a class attribute (bases too), a module name."""
        if isinstance(node, ast.Name):
            if node.id in self.bound:
                return [f"{self.func}:{node.id}"]
            return [f"{owner}.{node.id}" for owner in self.reach.lineage(self.klass)] + [node.id]
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            owner = node.value.id
            if owner in ("self", "cls"):
                return [f"{c}.{node.attr}" for c in self.reach.lineage(self.klass)]
            if owner in self.reach.classes and owner not in self.bound:
                return [f"{c}.{node.attr}" for c in self.reach.lineage(owner)]
        return []

    def store_key(self, target: ast.AST) -> str | None:
        if isinstance(target, ast.Name):
            if self.func:
                return f"{self.func}:{target.id}"
            return f"{self.klass}.{target.id}" if self.klass else target.id
        keys = self.keys(target)
        return keys[0] if keys else None


class _Reach:
    """Which names, attributes and functions in one test file reach the live `_bmad-output`.

    One flat table per file, iterated to a fixed point, so an alias, a chained constant, a
    helper's return or a `setUp` attribute reads the same in any order. A level only rises,
    capped at the root, so the iteration ends."""

    def __init__(self, tree: ast.Module):
        self.tree = tree
        self.classes = {n.name: n for n in tree.body if isinstance(n, ast.ClassDef)}
        self.levels = dict(KNOWN_LEVELS)
        self.live: set[str] = set()
        self.changed = True
        while self.changed:
            self.changed = False
            self._sweep()

    def lineage(self, klass: str | None) -> list[str]:
        """`klass` and its bases in this file."""
        found: list[str] = []
        stack = [klass] if klass in self.classes else []
        while stack:
            name = stack.pop()
            if name not in found:
                found.append(name)
                stack += [b.id for b in self.classes[name].bases if isinstance(b, ast.Name) and b.id in self.classes]
        return found

    def _set_level(self, key: str, level: int) -> None:
        level = min(level, ROOT_LEVEL)
        if key not in self.levels or level > self.levels[key]:
            self.levels[key] = level
            self.changed = True

    def _set_live(self, key: str) -> None:
        if key not in self.live:
            self.live.add(key)
            self.changed = True

    def _assign(self, stmt: ast.AST, scope: _Scope) -> None:
        if not isinstance(stmt, (ast.Assign, ast.AnnAssign)) or stmt.value is None:
            return
        level, live = self.level(stmt.value, scope), self.is_live(stmt.value, scope)
        for target in (stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]):
            key = scope.store_key(target)
            if key is not None and level is not None:
                self._set_level(key, level)
            if key is not None and live:
                self._set_live(key)

    def _body(self, nodes: list[ast.stmt], scope: _Scope, klass: str | None) -> None:
        """The statements of a module or class body, its `if`/`try` blocks included, then its functions."""
        stack = list(nodes)
        while stack:
            stmt = stack.pop()
            if isinstance(stmt, FUNCTIONS):
                self._function(stmt, klass)
            elif not isinstance(stmt, ast.ClassDef):
                self._assign(stmt, scope)
                stack += [c for c in ast.iter_child_nodes(stmt) if isinstance(c, (ast.stmt, ast.ExceptHandler))]

    def _function(self, func: ast.AST, klass: str | None) -> None:
        name = f"{klass}.{func.name}" if klass else func.name
        scope = self.function_scope(func, klass)
        for sub in ast.walk(func):
            self._assign(sub, scope)
            if isinstance(sub, ast.Return) and sub.value is not None:
                level = self.level(sub.value, scope)
                if level is not None:
                    self._set_level(name, level)
        if any(self.is_live(stmt, scope) for stmt in func.body):
            self._set_live(name)

    def _sweep(self) -> None:
        self._body(self.tree.body, _Scope(self), None)
        for klass, node in self.classes.items():
            self._body(node.body, _Scope(self, klass), klass)

    def function_scope(self, func: ast.AST, klass: str | None) -> _Scope:
        bound = {a.arg for a in ast.walk(func.args) if isinstance(a, ast.arg)}
        bound |= {n.id for n in ast.walk(func) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
        return _Scope(self, klass, f"{klass}.{func.name}" if klass else func.name, bound)

    def level(self, node: ast.AST, scope: _Scope) -> int | None:
        """Steps above the test file `node` sits, None when it is not known to be such a path."""
        if isinstance(node, ast.Name) and node.id == "__file__":
            return 0
        if isinstance(node, ast.Attribute) and node.attr == "parent":
            return (self.level(node.value, scope) or 0) + 1
        if (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute) and node.value.attr == "parents"
                and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, int)):
            return (self.level(node.value.value, scope) or 0) + node.slice.value + 1
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
            base = self.level(node.left, scope)
            if base is None or not (isinstance(node.right, ast.Constant) and isinstance(node.right.value, str)):
                return None
            parts = [p for p in node.right.value.split("/") if p not in ("", ".")]
            return base + sum(1 if p == ".." else -1 for p in parts)
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr in ("resolve", "absolute"):
                return self.level(func.value, scope)
            dotted = ast.unparse(func)
            if dotted in ("Path", "pathlib.Path") and len(node.args) == 1:
                return self.level(node.args[0], scope)
            if dotted in ("os.path.abspath", "os.path.realpath") and node.args:
                return self.level(node.args[0], scope)
            if dotted == "os.path.dirname" and node.args:
                inner = self.level(node.args[0], scope)
                return None if inner is None else inner + 1
            return self.level(func, scope)  # a helper's return
        for key in scope.keys(node):
            if key in self.levels:
                return self.levels[key]
        return None

    def _reaches_root(self, node: ast.AST, scope: _Scope) -> bool:
        return any((self.level(sub, scope) or 0) >= ROOT_LEVEL for sub in ast.walk(node))

    def is_live(self, node: ast.AST, scope: _Scope) -> bool:
        for sub in ast.walk(node):
            if any(key in self.live for key in scope.keys(sub)):
                return True
            # one expression joining the root and `_bmad-output`: a test that merely passes the root beside a
            # temp root's artifact does not reach the live tree
            if _is_join(sub) and _names_artifacts(sub) and self._reaches_root(sub, scope):
                return True
        return False


def _names_artifacts(node: ast.AST) -> bool:
    return any(isinstance(sub, ast.Constant) and isinstance(sub.value, str) and ARTIFACTS in sub.value
               for sub in ast.walk(node))


def _is_join(node: ast.AST) -> bool:
    if isinstance(node, ast.BinOp):
        return isinstance(node.op, (ast.Div, ast.Add))
    if isinstance(node, ast.Call):
        return ast.unparse(node.func).rpartition(".")[2] in ("joinpath", "join", "Path", "glob", "rglob")
    return isinstance(node, ast.JoinedStr)


def _is_whole_value(node: ast.expr) -> bool:
    """A whole collection: a literal, a comprehension or a collection built from the artifact."""
    if isinstance(node, (ast.Set, ast.List, ast.Dict, ast.Tuple, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
        return True
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in WHOLE_VALUE_CALLS


def _bare_name(node: ast.expr) -> str | None:
    return node.id if isinstance(node, ast.Name) else node.attr if isinstance(node, ast.Attribute) else None


def _is_len(node: ast.expr) -> bool:
    """`len(...)` of anything: whether the count may be read is `_is_allowed_count`'s call."""
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "len"


def _is_allowed_count(node: ast.expr) -> bool:
    """`len(parsed["caps"])`: a plain subscript whose constant key is in `ALLOWED_COUNT_KEYS`, the matrix's allowed read."""
    if not (_is_len(node) and len(node.args) == 1 and isinstance(node.args[0], ast.Subscript)):
        return False
    subscript = node.args[0]
    return (isinstance(subscript.value, ast.Name) and isinstance(subscript.slice, ast.Constant)
            and subscript.slice.value in ALLOWED_COUNT_KEYS)


def _exact_pair(left: ast.expr, right: ast.expr, whole_names: set[str]) -> bool:
    sides = (left, right)
    # first: an allowed count compared with a collection can never pass, so it fails on its own; any other reads as exact
    counts = [side for side in sides if _is_len(side)]
    if counts:
        return not all(_is_allowed_count(side) for side in counts)
    if any(_is_whole_value(side) or _bare_name(side) in whole_names for side in sides):
        return True
    # a subscript is allowed against a constant not known to hold a collection (a scalar, a string)
    if any(isinstance(side, ast.Subscript) for side in sides):
        return False
    return any((_bare_name(side) or "").isupper() for side in sides)


def _is_exact_compare(node: ast.AST, whole_names: set[str], op: type[ast.cmpop] = ast.Eq) -> bool:
    return (isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], op)
            and _exact_pair(node.left, node.comparators[0], whole_names))


def _has_exact_compare(test: ast.expr, whole_names: set[str], op: type[ast.cmpop] = ast.Eq) -> bool:
    return any(_is_exact_compare(sub, whole_names, op) for sub in ast.walk(test))


def _is_exact_difference(node: ast.AST, whole_names: set[str], literal_names: set[str]) -> bool:
    """`x ^ {...}` in either order, empty only when the sets match, and `x - {...}`, which a new member of `x` turns
    red. `want - x`, with a literal or a name bound only to a literal on the left, is a subset check that stays green
    as `x` grows; a name bound from `set(...)` or `sorted(...)` holds the artifact, so it exempts nothing."""
    if not isinstance(node, ast.BinOp) or not _exact_pair(node.left, node.right, whole_names):
        return False
    if isinstance(node.op, ast.BitXor):
        return True
    return isinstance(node.op, ast.Sub) and not (
        isinstance(node.left, LITERAL_COLLECTIONS) or (isinstance(node.left, ast.Name) and node.left.id in literal_names))


def _has_exact_difference(test: ast.expr, whole_names: set[str], literal_names: set[str]) -> bool:
    return any(_is_exact_difference(sub, whole_names, literal_names) for sub in ast.walk(test))


def _has_negated_exact(test: ast.expr, whole_names: set[str], literal_names: set[str]) -> bool:
    """`not x ^ {...}` and `not x != {...}`: a bare `assert x ^ {...}` or `assert x != {...}` passes when the sets
    differ, so only the negation pins them."""
    return any(isinstance(sub, ast.UnaryOp) and isinstance(sub.op, ast.Not)
               and (_is_exact_difference(sub.operand, whole_names, literal_names)
                    or _is_exact_compare(sub.operand, whole_names, ast.NotEq))
               for sub in ast.walk(test))


def _is_exact_assert(node: ast.AST, whole_names: set[str], literal_names: set[str]) -> bool:
    if isinstance(node, ast.Assert):
        return _has_exact_compare(node.test, whole_names) or _has_negated_exact(node.test, whole_names, literal_names)
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
        return False
    method = node.func.attr
    if method in ALWAYS_EXACT:
        return True
    if method == "assertTrue":
        return bool(node.args) and _has_exact_compare(node.args[0], whole_names)
    if method == "assertFalse":
        return bool(node.args) and (_has_exact_difference(node.args[0], whole_names, literal_names)
                                    or _has_exact_compare(node.args[0], whole_names, ast.NotEq))
    return method == "assertEqual" and len(node.args) >= 2 and _exact_pair(node.args[0], node.args[1], whole_names)


def _whole_names(nodes) -> set[str]:
    """Names assigned a whole collection: `want = {"CAP-1"}` reads as the literal it holds."""
    names = set()
    for node in nodes:
        if isinstance(node, ast.Assign) and _is_whole_value(node.value):
            names |= {target.id for target in node.targets if isinstance(target, ast.Name)}
        elif (isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
              and node.value is not None and _is_whole_value(node.value)):
            names.add(node.target.id)
    return names


def _stores(nodes) -> set[str]:
    """Every name the statements in `nodes` bind, however: an assignment, `|=`, a loop, a `with`, an unpacking."""
    return {sub.id for node in nodes for sub in ast.walk(node) if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store)}


def _literal_names(nodes) -> set[str]:
    """Names in `nodes`, one scope's statements, bound to a literal collection and to nothing else."""
    nodes = list(nodes)
    literal_targets = []
    for node in nodes:
        for sub in ast.walk(node):
            if isinstance(sub, (ast.Assign, ast.AnnAssign)) and isinstance(sub.value, LITERAL_COLLECTIONS):
                targets = sub.targets if isinstance(sub, ast.Assign) else [sub.target]
                literal_targets += [target for target in targets if isinstance(target, ast.Name)]
    other = {sub.id for node in nodes for sub in ast.walk(node) if isinstance(sub, ast.Name)
             and isinstance(sub.ctx, ast.Store) and not any(sub is target for target in literal_targets)}
    return {target.id for target in literal_targets} - other


def _function_literal_names(func: ast.AST, module_names: set[str]) -> set[str]:
    """What a function's names hold: its own literals, and the module's unless it rebinds the name or takes it as an argument."""
    shadowed = _stores(func.body) | {arg.arg for arg in ast.walk(func.args) if isinstance(arg, ast.arg)}
    return _literal_names(func.body) | (module_names - shadowed)


def _functions(tree: ast.Module):
    """`(<label>, <class or None>, <function>)` for every test, helper and fixture method."""
    for node in tree.body:
        if isinstance(node, FUNCTIONS):
            yield node.name, None, node
        elif isinstance(node, ast.ClassDef):
            for member in node.body:
                if isinstance(member, FUNCTIONS):
                    yield f"{node.name}.{member.name}", node.name, member


def live_functions(source: str) -> list[str]:
    """The functions of one test file that reach a live artifact."""
    tree = ast.parse(source)
    reach = _Reach(tree)
    return [label for label, _, _ in _functions(tree) if label in reach.live]


def pins_in_python(source: str, label: str) -> list[str]:
    """`<label>::<test>:<line>` for each exact-state assertion in a function that reaches a live artifact."""
    if ARTIFACTS not in source:
        return []
    tree = ast.parse(source)
    reach = _Reach(tree)
    module_names = _whole_names(tree.body)
    module_literals = _literal_names([stmt for stmt in tree.body if not isinstance(stmt, (*FUNCTIONS, ast.ClassDef))])
    found = []
    for name, _, func in _functions(tree):
        if name in reach.live:
            whole = module_names | _whole_names(ast.walk(func))
            literal = _function_literal_names(func, module_literals)
            found += [f"{label}::{name}:{sub.lineno}" for sub in ast.walk(func) if _is_exact_assert(sub, whole, literal)]
    return found


def _ts_root_aliases(source: str) -> set[str]:
    """Every name bound to the repo root, aliases of aliases included, to a fixed point."""
    aliases = {m.group(1) for pattern in (TS_ROOT_ALIAS, TS_TEMPLATE_ALIAS) for m in pattern.finditer(source)
               if m.group(2).count("..") >= 3}
    while aliases:
        known = "|".join(sorted(aliases))
        more = set(re.findall(rf"{TS_BIND}(?:(?:join|resolve)\(\s*)?(?:{known})\b\s*\)?\s*(?:;|$)", source, re.M)) - aliases
        if not more:
            break
        aliases |= more
    return aliases


def pins_in_typescript(source: str, label: str) -> list[str]:
    """`<label>` when a file joins the real repo root to `_bmad-output` and asserts equality."""
    if not TS_EXACT.search(source):
        return []
    if any(m.group(1).count("..") >= 3 for m in TS_ROOT_JOIN.finditer(source)):
        return [label]
    if any(m.group(1).count("..") >= 3 for m in TS_ROOT_TEMPLATE.finditer(source)):
        return [label]
    aliases = _ts_root_aliases(source)
    if not aliases:
        return []
    known = "|".join(sorted(aliases))
    through = re.compile(rf"(?:join|resolve)\(\s*(?:{known})\s*,[^;)]*?{ARTIFACTS}|`\$\{{\s*(?:{known})\s*\}}[^`]*?{ARTIFACTS}")
    return [label] if through.search(source) else []


def live_pins() -> list[str]:
    found: list[str] = []
    for path in sorted(TESTS.glob("*.py")):
        found += pins_in_python(path.read_text(encoding="utf-8"), path.name)
    if SUPERVISOR_TESTS.is_dir():
        for path in sorted(SUPERVISOR_TESTS.glob("*.ts")):
            found += pins_in_typescript(path.read_text(encoding="utf-8"), f"apps/supervisor/test/{path.name}")
    return found


PLANTED_LIB = '''
import unittest
from pathlib import Path

class Pinned(unittest.TestCase):
    def test_pins_the_notes(self):
        repo = Path(__file__).resolve().parents[4]
        spec = repo / "_bmad-output" / "specs" / "spec-epic-35" / "SPEC.md"
        self.assertEqual(set(read(spec)["noted_caps"]), {"CAP-1", "CAP-2"})
'''

PLANTED_LIB_ALIAS = '''
from pathlib import Path
SPEC = Path(__file__).resolve().parents[4] / "_bmad-output/specs/spec-epic-35/SPEC.md"

def test_pins_through_a_module_name():
    assertions.assertCountEqual(sorted(read(SPEC)), ["CAP-1"])
'''

ALLOWED_LIB = '''
from pathlib import Path

def test_only_what_cannot_change(self):
    repo = Path(__file__).resolve().parents[4]
    parsed = read(repo / "_bmad-output" / "specs" / "spec-epic-35" / "SPEC.md")
    self.assertEqual(len(parsed["caps"]), 18)
    self.assertEqual(parsed["caps"]["CAP-3"], "35-2")
    self.assertEqual(len(parsed["caps"]), {34: 16, 35: 18}[35])
'''

TEMP_ROOT_LIB = '''
def test_a_temp_root(self):
    spec = self.tmp / "_bmad-output" / "specs" / "SPEC.md"
    self.assertEqual(set(read(spec)), {"CAP-1"})
'''

REPO_PASSED_BESIDE_A_TEMP_ROOT = '''
def test_the_repo_root_only_runs_a_hook(self):
    spec = self.tmp / "_bmad-output" / "specs" / "SPEC.md"
    run({"TK_STUDIO_ROOT": str(REPO_ROOT)})
    self.assertEqual(set(read(spec)), {"CAP-1"})
'''

PLANTED_REACHES = {
    "plugin_root_parents": '''
def test_it(self):
    self.assertEqual(set(read(PLUGIN_ROOT.parents[1] / "_bmad-output" / "SPEC.md")), {"CAP-1"})
''',
    "alias_of_plugin_root_to_a_fixed_point": '''
ROOT = PLUGIN
PLUGIN = PLUGIN_ROOT
TOP = ROOT.parents[1]
LIVE = TOP / "_bmad-output"

def test_it(self):
    self.assertEqual(set(read(LIVE)), {"CAP-1"})
''',
    "parent_chain": '''
def test_it(self):
    top = Path(__file__).resolve().parent.parent.parent.parent.parent
    self.assertEqual(set(read(top / "_bmad-output")), {"CAP-1"})
''',
    "plugin_root_parent_chain": '''
def test_it(self):
    self.assertEqual(set(read(PLUGIN_ROOT.parent.parent / "_bmad-output")), {"CAP-1"})
''',
    "module_helper": '''
def _spec():
    return REPO_ROOT / "_bmad-output" / "SPEC.md"

def test_it(self):
    self.assertEqual(set(read(_spec())), {"CAP-1"})
''',
    "helper_returning_the_root": '''
def _top():
    return Path(__file__).resolve().parents[4]

def test_it(self):
    self.assertEqual(set(read(_top() / "_bmad-output")), {"CAP-1"})
''',
    "method_helper": '''
class T(unittest.TestCase):
    def _spec(self):
        return REPO_ROOT / "_bmad-output" / "SPEC.md"

    def test_it(self):
        self.assertEqual(set(read(self._spec())), {"CAP-1"})
''',
    "setup_attribute": '''
class T(unittest.TestCase):
    def setUp(self):
        self.spec = REPO_ROOT / "_bmad-output" / "SPEC.md"

    def test_it(self):
        self.assertEqual(set(read(self.spec)), {"CAP-1"})
''',
    "setup_root_attribute": '''
class T(unittest.TestCase):
    def setUp(self):
        self.top = PLUGIN_ROOT.parents[1]

    def test_it(self):
        self.assertEqual(set(read(self.top / "_bmad-output")), {"CAP-1"})
''',
    "class_attribute": '''
class T(unittest.TestCase):
    SPEC = REPO_ROOT / "_bmad-output" / "SPEC.md"

    def test_it(self):
        self.assertEqual(set(read(self.SPEC)), {"CAP-1"})
''',
    "class_attribute_on_a_base": '''
class Base(unittest.TestCase):
    SPEC = REPO_ROOT / "_bmad-output" / "SPEC.md"

class T(Base):
    def test_it(self):
        self.assertEqual(set(read(self.SPEC)), {"CAP-1"})
''',
    "annotated_constant": '''
SPEC: Path = REPO_ROOT / "_bmad-output" / "SPEC.md"

def test_it(self):
    self.assertEqual(set(read(SPEC)), {"CAP-1"})
''',
    "chained_constant": '''
SPECS = REPO_ROOT / "_bmad-output" / "specs"
SPEC = SPECS / name

def test_it(self):
    self.assertEqual(set(read(SPEC)), {"CAP-1"})
''',
    "glob": '''
def test_it(self):
    for spec in REPO_ROOT.glob("_bmad-output/specs/*/SPEC.md"):
        self.assertEqual(set(read(spec)), {"CAP-1"})
''',
    "rglob": '''
def test_it(self):
    for spec in REPO_ROOT.rglob("_bmad-output/SPEC.md"):
        self.assertEqual(set(read(spec)), {"CAP-1"})
''',
}

PLANTED_EXACT = {
    "assertSetEqual": 'self.assertSetEqual(read(spec), other)',
    "assertCountEqual": 'self.assertCountEqual(read(spec), other)',
    "assertListEqual": 'self.assertListEqual(read(spec), other)',
    "assertDictEqual": 'self.assertDictEqual(read(spec), other)',
    "named_constant": 'self.assertEqual(read(spec), EXPECTED)',
    "named_constant_first": 'self.assertEqual(EXPECTED, read(spec))',
    "class_constant": 'self.assertEqual(read(spec), self.EXPECTED)',
    "local_name_for_a_literal": 'want = {"CAP-1"}\n    self.assertEqual(read(spec), want)',
    "tuple_literal": 'self.assertEqual(read(spec), ("CAP-1", "CAP-2"))',
    "list_comprehension": 'self.assertEqual(read(spec), [c for c in caps])',
    "set_comprehension": 'self.assertEqual({c for c in read(spec)}, other)',
    "dict_comprehension": 'self.assertEqual(read(spec), {c: 1 for c in caps})',
    "plain_assert": 'assert set(read(spec)) == {"CAP-1"}',
    "plain_assert_sorted": 'assert sorted(read(spec)) == ["CAP-1"]',
    "subscript_against_a_local_collection": 'want = {"CAP-1"}\n    self.assertEqual(parsed["noted_caps"], want)',
    "local_collection_against_a_subscript": 'want = {"CAP-1"}\n    self.assertEqual(want, parsed["noted_caps"])',
    "plain_assert_subscript_against_a_collection": 'want = {"CAP-1"}\n    assert parsed["noted_caps"] == want',
    "annotated_local_collection": 'want: set[str] = {"CAP-1"}\n    self.assertEqual(read(spec), want)',
    "annotated_local_against_a_subscript": 'want: set[str] = {"CAP-1"}\n    self.assertEqual(parsed["noted_caps"], want)',
    "assertTrue_equality": 'self.assertTrue(set(read(spec)) == {"CAP-1"})',
    "assertTrue_equality_against_a_name": 'want = {"CAP-1"}\n    self.assertTrue(parsed["noted_caps"] == want)',
    "assertFalse_symmetric_difference": 'self.assertFalse(set(read(spec)) ^ {"CAP-1"})',
    "assertFalse_difference": 'self.assertFalse(set(read(spec)) - {"CAP-1"})',
    # a count of a set the planner rewrites changes with the next note
    "count_of_a_rewritten_set": 'self.assertEqual(len(parsed["noted_caps"]), 6)',
    "count_of_a_rewritten_set_first": 'self.assertEqual(6, len(parsed["noted_caps"]))',
    "plain_assert_count_of_a_rewritten_set": 'assert len(parsed["noted_caps"]) == 6',
    "count_of_a_symmetric_difference": 'self.assertEqual(len(set(read(spec)) ^ {"CAP-1"}), 0)',
    "plain_assert_count_of_a_symmetric_difference": 'assert len(set(read(spec)) ^ {"CAP-1"}) == 0',
    "count_of_a_computed_key": 'self.assertEqual(len(parsed[key]), 6)',
    "count_of_a_nested_key": 'self.assertEqual(len(parsed["notes"]["caps"]), 6)',
    "count_of_caps_against_a_count_of_notes": 'self.assertEqual(len(parsed["caps"]), len(parsed["noted_caps"]))',
    "count_of_a_read": 'self.assertEqual(len(read(spec)), 6)',
    "assertFalse_difference_over_a_subscript": 'self.assertFalse(set(parsed["noted_caps"]) - {"CAP-1"})',
    "assertFalse_symmetric_difference_literal_first": 'self.assertFalse({"CAP-1"} ^ set(parsed["noted_caps"]))',
    "assertFalse_symmetric_difference_name_first": 'want = {"CAP-1"}\n    self.assertFalse(want ^ set(parsed["noted_caps"]))',
    "assertSequenceEqual": 'self.assertSequenceEqual(read(spec), other)',
    "assertTupleEqual": 'self.assertTupleEqual(read(spec), other)',
    "assertFalse_not_equal": 'self.assertFalse(set(parsed["noted_caps"]) != {"CAP-1"})',
    "assertFalse_not_equal_against_a_name": 'want = {"CAP-1"}\n    self.assertFalse(parsed["noted_caps"] != want)',
    "plain_assert_not_symmetric_difference": 'assert not set(parsed["noted_caps"]) ^ {"CAP-1"}',
    "plain_assert_not_difference": 'assert not set(parsed["noted_caps"]) - {"CAP-1"}',
    # `A - B` is a subset check only when `A` is known to be a literal: one read from the artifact is an upper bound
    "assertFalse_name_from_set_minus_a_literal": 'have = set(parsed["noted_caps"])\n    self.assertFalse(have - {"CAP-1"})',
    "assertFalse_name_from_sorted_minus_a_literal": 'have = sorted(parsed["noted_caps"])\n    self.assertFalse(have - {"CAP-1"})',
    "assertFalse_name_from_set_minus_a_literal_name": 'have = set(parsed["noted_caps"])\n    want = {"CAP-1"}\n    self.assertFalse(have - want)',
    "plain_assert_not_name_from_set_minus_a_literal": 'have = set(parsed["noted_caps"])\n    assert not have - {"CAP-1"}',
    "assertFalse_literal_name_rebound_from_the_artifact": 'want = {"CAP-1"}\n    want = set(parsed["noted_caps"])\n    self.assertFalse(want - {"CAP-2"})',
    "assertFalse_literal_name_widened_from_the_artifact": 'want = {"CAP-1"}\n    want |= set(parsed["noted_caps"])\n    self.assertFalse(want - {"CAP-2"})',
    "assertFalse_attribute_sharing_a_literal_name": 'want = {"CAP-1"}\n    self.assertFalse(self.want - want)',
    "plain_assert_not_not_equal": 'assert not set(parsed["noted_caps"]) != {"CAP-1"}',
    "plain_assert_not_not_equal_against_a_name": 'want = {"CAP-1"}\n    assert not parsed["noted_caps"] != want',
    "plain_assert_not_not_equal_count_of_a_rewritten_set": 'assert not len(parsed["noted_caps"]) != 6',
}

PLANTED_MODULE_COLLECTIONS = {
    "subscript_against_a_module_collection": '''
NOTED_CAPS = {"CAP-1"}

def test_it(self):
    parsed = read(REPO_ROOT / "_bmad-output" / "SPEC.md")
    self.assertEqual(parsed["noted_caps"], NOTED_CAPS)
''',
    "subscript_against_an_annotated_module_collection": '''
NOTED_CAPS: set[str] = {"CAP-1"}

def test_it(self):
    parsed = read(REPO_ROOT / "_bmad-output" / "SPEC.md")
    self.assertEqual(NOTED_CAPS, parsed["noted_caps"])
''',
    "module_literal_shadowed_by_a_read_local": '''
WANT = {"CAP-1"}

def test_it(self):
    parsed = read(REPO_ROOT / "_bmad-output" / "SPEC.md")
    WANT = set(parsed["noted_caps"])
    self.assertFalse(WANT - {"CAP-2"})
''',
    "module_literal_rebound_from_a_read": '''
WANT = {"CAP-1"}
WANT = set(read(REPO_ROOT / "_bmad-output" / "SPEC.md"))

def test_it(self):
    parsed = read(REPO_ROOT / "_bmad-output" / "SPEC.md")
    self.assertFalse(WANT - {"CAP-2"})
''',
}

ALLOWED_AGAINST_A_CONSTANT = '''
def test_only_what_cannot_change(self):
    spec = REPO_ROOT / "_bmad-output" / "SPEC.md"
    parsed = read(spec)
    self.assertEqual(len(parsed["caps"]), CAP_COUNT)
    self.assertEqual(parsed["caps"]["CAP-3"], STORY_FOR_CAP_3)
    self.assertEqual(STORY_FOR_CAP_3, parsed["caps"]["CAP-3"])
    self.assertEqual(parsed["title"], "x")
    self.assertLess(len(str(spec)), 200)
    assert len(parsed["caps"]) == CAP_COUNT
'''

ALLOWED_AGAINST_A_KNOWN_NON_COLLECTION = '''
CAP_COUNT = 18
TITLE = "The title"
WANT = {"CAP-1"}

def test_only_what_cannot_change(self):
    parsed = read(REPO_ROOT / "_bmad-output" / "SPEC.md")
    self.assertEqual(parsed["count"], CAP_COUNT)
    self.assertEqual(TITLE, parsed["title"])
    self.assertEqual(len(parsed["caps"]), WANT)
    self.assertTrue(parsed["count"] == CAP_COUNT)
    self.assertTrue(len(parsed["caps"]) == CAP_COUNT)
    self.assertFalse(parsed["count"] - CAP_COUNT)
    self.assertFalse(len(parsed["caps"]) - CAP_COUNT)
'''

ALLOWED_SUBSET_AND_NEGATED = '''
CAP_COUNT = 18
WANTED = {"CAP-1"}

def test_a_subset_stays_green_as_notes_grow(self):
    parsed = read(REPO_ROOT / "_bmad-output" / "SPEC.md")
    want = {"CAP-1"}
    annotated: set[str] = {"CAP-1"}
    have = set(parsed["noted_caps"])
    self.assertFalse(want - have)
    self.assertFalse(annotated - have)
    self.assertFalse(WANTED - have)
    assert not want - have
    assert set(parsed["noted_caps"]) != want
    assert not parsed["count"] != CAP_COUNT
    assert not len(parsed["caps"]) != CAP_COUNT
    self.assertFalse(want - set(parsed["noted_caps"]))
    self.assertFalse({"CAP-1"} - set(parsed["noted_caps"]))
    assert not want - set(parsed["noted_caps"])
    assert set(parsed["noted_caps"]) ^ want
    self.assertFalse(parsed["count"] != CAP_COUNT)
    self.assertFalse(len(parsed["caps"]) != CAP_COUNT)
    assert not parsed["count"] - CAP_COUNT
'''

NO_LIVE_ROOT_IN_A_GLOB = '''
def test_a_temp_root(self):
    for spec in self.tmp.glob("_bmad-output/specs/*/SPEC.md"):
        self.assertEqual(set(read(spec)), {"CAP-1"})

def test_the_tests_folder(self):
    for path in TESTS.glob("*.py"):
        self.assertEqual(set(read(path)), {"CAP-1"})
'''

PLUGIN_ROOT_ALONE = '''
def test_a_folder_under_the_plugin(self):
    self.assertEqual(set(read(PLUGIN_ROOT / "_bmad-output")), {"CAP-1"})

def test_a_root_only_two_up(self):
    self.assertEqual(set(read(PLUGIN_ROOT.parents[0] / "_bmad-output")), {"CAP-1"})
'''

TEMP_FIXTURES = '''
class T(unittest.TestCase):
    SPEC = FIXTURES / "_bmad-output" / "SPEC.md"

    def setUp(self):
        self.spec = self.tmp / "_bmad-output" / "SPEC.md"

    def _spec(self):
        return self.tmp / "_bmad-output" / "SPEC.md"

    def test_it(self):
        self.assertEqual(set(read(self.spec)), {"CAP-1"})
        self.assertEqual(set(read(self.SPEC)), {"CAP-1"})
        self.assertEqual(set(read(self._spec())), {"CAP-1"})
        run({"TK_STUDIO_ROOT": str(REPO_ROOT)})
'''

A_LOCAL_SHADOWS_A_LIVE_NAME = '''
SPEC = REPO_ROOT / "_bmad-output" / "SPEC.md"

def test_a_local_of_the_same_name(self):
    SPEC = self.tmp / "_bmad-output" / "SPEC.md"
    self.assertEqual(set(read(SPEC)), {"CAP-1"})
'''

PLANTED_TS = '''
const spec = readFileSync(join(import.meta.dir, "..", "..", "..", "_bmad-output", "specs", "SPEC.md"), "utf-8");
test("pins", () => { expect(noted(spec)).toEqual(["CAP-1"]); });
'''

PLANTED_TS_ALIAS = '''
const STUDIO_ROOT = resolve(import.meta.dir, "..", "..", "..");
test("pins", () => {
  const spec = readFileSync(join(STUDIO_ROOT,
    "_bmad-output", "specs", "SPEC.md"), "utf-8");
  expect(noted(spec)).toStrictEqual(["CAP-1"]);
});
'''

TEMP_ROOT_TS = '''
const STUDIO_ROOT = join(import.meta.dir, "..", "..", "..");
test("a temp root", () => {
  writeFileSync(join(root, "_bmad-output", "specs", "SPEC.md"), "x");
  expect(run(STUDIO_ROOT, root)).toEqual({ ok: true });
});
'''


PLANTED_TS_FORMS = {
    "one_string": '''
const spec = readFileSync(resolve(import.meta.dir, "../../..", "_bmad-output", "specs", "SPEC.md"), "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "split_strings": '''
const spec = readFileSync(join(import.meta.dir, "../..", "..", "_bmad-output", "SPEC.md"), "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "one_string_into_the_folder": '''
const spec = readFileSync(resolve(import.meta.dir, "../../../_bmad-output/SPEC.md"), "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "template_over_an_alias": '''
const R = resolve(import.meta.dir, "../../..");
const spec = readFileSync(`${R}/_bmad-output/specs/SPEC.md`, "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "template_over_a_typed_alias_of_an_alias": '''
const TOP: string = join(import.meta.dir, "..", "..", "..");
const R = TOP;
const spec = readFileSync(`${R}/_bmad-output/specs/${name}/SPEC.md`, "utf-8");
expect(noted(spec)).toStrictEqual(["CAP-1"]);
''',
    "template_over_a_template_alias": '''
const R = `${import.meta.dir}/../../..`;
const spec = readFileSync(`${R}/_bmad-output/SPEC.md`, "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "multi_line_alias": '''
const R = resolve(
  import.meta.dir, "../../..",
);
const spec = readFileSync(`${R}/_bmad-output/SPEC.md`, "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "join_over_a_one_string_alias": '''
const R = resolve(import.meta.dir, "../../..");
const spec = readFileSync(join(R, "_bmad-output", "SPEC.md"), "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
}

TEMP_ROOT_TS_FORMS = {
    "app_root_alias": '''
const R = resolve(import.meta.dir, "..");
const spec = readFileSync(`${R}/_bmad-output/SPEC.md`, "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "two_up": '''
const spec = readFileSync(resolve(import.meta.dir, "../..", "_bmad-output", "SPEC.md"), "utf-8");
expect(noted(spec)).toEqual(["CAP-1"]);
''',
    "template_over_a_temp_root": '''
const R = resolve(import.meta.dir, "../../..");
const spec = readFileSync(`${root}/_bmad-output/SPEC.md`, "utf-8");
expect(run(R, spec)).toEqual({ ok: true });
''',
}


class LivePinsGuard(unittest.TestCase):
    def test_no_test_pins_a_live_planning_artifact(self):
        found = live_pins()
        self.assertEqual(found, [], "exact-state assertions over a live planning artifact (read a fixture, "
                                    "assert only what cannot change): " + ", ".join(found))

    def test_the_sweep_sees_the_suites(self):
        # guard the guard: the sweeps must keep seeing the tree, or they silently check nothing
        names = {path.name for path in TESTS.glob("*.py")}
        self.assertIn("test_launch.py", names)
        self.assertGreaterEqual(len(names), 50)
        launch = (TESTS / "test_launch.py").read_text(encoding="utf-8")
        self.assertTrue(any(".test" in name or name.startswith("test") for name in live_functions(launch)),
                        "test_launch.py's real-artifact test no longer reads as reaching the live tree")
        if SUPERVISOR_TESTS.is_dir():
            self.assertGreaterEqual(len(list(SUPERVISOR_TESTS.glob("*.test.ts"))), 10)

    def test_a_planted_file_in_a_folder_is_found(self):
        # the sweep's own walk over a real file, since nothing live remains to find
        with tempfile.TemporaryDirectory() as tmp:
            planted = Path(tmp) / "test_planted.py"
            planted.write_text(PLANTED_LIB, encoding="utf-8")
            found = [hit for path in Path(tmp).glob("*.py")
                     for hit in pins_in_python(path.read_text(encoding="utf-8"), path.name)]
        self.assertEqual(found, ["test_planted.py::Pinned.test_pins_the_notes:9"])


class PlantedPins(unittest.TestCase):
    def test_a_planted_lib_pin_fails_naming_the_test(self):
        self.assertEqual(pins_in_python(PLANTED_LIB, "test_x.py"), ["test_x.py::Pinned.test_pins_the_notes:9"])

    def test_a_pin_through_a_module_name_fails_naming_the_test(self):
        self.assertEqual(pins_in_python(PLANTED_LIB_ALIAS, "test_x.py"), ["test_x.py::test_pins_through_a_module_name:6"])

    def test_every_way_of_reaching_the_live_tree_is_found(self):
        for name, source in PLANTED_REACHES.items():
            with self.subTest(name):
                self.assertEqual(len(pins_in_python(source, "test_x.py")), 1, source)

    def test_every_exact_shape_is_found(self):
        for name, line in PLANTED_EXACT.items():
            source = f'def test_it(self):\n    spec = REPO_ROOT / "_bmad-output"\n    {line}\n'
            with self.subTest(name):
                self.assertEqual(len(pins_in_python(source, "test_x.py")), 1, source)

    def test_a_subscript_against_a_module_collection_is_found(self):
        for name, source in PLANTED_MODULE_COLLECTIONS.items():
            with self.subTest(name):
                self.assertEqual(len(pins_in_python(source, "test_x.py")), 1, source)

    def test_a_count_and_a_subscript_are_allowed(self):
        self.assertEqual(pins_in_python(ALLOWED_LIB, "test_x.py"), [])
        self.assertEqual(pins_in_python(ALLOWED_AGAINST_A_CONSTANT, "test_x.py"), [])
        self.assertEqual(pins_in_python(ALLOWED_AGAINST_A_KNOWN_NON_COLLECTION, "test_x.py"), [])

    def test_a_subset_and_a_negated_scalar_are_allowed(self):
        self.assertEqual(pins_in_python(ALLOWED_SUBSET_AND_NEGATED, "test_x.py"), [])

    def test_a_path_that_is_not_the_checkout_is_not_flagged(self):
        self.assertEqual(pins_in_python(PLUGIN_ROOT_ALONE, "test_x.py"), [])
        self.assertEqual(pins_in_python(TEMP_FIXTURES, "test_x.py"), [])
        self.assertEqual(pins_in_python(A_LOCAL_SHADOWS_A_LIVE_NAME, "test_x.py"), [])

    def test_a_temp_root_is_not_flagged(self):
        self.assertEqual(pins_in_python(TEMP_ROOT_LIB, "test_x.py"), [])
        self.assertEqual(pins_in_python(REPO_PASSED_BESIDE_A_TEMP_ROOT, "test_x.py"), [])
        self.assertEqual(pins_in_python(NO_LIVE_ROOT_IN_A_GLOB, "test_x.py"), [])

    def test_a_planted_supervisor_pin_fails_naming_the_file(self):
        self.assertEqual(pins_in_typescript(PLANTED_TS, "x.test.ts"), ["x.test.ts"])
        self.assertEqual(pins_in_typescript(PLANTED_TS_ALIAS, "y.test.ts"), ["y.test.ts"])
        for name, source in PLANTED_TS_FORMS.items():
            with self.subTest(name):
                self.assertEqual(pins_in_typescript(source, "z.test.ts"), ["z.test.ts"], source)

    def test_a_supervisor_temp_root_is_not_flagged(self):
        self.assertEqual(pins_in_typescript(TEMP_ROOT_TS, "x.test.ts"), [])
        for name, source in TEMP_ROOT_TS_FORMS.items():
            with self.subTest(name):
                self.assertEqual(pins_in_typescript(source, "x.test.ts"), [], source)


if __name__ == "__main__":
    unittest.main()
