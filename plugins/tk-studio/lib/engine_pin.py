#!/usr/bin/env python3
"""tk-studio engine pin — the deterministic core of `gds-engine-godot-4`
(Story 34.4).

Reads a Godot project's pinned engine version and checks it against the
engine-knowledge skill's supported range (`skills/<skill>/pin.json`):

  uv run engine_pin.py check --directory DIR [--skill gds-engine-godot-4]

Reads (never writes):
  project.godot  `[application]` `config/features=PackedStringArray(...)`:
                 the first element matching `^\\d+\\.\\d+$` is `features_version`
  global.json    `msbuild-sdks."Godot.NET.Sdk"` (`godot_net_sdk`) and
                 `sdk.version` (`dotnet_sdk`, reported, never range-checked);
                 an absent global.json is not a refusal
  pin.json       `{"engine", "supported": {"min", "below"}, "tested"}`

`pinned` is `godot_net_sdk` when it is a whole dotted version (a SemVer
`-pre`/`+build` suffix allowed and dropped, so `4.x` or `4abc` is not one), else
`features_version` when that parses (`godot_net_sdk` is reported raw).
Warnings (each a sentence naming both values and the file): `pinned` outside
`[min, below)` (numeric dotted compare); the major.minor of
`features_version` and `godot_net_sdk` disagree (both parseable); a
`Godot.NET.Sdk` value that is not a version; neither readable (`pinned
version unreadable`). Warnings still end `complete`, exit 0.

Refusals end `blocked`, exit 2: `no project.godot`, `unknown skill` (no
`pin.json`), `malformed global.json` (a JSON error once `//` and `/* */`
comments are stripped, as the .NET SDK allows them). Every result ends in
the AD-11 status block with `intent: "gds-engine-godot-4"`.

`recommend.py` imports `read_pin(root)` and `check(root, skill)` as pure
functions; it never spawns this core.

Exit codes: 0 answered; 2 refusal or bad invocation.
Stdlib-only (NFR9). Never prompts, never writes (AD-11).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import _core

INTENT = "gds-engine-godot-4"
DEFAULT_SKILL = "gds-engine-godot-4"
BLOCK_KEYS = _core.BLOCK_KEYS

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = PLUGIN_ROOT / "skills"

PROJECT_FILE = "project.godot"
GLOBAL_JSON = "global.json"
GODOT_SDK = "Godot.NET.Sdk"

_FEATURE_RE = re.compile(r"^\d+\.\d+$")
_FEATURES_LINE_RE = re.compile(r"^\s*config/features\s*=\s*PackedStringArray\((.*)\)\s*$")
# the whole value: dotted numbers, then a SemVer `-pre`/`+build` suffix
# (dropped; allowed only after major.minor.patch, see `_parse`)
_VERSION_RE = re.compile(r"^(\d+(?:\.\d+)*)((?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$")


class Refusal(Exception):
    """A named refusal: the run ends `blocked`, exit 2."""


def with_block(result: dict, status: str, artifacts: list[str],
               reason: str | None) -> dict:
    """``result`` with the AD-11 block keys appended last, in order."""
    return _core.with_block(result, status, artifacts, reason, intent=INTENT)


# ------------------------------------------------------------------- reads

def _features_version(text: str) -> str | None:
    section = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1].strip()
            continue
        if section != "application":
            continue
        match = _FEATURES_LINE_RE.match(line)
        if match:
            for item in re.findall(r'"([^"]*)"', match.group(1)):
                if _FEATURE_RE.match(item.strip()):
                    return item.strip()
            return None
    return None


def _strip_comments(text: str) -> str:
    """``text`` with `//` and `/* */` comments removed outside JSON strings
    (the .NET SDK accepts both in global.json). An unterminated block
    comment is kept, so the text still fails to parse."""
    out: list[str] = []
    i, n, in_str = 0, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            if c == "\\":
                out.append(text[i:i + 2])
                i += 2
                continue
            in_str = c != '"'
        elif c == '"':
            in_str = True
        elif text.startswith("//", i):
            end = text.find("\n", i)
            i = n if end < 0 else end
            continue
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end < 0:
                out.append(text[i:])
                break
            out.append(" ")
            i = end + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _load_global_json(path: Path) -> object:
    """global.json parsed strictly, else once more with comments stripped;
    a `malformed global.json` Refusal when that still fails."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise Refusal(f"malformed global.json: {exc}") from None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    try:
        return json.loads(_strip_comments(text))
    except json.JSONDecodeError as exc:
        raise Refusal(f"malformed global.json: {exc}") from None


def read_pin(root: Path) -> dict:
    """``{features_version, godot_net_sdk, dotnet_sdk}`` read from the
    project, or a named Refusal (`no project.godot`, `malformed
    global.json`). Pure read."""
    return _read(root)[0]


def _read(root: Path) -> tuple[dict, bool, str | None]:
    """``read_pin``'s dict, whether global.json carries a `Godot.NET.Sdk`
    key at all, and that key's raw value as shown text (``repr`` for a
    string, ``json.dumps`` otherwise). A present key whose value is not a
    usable string is reported raw, never treated as absent; the dict's
    ``godot_net_sdk`` stays the stripped non-empty string or ``None``."""
    root = Path(root)
    project = root / PROJECT_FILE
    if not project.is_file():
        raise Refusal(f"no project.godot in {root}")
    try:
        text = project.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise Refusal(f"no project.godot readable in {root}: {exc}") from None
    godot_net_sdk = dotnet_sdk = None
    sdk_present, shown = False, None
    global_json = root / GLOBAL_JSON
    if global_json.is_file():
        doc = _load_global_json(global_json)
        if not isinstance(doc, dict):
            raise Refusal("malformed global.json: not a JSON object")
        sdks = doc.get("msbuild-sdks")
        if isinstance(sdks, dict) and GODOT_SDK in sdks:
            sdk_present = True
            raw = sdks[GODOT_SDK]
            if isinstance(raw, str):
                godot_net_sdk, shown = raw.strip() or None, repr(raw)
            else:
                shown = json.dumps(raw)
        sdk = doc.get("sdk")
        if isinstance(sdk, dict) and isinstance(sdk.get("version"), str):
            dotnet_sdk = sdk["version"].strip() or None
    return ({"features_version": _features_version(text),
             "godot_net_sdk": godot_net_sdk, "dotnet_sdk": dotnet_sdk},
            sdk_present, shown)


def load_supported(skill: str) -> dict:
    """The skill's ``pin.json``, or the `unknown skill` Refusal."""
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", skill or ""):
        raise Refusal(f"unknown skill: {skill!r}")
    path = SKILLS_DIR / skill / "pin.json"
    try:
        pin = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Refusal(f"unknown skill: {skill} (no pin.json)") from None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Refusal(f"unknown skill: {skill} (pin.json unreadable: {exc})") from None
    supported = pin.get("supported") if isinstance(pin, dict) else None
    if not (isinstance(supported, dict) and _parse(supported.get("min"))
            and _parse(supported.get("below"))):
        raise Refusal(f"unknown skill: {skill} (pin.json carries no supported range)")
    return pin


def _parse(version: object) -> tuple[int, ...] | None:
    if not isinstance(version, str):
        return None
    match = _VERSION_RE.match(version.strip())
    # `4.x`, `4abc` and `4-latest` are not versions: no prefix match, and a
    # suffix needs major.minor.patch before it
    if not match or (match.group(2) and match.group(1).count(".") < 2):
        return None
    return tuple(int(p) for p in match.group(1).split("."))


# ------------------------------------------------------------------- check

def check(root: Path, skill: str = DEFAULT_SKILL) -> dict:
    """The pin checked against the skill's range. Pure; raises Refusal."""
    pin = load_supported(skill)
    read, sdk_present, shown = _read(root)
    supported = {"min": pin["supported"]["min"], "below": pin["supported"]["below"]}
    features, sdk = read["features_version"], read["godot_net_sdk"]
    sdk_ok = _parse(sdk) is not None
    features_ok = features is not None and _parse(features) is not None
    pinned = sdk if sdk_ok else (features if features_ok else None)
    pinned_file = (f"{GLOBAL_JSON} msbuild-sdks.{GODOT_SDK}" if sdk_ok
                   else f"{PROJECT_FILE} config/features")
    warnings: list[str] = []
    in_range: bool | None = None
    if sdk_present and not sdk_ok:
        warnings.append(
            f"{GLOBAL_JSON} msbuild-sdks.{GODOT_SDK} {shown} is not a version; "
            + (f"pinned from {PROJECT_FILE} config/features {features}"
               if features_ok else "nothing else pins the engine"))
    if pinned is None:
        warnings.append(
            f"pinned version unreadable: no version in {PROJECT_FILE} "
            f"config/features and no {GODOT_SDK} "
            f"{'version ' if sdk_present else ''}in {GLOBAL_JSON}")
    else:
        lo, hi, got = _parse(supported["min"]), _parse(supported["below"]), _parse(pinned)
        in_range = lo <= got < hi
        if not in_range:
            warnings.append(
                f"pinned {pinned} (from {pinned_file}) is outside {skill}'s "
                f"supported range {supported['min']}..<{supported['below']} "
                f"(pin.json)")
    if features_ok and sdk_ok:
        if _parse(features)[:2] != _parse(sdk)[:2]:
            warnings.append(
                f"major.minor disagreement: {PROJECT_FILE} config/features "
                f"{features} vs {GLOBAL_JSON} {GODOT_SDK} {sdk}")
    return {"engine": pin.get("engine"), "features_version": features,
            "godot_net_sdk": sdk, "dotnet_sdk": read["dotnet_sdk"],
            "pinned": pinned, "supported": supported, "in_range": in_range,
            "warnings": warnings}


# --------------------------------------------------------------------- cli

class _Parser(argparse.ArgumentParser):
    """A bad invocation is a refusal with a status block, never a usage
    dump alone."""

    def error(self, message: str):  # noqa: D401 - argparse hook
        raise Refusal(f"bad invocation: {message}")


def _emit(result: dict) -> None:
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    # Headless output must survive a cp1252 Windows console (AD-11).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = _Parser(description="tk-studio engine pin — the project's engine version vs the skill's range")
    sub = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    c = sub.add_parser("check", help="read the project's pin; check it against pin.json")
    c.add_argument("--directory", required=True, help="the Godot project root")
    c.add_argument("--skill", default=DEFAULT_SKILL, help="the engine-knowledge skill")
    try:
        args = parser.parse_args(argv)
        result = check(Path(args.directory), args.skill)
    except Refusal as exc:
        _emit(with_block({"ok": False, "error": str(exc)}, "blocked", [], str(exc)))
        return 2
    _emit(with_block({"ok": True, **result}, "complete", [], None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
