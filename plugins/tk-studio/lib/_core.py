"""The lib's shared scaffolding (Story 36.7, DW-86): the AD-11 status block,
the atomic write, the User environment read and the engine binary resolution.

A leaf: it imports no lib module. Each caller keeps its own name and wording
(`assets.with_block`, `playable.resolve_godot`, ...), so the tests' imports and
patch targets hold. Stdlib-only (NFR9).
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import NamedTuple

# the AD-11 status block, last in every result and in this order (section 3)
BLOCK_KEYS = ("status", "intent", "artifacts", "reason")


class Refusal(Exception):
    """A refusal: nothing changed (`assets.Refusal`; status blocked, exit 2)."""


def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None, *, intent: str) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    out = {k: v for k, v in result.items() if k not in BLOCK_KEYS}
    out.update(status=status, intent=intent, artifacts=list(artifacts), reason=reason)
    return out


def _write_atomic(path: Path, data: bytes) -> None:
    """``data`` at ``path``, whole or not at all (a temp file beside it,
    flushed, then ``os.replace``)."""
    tmp = path.with_name(f"{path.name}.tk-studio-{os.getpid()}.tmp")
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def _hkcu_value(name: str):
    """``HKCU\\Environment``'s value for ``name`` through winreg (Windows
    only; None elsewhere or when unset). A module attribute of
    each re-exporter, so tests stub it there."""
    if os.name != "nt":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            return winreg.QueryValueEx(key, name)[0]
    except (ImportError, OSError):
        return None


def user_env(name: str, env=None, *, read=None) -> str | None:
    """A User environment variable by name: ``HKCU\\Environment`` on
    Windows (set without a new terminal), then the process env. The value
    is returned to the caller only; it is never printed or written. ``read``
    is the registry read (default ``_hkcu_value``)."""
    value = (_hkcu_value if read is None else read)(name)
    if isinstance(value, str) and value.strip():
        return value.strip()
    env = os.environ if env is None else env
    value = (env.get(name) or "").strip()
    return value or None


class Binary(NamedTuple):
    """A resolved binary (``path``), or why not (``problem``: ``unset``,
    ``empty``, ``not-absolute``, ``missing`` or ``not-file``); ``name`` is
    where the value came from and ``value`` what it said."""
    path: str | None
    problem: str | None
    name: str
    value: str


def resolve_binary(arg: str | None, env, var: str, *, flag: str = "",
                   require_absolute: bool = False,
                   allow_which: str | None = None) -> Binary:
    """``arg`` (the ``flag``), else ``env[var]`` (stripped), else, with
    ``allow_which``, that program on ``env``'s PATH. Answers, never raises:
    the wording is each caller's."""
    name = flag if arg is not None else var
    value = (arg if arg is not None else env.get(var) or "").strip()
    if not value:
        if arg is not None:
            return Binary(None, "empty", name, value)
        found = shutil.which(allow_which, path=env.get("PATH")) if allow_which else None
        return Binary(found, None if found else "unset", name, value)
    path = Path(value)
    if require_absolute and not path.is_absolute():
        return Binary(None, "not-absolute", name, value)
    if not path.is_file():
        return Binary(None, "not-file" if path.exists() else "missing", name, value)
    return Binary(str(path), None, name, value)
