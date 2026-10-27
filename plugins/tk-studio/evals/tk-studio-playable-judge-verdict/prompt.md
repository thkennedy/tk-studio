---
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
---

Use the `tk-studio-playable-judge` skill to judge a playable run, headless.
The payload is `{media: "media"}` with `directory` this case's folder (the
folder holding this prompt): the run's `media/report.json` and its frames
under `media/frames/` are already there. Follow the skill: prepare through
its core (`playable_judge.py prepare --media <directory>/media`), look at
every frame it lists, write `media/answer.json`, record the verdict through
the core (`playable_judge.py verdict`), and end with the status block.

Then print the `judge.json` the core wrote, as JSON, and stop.
