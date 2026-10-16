# Appendix C. Decisions: rulings recorded 2026-10-14

Part of the [studio design spec](README.md). Tim ruled D1 to D8 in [decisions-answers.md](decisions-answers.md) on 2026-10-14; the ruling is recorded at the top of each section and the options kept below it as the record. D9 and D10 are calls made while folding his feedback and are open to his objection.

## Settled (do not reopen)

| Ruling | Date | Where recorded |
|---|---|---|
| Engines run only in Docker Sandboxes; never bypass on the host; the Max login pays; the supervisor is the independent durable driver | 2026-09-26 | [planning pass §1](../../briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md) |
| TUA is the game reference and stays its own repository | standing | handoffs |
| The gamified office is the surface Tim will use most; no third repository; one installer, setup and updater as a hard gate; the contract-studio engagement vision | 2026-10-09 | [10-09 handoff](../../../implementation-artifacts/handoff-phase1-loop-2026-10-09.md) |
| **O5: keep the plugin form, drop the marketplace; the installer writes a skills-dir plugin** | 2026-10-09 | [ADR §2 O5](../../briefs/adr-repository-structure-2026-10-09.md#o5-keep-the-plugin-form-drop-the-marketplace-an-installer-written-skills-dir-plugin-recommended-as-the-distribution-overlay-on-o2) |
| **D1 to D8 below** | **2026-10-14** | [decisions-answers.md](decisions-answers.md); the ADR header; AD-21 and AD-22 in the spine |

## D1. Repository

**Ruled: O2, one repository with per-app releases.** Recorded as AD-21. The ADR's §8.2 to §8.7 follow its recommendations (admins stay exempt; the front end gets its own `studio-web--v` tag; `apps/supervisor` stays a nested studio project, proven in rehearsal; the old repository is archived; the meta-CLI ships as a wheel on its own `cli--v` tag). The order is D3's as amended on 2026-10-16: the restructure is EP-28, right after Epic 27 and before the front end.

<details><summary>Options as put (record)</summary>

O2 one repository (ADR recommendation, 3.95); O1 stay split (3.70); O3 hybrid (3.85). O5 made gate 1 moot for users (the installer never clones), so this became a developer and maintainer question: one PR flow and one `main` against nothing moving. Evidence: [ADR §3](../../briefs/adr-repository-structure-2026-10-09.md#3-scoring-against-the-frame), [run 1 §2 A1](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#2-a1-how-comparable-projects-structure-plugin-service-and-ui), [run 1 §11](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#11-contrary-evidence).

</details>

## D2. Hermes

**Ruled: B, drop Hermes; the studio owns its chat over Claude Code.** Tim's reasoning, in substance: Hermes is adjacent, not core; its draw was the agent registry and self-evolution, but a dependency on it blocks users who do not run Hermes, and an adapter would be two parallel systems more likely to conflict than cooperate; the studio builds its own bot, cron and memory as they become necessary; losing Telegram for now is acceptable.

Consequences folded in: the chat route is the supervisor's, answered by the studio's planner leg; the outbound notifier stays (it uses the Telegram Bot API directly and never needed Hermes); Telegram inbound is dropped until a tk-studio-native bot is wanted; [Appendix B](hermes-fit.md) stays as the record; the `adopt_external_logins` hazard stands while the Hermes gateway runs on the box.

<details><summary>Options as put (record)</summary>

A Hermes as the chat brain wrapped by the office; B drop; C Hermes as the first inbound adapter behind a supervisor-owned chat. The recommendation was C; the digest's facts (agents are profiles that cannot point at the supervisor; every dispatch surface runs a Hermes turn; the live credential hazard) are in [Appendix B](hermes-fit.md).

</details>

## D3. Order of work

**Ruled: packaging, then the front end, then the restructure** (2026-10-14). **Amended by Tim on 2026-10-16: packaging, then Epics 26 and 27, then the restructure, then the front end.** EP-25 first; EP-26 and EP-27 (the service owns lifetime); EP-28 is the restructure, narrowed to the supervisor move (`apps/studio-web` is born in place with EP-30, which removes half of the old EP-32's scope); EP-29 to EP-32 are the front end's service and surface work. Epic 23.3 and 24.3/24.4 run alongside.

Why the amendment: after Epic 27 every later epic touches the supervisor, and the two-repository state was paid in full by Epic 27: a read-only mount of tk-studio in the supervisor's sandbox (the run could not touch tk-studio and wrote a hand-over file the operator applied by hand), three PRs instead of one, a second copy of the studio pipeline plugin with `$TK_STUDIO_ROOT` paths, and an installer roster pointing at two repositories. Moving now carries 10 PRs of history instead of 20, and Epic 27's worktrees, hold and host-verify leg are what the ADR §5 rehearsal needs to exercise anyway. Cost: EP-29 (one account) waits one epic.

## D4. Quote basis

**Ruled: both, dollars as the shadow figure.** The band is computed on the meter's per-story history in tokens, shown as plan-window share with a list-price dollar shadow.

## D5. Renderer

**Ruled, with a change of spec: no Next.js; PixiJS; a single web UI for desktop and iPad first; a separate phone UI later.** Tim's reasoning: the studio runs on a dedicated machine and talks directly to the services on it, so a Next.js layer is extra infrastructure; public access, if wanted, is the owner's firewall, DNS and login; a full UI comfortable on a phone is a hard target, so nail functionality on big screens first; PixiJS is a framework without hand-rolling and without exporting a game engine to the web.

Feedback given with the ruling (in the reply and here): agreed on every point. The research had already reduced Next.js to a static-export build tool served by the Bun service, so Vite is the simpler builder with nothing lost; the hybrid stays (PixiJS for the floor, React DOM for the text-heavy panels, since Pixi for text UI would be hand-rolling of another kind); iPad Safari backgrounds event streams the way iOS does, so the watchdog stays; the phone UI, when it comes, is small (inbox, approve, status). One caution became [D10](#d10-public-exposure).

<details><summary>Options as put (record)</summary>

CSS steps()/DOM only (4.60); hybrid DOM plus PixiJS (recommended); Phaser; Godot web; Rive. Evidence: [run 1 §6 B2](../../research/studio-front-end-and-repo-structure-2026-10-09/research.md#6-b2-the-renderer-inside-a-nextjs-front-end).

</details>

## D6. Assets

**Ruled: look at existing packs for reference, then create our own 2D assets with the art tools on the PC (Adobe Creative Cloud or tools with agentic or MCP support), and commit them to the repository.** Consequence: no LimeZu, no private asset fetch in the installer, no share-alike credits; the renderer spike draws its first sprites from our own sheet; an asset-authoring story (tool, pipeline, sprite-sheet format) joins EP-30.

## D7. Sign-in

**Ruled: drop the external providers; one account per studio, username and password set on first visit, kept in the token cookie session, so password managers work.** Tim's reasoning: usage is restricted to the person who set the studio up and whose Claude Code is signed in; this is the ethically safe reading of the subscription terms; sharing the login is outside the studio's control; multi-user later.

Folded in: the owner's account is created on the first visit (hashed with Bun's built-in password hashing, rate limit and lockout); the API bearer stays for automation; the Google and GitHub code is removed when the account lands; the intended-usage statement in [README §8](README.md#8-security-intended-usage-and-invariants).

## D8. API-key fallback

**Ruled: none.** D7's single-owner rule is the answer: the studio is the subscription holder's own seat, stated plainly. The terms clause stays on the staleness watch; no fallback leg is designed.

## D9. What the backend owns

**My call while folding feedback 1, open to objection.** AD-5 says every backend is a projection and canonical files win. Tim's model has the owner writing comments, uploading attachments and authoring Confluence pages, which the canonical files never had. Rule adopted: entity fields stay canonical-authoritative (unchanged); **comments, attachments (as links) and owner-authored Confluence pages are a second class, backend-authoritative and append-only**, pulled back verbatim on the timer and never promoted from local. Written into AD-22. Alternative, if objected to: mirror comments into the canonical story files and promote them too, which creates the two-owner conflicts AD-5 was written to prevent.

## D10. Public exposure

**My call while folding D5, open to objection.** The supervisor keeps its tailnet-only bind as the default. A "public" mode (the owner opens a port, sets DNS, terminates TLS, signs in with the one account) is documented as a later option with rate limiting and lockout required, not built now. Reason: the box holds the repositories and a signed-in Claude; the research found no benefit that needs it today. Tim's wording ("if people need to access the studio from public https, I'd rather require the user to open up a port…") reads as permitting this, not requiring it now.

## Open questions for the stories to settle

| Question | Settled by |
|---|---|
| What do the Atlassian free plans allow: custom workflow statuses, project permissions, storage, API rate, Rovo MCP availability? | EP-31 story 1 verifies on a live free site before anything is built |
| Is the Rovo MCP server needed, or does the REST API with an API token (what the adapter uses today) cover everything? | the same story |
| Does `claude plugin eval` run against a skills-dir plugin path? | EP-25 |
| Is OTel `cost_usd` populated for Max sessions? | one instrumented story run, EP-26 or later |
| Does the PixiJS pixel-scaling recipe hold at desktop and iPad pixel ratios? | the EP-30 spike |
| What sprite-sheet format and authoring tool for our own assets? | the EP-30 asset-authoring story |
| How large is the clone after the supervisor and the web land? | the EP-28 rehearsal (developers only; users never clone) |
