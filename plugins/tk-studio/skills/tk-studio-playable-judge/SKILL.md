---
name: tk-studio-playable-judge
description: The playable-verify leg's screenshot judge (Story 34.3) — reads only a playable run's report.json and its frames, answers the fixed rubric (scene loaded, player visible and framed, no magenta or error overlay, HUD reads, the named moments shown) with pass or fail and findings each naming a frame and a rubric line. Driven headless by the supervisor's host leg on the project's sandbox tier; use when the payload names a playable `media` folder, or the user says "judge the playable frames".
---

# tk-studio-playable-judge

The host leg's third step (after a green engine gate) runs `playable.py run`
on the host and copies its media into the worktree's ignored
`.bmad-loop/runs/<engine>/playable/`. This session judges those frames. It is
a screenshot judge, nothing more.

## What it may read

- **Only** `report.json` and the frames (`frames/*.png`) under the payload's
  `media` folder (relative to the payload `directory`).
- **Never** the project's code, scenes, scripts, the spec, the story, the
  plan or any other file. Do not list, grep or open anything outside `media`.
  A judge that read the code would grade intent, not what the game showed.

## Behavior (headless)

1. Prepare through the deterministic core (it validates the report and the
   frames, and prints the frame list, the moments and the rubric):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/playable_judge.py" prepare --media "<directory>/<media>"
   ```

   A `blocked` result (`no report.json`, `malformed report: <field>`,
   `no frames`) ends the run `blocked` with that reason.

2. Look at every frame the core listed (`Read` on each PNG) and answer each
   rubric line by its fixed id:

   | id | rubric line |
   |----|-------------|
   | `scene-loaded` | the scene loaded |
   | `player-visible` | the player is visible and framed |
   | `no-magenta-or-error-overlay` | no missing-texture magenta and no error overlay |
   | `hud-reads` | the HUD reads |
   | `moments-shown` | the scenario's named moments appear in the frames they name |

3. Write the answer to a file under `media` (`answer.json`):

   ```json
   {"verdict": "fail", "findings": [{"frame": "frames/tick-000030.png", "rubric": "hud-reads", "note": "the HUD is clipped off the right edge"}]}
   ```

   `verdict` is `pass` or `fail`. Every finding names one frame from the
   core's list and one rubric id, with a one-line note. A `fail` carries at
   least one finding. A `pass` may carry none.

4. Record the verdict through the core (it writes `<media>/judge.json`, the
   file the host leg reads back):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/playable_judge.py" verdict --media "<directory>/<media>" --answer "<directory>/<media>/answer.json"
   ```

   A refusal (`unknown rubric id`, `frame not in frames[]`, `fail with no
   findings`, `malformed answer`) may be corrected once by rewriting the
   answer; a second refusal ends the run `blocked` with that reason.

5. End with the status block (the verdict lives in `judge.json`, never in
   the block; a judged `fail` is still a `complete` run):

   ```json
   {"status": "complete", "intent": "tk-studio-playable-judge", "artifacts": ["judge.json"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Never prompt or ask: everything arrives in the payload (`media`,
  `directory`); a missing `media` is a `blocked` status (AD-11).
- Never edit the frames, `report.json` or anything outside `media`; the only
  files this session writes are `answer.json` and (through the core)
  `judge.json`.
- All plugin paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
