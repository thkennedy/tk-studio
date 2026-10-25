// Story 31.6: the Issue screen's rules from the fixture without a browser: the view (status, run state and PR link,
// cost or "not metered", the comments in order with author and time), the remembered issue, the read, and the two
// actions — a reply and Done — through `postReply` (the CSRF header, the body, never throws, the supervisor's error).
import { describe, expect, it } from "vitest";
import { issueAnswer, PR } from "../inbox/fixture";
import type { FetchLike } from "../inbox/model";
import { NONE, type StorageLike } from "../office/model";
import {
  canAct, canSend, canSendReply, CHOOSE_TEXT, commentAuthor, costText, fetchIssue, ISSUE_KEY, issueUrl, issueView, NOT_METERED, postReply, rememberedIssue, rememberIssue,
  replyUrl, SENT_NOTICE, sentAfter,
} from "./model";

const memory = (init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};
const throwing: StorageLike = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };

interface Call { url: string; init?: RequestInit }
const recording = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (n) => headers[n.toLowerCase()] ?? null } };
  };
  return { f, calls };
};

describe("the issue view (Story 31.6)", () => {
  it("status, run state and PR link, cost, and the comments in order with author and time", () => {
    expect(issueView(issueAnswer())).toEqual({
      key: "TKS-3", title: "Gamma", status: "Blocked - Awaiting User",
      run: { run_id: "q-1", state: "paused", href: PR },
      cost: "$1.50",
      comments: [
        { id: "10001", author: "agent", time: "2026-10-24T11:55:00.000+0000", body: "[~accountid:acc-owner] Blocked: which spec wins?\nResolves when: a ruling", edited: false },
        { id: "10003", author: "owner", time: "2026-10-24T11:58:00.000+0000", body: "Looking now", edited: true },
      ],
    });
  });

  it("a comment is the owner's only when author and update_author both are; an absent update_author keeps author", () => {
    expect(commentAuthor({ author: "owner", update_author: "owner" })).toBe("owner");
    expect(commentAuthor({ author: "owner", update_author: "agent" })).toBe("agent");
    expect(commentAuthor({ author: "owner" })).toBe("owner");
    expect(commentAuthor({ author: "owner", update_author: null })).toBe("owner");
    expect(commentAuthor({ author: "agent", update_author: "owner" })).toBe("agent");
    expect(commentAuthor({ author: null })).toBe("agent");
    const a = issueAnswer();
    a.issue.comments = [
      { id: "1", author: "owner", update_author: "owner", body: "a", created: null, updated: null },
      { id: "2", author: "owner", update_author: "agent", body: "b", created: null, updated: null },
      { id: "3", author: "owner", body: "c", created: null, updated: null },
    ];
    expect(issueView(a).comments.map((c) => c.author)).toEqual(["owner", "agent", "owner"]);
  });

  it("no run, a non-http PR, no cost, no title or status", () => {
    const a = issueAnswer();
    a.issue = { ...a.issue, title: null, status: null, run: { ...a.issue.run!, pr: "javascript:alert(1)" }, cost_usd: null };
    const v = issueView(a);
    expect([v.title, v.status, v.run?.href, v.cost]).toEqual([NONE, NONE, null, NOT_METERED]);
    a.issue.run = null;
    expect(issueView(a).run).toBeNull();
    expect(costText(0)).toBe("$0.00");
    expect(costText(undefined)).toBe(NOT_METERED);
  });

  it("the remembered issue: tk-studio.web.issue; absent, malformed or throwing is none", () => {
    expect(ISSUE_KEY).toBe("tk-studio.web.issue");
    const s = memory();
    expect(rememberedIssue(s)).toBeNull();
    rememberIssue({ project: "p", key: "TKS-3" }, s);
    expect(rememberedIssue(s)).toEqual({ project: "p", key: "TKS-3" });
    expect(rememberedIssue(memory({ [ISSUE_KEY]: "{nope" }))).toBeNull();
    expect(rememberedIssue(memory({ [ISSUE_KEY]: JSON.stringify({ project: "p" }) }))).toBeNull();
    expect(rememberedIssue(throwing)).toBeNull();
    expect(() => rememberIssue({ project: "p", key: "K-1" }, throwing)).not.toThrow();
    expect(CHOOSE_TEXT).toBe("Choose an item in the Inbox");
  });

  it("the read: GET /inbox?project&issue with the cookie, the CSRF header kept; never throws", async () => {
    const ok = recording(200, issueAnswer(), { "x-csrf-token": "c-1" });
    const r = await fetchIssue("p", "TKS-3", ok.f);
    expect(ok.calls[0]!.url).toBe(issueUrl("p", "TKS-3"));
    expect(issueUrl("p", "TKS-3")).toBe("/inbox?project=p&issue=TKS-3");
    expect(ok.calls[0]!.init?.credentials).toBe("same-origin");
    expect(r.ok && r.csrf).toBe("c-1");
    expect(await fetchIssue("p", "TKS-9", recording(404, { ok: false, error: "UnknownIssue" }).f))
      .toEqual({ ok: false, error: "/inbox?project=p&issue=TKS-9 answered 404 UnknownIssue" });
    expect((await fetchIssue("p", "TKS-3", recording(200, { ok: true, items: [] }).f)).ok).toBe(false);
  });
});

describe("the two actions (Story 31.6)", () => {
  it("a reply POSTs /inbox/{key}/reply with the CSRF header and {project, body}", async () => {
    const { f, calls } = recording(200, { ok: true, project: "p", issue: "TKS-3", commented: true, transitioned: true, status: "complete" });
    const r = await postReply("p", "TKS-3", { body: "Use the second option." }, "c-1", f);
    expect(r).toEqual({ ok: true, notice: SENT_NOTICE, commented: true, transitioned: true });
    expect(SENT_NOTICE).toBe("sent; it leaves the Inbox on the next sync-back");
    const [call] = calls;
    expect(call!.url).toBe(replyUrl("TKS-3"));
    expect(call!.url).toBe("/inbox/TKS-3/reply");
    expect(call!.init?.method).toBe("POST");
    expect(call!.init?.credentials).toBe("same-origin");
    expect((call!.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("c-1");
    expect(JSON.parse(String(call!.init?.body))).toEqual({ project: "p", body: "Use the second option." });
  });

  it("Done POSTs {project, done: true}", async () => {
    const { f, calls } = recording(200, { ok: true, commented: true, transitioned: false, status: "complete" });
    const r = await postReply("p", "TKS-3", { done: true }, "c-1", f);
    expect(r).toEqual({ ok: true, notice: SENT_NOTICE, commented: true, transitioned: false });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ project: "p", done: true });
  });

  it("never throws, and names the supervisor's error", async () => {
    expect(await postReply("p", "TKS-3", { done: true }, null, recording(409, { ok: false, error: "OwnerSeatMissing", missing: ["X"] }).f))
      .toEqual({ ok: false, error: "/inbox/TKS-3/reply answered 409 OwnerSeatMissing", commented: false });
    expect(await postReply("p", "TKS-3", { done: true }, "c", recording(403, { ok: false, error: "CsrfRefused" }).f))
      .toEqual({ ok: false, error: "/inbox/TKS-3/reply answered 403 CsrfRefused", commented: false });
    expect(await postReply("p", "TKS-3", { done: true }, "c", recording(500, "not json").f))
      .toEqual({ ok: false, error: "/inbox/TKS-3/reply answered 500", commented: false });
    const down: FetchLike = async () => { throw new Error("offline"); };
    expect(await postReply("p", "TKS-3", { body: "x" }, "c", down)).toEqual({ ok: false, error: "/inbox/TKS-3/reply: offline", commented: false });
    // no CSRF token known: the header is absent (the supervisor refuses a cookie session by name)
    const { f, calls } = recording(200, { ok: true });
    await postReply("p", "TKS-3", { body: "x" }, null, f);
    expect((calls[0]!.init?.headers as Record<string, string>)["x-csrf-token"]).toBeUndefined();
  });

  it("a refusal or retry carries the answer's commented (true only when it says so)", async () => {
    expect(await postReply("p", "TKS-3", { body: "x" }, "c", recording(409, { ok: false, error: "ReplyRefused", reason: "seat", commented: true }).f))
      .toEqual({ ok: false, error: "/inbox/TKS-3/reply answered 409 ReplyRefused", commented: true });
    expect(await postReply("p", "TKS-3", { body: "x" }, "c", recording(409, { ok: false, error: "ReplyRefused", reason: "r", commented: false }).f))
      .toEqual({ ok: false, error: "/inbox/TKS-3/reply answered 409 ReplyRefused", commented: false });
    expect(await postReply("p", "TKS-3", { body: "x" }, "c", recording(409, { ok: false, error: "ReplyRefused", reason: "r" }).f))
      .toMatchObject({ ok: false, commented: false });
    expect(await postReply("p", "TKS-3", { done: true }, "c", recording(503, { ok: false, error: "ReplyRetry", reason: "r", commented: true }).f))
      .toEqual({ ok: false, error: "/inbox/TKS-3/reply answered 503 ReplyRetry", commented: true });
    expect(await postReply("p", "TKS-3", { done: true }, "c", recording(503, { ok: false, error: "ReplyRetry", reason: "r", commented: "yes" }).f))
      .toMatchObject({ ok: false, commented: false });
  });

  it("a failure whose comment landed counts as sent: the actions stay disabled (its error still returned)", async () => {
    const landed = await postReply("p", "TKS-3", { body: "x" }, "c", recording(409, { ok: false, error: "ReplyRefused", commented: true }).f);
    const notLanded = await postReply("p", "TKS-3", { body: "x" }, "c", recording(409, { ok: false, error: "ReplyRefused", commented: false }).f);
    const ok = await postReply("p", "TKS-3", { body: "x" }, "c", recording(200, { ok: true, commented: true, transitioned: true }).f);
    expect([sentAfter(landed), sentAfter(notLanded), sentAfter(ok)]).toEqual([true, false, true]);
    const ready = { loaded: true, csrf: "c-1", sending: false };
    expect(canAct({ ...ready, sent: sentAfter(landed) })).toBe(false);
    expect(canSendReply("again", { ...ready, sent: sentAfter(landed) })).toBe(false);
    expect(canAct({ ...ready, sent: sentAfter(notLanded) })).toBe(true);
  });

  it("Send is enabled only with a non-blank reply", () => {
    expect(canSend("")).toBe(false);
    expect(canSend("  \n")).toBe(false);
    expect(canSend("ok")).toBe(true);
  });

  it("Send and Done wait for the loaded view and the CSRF token, and stay off while sending and once sent", () => {
    const ready = { loaded: true, csrf: "c-1", sending: false, sent: false };
    expect(canAct(ready)).toBe(true);
    expect(canSendReply("ok", ready)).toBe(true);
    expect(canSendReply("  ", ready)).toBe(false);
    for (const g of [{ ...ready, loaded: false }, { ...ready, csrf: null }, { ...ready, sending: true }, { ...ready, sent: true }]) {
      expect(canAct(g)).toBe(false);
      expect(canSendReply("ok", g)).toBe(false);
    }
  });
});
