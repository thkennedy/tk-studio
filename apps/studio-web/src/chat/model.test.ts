// Story 32.7 AC2: the Chat screen's rules from the fixture without a browser — the actions per state (pinned cell
// for cell against `TRANSITIONS`), the stepper and its side exits, the question cards and the `answer` payload, the
// quote as the band, every verb's payload and its post (the CSRF header, `?project=`, never throws), the refusals'
// text, the proposals, the nav count, the remembered engagement, the transcript merge and the cost on hover.
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../inbox/model";
import { NONE, type StorageLike } from "../office/model";
import { cancelledFromPartialInputs, chatLines, engagement, pausedInputs, quote, questions, SCOPE_URL } from "./fixture";
import {
  ACTIONS, allows, answerInput, APPROVED_TEXT, approveInput, AUTONOMY_LEVELS, autonomyChoice, byState, cancelInput, canSendInput, canSendText, capOf, CHAT_KEY,
  chatNavCount, chatUrl, createCostCache, ENGAGEMENT_STATES, fetchChat, fetchEngagement, fetchEngagements, fetchRunCost, goInput, INPUT_VERBS,
  mergeLines, PAUSED_TEXT, postChat, postEngagement, postInput, proposalButton, proposalButtons, questionCards, questionInput, quoteView,
  refusalText, rememberedEngagement, rememberEngagement, reviseInput, scopeHref, stateNote, stepper, type ChatLine, type EngagementState, type Input,
} from "./model";

interface Call { url: string; init?: RequestInit }
const recording = (status: number, body: unknown) => {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } };
  };
  return { f, calls };
};
const failing: FetchLike = async () => { throw new Error("network down"); };
const memory = (init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};
const throwing: StorageLike = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
const headersOf = (c: Call) => c.init?.headers as Record<string, string>;
const bodyOf = (c: Call) => JSON.parse(String(c.init?.body));

describe("the actions per state (Settled shape 3)", () => {
  it("pins every TRANSITIONS verb cell; a terminal state has none", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...ENGAGEMENT_STATES].sort());
    const cells: Record<EngagementState, string[]> = {
      intake: ["go", "question", "cancel"],
      "awaiting-answers": ["answer", "go", "question", "cancel"],
      scoping: ["go", "revise", "question", "cancel"],
      quoted: ["revise", "question", "approve", "cancel"],
      approved: ["revise", "question", "cancel"],
      "in-progress": ["revise", "question", "cancel"],
      paused: ["revise", "question", "cancel"],
      partial: ["go", "revise", "question", "cancel"],
      delivered: [],
      failed: [],
      cancelled: [],
    };
    for (const s of ENGAGEMENT_STATES) {
      expect([...ACTIONS[s]].sort(), s).toEqual([...cells[s]].sort());
      for (const v of INPUT_VERBS) expect(allows(s, v), `${s}/${v}`).toBe(cells[s].includes(v));
    }
    expect(allows("bogus", "go")).toBe(false);
  });
});

describe("the stepper (Settled shape 4)", () => {
  const statuses = (s: ReturnType<typeof stepper>) => s.steps.map((x) => `${x.state}:${x.status}`);

  it("the main path with the current step; delivered is all done", () => {
    expect(statuses(stepper(engagement("scoping")))).toEqual([
      "intake:done", "awaiting-answers:done", "scoping:current", "quoted:todo", "approved:todo", "in-progress:todo", "delivered:todo",
    ]);
    expect(stepper(engagement("scoping")).exit).toBeNull();
    expect(stepper(engagement("delivered")).steps.every((x) => x.status === "done")).toBe(true);
  });

  it("paused after in-progress: the side exit marked against in-progress (the newest line entering it)", () => {
    const s = stepper(engagement("paused", { inputs: pausedInputs() }));
    expect(s.exit).toEqual({ state: "paused", from: "in-progress" });
    expect(statuses(s)).toEqual([
      "intake:done", "awaiting-answers:done", "scoping:done", "quoted:done", "approved:done", "in-progress:left", "delivered:todo",
    ]);
  });

  it("cancelled from partial follows partial back to the step it left; a cancel from scoping marks scoping", () => {
    expect(stepper(engagement("cancelled", { inputs: cancelledFromPartialInputs() })).exit).toEqual({ state: "cancelled", from: "in-progress" });
    const fromScoping = [{ at: "t", verb: "cancel", source: "cookie", from: "scoping", to: "cancelled" }];
    expect(stepper(engagement("cancelled", { inputs: fromScoping })).exit).toEqual({ state: "cancelled", from: "scoping" });
  });

  it("no inputs[] hint: the closest main step", () => {
    expect(stepper(engagement("partial")).exit).toEqual({ state: "partial", from: "in-progress" });
    expect(stepper(engagement("failed")).exit).toEqual({ state: "failed", from: "in-progress" });
    expect(stepper(engagement("paused")).exit).toEqual({ state: "paused", from: "in-progress" });
    expect(stepper(engagement("cancelled")).exit).toEqual({ state: "cancelled", from: "intake" });
  });
});

describe("the question cards", () => {
  it("options in order, the default marked and pre-selected; an answer recorded wins", () => {
    expect(questionCards(questions())).toEqual([
      { id: "auth", text: "Which sign-in?", impact: "the session shape", options: [{ label: "Token", isDefault: false }, { label: "Account", isDefault: true }], selected: "Account", answered: false },
      { id: "store", text: "Where do records live?", impact: "the migration", options: [{ label: "SQLite", isDefault: true }, { label: "Files", isDefault: false }], selected: "SQLite", answered: false },
    ]);
    const answered = questionCards([{ ...questions()[0], answer: "Token" }]);
    expect(answered[0]).toMatchObject({ selected: "Token", answered: true });
    expect(questionCards(null)).toEqual([]);
  });

  it("an answer sends {verb: answer, answers: {<id>: <label>}} for the open cards", () => {
    const cards = questionCards(questions());
    expect(answerInput(cards)).toEqual({ verb: "answer", answers: { auth: "Account", store: "SQLite" } });
    expect(answerInput(cards, { auth: "Token" })).toEqual({ verb: "answer", answers: { auth: "Token", store: "SQLite" } });
    const one = questionCards([{ ...questions()[0], answer: "Token" }, questions()[1]]);
    expect(answerInput(one)).toEqual({ verb: "answer", answers: { store: "SQLite" } });
    expect(answerInput(questionCards([{ ...questions()[0], answer: "Token" }]))).toBeNull();
  });
});

describe("the quote as the band", () => {
  it("50/85/95 as share and dollars, the cap and the autonomy levels", () => {
    expect(quoteView(quote())).toEqual({
      bands: [
        { name: "50", usd: "$4.50", share: "12.0%", tokens: "1200000" },
        { name: "85", usd: "$6.75", share: "18.0%", tokens: "1800000" },
        { name: "95", usd: "$9.00", share: "share unknown", tokens: "2400000" },
      ],
      cap: "$11.25",
      autonomy: ["ask", "steady", "full"],
      notes: ["thin history: 3 landed stories"],
    });
    expect(quoteView(null)).toBeNull();
    const bare = quoteView({ ...quote(), band50: { tokens: null, usd: 1, share: null }, basis: {} });
    expect(bare?.bands[0]).toEqual({ name: "50", usd: "$1.00", share: NONE, tokens: NONE });
    expect(bare?.autonomy).toEqual([...AUTONOMY_LEVELS]);
  });
});

describe("each action's payload", () => {
  it("approve: the autonomy, base_ref only when non-blank; an invalid autonomy is never sent", () => {
    expect(approveInput("steady")).toEqual({ verb: "approve", autonomy: "steady" });
    expect(approveInput("steady", "  ")).toEqual({ verb: "approve", autonomy: "steady" });
    expect(approveInput("full", " main ")).toEqual({ verb: "approve", autonomy: "full", base_ref: "main" });
    expect(approveInput("reckless")).toBeNull();
  });

  it("approve: the autonomy sent is always one the quote offers (clamped; outside the offer disabled)", () => {
    expect(autonomyChoice(["ask", "full"], "steady")).toBe("ask");
    expect(autonomyChoice(["ask", "full"], "full")).toBe("full");
    expect(autonomyChoice(["ask", "steady", "full"], "bogus")).toBe("steady");
    expect(autonomyChoice(["full"], null)).toBe("full");
    expect(autonomyChoice([], "steady")).toBeNull();
    const offered = quoteView({ ...quote(), basis: { autonomy: ["ask", "full"] } })!.autonomy;
    expect(offered).toEqual(["ask", "full"]);
    expect(approveInput("steady", "", offered)).toBeNull();
    expect(approveInput(autonomyChoice(offered, "steady")!, "", offered)).toEqual({ verb: "approve", autonomy: "ask" });
  });

  it("go: bare outside partial; in partial a positive cap, blank or non-positive disabled", () => {
    expect(goInput("scoping")).toEqual({ verb: "go" });
    expect(goInput("partial", "12.5")).toEqual({ verb: "go", cap: 12.5 });
    for (const bad of ["", "  ", "-1", "0", "abc"]) expect(goInput("partial", bad), bad).toBeNull();
    expect(capOf("3")).toBe(3);
  });

  it("revise, question and cancel", () => {
    expect(reviseInput()).toEqual({ verb: "revise" });
    expect(reviseInput("## Goal\nmore")).toEqual({ verb: "revise", body: "## Goal\nmore" });
    expect(questionInput("  ")).toBeNull();
    expect(questionInput("how long?")).toEqual({ verb: "question", text: "how long?" });
    expect(cancelInput()).toEqual({ verb: "cancel" });
    expect(cancelInput(" not now ")).toEqual({ verb: "cancel", reason: "not now" });
  });

  it("a proposal sends exactly {verb, ...payload}; outside its cell it is disabled naming the state", () => {
    const [go, answer, approve] = proposalButtons("scoping", chatLines()[1]);
    expect(proposalButtons("scoping", chatLines()[1])).toHaveLength(3); // a non-verb and an over-long label dropped
    expect(go).toEqual({ label: "Go on the defaults", input: { verb: "go" }, enabled: true, note: null });
    expect(answer).toEqual({ label: "Token sign-in", input: { verb: "answer", answers: { auth: "Token" } }, enabled: false, note: "not in scoping" });
    expect(approve).toEqual({ label: "Approve, steady", input: { verb: "approve", autonomy: "steady" }, enabled: false, note: "not in scoping" });
    expect(proposalButton("quoted", { verb: "approve", payload: { autonomy: "steady" }, label: "Approve" }).enabled).toBe(true);
    expect(proposalButtons("scoping", { proposals: undefined })).toEqual([]);
  });

  it("the gate: every send waits for the engagement and the CSRF token, nothing in flight", () => {
    const g = { loaded: true, csrf: "tok", sending: false };
    expect(canSendInput({ verb: "go" }, g)).toBe(true);
    expect(canSendInput(null, g)).toBe(false);
    expect(canSendInput({ verb: "go" }, { ...g, csrf: null })).toBe(false);
    expect(canSendInput({ verb: "go" }, { ...g, sending: true })).toBe(false);
    expect(canSendInput({ verb: "go" }, { ...g, loaded: false })).toBe(false);
    expect(canSendText("hi", g)).toBe(true);
    expect(canSendText("  ", g)).toBe(false);
    expect(canSendText("hi", { ...g, csrf: null })).toBe(false);
  });
});

describe("the posts: the CSRF header, ?project=, never throw", () => {
  const inputs: Input[] = [
    answerInput(questionCards(questions()))!, goInput("partial", "12.5")!, reviseInput("body"), questionInput("why?")!,
    approveInput("steady", "main")!, cancelInput("later"),
  ];

  it("each verb posts exactly its input to /engagements/{id}/input?project=", async () => {
    expect(inputs.map((i) => i.verb).sort()).toEqual([...INPUT_VERBS].sort());
    for (const input of inputs) {
      const { f, calls } = recording(200, { ok: true, engagement: engagement("scoping"), from: "scoping", to: "scoping" });
      const r = await postInput("p", "ENG-001", input, "tok", f);
      expect(r).toMatchObject({ ok: true, from: "scoping", to: "scoping" });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("/engagements/ENG-001/input?project=p");
      expect(calls[0].init).toMatchObject({ method: "POST", credentials: "same-origin" });
      expect(headersOf(calls[0])["x-csrf-token"]).toBe("tok");
      expect(bodyOf(calls[0])).toEqual(input);
    }
  });

  it("POST /chat/{id}?project= {message}; POST /engagements {project, request}", async () => {
    const chat = recording(200, { ok: true, engagement: "ENG-001", seq: 4, run_id: "q-2" });
    expect(await postChat("p", "ENG-001", "hello", "tok", chat.f)).toEqual({ ok: true, seq: 4, run_id: "q-2" });
    expect(chat.calls[0].url).toBe("/chat/ENG-001?project=p");
    expect(headersOf(chat.calls[0])["x-csrf-token"]).toBe("tok");
    expect(bodyOf(chat.calls[0])).toEqual({ message: "hello" });
    const create = recording(200, { ok: true, engagement: engagement("intake", { id: "ENG-002" }) });
    const made = await postEngagement("p", "Docs please", "tok", create.f);
    expect(made.ok && made.engagement.id).toBe("ENG-002");
    expect(create.calls[0].url).toBe("/engagements?project=p");
    expect(create.calls[0].init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(headersOf(create.calls[0])["x-csrf-token"]).toBe("tok");
    expect(bodyOf(create.calls[0])).toEqual({ project: "p", request: "Docs please" });
  });

  it("a network error or a malformed answer is a failure, never a throw", async () => {
    for (const r of [await postInput("p", "ENG-001", { verb: "go" }, "tok", failing), await postChat("p", "ENG-001", "x", "tok", failing), await postEngagement("p", "x", "tok", failing)]) {
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain("network down");
    }
    expect((await postInput("p", "ENG-001", { verb: "go" }, "tok", recording(200, { ok: true }).f)).ok).toBe(false);
  });
});

describe("the refusals' rendering", () => {
  it("409 IllegalInput renders {state, verb}", async () => {
    const { f } = recording(409, { ok: false, error: "IllegalInput", engagement: "ENG-001", state: "scoping", verb: "approve" });
    const r = await postInput("p", "ENG-001", approveInput("steady")!, "tok", f);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal).toEqual({ status: 409, name: "IllegalInput", state: "scoping", verb: "approve" });
    expect(r.error).toBe("/engagements/ENG-001/input?project=p: IllegalInput: approve is not allowed in scoping");
    expect(r.retryable).toBe(false);
    expect(refusalText({ status: 409, name: "IllegalInput", state: "scoping", verb: "go", detail: "quote-present" })).toBe("IllegalInput: go is not allowed in scoping (quote-present)");
  });

  it("503 ChatBusy is retryable; 500 ChatJobUnresolved / ChatQueueFailed say no line was kept", async () => {
    const busy = await postChat("p", "ENG-001", "hello", "tok", recording(503, { ok: false, error: "ChatBusy", engagement: "ENG-001", detail: "held" }).f);
    expect(busy).toMatchObject({ ok: false, retryable: true });
    expect(!busy.ok && busy.error).toContain("ChatBusy: another message is being written; try again (your text is kept)");
    for (const name of ["ChatJobUnresolved", "ChatQueueFailed"]) {
      const r = await postChat("p", "ENG-001", "hello", "tok", recording(500, { ok: false, error: name, detail: "boom" }).f);
      expect(r).toMatchObject({ ok: false, retryable: false });
      expect(!r.ok && r.error).toContain(`${name}: `);
      expect(!r.ok && r.error).toContain("no line was kept (boom)");
    }
  });

  it("EngagementClosed, CsrfRefused, AmbiguousEngagement, an unnamed and an unknown refusal", () => {
    expect(refusalText({ status: 409, name: "EngagementClosed", state: "delivered", verb: "go" })).toBe("EngagementClosed: the engagement is delivered; go cannot be sent");
    expect(refusalText({ status: 409, name: "EngagementClosed", state: "delivered" })).toBe("EngagementClosed: the engagement is delivered; nothing more can be sent");
    expect(refusalText({ status: 409, name: "EngagementClosed" })).toBe("EngagementClosed: the engagement is closed; nothing more can be sent");
    expect(refusalText({ status: 403, name: "CsrfRefused" })).toBe("CsrfRefused: the page's token was refused; reload the page");
    expect(refusalText({ status: 409, name: "AmbiguousEngagement" })).toBe("AmbiguousEngagement: that id is in more than one project");
    expect(refusalText({ status: 409, name: "ProposalAlreadyPressed" })).toBe("ProposalAlreadyPressed: already pressed");
    expect(refusalText({ status: 502, name: null })).toBe("answered 502");
    expect(refusalText({ status: 400, name: "SchemaError", detail: "field 'cap' must be a number > 0" })).toBe("SchemaError: answered 400 (field 'cap' must be a number > 0)");
  });
});

describe("the reads", () => {
  it("GET /engagements?project=, GET /engagements/{id}?project=, GET /chat/{id}?project=&since=", async () => {
    const list = recording(200, { ok: true, project: "p", engagements: [engagement("quoted"), { nope: 1 }], problems: ["x"] });
    const l = await fetchEngagements("p", list.f);
    expect(list.calls[0].url).toBe("/engagements?project=p");
    expect(list.calls[0].init).toMatchObject({ credentials: "same-origin" });
    expect(l.ok && l.engagements.map((e) => e.state)).toEqual(["quoted"]);
    expect(l.ok && l.problems).toEqual(["x"]);
    const one = recording(200, { ok: true, project: "p", engagement: engagement("scoping"), chat: { route: "/chat/ENG-001", path: "x", last_seq: 3 } });
    const o = await fetchEngagement("p", "ENG-001", one.f);
    expect(one.calls[0].url).toBe("/engagements/ENG-001?project=p");
    expect(o.ok && o.last_seq).toBe(3);
    const chat = recording(200, { ok: true, project: "p", engagement: "ENG-001", since: 1, last_seq: 3, lines: [...chatLines().slice(1), { seq: "bad" }] });
    const c = await fetchChat("p", "ENG-001", 1, chat.f);
    expect(chat.calls[0].url).toBe("/chat/ENG-001?project=p&since=1");
    expect(c.ok && c.lines.map((x) => x.seq)).toEqual([2, 3]);
    expect(chatUrl("p q", "ENG-001")).toBe("/chat/ENG-001?project=p%20q");
  });

  it("a refused or failed read is named, never thrown", async () => {
    const r = await fetchEngagement("p", "ENG-001", recording(409, { ok: false, error: "AmbiguousEngagement" }).f);
    expect(!r.ok && r.error).toBe("/engagements/ENG-001?project=p: AmbiguousEngagement: that id is in more than one project");
    expect((await fetchEngagements("p", failing)).ok).toBe(false);
    expect((await fetchChat("p", "ENG-001", 0, failing)).ok).toBe(false);
  });

  it("a record without request or project is dropped from the list, and a malformed single read", async () => {
    const noRequest: Record<string, unknown> = { ...engagement("quoted") };
    delete noRequest.request;
    const noProject: Record<string, unknown> = { ...engagement("scoping") };
    delete noProject.project;
    const l = await fetchEngagements("p", recording(200, { ok: true, project: "p", engagements: [engagement("approved"), noRequest, noProject] }).f);
    expect(l.ok && l.engagements.map((e) => e.state)).toEqual(["approved"]);
    const o = await fetchEngagement("p", "ENG-001", recording(200, { ok: true, project: "p", engagement: noRequest }).f);
    expect(!o.ok && o.error).toBe("/engagements/ENG-001?project=p: no engagement in the answer");
  });
});

describe("the cost on hover", () => {
  it("GET /runs/{id} cost_usd: fetched once per run_id, cached; null is not metered", async () => {
    const { f, calls } = recording(200, { ok: true, run_id: "q-chat-1", studio_run_id: "s", cost_usd: 0.42 });
    let changes = 0;
    const cache = createCostCache(f, () => changes++);
    expect(cache.text("q-chat-1")).toBeNull();
    await Promise.all([cache.request("q-chat-1"), cache.request("q-chat-1")]);
    await cache.request("q-chat-1");
    expect(calls.map((c) => c.url)).toEqual(["/runs/q-chat-1"]);
    expect(cache.text("q-chat-1")).toBe("$0.42");
    expect(changes).toBe(1);
  });

  it("a null cost shows not metered and is fetched again on the next hover, until the job-run line lands", async () => {
    let cost: number | null = null;
    const urls: string[] = [];
    const f: FetchLike = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true, cost_usd: cost }), headers: { get: () => null } };
    };
    const cache = createCostCache(f);
    await cache.request("q-2");
    expect(cache.text("q-2")).toBe("not metered");
    cost = 0.3;
    await cache.request("q-2");
    expect(cache.text("q-2")).toBe("$0.30");
    await cache.request("q-2");
    expect(urls).toEqual(["/runs/q-2", "/runs/q-2"]);
  });

  it("a fetch failure shows no cost, never throws, and is retried on the next hover", async () => {
    let fail = true;
    const urls: string[] = [];
    const f: FetchLike = async (url) => {
      urls.push(url);
      if (fail) throw new Error("network down");
      return { ok: true, status: 200, json: async () => ({ ok: true, cost_usd: 1.5 }), headers: { get: () => null } };
    };
    const cache = createCostCache(f);
    await expect(cache.request("q-3")).resolves.toBeUndefined();
    expect(cache.text("q-3")).toBeNull();
    fail = false;
    await cache.request("q-3");
    expect(cache.text("q-3")).toBe("$1.50");
    expect(urls).toHaveLength(2);
    expect(await fetchRunCost("q-4", recording(404, { ok: false, error: "RunNotFound" }).f)).toEqual({ ok: false });
  });
});

describe("the list, the state's words, the nav count and the remembered engagement", () => {
  it("lists by state in the table's order, newest first within a state", () => {
    const a = engagement("quoted", { id: "ENG-003" });
    const b = engagement("intake", { id: "ENG-002" });
    const c = engagement("quoted", { id: "ENG-001" });
    expect(byState([a, b, c]).map((g) => [g.state, g.engagements.map((e) => e.id)])).toEqual([["intake", ["ENG-002"]], ["quoted", ["ENG-003", "ENG-001"]]]);
  });

  it("approved / paused / partial words; no PR link; the scope page link", () => {
    expect(stateNote(engagement("approved"))).toBe(APPROVED_TEXT);
    expect(APPROVED_TEXT).toBe("approved; the run starts when the plan PR merges");
    expect(stateNote(engagement("paused"))).toBe(PAUSED_TEXT);
    expect(PAUSED_TEXT).toContain("reply `continue` on the engagement's Jira issue");
    expect(stateNote(engagement("partial"))).toBe("partial: spent $11.40 of the $11.25 cap; Go with a new cap, or Cancel");
    expect(stateNote(engagement("scoping"))).toBeNull();
    expect(scopeHref(engagement("scoping"))).toBe(SCOPE_URL);
    expect(scopeHref(engagement("scoping", { scope_page: { url: "javascript:alert(1)" } }))).toBeNull();
    expect(scopeHref(engagement("intake"))).toBeNull();
  });

  it("the nav count: awaiting-answers and quoted across projects; none is null", () => {
    const rows = [
      { id: "ENG-001", project: "p", state: "awaiting-answers" },
      { id: "ENG-001", project: "o", state: "quoted" },
      { id: "ENG-002", project: "p", state: "scoping" },
    ];
    expect(chatNavCount(rows)).toBe(2);
    expect(chatNavCount(rows.slice(1))).toBe(1);
    expect(chatNavCount(rows.slice(2))).toBeNull();
    expect(chatNavCount([])).toBeNull();
    expect(chatNavCount(undefined)).toBeNull();
  });

  it("tk-studio.web.chat = {project, id}; malformed or throwing is null", () => {
    expect(CHAT_KEY).toBe("tk-studio.web.chat");
    const s = memory();
    rememberEngagement({ project: "p", id: "ENG-001" }, s);
    expect(JSON.parse(s.data[CHAT_KEY])).toEqual({ project: "p", id: "ENG-001" });
    expect(rememberedEngagement(s)).toEqual({ project: "p", id: "ENG-001" });
    expect(rememberedEngagement(memory({ [CHAT_KEY]: "{bad" }))).toBeNull();
    expect(rememberedEngagement(memory({ [CHAT_KEY]: JSON.stringify({ project: "p" }) }))).toBeNull();
    expect(rememberedEngagement(throwing)).toBeNull();
    expect(() => rememberEngagement({ project: "p", id: "x" }, throwing)).not.toThrow();
  });

  it("the transcript merges by seq, a duplicate ignored", () => {
    const [a, b, c] = chatLines();
    const merged = mergeLines([a, c], [b, { ...c, body: "dup" }]);
    expect(merged.map((l: ChatLine) => [l.seq, l.body])).toEqual([[1, a.body], [2, b.body], [3, c.body]]);
    const same = [a];
    expect(mergeLines(same, [a])).toBe(same);
  });
});

// ------------------------------------------------------------ Story 39.3: the studio chat
// The delta assembly (in order, from 0 after a reconnect, an overlap, a gap ignored, the record replacing the stream),
// the proposal mapping (every kind to its request, the answer body with and without a note, both 39.7 kinds
// disabled), the pending label at positions 1 and 3, and the excerpt fixtures (the supervisor's `excerpt` pins the same).
import {
  answerBody, applyDelta, CURSOR, isDecisionLine, rememberedSent, rememberSent, excerpt, fetchStudioChat, LINE_MAX_CHARS, NOT_YET_TEXT, pendingLabel, pendingTurns, PENDING_TEXT, postJob, postPress,
  postStudioLine, press, pressedKeys, proposalAction, proposalOfStudio, sentUnrecordedText, studioButtons, studioChatUrl, withDelta, withoutAnswered,
  type StudioLine, type StudioProposal, type Streams,
} from "./model";

const owner = (seq: number, body: string, extra: Partial<StudioLine> = {}): StudioLine => ({ seq, at: "t", author: "owner", body, ...extra });
const reply = (seq: number, reply_to: number, proposals: unknown[] = []): StudioLine =>
  ({ seq, at: "t", author: "planner", body: `reply to ${reply_to}`, run_id: `r${reply_to}`, reply_to, proposals });

describe("the studio chat: the excerpt (fixtures shared with the supervisor's studiochat.test.ts)", () => {
  it("collapses whitespace, trims, and cuts past 40 code points with …", () => {
    expect(excerpt("what is running")).toBe("what is running");
    expect(excerpt("  what \n\t is   running  ")).toBe("what is running");
    expect(excerpt("a".repeat(40))).toBe("a".repeat(40));
    expect(excerpt("a".repeat(41))).toBe(`${"a".repeat(40)}…`);
    expect(excerpt("queue 38.2 after the docs PR lands, then tell me what it cost")).toBe("queue 38.2 after the docs PR lands, then…");
    // code points, not code units: 41 emoji are cut at 40
    expect(excerpt("😀".repeat(41))).toBe(`${"😀".repeat(40)}…`);
  });
});

describe("the studio chat: the delta assembly", () => {
  it("applyDelta: in order, from 0 after a reconnect, an overlap, a gap ignored", () => {
    let t = "";
    t = applyDelta(t, { from: 0, text: "Two runs " });
    t = applyDelta(t, { from: 9, text: "are live." });
    expect(t).toBe("Two runs are live.");
    expect(applyDelta(t, { from: 0, text: "Two runs are" })).toBe("Two runs are"); // a reconnect starts at 0
    expect(applyDelta(t, { from: 4, text: "runs are live now." })).toBe("Two runs are live now."); // an overlap
    expect(applyDelta(t, { from: 99, text: "x" })).toBe(t); // a gap: ignored
    expect(applyDelta(t, { from: t.length, text: "!" })).toBe(`${t}!`);
  });

  it("withDelta / withoutAnswered: streams by reply_to; the record replaces the stream", () => {
    const lines = [owner(1, "what is running")];
    let s: Streams = {};
    s = withDelta(s, { run_id: "r1", reply_to: 1, from: 0, text: "Two " }, lines);
    s = withDelta(s, { run_id: "r1", reply_to: 1, from: 4, text: "runs" }, lines);
    s = withDelta(s, { run_id: "r1", reply_to: 1, from: 50, text: "gap" }, lines);
    expect(s).toEqual({ 1: { run_id: "r1", text: "Two runs" } });
    const landed = [...lines, reply(2, 1)];
    expect(withoutAnswered(s, landed)).toEqual({});
    // a late delta for an answered line is dropped
    expect(withDelta({}, { run_id: "r1", reply_to: 1, from: 0, text: "late" }, landed)).toEqual({});
    // a gap with nothing streamed yet is ignored too
    expect(withDelta({}, { run_id: "r1", reply_to: 1, from: 3, text: "x" }, lines)).toEqual({});
    expect(CURSOR).toBe("▍");
  });
});

describe("the studio chat: the proposal mapping", () => {
  const queue: StudioProposal = { kind: "queue", label: "Queue run-epic-38", project: "tk-studio", job: "run-epic-38" };
  const answer: StudioProposal = { kind: "answer", label: "Answer DW-87 with A", id: "DW-87", letter: "A", note: "", issue: "TKSTUDIO-240" };

  it("reads each recorded kind back; anything malformed is no button", () => {
    expect(proposalOfStudio(queue)).toEqual(queue);
    expect(proposalOfStudio(answer)).toEqual(answer);
    expect(proposalOfStudio({ kind: "open", label: "Open the board", route: "/app/board/tk-studio" })).toEqual({ kind: "open", label: "Open the board", route: "/app/board/tk-studio" });
    expect(proposalOfStudio({ kind: "engagement", label: "Start", title: "Plan an epic for X" })).toEqual({ kind: "engagement", label: "Start", title: "Plan an epic for X" });
    expect(proposalOfStudio({ kind: "stop-after-story", label: "Stop" })).toEqual({ kind: "stop-after-story", label: "Stop" });
    expect(proposalOfStudio({ kind: "open-studio", label: "Open up" })).toEqual({ kind: "open-studio", label: "Open up" });
    expect(proposalOfStudio({ ...queue, job: "Run Epic" })).toBeNull();
    expect(proposalOfStudio({ kind: "open", label: "x", route: "https://evil.example/app" })).toBeNull();
    expect(proposalOfStudio({ ...answer, letter: "AB" })).toBeNull();
    expect(proposalOfStudio({ kind: "wat", label: "x" })).toBeNull();
    expect(proposalOfStudio({ ...queue, label: "x".repeat(81) })).toBeNull();
  });

  it("every kind to its request", () => {
    expect(proposalAction("tk-studio", 4, 0, queue)).toEqual({ kind: "request", url: "/jobs", body: { project: "tk-studio", job: "run-epic-38", proposal: { chat: "tk-studio", seq: 4, index: 0 } } });
    expect(proposalAction("tk-studio", 4, 1, answer)).toEqual({ kind: "request", url: "/inbox/TKSTUDIO-240/reply", body: { project: "tk-studio", body: "DW-87: A" } });
    expect(proposalAction("tk-studio", 4, 2, { kind: "open", label: "o", route: "/app/run/abc" })).toEqual({ kind: "navigate", route: "/app/run/abc" });
    expect(proposalAction("tk studio", 4, 3, { kind: "engagement", label: "e", title: "Plan X" })).toEqual({ kind: "request", url: "/engagements?project=tk%20studio", body: { project: "tk studio", request: "Plan X" } });
    expect(proposalAction("p", 4, 4, { kind: "stop-after-story", label: "s" })).toEqual({ kind: "disabled", note: NOT_YET_TEXT });
    expect(proposalAction("p", 4, 5, { kind: "open-studio", label: "o" })).toEqual({ kind: "disabled", note: "Not built yet: Story 39.7" });
  });

  it("the answer body: the note on its own line, never on the answer line", () => {
    expect(answerBody("DW-87", "A", "")).toBe("DW-87: A");
    expect(answerBody("DW-87", "A", "   ")).toBe("DW-87: A");
    expect(answerBody("DW-87", "B", "  ship it after the docs PR \n")).toBe("DW-87: B\nship it after the docs PR");
    expect(proposalAction("p", 1, 0, { ...answer, note: "why" })).toMatchObject({ body: { body: "DW-87: A\nwhy" } });
  });

  it("the answer body drops a note line `sweepdecisions.py parse_answers` would read as a decision", () => {
    const note = "ship it\nall: B\n  DW-88: C.\n- default\n[~accountid:abc] dw-9 = d\nDefault!\nDW-88: C because docs";
    expect(answerBody("DW-87", "A", note)).toBe("DW-87: A\nship it\nDW-88: C because docs");
    expect(answerBody("DW-87", "A", "all: B")).toBe("DW-87: A");
    expect(isDecisionLine("allow: B")).toBe(false);
  });

  it("the buttons: both 39.7 kinds disabled with the note, a pressed one disabled, a malformed one dropped", () => {
    const r = reply(4, 3, [queue, { kind: "stop-after-story", label: "Stop" }, { kind: "nope" }, { kind: "open-studio", label: "Open" }, answer]);
    const lines = [owner(3, "q"), r, owner(5, "pressed: Answer DW-87 with A", { pressed: { seq: 4, index: 4, kind: "answer" } })];
    const buttons = studioButtons("p", r, pressedKeys(lines));
    expect(buttons.map((b) => [b.index, b.enabled, b.note])).toEqual([
      [0, true, null],
      [1, false, NOT_YET_TEXT],
      [3, false, NOT_YET_TEXT],
      [4, false, "Pressed"],
    ]);
  });

  it("pressedKeys ignores a press line marked unqueued (its submit failed): the queue button is live again", () => {
    const r = reply(4, 3, [queue]);
    const marked = owner(5, "pressed: Queue", { pressed: { seq: 4, index: 0, kind: "queue" }, unqueued: true });
    expect(pressedKeys([owner(3, "q"), r, marked]).has("4:0")).toBe(false);
    expect(studioButtons("p", r, pressedKeys([owner(3, "q"), r, marked]))[0]!.enabled).toBe(true);
    const again = owner(6, "pressed: Queue", { pressed: { seq: 4, index: 0, kind: "queue" } });
    expect(pressedKeys([owner(3, "q"), r, marked, again]).has("4:0")).toBe(true);
  });
});

describe("the studio chat: the pending label", () => {
  it("position 1 is the turn being answered; position 3 names the previous pending line and its position", () => {
    const lines = [
      owner(1, "what is running"), reply(2, 1),
      owner(3, "what did 38.1 cost"),
      owner(4, "pressed: Queue", { pressed: { seq: 2, index: 0, kind: "queue" } }),
      owner(5, "  queue 38.2 after the docs PR lands, then tell me what it cost "),
      owner(6, "answer DW-87 with A"),
    ];
    expect(pendingTurns(lines).map((l) => l.seq)).toEqual([3, 5, 6]);
    expect(pendingLabel(lines, 3)).toBe(PENDING_TEXT);
    expect(PENDING_TEXT).toBe("Waiting for the planner's reply (about a minute)");
    expect(pendingLabel(lines, 6)).toBe("Waiting for the planner's reply (about a minute) — queued behind the reply to 'queue 38.2 after the docs PR lands, then…' (position 3)");
    expect(pendingLabel(lines, 5)).toBe("Waiting for the planner's reply (about a minute) — queued behind the reply to 'what did 38.1 cost' (position 2)");
    expect(pendingLabel(lines, 1)).toBeNull(); // answered
    expect(pendingLabel(lines, 4)).toBeNull(); // a press queues nothing
  });
});

describe("the studio chat: the reads and the posts", () => {
  it("studioChatUrl and fetchStudioChat", async () => {
    expect(studioChatUrl("p q")).toBe("/chat?project=p%20q");
    expect(studioChatUrl("p", 7)).toBe("/chat?project=p&since=7");
    const { f, calls } = recording(200, { ok: true, project: "p", since: 0, last_seq: 2, lines: [owner(1, "hi"), reply(2, 1), { seq: "x" }] });
    const r = await fetchStudioChat("p", 0, f);
    expect(calls[0]!.url).toBe("/chat?project=p");
    expect(r.ok && r.lines.map((l) => l.seq)).toEqual([1, 2]);
    expect(r.ok && r.last_seq).toBe(2);
  });

  it("postStudioLine: {project, text} with the CSRF header; the answer's behind and note", async () => {
    const { f, calls } = recording(200, { ok: true, project: "p", seq: 3, run_id: "r3", behind: { seq: 1, run_id: "r1" }, note: "Queued behind the reply to 'what is running'" });
    const r = await postStudioLine("p", "what did 38.1 cost", "tok", f);
    expect(calls[0]!.url).toBe("/chat");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ project: "p", text: "what did 38.1 cost" });
    expect((calls[0]!.init!.headers as Record<string, string>)["x-csrf-token"]).toBe("tok");
    expect(r).toEqual({ ok: true, seq: 3, run_id: "r3", behind: { seq: 1, run_id: "r1" }, note: "Queued behind the reply to 'what is running'" });
  });

  it("a LineTooLong refusal is named", async () => {
    const { f } = recording(400, { ok: false, error: "LineTooLong", limit: 4000, length: 4001 });
    const r = await postStudioLine("p", "x".repeat(4001), "tok", f);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.refusal?.name).toBe("LineTooLong");
    expect(!r.ok && r.error).toContain("LineTooLong: the line is over 4,000 characters");
    expect(LINE_MAX_CHARS).toBe(4000);
  });

  it("postPress and postJob bodies", async () => {
    const a = recording(200, { ok: true, project: "p", seq: 9, run_id: null, behind: null, note: null });
    expect(await postPress("p", 4, 1, "tok", a.f)).toEqual({ ok: true, seq: 9, run_id: null, behind: null, note: null });
    expect(JSON.parse(String(a.calls[0]!.init!.body))).toEqual({ project: "p", pressed: { seq: 4, index: 1 } });
    const b = recording(200, { ok: true });
    expect(await postJob("q", "run-epic-38", { chat: "p", seq: 4, index: 0 }, "tok", b.f)).toEqual({ ok: true });
    expect(b.calls[0]!.url).toBe("/jobs");
    expect(JSON.parse(String(b.calls[0]!.init!.body))).toEqual({ project: "q", job: "run-epic-38", proposal: { chat: "p", seq: 4, index: 0 } });
  });

  it("press: the request, then on a 2xx the press line; a refusal posts no press line; never throws", async () => {
    const ok = recording(200, { ok: true, project: "p", seq: 9, run_id: null, behind: null, note: null });
    const act = proposalAction("p", 4, 0, { kind: "queue", label: "Q", project: "p", job: "run-epic-38" });
    // a `queue` press posts no press line: the supervisor's POST /jobs gate records it with the submit
    expect(await press("p", 4, 0, act, "tok", ok.f)).toEqual({ ok: true, seq: null, run_id: null, behind: null, note: null, sent: true });
    expect(ok.calls.map((c) => c.url)).toEqual(["/jobs"]);
    const ans = recording(200, { ok: true, project: "p", seq: 9, run_id: null, behind: null, note: null });
    const answerAct = proposalAction("p", 4, 1, { kind: "answer", label: "A", id: "DW-87", letter: "A", note: "", issue: "TKS-1" });
    expect((await press("p", 4, 1, answerAct, "tok", ans.f)).ok).toBe(true);
    expect(ans.calls.map((c) => c.url)).toEqual(["/inbox/TKS-1/reply", "/chat"]);
    const nav = recording(200, { ok: true, project: "p", seq: 9, run_id: null, behind: null, note: null });
    await press("p", 4, 2, { kind: "navigate", route: "/app/office" }, "tok", nav.f);
    expect(nav.calls.map((c) => c.url)).toEqual(["/chat"]);
    const refused = recording(403, { ok: false, error: "ProposalRefused" });
    const r = await press("p", 4, 0, act, "tok", refused.f);
    expect(!r.ok && r.refusal?.name).toBe("ProposalRefused");
    expect(refused.calls).toHaveLength(1);
    expect((await press("p", 4, 0, act, "tok", failing)).ok).toBe(false);
    expect((await press("p", 4, 1, { kind: "disabled", note: NOT_YET_TEXT }, "tok", failing)).ok).toBe(false);
  });

  it("press: `sent` marks a request answered 2xx, so a failed press line after it keeps the button from repeating the request", async () => {
    const act = proposalAction("p", 4, 0, { kind: "engagement", label: "E", title: "Plan X" });
    const ok = recording(200, { ok: true, project: "p", seq: 9, run_id: null, behind: null, note: null });
    expect(await press("p", 4, 0, act, "tok", ok.f)).toMatchObject({ ok: true, sent: true });
    // the engagement's 2xx, then the press line refused: a failure that says the request went out
    const calls: string[] = [];
    const lineFails: Parameters<typeof press>[5] = async (url) => {
      calls.push(url);
      return url !== "/chat"
        ? { ok: true, status: 200, json: async () => ({ ok: true, engagement: "ENG-001" }), headers: { get: () => null } }
        : { ok: false, status: 503, json: async () => ({ ok: false, error: "ChatBusy" }), headers: { get: () => null } };
    };
    const r = await press("p", 4, 0, act, "tok", lineFails);
    expect(calls).toEqual(["/engagements?project=p", "/chat"]);
    // a `queue` press never meets that case: its only request is the gate, which recorded the line or refused
    const queueAct = proposalAction("p", 4, 0, { kind: "queue", label: "Q", project: "p", job: "run-epic-38" });
    calls.length = 0;
    expect(await press("p", 4, 0, queueAct, "tok", lineFails)).toMatchObject({ ok: true, sent: true });
    expect(calls).toEqual(["/jobs"]);
    expect(r.ok).toBe(false);
    expect(r.sent).toBe(true);
    expect(!r.ok && sentUnrecordedText(r.error)).toContain("The request was sent, but its press line was not recorded: ");
    // the screen adds `<seq>:<index>` to the pressed set: the button is disabled ("Pressed")
    const [button] = studioButtons("p", reply(4, 3, [{ kind: "queue", label: "Q", project: "p", job: "run-epic-38" }]), new Set(["4:0"]));
    expect(button).toMatchObject({ enabled: false, note: "Pressed" });
    // a refused request, a disabled kind and `open` (no request) are not sent: the button stays pressable
    expect((await press("p", 4, 0, act, "tok", recording(403, { ok: false, error: "ProposalRefused" }).f)).sent).toBe(false);
    expect((await press("p", 4, 0, act, "tok", failing)).sent).toBe(false);
    expect((await press("p", 4, 1, { kind: "disabled", note: NOT_YET_TEXT }, "tok", failing)).sent).toBe(false);
    expect((await press("p", 4, 2, { kind: "navigate", route: "/app/office" }, "tok", failing)).sent).toBe(false);
  });
});

describe("the studio chat: the sent presses, per project, in sessionStorage", () => {
  it("remembered per project; absent, malformed or a throwing storage is empty", () => {
    const mem = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
    expect([...rememberedSent("p", storage)]).toEqual([]);
    rememberSent("p", new Set(["4:1", "6:0"]), storage);
    expect([...rememberedSent("p", storage)]).toEqual(["4:1", "6:0"]);
    expect([...rememberedSent("q", storage)]).toEqual([]);
    mem.set("tk-studio.web.studio-chat.sent.q", "{nope");
    expect([...rememberedSent("q", storage)]).toEqual([]);
    mem.set("tk-studio.web.studio-chat.sent.q", JSON.stringify(["1:0", 7, "x"]));
    expect([...rememberedSent("q", storage)]).toEqual(["1:0"]);
    const throwing: StorageLike = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect([...rememberedSent("p", throwing)]).toEqual([]);
    expect(() => rememberSent("p", ["4:1"], throwing)).not.toThrow();
    expect([...rememberedSent("p", null)]).toEqual([]);
  });
});
