"""``tk-studio`` — the meta-CLI's verbs (Story 25.2: the plugin leg).

Every verb prints exactly one JSON object as the last stdout line (AD-11):
``{status: complete|partial|blocked, intent: "tk-studio-cli-<verb>",
artifacts, reason, ...leg fields}``. A refusal is ``blocked`` with a named
reason and exit code 1; a usage error is ``blocked`` with exit code 2.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Mapping

from tk_studio_cli import plugin_leg


VERBS = ("install", "update", "doctor")


class UsageError(Exception):
    """An argparse usage error, turned into a blocked JSON line."""


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # never exit before the JSON line is printed
        raise UsageError(f"{self.prog}: {message}")


def build_parser() -> argparse.ArgumentParser:
    roster = _Parser(add_help=False)
    roster.add_argument("--roster", default=None,
                        help="roster path or https URL (default: the raw main "
                             "URL of tools/installer/rosters/<channel>.json)")
    roster.add_argument("--channel", choices=plugin_leg.CHANNELS,
                        default="stable")
    parser = _Parser(prog="tk-studio")
    sub = parser.add_subparsers(dest="verb", required=True)
    install = sub.add_parser("install", parents=[roster],
                             help="write the skills-dir plugin folder")
    install.add_argument("--link", metavar="CHECKOUT", default=None,
                         help="link the folder to <CHECKOUT>/plugins/tk-studio")
    sub.add_parser("update", parents=[roster],
                   help="rewrite the folder from the roster")
    sub.add_parser("doctor", help="report the folder's mode (read-only)")
    return parser


def run(argv: list[str] | None = None, *, fetch=None, runner=None,
        env: Mapping[str, str] | None = None) -> tuple[dict, int]:
    args = build_parser().parse_args(argv)
    if args.verb == "doctor":
        result = plugin_leg.doctor(env)
    else:
        result = plugin_leg.run_leg(
            args.verb, roster=args.roster, channel=args.channel,
            link=getattr(args, "link", None), fetch=fetch, runner=runner,
            env=env)
    return result, 1 if result["status"] == "blocked" else 0


def _blocked(argv: list[str] | None, reason: str) -> dict:
    args = sys.argv[1:] if argv is None else argv
    verb = next((a for a in args if a in VERBS), None)
    return {"status": "blocked",
            "intent": f"tk-studio-cli-{verb}" if verb else "tk-studio-cli",
            "artifacts": [], "reason": reason}


def main(argv: list[str] | None = None, *, fetch=None, runner=None,
         env: Mapping[str, str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        result, code = run(argv, fetch=fetch, runner=runner, env=env)
    except UsageError as exc:
        result, code = _blocked(argv, f"UsageError: {exc}"), 2
    except OSError as exc:  # last resort: AD-11 still gets its JSON line
        result, code = _blocked(argv, f"UnexpectedOSError: "
                                f"{type(exc).__name__}: {exc}"), 1
    except Exception as exc:  # noqa: BLE001 — same last resort, any type
        result, code = _blocked(argv, f"UnexpectedError: "
                                f"{type(exc).__name__}: {exc}"), 1
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
