"""``tk-studio`` — the meta-CLI's verbs (Story 25.2: the plugin leg; Story
25.4: the app legs and ``status``).

- ``install`` / ``update`` run the legs in order: plugin, bun (only when the
  roster ships a supervisor), supervisor, studio-web and, on ``update``
  only, the CLI's own update (on Windows ``scheduled``: a detached helper
  installs the verified wheel once this process exits). The supervisor and
  studio-web slots are prepared before the service is stopped; studio-web
  is repointed before the supervisor starts, and a refusal after the stop
  rolls back and restarts the old slot. The first refusal ends the verb
  ``blocked``;
  the plugin leg's fields stay top-level and the others go under ``bun``,
  ``supervisor``, ``studio_web`` and ``cli``. ``install --link`` links the
  plugin only.
- ``doctor`` reports the plugin folder's mode and the supervisor's
  (a slot, or a "source checkout" it never replaces); read-only.
- ``status`` prints one line per component (installed vs roster), then
  the JSON line with ``components: {name: {installed, roster}}``.

Every verb prints exactly one JSON object as the last stdout line (AD-11):
``{status: complete|partial|blocked, intent: "tk-studio-cli-<verb>",
artifacts, reason, ...leg fields}``. A refusal is ``blocked`` with a named
reason and exit code 1; a usage error is ``blocked`` with exit code 2;
``-h``/``--help`` prints argparse's help, then a ``complete`` line with
``help: true``, and exits 0.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Mapping

from tk_studio_cli import apps, plugin_leg


VERBS = ("install", "update", "doctor", "status")


class UsageError(Exception):
    """An argparse usage error, turned into a blocked JSON line."""


class HelpRequested(Exception):
    """``-h``/``--help`` printed the help text; the JSON line still follows."""


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # never exit before the JSON line is printed
        raise UsageError(f"{self.prog}: {message}")

    def exit(self, status=0, message=None):
        # Only the help action exits cleanly here (error() never exits).
        if status == 0 and message is None:
            raise HelpRequested()
        super().exit(status, message)


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
                             help="write the plugin folder and install the "
                                  "apps the roster ships")
    install.add_argument("--link", metavar="CHECKOUT", default=None,
                         help="link the folder to <CHECKOUT>/plugins/tk-studio")
    sub.add_parser("update", parents=[roster],
                   help="bring every component to the roster's version")
    sub.add_parser("doctor", help="report the plugin folder's and the "
                   "supervisor's mode (read-only)")
    sub.add_parser("status", parents=[roster],
                   help="print each component's installed and roster "
                        "versions (read-only)")
    return parser


class _OnceFetch:
    """The roster is read by the plugin leg and again for the app legs:
    one download per URL per run."""

    def __init__(self, fetch):
        self.fetch = fetch
        self.cache: dict[str, bytes] = {}

    def __call__(self, url: str) -> bytes:
        if url not in self.cache:
            self.cache[url] = self.fetch(url)
        return self.cache[url]


def run(argv: list[str] | None = None, *, fetch=None, runner=None,
        env: Mapping[str, str] | None = None, platform=None, probe=None,
        env_store=None, sleep=None, clock=None, spawn_detached=None,
        cli_version: str | None = None) -> tuple[dict, int]:
    args = build_parser().parse_args(argv)
    fetch = _OnceFetch(fetch or plugin_leg.default_fetch)
    ctx = apps.make_ctx(env, platform=platform, fetch=fetch, runner=runner,
                        probe=probe, env_store=env_store, sleep=sleep,
                        clock=clock, spawn_detached=spawn_detached,
                        cli_version=cli_version)
    if args.verb == "doctor":
        result = plugin_leg.doctor(env)
        result.update(apps.doctor_fields(ctx))
    elif args.verb == "status":
        try:
            components = plugin_leg.load_roster(
                args.roster, args.channel, fetch)["components"]
        except plugin_leg.Refusal as refusal:
            result = {"status": "blocked", "intent": "tk-studio-cli-status",
                      "artifacts": [], "reason": refusal.reason}
        else:
            result = apps.status(ctx, components, env)
    else:
        link = getattr(args, "link", None)
        result = plugin_leg.run_leg(
            args.verb, roster=args.roster, channel=args.channel,
            link=link, fetch=fetch, runner=runner, env=env)
        if result["status"] != "blocked":
            if link is not None:
                result = apps.link_skipped(args.verb, result)
            else:
                try:
                    components = plugin_leg.load_roster(
                        args.roster, args.channel, fetch)["components"]
                except plugin_leg.Refusal as refusal:
                    # a path roster can change between the two reads
                    result = dict(result, status="blocked",
                                  reason=apps.blocked_reason(
                                      refusal.reason, [result.get("reason")]))
                else:
                    result = apps.run_legs(args.verb, result, components,
                                           ctx)
    return result, 1 if result["status"] == "blocked" else 0


def _intent(argv: list[str] | None) -> str:
    args = sys.argv[1:] if argv is None else argv
    verb = next((a for a in args if a in VERBS), None)
    return f"tk-studio-cli-{verb}" if verb else "tk-studio-cli"


def _blocked(argv: list[str] | None, reason: str) -> dict:
    return {"status": "blocked", "intent": _intent(argv),
            "artifacts": [], "reason": reason}


def main(argv: list[str] | None = None, *, fetch=None, runner=None,
         env: Mapping[str, str] | None = None, **injected) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        result, code = run(argv, fetch=fetch, runner=runner, env=env,
                           **injected)
    except HelpRequested:
        result, code = {"status": "complete", "intent": _intent(argv),
                        "artifacts": [], "reason": None, "help": True}, 0
    except UsageError as exc:
        result, code = _blocked(argv, f"UsageError: {exc}"), 2
    except OSError as exc:  # last resort: AD-11 still gets its JSON line
        result, code = _blocked(argv, f"UnexpectedOSError: "
                                f"{type(exc).__name__}: {exc}"), 1
    except Exception as exc:  # noqa: BLE001 — same last resort, any type
        result, code = _blocked(argv, f"UnexpectedError: "
                                f"{type(exc).__name__}: {exc}"), 1
    for line in result.pop("_lines", None) or ():
        print(line)
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
