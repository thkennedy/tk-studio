"""The Story 36.4 e2e drive — every text-mode open names its encoding (DW-132, hole 103).

Linux defaults a text-mode open to UTF-8 and the Windows host to its code page,
so a bare call is green in the engine's gate and red on the host leg. An AST scan
of every `*.py` under

    lib              <plugin>/lib (the tests included)
    tools/installer  <checkout>/tools/installer
    apps/*/scripts   <checkout>/apps/*/scripts

for `write_text`, `read_text`, `open` and `Path.open` with no `encoding=` keyword
(a positional encoding does not count, nor does `encoding=None`; a computed value
does). A hit fails its step naming `<file>:<line> <call>`. Exempt by shape:

    a binary mode (`b` in a constant mode, or in both branches of a conditional one);
    a `**kwargs` call;
    a non-Path receiver: a bare module or known dotted opener (`os.open`, `tarfile.open`,
    `zipfile`, `tempfile`, `urllib.request`, `webbrowser`; never an attribute chain rooted
    there, so `request.path.open("w")` is a Path), an object one of them made
    (`zipfile.ZipFile(p).open(m)`, `with zipfile.ZipFile(p) as z`, `z.open(m)`). A name
    is such an object only from a call that makes an opener: a `ZipFile`-like maker, a
    module's `open`, or a `zipfile`, `tarfile` or `urllib.request` call, never `os.*`,
    `tempfile.*` or `webbrowser.*`, so `tmp = tempfile.mkdtemp()` leaves `tmp` a candidate
    Path, and never `zipfile.Path`, whose `open` uses the locale encoding in text mode. The
    binding is file-wide, plain or annotated (`z: zipfile.ZipFile = zipfile.ZipFile(p)`);
    `x.open(...)` whose arguments cannot be a Path's: a constant first that is no mode
    (`archive.open("member")`), a string second (a Path's is `buffering`), a keyword
    `Path.open` does not take (`opener.open(url, timeout=5)`);
    a string constant, which is no call.

A computed mode cannot be proven binary, on a builtin `open(p, m)` or a Path's `p.open(m)`.
An import alias reads as the name it stands for (`import gzip as gz`, `from io import open as o`).

`gzip.open`, `bz2.open` and `lzma.open` use the locale encoding in text mode: such a call
is text when its mode (second positional or `mode=`) is a constant containing `t` or is
computed and not provably binary; their absent mode is `rb`, so it is exempt.
`codecs.open` reads like `io.open`: the mode is second and an absent mode is text.

`os.fdopen` and `tempfile` are other names and never match. A folder whose name
starts with a dot (a virtual environment) is not source. A root that does not exist
(`apps/*/scripts`, or `tools/installer` in an extracted archive) is a `not_run` step,
`ok`; `lib` is what the plugin ships, so its absence is red, never a scan of nothing.

Prints one JSON object {ok, steps[]} and exits nonzero on a red step. Stdlib-only
(NFR9); never prompts (AD-11).
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
NON_PATH_MODULES = {"os", "tarfile", "zipfile", "gzip", "bz2", "lzma", "webbrowser", "urllib", "urllib.request",
                    "request", "tempfile", "shelve", "dbm"}
NON_PATH_MAKERS = {"ZipFile", "TarFile", "build_opener", "OpenerDirector"}  # `from zipfile import ZipFile`
# Any call on these owners makes an opener object; on the rest only `open` can, and on these never.
OPENER_OWNERS = {"zipfile", "tarfile", "urllib.request"}
NEVER_OPENER_OWNERS = {"os", "tempfile", "webbrowser", "request"}  # a bare `request` is too common a name
ZIPFILE_PATH = ("zipfile", "Path")  # a Path-like: its `open` uses the locale encoding, unlike a `ZipFile` member's
COMPRESSED_OPENS = {"gzip", "bz2", "lzma"}  # an absent mode is `rb`; text mode uses the locale encoding
UNBOUND_OPENS = {"io", "builtins", "codecs", "Path", "pathlib.Path"}  # `Path.open(path, mode)`: the mode is second
PATH_OPEN_KEYWORDS = {"mode", "buffering", "encoding", "errors", "newline"}
MODE = re.compile(r"[rwaxbtU+]+\Z")
CALL_WIDTH = 80


def _text_mode(mode: ast.expr | None) -> bool:
    """False only for a provably binary mode: an absent mode is `r`, a computed one cannot be proven binary."""
    if isinstance(mode, ast.IfExp):
        return _text_mode(mode.body) or _text_mode(mode.orelse)
    return not (isinstance(mode, ast.Constant) and isinstance(mode.value, str) and "b" in mode.value)


def _compressed_text_mode(mode: ast.expr | None) -> bool:
    """A `gzip`, `bz2` or `lzma` mode: text only with a `t`; absent is `rb`; a computed one cannot be proven binary."""
    if mode is None:
        return False
    if isinstance(mode, ast.IfExp):
        return _compressed_text_mode(mode.body) or _compressed_text_mode(mode.orelse)
    if isinstance(mode, ast.Constant):
        return isinstance(mode.value, str) and "t" in mode.value
    return True


def _argument(node: ast.Call, position: int, keyword: str) -> ast.expr | None:
    if len(node.args) > position:
        return node.args[position]
    return next((k.value for k in node.keywords if k.arg == keyword), None)


def _dotted(node: ast.expr) -> str | None:
    """`a.b.c` for a plain name chain, None for anything else."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    return ".".join([node.id, *reversed(parts)]) if isinstance(node, ast.Name) else None


def _import_aliases(tree: ast.AST) -> dict[str, str]:
    """A file's `as` names and what they stand for: `gz` is `gzip`, `o` of `from io import open as o` is `io.open`."""
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            aliases.update((a.asname, a.name) for a in node.names if a.asname)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            aliases.update((a.asname, f"{node.module}.{a.name}") for a in node.names if a.asname)
    return aliases


def _canonical(node: ast.expr | None, aliases: dict[str, str]) -> str | None:
    """`_dotted`, its first name read through the file's import aliases."""
    dotted = _dotted(node) if isinstance(node, (ast.Attribute, ast.Name)) else None
    if dotted is None:
        return None
    head, dot, rest = dotted.partition(".")
    return f"{aliases.get(head, head)}{dot}{rest}"


def _call_parts(node: ast.expr | None, aliases: dict[str, str]) -> tuple[str, str] | None:
    """`(owner, name)` of a call on a plain name chain, None for anything else."""
    func = _canonical(node.func, aliases) if isinstance(node, ast.Call) else None
    if func is None:
        return None
    owner, _, name = func.rpartition(".")
    return owner, name


def _makes_non_path(node: ast.expr | None, aliases: dict[str, str]) -> bool:
    """A call that makes an opener object (`zipfile.ZipFile(p)`, `tarfile.open(p)`), which a name may then hold."""
    parts = _call_parts(node, aliases)
    if parts is None or parts == ZIPFILE_PATH:
        return False
    owner, name = parts
    return (name in NON_PATH_MAKERS or owner in OPENER_OWNERS
            or (name == "open" and owner in NON_PATH_MODULES - NEVER_OPENER_OWNERS))


def _chained_on_a_module(node: ast.expr, aliases: dict[str, str]) -> bool:
    """`tempfile.TemporaryFile().open(m)`: a module call's own result, which no later binding can make a Path."""
    parts = _call_parts(node, aliases)
    return parts is not None and parts != ZIPFILE_PATH and parts[0] in NON_PATH_MODULES - {"request"}


def _non_path_names(tree: ast.AST, aliases: dict[str, str]) -> set[str]:
    """The names in one file bound to such an object (`z = zipfile.ZipFile(p)`, `z: T = …`, `with … as z`)."""
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and _makes_non_path(node.value, aliases):
            names.update(_dotted(target) for target in (node.targets if isinstance(node, ast.Assign) else [node.target]))
        elif isinstance(node, ast.withitem) and node.optional_vars is not None and _makes_non_path(node.context_expr, aliases):
            names.add(_dotted(node.optional_vars))
    return names - {None}


def _is_text_open(node: ast.Call, non_path: set[str], aliases: dict[str, str]) -> bool:
    func = node.func
    if isinstance(func, ast.Name):
        owner, _, name = aliases.get(func.id, func.id).rpartition(".")
        if name != "open":
            return False
        if owner in COMPRESSED_OPENS:
            return _compressed_text_mode(_argument(node, 1, "mode"))
        return (not owner or owner in UNBOUND_OPENS) and _text_mode(_argument(node, 1, "mode"))
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr in ("read_text", "write_text"):
        return True
    if func.attr != "open":
        return False
    receiver = _canonical(func.value, aliases)
    if receiver in COMPRESSED_OPENS:
        return _compressed_text_mode(_argument(node, 1, "mode"))
    if (receiver in NON_PATH_MODULES or _dotted(func.value) in non_path or _makes_non_path(func.value, aliases)
            or _chained_on_a_module(func.value, aliases)):
        return False
    if receiver in UNBOUND_OPENS:
        return _text_mode(_argument(node, 1, "mode"))
    # `x.open(mode)`: a Path's first argument is its mode; arguments a Path cannot take mean another opener.
    if any(k.arg is not None and k.arg not in PATH_OPEN_KEYWORDS for k in node.keywords):
        return False
    if node.args:
        first = node.args[0]
        if isinstance(first, ast.Constant) and not (isinstance(first.value, str) and MODE.match(first.value)):
            return False
        if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) and isinstance(node.args[1].value, str):
            return False
    return _text_mode(_argument(node, 0, "mode"))


def _unencoded(node: ast.Call, non_path: set[str], aliases: dict[str, str]) -> bool:
    if not _is_text_open(node, non_path, aliases):
        return False
    for keyword in node.keywords:
        if keyword.arg is None:  # a `**kwargs`
            return False
        if keyword.arg == "encoding" and not (isinstance(keyword.value, ast.Constant) and keyword.value.value is None):
            return False
    return True


def hits_in(source: str | bytes, label: str) -> list[str]:
    """Every unencoded text-mode call in one file's source, as `<label>:<line> <call>`."""
    hits = []
    tree = ast.parse(source)
    aliases = _import_aliases(tree)
    non_path = _non_path_names(tree, aliases)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _unencoded(node, non_path, aliases):
            call = " ".join(ast.unparse(node).split())
            hits.append((node.lineno, f"{label}:{node.lineno} {call[:CALL_WIDTH]}"))
    return [hit for _, hit in sorted(hits)]


def _python_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.py")
                  if not any(part.startswith(".") for part in p.relative_to(root).parts))


def _scan_step(step: str, roots: list[Path], base: Path) -> dict:
    """One step over `roots`, each file labelled relative to `base`. A file that does not parse is a red hit."""
    files = [path for root in roots for path in _python_files(root)]
    hits: list[str] = []
    for path in files:
        label = path.relative_to(base).as_posix()
        try:
            hits += hits_in(path.read_bytes(), label)
        except (SyntaxError, ValueError) as exc:
            hits.append(f"{label}:{getattr(exc, 'lineno', 0) or 0} unparsable: {exc}")
    if hits:
        return {"step": step, "ok": False, "detail": f"{len(hits)} text-mode call(s) with no encoding=: " + "; ".join(hits)}
    return {"step": step, "ok": True, "detail": f"{len(files)} file(s), every text-mode call names its encoding"}


def _checkout(start: Path) -> Path | None:
    """The folder above ``start`` holding ``apps/supervisor/package.json``."""
    for folder in (start, *start.parents):
        if (folder / "apps" / "supervisor" / "package.json").is_file():
            return folder
    return None


def run(plugin_root: Path = PLUGIN_ROOT) -> dict:
    lib = plugin_root / "lib"
    if lib.is_dir():
        steps = [_scan_step("lib", [lib], plugin_root)]
    else:
        steps = [{"step": "lib", "ok": False, "detail": f"{lib} does not exist"}]
    checkout = _checkout(plugin_root)
    installer = checkout / "tools" / "installer" if checkout else None
    if installer is not None and installer.is_dir():
        steps.append(_scan_step("tools/installer", [installer], checkout))
    else:
        steps.append({"step": "tools/installer", "ok": True, "not_run": "tools/installer absent"})
    app_scripts = sorted(p for p in (checkout / "apps").glob("*/scripts") if p.is_dir()) if checkout else []
    if app_scripts:
        steps.append(_scan_step("apps/*/scripts", app_scripts, checkout))
    else:
        steps.append({"step": "apps/*/scripts", "ok": True, "not_run": "no apps/*/scripts folder"})
    return {"ok": all(s["ok"] for s in steps), "steps": steps}


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="fail a text-mode open with no encoding=")
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
