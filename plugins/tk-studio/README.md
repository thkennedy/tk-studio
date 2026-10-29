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

## Sandbox notes for the suites

Story 35.5 (hole 84, DW-80). The engine's sandbox (`claude-tk-studio`) and the
host must disagree only on what the box has, so these are the sandbox's own
shape:

- **bun:** the sandbox's bun is at `~/.bun/bin`, not on the default PATH.
  Run `export PATH=$HOME/.bun/bin:$PATH` before any `bun test` in
  `apps/supervisor`.
- **`TK_STUDIO_ROOT` is unset in the sandbox.** On the host it is a user
  variable, so a test that spreads `process.env` into its fake env inherits
  it there and not here. That was the cause of the 15 Story 32.8
  closeout-pass tests red only in the sandbox (`test/delivery.test.ts`):
  `runCloseout`/`closeIssue` reach `studioScript` → `pluginRoot` →
  `studioRoot`, which throws `StudioRootMissing`, and `closeoutPass`
  swallows the throw (the engagement waits for the next pass), so nothing
  closed. Fixed in the test: `deps()`'s env carries `TK_STUDIO_ROOT` (the
  repo root). Never set `TK_STUDIO_ROOT` suite-wide to "fix" a sandbox
  failure: with it set, `canRunE2E` suites switch on and a different set
  fails.
- **The rule:** a test's injected `env` carries every variable production
  reads; it never relies on inheriting one from `process.env`.
- **The known residual** (the full `bun test`, `TK_STUDIO_ROOT` unset; 4
  failures, none in AC1's 15):
  - `sbx: the in-VM wall-clock guard rides the argv` ×2 and
    `invokeSkill on the sbx tier (injected spawner)` ×2: the sandbox's own
    env carries `TK_ATLASSIAN_*` variables, which `sbxEnvPassthrough`
    forwards as `-e` flags, so the argv slices the tests pin shift (an
    inherited `process.env`, not the code).

## Windows notes for sandbox-written tests

Story 35.5 (holes 74, 77, 82, 83). A test written in the Linux sandbox runs
on the Windows host too. Each rule below has one lib-suite test that runs on
Windows (not skipped there):

- **Case-folding file systems** (hole 83): `license` and `LICENSE` are one
  file on Windows; give each case its own folder.
  `lib/tests/test_assets_ladder.py` `IndexTests.test_licence_files_match_either_spelling_in_any_case`.
- **PATHEXT** (hole 82): `shutil.which` on Windows answers only names with a
  PATHEXT extension, so a fake found on PATH is named `blender.exe` there.
  `lib/tests/test_assets.py` `GreyboxTests.test_blender_found_on_path_when_blender_is_unset`
  (the fixture's `blender.exe`).
- **YAML backslashes** (hole 82): a temp path written into a test's YAML is
  quoted with `json.dumps` (`ensure_ascii=False`) or single quotes, never a
  bare f-string inside double quotes (a doubled backslash reads back as
  one). `lib/tests/test_miniyaml.py` `WindowsPathInTestYamlTests`.
- **HKCU reads** (hole 74): code that reads the user's registry variables
  takes an injected store; a test passes an empty one so the box's own
  `GODOT` never reaches it. `lib/tests/test_installer_plugin_leg.py`
  `LegCase` (`env_store=self.store`, `{}`), e.g.
  `WriteFromZip.test_fresh_install_writes_folder_and_names_version`.
- **Append-mode handles** (hole 77): a child's output handle is opened for
  writing (`"w"`/`"wb"`, a fresh file), never for appending: MSYS bash
  cannot write to an append-only handle (`echo: write error: Bad file
  descriptor`). `lib/tests/test_assets.py`
  `ChildOutputHandleTests.test_run_blender_hands_its_child_a_write_handle_not_an_append_handle`
  (the supervisor's own case is `hostverify.test.ts` `hole 77`).
