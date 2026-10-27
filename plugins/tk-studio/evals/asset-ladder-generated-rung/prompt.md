---
max_turns: 10
allowed_tools: [Read, Glob, Grep]
---

I run the tk-studio plugin's asset ladder (`lib/assets.py`, Stories 34.6
and 34.7) on a game project on the studio's Windows agent PC. The greybox
and cc0 rungs work. How do I turn the **generated** rung on, so that
`assets.py generate` may call the paid generator for the entries with
`rung: generated`? Read the plugin's own docs to answer (the asset ladder
note under `kb/`, the driver contract's asset manifest section and the
`assets.py` docstring), then answer in at most ten lines: which file and
key set the cap and in what unit, where the generator's API key lives and
how it is set, and what the cap bounds.
