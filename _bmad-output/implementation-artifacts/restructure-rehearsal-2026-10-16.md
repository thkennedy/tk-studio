# Restructure rehearsal — 2026-10-16

- supervisor: `C:\GitHub\tk-studio-supervisor`
- tk-studio: `C:\GitHub\tk-studio`
- scratch: `C:\agent-work\scratch\restructure-rehearsal`
- supervisor branch: `fix/worktree-test-timeout`
- filter-repo: `uvx git-filter-repo`
- timeout per check: `1800s`

## Step 1 — Freeze

### clone supervisor (--no-local) — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost clone --no-local 'C:\GitHub\tk-studio-supervisor' svc-rewrite`
- cwd: `.`
- exit code: 0
- duration: 2.42s
- note: fresh clone into a folder this run created

```text
Cloning into 'svc-rewrite'...
Updating files:  93% (2030/2169)
Updating files:  94% (2039/2169)
Updating files:  95% (2061/2169)
Updating files:  96% (2083/2169)
Updating files:  97% (2104/2169)
Updating files:  98% (2126/2169)
Updating files:  99% (2148/2169)
Updating files: 100% (2169/2169)
Updating files: 100% (2169/2169), done.
```

### clone tk-studio (--no-local) — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost clone --no-local 'C:\GitHub\tk-studio' tk-studio`
- cwd: `.`
- exit code: 0
- duration: 3.38s
- note: fresh clone into a folder this run created

```text
Updating files:  82% (2196/2677)
Updating files:  83% (2222/2677)
Updating files:  84% (2249/2677)
Updating files:  85% (2276/2677)
Updating files:  86% (2303/2677)
Updating files:  87% (2329/2677)
Updating files:  88% (2356/2677)
Updating files:  89% (2383/2677)
Updating files:  90% (2410/2677)
Updating files:  91% (2437/2677)
Updating files:  92% (2463/2677)
Updating files:  93% (2490/2677)
Updating files:  94% (2517/2677)
Updating files:  95% (2544/2677)
Updating files:  96% (2570/2677)
Updating files:  97% (2597/2677)
Updating files:  98% (2624/2677)
Updating files:  99% (2651/2677)
Updating files: 100% (2677/2677)
Updating files: 100% (2677/2677), done.
```

### remove origin (tk-studio clone) — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost remote remove origin`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.08s

```text
(no output)
```

### core.longpaths — pass

- command: `git config --get core.longpaths`
- cwd: `svc-rewrite`
- exit code: 0
- duration: 0.03s
- note: read, never set

```text
true
```

### freeze (no loop run in flight, PRs merged, supervisor tab stopped) — unverifiable-here

- note: operator actions on the agent PC: confirm no run is in flight and no PR is open, then stop the supervisor tab from the console

## Step 2 — Rewrite

### tags are release tags (carried) — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost tag --list`
- cwd: `svc-rewrite`
- exit code: 0
- duration: 0.03s
- note: release tags carried by the rewrite: supervisor--v0.1.0 — pushed after the real merge (git push origin <tag>)

```text
supervisor--v0.1.0
```

### signed commits (informational) — info

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost log --all --no-show-signature --format=raw`
- cwd: `svc-rewrite`
- exit code: 0
- duration: 0.03s
- note: signature headers: gpgsig in 11 commits — dropped by the rewrite (rewritten commits are new objects); the archived repository keeps the signed originals

```text
commit 9846d21e8dd98d5caae5b3262d62e5ec7c42f7ab
commit 92208cf7acc4e5ba6546aca234fef01992e9c546
commit 981df26fd3b4db12232dd41030e1a8cefd0fff4f
commit 8d0880c05ff1aa0407cd8651ff4174f499773480
commit 6b973d1af7d31b39c5d8601ec4fdd87159982289
commit 797e2311bf9c23569257bf1d7ef07ee52e9b69f4
commit a6d215681eaa6825e3f66f14dbdc12010e37e5cb
commit 6ff788827e02bd3d16427f7821de559d721b91dc
commit 8a42df7691b1bfbb03632a664e1aeb3b03c7963c
commit f06c9e9d1cc95f99c05f86fa5f7a7fe567363be7
commit 6be253670ec0693df1b6acd7f81e9a20113b8836
commit e2ad3bfa45bc2b512a4eea5f73b23e1f1c53f798
commit 2b61bd30235ee6ca1aa4bae1da5beb995d5835ac
commit 3b894be23f3c347b36009f63285906f46eac7827
commit 742706d6a0ba22ad42c2da21a458601521b8e4c1
commit d5a524e12db08afd748c1f1c7c26e4344c40cd3d
gpgsig -----BEGIN PGP SIGNATURE-----
commit 8139fd95fa4eb18aa90073eeb57312c868524a41
commit 639e82a1674bf61c7293f5010b7278105f0fa2cc
gpgsig -----BEGIN PGP SIGNATURE-----
```

### filter-repo — pass

- command: `uvx git-filter-repo --to-subdirectory-filter apps/supervisor`
- cwd: `svc-rewrite`
- exit code: 0
- duration: 3.07s
- note: ran uvx git-filter-repo

```text
Updating files:  82% (3558/4338)
Updating files:  83% (3601/4338)
Updating files:  84% (3644/4338)
Updating files:  85% (3688/4338)
Updating files:  86% (3731/4338)
Updating files:  87% (3775/4338)
Updating files:  88% (3818/4338)
Updating files:  89% (3861/4338)
Updating files:  90% (3905/4338)
Updating files:  91% (3948/4338)
Updating files:  92% (3991/4338)
Updating files:  93% (4035/4338)
Updating files:  94% (4078/4338)
Updating files:  95% (4122/4338)
Updating files:  96% (4165/4338)
Updating files:  97% (4208/4338)
Updating files:  98% (4252/4338)
Updating files:  99% (4295/4338)
Updating files: 100% (4338/4338)
Updating files: 100% (4338/4338), done.
```

### no node_modules in history — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost -c core.quotePath=false -c log.showRoot=true log --all -m --no-renames --name-only --format= -z`
- cwd: `svc-rewrite`
- exit code: 0
- duration: 0.04s
- note: none of the 2170 paths any commit touched (log --all -m --name-only, merges included)

```text
apps/supervisor/_bmad/wds/data/presentations/saga-presentation.md
apps/supervisor/_bmad/wds/data/presentations/saga-workflows-guide.md
apps/supervisor/_bmad/wds/data/shared-activation.md
apps/supervisor/_bmad/wds/data/wds-glossary.md
apps/supervisor/_bmad/wds/module-help.csv
apps/supervisor/_bmad/wds/scripts/README.md
apps/supervisor/_bmad/wds/scripts/wds-add-object.js
apps/supervisor/_bmad/wds/scripts/wds-add-spacing.js
apps/supervisor/_bmad/wds/scripts/wds-init-page.js
apps/supervisor/_bmad/wds/scripts/wds-init-scenario.js
apps/supervisor/_bmad/wds/scripts/wds-nav.js
apps/supervisor/_bmad/wds/scripts/wds-validate.js
apps/supervisor/_bmad/wds/skills/freya.activation.md
apps/supervisor/_bmad/wds/skills/handoff.md
apps/supervisor/_bmad/wds/skills/saga.activation.md
apps/supervisor/_bmad/wds/skills/shared/git.md
apps/supervisor/_bmad/wds/skills/start.md
apps/supervisor/_bmad/wds/skills/wrap.md
apps/supervisor/kb/index.md
apps/supervisor/README.md
```

### node_modules ignored — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost check-ignore -v --no-index apps/supervisor/node_modules/x.js`
- cwd: `svc-rewrite`
- exit code: 0
- duration: 0.03s

```text
apps/supervisor/.gitignore:3:node_modules/	apps/supervisor/node_modules/x.js
```

### every path under apps/supervisor/ — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost -c core.quotePath=false ls-tree -r -z --name-only HEAD`
- cwd: `svc-rewrite`
- exit code: 0
- duration: 0.03s
- note: 2169 paths

```text
apps/supervisor/test/api.test.ts
apps/supervisor/test/auth.test.ts
apps/supervisor/test/closeout.test.ts
apps/supervisor/test/command-line.test.ts
apps/supervisor/test/conformance.test.ts
apps/supervisor/test/fakes.ts
apps/supervisor/test/guards.test.ts
apps/supervisor/test/hostverify.test.ts
apps/supervisor/test/hygiene.test.ts
apps/supervisor/test/page.test.ts
apps/supervisor/test/planstatus.test.ts
apps/supervisor/test/preflight.test.ts
apps/supervisor/test/queue.test.ts
apps/supervisor/test/resume.test.ts
apps/supervisor/test/sandbox.test.ts
apps/supervisor/test/status-block.test.ts
apps/supervisor/test/tick.test.ts
apps/supervisor/test/tier.test.ts
apps/supervisor/test/worktree.test.ts
apps/supervisor/tsconfig.json
```

## Step 3 — Merge

### branch restructure/supervisor-into-monorepo — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost checkout -b restructure/supervisor-into-monorepo`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.04s

```text
Switched to a new branch 'restructure/supervisor-into-monorepo'
```

### add local remote svc — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost remote add svc 'C:\agent-work\scratch\restructure-rehearsal\svc-rewrite'`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.03s

```text
(no output)
```

### fetch svc (with tags) — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost fetch --tags svc`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.44s

```text
From C:\agent-work\scratch\restructure-rehearsal\svc-rewrite
 * [new branch]      chore/onboard-studio      -> svc/chore/onboard-studio
 * [new branch]      docs/decisions-2026-10-06 -> svc/docs/decisions-2026-10-06
 * [new branch]      docs/dw-20-closed         -> svc/docs/dw-20-closed
 * [new branch]      docs/dw-22-closed         -> svc/docs/dw-22-closed
 * [new branch]      feat/dark-theme           -> svc/feat/dark-theme
 * [new branch]      fix/host-tier-allow-uv-run -> svc/fix/host-tier-allow-uv-run
 * [new branch]      fix/worktree-test-timeout -> svc/fix/worktree-test-timeout
 * [new branch]      loop/epic-21              -> svc/loop/epic-21
 * [new branch]      loop/epic-22              -> svc/loop/epic-22
 * [new branch]      loop/epic-27              -> svc/loop/epic-27
 * [new branch]      main                      -> svc/main
 * [new tag]         supervisor--v0.1.0        -> supervisor--v0.1.0
```

### release tags carried into the clone — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost tag --list`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.03s
- note: 1 release tag(s) in the merged clone: supervisor--v0.1.0 — after the real merge: git push origin supervisor--v0.1.0

```text
cli--v0.1.0
supervisor--v0.1.0
tk-studio--v0.2.10
tk-studio--v0.2.11
tk-studio--v0.2.12
tk-studio--v0.2.13
tk-studio--v0.2.14
tk-studio--v0.2.15
tk-studio--v0.2.16
tk-studio--v0.2.6
tk-studio--v0.2.7
tk-studio--v0.2.8
tk-studio--v0.2.9
tk-studio--v0.3.0
tk-studio--v0.3.1
```

### svc/fix/worktree-test-timeout exists — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost rev-parse --verify --quiet 'refs/remotes/svc/fix/worktree-test-timeout^{commit}'`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.03s

```text
7251f42a35673034bc1364affc005e978ae61ce1
```

### merge — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost -c commit.gpgsign=false -c merge.ff=true merge --allow-unrelated-histories --no-edit svc/fix/worktree-test-timeout`
- cwd: `tk-studio`
- exit code: 0
- duration: 1.55s

```text
 create mode 100644 apps/supervisor/test/api.test.ts
 create mode 100644 apps/supervisor/test/auth.test.ts
 create mode 100644 apps/supervisor/test/closeout.test.ts
 create mode 100644 apps/supervisor/test/command-line.test.ts
 create mode 100644 apps/supervisor/test/conformance.test.ts
 create mode 100644 apps/supervisor/test/fakes.ts
 create mode 100644 apps/supervisor/test/guards.test.ts
 create mode 100644 apps/supervisor/test/hostverify.test.ts
 create mode 100644 apps/supervisor/test/hygiene.test.ts
 create mode 100644 apps/supervisor/test/page.test.ts
 create mode 100644 apps/supervisor/test/planstatus.test.ts
 create mode 100644 apps/supervisor/test/preflight.test.ts
 create mode 100644 apps/supervisor/test/queue.test.ts
 create mode 100644 apps/supervisor/test/resume.test.ts
 create mode 100644 apps/supervisor/test/sandbox.test.ts
 create mode 100644 apps/supervisor/test/status-block.test.ts
 create mode 100644 apps/supervisor/test/tick.test.ts
 create mode 100644 apps/supervisor/test/tier.test.ts
 create mode 100644 apps/supervisor/test/worktree.test.ts
 create mode 100644 apps/supervisor/tsconfig.json
```

### no conflict — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost diff --name-only --diff-filter=U`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.17s

```text
(no output)
```

### every path is new — pass

- duration: 0.03s
- note: none of the 2169 paths of svc/fix/worktree-test-timeout existed in tk-studio (case-insensitive)

### nest the studio pipeline (fix-up) — pass

- command: `uv run python tools/restructure/nest_pipeline.py --out apps/supervisor/.bmad-loop/plugins/studio-pipeline`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.16s

```text
{
  "ok": true,
  "written": [
    "apps\\supervisor\\.bmad-loop\\plugins\\studio-pipeline\\task-planning.md",
    "apps\\supervisor\\.bmad-loop\\plugins\\studio-pipeline\\consult.md",
    "apps\\supervisor\\.bmad-loop\\plugins\\studio-pipeline\\gate.md",
    "apps\\supervisor\\.bmad-loop\\plugins\\studio-pipeline\\reconcile.md",
    "apps\\supervisor\\.bmad-loop\\plugins\\studio-pipeline\\transcribe.py"
  ]
}
```

### stage the fix-up — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost add -A -- apps/supervisor/.bmad-loop/plugins/studio-pipeline`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.14s

```text
(no output)
```

### commit the fix-up — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost -c commit.gpgsign=false commit -q -m 'restructure: render apps/supervisor'"'"'s studio-pipeline copy (ADR section 5 step 3 fix-up)'`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.11s

```text
(no output)
```

### remove remote svc — pass

- command: `git -c user.name=rehearse -c user.email=rehearse@localhost remote remove svc`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.05s

```text
(no output)
```

## Step 4 — Nested studio project

### tk activate — pass

- command: `uv run 'C:\agent-work\scratch\restructure-rehearsal\tk-studio\plugins\tk-studio\skills\tk-studio-activate\scripts\drift_check.py' --directory 'C:\agent-work\scratch\restructure-rehearsal\tk-studio\apps\supervisor'`
- cwd: `tk-studio/plugins/tk-studio`
- exit code: 0
- duration: 0.27s
- note: drift_check emits its own drift/activation measurement event to the per-user store (~/.tk-studio); this is the check's own measurement, not a rehearsal write.; result=clean; fixes=[]

```text
    {
      "plane": "store",
      "status": "ok",
      "detail": "store C:\\Users\\tim\\.tk-studio skeleton + config complete",
      "elapsed_ms": 0.3
    },
    {
      "plane": "vault",
      "status": "ok",
      "detail": "supervisor not registered — vault window not applicable until onboarding registers it",
      "elapsed_ms": 0.3
    }
  ],
  "fixes": [],
  "mutated": false,
  "project_root": "C:\\agent-work\\scratch\\restructure-rehearsal\\tk-studio\\apps\\supervisor",
  "studio_root": "C:\\GitHub\\tk-studio",
  "nested": true,
  "project_id": "supervisor"
}
```

### bmad-loop list — unverifiable-here

- note: bmad-loop is not on this host's PATH

### bun install — pass

- command: `bun install --frozen-lockfile`
- cwd: `tk-studio/apps/supervisor`
- exit code: 0
- duration: 0.97s

```text
bun install v1.4.2 (744846f84)

+ @types/bun@1.4.2
+ @types/js-yaml@4.0.9
+ typescript@5.9.3
+ js-yaml@4.3.2

8 packages installed [948.00ms]
```

### bun test — pass

- command: `bun test`
- cwd: `tk-studio/apps/supervisor`
- exit code: 0
- duration: 571.18s

```text
bun test v1.4.2 (744846f84)

test\command-line.test.ts:
symlink unavailable on this platform — skipping the caller-spelling case

test\tier.test.ts:
symlink unavailable on this platform — skipping the caller-spelling case
symlink unavailable on this platform — skipping the symlink case

 842 pass
 17 skip
 0 fail
 6090 expect() calls
Ran 859 tests across 18 files. [571.15s]
```

### verify_host — pass

- command: `uv run python tools/verify_host.py`
- cwd: `tk-studio`
- exit code: 0
- duration: 279.56s

```text
== lib suite: uv run python -m unittest discover tests  (cwd plugins\tk-studio\lib)
== lib suite: ok in 268s
== conformance: uv run python contracts/conformance/runner.py run  (cwd plugins\tk-studio)
== conformance: ok in 11s
verify_host: ok (lib suite, conformance)
```

### hooks declared (4) — pass

- duration: 0.00s
- note: SessionStart, Stop, SessionEnd, PreCompact (expected 4)

### hook SessionStart script path — pass

- command: `uv run --no-project python "$CLAUDE_PROJECT_DIR"/.bmad-loop/bmad_loop_hook.py SessionStart`
- cwd: `tk-studio/apps/supervisor`
- duration: 0.00s
- note: $CLAUDE_PROJECT_DIR = apps/supervisor; resolves: .bmad-loop/bmad_loop_hook.py (static, never executed)

### hook Stop script path — pass

- command: `uv run --no-project python "$CLAUDE_PROJECT_DIR"/.bmad-loop/bmad_loop_hook.py Stop`
- cwd: `tk-studio/apps/supervisor`
- duration: 0.00s
- note: $CLAUDE_PROJECT_DIR = apps/supervisor; resolves: .bmad-loop/bmad_loop_hook.py (static, never executed)

### hook SessionEnd script path — pass

- command: `uv run --no-project python "$CLAUDE_PROJECT_DIR"/.bmad-loop/bmad_loop_hook.py SessionEnd`
- cwd: `tk-studio/apps/supervisor`
- duration: 0.00s
- note: $CLAUDE_PROJECT_DIR = apps/supervisor; resolves: .bmad-loop/bmad_loop_hook.py (static, never executed)

### hook PreCompact script path — pass

- command: `uv run --no-project python "$CLAUDE_PROJECT_DIR"/.bmad-loop/bmad_loop_hook.py PreCompact`
- cwd: `tk-studio/apps/supervisor`
- duration: 0.00s
- note: $CLAUDE_PROJECT_DIR = apps/supervisor; resolves: .bmad-loop/bmad_loop_hook.py (static, never executed)

### hooks fire live with $CLAUDE_PROJECT_DIR = nested root — unverifiable-here

- note: needs a Claude session; hook commands are never executed here. Start claude there, trust the folder, run one prompt, and confirm each of SessionStart, Stop, SessionEnd, PreCompact wrote its marker/log under C:\GitHub\tk-studio\apps\supervisor\.bmad-loop

### nested folder trusted — unverifiable-here

- note: folder trust is per folder on the Windows box (runbook 4.1); accept the trust dialog when claude starts there

### clone size after merge — info

- command: `git count-objects -vH`
- cwd: `tk-studio`
- exit code: 0
- duration: 0.03s
- note: measured right after the merge, before the Step 4 checks; working tree 43426981 bytes (excluding .git); .git 13378415 bytes

```text
count: 2
size: 826 bytes
in-pack: 9678
packs: 2
size-pack: 11.99 MiB
prune-packable: 0
garbage: 0
size-garbage: 0 bytes
```

## Step 5 — Sandboxes

### one sandbox serves both loops — unverifiable-here

- note: sandbox provisioning runs on the agent PC (runbook 3.8, 4)

## unverifiable-here

- **freeze (no loop run in flight, PRs merged, supervisor tab stopped)** (Step 1): operator actions on the agent PC: confirm no run is in flight and no PR is open, then stop the supervisor tab from the console. Agent PC: `cd C:\GitHub\tk-studio-supervisor; bmad-loop list --json; gh pr list --repo thkennedy/tk-studio-supervisor --state open; gh pr list --repo thkennedy/tk-studio --state open`
- **bmad-loop list** (Step 4): bmad-loop is not on this host's PATH. Agent PC: `cd C:\GitHub\tk-studio\apps\supervisor; bmad-loop list --json`
- **hooks fire live with $CLAUDE_PROJECT_DIR = nested root** (Step 4): needs a Claude session; hook commands are never executed here. Start claude there, trust the folder, run one prompt, and confirm each of SessionStart, Stop, SessionEnd, PreCompact wrote its marker/log under C:\GitHub\tk-studio\apps\supervisor\.bmad-loop. Agent PC: `cd C:\GitHub\tk-studio\apps\supervisor; claude`
- **nested folder trusted** (Step 4): folder trust is per folder on the Windows box (runbook 4.1); accept the trust dialog when claude starts there. Agent PC: `cd C:\GitHub\tk-studio\apps\supervisor; claude`
- **one sandbox serves both loops** (Step 5): sandbox provisioning runs on the agent PC (runbook 3.8, 4). Agent PC: `cd $HOME; sbx create --skills readonly --name claude-tk-studio claude C:\GitHub\tk-studio; sbx exec claude-tk-studio bash -lc 'cd /c/GitHub/tk-studio/apps/supervisor && bun install --frozen-lockfile && bun test && cd /c/GitHub/tk-studio/plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run'`

Verdict: rehearsal passed
