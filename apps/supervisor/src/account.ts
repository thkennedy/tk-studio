/**
 * The owner's one account (Story 29.1; D7, D8): a username and an argon2id password hash, created on the first
 * visit, stored only in the per-user store (AD-3):
 *
 *   <TK_STUDIO_HOME or ~/.tk-studio>/supervisor/account.json   {username, hash, created_at}
 *
 * never in a checkout, never in the queue file. The lockout is derived from the queue's `service_events` rows
 * (`signin-refused`, `account-locked`), so it survives a restart without a field in `account.json`. No HTTP here
 * (`api.ts` answers the routes). Nothing in this module logs; no error carries a password, a hash or the file's
 * content. The reset is deleting `account.json`: the next visit creates the account again.
 */
import { randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PASSWORD_MIN, safeEqual, USERNAME_RE } from "./auth";
import { studioHome } from "./env";
import type { Queue } from "./queue";

type Env = Record<string, string | undefined>;

/** Five refused sign-ins inside the window lock the account. */
export const LOCKOUT_FAILURES = 5;
/** The window the refusals are counted over: 15 minutes. */
export const LOCKOUT_WINDOW_MS = 15 * 60_000;
/** How long a lockout lasts: 15 minutes. */
export const LOCKOUT_MS = 15 * 60_000;
/** The fixed delay before a mismatch answers (SPEC assumption; injectable in `createApi`). */
export const SIGNIN_DELAY_MS = 500;

/** The store-relative path errors name (never the content). */
export const ACCOUNT_RELATIVE_PATH = "supervisor/account.json";
const RELATIVE = ACCOUNT_RELATIVE_PATH;

export interface AccountRecord { username: string; hash: string; created_at: string }

/** `account.json` exists but is not `{username, hash, created_at}`: never read as "no account". */
export class AccountRecordInvalid extends Error {
  constructor() {
    super(`AccountRecordInvalid: ${RELATIVE} in the studio store is not an account record — delete it from the console to create the account again`);
    this.name = "AccountRecordInvalid";
  }
}

/** The account already exists (a second creation). */
export class AccountExists extends Error {
  constructor() {
    super("AccountExists: the account already exists — sign in, or delete account.json from the console to reset it");
    this.name = "AccountExists";
  }
}

/** A field failed its check: names the field, never its value. */
export class AccountInvalid extends Error {
  constructor(readonly field: "username" | "password") {
    super(field === "username"
      ? "AccountInvalid: username must be 3 to 64 characters: letters, digits, -, _ or ."
      : `AccountInvalid: password must be at least ${PASSWORD_MIN} characters`);
    this.name = "AccountInvalid";
  }
}

/** Where the record lives: `<studio store>/supervisor/account.json`. */
export function accountPath(env: Env = process.env): string {
  return join(studioHome(env), "supervisor", "account.json");
}

/** The record, or null when the file is absent. A file that is not the record is AccountRecordInvalid. Read per
 * request: deleting the file (the reset) needs no restart. */
export function readAccount(env: Env = process.env, path: string = accountPath(env)): AccountRecord | null {
  let text: string;
  try { text = readFileSync(path, "utf-8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new AccountRecordInvalid();
  }
  let p: unknown;
  try { p = JSON.parse(text); } catch { throw new AccountRecordInvalid(); }
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new AccountRecordInvalid();
  const r = p as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(",");
  if (keys !== "created_at,hash,username" || typeof r.username !== "string" || typeof r.hash !== "string" || typeof r.created_at !== "string") {
    throw new AccountRecordInvalid();
  }
  return { username: r.username, hash: r.hash, created_at: r.created_at };
}

/** The field checks: the username's pattern, the password's length (nothing else). */
export function checkAccountFields(username: unknown, password: unknown): { username: string; password: string } {
  if (typeof username !== "string" || !USERNAME_RE.test(username)) throw new AccountInvalid("username");
  if (typeof password !== "string" || [...password].length < PASSWORD_MIN) throw new AccountInvalid("password");
  return { username, password };
}

/** Create the account once: validated, refused when the file exists (AccountExists), the password hashed with
 * `Bun.password` (argon2id, the default cost), written to a temp file and then placed exclusively with
 * `linkSync(tmp, path)`: atomic (a reader never sees a half-written file) and refused with EEXIST when another
 * creation won the race (AccountExists), so two parallel creations never both succeed. */
export async function createAccount(env: Env, username: unknown, password: unknown, nowIso: string, path: string = accountPath(env)): Promise<AccountRecord> {
  const f = checkAccountFields(username, password);
  if (existsSync(path)) throw new AccountExists();
  const hash = await Bun.password.hash(f.password, { algorithm: "argon2id" });
  const record: AccountRecord = { username: f.username, hash, created_at: nowIso };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    try { linkSync(tmp, path); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new AccountExists();
      throw e;
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
  return record;
}

/** A hash of a random string, computed once at load: an unknown username costs the same one argon2 verify. */
const DUMMY_HASH: Promise<string> = Bun.password.hash(randomBytes(32).toString("base64url"), { algorithm: "argon2id" });

/** The pair matches the record (`Bun.password.verify`). An unknown username, or no record, verifies against the
 * dummy hash (one argon2 verify either way) and refuses. */
export async function verifyPassword(record: AccountRecord | null, username: string, password: string): Promise<boolean> {
  const known = record !== null && safeEqual(username, record.username);
  const hash = known ? record!.hash : await DUMMY_HASH;
  let ok = false;
  try { ok = await Bun.password.verify(password, hash); } catch { ok = false; }
  return known && ok;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The lockout for `username` at `nowMs`, from `service_events`: only rows after the latest `account-created` row
 * for `username` count (the reset, deleting `account.json` and creating the account again, clears the lockout).
 * The latest such `account-locked` row whose `until` is still ahead means locked; else the refusals (`mismatch`,
 * `unknown-username`) recorded after that lock and inside the last LOCKOUT_WINDOW_MS are counted, and
 * LOCKOUT_FAILURES or more write `account-locked {username, until}` (now + LOCKOUT_MS) and answer locked. Failures
 * before an expired lock never count again. */
export function lockState(queue: Queue, username: string, nowMs: number): { locked: boolean; until?: string } {
  const created = queue.serviceEvents("account-created").findLast((e) => e.detail?.username === username);
  const after = (seq: number) => !created || seq > created.seq;
  const lock = queue.serviceEvents("account-locked").findLast((e) => e.detail?.username === username && after(e.seq));
  const until = typeof lock?.detail?.until === "string" ? Date.parse(lock.detail.until) : NaN;
  if (lock && Number.isFinite(until) && until > nowMs) return { locked: true, until: lock.detail!.until as string };
  const since = nowMs - LOCKOUT_WINDOW_MS;
  const failures = queue.serviceEvents("signin-refused").filter((e) =>
    e.detail?.username === username && e.detail?.reason !== "locked" && after(e.seq) && (!lock || e.seq > lock.seq)
    && Date.parse(e.at) > since && Date.parse(e.at) <= nowMs).length;
  if (failures < LOCKOUT_FAILURES) return { locked: false };
  const next = iso(nowMs + LOCKOUT_MS);
  queue.serviceEvent("account-locked", { username, until: next }, iso(nowMs));
  return { locked: true, until: next };
}
