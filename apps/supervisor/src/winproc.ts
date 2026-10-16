/**
 * winproc.ts — a win32 process's creation time, read natively (Story 27.5, DW-19).
 *
 * `kernel32` through `bun:ffi`: `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)`, `GetProcessTimes`
 * (the creation FILETIME), `CloseHandle`. The FILETIME is formatted exactly as PowerShell's
 * `(Get-Process -Id <pid>).StartTime.ToUniversalTime().ToString('o')` prints it (`yyyy-MM-ddTHH:mm:ss.fffffffZ`,
 * seven fractional digits), so a start time recorded by either path compares equal. No process is spawned: the
 * read takes well under a millisecond, where the PowerShell read took about half a second.
 */
import { dlopen, FFIType } from "bun:ffi";

/** OpenProcess access right: enough for GetProcessTimes, granted for most processes of other users too. */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** 100 ns intervals between 1601-01-01 (the FILETIME epoch) and 1970-01-01. */
const EPOCH_DIFF = 116444736000000000n;

/** A FILETIME (100 ns intervals since 1601-01-01 UTC) as PowerShell's round-trip `'o'` UTC string. */
export function filetimeToIso(filetime: bigint): string {
  const since1970 = filetime - EPOCH_DIFF;
  const seconds = since1970 / 10_000_000n;
  const frac = since1970 % 10_000_000n;
  const whole = new Date(Number(seconds) * 1000).toISOString().slice(0, 19); // yyyy-MM-ddTHH:mm:ss
  return `${whole}.${frac.toString().padStart(7, "0")}Z`;
}

type Kernel32 = {
  OpenProcess(access: number, inherit: number, pid: number): unknown;
  GetProcessTimes(handle: unknown, creation: Uint8Array, exit: Uint8Array, kernel: Uint8Array, user: Uint8Array): number;
  CloseHandle(handle: unknown): number;
};

let kernel32: Kernel32 | null | undefined;

/** kernel32's three functions, loaded once; null when they cannot be loaded (not win32, no FFI). */
function load(): Kernel32 | null {
  if (kernel32 !== undefined) return kernel32;
  if (process.platform !== "win32") return (kernel32 = null);
  try {
    const lib = dlopen("kernel32.dll", {
      OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
      GetProcessTimes: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
    kernel32 = lib.symbols as unknown as Kernel32;
  } catch { kernel32 = null; }
  return kernel32;
}

/** The creation time of `pid` (see the header). `undefined`: the FFI could not be loaded — the caller falls back
 * to its PowerShell read. `null`: the process could not be opened or read (gone, or access denied). */
export function processCreationTime(pid: number): string | null | undefined {
  const k = load();
  if (!k) return undefined;
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const handle = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!handle) return null;
    try {
      const creation = new Uint8Array(8), exit = new Uint8Array(8), kernel = new Uint8Array(8), user = new Uint8Array(8);
      if (!k.GetProcessTimes(handle, creation, exit, kernel, user)) return null;
      const ft = new DataView(creation.buffer).getBigUint64(0, true);
      return ft > EPOCH_DIFF ? filetimeToIso(ft) : null;
    } finally { k.CloseHandle(handle); }
  } catch { return null; }
}
