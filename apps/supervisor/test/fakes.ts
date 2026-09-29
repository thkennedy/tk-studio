// Test-side fake executables, shared by the end-to-end suites.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
