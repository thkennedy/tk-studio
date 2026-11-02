"""The deferred-work ledger's one parser (Story 37.1, DW-149, hole 107).

`parse_ledger` reads `_bmad-output/implementation-artifacts/deferred-work.md`
into its `### DW-N:` entries and refuses a duplicate heading by name
(`LedgerDuplicateId: DW-N at lines a and b`), so a doubled id goes red at the
gate, never a silent first-wins. `plansync.py ledger-resolve` and `deferred
mint`, the `launch.py sweep` preflight and `tests/test_dwledger.py` read it.

The marker helpers keep the header's one comment line the upstream engine reads:
its `next_seq` is one past the highest `DW-N` anywhere in the ledger text, so the
marker reserves the counter's last id for a harvest on a run branch. No studio
parser reads the marker as an entry. A leaf beside `_core`. Stdlib-only (NFR9).
"""
from __future__ import annotations

import re
from typing import NamedTuple

from _core import Refusal

_HEAD_RE = re.compile(r"^### (DW-\d+):", re.MULTILINE)
_ANY_HEAD_RE = re.compile(r"^#{1,6} ", re.MULTILINE)
_STATUS_RE = re.compile(r"^status:[ \t]*(.*)$", re.MULTILINE)
_ANY_ID_RE = re.compile(r"\bDW-(\d+)\b")  # the engine's DW_ID_RE (deferredwork.next_seq)
_MARKER_RE = re.compile(r"^<!-- deferred-work counter: last minted DW-\d+; "
                        r"mint through plansync\.py deferred mint -->$", re.MULTILINE)
_TITLE_RE = re.compile(r"\A# [^\n]*(?:\n+|\Z)")


class LedgerDuplicateId(Refusal):
    """Two `### DW-N:` headings: the message names the id and both lines."""


class Entry(NamedTuple):
    """One entry: `start`/`end` its span in the text (it ends at the next
    heading of any level), `line` its heading's 1-based line, `status` the
    `status:` value or None when the entry has no such line."""
    id: str
    line: int
    start: int
    end: int
    status: str | None


def parse_ledger(text: str) -> list[Entry]:
    """The entries in file order; raises LedgerDuplicateId on a doubled heading."""
    heads = list(_HEAD_RE.finditer(text))
    seen: dict[str, int] = {}
    entries: list[Entry] = []
    for i, m in enumerate(heads):
        dw = m.group(1)
        line = text.count("\n", 0, m.start()) + 1
        if dw in seen:
            raise LedgerDuplicateId(f"LedgerDuplicateId: {dw} at lines {seen[dw]} and {line}")
        seen[dw] = line
        limit = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        other = _ANY_HEAD_RE.search(text, m.end(), limit)
        end = other.start() if other else limit
        status = _STATUS_RE.search(text, m.start(), end)
        entries.append(Entry(dw, line, m.start(), end, status.group(1).strip() if status else None))
    return entries


def highest_id(text: str) -> int:
    """The highest `DW-N` anywhere in the text, 0 when there is none: headings,
    body and the marker all count, as in the engine's `next_seq`."""
    return max((int(m.group(1)) for m in _ANY_ID_RE.finditer(text)), default=0)


def marker_line(last: int) -> str:
    """The header's marker: the counter's last minted id."""
    return (f"<!-- deferred-work counter: last minted DW-{last}; "
            "mint through plansync.py deferred mint -->")


def with_marker(text: str, last: int) -> str:
    """``text`` with its one marker line reading ``last``; every other byte
    kept. A ledger with no marker gets it under the title (or on top)."""
    line = marker_line(last)
    if _MARKER_RE.search(text):
        return _MARKER_RE.sub(lambda _: line, text, count=1)
    title = _TITLE_RE.match(text)
    at = title.end() if title else 0
    head = text[:at]
    if head and not head.endswith("\n\n"):
        head = head.rstrip("\n") + "\n\n"
    return f"{head}{line}\n\n{text[at:]}"
