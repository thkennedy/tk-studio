# Acceptance record: Story 23.3, the queue-driven run on The Universe Awaits (2026-10-17 to 2026-10-18)

The record ST-075 asks for: the run ids, the PR URL, the costs, every failure met, and TUA `main` verified unchanged at its recorded commit. Written at the end of session 11 on TIM-PC-2 (supervisor 0.1.1 from `apps/supervisor`, plugin 0.3.2, cli 0.1.1; sbx 0.47.0; the sandbox `claude-the-universe-awaits` provisioned with `WITH_DOTNET=8.0` and `WITH_GODOT=4.7.2`).

## Acceptance (a): the run from the phone's URL, end to end

Three submissions of the declared job `run-epic-2`, each `POST /jobs {project: the-universe-awaits, job: run-epic-2}` over Tailscale (`https://tim-pc-2.tail8e370a.ts.net:8787`), no `base_ref`:

| Queue run | Outcome | What it proved, what it met |
|---|---|---|
| `q-run-epic-2-20261017T204505Z-21387a` | `partial` in 20 s | hole 39 (the VM's OAuth refresh collided with an earlier Claude process in the sandbox: zero tokens, no status block, no retry) and hole 38 (the engine probe and the engine-end sweep ran `launch.py status` on the host, where bmad-loop is absent by design: an unverified engine held the lock, the close-out was skipped; fixed in tk-studio #126: `vmLaunchStatus` through `sbx exec`). |
| `q-run-epic-2-20261017T220515Z-f39af4` | `blocked` at materialise | hole 42 (materialise ran `tk install` in every fresh worktree; on TUA that re-renders nine committed `_bmad/` files in a drift-clean worktree, which the launch's validate refuses; fixed in #130: drift check first, install only on drift) and hole 43 (a blocked end wedges the one-shot job; hand closure = the studio run record moved aside). |
| `q-run-epic-2-20261017T224219Z-39ae5a` | the whole path | `base_ref` resolved to `main` (`base_ref_source: default`, commit `6b3cc72`); worktree `C:\agent-work\worktrees\the-universe-awaits\q-run-epic-2-20261017T224219Z-39ae5a` on `supervisor/run-q-run-epic-2-20261017T224219Z-39ae5a` with a relative gitdir; materialised (`install: skipped: drift-clean`, policy and routing copied, `tk activate` clean); launched with `--project` the worktree; `launched` written; the run on `GET /jobs` and the status page; engine pid recorded and the hold held; three engines in sequence (`20261017-224444-357a`, `20261017-234614-0cec`, `20261018-004359-eccd`); stories 2-1 and 2-2 landed; the paused-run pass (Story 27.3) closed out and relaunched twice; `POST /runs/{id}/resume` proven once (hole 44); the graceful stop accepted on each engine; one PR against `main`: https://github.com/thkennedy/the-universe-awaits/pull/4 (draft at each pause, the body carrying the launch status block, the engine run id, the landed commits and the metered cost). The engine stopped gracefully at 01:00:51Z after story 2-3 (4dfe60c, attempt 1, the engine's own verify green in the sandbox: "1 done, 0 deferred, 0 escalated, 2,381,463 weighted tokens, 18 stories remaining"); the supervisor's host verify leg ran at 01:07:54Z and was red on hole 52 (exit 127 in 101 ms: the leg still spawned the WindowsApps `bash` stub), so the run ended `partial` at 01:08:02Z (`ended` carries the PR URL and the reason), the PR stayed a draft, the worktree was removed and the pin released. The leg was then run by hand on the host at the branch head (green after hole 53's fix, ea3afbe: build, 1058 tests, lint) and PR #4 marked ready by hand at 01:2xZ. |

Failures met on the proven run, every one environmental and recorded in the host ledger (`~/.tk-studio/measurements/tim-Tim-PC-2.jsonl`, `observation` events):

- **Hole 44** (22:45Z): TUA's tracked `.bmad-loop/profiles/claude.toml` carried `[env] TK_STUDIO_ROOT=/mnt/d/Code/tk-studio` from the WSL days; the dev session paused at once. Dropped on the run branch (cf814db); resumed over the API.
- **Hole 47** (23:3xZ): the engine's own verify (`bash scripts/verify.sh`) failed `dotnet: command not found`: provisioning exported dotnet only in `~/.profile`, which the bare `sbx exec` environment never reads. Linked into `~/.local/bin` by hand; provisioning fixed (#132). Story 2-1 ruled `reconcile_verdict: no-impact` (its code had landed, c821251).
- **Hole 48** (00:10Z and 00:29Z): `git worktree add --relative-paths` writes `extensions.relativeworktrees` into the repository's shared config, and the .NET 8 SDK's `Microsoft.Build.Tasks.Git` refuses it in every checkout of the repository, the main one included. Story 2-2's verify failed twice (the second dev session routed around it with an environment variable the engine's verify never sees) and the story was deferred. `EnableSourceControlManagerQueries=false` in TUA's root `Directory.Build.props` (1fb226a on the run branch).
- **Hole 49** (found by the same dev session): the xunit v3 test host is an apphost and finds the runtime only through `DOTNET_ROOT` or `/etc/dotnet/install_location`. Registered by hand in the sandbox; provisioning fixed (#132). With 48 and 49 closed, `scripts/verify.sh` ran green under bare `sbx exec` in the run worktree by hand (build, 1050 tests, lint). Story 2-2 ruled `no-impact` (its code had landed, 2b14a68 and e29459b).
- **Hole 50**: `scripts/make-toy-world.sh` picked the Store's `python3` stub on the host (the host verify leg), although Python 3.12 and the `py` launcher are installed; the script now probes for an interpreter that runs (b325d52 on the run branch).

The engine's own session costs, from the substrate's records (`state.json` and the journal of each engine run, archived under the worktree's `.bmad-loop/archive`): the sessions ran on the operator's Max plan, so the records carry tokens, not dollars.

| Story | Engine | Sessions | Output tokens | Cache read | Cache create | Weighted (0.1 × cache read) |
|---|---|---|---|---|---|---|
| 2-1 keyed month thread scheduler | 357a | dev-1 (paused at once, hole 44; resumed) | 290,491 | 46,062,785 | 727,912 | 242,351 + 5,382,843 |
| 2-2 reactive thread queue | 0cec | dev-1, dev-2 (two attempts, holes 48/49) | 334,736 | 59,217,421 | 867,538 | 3,949,341 + 3,175,432 |
| 2-3 mood raw apply and band lookup | eccd | dev-1 (attempt 1 landed with the engine's own verify green, the first story to do so in the sandbox; review not recommended; the studio-pipeline gate ran) | 77,084 | 19,070,546 | 397,024 | 2,220,354 + 161,109 (the engine's run total 2,381,463) |

The supervisor's own metered cost (the launch workers' API sessions, `accounted` events): 0.89 USD for the relaunch worker at 00:44Z (5 turns, 230,649 tokens); the `job-run` events in the ledger carry `total_cost_usd` for each finished studio run (`run-epic-2-20261017T204617Z` partial 0.0; `run-epic-2-20261017T220609Z` blocked 0.906; the proven run's at its end). The operator's weekly plan usage went from 42 % at the session's start (20:00Z) to 51 % at 00:40Z on the 18th, with Story 28.6's run and this session's own work inside that.

## Acceptance (b): conformance through the supervisor

Not run: the host CLI on the box is logged out (`claude auth status`: `loggedIn: false`), and conformance (Story 21.2) is a host-tier job. Runs once Tim signs the host CLI in.

## Acceptance (c): the supervisor killed during a launch session

Not exercised in this session: the supervisor is never started from a Claude session, so the kill and the restart are an attended check for Tim (the restart rule and the orphan close-out are covered by the supervisor's suites).

## Acceptance (d): the ledger

`job-run` events carrying `total_cost_usd` are in `~/.tk-studio/measurements/tim-Tim-PC-2.jsonl` (the first on the box: `studio-health` on 2026-10-17 19:49Z, then the three `run-epic-2` submissions and `run-epic-28`); the engine's session costs are read from the substrate's records as above. `tk measure push` (the core, `measurepush.py push` from a clean worktree at `main`) at 01:3xZ on the 18th moved 79 new events (holes 36 to 53 and the session's `job-run`, `drift-detection` and close-out meter events among them) onto `measurements/tim-Tim-PC-2` and opened the membrane PR https://github.com/thkennedy/tk-studio/pull/133.

## TUA `main`

`main` at `6b3cc7200218e3a3b357095ba5b76bb38e581792` (the merge of TUA PR #3) when the proven run claimed it, and the checkout at `C:\GitHub\the-universe-awaits` never changed branch: at 01:1xZ on the 18th `git rev-parse main` and `origin/main` both read `6b3cc7200218e3a3b357095ba5b76bb38e581792` and `main` was still the checked-out branch; every commit of the run sits on `supervisor/run-q-run-epic-2-20261017T224219Z-39ae5a` behind PR #4. Two holes met after the engine's end: **hole 52** (above) and **hole 53** (`make-toy-world.sh` wrote the manifest with the platform's line ending, so the idempotence test failed on the Windows host while the engine's Linux verify was green; fixed on the run branch).

## Also met on the way (the tk-studio side)

Hole 37 (TUA's gitignored `.bmad-loop/policy.toml` missing, nothing in the studio said so), hole 45 (the pacer respawns the engine hold every pass on win32), hole 46 (the host verify leg's bare `bash` is the WindowsApps stub; the leg now puts Git's `usr\bin` first, #132), hole 51 (the supervisor's `bun test` hangs on the box inside the e2e suite's `run studio-health` child). The runbook rows for the worktree flag and the Store stubs, and the supervisor README, carry 46, 48 and 50.
