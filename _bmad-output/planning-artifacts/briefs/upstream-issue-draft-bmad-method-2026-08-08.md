# Upstream issue draft — bmad-method (ST-044, EP-011)

**Status:** DRAFT — not filed. Filing on the bmad-method tracker happens only
on explicit in-session operator go-ahead (D4). Scope per the 2026-08-08
in-session ruling: one issue, both defects (the re-serialization defect as
ruled, plus the `--pin`-ignored/stable-float defect confirmed live this
session), the LF rewrite posed as a question.

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
