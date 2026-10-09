# Appendix C. Decisions that need Tim

Part of the [studio design spec](README.md). Each decision has the options, the benefits and drawbacks of each, a recommendation, and the evidence to deep-dive. Nothing here is in force until Tim rules. Settled items are listed first so they are not reopened.

## Settled (do not reopen)

| Ruling | Date | Where recorded |
|---|---|---|
| Engines run only in Docker Sandboxes; never bypass on the host; the Max login pays; the supervisor is the independent durable driver | 2026-09-26 | [planning pass §1](../../briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md) |
| Hermes never runs `claude -p` for pipeline work | 2026-09-26 | same, Phase 2 hard rule |
| TUA is the game reference and stays its own repository | standing | handoffs |
| The gamified office is the surface Tim will use most; no third repository; one installer, setup and updater as a hard gate; Next.js first; the contract-studio engagement vision | 2026-10-09 | [10-09 handoff](../../../implementation-artifacts/handoff-phase1-loop-2026-10-09.md) |
| **O5: keep the plugin form, drop the marketplace; the installer writes a skills-dir plugin** | **2026-10-09, Tim: "I'm fine with O5"** | [ADR §2 O5](../../briefs/adr-repository-structure-2026-10-09.md#o5-keep-the-plugin-form-drop-the-marketplace-an-installer-written-skills-dir-plugin-recommended-as-the-distribution-overlay-on-o2); recorded in the ADR header by this PR |

## D1. Repository

**One repository or two?** ADR §8.1, with §8.2 to §8.7 hanging off it.

**Options.** O2 one repository with per-app releases (ADR recommendation, scored 3.95, the only option passing every gate without the installer papering over gate 1); O1 keep the supervisor separate with the front end beside it (3.70); O3 hybrid (3.85).

**What changed since the ADR.** O5 is settled, and O5 removes the strongest cost the red team found in O2 (the marketplace clones the whole repository). It also makes gate 1 moot for users: the installer never clones anything, so a newcomer clones zero repositories under any option. The repository question is now a **developer and maintainer** question: one PR flow, one `main`, the assistant seeing the whole graph, one place for the roster and release script, versus nothing moving and two loops that never share a checkout.

| | O2 one repository | O1 stay split |
|---|---|---|
| Benefits | one convention set; cross-cutting changes (contract bump plus supervisor consumer plus web) are one PR; the roster, installer and release script live beside the apps they ship; Claude sees every call site | nothing moves, no history rewrite, no rehearsal; the two loops keep separate checkouts and sandboxes today; the plugin repository stays small |
| Drawbacks | the rehearsal (ADR §5) is real work: filter-repo, nested project root, one sandbox for two loops, worktrees (hole 16) **before** any front-end story; shared `main` widens blast radius until CI exists | ordered PRs across repositories for every contract change; two places to keep the roster's tags; the supervisor's planning artifacts stay transcribed copies (hole 18 persists) |
| Cost to Tim | one rehearsal day plus the cut-over; the Startup shortcut edit | none now; a slow tax forever |

**Recommendation.** Sign O2, but **sequence it after the engagement loop's first slice, not before** (see [D3](#d3-order-of-work)). The reason: the move's main prize is developer ergonomics, and the hole-16 worktree work it needs is the same work EP-26 does anyway. Doing the migration first delays the surface Tim will use most by the rehearsal's duration. Rulings §8.2 to §8.7 of the ADR (admin exemption, front-end release tag, nested project, archive, meta-CLI wheel) follow the ADR's recommendations; none changes this design.

**Evidence.** [ADR §3 scoring](../../briefs/adr-repository-structure-2026-10-09.md#3-scoring-against-the-frame), [run 1 §2 A1](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#2-a1-how-comparable-projects-structure-plugin-service-and-ui), [run 1 §11 red team](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#11-contrary-evidence).

## D2. Hermes

**The question.** Hermes was planned as the conversational front door and dispatcher (2026-09-26) and then as "the agent the front end wraps" (2026-10-09, with the 2026-09-01 note that Hermes profiles own live agent state). Phase 2 is about one third built (Appendix A.5). Tim asks whether it still adds benefits now that the design has its own chat surface, its own engagement state machine and its own event stream.

**Options.** Full evidence and scoring in [Appendix B](hermes-fit.md).

| | A. Hermes is the chat brain, wrapped by the office | B. Drop Hermes; the studio owns its chat over Claude Code | C. Hermes as an optional adapter behind a chat the supervisor owns |
|---|---|---|---|
| What it gives | 25 messaging platforms with pairing auth; cron with delivery to a channel; a memory notepad and session search; skills Tim can author; a dashboard; an OpenAI-compatible API with run events over SSE; profiles for per-project isolation; Bot Mode | one vendor, one login, one permission model; the chat is a `claude -p` session with the studio plugin, so the planner leg and the chat are the same brain; Remote Control and channels cover phone steering on the subscription | the supervisor owns the engagement state machine and a `/chat` route; Telegram and other channels arrive through whichever adapter is configured (Hermes today, Claude Code channels later); Hermes is replaceable without touching the loop |
| What it costs | a second agent runtime with its own model bill (Nous Portal), its own learning loop that must stay gated, weekly 460 to 1,800-PR releases, a 700k-line service between the phone and the box; native Windows loses the dashboard chat PTY; agents must be registered as Hermes profiles for Hermes to see them, which duplicates the studio's registry | Telegram inbound needs Claude Code channels (research preview, needs a live session and Bun) or our own bot; no cron or memory beyond what the studio already has (jobs, kb, ledger); Hermes-only niceties (voice, Spotify, 25 platforms) are gone | the adapter boundary is design work; two chat brains are possible if the adapter also answers (the rule: the adapter relays, the supervisor decides) |
| Fits the rulings | yes, if Hermes never executes (standing rule) and the office wraps it (10-09 ruling, literal reading) | changes the 10-09 wording "wraps the Hermes agent" to "wraps the studio chat"; keeps the intent (one conversation from the phone and the office) | yes; it is the seam the 09-26 plan already named ("the supervisor API is the seam; Hermes is replaceable") |

**Recommendation.** **C**, with Hermes kept as the first adapter because it is installed and the bot is already the notifier. The engagement state machine, the agent registry and the semantic event stream belong to the supervisor under every option; only the inbound channel and the "assistant voice" differ. Build the chat route on the supervisor, back it with a `claude -p` planner session (the brain the loop already uses), and give Hermes one skill, `tk-relay`, that forwards a Telegram message to `POST /engagements/{id}/input` and returns the reply, instead of the planned `tk-submit` that would have Hermes shape the job itself. Hermes profiles are then an optional mirror of the registry (one profile per project if Tim wants Hermes memory per project), not its source of truth. If the Hermes digest shows a capability the studio would otherwise have to build (see Appendix B's "would otherwise be built" list), A gains; if Claude Code channels leave research preview on Windows, B gains.

**Two facts from the digest that shape C.** An inbound Telegram message is always a Hermes agent turn (there is no "forward raw message to a URL" mode short of a platform plugin), so the relay is a Hermes skill that calls the supervisor, with the Telegram toolset stripped of `terminal` and `execute_code`. And Hermes's "agents" are profiles that cannot point at the supervisor or a `claude -p` worker; registering the studio's agents means creating mirror profiles. Guardrails C requires on the box: `auth.adopt_external_logins: false` (today `true`, a live hazard to the Claude login), the bundled `claude-code` skill disabled, API server and dashboard loopback-only, `approvals.mode: manual` for messaging. Full evidence: [Appendix B](hermes-fit.md).

**What "agents registered so Hermes can see them" means under C.** The registry ([README §7.2](README.md#72-the-agent-registry)) is the supervisor's; an exporter writes Hermes profiles or Bot Mode entries from it when Hermes is the adapter, so Hermes sees the same agents the office draws, and nothing is registered twice by hand.

**Evidence.** [Appendix B](hermes-fit.md); [digest 08 (Hermes as hub, 2026-09-26)](../../research/agent-studio-next-level-2026-09-26/digests/08-hermes-agent-hub-research.md); [run 1 §7 B3 Hermes surfaces](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#7-b3-events-sse-projection-hermes-chat-hosting); [office digest §4](../../research/studio-office-ui-2026-09-01/digest-studio-office-ui.md).

## D3. Order of work

**Options.** (i) Restructure first (ADR §8.6 recommendation), then the front end. (ii) Engagement loop and office first, in the supervisor repository as it stands, restructure after. (iii) Packaging first (installer plus skills-dir plugin, O5), then the front end, restructure last.

| | (i) restructure first | (ii) front end first | (iii) packaging first |
|---|---|---|---|
| Benefits | the front end lands once in its final home; one sandbox for two loops from day one | Tim gets the surface he will use most soonest; hole 16 is done as part of the front end's service work, which the restructure needs anyway | removes the marketplace clone and the plugin release plane now; the sandboxes switch to the read-only skills mount; cheap and self-contained |
| Drawbacks | delays the office by the rehearsal and cut-over; the rehearsal exercises hole 16 before the service work that fixes it | the web app is born in the supervisor repository and moves later (a folder move, no history concern) | the installer's supervisor and web legs ship against today's two repositories and are re-pointed after the move |
| Risk | a stalled rehearsal blocks everything | a second move later | low |

**Recommendation.** **(iii) then (ii) then (i)**: packaging (EP-25) is small and settled by O5; the service work and the event projection (EP-26, EP-27) are needed by both the office and the restructure; the office v0 and the engagement loop (EP-28, EP-29) follow; the restructure (EP-30) comes when the rehearsal's hole-16 prerequisite is already built. Epic 23's acceptance and Epic 24.3/24.4 run alongside, since they need only the supervisor as it is.

## D4. Quote basis

**What is a quote denominated in?**

**Options.** Dollars at list price (what the meter reports today; notional on Max); plan-window share (percent of the 5-hour and weekly windows); both, with dollars as the shadow figure.

**Recommendation.** Both: the band is computed on the meter's per-story history in tokens, shown as window share (the thing that actually runs out on Max) with a list-price dollar shadow (the thing that makes stories comparable and would be real under an API-key fallback). Evidence: [run 2 §4 C3 meter row](../../research/studio-native-overlap-and-greenfield-2026-10-09/research.md#4-c3-the-official-overlap-map), [run 1 §9 B5 ProKanban band](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#9-b5-the-contract-studio-engagement-loop).

## D5. Renderer

**Confirm the hybrid with a phone spike before the first office story.**

**Options.** CSS steps()/DOM only (4.60 in the matrix; zero bytes); hybrid DOM plus one plain PixiJS v8 canvas (recommended by run 1); Phaser; Godot web; Rive.

**Recommendation.** Hybrid, confirmed by a one-day spike on a real phone that settles the integer-zoom recipe (`resolution`, `autoDensity`, `roundPixels`) and the LimeZu frame coverage. If the spike fails on the phone, fall back to DOM for v0 (a legitimate one-day v0 per the 09-01 note) and revisit. Evidence: [run 1 §6 B2 matrix](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#6-b2-the-renderer-inside-a-nextjs-front-end).

## D6. Assets

**Assets and licences for a repository that may go public.**

**Options.** LimeZu Modern Office plus Modern Interiors (paid, cannot be in a public repository, must be fetched privately by the installer); LPC generator (free, share-alike, credits shipped in-app); PixelLab generation (owned output, subscription); a mix.

**Recommendation.** LimeZu for the floor and furniture, fetched by the meta-CLI from a private location after a purchase check and kept out of git; LPC or PixelLab for anything committed, with CREDITS shipped; verify sit and typing frames before committing to the look. Evidence: [run 1 §8 B4](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#8-b4-pixel-art-assets-and-licences).

## D7. Sign-in

**Keep the OAuth walk-through or drop it?**

**Options.** Keep the built Google and GitHub sign-in and do the two OAuth registrations; drop them and rely on the token cookie plus Remote Control for phone steering.

**Recommendation.** Drop the walk-through for now (run 2 R3: Remote Control covers phone steering on Max; the token cookie already works from the phone). The code stays; nothing is deleted. Evidence: [run 2 §9 R3](../../research/studio-native-overlap-and-greenfield-2026-10-09/research.md#9-recommendations).

## D8. API-key fallback

**The API-key fallback leg: design now, build only if the clause moves.**

**Options.** Ignore the subscription-terms risk; design the fallback (a worker tier that authenticates with an API key from the per-user store, priced for real) and build only on a trigger; build it now.

**Recommendation.** Design now, build on trigger. Record the current reading of the legal page in the ADR header at signature, and add `--bare` becoming the `-p` default and the Agent SDK credits programme to the staleness work order. Evidence: [run 2 §10 greenfield red team](../../research/studio-native-overlap-and-greenfield-2026-10-09/research.md#10-contrary-evidence).

## Open questions this spec does not decide (for the stories to settle)

| Question | Settled by |
|---|---|
| Does a hosted `url` marketplace with an `archive` source still matter once O5 is in force? | No for users; keep the in-repo catalog for developers who clone, pinned to a tag |
| Does `claude plugin eval` run against a skills-dir plugin path? | Try it on the box in EP-25 |
| Is OTel `cost_usd` populated for Max sessions? | One instrumented story run (EP-26 or later) |
| Does the PixiJS integer-zoom recipe hold on a phone? | The D5 spike |
| How large is the clone after the supervisor and a Next app land, against the 120 s marketplace budget? | Moot for users under O5; measure in the EP-30 rehearsal for developers |
| Does `hermes dashboard` spawn the chat PTY on native Windows at the pinned version? | Run it on the box, only if D2 keeps the dashboard in scope |
