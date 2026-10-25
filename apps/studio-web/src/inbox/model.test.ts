// Story 31.6: the Inbox screen's rules from the fixture without a browser: only the open items, in the order served,
// per project in the order given, each with project, key, title, priority, waited and the reason's first line; the
// nav count; the fetch (never throws, names the supervisor's error, reads the CSRF header) and the refetch key.
import { describe, expect, it } from "vitest";
import { createOfficeStore } from "../live/store";
import { NONE } from "../office/model";
import { inboxAnswer, NOW } from "./fixture";
import { EMPTY_TEXT, fetchInbox, fetchInboxRows, firstLine, inboxNotice, inboxRefetchKey, inboxRows, LOADING_TEXT, inboxUrl, navCount, reasonLine, waitedText, type FetchLike } from "./model";

const answering = (status: number, body: unknown, headers: Record<string, string> = {}): FetchLike & { urls: string[] } => {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } };
  }) as FetchLike & { urls: string[] };
  f.urls = urls;
  return f;
};

describe("the inbox rows (Story 31.6)", () => {
  it("only the open items, in the order served, with project, key, title, priority, waited and the reason's first line", () => {
    const rows = inboxRows([inboxAnswer()], NOW);
    expect(rows).toEqual([
      { project: "p", key: "TKS-3", title: "Gamma", priority: "Highest", waited: "5m", reason: "Blocked: which spec wins?" },
      { project: "p", key: "TKS-5", title: NONE, priority: NONE, waited: "2d", reason: "the token expired" },
      { project: "p", key: "TKS-7", title: NONE, priority: "Medium", waited: "3h", reason: NONE },
    ]);
    expect(navCount(rows)).toBe(rows.length);
  });

  it("projects concatenate in the order given; an empty inbox shows no count", () => {
    const q = { project: "q", items: [{ ...inboxAnswer().items[0]!, issue: "Q-1" }] };
    expect(inboxRows([q, inboxAnswer()], NOW).map((r) => `${r.project}/${r.key}`)).toEqual(["q/Q-1", "p/TKS-3", "p/TKS-5", "p/TKS-7"]);
    expect(navCount(inboxRows([{ project: "p", items: [] }], NOW))).toBeNull();
    expect(navCount([])).toBeNull();
  });

  it("waited is m / h / d; unknown is —; the first line skips blanks", () => {
    expect(waitedText("2026-10-24T11:59:30Z", NOW)).toBe("0m");
    expect(waitedText("2026-10-24T09:00:00.000+0000", NOW)).toBe("3h");
    expect(waitedText("2026-10-21T12:00:00Z", NOW)).toBe("3d");
    expect(waitedText("2026-10-25T12:00:00Z", NOW)).toBe("0m");
    expect(waitedText(null, NOW)).toBe(NONE);
    expect(waitedText("not a time", NOW)).toBe(NONE);
    expect(firstLine("\n\n  a  \nb")).toBe("a");
    expect(firstLine(null)).toBe(NONE);
  });

  it("the reason drops Jira mentions; plain text reads as the first line; a mention-only body is —", () => {
    expect(reasonLine("[~accountid:acc-owner] Blocked: which spec wins?\nResolves when: a ruling")).toBe("Blocked: which spec wins?");
    expect(reasonLine("ask [~accountid:712020:abc-def] and [~jdoe] now")).toBe("ask and now");
    expect(reasonLine("[~accountid:acc-owner]\nBlocked: x")).toBe("Blocked: x");
    expect(reasonLine("  [~accountid:acc-owner]  ")).toBe(NONE);
    expect(reasonLine("\n  the token expired  \nmore")).toBe(firstLine("\n  the token expired  \nmore"));
    expect(reasonLine("a [link] and [~ not a mention]")).toBe("a [link] and [~ not a mention]");
    expect(reasonLine(null)).toBe(NONE);
  });
});

describe("the inbox fetch (Story 31.6)", () => {
  it("GET /inbox?project=<id> with the cookie; the CSRF header read; never throws", async () => {
    const f = answering(200, inboxAnswer(), { "x-csrf-token": "c-1" });
    const r = await fetchInbox("p q", f);
    expect(f.urls).toEqual([inboxUrl("p q")]);
    expect(inboxUrl("p q")).toBe("/inbox?project=p%20q");
    expect(r.ok && r.csrf).toBe("c-1");
    expect(r.ok && r.inbox.items).toHaveLength(5);
    expect(await fetchInbox("p", answering(404, { ok: false, error: "UnknownProject" }))).toEqual({ ok: false, error: "/inbox?project=p answered 404 UnknownProject" });
    expect((await fetchInbox("p", answering(200, { ok: true }))).ok).toBe(false);
    const down: FetchLike = async () => { throw new Error("offline"); };
    expect(await fetchInbox("p", down)).toEqual({ ok: false, error: "/inbox?project=p: offline" });
  });

  it("fetchInboxRows: every project's open rows, a failed project named and rowless", async () => {
    const f: FetchLike = async (url) => url.includes("bad")
      ? { ok: false, status: 404, json: async () => ({ ok: false, error: "UnknownProject" }) }
      : { ok: true, status: 200, json: async () => inboxAnswer() };
    const out = await fetchInboxRows(["p", "bad"], NOW, f);
    expect(out.rows.map((r) => r.key)).toEqual(["TKS-3", "TKS-5", "TKS-7"]);
    expect(out.errors).toEqual(["/inbox?project=bad answered 404 UnknownProject"]);
  });

  it("the refetch key moves with a project's runs and an agent's blocked_issue, not with another project", () => {
    const store = createOfficeStore();
    const before = inboxRefetchKey(store.getState(), ["p"]);
    store.applySnapshot("b-1", { at: "t", agents: [{ agent_id: "p/session", project: "p", role: "session", state: "idle", current_run: null, current_story: null, reason: null, blocked_issue: null }], runs: [], problems: [], last_run: {} });
    const empty = inboxRefetchKey(store.getState(), ["p"]);
    expect(empty).not.toBe(before);
    store.applySnapshot("b-2", { at: "t", agents: [{ agent_id: "p/session", project: "p", role: "session", state: "idle", current_run: null, current_story: null, reason: null, blocked_issue: { issue: "TKS-3", state: "open" } }], runs: [], problems: [], last_run: {} });
    expect(inboxRefetchKey(store.getState(), ["p"])).not.toBe(empty);
  });
});

describe("the inbox notice (Story 31.6)", () => {
  it("Loading… until the first load finished, then Nothing needs you. for an empty inbox, else none", () => {
    const row = inboxRows([inboxAnswer()], NOW)[0]!;
    expect([LOADING_TEXT, EMPTY_TEXT]).toEqual(["Loading…", "Nothing needs you."]);
    expect(inboxNotice(false, [], [])).toBe("Loading…");
    expect(inboxNotice(false, [row], ["e"])).toBe("Loading…");
    expect(inboxNotice(true, [], [])).toBe("Nothing needs you.");
    expect(inboxNotice(true, [row], [])).toBeNull();
    expect(inboxNotice(true, [], ["/agents answered 500"])).toBeNull();
  });
});
