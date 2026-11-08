# Brief — Studio analytics: the metrics, the records, the comparison (2026-11-08)

The research charter behind `research.md`, written before the pass ran and kept as the record of what was asked.

## Decision being served

**Epic 40: the analytics section of the studio web.** Tim, 2026-11-08: "I want a detailed analytics section in the web UI. I want to know how long things are taking, how much they are costing me (dollars and tokens) and also I want you to do some research and see what other metrics would be useful to track and also inform settings. I want data displayed in a user-friendly format such as a per-story and also over time values which will allow me to see how changes are impacting different metrics. For example say I change the model for a certain leg and let it run for a few days I want to be able to see the changes clearly - is it developing faster, slower, or no change? How has the cost been impacted? Things like this". Shape: **technical, with a select sub-decision** (which metrics earn a place; which chart forms; how to compare with few samples). Output: the research document, consumed by the design addendum `design/studio-design-spec-2026-11-08-analytics/README.md` and the Epic 40 section of `epics.md`.

## Dimensions

1. **The candidate metrics of an agentic development loop**, each with the question it answers for the owner, what the studio already records for it (file:line at `b9c977af`), the industry's name for it, and the setting it informs: wall time per stage (plan, dev, review passes, gate, host leg, close-out, queue wait), tokens in and out and cache reads, dollars at list price and metered, cost per landed story and per band, review findings and patches per pass, deviation scores and consult counts, retries and halts, guard trips, time-to-green per host-leg suite, PR size and files touched, test counts.
2. **What the industry measures** for software delivery and for coding agents: DORA (the four or five keys, the 2024 and 2025 reports' AI findings), SPACE, the published metric sets of Claude Code's analytics, GitHub Copilot and Cursor, METR's trials, the Claude Code PR study, SWE-bench's cost reporting.
3. **LLM-ops observability**: the OpenTelemetry GenAI semantic conventions (attribute names for tokens and cache, the agent spans, the absence of a cost attribute), LangSmith, Langfuse, Helicone and Braintrust (what their dashboards show by default and how they compare before and after), Claude Code's `/usage`, `/cost` and `/stats`, its OpenTelemetry metrics and events, the Anthropic Admin usage and cost APIs and their scope, the list prices with the cache multipliers.
4. **CI insights**: GitHub Actions metrics, CircleCI Insights, Buildkite, and what each shows by default (duration trend, success rate, queue time, percentiles, flakiness).
5. **The comparison method for few samples**: medians and ranges against means, exact tests and bootstrap at n of three to ten, process-behaviour (XmR) charts and how many points they need, change-point annotation in Grafana, Datadog, Amplitude and Mixpanel, and the pitfalls (regression to the mean, Simpson's paradox across story bands, perception against measurement).
6. **Chart forms**, by the `dataviz` skill's method, for the owner's four asks.

## Knobs in force

Preset standard; one web fan-out subagent for dimensions 2 to 5 (fresh context, no project files); one repository inventory subagent for dimension 1's "what the studio records" (read-only); the `dataviz` skill loaded for dimension 6; every external claim graded A, B or C with its URL and access date; the studio's own figures read from the queue (read-only), the specs and the ledger on the box on 2026-11-08.

## Research firewall

The planning context (the Epic 39 plan, the handoffs, the kb) shaped the questions, never the external claims. The one place the two meet is dimension 1's "what the studio records" column, which is fact from the repository, not research.

## Output

`research.md` in the house style of `research/studio-front-end-and-repo-structure-2026-10-09/research.md`: an executive summary with the findings that drive the answer and the biggest caveat, one section per dimension, recommendations, the unsettled items named, the source appendix, the staleness map.
