# Upstream issue draft — bmad-method (ST-044, EP-011)

**Status:** FILED 2026-09-27 on the operator's in-session go-ahead (D4) as
[bmad-code-org/BMAD-METHOD#2978](https://github.com/bmad-code-org/BMAD-METHOD/issues/2978).
The filed scope is narrower than this draft: defect 1 plus the line-ending
question. Defect 2 was left out because it no longer reproduces on 6.12.0
(see the addendum). The body below is the 2026-08-08 draft, kept as
written; the filed text is the issue itself.

Original scope per the 2026-08-08 in-session ruling: one issue, both
defects (the re-serialization defect as ruled, plus the
`--pin`-ignored/stable-float defect confirmed live that session), the LF
rewrite posed as a question.

**Target tracker:** https://github.com/bmad-code-org/BMAD-METHOD/issues

---

## Proposed title

`install --yes` over an existing install: list config values re-serialized
as JSON strings, and `--pin` ignored (stable modules float to latest tag)

## Proposed body

### Environment

- bmad-method **6.10.0** (`npx bmad-method@6.10.0 install`)
- Windows 11, Node 22 / npx; project tracks `_bmad/` and `.claude/skills/`
  in git
- Reinstall over an existing 6.10.0 install (the "quick update" path), fully
  non-interactive:

```
npx --yes bmad-method@6.10.0 install --directory <project> \
  --modules bmm,bmb,cis,gds,tea,wds,bmad-loop --tools claude-code --yes \
  --pin bmb=v2.1.0 --pin cis=v0.2.1 --pin gds=v0.6.0 --pin tea=v1.19.1 \
  --pin wds=v0.4.3 --pin bmad-loop=v0.9.0
```

### Defect 1 — list-valued config options re-serialized as JSON strings

On every reinstall over an existing install, module config options whose
value is a list are rewritten as a quoted JSON string:

```yaml
# _bmad/gds/config.yaml — before (as written by the original install)
primary_platform:
  - unity
  - unreal
  - godot
  - other

# after the --yes reinstall
primary_platform: '["unity", "unreal", "godot", "other"]'
```

Same for `product_languages` in `_bmad/wds/config.yaml`, and the TOML
mirror `_bmad/config.toml`:

```toml
primary_platform = ["unity", "unreal", "godot", "other"]   # before
primary_platform = "[\"unity\", \"unreal\", \"godot\", \"other\"]"  # after
```

**Expected:** config values round-trip unchanged through a reinstall.
**Actual:** every reinstall re-serializes list values into strings (a
consumer reading the yaml/toml now gets a string, not a list), and the
rewrite shows up as git churn in tracked projects. First observed
2026-07-27; reproduced on every reinstall since.

(Related churn from the same rewrite, mentioned for completeness: the
`# Date:` header comment is refreshed and mapping keys are reordered in
every module `config.yaml` even when no value changed.)

### Defect 2 — `--pin CODE=TAG` ignored on reinstall; stable modules float

On the quick-update path (reinstall over an existing install), CLI `--pin`
flags are not consulted: channel options are rebuilt from the installed
manifest only (`tools/installer/core/installer.js`, the quick-update branch
that builds `channelOptions` from `manifestData.modulesDetailed`). A module
recorded with `channel: stable` is then floated to the newest **non-major**
tag by `classifyUpgrade` — regardless of the explicit `--pin` passed on the
command line.

Reproduced live on 2026-08-08: with `--pin tea=v1.19.1 --pin
bmad-loop=v0.9.0` on the command line, the reinstall delivered **tea
v1.21.7** and **bmad-loop v0.9.1**.

**Expected:** an explicit `--pin CODE=TAG` wins over the recorded channel
(that is what the flag is documented to do for install), or at minimum a
loud warning that the pin is being ignored on this path.
**Actual:** the pin is silently ignored; a reinstall is only reproducible
while the pinned tag happens to be the latest stable tag. This breaks
lockfile-style workflows that reinstall at a recorded pin to verify
determinism (major upgrades are correctly held back — it is exactly the
patch/minor float that defeats a pin).

### Question — LF rewrite of installed files

The reinstall also rewrites every installed file with LF line endings (on
Windows, working copies previously checked out as CRLF become LF — ~240
files of pure line-ending churn per reinstall in our project). Is that
normalization intentional? If so, is there a recommended `.gitattributes`
posture for projects that track `_bmad/` and the generated skills in git?

### Impact

For consumers pinning installs for determinism (committed lockfile →
reinstall → verify manifest against pins), a same-version reinstall today
produces: floated module versions (defect 2, breaks the verify), string-form
list values (defect 1, changes parsed config types), plus large no-op churn
(endings, comment stamps, reordering, `*.bak` drops). We work around the
churn classes with a normalizer on our side, but defects 1 and 2 look like
genuine installer bugs worth fixing at the source.

---

*Draft prepared 2026-08-08 from ISS-001 (issues/ledger.md), the 2026-07-27
and 2026-08-06 measurement events, and the 2026-08-08 live corpus (session
evidence: 292 modified + 27 untracked files on a same-version reinstall;
installer source inspected in the npx cache). The 2026-08-08 watchdog
research tick verified no existing upstream issue covers either defect.*

---

## Addendum 2026-09-27 — defect 1 root-caused; defect 2 fixed upstream in 6.12.0

Re-observed on a same-pin `tk install` (bmad-method **6.11.0**, now with
`--action update`, which the studio passes since PR #57 so `--pin` is
honored). Both defects were re-run live in scratch projects:

- **Defect 1 reproduces on 6.12.0** (the current `latest`): a fresh
  `--modules gds` install writes a YAML list and a TOML array, and the
  first `--yes` reinstall turns both into JSON strings.
- **Defect 2 is fixed in 6.12.0.** A module recorded `channel: stable` at
  v0.3.2, reinstalled with `--yes --pin cis=v0.3.1`, stays on v0.3.2 under
  6.11.0 but moves to v0.3.1 (`channel: pinned`) under 6.12.0, still on the
  quick-update path. The `--action update` in `install_base.py` stays
  needed while the lock pins 6.11.0; revisit it on the 6.12.0 base-update.

Installer source read in the npx cache:

- **Root cause of defect 1:** `parseCentralToml` in
  `tools/installer/modules/official-modules.js` (the loader for the
  existing `_bmad/config.toml` / `config.user.toml` answers) handles quoted
  strings, booleans and numbers only — a TOML array such as
  `primary_platform = ["unity", "unreal"]` falls through to `value = raw`
  and comes back as the *string* `["unity", "unreal"]`. That string is then
  the "existing answer" for the multi-select, so every module
  `config.yaml` gets `primary_platform: '["unity", ...]'` and the TOML
  mirror is rewritten as a quoted string. Once the string form is written
  it is a fixed point (no double-encoding on later reinstalls).
- **Still present in 6.12.0** (current `latest`): the parser has no array
  branch.
- Suggested fix for the body: parse `[...]` values as TOML arrays (or use a
  real TOML parser) in `parseCentralToml`.

Unaffected by the fix, and **not** defects (verified 2026-09-27): the
6.11.0 full-update path rewrites `output_folder: _bmad-output` to
`"{project-root}/_bmad-output"` (core `module.yaml` declares
`result: "{project-root}/{value}"`) and records `channel: pinned` for
modules installed via `--pin` — both converge after one committed
regeneration.

Local line-ending churn observed this time runs the other way from the
original question (the installer wrote CRLF over LF-committed files).
Installed files follow the working-tree endings of upstream's module cache
(`~/.bmad/cache/external-modules/*`). On the agent PC those clones were
made 2026-09-26 18:06 under Git for Windows' system `core.autocrlf=true`,
about 30 minutes before the user-level `autocrlf=false` override was set,
and the CRLF checkouts persisted. Environment-dependent, so still a question
for upstream rather than a defect.
