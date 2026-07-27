"""Minimal YAML subset reader/writer for tk-studio's plain-files data plane.

The studio's YAML surface (store config, project config, registry) is a
deliberately small subset so a stdlib-only parser stays trustworthy (NFR9):

  - mappings nested by indentation (2 spaces per level on dump; any consistent
    deeper indent on load)
  - lists of scalars ("- item" lines)
  - scalars: null/~, true/false, int, float, single/double-quoted or plain
    strings
  - full-line and trailing comments ("# ..." — a space before '#' required for
    trailing)

Anything outside the subset (anchors, flow collections, multiline strings,
lists of mappings, tabs) raises MiniYamlError rather than guessing — the same
refuse-to-guess posture as AD-3. Round trip is value-stable, not
comment-stable: dump() writes a canonical form without comments, so callers
that must preserve human comments edit files as text and use load() only.
"""
from __future__ import annotations

import re
from pathlib import Path

__all__ = ["MiniYamlError", "load", "loads", "dump", "dumps"]


class MiniYamlError(Exception):
    """Input is outside the supported YAML subset, or malformed."""


_INT_RE = re.compile(r"^-?\d+$")
_FLOAT_RE = re.compile(r"^-?\d+\.\d+$")
# Plain strings that dump() may emit unquoted: no YAML-significant leading or
# embedded characters, and not parseable as another scalar type.
_SAFE_PLAIN_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_\-./ @+()\\:~]*$")


# -------------------------------------------------------------------- load

def _strip_comment(line: str) -> str:
    """Remove a trailing comment, honoring quoted strings."""
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            return line[:i]
    if quote:
        raise MiniYamlError(f"unterminated quote: {line.strip()!r}")
    return line


def _parse_scalar(text: str) -> object:
    text = text.strip()
    if text in ("null", "~", ""):
        return None
    if text == "true":
        return True
    if text == "false":
        return False
    if _INT_RE.match(text):
        return int(text)
    if _FLOAT_RE.match(text):
        return float(text)
    if text[0] in "'\"":
        if len(text) < 2 or text[-1] != text[0]:
            raise MiniYamlError(f"malformed quoted scalar: {text!r}")
        body = text[1:-1]
        if text[0] == "'":
            return body.replace("''", "'")
        return body.replace('\\"', '"').replace("\\\\", "\\")
    for forbidden in ("{", "[", "&", "*", "|", ">"):
        if text.startswith(forbidden):
            raise MiniYamlError(f"unsupported YAML construct: {text!r}")
    return text


def _tokenize(text: str) -> list[tuple[int, str]]:
    tokens = []
    for raw in text.splitlines():
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise MiniYamlError("tabs in indentation are not supported")
        line = _strip_comment(raw).rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        tokens.append((indent, line.strip()))
    return tokens


def _parse_block(tokens: list[tuple[int, str]], pos: int, indent: int):
    """Parse one block (mapping or list) at `indent`; returns (value, next_pos)."""
    if tokens[pos][1].startswith("- ") or tokens[pos][1] == "-":
        return _parse_list(tokens, pos, indent)
    return _parse_mapping(tokens, pos, indent)


def _parse_list(tokens, pos, indent):
    items = []
    while pos < len(tokens) and tokens[pos][0] == indent:
        head = tokens[pos][1]
        if not (head.startswith("- ") or head == "-"):
            break
        body = head[2:].strip() if head.startswith("- ") else ""
        if not body:
            raise MiniYamlError("empty or nested list items are not supported")
        if body.endswith(":") or ": " in body:
            raise MiniYamlError("lists of mappings are not supported")
        items.append(_parse_scalar(body))
        pos += 1
    return items, pos


def _parse_mapping(tokens, pos, indent):
    mapping: dict = {}
    while pos < len(tokens):
        tok_indent, content = tokens[pos]
        if tok_indent < indent:
            break
        if tok_indent > indent:
            raise MiniYamlError(f"unexpected indent at: {content!r}")
        if content.startswith("- ") or content == "-":
            raise MiniYamlError(f"list item where mapping key expected: {content!r}")
        if ":" not in content:
            raise MiniYamlError(f"expected 'key: value', got: {content!r}")
        key_part, _, value_part = content.partition(":")
        key = key_part.strip()
        if not key or key[0] in "'\"":
            raise MiniYamlError(f"unsupported mapping key: {key_part!r}")
        if key in mapping:
            raise MiniYamlError(f"duplicate key: {key!r}")
        value_part = value_part.strip()
        pos += 1
        if value_part:
            mapping[key] = _parse_scalar(value_part)
        elif pos < len(tokens) and tokens[pos][0] > indent:
            mapping[key], pos = _parse_block(tokens, pos, tokens[pos][0])
        else:
            mapping[key] = None
    return mapping, pos


def loads(text: str) -> dict:
    tokens = _tokenize(text)
    if not tokens:
        return {}
    if tokens[0][0] != 0:
        raise MiniYamlError("document must start at column 0")
    value, pos = _parse_mapping(tokens, 0, 0)
    if pos != len(tokens):
        raise MiniYamlError(f"trailing content at: {tokens[pos][1]!r}")
    return value


def load(path: Path) -> dict:
    return loads(Path(path).read_text(encoding="utf-8"))


# -------------------------------------------------------------------- dump

def _dump_scalar(value: object) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if not isinstance(value, str):
        raise MiniYamlError(f"unsupported scalar type: {type(value).__name__}")
    if _SAFE_PLAIN_RE.match(value) and _parse_scalar(value) == value:
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _dump_block(value: dict, indent: int, lines: list[str]) -> None:
    pad = " " * indent
    for key, item in value.items():
        if not isinstance(key, str) or not key or ":" in key or key.strip() != key:
            raise MiniYamlError(f"unsupported mapping key: {key!r}")
        if isinstance(item, dict):
            lines.append(f"{pad}{key}:")
            if item:
                _dump_block(item, indent + 2, lines)
        elif isinstance(item, list):
            lines.append(f"{pad}{key}:")
            for element in item:
                if isinstance(element, (dict, list)):
                    raise MiniYamlError("lists of collections are not supported")
                lines.append(f"{pad}  - {_dump_scalar(element)}")
        else:
            lines.append(f"{pad}{key}: {_dump_scalar(item)}")


def dumps(data: dict) -> str:
    if not isinstance(data, dict):
        raise MiniYamlError("top-level value must be a mapping")
    lines: list[str] = []
    _dump_block(data, 0, lines)
    return "\n".join(lines) + ("\n" if lines else "")


def dump(data: dict, path: Path) -> None:
    Path(path).write_text(dumps(data), encoding="utf-8", newline="\n")
