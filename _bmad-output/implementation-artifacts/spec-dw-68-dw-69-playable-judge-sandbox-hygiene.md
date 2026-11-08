---
title: 'DW-68, DW-69: the playable judge deny profile and its sandbox pin release'
type: 'bugfix'
created: '2026-11-08'
status: 'blocked'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
warnings: ['multiple-goals']
deferred: []
deviation_score: 0
---

# DW-68, DW-69: the playable judge deny profile and its sandbox pin release

## Intent (from the bundle)

Bundle `playable-judge-sandbox-hygiene` (`.bmad-loop/runs/20261108-093536-6e94/bundles/playable-judge-sandbox-hygiene/intent.md`):
- DW-68 (TKSTUDIO-224, option A): ship a judge deny profile through `invokeSkill`'s `deny_profile` — "no Edit/Write/Bash and no Read of the project's code, `plugins`, `apps` and `_bmad-output` folders" — passed by `defaultJudge` (`apps/supervisor/src/hostverify.ts:758`) and pinned by a test.
- DW-69: release the sandbox `defaultJudge` pinned for a re-run on an ended run (`releasePin`'s holder rule, `apps/supervisor/src/sandbox.ts:173-218`), or record the pin; pin the release in a test.

## Deviation Summary

None. No code was changed.

## Investigation (for the re-drive)

- `plugins/tk-studio/skills/tk-studio-playable-judge/SKILL.md:27,58`: the judge runs `playable_judge.py prepare`/`verdict` through Bash; `:44,54`: it Writes `<media>/answer.json`, and the core writes `<media>/judge.json`.
- `apps/supervisor/src/hostverify.ts:947`: the host requires `<media>/judge.json`; without it the leg fails (`judge: no readable judge.json verdict`).
- Claude Code `permissions.deny` takes no exceptions, so a bare `Bash`/`Write` deny leaves the judge unable to write `judge.json`, and every playable leg fails.
- `apps/supervisor/src/server.ts:444-515`: on the sbx tier a deny profile must be an absolute file inside the served root (the worktree), shaped exactly `{"permissions":{"deny":[...]}}`. The plugin tree is outside a project worktree, so the leg would have to write the profile into the worktree (for example beside the media, `.bmad-loop/runs/<engine>/`).
- The media folder `.bmad-loop/runs/<engine>/playable` (`hostverify.ts:841-842`) lies outside every folder the ruling denies.
- DW-69 does not depend on the deny-profile decision. It was not implemented on its own because the consult ruled that the bundle halt.

## Consult Log

- 2026-11-08T12:55Z — trigger: halt — question: TKSTUDIO-224's literal deny list (bare Edit/Write/Bash) breaks the judge, whose SKILL.md needs Bash (`uv run playable_judge.py`) and Write (`answer.json`) to produce the `judge.json` the host requires. Should the session implement (A) the literal list plus a judge/host rework, (B) a scoped list (bare Edit; Write/Read denied in plugins/apps/_bmad-output/code folders; Bash open), or escalate? — ruling: escalate — do: HALT the bundle, leave DW-68 open, and put the choice to the operator: (B) path-scoped Write/Read denials plus bare Edit, with Bash left open, versus (A) the literal Edit/Write/Bash denial with the host running `playable_judge.py prepare`/`verdict` itself and the skill's "verdict lives in judge.json" contract changed — rule candidate: Before the sweep plans a bundle around an owner ruling that names a deny profile, check the profile against the tool calls the target skill's SKILL.md makes; a bare deny on a tool the skill needs goes back to the owner with options before the bundle is planned.

## Auto Run Result

Status: blocked
Blocking condition: consult escalated (operator decision needed): TKSTUDIO-224's literal judge deny list (no Edit/Write/Bash) cannot ship without breaking the judge, whose SKILL.md uses Bash (`uv run playable_judge.py prepare|verdict`) and Write (`answer.json`) to produce the `judge.json` the host leg requires (`hostverify.ts:947`). The operator chooses between (B) bare `Edit` plus path-scoped `Write(...)`/`Read(...)` denials for `./plugins/**`, `./apps/**`, `./_bmad-output/**` and the code folders, with Bash left open, and (A) the literal deny list plus a rework in which the host runs the judge core and the skill's judge.json contract changes. DW-69 (the pin release) does not depend on this choice and can be re-bundled alone.
Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T093348Z-f76978` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Code changes: none. Ledger untouched.
