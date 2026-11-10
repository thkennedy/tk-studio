// The addresses (Story 39.1, addendum §3.3): the web's routes under `/app`, a hand-rolled router over the History API,
// and the one-time migration of the remembered screen (Story 30.6's `tk-studio.web.screen`) and the remembered issue
// (Story 31.6's `tk-studio.web.issue`), neither of which is written again. Pure functions vitest drives in
// `environment: "node"`: the router takes an injected `HistoryLike` (the browser's `window`, or a fake), the migration
// an injected storage. No router package (a new dependency would change `bun.lock` for one screen switch).
import { rememberedIssue, ISSUE_KEY, type IssueRef } from "./issue/model";
import type { StorageLike } from "./office/model";

// ------------------------------------------------------------ the route table

export type Route =
  | { name: "office"; project: string | null }
  | { name: "board"; project: string | null }
  | { name: "story"; id: string }
  | { name: "run"; id: string }
  | { name: "inbox" }
  | { name: "issue"; key: string; project: string | null }
  | { name: "chat" }
  | { name: "engagement"; id: string; project: string | null }
  | { name: "checkin"; id: string; n: string; project: string | null }
  | { name: "status" }
  | { name: "settings" }
  | { name: "notFound"; path: string };

/** The landing: `/app`, `/app/` and every path outside `/app` are replaced by it. */
export const HOME_PATH = "/app/office";

/** The screens not built yet, each naming the story that builds it. Story 39.2: `/app/settings` is the Settings screen
 * (the Sandbox login card); `settings` names its part still to build, Story 39.8's model and effort. Story 39.3:
 * `/app/chat` is the studio chat (`chat/StudioChatScreen.tsx`), no longer a placeholder. Story 39.4: `/app/story/<id>` is the
 * story page (`story/StoryScreen.tsx`), no longer a placeholder. */
export const PLACEHOLDER = {
  run: "Not built yet: Story 39.5",
  checkin: "Not built yet: Story 39.7",
  settings: "Not built yet: Story 39.8",
} as const;

export const notFoundText = (path: string): string => `No page at ${path}`;

const CHECKIN_N = /^[1-9]\d*$/;

const projectOf = (search: string): string | null => {
  try {
    const p = new URLSearchParams(search).get("project");
    return p !== null && p.trim() !== "" ? p : null;
  } catch {
    return null;
  }
};

/** The route of a location. Segments are `decodeURIComponent`-decoded (a decode failure is `notFound`); trailing
 * slashes are dropped. A path outside `/app`, and `/app` itself, answer the office with a `redirect` to `/app/office`. */
export function parseRoute(pathname: string, search = ""): { route: Route; redirect?: string } {
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed !== "/app" && !trimmed.startsWith("/app/")) return { route: { name: "office", project: null }, redirect: HOME_PATH };
  if (trimmed === "/app") return { route: { name: "office", project: null }, redirect: HOME_PATH };
  const notFound: { route: Route } = { route: { name: "notFound", path: pathname } };
  let segs: string[];
  try {
    segs = trimmed.slice("/app/".length).split("/").map((s) => decodeURIComponent(s));
  } catch {
    return notFound;
  }
  if (segs.some((s) => s === "")) return notFound;
  const project = projectOf(search);
  const [head, ...rest] = segs;
  switch (head) {
    case "office":
    case "board":
      if (rest.length === 0) return { route: { name: head, project: null } };
      if (rest.length === 1) return { route: { name: head, project: rest[0]! } };
      return notFound;
    case "story":
    case "run":
      return rest.length === 1 ? { route: { name: head, id: rest[0]! } } : notFound;
    case "inbox":
      if (rest.length === 0) return { route: { name: "inbox" } };
      if (rest.length === 1) return { route: { name: "issue", key: rest[0]!, project } };
      return notFound;
    case "chat":
      if (rest.length === 0) return { route: { name: "chat" } };
      if (rest.length === 1) return { route: { name: "engagement", id: rest[0]!, project } };
      return notFound;
    case "checkin":
      return rest.length === 2 && CHECKIN_N.test(rest[1]!) ? { route: { name: "checkin", id: rest[0]!, n: rest[1]!, project } } : notFound;
    case "status":
    case "settings":
      return rest.length === 0 ? { route: { name: head } } : notFound;
    default:
      return notFound;
  }
}

const enc = encodeURIComponent;
const withProject = (path: string, project: string | null): string => (project !== null ? `${path}?project=${enc(project)}` : path);

/** The path of a route: each segment encoded, `?project=<id>` appended when the route carries one. */
export function routePath(route: Route): string {
  switch (route.name) {
    case "office":
    case "board":
      return route.project !== null ? `/app/${route.name}/${enc(route.project)}` : `/app/${route.name}`;
    case "story":
    case "run":
      return `/app/${route.name}/${enc(route.id)}`;
    case "inbox":
      return "/app/inbox";
    case "issue":
      return withProject(`/app/inbox/${enc(route.key)}`, route.project);
    case "chat":
      return "/app/chat";
    case "engagement":
      return withProject(`/app/chat/${enc(route.id)}`, route.project);
    case "checkin":
      return withProject(`/app/checkin/${enc(route.id)}/${route.n}`, route.project);
    case "status":
      return "/app/status";
    case "settings":
      return "/app/settings";
    case "notFound":
      return route.path;
  }
}

/** The landing: the office with no project chosen (where the migration's carried route may apply). */
export const isLanding = (route: Route): boolean => route.name === "office" && route.project === null;

// ------------------------------------------------------------ the nav

export interface NavItem { label: string; path: string; count?: "inbox" | "chat" }
export const NAV: readonly NavItem[] = [
  { label: "Office", path: "/app/office" },
  { label: "Board", path: "/app/board" },
  { label: "Status", path: "/app/status" },
  { label: "Inbox", path: "/app/inbox", count: "inbox" },
  { label: "Chat", path: "/app/chat", count: "chat" },
  { label: "Settings", path: "/app/settings" },
];

/** The nav item for the screen shown (disabled: pushing it again would only stack a duplicate entry). The office and
 * the board are theirs with any project (the screen replaces its bare path with the chosen project's); an issue and an
 * engagement are not the Inbox's or the Chat's, whose items stay enabled to go back to the list. */
export function navActive(route: Route, item: NavItem): boolean {
  switch (route.name) {
    case "office":
    case "board":
    case "inbox":
    case "chat":
    case "status":
    case "settings":
      return item.path === `/app/${route.name}`;
    default:
      return false;
  }
}

// ------------------------------------------------------------ the router

type Listener = () => void;
export interface HistoryLike {
  location: { pathname: string; search: string };
  history: { pushState(data: unknown, unused: string, url: string): void; replaceState(data: unknown, unused: string, url: string): void };
  addEventListener(type: "popstate", fn: Listener): void;
  removeEventListener(type: "popstate", fn: Listener): void;
}
export interface RouteSnapshot { route: Route; path: string }
export interface Router {
  /** The cached snapshot (stable until the route changes), for `useSyncExternalStore`. */
  current(): RouteSnapshot;
  /** Pushes (or replaces) `path`; the current path is a no-op. */
  navigate(path: string, opts?: { replace?: boolean }): void;
  subscribe(fn: Listener): () => void;
  /** Detaches the `popstate` listener. */
  dispose(): void;
}

/** A router over `win`'s history. A location whose parse carries a `redirect` is replaced by it (at creation, on a
 * navigation and on `popstate`); `popstate` (back, forward) re-parses and notifies. */
export function createRouter(win: HistoryLike): Router {
  const listeners = new Set<Listener>();
  const read = (): RouteSnapshot => {
    let { pathname, search } = win.location;
    const parsed = parseRoute(pathname, search);
    if (parsed.redirect !== undefined) {
      win.history.replaceState(null, "", parsed.redirect);
      ({ pathname, search } = win.location);
      return { route: parseRoute(pathname, search).route, path: `${pathname}${search}` };
    }
    return { route: parsed.route, path: `${pathname}${search}` };
  };
  let snapshot = read();
  const update = () => {
    const next = read();
    if (next.path === snapshot.path && JSON.stringify(next.route) === JSON.stringify(snapshot.route)) return;
    snapshot = next;
    for (const fn of [...listeners]) fn();
  };
  const onPop = () => update();
  win.addEventListener("popstate", onPop);
  return {
    current: () => snapshot,
    navigate(path, opts = {}) {
      if (path === snapshot.path) return;
      if (opts.replace) win.history.replaceState(null, "", path);
      else win.history.pushState(null, "", path);
      update();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose() {
      win.removeEventListener("popstate", onPop);
      listeners.clear();
    },
  };
}

// ------------------------------------------------------------ the migration (the remembered keys, read once)

/** Story 30.6's key: read once by `migrateRemembered`, never written again. */
export const SCREEN_KEY = "tk-studio.web.screen";
const CARRIED: Record<string, string> = { office: "/app/office", board: "/app/board", status: "/app/status", inbox: "/app/inbox", chat: "/app/chat" };

const defaultStorage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

/** Reads `tk-studio.web.screen` and `tk-studio.web.issue`, removes both, and answers the route they carried (null for
 * none). A storage that throws counts as nothing stored; a `removeItem` that throws (or is missing) is ignored. */
export function migrateRemembered(storage: (StorageLike & { removeItem?(key: string): void }) | null = defaultStorage()): string | null {
  let screen: string | null = null;
  try {
    screen = storage?.getItem(SCREEN_KEY) ?? null;
  } catch {
    screen = null;
  }
  const issue = screen === "issue" ? rememberedIssue(storage) : null;
  for (const key of [SCREEN_KEY, ISSUE_KEY]) {
    try {
      storage?.removeItem?.(key);
    } catch {
      /* ignored */
    }
  }
  if (screen === "issue") return issue ? routePath({ name: "issue", key: issue.key, project: issue.project }) : "/app/inbox";
  return screen !== null && Object.prototype.hasOwnProperty.call(CARRIED, screen) ? CARRIED[screen]! : null;
}

// ------------------------------------------------------------ the project of a project-less address

export const LOADING_INBOX = "Loading the inbox…";
export const notInInbox = (key: string): string => `Not in the inbox: ${key}`;

/** `/app/inbox/<KEY>`'s issue: `?project=` when given, else the open inbox row's project for that key, else the
 * project already resolved for this key (`kept`: the row left the inbox while the issue was open); while the inbox
 * loads the text says so, with no row and a failed read it names the read errors (one per line), else it names the key. */
export function issueRefFor(
  route: { key: string; project: string | null },
  rows: readonly { project: string; key: string }[],
  loaded: boolean,
  errors: readonly string[] = [],
  kept: string | null = null,
): { ref: IssueRef } | { text: string } {
  if (route.project !== null) return { ref: { project: route.project, key: route.key } };
  const row = rows.find((r) => r.key === route.key);
  if (row) return { ref: { project: row.project, key: route.key } };
  if (kept !== null) return { ref: { project: kept, key: route.key } };
  if (!loaded) return { text: LOADING_INBOX };
  return { text: errors.length > 0 ? errors.map((e) => `error ${e}`).join("\n") : notInInbox(route.key) };
}

/** `/app/chat/<id>`'s engagement: `?project=` when given, else the single project among the store's engagement rows
 * with that id, else, once the store's snapshot is in (`engagements` not `undefined`), the remembered chat project
 * (null with none). Before the snapshot a project-less address resolves to no project, so the Chat screen waits
 * (`chatOpenState`, `chatProjectCheck`) rather than open another project's same-numbered engagement (ids are per
 * project). */
export function engagementRefFor(
  route: { id: string; project: string | null },
  engagements: readonly { id: string; project: string }[] | null | undefined,
  rememberedProject: string | null,
): { id: string; project: string | null } {
  if (route.project !== null) return { id: route.id, project: route.project };
  const projects = [...new Set((engagements ?? []).filter((e) => e.id === route.id).map((e) => e.project))];
  if (projects.length === 1) return { id: route.id, project: projects[0]! };
  if (engagements === undefined) return { id: route.id, project: null };
  return { id: route.id, project: rememberedProject };
}

// ------------------------------------------------------------ the address's project against the served ones

/** The Office and Board address's project once the served list is read (null while it is not, or none is served): a
 * served one is remembered (the shown and the remembered project agree); none, or one not served, is replaced by the
 * remembered served choice (`remembered`, `rememberedProject(served)`), else the first served. */
export function addressProject(
  project: string | null,
  served: readonly string[],
  remembered: string | null,
): { remember: string } | { replace: string } | null {
  if (served.length === 0) return null;
  if (project !== null && served.includes(project)) return { remember: project };
  const p = remembered !== null && served.includes(remembered) ? remembered : served[0]!;
  return { replace: p };
}

/** The Chat screen's project against the served ones: `wait` while the served list is unread or the address names an
 * engagement whose project is not resolved yet (`open.project` null: the store's snapshot may still name it); else the
 * project shown (the address's when it names an engagement) is kept when served, else reset. */
export function chatProjectCheck(
  project: string | null,
  served: readonly string[] | null,
  open: { project: string | null } | null,
): "wait" | "keep" | "reset" {
  if (served === null) return "wait";
  if (open !== null && open.project === null) return "wait";
  const p = open !== null ? open.project : project;
  return p !== null && served.includes(p) ? "keep" : "reset";
}

/** The Chat screen's project and engagement when the address changes: an engagement opens under its own project only
 * (a null one waits with none, never the last selection); `/app/chat` keeps the project and opens none. */
export function chatOpenState(
  open: { id: string; project: string | null } | null,
  project: string | null,
): { project: string | null; id: string | null } {
  return open !== null ? { project: open.project, id: open.id } : { project, id: null };
}
