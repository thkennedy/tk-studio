# Claude Code's advisor tool and the studio's escalation points (fit note, 2026-10-09)

Tim asked, mid-session on 2026-10-09: Anthropic ships an "advisor tool" that functions very like the escalation points baked into the loop; can the studio incorporate it? This note answers from the official page (https://code.claude.com/docs/en/advisor, read 2026-10-09) and the studio's own pipeline. It is a proposal, not a change; the change goes through the evolve loop (an observation is recorded) and a routing story.

## What the advisor is

- Claude pairs its main model with a second, typically stronger model that it consults "at key moments during a task, such as before committing to an approach, when stuck on a recurring error, or before declaring a task complete". The advisor "receives the full conversation, including every tool call and result, and returns guidance that Claude applies before continuing".
- It is a **server tool** on Anthropic's infrastructure, experimental, Anthropic API only (not Bedrock, Vertex, Foundry). "You choose which model acts as the advisor, and Claude decides when to call it." There is "no setting to cap or force advisor calls"; you steer frequency through instructions ("consult the advisor before you continue").
- Enabled by `/advisor <model>` (also in `-p`, the SDK, the desktop app and Remote Control from v2.1.260), by `advisorModel` in settings, or by `claude --advisor <model>` for one session. `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` disables it entirely.
- Pairing rule: the advisor must rank at or above the main model. For the studio's current route (every leg Opus 5.5) the accepted advisors are **Fable or Opus 5 or later**. For a Sonnet 5.5 main model: Fable, Opus 5 or later, Sonnet 5.5. Haiku 4.5 can call an advisor but cannot be one. **Subagents inherit the configured advisor** and apply the same pairing check to their own model.
- Fable as advisor needs Fable access and, on some plans, the one-time usage-credits consent; before consent Claude Code silently sends requests without the advisor.
- Requires feature-flag fetching: "In a session where a variable that turns flag fetching off is set, such as `DISABLE_TELEMETRY`, the advisor stays off."
- Cost: each call makes the advisor read the whole conversation, **uncached**, at the advisor model's rates; on subscriptions it counts toward plan limits (Fable to usage credits). Toggling the advisor does not invalidate the main model's prompt cache. Guidance is cached as part of the transcript afterwards.
- Behaviour: "Claude generally follows the advisor's guidance, but adapts when its own evidence contradicts a specific claim" and surfaces the conflict. The transcript shows `Advising`, then Reviewed / Declined / Unavailable; guidance is readable with Ctrl+O.

## How it maps to the studio's escalation points

| Studio mechanism | What it does today | Advisor fit |
|---|---|---|
| **Consult leg** (`route.consult.model`; dev session launches a foreground consult subagent on objective triggers: `verify-red`, `halt`, `deviation-gt-0`, `high-severity-finding`, `tripwire`, `seam-text-fix`, `file-outside-files`; every consult is logged in the spec's Consult Log and as an observation) | A stronger model answers one packaged question with a `RULING` and `DO:` lines | **Closest match.** The advisor is the harness-native form of the same idea with two differences: the advisor sees the full conversation (ours sees one packaged question), and the advisor's timing is model-driven and uncapped (ours is trigger-based and logged). The studio keeps the trigger list as the instruction text that tells Claude when to consult; the audit trail must come from the transcript (advisor calls are tool uses) rather than from the Consult Log, or the session appends the Consult Log entry after each advisor call. |
| **`RULING: escalate`** and `reconcile_verdict: escalate` (pause the run; `bmad-loop-resolve` with a human) | Hands the decision to Tim | **Not replaced.** The advisor is machine-to-machine; a decision only the operator can make still pauses the run. |
| **Studio gate session** (`pre_commit_gate`, reconcile against later stories and the spine) | A review-model session scores deviation and records a verdict | **Not replaced.** The gate is a check after the work; the advisor is guidance during it. The gate session could itself carry an advisor. |
| **Reviewer subagents** (blind hunter, edge-case hunter) | Review the diff; 40–50% of story cost | **Partly.** Subagents inherit the advisor, so a reviewer on Sonnet with an Opus advisor is the cheapest way to try the advisor on review cost. |
| **Supervisor `blocked` / `partial` status blocks** (AD-11) | Headless runs end with the terminal block | **Unchanged.** |
| **Plan mode / `opusplan`** | Stronger model in plan mode, then switch | The doc's own comparison table: advisor runs "at decision points mid-task"; `opusplan` runs "during plan mode". The studio's planner leg already pins its own model. |

## Why it matters for Epic 24 (the Opus 5.5 trial)

The trial's open question is the routing lever: the review share of a story is 40–53%, and every leg runs Opus 5.5. The advisor offers a third route the trial has not measured: a **cheaper main model with a stronger advisor** ("Sonnet handles routine work and escalates planning, ambiguous failures, and completion checks to Opus", in the doc's words), which "typically costs less than running the stronger model throughout". For the studio this becomes a measurable arm beside the two routes 24.3 already pairs.

Risks the trial must price in:

1. **Uncapped, uncached full-transcript reads.** A dev session runs 3.9M–4.4M weighted tokens; each advisor call re-reads the whole transcript at Opus rates. Ten calls on a long session could cost more than the session. The meter (Story 24.1, `meter.py`) prices by `message.id` and model from the transcript; advisor usage is reported separately by the API and must be added to the price table and the `finish` cost, or the trial under-counts.
2. **Subagent inheritance.** The implementer and the two reviewers each get the advisor, multiplying call sites. The dispatch note must say when to consult, and the implementer and reviewer prompts should pass `--advisor` explicitly or `off`, as they already pass `model` per leg.
3. **Feature-flag fetching** must be on in the engine sandbox (no `DISABLE_TELEMETRY`); checked 2026-10-09: the engine configuration sets no such variable.
4. **Version**: `/advisor` in `-p` needs v2.1.260 or later; the sandboxes run 2.1.284.
5. **Fable consent** on Max: Fable as advisor needs the one-time `/model fable` consent in the sandbox's account context; before it, requests silently go without an advisor. Opus 5.5 as advisor needs nothing.

## Proposal (for the evolve loop and a routing story)

1. Add an `advisor` field to the routing legs (`pipeline.legs.<leg>.advisor = "opus" | "fable" | "off"`), applied as `--advisor <model>` on the session leg and forwarded to the implementer and reviewer subagent launches like `model` and `effort` are today. Default `off`, so nothing changes until a route asks.
2. Extend the dispatch note with the consult triggers as advisor instructions ("consult the advisor on: verify-red, halt, deviation above 0, a high-severity finding, a tripwire, a file outside the plan's Files, and before declaring the story done"), and have the session append a Consult Log entry per advisor call so the audit trail survives.
3. Extend the meter to price advisor tokens (API usage fields for the advisor server tool) and to report them as their own leg, so a route's advisor cost is visible beside session, implementer, reviewers, consult, review and gate.
4. Run a third arm in Epic 24.3: **Sonnet 5.5 main (session, implementer, reviewers) + Opus 5.5 advisor**, against the two existing routes, on the same TUA story pairs. Judge in 24.4 with the advisor leg priced.
5. Leave the human escalation (`escalate`, `bmad-loop-resolve`) and the gate untouched.

## Rulings only Tim can make

- Whether Fable may serve as an advisor on his Max plan (usage-credits consent) or the trial stays on Opus 5.5 advisors.
- Whether the advisor replaces the consult subagent entirely once measured, or the two coexist (advisor for mid-task guidance, consult for the logged rulings).
