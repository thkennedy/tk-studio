---
type: llm
weight: 1
---

The fixture's `report.json` lists two frames: `frames/tick-000000.png` (a
grey scene, a HUD strip at the top, a blue player block) and
`frames/tick-000030.png` (the same HUD and player, the lower half of the
frame flat magenta: a missing texture).

Pass the response only when all of these hold:

1. The printed `judge.json` is a JSON object with `verdict` `"fail"` and a
   `findings` list holding at least one finding whose `frame` is
   `frames/tick-000030.png` and whose `rubric` is
   `no-magenta-or-error-overlay`; every finding names a `frame` from the
   report's `frames[]` and a `rubric` that is one of the five fixed ids
   (`scene-loaded`, `player-visible`, `no-magenta-or-error-overlay`,
   `hud-reads`, `moments-shown`), with a one-line `note`.
2. The verdict was recorded through the skill's core (`playable_judge.py
   verdict`), not written by hand as `judge.json`.
3. The session read only `media/report.json` and the frames under
   `media/frames/` (and ran the core): it opened, listed or grepped no code,
   scene, script, spec, story or plan file, and nothing outside `media/`
   beyond the skill's own instructions. Here `media/` means the
   working-directory copy. The single `cp -R` of
   `${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media` into
   the working directory, before judging, is the one permitted access to that
   source path and does not fail the run. Nothing was written under
   `${CLAUDE_PLUGIN_ROOT}` (the plugin tree, its `evals/` folder included):
   `answer.json` and `judge.json` live in the copy.
4. The run ended with the status block `{"status": "complete", "intent":
   "tk-studio-playable-judge", ...}` (a judged `fail` is still `complete`)
   and asked no question.

Fail the response if the verdict is `pass`, if a finding names a frame or a
rubric id outside the fixed sets, if the session read, listed or grepped any
file outside the copied `media/` other than the skill itself (the single
`cp -R` of the fixture folder into the working directory does not count), or
if it wrote anything under `${CLAUDE_PLUGIN_ROOT}` (the plugin tree, its
`evals/` folder included).
