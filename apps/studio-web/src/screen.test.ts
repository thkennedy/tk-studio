// Story 39.1: the addresses — the route table and the landing redirect, the round trip, the not-found rows, the
// placeholders, the nav, the router over a fake history (push, replace, popstate back and forward, the same-path no-op,
// the initial redirect), the one-time migration of the two remembered keys, and the two resolvers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as issueModel from "./issue/model";
import { ISSUE_KEY } from "./issue/model";
import type { StorageLike } from "./office/model";
import * as screen from "./screen";
import {
  addressProject, chatOpenState, chatProjectCheck, createRouter, engagementRefFor, HOME_PATH, isLanding, issueRefFor, LOADING_INBOX, migrateRemembered, NAV, navActive, notFoundText, notInInbox, parseRoute, PLACEHOLDER,
  routePath, SCREEN_KEY, type HistoryLike, type Route,
} from "./screen";

const memory = (init: Record<string, string> = {}) => {
  const data: Record<string, string> = { ...init };
  const s: StorageLike & { removeItem(k: string): void; data: Record<string, string> } = {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
  return s;
};
const throwing: StorageLike & { removeItem(k: string): void } = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

/** A fake window: a history stack with an index, `popstate` fired by `back` / `forward`. */
const fakeWindow = (start: string) => {
  const split = (url: string) => {
    const i = url.indexOf("?");
    return i < 0 ? { pathname: url, search: "" } : { pathname: url.slice(0, i), search: url.slice(i) };
  };
  const stack = [start];
  let at = 0;
  const pops = new Set<() => void>();
  const calls: string[] = [];
  const win: HistoryLike & { back(): void; forward(): void; calls: string[]; stack: string[]; listeners: () => number } = {
    location: split(start),
    history: {
      pushState: (_d, _u, url) => {
        calls.push(`push ${url}`);
        stack.splice(at + 1, stack.length, url);
        at += 1;
        win.location = split(url);
      },
      replaceState: (_d, _u, url) => {
        calls.push(`replace ${url}`);
        stack[at] = url;
        win.location = split(url);
      },
    },
    addEventListener: (_t, fn) => void pops.add(fn),
    removeEventListener: (_t, fn) => void pops.delete(fn),
    back() {
      at -= 1;
      win.location = split(stack[at]!);
      for (const fn of pops) fn();
    },
    forward() {
      at += 1;
      win.location = split(stack[at]!);
      for (const fn of pops) fn();
    },
    calls,
    stack,
    listeners: () => pops.size,
  };
  return win;
};

describe("the route table (Story 39.1)", () => {
  it("the landing: /app, /app/, /, /index.html redirect (replace) to /app/office", () => {
    expect(HOME_PATH).toBe("/app/office");
    for (const p of ["/app", "/app/", "/", "/index.html", "/elsewhere/x"]) {
      expect(parseRoute(p, "")).toEqual({ route: { name: "office", project: null }, redirect: "/app/office" });
    }
  });

  it("every path of the table resolves to its route", () => {
    const rows: [string, string, Route][] = [
      ["/app/office", "", { name: "office", project: null }],
      ["/app/office/", "", { name: "office", project: null }],
      ["/app/office/tk-studio", "", { name: "office", project: "tk-studio" }],
      ["/app/board", "", { name: "board", project: null }],
      ["/app/board/tk-studio", "", { name: "board", project: "tk-studio" }],
      ["/app/story/ST-174", "", { name: "story", id: "ST-174" }],
      ["/app/run/q-run-1", "", { name: "run", id: "q-run-1" }],
      ["/app/inbox", "", { name: "inbox" }],
      ["/app/inbox/TKS-3", "", { name: "issue", key: "TKS-3", project: null }],
      ["/app/inbox/TKS-3", "?project=p", { name: "issue", key: "TKS-3", project: "p" }],
      ["/app/chat", "", { name: "chat" }],
      ["/app/chat/ENG-001", "", { name: "engagement", id: "ENG-001", project: null }],
      ["/app/chat/ENG-001", "?project=p", { name: "engagement", id: "ENG-001", project: "p" }],
      ["/app/checkin/ENG-001/2", "?project=p", { name: "checkin", id: "ENG-001", n: "2", project: "p" }],
      ["/app/status", "", { name: "status" }],
      ["/app/settings", "", { name: "settings" }],
      ["/app/office/a%20b", "", { name: "office", project: "a b" }],
    ];
    for (const [path, search, route] of rows) expect(parseRoute(path, search)).toEqual({ route });
  });

  it("the round trip: routePath(parseRoute(x)) is x for every canonical path", () => {
    for (const p of [
      "/app/office", "/app/office/p", "/app/board", "/app/board/p", "/app/story/ST-1", "/app/run/q-1", "/app/inbox", "/app/inbox/TKS-3?project=p",
      "/app/inbox/TKS-3", "/app/chat", "/app/chat/ENG-001?project=p", "/app/checkin/ENG-001/12?project=p", "/app/status", "/app/settings", "/app/office/a%20b",
    ]) {
      const [path, q] = p.split("?");
      expect(routePath(parseRoute(path!, q ? `?${q}` : "").route)).toBe(p);
    }
  });

  it("anything else under /app is not found, a bad escape included", () => {
    for (const p of ["/app/nope", "/app/office/a/b", "/app/story", "/app/run", "/app/checkin/ENG-001/0", "/app/checkin/ENG-001/x", "/app/checkin/ENG-001", "/app/settings/x", "/app/office/%E0%A4%A", "/app//office"]) {
      expect(parseRoute(p, "")).toEqual({ route: { name: "notFound", path: p } });
    }
    expect(notFoundText("/app/nope")).toBe("No page at /app/nope");
    expect(routePath({ name: "notFound", path: "/app/nope" })).toBe("/app/nope");
  });

  it("a blank ?project= is none", () => {
    expect(parseRoute("/app/inbox/K-1", "?project=")).toEqual({ route: { name: "issue", key: "K-1", project: null } });
  });

  // Story 39.2: the Settings screen is built (the Sandbox login card); its placeholder now names 39.8's part.
  it("the placeholders name the story that builds each screen", () => {
    expect(PLACEHOLDER).toEqual({
      story: "Not built yet: Story 39.4",
      run: "Not built yet: Story 39.5",
      chat: "Not built yet: Story 39.3",
      checkin: "Not built yet: Story 39.7",
      settings: "Not built yet: Story 39.8",
    });
  });

  it("the nav: Office, Board, Status, Inbox (count), Chat (count), Settings; no Issue", () => {
    expect(NAV.map((n) => [n.label, n.path, n.count ?? null])).toEqual([
      ["Office", "/app/office", null],
      ["Board", "/app/board", null],
      ["Status", "/app/status", null],
      ["Inbox", "/app/inbox", "inbox"],
      ["Chat", "/app/chat", "chat"],
      ["Settings", "/app/settings", null],
    ]);
  });

  it("navActive: the office and the board with any project; the Inbox and Chat items stay enabled on an issue, an engagement", () => {
    const item = (label: string) => NAV.find((n) => n.label === label)!;
    expect(navActive({ name: "office", project: null }, item("Office"))).toBe(true);
    expect(navActive({ name: "office", project: "p" }, item("Office"))).toBe(true);
    expect(navActive({ name: "office", project: "p" }, item("Board"))).toBe(false);
    expect(navActive({ name: "board", project: "p" }, item("Board"))).toBe(true);
    expect(navActive({ name: "board", project: null }, item("Board"))).toBe(true);
    expect(navActive({ name: "status" }, item("Status"))).toBe(true);
    expect(navActive({ name: "settings" }, item("Settings"))).toBe(true);
    expect(navActive({ name: "inbox" }, item("Inbox"))).toBe(true);
    expect(navActive({ name: "issue", key: "TKS-3", project: null }, item("Inbox"))).toBe(false);
    expect(navActive({ name: "chat" }, item("Chat"))).toBe(true);
    expect(navActive({ name: "engagement", id: "ENG-001", project: "p" }, item("Chat"))).toBe(false);
    expect(navActive({ name: "story", id: "39-1" }, item("Board"))).toBe(false);
    expect(navActive({ name: "notFound", path: "/app/x" }, item("Office"))).toBe(false);
  });

  it("the landing is the office with no project", () => {
    expect(isLanding({ name: "office", project: null })).toBe(true);
    expect(isLanding({ name: "office", project: "p" })).toBe(false);
    expect(isLanding({ name: "inbox" })).toBe(false);
  });
});

describe("the router over a fake history (Story 39.1)", () => {
  it("the initial redirect: / is replaced by /app/office", () => {
    const w = fakeWindow("/");
    const r = createRouter(w);
    expect(w.calls).toEqual(["replace /app/office"]);
    expect(r.current()).toEqual({ route: { name: "office", project: null }, path: "/app/office" });
  });

  it("navigate pushes, replace replaces, the same path is a no-op, back and forward switch screens", () => {
    const w = fakeWindow("/app/office");
    const r = createRouter(w);
    let n = 0;
    const off = r.subscribe(() => (n += 1));
    const first = r.current();
    expect(r.current()).toBe(first); // a cached snapshot

    r.navigate("/app/office");
    expect(w.calls).toEqual([]);
    expect(n).toBe(0);

    r.navigate("/app/office/p", { replace: true });
    expect(w.calls).toEqual(["replace /app/office/p"]);
    expect(r.current().route).toEqual({ name: "office", project: "p" });

    r.navigate("/app/inbox/TKS-3?project=p");
    expect(w.calls.at(-1)).toBe("push /app/inbox/TKS-3?project=p");
    expect(r.current()).toEqual({ route: { name: "issue", key: "TKS-3", project: "p" }, path: "/app/inbox/TKS-3?project=p" });
    expect(n).toBe(2);

    w.back();
    expect(r.current().route).toEqual({ name: "office", project: "p" });
    expect(n).toBe(3);
    w.forward();
    expect(r.current().route).toEqual({ name: "issue", key: "TKS-3", project: "p" });
    expect(n).toBe(4);

    r.navigate("/app");
    expect(w.calls.slice(-2)).toEqual(["push /app", "replace /app/office"]);
    expect(r.current().path).toBe("/app/office");

    off();
    r.navigate("/app/status");
    expect(n).toBe(5);
    r.dispose();
    expect(w.listeners()).toBe(0);
  });
});

describe("the migration of the remembered keys (Story 39.1)", () => {
  it("each remembered screen carries its route; both keys are removed", () => {
    const rows: [string | undefined, string | null][] = [
      ["office", "/app/office"], ["board", "/app/board"], ["status", "/app/status"], ["inbox", "/app/inbox"], ["chat", "/app/chat"],
      ["issue", "/app/inbox"], ["bogus", null], [undefined, null],
    ];
    for (const [stored, route] of rows) {
      const s = memory(stored === undefined ? {} : { [SCREEN_KEY]: stored });
      expect(migrateRemembered(s)).toBe(route);
      expect(s.data).toEqual({});
    }
  });

  it("issue with a valid ref → /app/inbox/<KEY>?project=<p>", () => {
    const s = memory({ [SCREEN_KEY]: "issue", [ISSUE_KEY]: JSON.stringify({ project: "p", key: "TKS-3" }) });
    expect(migrateRemembered(s)).toBe("/app/inbox/TKS-3?project=p");
    expect(s.data).toEqual({});
    expect(migrateRemembered(s)).toBeNull(); // once
  });

  it("a throwing storage, a storage with no removeItem, and none are nothing carried", () => {
    expect(migrateRemembered(throwing)).toBeNull();
    const plain: StorageLike = { getItem: () => "status", setItem: () => undefined };
    expect(migrateRemembered(plain)).toBe("/app/status");
    expect(migrateRemembered(null)).toBeNull();
  });

  it("no writer of either key is exported", () => {
    expect("rememberScreen" in screen).toBe(false);
    expect("rememberedScreen" in screen).toBe(false);
    expect(SCREEN_KEY).toBe("tk-studio.web.screen");
    // the issue key's old writer (`rememberIssue`, issue/model.ts) is gone, and no source line writes the key
    expect("rememberIssue" in issueModel).toBe(false);
    expect(ISSUE_KEY).toBe("tk-studio.web.issue");
    for (const file of ["./issue/model.ts", "./issue/IssueScreen.tsx", "./screen.ts", "./App.tsx"]) {
      const src = readFileSync(new URL(file, import.meta.url), { encoding: "utf-8" });
      expect(src).not.toMatch(/setItem\(\s*ISSUE_KEY/);
      expect(src).not.toContain('setItem("tk-studio.web.issue"');
    }
  });
});

describe("the project of a project-less address (Story 39.1)", () => {
  const rows = [{ project: "p", key: "TKS-3" }, { project: "q", key: "OTH-1" }];
  it("issueRefFor: ?project= wins, else the inbox row, else loading or not in the inbox", () => {
    expect(issueRefFor({ key: "TKS-3", project: "z" }, rows, false)).toEqual({ ref: { project: "z", key: "TKS-3" } });
    expect(issueRefFor({ key: "OTH-1", project: null }, rows, true)).toEqual({ ref: { project: "q", key: "OTH-1" } });
    expect(issueRefFor({ key: "NO-1", project: null }, rows, false)).toEqual({ text: LOADING_INBOX });
    expect(issueRefFor({ key: "NO-1", project: null }, rows, true)).toEqual({ text: notInInbox("NO-1") });
    expect(LOADING_INBOX).toBe("Loading the inbox…");
    expect(notInInbox("NO-1")).toBe("Not in the inbox: NO-1");
  });

  it("issueRefFor: with no row a failed inbox read shows its errors, not 'Not in the inbox'", () => {
    expect(issueRefFor({ key: "NO-1", project: null }, rows, true, ["p: HTTP 500", "q: timeout"])).toEqual({ text: "error p: HTTP 500\nerror q: timeout" });
    expect(issueRefFor({ key: "NO-1", project: null }, rows, false, ["p: HTTP 500"])).toEqual({ text: LOADING_INBOX });
    expect(issueRefFor({ key: "TKS-3", project: null }, rows, true, ["q: timeout"])).toEqual({ ref: { project: "p", key: "TKS-3" } });
    expect(issueRefFor({ key: "NO-1", project: null }, rows, true, [])).toEqual({ text: notInInbox("NO-1") });
  });

  it("issueRefFor: the project kept for the key holds once its row leaves the inbox", () => {
    expect(issueRefFor({ key: "NO-1", project: null }, rows, true, [], "p")).toEqual({ ref: { project: "p", key: "NO-1" } });
    expect(issueRefFor({ key: "NO-1", project: null }, rows, true, ["p: HTTP 500"], "p")).toEqual({ ref: { project: "p", key: "NO-1" } });
    expect(issueRefFor({ key: "OTH-1", project: null }, rows, true, [], "p")).toEqual({ ref: { project: "q", key: "OTH-1" } });
  });

  it("engagementRefFor: ?project= wins, else the single store project, else (the snapshot in) the remembered one", () => {
    const eng = [{ id: "ENG-001", project: "p" }, { id: "ENG-002", project: "p" }, { id: "ENG-002", project: "q" }];
    expect(engagementRefFor({ id: "ENG-001", project: "z" }, eng, "r")).toEqual({ id: "ENG-001", project: "z" });
    expect(engagementRefFor({ id: "ENG-001", project: null }, eng, "r")).toEqual({ id: "ENG-001", project: "p" });
    expect(engagementRefFor({ id: "ENG-002", project: null }, eng, "r")).toEqual({ id: "ENG-002", project: "r" });
    expect(engagementRefFor({ id: "ENG-009", project: null }, undefined, null)).toEqual({ id: "ENG-009", project: null });
    // before the snapshot (`undefined`) a project-less address waits with no project, never the remembered one
    expect(engagementRefFor({ id: "ENG-002", project: null }, undefined, "r")).toEqual({ id: "ENG-002", project: null });
    expect(engagementRefFor({ id: "ENG-002", project: "z" }, undefined, "r")).toEqual({ id: "ENG-002", project: "z" });
    // the snapshot in with no row for the id (an empty list, or null): the remembered project
    expect(engagementRefFor({ id: "ENG-009", project: null }, [], "r")).toEqual({ id: "ENG-009", project: "r" });
    expect(engagementRefFor({ id: "ENG-009", project: null }, null, "r")).toEqual({ id: "ENG-009", project: "r" });
    expect(engagementRefFor({ id: "ENG-009", project: null }, eng, "r")).toEqual({ id: "ENG-009", project: "r" });
  });

  it("addressProject: a served address project is remembered; none or an unserved one is replaced; waits for the list", () => {
    expect(addressProject("q", [], "p")).toBeNull();
    expect(addressProject(null, [], null)).toBeNull();
    expect(addressProject("q", ["p", "q"], "p")).toEqual({ remember: "q" });
    expect(addressProject(null, ["p", "q"], "q")).toEqual({ replace: "q" });
    expect(addressProject("bogus", ["p", "q"], "q")).toEqual({ replace: "q" });
    expect(addressProject("bogus", ["p", "q"], null)).toEqual({ replace: "p" });
    expect(addressProject("bogus", ["p", "q"], "gone")).toEqual({ replace: "p" });
  });

  it("chatProjectCheck: an address engagement with no resolved project waits; else the shown project is kept or reset", () => {
    expect(chatProjectCheck(null, ["p"], { project: null })).toBe("wait");
    expect(chatProjectCheck("p", ["p"], { project: null })).toBe("wait");
    expect(chatProjectCheck(null, null, null)).toBe("wait");
    expect(chatProjectCheck(null, ["p"], { project: "p" })).toBe("keep");
    expect(chatProjectCheck("p", ["p"], { project: "z" })).toBe("reset");
    expect(chatProjectCheck("p", ["p"], null)).toBe("keep");
    expect(chatProjectCheck(null, ["p"], null)).toBe("reset");
    expect(chatProjectCheck("z", ["p"], null)).toBe("reset");
    expect(chatProjectCheck("p", [], null)).toBe("reset");
  });

  it("chatOpenState: an address engagement opens under its own project only (null waits), /app/chat opens none", () => {
    expect(chatOpenState({ id: "ENG-001", project: "q" }, "p")).toEqual({ project: "q", id: "ENG-001" });
    expect(chatOpenState({ id: "ENG-001", project: null }, "p")).toEqual({ project: null, id: "ENG-001" });
    expect(chatOpenState(null, "p")).toEqual({ project: "p", id: null });
  });
});
