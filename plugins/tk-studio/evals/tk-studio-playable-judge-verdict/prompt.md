---
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
---

Use the `tk-studio-playable-judge` skill to judge a playable run, headless.
The run's fixture lives in the plugin at
`${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media`
(`report.json` and its frames under `frames/`). Never write under
`${CLAUDE_PLUGIN_ROOT}`: first copy that one folder, fresh, into a folder
under your working directory, replacing any prior copy:

```bash
rm -rf ./tk-studio-playable-judge-verdict
mkdir -p ./tk-studio-playable-judge-verdict
cp -R "${CLAUDE_PLUGIN_ROOT}/evals/tk-studio-playable-judge-verdict/media" ./tk-studio-playable-judge-verdict/media
```

If the copy fails (e.g. the fixture folder is absent), do not search for the
fixture: end `blocked` with the skill's status block, naming the failed copy
as `reason`.

Then judge the copy: the payload is `{media: "media"}` with `directory` the
absolute path of `./tk-studio-playable-judge-verdict` in your working
directory. Follow the skill: prepare through its core
(`playable_judge.py prepare --media <directory>/media`), look at every frame
it lists, write `<directory>/media/answer.json`, record the verdict through
the core (`playable_judge.py verdict`), and end with the status block.

Then print the `judge.json` the core wrote (in the copy), as JSON, and stop.
