"""tk-studio meta-CLI (AD-21). Stdlib only (NFR9).

Story 25.2 lands the plugin leg: ``install``/``update`` write the
skills-dir plugin folder from the roster's verified zip, ``install --link``
links a developer checkout, and ``doctor`` reports the folder's mode.
"""


def _distribution_version() -> str:
    """The version this package reports of itself: the installed
    distribution's metadata (the wheel's ``pyproject.toml`` at build time),
    else the sibling ``pyproject.toml`` of a checkout import. Hole 41
    (2026-10-17): a constant here was never bumped by the release motion, so
    the 0.1.1 launcher reported 0.1.0 against the roster's 0.1.1 and
    ``update`` scheduled its own install on every run."""
    try:
        from importlib.metadata import version
        return version("tk-studio-cli")
    except Exception:  # noqa: BLE001 — no metadata: a bare checkout import
        pass
    import re
    from pathlib import Path
    try:
        text = (Path(__file__).resolve().parent.parent / "pyproject.toml"
                ).read_text(encoding="utf-8")
    except OSError:
        return "0.0.0"
    found = re.search(r'^version = "([^"]+)"$', text, re.M)
    return found.group(1) if found else "0.0.0"


__version__ = _distribution_version()
