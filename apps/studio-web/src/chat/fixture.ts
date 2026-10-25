// Story 32.7: the vitest fixture — engagement records in each state (the `GET /engagements?project=p` shape), the
// questions (one default option each), a quote (`engage.py quote`'s band), and chat lines with planner proposals.
import type { ChatLine, Engagement, EngagementState, InputLine, Question, Quote } from "./model";

export const SCOPE_URL = "https://example.atlassian.net/wiki/spaces/TK/pages/42/ENG-001%3A+Scope+of+Work";

export const questions = (): Question[] => [
  { id: "auth", text: "Which sign-in?", options: [{ label: "Token" }, { label: "Account", default: true }], impact: "the session shape" },
  { id: "store", text: "Where do records live?", options: [{ label: "SQLite", default: true }, { label: "Files" }], impact: "the migration" },
];

export const quote = (): Quote => ({
  band50: { tokens: 1_200_000, usd: 4.5, share: 0.12 },
  band85: { tokens: 1_800_000, usd: 6.75, share: 0.18 },
  band95: { tokens: 2_400_000, usd: 9, share: "share unknown" },
  cap: 11.25,
  basis: { autonomy: ["ask", "steady", "full"], notes: ["thin history: 3 landed stories"], planning_usd: 0.8, scoping_billable: false, thin: true },
  computed_at: "2026-10-25T10:00:00Z",
});

const line = (from: string, to: string, verb: string, at = "2026-10-25T09:00:00Z"): InputLine => ({ at, verb, source: "cookie", from, to });

/** One record in `state`, with what that state carries (questions, a scope page, a quote, spend). */
export function engagement(state: EngagementState, over: Partial<Engagement> = {}): Engagement {
  const quoted = ["quoted", "approved", "in-progress", "paused", "partial", "delivered"].includes(state);
  return {
    id: "ENG-001",
    project: "p",
    state,
    request: "Add a sign-in to the web",
    questions: state === "intake" ? [] : questions(),
    assumptions: [],
    scope_page: state === "intake" || state === "awaiting-answers" ? null : { id: "42", url: SCOPE_URL, version: 3 },
    quote: quoted ? quote() : null,
    autonomy: quoted && state !== "quoted" ? "steady" : null,
    approved_at: quoted && state !== "quoted" ? "2026-10-25T11:00:00Z" : null,
    created: "2026-10-25T08:00:00Z",
    updated: "2026-10-25T12:00:00Z",
    spend: { planning_usd: 0.8, runs_usd: state === "partial" ? 11.4 : 0 },
    inputs: [],
    ...over,
  };
}

/** The inputs that led `in-progress → paused` (then a question while paused, which keeps the state). */
export const pausedInputs = (): InputLine[] => [
  line("intake", "scoping", "go"),
  line("scoping", "quoted", "go"),
  line("quoted", "approved", "approve"),
  line("approved", "in-progress", "launched"),
  line("in-progress", "paused", "run-paused"),
  line("paused", "paused", "question"),
];

/** `partial` reached at the cap, then cancelled from `partial`. */
export const cancelledFromPartialInputs = (): InputLine[] => [
  line("approved", "in-progress", "launched"),
  line("in-progress", "partial", "cap"),
  line("partial", "cancelled", "cancel"),
];

export const chatLines = (): ChatLine[] => [
  { seq: 1, at: "2026-10-25T08:01:00Z", author: "owner", body: "Add a sign-in to the web" },
  {
    seq: 2, at: "2026-10-25T08:03:00Z", author: "planner", body: "Two questions first; or go on the defaults.", run_id: "q-chat-1",
    proposals: [
      { verb: "go", payload: {}, label: "Go on the defaults" },
      { verb: "answer", payload: { answers: { auth: "Token" } }, label: "Token sign-in" },
      { verb: "approve", payload: { autonomy: "steady" }, label: "Approve, steady" },
      { verb: "launch", payload: {}, label: "not a verb" },
      { verb: "go", payload: {}, label: "x".repeat(81) },
    ],
  },
  { seq: 3, at: "2026-10-25T08:05:00Z", author: "owner", body: "Account, please" },
];
