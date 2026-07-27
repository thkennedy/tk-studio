# tk-studio plugin

The studio layer, delivered as a Claude Code plugin from this repo's own git
marketplace (AD-1). Structure per the architecture spine's structural seed:

- `skills/tk-studio-*/` — studio skills. Seed roster: `activate`,
  `orchestrator`, `detect`, `onboard`, `plan-sync`, `migrate`, `report`,
  `measure-push`, `consolidate`, `base-update`, `job`.
- `agents/` — thin role wrappers over the stateless orchestrator core (AD-9,
  AD-17). v1 roster arrives with Epic 5: `direction-giver`, `developer`. No
  markdown lands here until it is a real agent definition — the plugin loader
  treats every `.md` in this directory as one.
- `contracts/` — versioned schemas + driver contract + conformance suite (see
  `contracts/README.md`).
- `bmad.lock` — the BMad base pin; written only by `tk-studio-base-update`.

Versioning: `plugin.json` `version` and `marketplace.json` `plugins[].version`
move in lockstep — the drift check (AD-13) asserts they match.

Conventions binding every skill here: dual-mode invariant with terminal JSON
status block (AD-11), writes classified before landing (AD-3), model/effort
defaults in each resource's `customize.toml` (AD-14), stdlib-only Python via
`uv run` (NFR9).
