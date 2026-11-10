// Test-side fake executables, shared by the end-to-end suites.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tempDir } from "./tmp";

/** win32 only: the launcher every fake there is a hard link of. Compiled once per bun build and cached in
 * the temp dir. It runs `bun <its own name>.js <args>` with the terminal inherited, answers that exit code,
 * and hands its own parent's pid on as FAKE_PARENT_PID (the fake's parent is the launcher, not the supervisor). */
export function fakeLauncher(): string {
  const exe = join(tmpdir(), `tk-sup-fake-launcher-${Bun.version}-${Bun.hash(process.execPath).toString(16)}.exe`);
  if (existsSync(exe)) return exe;
  const dir = tempDir("tk-sup-launcher-");
  const src = join(dir, "launcher.js");
  writeFileSync(src, [
    `const { spawnSync } = require("node:child_process");`,
    `const script = process.execPath.replace(/\.exe$/i, ".js");`,
    `const r = spawnSync(${JSON.stringify(process.execPath)}, [script, ...process.argv.slice(2)],`,
    `  { stdio: "inherit", env: { ...process.env, FAKE_PARENT_PID: String(process.ppid) } });`,
    `process.exit(r.status ?? 1);`,
  ].join("\n"));
  const built = join(dir, "launcher.exe");
  const res = spawnSync(process.execPath, ["build", "--compile", src, "--outfile", built], { encoding: "utf-8" });
  if (res.status !== 0 || !existsSync(built)) throw new Error(`fake launcher build failed: ${res.stdout}${res.stderr}`);
  try { renameSync(built, exe); } catch { if (!existsSync(exe)) copyFileSync(built, exe); } // another test file won the race; win-ok: a file, the failure handled
  return exe;
}

/** A fake executable from a bun script at `path`. POSIX: the shebang file itself, made executable.
 * win32: `<name>.exe` beside `<name>.js`, a hard link of `fakeLauncher()`. A `.cmd` shim does not do:
 * Node and Bun refuse to spawn one without a shell (EINVAL), and the production spawn path has none.
 * Test-side only. Answers the path to exec. */
export function fakeBin(path: string, script: string): string {
  const source = `#!/usr/bin/env bun\n${script}`;
  if (process.platform !== "win32") { writeFileSync(path, source); chmodSync(path, 0o755); return path; }
  const base = path.replace(/\.js$/, "");
  writeFileSync(`${base}.js`, source);
  const exe = `${base}.exe`;
  try { linkSync(fakeLauncher(), exe); } catch { copyFileSync(fakeLauncher(), exe); } // another volume
  return exe;
}

// ------------------------------------------------------------ Story 27.1: worktree fakes

/** `real` mirrored at `fake`: every entry linked (a directory as a junction on win32, a file copied
 * there), except the paths in `overrides` (relative, `/`-separated), written with their content. */
function mirrorTree(real: string, fake: string, overrides: Record<string, string>, prefix = ""): void {
  mkdirSync(fake, { recursive: true });
  const own = new Set(Object.keys(overrides).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split("/")[0]));
  for (const name of readdirSync(real)) {
    if (own.has(name)) continue;
    const from = join(real, name), to = join(fake, name);
    if (statSync(from).isDirectory()) symlinkSync(from, to, process.platform === "win32" ? "junction" : "dir");
    else if (process.platform === "win32") copyFileSync(from, to);
    else symlinkSync(from, to, "file");
  }
  for (const name of own) {
    const rel = `${prefix}${name}`;
    if (rel in overrides) { mkdirSync(fake, { recursive: true }); writeFileSync(join(fake, name), overrides[rel]); continue; }
    const from = join(real, name);
    if (existsSync(from)) mirrorTree(from, join(fake, name), overrides, `${rel}/`);
    else {
      for (const [k, v] of Object.entries(overrides).filter(([k]) => k.startsWith(`${rel}/`))) {
        mkdirSync(dirname(join(fake, ...k.slice(prefix.length).split("/"))), { recursive: true });
        writeFileSync(join(fake, ...k.slice(prefix.length).split("/")), v);
      }
    }
  }
}

/** A throwaway TK_STUDIO_ROOT (operator-decisions §1: a fake studio script under a temp root, in
 * tests only): the real studio mirrored, with `tk install` (`install_base.py`) and `tk activate`
 * (`drift_check.py`) replaced by fakes that log their argv to `calls` and answer from `answers`
 * (`{"install": "ok"|"fail", "drift": "clean"|"drift"}`, rewritable between runs). */
export function fakeStudioRoot(realRoot: string = process.env.TK_STUDIO_ROOT!): { root: string; calls: () => { script: string; argv: string[] }[]; answer: (a: { install?: string; drift?: string; meter?: string }) => void } {
  const root = tempDir("tk-sup-studio-");
  const log = join(root, "studio-calls.jsonl"), answers = join(root, "studio-answers.json");
  writeFileSync(answers, JSON.stringify({ install: "ok", drift: "clean", meter: "ok" }));
  const py = (script: string, body: string) => [
    "import json, sys",
    `log = ${JSON.stringify(log)}`,
    `with open(log, "a", encoding="utf-8") as f: f.write(json.dumps({"script": ${JSON.stringify(script)}, "argv": sys.argv[1:]}) + "\\n")`,
    `answers = json.load(open(${JSON.stringify(answers)}, encoding="utf-8"))`,
    body,
  ].join("\n");
  mirrorTree(realRoot, root, {
    "plugins/tk-studio/skills/tk-studio-install/scripts/install_base.py": py("install_base", [
      `if answers.get("install") == "ok": print(json.dumps({"ok": True, "installed": True}))`,
      `else:`,
      `    print(json.dumps({"ok": False, "step": "upstream-installer", "error": "fake install failed"}))`,
      `    sys.exit(1)`,
    ].join("\n")),
    "plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py": py("drift_check", [
      `result = answers.get("drift", "clean")`,
      `print(json.dumps({"ok": True, "result": result}))`,
      `sys.exit(0 if result == "clean" else 1)`,
    ].join("\n")),
    // Story 27.3: `meter.py harvest --run-dir D` (`meter: "ok"` → {ok:true}, else {ok:false} exit 2).
    "plugins/tk-studio/lib/meter.py": py("meter", [
      `if answers.get("meter", "ok") == "ok": print(json.dumps({"ok": True, "harvested": [], "run_dir": sys.argv[-1]}))`,
      `else:`,
      `    print(json.dumps({"ok": False, "error": "fake meter failed"}))`,
      `    sys.exit(2)`,
    ].join("\n")),
  });
  return {
    root,
    calls: () => existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    answer: (a) => writeFileSync(answers, JSON.stringify({ install: "ok", drift: "clean", meter: "ok", ...a })),
  };
}

/** Story 27.5: a throwaway TK_STUDIO_ROOT holding only a fake planning adapter,
 * `plugins/tk-studio/lib/plansync.py` (operator-decisions §1: in tests only). `status --directory D --id ST --status S
 * [--note N] [--caller C]` logs its argv to `calls` and answers from `answer` (rewritable between runs): `ok` →
 * `{ok: true, id, status, previous_status}` (exit 0); `refuse` → `{ok: false, error}` (exit 2); `blocked` →
 * `{ok: false, blocked: true, reason, written: true}` (exit 2); `crash` → a traceback on stderr, no JSON (exit 1).
 * Story 32.6: `normalize|sync --directory D` mints one `plan/EP-<next.epic>.md` (`id`, `source: epics.md#epic-N`) per
 * `## Epic N` of `_bmad-output/planning-artifacts/epics.md` no entity names yet, advances `.tk-studio/plan-counter.yaml`'s
 * `next.epic`, and answers `{ok: true, written: [<absolute paths>]}` (exit 0); `sync` (rewritable between runs) answers
 * `blocked` → `{ok: false, blocked: true, reason: "fake sync blocked", written: []}` (exit 2), `crash` → a traceback,
 * `partial` → the minting done, then `{ok: false, blocked: true, reason: "fake sync partial", written: [...]}` (exit 2).
 * `removes(paths)`: those `--directory`-relative files deleted after the minting and answered as `removed: [<absolute
 * paths>]` (only when one was deleted).
 * Story 35.8: `stage --append --row-json R` and `stage-post` answer from `stage` (rewritable between runs): `ok` →
 * `{ok: true, appended: <rows in R>}` and `{ok: true, posted: {start, stop, worklog, found}, unposted: 0}` (exit 0);
 * `post-fail` → stage-post `{ok: false, posted: {…0}, unposted: 4, retryable: true, reason: "stage-post failed: Jira
 * answered 503"}` (exit 2); `post-pending` → stage-post `{ok: false, unposted: 1, retryable: true, status: partial}`
 * (exit 2); `post-refuse` → stage-post `{ok: false, reason: "… carries no external.jira.key …"}` (exit 2, no
 * `retryable`); `append-fail` → stage `{ok: false, error: "fake stage refused"}` (exit 2, a refusal); `append-crash` →
 * a traceback (exit 1); `buffered` → stage `{ok: true, appended: <rows in R>, buffered: true}`. */
export function fakePlansync(): {
  root: string; calls: () => string[][]; answer: (a: "ok" | "refuse" | "blocked" | "crash") => void;
  sync: (a: "ok" | "blocked" | "crash" | "partial") => void; removes: (paths: string[]) => void;
  stage: (a: "ok" | "post-fail" | "post-pending" | "post-refuse" | "append-fail" | "append-crash" | "buffered") => void;
} {
  const root = tempDir("tk-sup-plansync-");
  const lib = join(root, "plugins", "tk-studio", "lib");
  mkdirSync(lib, { recursive: true });
  const log = join(root, "plansync-calls.jsonl"), answers = join(root, "plansync-answer.txt"), syncAnswer = join(root, "plansync-sync.txt");
  const removals = join(root, "plansync-removes.json"), stageAnswer = join(root, "plansync-stage.txt");
  writeFileSync(removals, "[]");
  writeFileSync(stageAnswer, "ok");
  writeFileSync(answers, "ok");
  writeFileSync(syncAnswer, "ok");
  writeFileSync(join(lib, "plansync.py"), [
    "import json, os, re, sys",
    `with open(${JSON.stringify(log)}, "a", encoding="utf-8") as f: f.write(json.dumps(sys.argv[1:]) + "\\n")`,
    `answer = open(${JSON.stringify(answers)}, encoding="utf-8").read().strip()`,
    "a = sys.argv[1:]",
    "arg = lambda k: a[a.index(k) + 1] if k in a else None",
    `if a and a[0] in ("normalize", "sync"):`,
    `    how = open(${JSON.stringify(syncAnswer)}, encoding="utf-8").read().strip() if a[0] == "sync" else "ok"`,
    `    if how == "blocked": print(json.dumps({"ok": False, "blocked": True, "reason": "fake sync blocked", "written": []})); sys.exit(2)`,
    `    if how == "crash": print("Traceback (most recent call last):\\n  OSError: plan directory busy", file=sys.stderr); sys.exit(1)`,
    "    d = os.path.abspath(arg('--directory'))",
    "    plan = os.path.join(d, '_bmad-output', 'planning-artifacts', 'plan')",
    "    counter = os.path.join(d, '.tk-studio', 'plan-counter.yaml')",
    "    ctext = open(counter, encoding='utf-8').read()",
    "    nxt = int(re.search(r'^  epic: (\\d+)$', ctext, re.M).group(1))",
    "    os.makedirs(plan, exist_ok=True)",
    "    named = set()",
    "    for n in os.listdir(plan):",
    "        m = re.search(r'^source: epics\\.md#epic-(\\d+)$', open(os.path.join(plan, n), encoding='utf-8').read(), re.M)",
    "        if m: named.add(int(m.group(1)))",
    "    epics = open(os.path.join(d, '_bmad-output', 'planning-artifacts', 'epics.md'), encoding='utf-8').read()",
    "    written = []",
    "    for m in re.finditer(r'^## Epic (\\d+): (.+)$', epics, re.M):",
    "        if int(m.group(1)) in named: continue",
    "        ep = 'EP-%03d' % nxt",
    "        path = os.path.join(plan, ep + '.md')",
    "        open(path, 'w', encoding='utf-8', newline='').write('---\\nshape_version: 1\\nid: %s\\ntype: epic\\ntitle: %s\\nstatus: planned\\nsource: epics.md#epic-%s\\n---\\n' % (ep, m.group(2), m.group(1)))",
    "        written.append(path)",
    "        nxt += 1",
    "    if written:",
    "        open(counter, 'w', encoding='utf-8', newline='').write(re.sub(r'^  epic: \\d+$', '  epic: %d' % nxt, ctext, flags=re.M))",
    "        written.append(counter)",
    "    removed = []",
    `    for rel in json.load(open(${JSON.stringify(removals)}, encoding="utf-8")):`,
    "        q = os.path.join(d, rel)",
    "        if os.path.exists(q): os.remove(q); removed.append(q)",
    "    out = {'ok': True, 'written': written, **({'removed': removed} if removed else {})}",
    "    if how == 'partial': out.update(ok=False, blocked=True, reason='fake sync partial'); print(json.dumps(out)); sys.exit(2)",
    "    print(json.dumps(out)); sys.exit(0)",
    `if a and a[0] in ("stage", "stage-post"):`,
    `    how = open(${JSON.stringify(stageAnswer)}, encoding="utf-8").read().strip()`,
    `    if a[0] == "stage":`,
    `        if how == "append-fail": print(json.dumps({"ok": False, "error": "fake stage refused", "status": "blocked"})); sys.exit(2)`,
    `        if how == "append-crash": print("Traceback (most recent call last):\\n  OSError: disk busy", file=sys.stderr); sys.exit(1)`,
    "        rows = json.loads(arg('--row-json') or '[]')",
    `        print(json.dumps({"ok": True, "appended": len(rows) if isinstance(rows, list) else 1, **({"buffered": True} if how == "buffered" else {}), "status": "complete"})); sys.exit(0)`,
    `    if how == "post-fail": print(json.dumps({"ok": False, "posted": {"start": 0, "stop": 0, "worklog": 0, "found": 0}, "unposted": 4, "retryable": True, "reason": "stage-post failed: Jira answered 503", "status": "blocked"})); sys.exit(2)`,
    `    if how == "post-pending": print(json.dumps({"ok": False, "posted": {"start": 1, "stop": 0, "worklog": 0, "found": 0}, "unposted": 1, "retryable": True, "reason": "stage-post pending: 1 row(s) not yet posted", "status": "partial"})); sys.exit(2)`,
    `    if how == "post-refuse": print(json.dumps({"ok": False, "posted": {"start": 0, "stop": 0, "worklog": 0, "found": 0}, "unposted": 4, "reason": "stage-post: ST-097 carries no external.jira.key", "status": "blocked"})); sys.exit(2)`,
    `    print(json.dumps({"ok": True, "posted": {"start": 4, "stop": 4, "worklog": 4, "found": 0}, "unposted": 0, "status": "complete"})); sys.exit(0)`,
    `if answer == "ok": print(json.dumps({"ok": True, "id": arg("--id"), "status": arg("--status"), "previous_status": "draft"})); sys.exit(0)`,
    `if answer == "blocked": print(json.dumps({"ok": False, "blocked": True, "reason": "backend re-sync blocked", "written": True})); sys.exit(2)`,
    `if answer == "crash": print("Traceback (most recent call last):\\n  OSError: plan directory busy", file=sys.stderr); sys.exit(1)`,
    `print(json.dumps({"ok": False, "error": "unknown status entity " + str(arg("--id"))})); sys.exit(2)`,
  ].join("\n"));
  return {
    root,
    calls: () => existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    answer: (a) => writeFileSync(answers, a),
    sync: (a) => writeFileSync(syncAnswer, a),
    removes: (paths) => writeFileSync(removals, JSON.stringify(paths)),
    stage: (a) => writeFileSync(stageAnswer, a),
  };
}

/** The fake `gh` (GH_BIN): records `{argv, cwd, gh_repo}` (its `GH_REPO`) per call to its log — and `body`, the
 * content of a `--body-file` read at call time — and answers from a JSON file (rewritable between calls):
 * `repo view` → the default branch; `api repos/{owner}/{repo}/branches/<b>` → `{protected}` (`protected`
 * names the protected branches); `pr list` → `[{url}]` for each of `open` (the open PRs from the head
 * branch; none by default); `pr create` → the PR URL, refused as gh does while `open` names one;
 * `pr ready` (and `pr ready <pr> --undo`) → ok; `pr edit` → the PR URL (Story 27.4); `pr view <pr> --json state,mergedAt` →
 * `{state: view, mergedAt}` (Story 27.5: `OPEN` by default). `fail` names the subcommands (`"pr create"`, `"api"`, …) that exit 1. Never the network. */
type GhAnswers = { default?: string; protected?: string[]; pr?: string; open?: string[]; fail?: string[]; view?: "OPEN" | "MERGED" | "CLOSED" };
export function fakeGh(dir: string = tempDir("tk-sup-gh-")): {
  bin: string; calls: () => { argv: string[]; cwd: string; gh_repo: string | null; body?: string }[];
  answer: (a: GhAnswers) => void;
} {
  const log = join(dir, "gh-calls.jsonl"), answers = join(dir, "gh-answers.json");
  const set = (a: GhAnswers) =>
    writeFileSync(answers, JSON.stringify({ default: "main", protected: ["main"], pr: "https://github.com/acme/widget/pull/42", open: [], fail: [], view: "OPEN", ...a }));
  set({});
  const bin = fakeBin(join(dir, "gh.js"), `const fs = require("node:fs");
const argv = process.argv.slice(2);
const bf = argv.indexOf("--body-file");
const body = bf >= 0 ? fs.readFileSync(argv[bf + 1], "utf-8") : undefined;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, cwd: process.cwd(), gh_repo: process.env.GH_REPO ?? null, ...(body !== undefined ? { body } : {}) }) + "\\n");
const a = JSON.parse(fs.readFileSync(${JSON.stringify(answers)}, "utf-8"));
const sub = argv[0] === "api" ? "api" : argv.slice(0, 2).join(" ");
if (a.fail.includes(sub)) { console.error("fake gh: " + sub + " failed"); process.exit(1); }
if (sub === "repo view") { console.log(JSON.stringify({ defaultBranchRef: { name: a.default } })); process.exit(0); }
if (sub === "api") {
  const m = /^repos\\/\\{owner\\}\\/\\{repo\\}\\/branches\\/(.+)$/.exec(argv[1] ?? "");
  if (!m) { console.error("fake gh: unknown api path"); process.exit(1); }
  console.log(JSON.stringify({ name: m[1], protected: a.protected.includes(m[1]) })); process.exit(0);
}
if (sub === "pr list") { console.log(JSON.stringify(a.open.map((url) => ({ url })))); process.exit(0); }
if (sub === "pr create") {
  if (a.open.length) { console.error("a pull request for branch already exists: " + a.open[0]); process.exit(1); }
  console.log(a.pr); process.exit(0);
}
if (sub === "pr ready") { console.log("ready"); process.exit(0); }
if (sub === "pr edit") { console.log(argv[2]); process.exit(0); }
if (sub === "pr view") { console.log(JSON.stringify({ state: a.view, mergedAt: a.view === "MERGED" ? "2026-10-16T00:00:00Z" : null })); process.exit(0); }
console.error("fake gh: unsupported " + argv.join(" ")); process.exit(2);
`);
  return {
    bin,
    calls: () => existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    answer: set,
  };
}

// ------------------------------------------------------------ Story 27.2: the sandbox fake

/** One in-VM process the fake `sbx` knows: its start time (`/proc/<pid>/stat` field 22), its state, and which
 * signal to its process group ends it (`never`: it survives TERM and KILL). */
export type FakeProc = { start: string; state?: string; dies_on?: "TERM" | "KILL" | "never" };
type SbxAnswers = {
  pin?: "ok" | "fail" | "fail-after-stop"; stop?: "ok" | "fail"; procs?: Record<string, FakeProc>; pgrep?: string[]; sessions?: string[];
  /** Story 27.3: the VM home (`printenv HOME`), the in-VM `bmad-loop archive|resolve` answers, and the
   * `engine.pid` line a resolve writes (none: not rewritten). */
  home?: string; archive?: "ok" | "fail"; resolve?: "ok" | "fail"; resume_pid?: string | null;
  /** Hole 38: what the in-VM `uv run …/launch.py status` prints (a JSON object), or `"fail"` (exit 2, no JSON). */
  launch_status?: Record<string, unknown> | "fail";
  /** Story 33.3: the `sbx ls` rows, sandbox → status (`running`/`stopped`; none: the header alone), or `"fail"` (exit 1).
   * `stop <sb>` makes a listed sandbox `stopped` and a successful `run -d --name <sb>` makes it `running`. */
  ls?: Record<string, string> | "fail";
  /** Story 33.3: the answers to `exec <sb> env -u ANTHROPIC_API_KEY claude auth status --json`, consumed one per call;
   * the last one stays (`in`: logged in with claude.ai on the max subscription, `out`: loggedIn false). Story 39.2: an
   * object is printed verbatim, `fail` exits 1, `garbage` prints no JSON. */
  auth?: ("in" | "out" | "fail" | "garbage" | Record<string, unknown>)[];
  /** Story 39.2: `exec <sb> cat /home/agent/.claude/.credentials.json` — an object printed verbatim (a fake credential
   * file, its `accessToken` included), `fail` (No such file, exit 1; the default) or `garbage` (no JSON). */
  creds?: Record<string, unknown> | "fail" | "garbage";
  /** Story 39.2: the in-sandbox `claude auth login --claudeai` the tmux login sessions run. `url_after`: the captures
   * before the sign-in URL shows (default 0); `url: "none"` never prints one; `base`: `com` (the installed binary's
   * `claude.com/cai`, default) or `ai`; `start: "fail"` fails `new-session`; `outcomes`: per Enter after a paste, consumed
   * in order (`ok`: `Login successful.`, exit 0; `refused`: `Login failed: …`, exit 1; `invalid`: `Invalid code. …`, still
   * waiting; `hang`: nothing); `respawn: "no-url"`: a respawned login prints no URL. */
  login?: { url_after?: number; url?: "none"; base?: "com" | "ai"; start?: "fail"; outcomes?: ("ok" | "refused" | "invalid" | "hang")[]; respawn?: "no-url" };
  /** Story 39.2: the fake's tmux login sessions by name (its own state; tests read it through `answers()`). */
  tmux?: Record<string, { captures: number; lines: string[]; dead: boolean; status: number | null; buffer: string | null; typed: string | null; n: number; url_after: number; no_url?: boolean }>;
};

/** The fake `sbx` (SBX_BIN): records `{argv}` per call to its log and answers from a JSON file (rewritable
 * between calls; a kill rewrites it): `run -d --name <sb>` → the pin (`pin: fail` exits 1; `pin: fail-after-stop` exits 1
 * only once a `stop` succeeded); `stop <sb>` → the
 * release; `exec <sb> cat /proc/<pid>/stat` → a stat line for a known process (field 22 its start), else
 * "No such file or directory"; `exec <sb> kill -<SIG> -- -<pid>` → ends the process when `dies_on` says so;
 * `exec <sb> pgrep -a -f …` → the `pgrep` lines (none: exit 1); `exec <sb> tail --pid=<pid> -f /dev/null` →
 * exits at once; `exec <sb> tmux kill-session -t =<name>` → ends a session `sessions` names, else "can't find
 * session" (exit 1); `exec <sb> printenv HOME` → `home`;
 * Story 33.3: `ls` → the `SANDBOX AGENT STATUS` header and the `ls` rows; `exec <sb> env -u ANTHROPIC_API_KEY claude auth
 * status --json` → the next `auth` answer; `exec <sb> <home>/.local/bin/bmad-loop archive --project <p>
 * <id>` → moves `<p>/.bmad-loop/runs/<id>` to `<p>/.bmad-loop/archive/<id>` (`archive: fail` exits 1);
 * `exec <sb> <home>/.local/bin/bmad-loop resolve --project <p> --no-interactive --resume [--restore-patch <x>] <id>`
 * → writes `resume_pid` to the run's `engine.pid` when given (`resolve: fail` exits 1). A VM path `/<d>/…` is
 * read as the host's `<D>:/…` on win32. Anything else exits 2. Never a real sandbox. */
export function fakeSbx(dir: string = tempDir("tk-sup-sbx-")): {
  bin: string; calls: () => { argv: string[] }[]; answer: (a: SbxAnswers) => void; answers: () => Required<SbxAnswers>;
  /** Story 39.2: what each `exec -i` call carried on stdin. */
  stdin: () => { argv: string[]; stdin: string }[];
} {
  const log = join(dir, "sbx-calls.jsonl"), answers = join(dir, "sbx-answers.json"), stdinLog = join(dir, "sbx-stdin.jsonl");
  const set = (a: SbxAnswers) => writeFileSync(answers, JSON.stringify({
    pin: "ok", stop: "ok", procs: {}, pgrep: [], sessions: [], home: "/home/agent", archive: "ok", resolve: "ok", resume_pid: null,
    launch_status: { ok: true, runs: [], live: [] }, ls: {}, auth: ["in"], creds: "fail", login: {}, tmux: {}, ...a,
  }));
  set({});
  const bin = fakeBin(join(dir, "sbx.js"), `const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv }) + "\\n");
const file = ${JSON.stringify(answers)};
const a = JSON.parse(fs.readFileSync(file, "utf-8"));
if (argv[0] === "run" && argv[1] === "-d" && argv[2] === "--name" && argv[3]) {
  if (a.pin === "fail" || (a.pin === "fail-after-stop" && a.stopped)) { console.error("fake sbx: sandbox " + argv[3] + " could not start"); process.exit(1); }
  if (a.ls !== "fail" && a.ls[argv[3]] !== undefined) { a.ls[argv[3]] = "running"; fs.writeFileSync(file, JSON.stringify(a)); }
  process.exit(0);
}
if (argv[0] === "stop" && argv[1]) {
  if (a.stop === "fail") { console.error("fake sbx: sandbox " + argv[1] + " could not stop"); process.exit(1); }
  if (a.ls !== "fail" && a.ls[argv[1]] !== undefined) { a.ls[argv[1]] = "stopped"; fs.writeFileSync(file, JSON.stringify(a)); }
  if (a.pin === "fail-after-stop") { a.stopped = true; fs.writeFileSync(file, JSON.stringify(a)); }
  process.exit(0);
}
if (argv[0] === "ls" && argv.length === 1) {
  if (a.ls === "fail") { console.error("fake sbx: daemon not running"); process.exit(1); }
  console.log("SANDBOX   AGENT   STATUS");
  for (const [sb, status] of Object.entries(a.ls)) console.log(sb + "   claude   " + status);
  process.exit(0);
}
if (argv[0] !== "exec" || !argv[1]) { console.error("fake sbx: unsupported " + argv.join(" ")); process.exit(2); }
// Story 39.2: \`exec -i <sb> …\` keeps stdin open; what it carried is recorded beside the argv log, never in it.
const interactive = argv[1] === "-i";
if (interactive) argv.splice(1, 1);
const stdin = interactive ? fs.readFileSync(0, "utf-8") : null;
if (interactive) fs.appendFileSync(${JSON.stringify(stdinLog)}, JSON.stringify({ argv: ["exec", "-i", ...argv.slice(1)], stdin }) + "\\n");
const cmd = argv.slice(2);
if (cmd.join(" ") === "env -u ANTHROPIC_API_KEY claude auth status --json") {
  const answer = a.auth.length > 1 ? a.auth.shift() : a.auth[0];
  fs.writeFileSync(file, JSON.stringify(a));
  if (answer === "fail") { console.error("fake claude: auth status failed"); process.exit(1); }
  if (answer === "garbage") { console.log("not json"); process.exit(0); }
  console.log(JSON.stringify(typeof answer === "object" ? answer : answer === "out" ? { loggedIn: false } : { loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" })); process.exit(0);
}
if (cmd[0] === "cat" && cmd[1] === "/home/agent/.claude/.credentials.json" && cmd.length === 2) {
  if (a.creds === "fail") { console.error("cat: " + cmd[1] + ": No such file or directory"); process.exit(1); }
  if (a.creds === "garbage") { console.log("{not json"); process.exit(0); }
  console.log(JSON.stringify(a.creds)); process.exit(0);
}
if (cmd[0] === "tmux" && ["new-session", "capture-pane", "display-message", "load-buffer", "paste-buffer", "send-keys", "respawn-pane", "clear-history"].includes(cmd[1])) {
  const L = a.login || {}, T = a.tmux;
  const save = () => fs.writeFileSync(file, JSON.stringify(a));
  const url = (n) => "https://" + (L.base === "ai" ? "claude.ai" : "claude.com/cai") + "/oauth/authorize?code=true&client_id=fake-client&response_type=code"
    + "&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=CHALLENGE" + n + "&code_challenge_method=S256&state=STATE" + n;
  const at = (flag) => cmd[cmd.indexOf(flag) + 1];
  const target = (t) => /^=tk-login-[0-9a-f]{12}:$/.test(t || "") ? t.slice(1, -1) : null;
  if (cmd[1] === "new-session") {
    const S = at("-s");
    const want = ["tmux", "new-session", "-d", "-s", S, "-x", "1000", "-y", "50", "env", "-u", "ANTHROPIC_API_KEY", "claude", "auth", "login", "--claudeai", ";", "set-option", "-t", "=" + S + ":", "remain-on-exit", "on"];
    if (cmd.join("\\u0001") !== want.join("\\u0001")) { console.error("fake sbx: unexpected new-session " + cmd.join(" ")); process.exit(2); }
    if (L.start === "fail") { console.error("fake tmux: no server running"); process.exit(1); }
    T[S] = { captures: 0, lines: ["Opening browser to sign in\\u2026"], dead: false, status: null, buffer: null, typed: null, n: 1, url_after: L.url_after || 0, no_url: L.url === "none" };
    a.sessions.push(S); save(); process.exit(0);
  }
  const S = target(at("-t")) || (cmd[1] === "load-buffer" ? at("-b") : null);
  const t = S ? T[S] : undefined;
  if (!t) { console.error("can't find session: " + (S || at("-t"))); process.exit(1); }
  if (cmd[1] === "capture-pane") {
    if (cmd.join(" ") !== "tmux capture-pane -p -J -S - -t =" + S + ":") { console.error("fake sbx: unexpected capture " + cmd.join(" ")); process.exit(2); }
    t.captures++;
    if (!t.no_url && t.captures > t.url_after && !t.lines.some((l) => l.includes("/oauth/authorize?"))) t.lines.push("If the browser didn't open, visit: " + url(t.n), "Paste code here if prompted > ");
    save(); console.log(t.lines.join("\\n")); process.exit(0);
  }
  if (cmd[1] === "display-message") { console.log((t.dead ? "1" : "0") + " " + (t.status === null ? "" : t.status)); process.exit(0); }
  if (cmd[1] === "load-buffer") {
    if (!interactive || cmd.join(" ") !== "tmux load-buffer -b " + S + " -") { console.error("fake sbx: load-buffer without stdin"); process.exit(2); }
    t.buffer = stdin; save(); process.exit(0);
  }
  if (cmd[1] === "paste-buffer") { if (t.buffer === null) { console.error("no buffer " + S); process.exit(1); } t.typed = t.buffer; t.buffer = null; save(); process.exit(0); }
  if (cmd[1] === "send-keys") {
    if (cmd[cmd.length - 1] !== "Enter" || cmd.length !== 5) { console.error("fake sbx: send-keys carries only Enter"); process.exit(2); }
    const typed = t.typed || ""; t.typed = null;
    t.lines.push("Paste code here if prompted > " + typed);
    const outcome = (L.outcomes || []).length ? L.outcomes.shift() : "ok";
    if (outcome === "ok") { t.lines.push("Login successful."); t.dead = true; t.status = 0; }
    else if (outcome === "refused") { t.lines.push("Login failed: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt. Sign in again to get a new code."); t.dead = true; t.status = 1; }
    else if (outcome === "invalid") t.lines.push("Invalid code. Please make sure the full code was copied.");
    save(); process.exit(0);
  }
  if (cmd[1] === "clear-history") { t.lines = []; save(); process.exit(0); }
  if (cmd[1] === "respawn-pane") {
    if (cmd.slice(5).join(" ") !== "env -u ANTHROPIC_API_KEY claude auth login --claudeai" || cmd[2] !== "-k") { console.error("fake sbx: unexpected respawn " + cmd.join(" ")); process.exit(2); }
    t.n++; t.dead = false; t.status = null; t.captures = 0; t.lines = ["Opening browser to sign in\\u2026"]; t.no_url = L.respawn === "no-url"; save(); process.exit(0);
  }
}
if (cmd[0] === "cat" && /^\\/proc\\/\\d+\\/stat$/.test(cmd[1] ?? "") && cmd.length === 2) {
  const pid = cmd[1].split("/")[2], p = a.procs[pid];
  if (!p) { console.error("cat: " + cmd[1] + ": No such file or directory"); process.exit(1); }
  const fields = [p.state ?? "S", "1", pid, pid, "0", "-1", "4194304", "0", "0", "0", "0", "1", "1", "0", "0", "20", "0", "1", "0", p.start];
  console.log(pid + " (bmad-loop) " + fields.join(" ") + " 1 1 1");
  process.exit(0);
}
if (cmd[0] === "kill" && /^-(TERM|KILL)$/.test(cmd[1] ?? "") && cmd[2] === "--" && /^-\\d+$/.test(cmd[3] ?? "") && cmd.length === 4) {
  const sig = cmd[1].slice(1), pid = cmd[3].slice(1), p = a.procs[pid];
  if (!p) { console.error("kill: (" + pid + ") - No such process"); process.exit(1); }
  if (p.dies_on === sig || (sig === "KILL" && p.dies_on !== "never")) { delete a.procs[pid]; fs.writeFileSync(file, JSON.stringify(a)); }
  process.exit(0);
}
if (cmd[0] === "pgrep" && cmd[1] === "-a" && cmd[2] === "-f" && cmd.length === 4) {
  if (!a.pgrep.length) process.exit(1);
  console.log(a.pgrep.join("\\n")); process.exit(0);
}
if (cmd[0] === "tmux" && cmd[1] === "kill-session" && cmd[2] === "-t" && /^=/.test(cmd[3] ?? "") && cmd.length === 4) {
  const name = cmd[3].slice(1), i = a.sessions.indexOf(name);
  if (i < 0) { console.error("can't find session: " + name); process.exit(1); }
  a.sessions.splice(i, 1); if (a.tmux) delete a.tmux[name]; fs.writeFileSync(file, JSON.stringify(a)); process.exit(0);
}
if (cmd[0] === "tail" && /^--pid=\\d+$/.test(cmd[1] ?? "") && cmd[2] === "-f" && cmd[3] === "/dev/null" && cmd.length === 4) process.exit(0);
if (cmd[0] === "printenv" && cmd[1] === "HOME" && cmd.length === 2) { console.log(a.home); process.exit(0); }
if (cmd[0] === "uv" && cmd[1] === "run" && /\\/launch\\.py$/.test(cmd[2] ?? "") && cmd[3] === "status" && cmd[4] === "--directory"
  && (cmd.length === 6 || (cmd.length === 8 && cmd[6] === "--run-id"))) {
  if (a.launch_status === "fail") { console.error("fake launch.py: bmad-loop list failed (exit 2)"); process.exit(2); }
  console.log(JSON.stringify(a.launch_status)); process.exit(0);
}
const host = (p) => process.platform === "win32" && /^\\/[a-z](\\/|$)/.test(p) ? p[1].toUpperCase() + ":" + (p.slice(2) || "/") : p;
if (cmd[0] === a.home + "/.local/bin/bmad-loop" && cmd[1] === "archive" && cmd[2] === "--project" && cmd.length === 5) {
  if (a.archive === "fail") { console.error("fake bmad-loop: archive refused"); process.exit(1); }
  const runs = require("node:path").join(host(cmd[3]), ".bmad-loop"), from = runs + "/runs/" + cmd[4];
  if (!fs.existsSync(from)) { console.error("no run " + cmd[4]); process.exit(1); }
  fs.mkdirSync(runs + "/archive", { recursive: true }); fs.renameSync(from, runs + "/archive/" + cmd[4]); // win-ok: a fake; each run id is archived once
  console.log("run " + cmd[4] + " archived"); process.exit(0);
}
if (cmd[0] === a.home + "/.local/bin/bmad-loop" && cmd[1] === "resolve" && cmd[2] === "--project" && cmd[4] === "--no-interactive" && cmd[5] === "--resume"
  && (cmd.length === 7 || (cmd.length === 9 && cmd[6] === "--restore-patch"))) {
  if (a.resolve === "fail") { console.error("fake bmad-loop: resolve refused"); process.exit(1); }
  if (a.resume_pid) fs.writeFileSync(host(cmd[3]) + "/.bmad-loop/runs/" + cmd[cmd.length - 1] + "/engine.pid", a.resume_pid);
  process.exit(0);
}
console.error("fake sbx: unsupported exec " + cmd.join(" ")); process.exit(2);
`);
  return {
    bin,
    calls: () => existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
    answer: set,
    answers: () => JSON.parse(readFileSync(answers, "utf-8")),
    stdin: () => existsSync(stdinLog) ? readFileSync(stdinLog, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [],
  };
}

type Git = (cwd: string, ...args: string[]) => string;

/** git with a fixed test identity, failing loudly. */
export const testGit: Git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stdout}${r.stderr}`);
  return r.stdout.trim();
};

/** The engine's untracked runtime, ignored as in a studio project. */
export const RUNTIME_GITIGNORE = ".bmad-loop/policy.toml\n.bmad-loop/routing.current.json\n.bmad-loop/runs/\n.tk-studio/config.local.yaml\n_bmad/render/\n";

/** Make the existing folder `checkout` a git repository on `main` (its files, plus `files`, committed)
 * with a bare `origin` beside it, pushed (so `refs/remotes/origin/main` exists: a PR base on origin), its
 * `origin/HEAD` set to `main`. A test basing a run on another branch pushes it too. Answers the origin path. */
export function gitInit(checkout: string, files: Record<string, string> = {}): string {
  const origin = tempDir("tk-sup-origin-");
  testGit(origin, "init", "-q", "--bare", "-b", "main");
  testGit(checkout, "init", "-q", "-b", "main");
  for (const [rel, content] of Object.entries(files)) { mkdirSync(dirname(join(checkout, rel)), { recursive: true }); writeFileSync(join(checkout, rel), content); }
  testGit(checkout, "add", "-A");
  testGit(checkout, "commit", "-q", "--allow-empty", "-m", "init");
  testGit(checkout, "remote", "add", "origin", origin);
  testGit(checkout, "push", "-q", "origin", "main");
  testGit(checkout, "remote", "set-head", "origin", "main");
  return origin;
}

/** Story 38.5 (CAP-14): the untracked engine policy every fixture checkout holds by default (a run worktree with none is
 * refused `worktree policy: none in the checkout`), already reading the rollback the run worktree needs. */
export const FIXTURE_POLICY = "[scm]\nrollback_on_failure = true\n";

/** A throwaway git repository (`gitInit`) with the runtime `.gitignore` and the files given. Story 38.5 (CAP-14): plus the
 * untracked `.bmad-loop/policy.toml` (`FIXTURE_POLICY`; `policy: false` opts out, a string replaces it). */
export function gitRepo(files: Record<string, string> = {}, opts: { policy?: string | false } = {}): { checkout: string; origin: string; git: Git } {
  const checkout = join(tempDir("tk-sup-repo-"), "checkout");
  mkdirSync(checkout, { recursive: true });
  const origin = gitInit(checkout, { ".gitignore": RUNTIME_GITIGNORE, ...files });
  if (opts.policy !== false) {
    mkdirSync(join(checkout, ".bmad-loop"), { recursive: true });
    writeFileSync(join(checkout, ".bmad-loop", "policy.toml"), opts.policy ?? FIXTURE_POLICY); // gitignored: untracked
  }
  return { checkout, origin, git: testGit };
}

/** Story 38.1 (AC1): the host leg's guard, one table pinned through all three of its callers (the close-out's sweep tail in
 * worktree.test.ts, its boundary leg in closeout.test.ts, the re-run in hostleg.test.ts). Each row's leg runs a hanging
 * command (it prints no suite line, so it stays red) under `worker_guard_s` 50 and the row's definition `guards`. */
export const LEG_GUARD_ROWS: readonly { name: string; workerGuardS: number; guards: Record<string, number>; trip: string }[] = [
  { name: "the leg's own `host_verify_seconds` wins over the worker's and the engine's", workerGuardS: 50,
    guards: { max_wall_clock_seconds: 50, host_verify_seconds: 1 }, trip: "guard: host_verify_seconds (1s)" },
  { name: "a definition snapshot taken before 38.1: `max_wall_clock_seconds`", workerGuardS: 50,
    guards: { max_wall_clock_seconds: 1 }, trip: "guard: max_wall_clock_seconds (1s)" },
];
