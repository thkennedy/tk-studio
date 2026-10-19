// Story 30.2: the supervisor serves the built web under /app behind the session cookie — the directory route, the
// files and their content types, the single-page fallback, the traversal refusal, the missing build, the sign-in's
// return path. A temp dist only (the real apps/studio-web/dist is ignored and never read); no socket.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../src/api";
import { SESSION_COOKIE, signInPage } from "../src/auth";
import { Queue, type Probes, type WorkerKill } from "../src/queue";
import { contentType, resolveWebPath, WEB_BUILD_COMMAND, webRoot } from "../src/web";

const TOKEN = "tok-web-30-2-very-secret-value";
const SECRET = "session-secret-web-0123456789abcdef-0123456";
const USER = "tim.k_owner-1";
const PASSWORD = "correct-horse-battery-30";
const ORIGIN = "https://box.tail1234.ts.net:8787";
const BASE = "http://100.100.1.2:8787";
const INDEX = '<!doctype html><html><head><script type="module" src="/app/assets/app.js"></script></head><body></body></html>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A temp web root: built (index.html, assets/app.js, sprites/x.png) or empty; a planted file beside it, outside. */
function webDir(built = true): string {
  const parent = mkdtempSync(join(tmpdir(), "tk-sup-web-"));
  writeFileSync(join(parent, "outside.txt"), "outside the web root");
  const dir = join(parent, "dist");
  mkdirSync(dir);
  if (built) {
    writeFileSync(join(dir, "index.html"), INDEX);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log('app');");
    mkdirSync(join(dir, "sprites"));
    writeFileSync(join(dir, "sprites", "x.png"), PNG);
  }
  return dir;
}

function fixture(o: { built?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-web-q-"));
  const store = mkdtempSync(join(tmpdir(), "tk-sup-web-store-"));
  const probes: Probes = {
    ownerAlive: () => false,
    engineLive: async () => ({ live: false }),
    killWorker: async (pid, start): Promise<WorkerKill> => ({ pid, start, outcome: "killed" }),
    probeWorker: (pid, start): WorkerKill => ({ pid, start, outcome: "not running" }),
  };
  const queue = new Queue(join(dir, "q.db"), probes);
  const env = { TK_STUDIO_HOME: store, TK_SUPERVISOR_TOKEN: TOKEN, TK_SUPERVISOR_SESSION_SECRET: SECRET };
  const web = webDir(o.built ?? true);
  const handler = createApi({
    queue, token: TOKEN, env, registry: async () => ({ ok: true, projects: {} }), ledger: { user: "op", machine: "box" },
    session: { secret: SECRET }, origin: ORIGIN, account: { sleep: async () => {} }, web: { dir: web },
  });
  /** The URL string as given: `new Request` keeps `%2f`, `%5c`, `%00` and `//` (only `..`/`%2e%2e` collapse). */
  const call = (method: string, path: string, init: { body?: string; headers?: Record<string, string>; cookie?: string; bearer?: boolean } = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (init.cookie) headers.cookie = init.cookie;
    if (init.bearer) headers.authorization = `Bearer ${TOKEN}`;
    return handler(new Request(`${BASE}${path}`, { method, body: init.body, headers }));
  };
  return { call, web };
}

const form = (fields: Record<string, string>) => ({ body: new URLSearchParams(fields).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });

/** A cookie session: the owner's account created through the form, its cookie returned. */
async function cookieSession(fx: ReturnType<typeof fixture>): Promise<string> {
  const res = await fx.call("POST", "/auth/account", form({ username: USER, password: PASSWORD }));
  expect(res.status).toBe(303);
  const raw = res.headers.getSetCookie()[0];
  return raw.split(";")[0];
}

/** Both authorisations a signed-in browser or the operator carries. */
async function auths(fx: ReturnType<typeof fixture>): Promise<{ label: string; init: { cookie?: string; bearer?: boolean } }[]> {
  return [{ label: "cookie", init: { cookie: await cookieSession(fx) } }, { label: "bearer", init: { bearer: true } }];
}

describe("GET /app (AC1)", () => {
  test("the directory route: /app and /app/ answer index.html, text/html, no-store — the cookie session and the bearer alike", async () => {
    const fx = fixture();
    for (const { init } of await auths(fx)) {
      for (const path of ["/app", "/app/"]) {
        const res = await fx.call("GET", path, init);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.text()).toBe(INDEX);
      }
    }
  });

  test("a file: its bytes and its content type, no-store", async () => {
    const fx = fixture();
    for (const { init } of await auths(fx)) {
      const js = await fx.call("GET", "/app/assets/app.js", init);
      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(js.headers.get("cache-control")).toBe("no-store");
      expect(await js.text()).toBe("console.log('app');");
      const png = await fx.call("GET", "/app/sprites/x.png", init);
      expect(png.status).toBe(200);
      expect(png.headers.get("content-type")).toBe("image/png");
      expect(png.headers.get("cache-control")).toBe("no-store");
      expect(Buffer.from(await png.arrayBuffer()).equals(PNG)).toBe(true);
    }
  });

  test("the single-page fallback: a deep path and a missing file answer index.html, no-store", async () => {
    const fx = fixture();
    for (const { init } of await auths(fx)) {
      for (const path of ["/app/office/deep/path", "/app/missing.js", "/app/assets", "/app/office?x=1"]) {
        const res = await fx.call("GET", path, init);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.text()).toBe(INDEX);
      }
    }
  });

  test("traversal: every encoded form is 404 NotFound with no-store — never the fallback, never a file outside dist", async () => {
    const fx = fixture();
    const forms = ["/app/..%2foutside.txt", "/app/..%2Foutside.txt", "/app/a%5cb", "/app/..%5coutside.txt", "/app//etc/passwd",
      "/app/C:%5cx", "/app/C:", "/app/%00", "/app/a%00.js", "/app/%zz", "/app/assets/%E0%A4"];
    for (const { label, init } of await auths(fx)) {
      for (const path of forms) {
        const res = await fx.call("GET", path, init);
        expect({ label, path, status: res.status }).toEqual({ label, path, status: 404 });
        expect(res.headers.get("cache-control")).toBe("no-store");
        const body = await res.json() as { ok: boolean; error: string };
        expect(body.ok).toBe(false);
        expect(body.error).toBe("NotFound");
      }
    }
  });

  test("traversal the URL parser collapses (`..`, `%2e%2e`) never reaches /app: never the fallback, never a file outside", async () => {
    const fx = fixture();
    // WHATWG `URL` turns /app/%2e%2e/outside.txt into /outside.txt before the handler sees it.
    expect(new Request(`${BASE}/app/%2e%2e/outside.txt`).url).toBe(`${BASE}/outside.txt`);
    const session = await cookieSession(fx);
    for (const path of ["/app/%2e%2e/outside.txt", "/app/.%2e/outside.txt", "/app/sub/%2e%2e/%2e%2e/outside.txt", "/app/../outside.txt"]) {
      const bearer = await fx.call("GET", path, { bearer: true });
      expect(bearer.status).toBe(404);
      expect((await bearer.json() as { error: string }).error).toBe("NotFound");
      const cookie = await fx.call("GET", path, { cookie: session });
      expect(cookie.status).toBe(401);
      expect(await cookie.text()).not.toContain("outside the web root");
    }
  });

  test("a wrong method: 405 Allow GET with the bearer, 401 with the cookie (outside its allowlist)", async () => {
    const fx = fixture();
    const bearer = await fx.call("POST", "/app", { bearer: true });
    expect(bearer.status).toBe(405);
    expect(bearer.headers.get("allow")).toBe("GET");
    const cookie = await fx.call("POST", "/app/x", { cookie: await cookieSession(fx) });
    expect(cookie.status).toBe(401);
    expect(await cookie.json()).toEqual({ ok: false, error: "Unauthorized" });
  });

  test("Story 30.6: GET / with a session is the web's index.html (no-store), as GET /app — the cookie and the bearer alike", async () => {
    const fx = fixture();
    for (const { init } of await auths(fx)) {
      const res = await fx.call("GET", "/", init);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe(INDEX);
    }
  });

  test("Story 30.6: GET /status with Accept text/html is the read-only page (no script), vary Accept", async () => {
    const fx = fixture();
    for (const { label, init } of await auths(fx)) {
      const res = await fx.call("GET", "/status", { ...init, headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("vary")).toBe("Accept");
      const body = await res.text();
      expect(body).toContain("<h1>tk-studio supervisor</h1><p class=\"meta\">generated");
      expect(body).not.toContain("<script");
      expect(body).not.toContain("The web is not built");
      expect(label === "cookie" || !body.includes('name="csrf"')).toBe(true);
    }
  });

  test("Story 30.6: GET /status with no, */* or application/json Accept is today's JSON, vary Accept — the cookie and the bearer alike", async () => {
    const fx = fixture();
    for (const { init } of await auths(fx)) {
      for (const accept of [undefined, "*/*", "application/json"]) {
        const res = await fx.call("GET", "/status", { ...init, ...(accept ? { headers: { accept } } : {}) });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
        expect(res.headers.get("vary")).toBe("Accept");
        expect(await res.text()).toBe(JSON.stringify({ ok: true, counts: {}, live: [], locks: [] }));
      }
    }
  });
});

describe("no built web (AC2)", () => {
  test("GET /app and a path under it: 503 WebNotBuilt naming the build command, no-store; GET / is the page with the note (never a 503)", async () => {
    const fx = fixture({ built: false });
    for (const { init } of await auths(fx)) {
      for (const path of ["/app", "/app/", "/app/assets/app.js"]) {
        const res = await fx.call("GET", path, init);
        expect(res.status).toBe(503);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(await res.json()).toEqual({ ok: false, error: "WebNotBuilt", command: "cd apps/studio-web && bun install --frozen-lockfile && bun run build" });
      }
      const home = await fx.call("GET", "/", init);
      expect(home.status).toBe(200);
      expect(home.headers.get("content-type")).toBe("text/html; charset=utf-8");
      const page = await home.text();
      expect(page).toContain('<p class="note">The web is not built: cd apps/studio-web &amp;&amp; bun install --frozen-lockfile &amp;&amp; bun run build</p>');
      const status = await (await fx.call("GET", "/status", { ...init, headers: { accept: "text/html" } })).text();
      expect(status).toContain('<p class="note">The web is not built: cd apps/studio-web &amp;&amp; bun install --frozen-lockfile &amp;&amp; bun run build</p>');
    }
  });

  test("webRoot: built only when index.html exists; an explicit dir is the only candidate", () => {
    expect(webRoot({ dir: webDir(true) })).not.toBeNull();
    expect(webRoot({ dir: webDir(false) })).toBeNull();
    expect(webRoot({ dir: join(tmpdir(), "tk-sup-web-absent-dir-30-2") })).toBeNull();
    expect(WEB_BUILD_COMMAND).toBe("cd apps/studio-web && bun install --frozen-lockfile && bun run build");
  });
});

/** An install layout: `<root>/supervisor/<ver>/src` (the appDir), `<root>/current.json` naming a studio-web slot
 * (`path` absolute or relative to `<root>`), the slot built or not; and a checkout layout `<co>/apps/supervisor/src`
 * whose `<co>/apps/studio-web/dist` is built or not. */
function installLayout(o: { slot: "absolute" | "relative" | "none"; slotBuilt: boolean }): { appDir: string; slot: string } {
  const root = mkdtempSync(join(tmpdir(), "tk-sup-web-install-"));
  const appDir = join(root, "supervisor", "0.1.0", "src");
  mkdirSync(appDir, { recursive: true });
  const slot = join(root, "studio-web", "0.1.0");
  mkdirSync(slot, { recursive: true });
  if (o.slotBuilt) writeFileSync(join(slot, "index.html"), INDEX);
  if (o.slot !== "none") {
    const path = o.slot === "absolute" ? slot : join("studio-web", "0.1.0");
    writeFileSync(join(root, "current.json"), JSON.stringify({ "studio-web": { version: "0.1.0", path } }, null, 2) + "\n");
  }
  return { appDir, slot };
}

function checkoutLayout(distBuilt: boolean): { appDir: string; dist: string } {
  const co = mkdtempSync(join(tmpdir(), "tk-sup-web-checkout-"));
  const appDir = join(co, "apps", "supervisor", "src");
  mkdirSync(appDir, { recursive: true });
  const dist = join(co, "apps", "studio-web", "dist");
  mkdirSync(dist, { recursive: true });
  if (distBuilt) writeFileSync(join(dist, "index.html"), INDEX);
  return { appDir, dist };
}

describe("webRoot's candidates (installed slot, then checkout)", () => {
  test("current.json's studio-web path, absolute: the built slot is chosen", () => {
    const { appDir, slot } = installLayout({ slot: "absolute", slotBuilt: true });
    expect(webRoot({ appDir })).toBe(slot);
  });

  test("current.json's studio-web path, relative to <root>: the built slot is chosen", () => {
    const { appDir, slot } = installLayout({ slot: "relative", slotBuilt: true });
    expect(webRoot({ appDir })).toBe(slot);
  });

  test("a slot without index.html falls through to the checkout's apps/studio-web/dist", () => {
    // A layout where the slot's appDir is also the checkout's: <x>/apps/supervisor/src with <x>/current.json
    // three levels up, and <x>/apps/studio-web/dist two levels up.
    const { appDir, dist } = checkoutLayout(true);
    const root = join(appDir, "..", "..", "..");
    mkdirSync(join(root, "slot"));
    writeFileSync(join(root, "current.json"), JSON.stringify({ "studio-web": { version: "0.1.0", path: join(root, "slot") } }));
    expect(webRoot({ appDir })).toBe(dist);
  });

  test("the slot is preferred over the checkout when both are built", () => {
    const { appDir } = checkoutLayout(true);
    const root = join(appDir, "..", "..", "..");
    const slot = join(root, "slot");
    mkdirSync(slot);
    writeFileSync(join(slot, "index.html"), INDEX);
    writeFileSync(join(root, "current.json"), JSON.stringify({ "studio-web": { version: "0.1.0", path: "slot" } }));
    expect(webRoot({ appDir })).toBe(slot);
  });

  test("neither built: null; no current.json and no dist: null", () => {
    expect(webRoot({ appDir: installLayout({ slot: "absolute", slotBuilt: false }).appDir })).toBeNull();
    expect(webRoot({ appDir: checkoutLayout(false).appDir })).toBeNull();
  });

  test("an explicit dir stays the only candidate, whatever appDir finds", () => {
    const { appDir } = installLayout({ slot: "absolute", slotBuilt: true });
    expect(webRoot({ dir: webDir(false), appDir })).toBeNull();
  });
});

describe("the sign-in's return path (AC1)", () => {
  test("no session: GET /app/board?x=1 answers the 401 sign-in page, each form carrying next; other routes unchanged", async () => {
    const fx = fixture();
    const res = await fx.call("GET", "/app/board?x=1");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    const hidden = '<input type="hidden" name="next" value="/app/board?x=1">';
    expect(body).toContain(`<form method="post" action="/auth/account">${hidden}`);
    expect(body).toContain(`<form method="post" action="/auth/token">${hidden}`);
    expect(body.split(hidden)).toHaveLength(3);
    // /app itself too
    expect(await (await fx.call("GET", "/app")).text()).toContain('<input type="hidden" name="next" value="/app">');
    // GET / stays the sign-in page with no next; a non-GET /app and other routes stay 401 JSON
    const root = await fx.call("GET", "/");
    expect(root.status).toBe(401);
    expect(await root.text()).not.toContain('name="next"');
    for (const [method, path] of [["POST", "/app"], ["GET", "/status"], ["GET", "/apps"]] as const) {
      const r = await fx.call(method, path);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ ok: false, error: "Unauthorized" });
    }
    // Story 30.6: an HTML GET /status is the sign-in page with next=/status; a non-HTML one stays 401 JSON
    const status = await fx.call("GET", "/status", { headers: { accept: "text/html" } });
    expect(status.status).toBe(401);
    expect(status.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(status.headers.get("vary")).toBe("Accept");
    expect(await status.text()).toContain('<form method="post" action="/auth/account"><input type="hidden" name="next" value="/status">');
    for (const accept of ["*/*", "application/json"]) {
      const r = await fx.call("GET", "/status", { headers: { accept } });
      expect(r.status).toBe(401);
      expect(r.headers.get("vary")).toBe("Accept");
      expect(await r.json()).toEqual({ ok: false, error: "Unauthorized" });
    }
  });

  test("a successful form sign-in 303s to a safe next; the sign-in form after the account exists carries it too", async () => {
    const fx = fixture();
    const created = await fx.call("POST", "/auth/account", form({ username: USER, password: PASSWORD, next: "/app/board?x=1" }));
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/app/board?x=1");
    expect(created.headers.get("cache-control")).toBe("no-store");
    const page = await (await fx.call("GET", "/app/x")).text();
    expect(page).toContain('<form method="post" action="/auth/signin"><input type="hidden" name="next" value="/app/x">');
    const signedIn = await fx.call("POST", "/auth/signin", form({ username: USER, password: PASSWORD, next: "/app/x" }));
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toBe("/app/x");
    // the cookie it sets reads /app
    const cookie = signedIn.headers.getSetCookie()[0].split(";")[0];
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect((await fx.call("GET", "/app/x", { cookie })).status).toBe(200);
    const token = await fx.call("POST", "/auth/token", form({ token: TOKEN, next: "/app/office" }));
    expect(token.status).toBe(303);
    expect(token.headers.get("location")).toBe("/app/office");
  });

  test("an unsafe next returns to /: never an open redirect", async () => {
    const fx = fixture();
    await fx.call("POST", "/auth/account", form({ username: USER, password: PASSWORD }));
    for (const next of ["//evil.example", "/\\evil.example", "https://x.example/app", "javascript:alert(1)", "app/x", "/app/\\x", "/app/\tx", "/app/\nx", "/app/\u0085x", "/app/☃", "/app/日本", ""]) {
      const res = await fx.call("POST", "/auth/signin", form({ username: USER, password: PASSWORD, next }));
      expect({ next, status: res.status, location: res.headers.get("location") }).toEqual({ next, status: 303, location: "/" });
      const tok = await fx.call("POST", "/auth/token", form({ token: TOKEN, next }));
      expect(tok.headers.get("location")).toBe("/");
    }
  });

  test("a non-ASCII next on account creation returns to /, not a 500", async () => {
    const fx = fixture();
    const res = await fx.call("POST", "/auth/account", form({ username: USER, password: PASSWORD, next: "/app/日本" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  test("a JSON sign-in still answers {ok:true, username}", async () => {
    const fx = fixture();
    await fx.call("POST", "/auth/account", form({ username: USER, password: PASSWORD }));
    const res = await fx.call("POST", "/auth/signin", { body: JSON.stringify({ username: USER, password: PASSWORD, next: "/app/x" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, username: USER });
  });

  test("a refused form sign-in keeps the next on the page it answers", async () => {
    const fx = fixture();
    await fx.call("POST", "/auth/account", form({ username: USER, password: PASSWORD }));
    const res = await fx.call("POST", "/auth/signin", form({ username: USER, password: "wrong-password-30-2x", next: "/app/x" }));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('<input type="hidden" name="next" value="/app/x">');
  });

  test("signInPage escapes next", () => {
    const html = signInPage({ mode: "signin", next: '/app/"><script>' });
    expect(html).toContain('value="/app/&quot;&gt;&lt;script&gt;"');
    expect(html).not.toContain("<script>");
  });
});

describe("the pure helpers", () => {
  test("resolveWebPath: file, fallback, refused", () => {
    const root = webDir(true);
    expect(resolveWebPath(root, "/app")).toEqual({ fallback: join(root, "index.html") });
    expect(resolveWebPath(root, "/app/assets/app.js")).toEqual({ file: join(root, "assets", "app.js") });
    expect(resolveWebPath(root, "/app/x/y")).toEqual({ fallback: join(root, "index.html") });
    for (const p of ["/app/..", "/app/.", "/app/a//b", "/app/%2e%2e", "/app/a%2fb", "/app/%5c", "/app/c:", "/app/%00", "/app/%", "/apps", "/"]) {
      expect(resolveWebPath(root, p)).toEqual({ refused: true });
    }
  });

  test("resolveWebPath: a symlink inside the root pointing outside it is refused (real-path containment)", () => {
    const root = webDir(true);
    try {
      symlinkSync(join(root, "..", "outside.txt"), join(root, "leak.txt"));
      symlinkSync(join(root, ".."), join(root, "up"), "dir");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP" || code === "EINVAL") {
        console.warn(`symlink test skipped: ${code}`);
        return;
      }
      throw e;
    }
    expect(resolveWebPath(root, "/app/leak.txt")).toEqual({ refused: true });
    expect(resolveWebPath(root, "/app/up/outside.txt")).toEqual({ refused: true });
    expect(resolveWebPath(root, "/app/assets/app.js")).toEqual({ file: join(root, "assets", "app.js") });
  });

  test("contentType: textual types carry utf-8; unknown is octet-stream", () => {
    expect(contentType("a/index.html")).toBe("text/html; charset=utf-8");
    expect(contentType("a.JS")).toBe("text/javascript; charset=utf-8");
    expect(contentType("a.css")).toBe("text/css; charset=utf-8");
    expect(contentType("a.json")).toBe("application/json; charset=utf-8");
    expect(contentType("a.svg")).toBe("image/svg+xml; charset=utf-8");
    expect(contentType("a.png")).toBe("image/png");
    expect(contentType("a.bin")).toBe("application/octet-stream");
    expect(contentType("noext")).toBe("application/octet-stream");
  });
});
