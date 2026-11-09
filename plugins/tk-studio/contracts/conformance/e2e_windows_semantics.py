"""The Story 37.2 e2e drive — the Windows classes out of the host leg (holes 108, 110; DW-154, DW-155).

Linux joins with `/`, renames over an empty folder, decodes a child's output as UTF-8
and runs a multi-file `bun test` fast; the Windows host does none of these, so each
class below is green in the engine's gate and red on the host leg. A scan of

    plugins/tk-studio/lib   <plugin>/lib (the tests included)
    apps/supervisor/src     <checkout>/apps/supervisor/src
    apps/supervisor/test    <checkout>/apps/supervisor/test
    _bmad/scripts           <checkout>/_bmad/scripts
    tools                   <checkout>/tools
    plugins/tk-studio/skills/*/scripts   <plugin>/skills/*/scripts (Story 38.6, B9)
    .bmad-loop/plugins      <checkout>/.bmad-loop/plugins (Story 38.6, B9; the nested
                            apps/supervisor/.bmad-loop copy is pinned equal or rendered, never scanned)

(`*.py` by AST, `*.ts` by line, `//` and JSDoc/block-comment lines skipped, folders starting
with a dot and `node_modules` skipped)
fails a step per scope naming `<file>:<line> <class>: <rule>` for:

    (a) a `path.join`/`resolve` whose result reaches `toVmPath` or an `sbx` argv (`*.ts`):
        `toVmPath(pluginRoot(`, `toVmPath(studioScript(`, `toVmPath(join(`/`resolve(`, a
        `join(`/`resolve(` wrapping a `toVmPath(` result, a `join(` inside an `["exec", …]`
        literal. The rule: the POSIX tail after `toVmPath(studioRoot(env))`. Data flow through
        a variable is out of a line scan's reach.
    (b) a POSIX-suffix assertion on a joined path: `endswith` inside an assertion (`*.py`)
        whose subject is a join (`join(`, `resolve(`, `fspath(`, `str(<Path> / …)`, `Path(`)
        or a recorded argv (`calls`, `argv`, `args`, `cmd`) and whose expected value holds a
        `/` (or is computed, so may); `expect(<join(…)/resolve(…)>).toEndWith|toContain|toBe(
        "<…/…>")` (`*.ts`). A normalised subject (`.replace("\\", "/")`, `.as_posix()`,
        `toVmPath`, `posix`) is exempt.
    (c) a rename onto a path that may exist without the empty-folder clear: `os.rename`,
        `<path>.rename` (`*.py`, positional or `src=`/`dst=`/`target=`; a bare `from os import
        rename [as …]` name too), `renameSync` (`*.ts`).
        Exempt by shape: a clear of the same destination name in the enclosing function
        (`rmdir`, `rmtree`, `rmSync`, `rmdirSync`, `_remove`, `unlink`, `unlinkSync`, `remove`;
        a TS clear precedes the rename, braces counted: a `function`, a class method or an arrow
        is a function, so a sibling method's or arrow's clear is none), a destination with a pid or random part (a `pid`
        token, never `rapid`), and in `*.ts` only a tmp-to-file `renameSync` (the source a
        `tmp`/`temp` token, not a `dir`/`folder` one: Node replaces an existing file on win32;
        Python's rename raises FileExistsError onto any existing path, so `os.replace` it).
        A TS `renameSync` is read on its own line: the arguments of a call split across
        lines are out of a line scan's reach (the call is skipped when its destination is
        not on the line).
    (d) a `subprocess.run|Popen|check_output|check_call|call` (import aliases read through)
        with `text=` or `universal_newlines=` not `False` and no `encoding=` (`*.py`);
        a `**kwargs` call is exempt; any other callee's `text=` (`self.subTest(text=…)`) never
        matches.

and a `bounds` step over the conformance drives and `tools/verify_host.py`: every
`bun test` argv carries `--timeout` (`*bun_test_args()` or a `"--timeout"` element), every
drive `git` subprocess has `timeout=`, and every bun drive's suite bound (`BOUND_S =
suite_bound(…)`, read from the `--plugin-root` manifest's `timeout` less its `install_s`,
`other_s` and `_budget.HEADROOM_S`) holds the 30 000 ms host figure plus `_budget.HEADROOM_S`;
a bun drive with no manifest entry or no derived bound is a red hit.

A `config verify commands` step (Story 38.6) reads every `.tk-studio/config.yaml` under the
checkout (else the plugin root; `node_modules`, `.git`, `.venv` and every dot-folder but
`.tk-studio` pruned) line by line, comment lines skipped (stdlib-only: no YAML parse): a line
running `bun test` with no `--timeout N`, or `N` under `_budget.HOST_TEST_TIMEOUT_MS`, is a hit
naming `<rel>:<line>` and the host figure; a trailing `# win-ok: <reason>` exempts the line.

The remainder is exempted inline: `win-ok: <reason>` in a comment on the hit's line (any
line of a multi-line Python call). An absent scope is a `not_run` step, `ok`; a Python file
that does not parse is a red hit (as the encoding drive). Prints one JSON object
{ok, steps[]} and exits nonzero on a red step. Stdlib-only (NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _budget  # noqa: E402 - the sibling helper: the host figure
import e2e_text_encoding as enc  # noqa: E402 - the sibling drive's helpers (Story 36.4's shape)

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
DRIVES_DIR = Path(__file__).resolve().parent
HOST_FIGURE = f"{_budget.HOST_TEST_TIMEOUT_MS:_} ms".replace("_", " ")

RULE_A = ("class (a) a join reaching toVmPath or an sbx argv: path.join/resolve use the host's separator "
          "(backslashes on win32) and toVmPath refuses them (VmPathUnderivable): append the POSIX tail after "
          "toVmPath(studioRoot(env))")
RULE_B = ("class (b) a POSIX-suffix assertion on a joined path: the host joins with backslashes on win32 "
          "(hole 110): normalise the subject (.replace(\"\\\\\", \"/\"), .as_posix(), toVmPath)")
RULE_C = ("class (c) a rename onto a path that may exist: a POSIX rename replaces an empty directory, a Windows "
          "rename refuses it (WinError 183): clear the destination first (the empty-folder clear: rmdir, rmtree, "
          "rmSync, _remove, unlink)")
RULE_D = ("class (d) a text-mode subprocess with no encoding=: the Windows host decodes a child's output as "
          "cp1252 under text=True/universal_newlines: name encoding=\"utf-8\"")
RULE_BUN = (f"bounds: a bun test argv with no --timeout: the preload's setDefaultTimeout reaches only the first "
            f"file (bun 1.4.3, DW-155): pass --timeout from the {HOST_FIGURE} host figure "
            f"(_budget.HOST_TEST_TIMEOUT_MS)")
RULE_GIT = (f"bounds: a drive git subprocess with no timeout=: every step a drive spends is bounded under the "
            f"{HOST_FIGURE} host figure's headroom (B7)")

RULE_VERIFY = (f"config verify commands: a bun test verify command with no --timeout at the {HOST_FIGURE} host "
               f"figure: the host runs each test under bun's 5 s default otherwise: name --timeout "
               f"{_budget.HOST_TEST_TIMEOUT_MS} (_budget.HOST_TEST_TIMEOUT_MS)")

WIN_OK = re.compile(r"win-ok:\s*\S")
# A `.tk-studio/config.yaml` verify command line running `bun test` (a quoted `bun.exe` path too), its `--timeout N`,
# a comment line and a trailing `# win-ok: <reason>` comment.
VERIFY_BUN_TEST = re.compile(r"""(?:^|[\s"'/\\:-])bun(?:\.exe)?["']?\s+test\b""")
VERIFY_TIMEOUT = re.compile(r"--timeout(?:=|\s+)(\d+)")
YAML_COMMENT_LINE = re.compile(r"^\s*#")
TRAILING_WIN_OK = re.compile(r"(?:^|\s)#.*win-ok:\s*\S")
# A trailing YAML comment (` #` to the line's end), and the shell separators between one command's runs (`&&` matched
# before a cmd single `&`).
TRAILING_COMMENT = re.compile(r"(?:^|\s)#.*$")
SHELL_SEPARATOR = re.compile(r"&&|\|\||;|\||&")
CONFIG_PRUNE = {"node_modules", ".git", ".venv"}
SUBPROCESS_CALLS = {"run", "Popen", "check_output", "check_call", "call"}
CLEARS = {"rmdir", "rmtree", "rmSync", "rmdirSync", "_remove", "unlink", "unlinkSync", "remove"}
# A pid or random part: `pid` as a token (`getpid`, `process.pid`, `lock_pid`, `ownerPid`; never `rapid`).
UNIQUE_PART = re.compile(r"getpid|(?<![A-Za-z0-9])(?:pid|PID)(?![a-z0-9])|(?<=[a-z0-9])Pid(?![a-z0-9])"
                         r"|[Uu]uid|UUID|[Rr]andom|token_hex|token_urlsafe|mkdtemp|time_ns|monotonic|Date\.now")
# A tmp source as a token: word, `_`/`.`/`-` delimited or camelCase (`tmp`, `${path}.tmp`, `tmpFile`, `fileTmp`;
# never `attempt_dir`, `templates`). TypeScript only: Node's renameSync replaces an existing file on win32, while
# Python's os.rename/Path.rename raise FileExistsError onto any existing path. A tmp folder is no file.
TMP_SOURCE = re.compile(r"(?:(?<![A-Za-z0-9])(?:tmp|temp|Tmp|Temp|TMP|TEMP)|(?<=[a-z0-9])(?:Tmp|Temp|TMP|TEMP))(?![a-z0-9])")
DIR_SOURCE = re.compile(r"(?:(?<![A-Za-z0-9])(?:dir|folder|Dir|Folder)|(?<=[a-z0-9])(?:Dir|Folder))(?![a-z0-9])")
NORMALISED = re.compile(r"""\.replace\(\s*(?:r?["']\\\\["']|/\\\\/g)|as_posix|toVmPath|posix""")
JOINED_PY = re.compile(r"\bjoin\(|\bresolve\(|\bfspath\(|\bPath\(")
ARGV_ROOTS = {"calls", "call", "argv", "args", "cmd", "command"}
CALL_WIDTH = 80

# Class (a): the regression shapes (bcfa691's sweep.ts stopEngineAt among them).
# A bare `join(`/`resolve(` (the supervisor's named `node:path` imports) or one through a `node:path` namespace
# (`path.`, `nodePath.`, `node_path.`); an array's `parts.join(` and `posix.join(` stay exempt.
JOIN = r"(?:(?<![.\w$])(?:path|nodePath|node_path)\.|(?<![.\w$]))(?:join|resolve)\("
TS_A = [re.compile(r"toVmPath\(\s*(?:pluginRoot|studioScript)\("),
        re.compile(r"toVmPath\(\s*" + JOIN),
        re.compile(JOIN + r"[^;]*?toVmPath\("),
        re.compile(r"""\[\s*["']exec["'][^\]]*""" + JOIN)]
TS_B = re.compile(r"expect\((?P<subject>.*)\)\s*\.\s*(?:not\s*\.\s*)?(?:toEndWith|toContain|toBe)\(\s*"
                  r"""(?P<q>["'`])(?P<want>[^"'`]*/[^"'`]*)(?P=q)\s*\)""")
TS_RENAME = re.compile(r"\brenameSync\(")
TS_BLOCK_COMMENT = re.compile(r"^\s*(?:/\*|\*)")
TS_FUNCTION_START = re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\b|^\S")
# The text before a block's `{` that makes the block a function body: an arrow (`=> {`), a `function`, a class, or a
# class-method declaration (`move(src: string): void {`, `async *items() {`), never a control keyword's block.
TS_CONTROL = {"if", "for", "while", "switch", "catch", "with", "return", "else", "do", "try", "finally", "new",
              "await", "typeof", "throw", "yield", "delete", "void", "case", "super"}
TS_ARROW_HEAD = re.compile(r"=>\s*$")
TS_FUNCTION_HEAD = re.compile(r"\bfunction\b|\bclass\b")
TS_METHOD_HEAD = re.compile(r"^(?:(?:public|private|protected|static|async|override|readonly|abstract|declare|get|set)\s+)*"
                            r"\*?\s*(?P<name>[#\w$]+)\s*(?:<[^()]*>)?\s*\([^;]*\)\s*(?::[^;=]*)?$")


def _source(node: ast.AST) -> str:
    return " ".join(ast.unparse(node).split())


def _aliases(tree: ast.AST) -> dict[str, str]:
    """The encoding drive's `as` names, plus a bare `from subprocess import run` or `from os import rename` (the name
    stands for itself there)."""
    aliases = enc._import_aliases(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in ("subprocess", "os") and not node.level:
            aliases.update((a.name, f"{node.module}.{a.name}") for a in node.names if not a.asname)
    return aliases


def _win_ok(lines: list[str], first: int, last: int) -> bool:
    return any(WIN_OK.search(lines[i - 1]) for i in range(first, min(last, len(lines)) + 1) if 0 < i)


def _subprocess_unencoded(node: ast.Call, aliases: dict[str, str]) -> bool:
    callee = enc._canonical(node.func, aliases)
    if callee is None:
        return False
    owner, _, name = callee.rpartition(".")
    if name not in SUBPROCESS_CALLS or not (owner == "subprocess" or owner.endswith(".subprocess")):
        return False
    text = False
    for keyword in node.keywords:
        if keyword.arg is None:  # a `**kwargs`
            return False
        if keyword.arg == "encoding" and not (isinstance(keyword.value, ast.Constant) and keyword.value.value is None):
            return False
        if keyword.arg in ("text", "universal_newlines"):
            text = text or not (isinstance(keyword.value, ast.Constant) and not keyword.value.value)
    return text


def _holds_slash(node: ast.expr) -> bool:
    """An expected value that holds a `/`: a constant with one, an f-string or a concatenation with one, or a
    computed value (it may hold one: the 6d0a0cc suffix was a job definition's POSIX-relative core)."""
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str) and "/" in node.value
    if isinstance(node, ast.JoinedStr):
        return any(_holds_slash(v) for v in node.values if isinstance(v, ast.Constant))
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return _holds_slash(node.left) or _holds_slash(node.right)
    if isinstance(node, ast.Tuple):
        return any(_holds_slash(e) for e in node.elts)
    return isinstance(node, (ast.Name, ast.Attribute, ast.Subscript, ast.Call))


def _root_name(node: ast.expr) -> str | None:
    while isinstance(node, (ast.Subscript, ast.Attribute)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _joined(subject: ast.expr) -> bool:
    """A subject that is a joined path: a join call in it, `str(<a / b>)`, or a recorded argv's element."""
    text = _source(subject)
    if NORMALISED.search(text):
        return False
    if JOINED_PY.search(text):
        return True
    if any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "str" and n.args
           and isinstance(n.args[0], ast.BinOp) and isinstance(n.args[0].op, ast.Div) for n in ast.walk(subject)):
        return True
    return isinstance(subject, ast.Subscript) and _root_name(subject) in ARGV_ROOTS


def _assertions(tree: ast.AST) -> list[ast.AST]:
    """The `assert` statements and `self.assert*(…)` calls of a file."""
    found: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assert):
            found.append(node.test)
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and node.func.attr.startswith("assert")):
            found.append(node)
    return found


def _posix_suffix_asserts(tree: ast.AST) -> list[ast.Call]:
    hits: dict[int, ast.Call] = {}
    for assertion in _assertions(tree):
        for node in ast.walk(assertion):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "endswith"
                    and node.args and _holds_slash(node.args[0]) and _joined(node.func.value)):
                hits[id(node)] = node
    return list(hits.values())


def _functions(tree: ast.AST) -> list[ast.AST]:
    return [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


def _enclosing(tree: ast.AST, node: ast.AST) -> ast.AST:
    """The innermost function holding `node` (the module when none does)."""
    best = tree
    for fn in _functions(tree):
        if fn.lineno <= node.lineno <= (fn.end_lineno or fn.lineno) and (
                best is tree or fn.lineno >= best.lineno):
            best = fn
    return best


def _rename_parts(node: ast.Call, aliases: dict[str, str]) -> tuple[ast.expr, ast.expr] | None:
    """`(source, destination)` of `os.rename(src, dst)` or `<src>.rename(dst)`, positional or by keyword
    (`os.rename(src=a, dst=b)`, `p.rename(target=q)`), or a bare name imported as `os.rename` (`from os import
    rename`, `from os import rename as mv`); None for anything else."""
    bare = isinstance(node.func, ast.Name) and enc._canonical(node.func, aliases) == "os.rename"
    if not bare and (not isinstance(node.func, ast.Attribute) or node.func.attr != "rename"):
        return None
    receiver = "os" if bare else enc._canonical(node.func.value, aliases)
    named = {k.arg: k.value for k in node.keywords if k.arg is not None}
    if receiver == "os":
        args = [*node.args[:2]]
        for keyword in ("src", "dst")[len(args):]:
            if keyword not in named:
                return None
            args.append(named[keyword])
        return args[0], args[1]
    if receiver in ("shutil", "subprocess"):
        return None
    if len(node.args) == 1 and not named:
        return node.func.value, node.args[0]
    if not node.args and set(named) == {"target"}:
        return node.func.value, named["target"]
    return None


def _assigned_text(scope: ast.AST, name: str) -> str:
    """Every value assigned to `name` in `scope`, as source text."""
    texts = []
    for node in ast.walk(scope):
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            texts.append(_source(node.value))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name and node.value:
            texts.append(_source(node.value))
    return " ".join(texts)


def _cleared(scope: ast.AST, dst: str) -> bool:
    """A clear of the destination's name in the enclosing function: `os.rmdir(dst)`, `shutil.rmtree(dst)`,
    `_remove(dst)`, `dst.unlink()`, `dst.rmdir()` (before the rename or in its retry)."""
    for node in ast.walk(scope):
        if not isinstance(node, ast.Call):
            continue
        name = node.func.attr if isinstance(node.func, ast.Attribute) else node.func.id if isinstance(node.func, ast.Name) else None
        if name not in CLEARS:
            continue
        if node.args and _source(node.args[0]) == dst:
            return True
        if isinstance(node.func, ast.Attribute) and not node.args and _source(node.func.value) == dst:
            return True
    return False


def _unsafe_rename(tree: ast.AST, node: ast.Call, aliases: dict[str, str]) -> bool:
    parts = _rename_parts(node, aliases)
    if parts is None:
        return False
    src, dst = (_source(p) for p in parts)
    scope = _enclosing(tree, node)
    if UNIQUE_PART.search(dst):  # no tmp-to-file exemption: Python's rename refuses any existing destination
        return False
    if isinstance(parts[1], ast.Name) and UNIQUE_PART.search(_assigned_text(scope, parts[1].id)):
        return False
    return not _cleared(scope, dst)


def python_hits(source: str | bytes, label: str) -> list[str]:
    """Classes (b), (c) and (d) in one Python file, as `<label>:<line> <class rule>: <call>`."""
    tree = ast.parse(source)
    text = source.decode("utf-8", errors="replace") if isinstance(source, bytes) else source
    lines = text.splitlines()
    aliases = _aliases(tree)
    found: list[tuple[int, str]] = []

    def hit(node: ast.Call, rule: str) -> None:
        if not _win_ok(lines, node.lineno, node.end_lineno or node.lineno):
            found.append((node.lineno, f"{label}:{node.lineno} {rule}: {_source(node)[:CALL_WIDTH]}"))

    for node in _posix_suffix_asserts(tree):
        hit(node, RULE_B)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if _unsafe_rename(tree, node, aliases):
            hit(node, RULE_C)
        if _subprocess_unencoded(node, aliases):
            hit(node, RULE_D)
    return [h for _, h in sorted(found)]


def _ts_blank(line: str) -> str:
    """`line` with its string contents and a trailing `//` comment blanked, the length kept (the braces counted)."""
    out, quote, i = [], "", 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == "\\":
                out.append(" " * len(line[i:i + 2]))
                i += 2
                continue
            out.append(ch if ch == quote else " ")
            quote = "" if ch == quote else quote
        elif ch in "\"'`":
            quote = ch
            out.append(ch)
        elif line.startswith("//", i):
            out.append(" " * (len(line) - i))
            break
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _ts_function_head(head: str) -> bool:
    """The text before an unmatched `{` opens a function body (an arrow, a `function`, a class, a method)."""
    head = head.strip().lstrip("}").strip()
    if TS_ARROW_HEAD.search(head) or TS_FUNCTION_HEAD.search(head):
        return True
    m = TS_METHOD_HEAD.match(head)
    return bool(m) and m.group("name") not in TS_CONTROL


def _ts_scope(lines: list[str], index: int) -> list[str]:
    """The text of the rename's enclosing function before the rename, as lines. Walked back with the braces counted:
    a closed block is kept when it is a control block (`if`, `for`, `try`, an object) and dropped when it is a
    function body (a sibling method's or arrow's), an expression-bodied arrow's body on an earlier line is dropped,
    and the walk stops at the function's first line (an arrow, a `function`, a class, a class method, or a column-0
    line); an expression-bodied arrow on the rename's own line before `renameSync` is the function itself."""
    buffers: list[list[str]] = [[]]  # reversed text per open (closed-later) block, the function's own at [0]
    for i in range(index, -1, -1):
        raw = lines[i] if i < index else lines[i][:lines[i].find("renameSync")]
        if i < index and (TS_BLOCK_COMMENT.match(raw) or raw.lstrip().startswith("//")):
            continue
        mask = _ts_blank(raw)
        arrows = [m.end() for m in re.finditer(r"=>(?!\s*\{)", mask)]
        if i == index and arrows:  # an expression-bodied arrow holds the rename: its body is the function
            return [raw[arrows[-1]:]]
        drop_from = arrows[0] - 2 if arrows else len(raw)  # a sibling arrow's expression body is no clear
        buffers[-1].append("\n")
        for j in range(len(mask) - 1, -1, -1):
            ch = mask[j]
            if ch == "}":
                buffers.append([])
            elif ch == "{":
                if len(buffers) > 1:
                    block = buffers.pop()
                    if not _ts_function_head(mask[:j]):
                        buffers[-1].extend(block)
                elif _ts_function_head(mask[:j]):
                    return "".join(reversed(buffers[0])).splitlines()
            elif j < drop_from:
                buffers[-1].append(raw[j])
        if i < index and len(buffers) == 1 and TS_FUNCTION_START.search(lines[i]):
            break
    return "".join(reversed(buffers[0])).splitlines()


def _ts_cleared(lines: list[str], index: int, dst: str) -> bool:
    """A clear of `dst` earlier in the same function (`_ts_scope`: a sibling method or arrow is no clear), or `dst` a
    name the function bound to a value with a pid or random part (`const aside = `${lock}.stale-${process.pid}…`)."""
    clear = re.compile(r"\b(?:" + "|".join(sorted(CLEARS)) + r")\(\s*" + re.escape(dst) + r"\s*[,)]")
    bound = re.compile(r"\b(?:const|let|var)\s+" + re.escape(dst) + r"\s*=(?P<value>.*)") if re.fullmatch(r"[\w$]+", dst) else None
    for line in _ts_scope(lines, index):
        if clear.search(line):
            return True
        m = bound.search(line) if bound else None
        if m and UNIQUE_PART.search(m.group("value")):
            return True
    return False


def _ts_call_args(code: str, start: int) -> list[str]:
    """The top-level arguments of the call whose `(` ends at `start`, read to its `)` or the end of the line
    (brackets, braces and quotes counted, so `join(a, "b")` or `${Date.now()}` is one argument)."""
    args, depth, quote, current = [], 0, "", []
    for ch in code[start:]:
        if quote:
            current.append(ch)
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'`":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            args.append("".join(current).strip())
            current = []
            continue
        current.append(ch)
    args.append("".join(current).strip())
    return [a for a in args if a]


def ts_hits(text: str, label: str) -> list[str]:
    """Classes (a), (b) and (c) in one TypeScript file, line by line."""
    lines = text.splitlines()
    found: list[str] = []
    for index, line in enumerate(lines):
        if WIN_OK.search(line) or TS_BLOCK_COMMENT.match(line):
            continue
        code = line.split("//", 1)[0] if line.lstrip().startswith("//") else line
        shown = " ".join(code.split())[:CALL_WIDTH]
        if any(shape.search(code) for shape in TS_A):
            found.append(f"{label}:{index + 1} {RULE_A}: {shown}")
        for m in TS_B.finditer(code):
            subject = m.group("subject")
            if re.search(JOIN, subject) and not NORMALISED.search(subject):
                found.append(f"{label}:{index + 1} {RULE_B}: {shown}")
                break
        for m in TS_RENAME.finditer(code):
            args = _ts_call_args(code, m.end())
            if len(args) < 2:  # a call split across lines: out of the line scan's reach
                continue
            src, dst = args[0], args[1]
            if ((TMP_SOURCE.search(src) and not DIR_SOURCE.search(src)) or UNIQUE_PART.search(dst)
                    or _ts_cleared(lines, index, dst)):
                continue
            found.append(f"{label}:{index + 1} {RULE_C}: {shown}")
    return found


def _source_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix in (".py", ".ts") and p.is_file()
                  and not any(part.startswith(".") or part == "node_modules" for part in p.relative_to(root).parts))


def _scan_step(step: str, roots: list[Path], base: Path) -> dict:
    """One step over `roots`, each file labelled relative to `base` (the encoding drive's `_scan_step` shape)."""
    files = [path for root in roots for path in _source_files(root)]
    hits: list[str] = []
    for path in files:
        label = path.relative_to(base).as_posix()
        if path.suffix == ".ts":
            hits += ts_hits(path.read_text(encoding="utf-8", errors="replace"), label)
            continue
        try:
            hits += python_hits(path.read_bytes(), label)
        except (SyntaxError, ValueError) as exc:
            hits.append(f"{label}:{getattr(exc, 'lineno', 0) or 0} unparsable: {exc}")
    if hits:
        return {"step": step, "ok": False, "detail": f"{len(hits)} Windows-semantics hit(s): " + "; ".join(hits)}
    return {"step": step, "ok": True, "detail": f"{len(files)} file(s), no Windows-semantics class hit"}


def _bun_test_list(node: ast.AST) -> bool:
    """A list literal `[<bun>, "test", …]` (the bun constant or a name holding the binary)."""
    if not (isinstance(node, ast.List) and len(node.elts) >= 2):
        return False
    first, second = node.elts[0], node.elts[1]
    bun = (isinstance(first, ast.Constant) and first.value == "bun") or (isinstance(first, ast.Name) and first.id == "bun")
    return bun and isinstance(second, ast.Constant) and second.value == "test"


def _has_timeout_flag(node: ast.List) -> bool:
    for elt in node.elts:
        if isinstance(elt, ast.Constant) and elt.value == "--timeout":
            return True
        if (isinstance(elt, ast.Starred) and isinstance(elt.value, ast.Call)
                and _source(elt.value.func).endswith("bun_test_args")):
            return True
    return False


def bounds_hits(source: str | bytes, label: str, *, drive: bool) -> list[str]:
    """Every `bun test` argv with no `--timeout`; in a drive, every `git` subprocess with no `timeout=`."""
    tree = ast.parse(source)
    text = source.decode("utf-8", errors="replace") if isinstance(source, bytes) else source
    lines = text.splitlines()
    aliases = _aliases(tree)
    hits: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if _bun_test_list(node) and not _has_timeout_flag(node) and not _win_ok(lines, node.lineno, node.end_lineno or node.lineno):
            hits.append((node.lineno, f"{label}:{node.lineno} {RULE_BUN}: {_source(node)[:CALL_WIDTH]}"))
        if not (drive and isinstance(node, ast.Call)):
            continue
        callee = enc._canonical(node.func, aliases) or ""
        argv = node.args[0] if node.args else None
        is_git = (isinstance(argv, ast.List) and argv.elts and isinstance(argv.elts[0], ast.Constant)
                  and argv.elts[0].value == "git")
        if (callee.rpartition(".")[2] in SUBPROCESS_CALLS and callee.startswith("subprocess") and is_git
                and not any(k.arg in ("timeout", None) for k in node.keywords)
                and not _win_ok(lines, node.lineno, node.end_lineno or node.lineno)):
            hits.append((node.lineno, f"{label}:{node.lineno} {RULE_GIT}: {_source(node)[:CALL_WIDTH]}"))
    return [h for _, h in sorted(hits)]


def _manifest_timeouts(manifest: Path) -> dict[str, int | None]:
    """`{script: timeout}` of every drive in `manifest`, read as `_budget._manifest_timeout` reads it: the first entry
    of a script with a `timeout` wins (None only when no entry of the script names one)."""
    data = json.loads(manifest.read_text(encoding="utf-8"))
    found: dict[str, int | None] = {}
    for surface in data.get("surfaces", {}).values():
        for drive in surface.get("drives", []):
            target = (drive.get("argv") or [""])[0]
            if target.startswith("contracts/conformance/"):
                script = target.rpartition("/")[2]
                if found.get(script) is None:
                    found[script] = int(drive["timeout"]) if "timeout" in drive else None
    return found


def _constant(node: ast.expr, names: dict[str, int]) -> int | None:
    """An int-valued module constant expression (`40`, `TRIAGE_WAIT_S + GIT_STEPS * GIT_BOUND_S`); None otherwise."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.Name):
        return names.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult)):
        left, right = _constant(node.left, names), _constant(node.right, names)
        if left is None or right is None:
            return None
        return left + right if isinstance(node.op, ast.Add) else left - right if isinstance(node.op, ast.Sub) else left * right
    return None


def _suite_bound_call(tree: ast.Module) -> tuple[ast.Call, dict[str, int]] | None:
    """The module-level `BOUND_S = suite_bound(…)` call and the int constants assigned before it."""
    names: dict[str, int] = {}
    for stmt in tree.body:
        if not (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name)):
            continue
        name = stmt.targets[0].id
        if name == "BOUND_S" and isinstance(stmt.value, ast.Call) and _source(stmt.value.func).endswith("suite_bound"):
            return stmt.value, names
        value = _constant(stmt.value, names)
        if value is not None:
            names[name] = value
    return None


def _manifest_bounds(drives: list[Path], manifest: Path) -> list[str]:
    """Every bun drive's derived suite bound (its manifest `timeout` less `install_s`, `other_s` and the headroom,
    as `_budget.suite_bound` yields it) holds the host figure plus `_budget.HEADROOM_S`."""
    need = _budget.HOST_TEST_TIMEOUT_MS // 1000 + _budget.HEADROOM_S
    timeouts = _manifest_timeouts(manifest) if manifest.is_file() else {}
    hits = []
    for path in drives:
        tree = ast.parse(path.read_bytes())
        if not any(_bun_test_list(n) for n in ast.walk(tree)):
            continue
        label = f"contracts/conformance/{path.name}"
        if path.name not in timeouts:
            hits.append(f"{label}: a bun drive with no manifest entry: its suite bound cannot hold the "
                        f"{HOST_FIGURE} host figure plus {_budget.HEADROOM_S} s headroom")
            continue
        found = _suite_bound_call(tree)
        if found is None:
            hits.append(f"{label}: a bun drive with no `BOUND_S = suite_bound(…)`: its suite bound must derive from "
                        f"the manifest timeout and hold the {HOST_FIGURE} host figure plus {_budget.HEADROOM_S} s headroom")
            continue
        call, names = found
        parts = {"install_s": 0, "other_s": 0, "headroom_s": _budget.HEADROOM_S}
        for keyword in call.keywords:
            if keyword.arg in parts:
                parts[keyword.arg] = _constant(keyword.value, names)
        if any(v is None for v in parts.values()):
            hits.append(f"{label}: the suite_bound(…) arguments are no module constants: the bound under the "
                        f"{HOST_FIGURE} host figure cannot be checked")
            continue
        timeout = timeouts[path.name]
        if timeout is None:
            import runner  # the sibling module; only the fallback needs it
            timeout = int(runner.DEFAULT_TIMEOUT)
        bound = timeout - parts["install_s"] - parts["other_s"] - parts["headroom_s"]
        if bound < need:
            hits.append(f"{label}: suite bound {bound} s (timeout {timeout} - install {parts['install_s']} - other "
                        f"{parts['other_s']} - headroom {parts['headroom_s']}) is under the {HOST_FIGURE} host figure "
                        f"plus {_budget.HEADROOM_S} s headroom ({need} s)")
    return hits


def bounds_step(plugin_root: Path, checkout: Path | None) -> dict:
    folder = plugin_root / "contracts" / "conformance"
    folder = folder if folder.is_dir() else DRIVES_DIR
    drives = sorted(folder.glob("*.py"))
    hits: list[str] = []
    for path in drives:
        hits += bounds_hits(path.read_bytes(), f"contracts/conformance/{path.name}", drive=True)
    hits += _manifest_bounds(drives, folder / "manifest.json")
    verify_host = checkout / "tools" / "verify_host.py" if checkout else None
    scanned = len(drives)
    if verify_host is not None and verify_host.is_file():
        hits += bounds_hits(verify_host.read_bytes(), "tools/verify_host.py", drive=False)
        scanned += 1
    if hits:
        return {"step": "bounds", "ok": False, "detail": f"{len(hits)} bound(s) under the host figure: " + "; ".join(hits)}
    return {"step": "bounds", "ok": True,
            "detail": f"{scanned} file(s), every bun test argv carries --timeout ({HOST_FIGURE}), every drive git call a timeout="}


def verify_command_hits(text: str, label: str) -> list[str]:
    """Every verify-command line of one `.tk-studio/config.yaml` running `bun test` with no `--timeout N` or `N` under
    the host figure, as `<label>:<line> <rule>: <line>`; comment lines and a trailing `# win-ok: <reason>` exempt.
    The flag is read from the code part only (a trailing comment stripped), and each `bun test` run is judged on its
    own span: the line splits into segments at `&&`, `||`, `;`, `|` and a cmd single `&`, and within a segment a run's
    span runs from its `bun test` to the next `bun test` or the segment's end (two runs in one YAML flow sequence never
    share a flag): any bare or low run flags the line; a `bun test` only in the trailing comment runs nothing and is
    no hit."""
    hits = []
    for index, line in enumerate(text.splitlines(), 1):
        if YAML_COMMENT_LINE.match(line) or not VERIFY_BUN_TEST.search(line) or TRAILING_WIN_OK.search(line):
            continue
        runs = []
        for seg in SHELL_SEPARATOR.split(TRAILING_COMMENT.sub("", line)):
            starts = [match.start() for match in VERIFY_BUN_TEST.finditer(seg)]
            runs += [seg[start:end] for start, end in zip(starts, starts[1:] + [len(seg)])]
        if not runs or all((flag := VERIFY_TIMEOUT.search(run)) and int(flag.group(1)) >= _budget.HOST_TEST_TIMEOUT_MS
                        for run in runs):
            continue
        hits.append(f"{label}:{index} {RULE_VERIFY}: {' '.join(line.split())[:CALL_WIDTH]}")
    return hits


def _config_files(top: Path) -> list[Path]:
    """Every `.tk-studio/config.yaml` under `top`: `node_modules`, `.git`, `.venv` and dot-folders but `.tk-studio`
    pruned."""
    found = []
    for folder, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames
                             if d not in CONFIG_PRUNE and (not d.startswith(".") or d == ".tk-studio"))
        if Path(folder).name == ".tk-studio" and "config.yaml" in filenames:
            found.append(Path(folder) / "config.yaml")
    return sorted(found)


def verify_commands_step(plugin_root: Path, checkout: Path | None) -> dict:
    """Story 38.6: every `.tk-studio/config.yaml` verify command running `bun test` names `--timeout` at the figure."""
    top = checkout or plugin_root
    configs = _config_files(top)
    hits: list[str] = []
    for path in configs:
        hits += verify_command_hits(path.read_text(encoding="utf-8", errors="replace"), path.relative_to(top).as_posix())
    if hits:
        return {"step": "config verify commands", "ok": False,
                "detail": f"{len(hits)} verify command(s) under the {HOST_FIGURE} host figure: " + "; ".join(hits)}
    return {"step": "config verify commands", "ok": True,
            "detail": f"{len(configs)} config(s), every bun test verify command carries --timeout ({HOST_FIGURE})"}


def run(plugin_root: Path = PLUGIN_ROOT) -> dict:
    checkout = enc._checkout(plugin_root)
    scopes = [("plugins/tk-studio/lib", [plugin_root / "lib"], plugin_root.parents[1] if checkout else plugin_root)]
    for rel in ("apps/supervisor/src", "apps/supervisor/test", "_bmad/scripts", "tools"):
        scopes.append((rel, [checkout / rel] if checkout else [], checkout))
    skills = plugin_root / "skills"
    scopes.append(("plugins/tk-studio/skills/*/scripts",
                   sorted(p for p in skills.glob("*/scripts") if p.is_dir()) if skills.is_dir() else [],
                   checkout or plugin_root))
    scopes.append((".bmad-loop/plugins", [checkout / ".bmad-loop" / "plugins"] if checkout else [], checkout))
    steps = []
    for step, roots, base in scopes:
        roots = [root for root in roots if root.is_dir()]
        if not roots:
            steps.append({"step": step, "ok": True, "not_run": f"{step} absent"})
        else:
            steps.append(_scan_step(step, roots, base))
    steps.append(bounds_step(plugin_root, checkout))
    steps.append(verify_commands_step(plugin_root, checkout))
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="fail the Windows-only classes the sandbox gate cannot see")
    parser.add_argument("--plugin-root", default=str(PLUGIN_ROOT))
    args = parser.parse_args(argv)
    try:
        result = run(Path(args.plugin_root).resolve())
    except Exception as exc:  # a drive failure must still be machine-readable
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
