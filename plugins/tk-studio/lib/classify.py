"""Shared AD-3 classification patterns — one source for what may never land where.

Two consumers, one truth:
  - ledger.py sanitizes measurement events at emission (redact/mask, NFR5)
  - config.py refuses tracked-file writes outright (classification error, AD-3)

Credential detection is two-pronged: key names that imply a secret, and
well-known value shapes (kept explicit so legitimate content hashes and ids
survive). Machine-path detection covers Windows drive/UNC paths and Unix roots
that imply a machine-specific location.

Stdlib-only (NFR9).
"""
from __future__ import annotations

import re

REDACTED = "«redacted»"
MASKED_PATH = "«path»"

# Keys whose values are always treated as credentials wholesale.
CREDENTIAL_KEY_RE = re.compile(
    r"(?i)(token|secret|passw|api[_-]?key|credential|private[_-]?key|auth)"
)

# Credential-shaped value patterns.
CREDENTIAL_VALUE_RES = [
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{8,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{8,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9._\-]{10,}\b"),  # JWT
    re.compile(r"(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]

# Absolute paths: Windows drive-letter or UNC, and Unix roots that imply a
# machine-specific location.
ABS_PATH_RE = re.compile(
    r"(?:[A-Za-z]:[\\/][^\s\"'|<>]*"
    r"|\\\\[^\s\"'|<>]+"
    r"|(?<![\w./])/(?:home|Users|root|etc|var|opt|tmp|mnt|srv|usr)/[^\s\"'|<>]*)"
)


def find_credentials(text: str) -> list[str]:
    """Pattern names of credential-shaped content found in text."""
    findings = []
    for pattern in CREDENTIAL_VALUE_RES:
        if pattern.search(text):
            findings.append(f"credential-shaped value ({pattern.pattern[:40]}...)")
    return findings


def find_machine_paths(text: str) -> list[str]:
    """Absolute machine paths found in text (the matches themselves)."""
    return [m.group(0) for m in ABS_PATH_RE.finditer(text)]
