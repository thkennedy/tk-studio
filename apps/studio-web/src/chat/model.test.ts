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
