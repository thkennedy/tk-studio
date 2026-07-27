"""bmad.lock and _bmad manifest readers shared by install / drift / base-update.

bmad.lock is intentionally a small, fixed YAML shape (lock_version, core,
install, modules) written only by tk-studio-base-update. This module parses
exactly that shape with the stdlib (NFR9) — it is not a general YAML parser,
and unknown structure fails loudly rather than being guessed at.

Also reads the slice of the upstream installer's _bmad/_config/manifest.yaml
needed to compare installed module versions against the lock (AD-13).
"""
from __future__ import annotations

import re
from pathlib import Path


class LockParseError(Exception):
    """bmad.lock (or manifest) did not match the expected shape."""


def _parse_block_lines(text: str):
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        yield indent, line.strip()


def parse_lock(path: Path) -> dict:
    """Parse bmad.lock into {lock_version, core: {}, install: {}, modules: {name: {}}}."""
    if not path.is_file():
        raise LockParseError(f"bmad.lock not found at {path}")
    root: dict = {}
    # stack of (indent, container) — containers are dicts keyed by YAML key,
    # or lists collecting "- item" entries
    stack: list[tuple[int, object]] = [(-1, root)]
    for indent, content in _parse_block_lines(path.read_text(encoding="utf-8")):
        while stack and indent <= stack[-1][0]:
            stack.pop()
        if not stack:
            raise LockParseError(f"indentation error near: {content!r}")
        container = stack[-1][1]
        if content.startswith("- "):
            if not isinstance(container, _Pending):
                raise LockParseError(f"list item outside a block: {content!r}")
            container.append(content[2:].strip())
            continue
        m = re.match(r"^([\w.\-]+):\s*(.*)$", content)
        if not m:
            raise LockParseError(f"unparseable line: {content!r}")
        key, value = m.group(1), m.group(2).strip()
        if not isinstance(container, dict):
            raise LockParseError(f"mapping entry inside a list: {content!r}")
        if value:
            container[key] = value
        else:
            # Look ahead is not available line-by-line; create a dict and swap
            # to a list on the first "- " child (see below).
            child = _Pending()
            container[key] = child
            stack.append((indent, child))
    return _resolve_pending(root)


class _Pending(dict):
    """Nested block whose kind (dict vs list) is decided by its first child."""

    def append(self, item):  # duck-type as a list for "- " children
        self.setdefault("__items__", [])
        self["__items__"].append(item)


def _resolve_pending(node):
    if isinstance(node, _Pending):
        if "__items__" in node and len(node) == 1:
            return [_resolve_pending(i) for i in node["__items__"]]
        return {k: _resolve_pending(v) for k, v in node.items() if k != "__items__"}
    if isinstance(node, dict):
        return {k: _resolve_pending(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_resolve_pending(i) for i in node]
    return node


def lock_pins(lock: dict) -> dict[str, str]:
    """Flatten a parsed lock into {module_or_'core': version}."""
    pins = {"core": lock["core"]["version"]}
    for name, spec in lock.get("modules", {}).items():
        pins[name] = spec["version"] if isinstance(spec, dict) else str(spec)
    return pins


def read_installed_manifest(manifest_path: Path) -> dict[str, str]:
    """Read {module: version} (core included) from _bmad/_config/manifest.yaml."""
    if not manifest_path.is_file():
        raise LockParseError(f"installed manifest not found at {manifest_path}")
    versions: dict[str, str] = {}
    current: str | None = None
    for raw in manifest_path.read_text(encoding="utf-8").splitlines():
        m_name = re.match(r"^\s+-\s+name:\s*(\S+)", raw)
        if m_name:
            current = m_name.group(1)
            continue
        m_ver = re.match(r"^\s+version:\s*(\S+)", raw)
        if m_ver and current and current not in versions:
            versions[current] = m_ver.group(1)
    if not versions:
        raise LockParseError(f"no module versions found in {manifest_path}")
    return versions
