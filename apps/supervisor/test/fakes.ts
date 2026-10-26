// Test-side fake executables, shared by the end-to-end suites.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** win32 only: the launcher every fake there is a hard link of. Compiled once per bun build and cached in
 * the temp dir. It runs `bun <its own name>.js <args>` with the terminal inherited, answers that exit code,
 * and hands its own parent's pid on as FAKE_PARENT_PID (the fake's parent is the launcher, not the supervisor). */
export function fakeLauncher(): string {
  const exe = join(tmpdir(), `tk-sup-fake-launcher-${Bun.version}-${Bun.hash(process.execPath).toString(16)}.exe`);
  if (existsSync(exe)) return exe;
  const dir = mkdtempSync(join(tmpdir(), "tk-sup-launcher-"));
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
  try { renameSync(built, exe); } catch { if (!existsSync(exe)) copyFileSync(built, exe); } // another test file won the race
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
  const root = mkdtempSync(join(tmpdir(), "tk-sup-studio-"));
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
 * paths>]` (only when one was deleted). */
export function fakePlansync(): {
  root: string; calls: () => string[][]; answer: (a: "ok" | "refuse" | "blocked" | "crash") => void;
  sync: (a: "ok" | "blocked" | "crash" | "partial") => void; removes: (paths: string[]) => void;
} {
  const root = mkdtempSync(join(tmpdir(), "tk-sup-plansync-"));
  const lib = join(root, "plugins", "tk-studio", "lib");
  mkdirSync(lib, { recursive: true });
  const log = join(root, "plansync-calls.jsonl"), answers = join(root, "plansync-answer.txt"), syncAnswer = join(root, "plansync-sync.txt");
  const removals = join(root, "plansync-removes.json");
  writeFileSync(removals, "[]");
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
export function fakeGh(dir: string = mkdtempSync(join(tmpdir(), "tk-sup-gh-"))): {
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
   * the last one stays (`in`: logged in with claude.ai, `out`: loggedIn false). */
  auth?: ("in" | "out")[];
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
export function fakeSbx(dir: string = mkdtempSync(join(tmpdir(), "tk-sup-sbx-"))): {
  bin: string; calls: () => { argv: string[] }[]; answer: (a: SbxAnswers) => void; answers: () => Required<SbxAnswers>;
} {
  const log = join(dir, "sbx-calls.jsonl"), answers = join(dir, "sbx-answers.json");
  const set = (a: SbxAnswers) => writeFileSync(answers, JSON.stringify({
    pin: "ok", stop: "ok", procs: {}, pgrep: [], sessions: [], home: "/home/agent", archive: "ok", resolve: "ok", resume_pid: null,
    launch_status: { ok: true, runs: [], live: [] }, ls: {}, auth: ["in"], ...a,
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
const cmd = argv.slice(2);
if (cmd.join(" ") === "env -u ANTHROPIC_API_KEY claude auth status --json") {
  const answer = a.auth.length > 1 ? a.auth.shift() : a.auth[0];
  fs.writeFileSync(file, JSON.stringify(a));
  console.log(JSON.stringify(answer === "out" ? { loggedIn: false } : { loggedIn: true, authMethod: "claude.ai" })); process.exit(0);
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
  a.sessions.splice(i, 1); fs.writeFileSync(file, JSON.stringify(a)); process.exit(0);
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
  fs.mkdirSync(runs + "/archive", { recursive: true }); fs.renameSync(from, runs + "/archive/" + cmd[4]);
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
  const origin = mkdtempSync(join(tmpdir(), "tk-sup-origin-"));
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

/** A throwaway git repository (`gitInit`) with the runtime `.gitignore` and the files given. */
export function gitRepo(files: Record<string, string> = {}): { checkout: string; origin: string; git: Git } {
  const checkout = join(mkdtempSync(join(tmpdir(), "tk-sup-repo-")), "checkout");
  mkdirSync(checkout, { recursive: true });
  const origin = gitInit(checkout, { ".gitignore": RUNTIME_GITIGNORE, ...files });
  return { checkout, origin, git: testGit };
}
