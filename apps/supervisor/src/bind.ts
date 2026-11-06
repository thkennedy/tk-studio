/**
 * Story 37.6 (AC2, the retrospective's A1): the API bind's tailnet check, in a leaf so `enginemcp.ts` imports it
 * statically (it read it through `await import("./api")`, an edge the cycle test could not see). Re-exported from
 * `api.ts`. No relative imports.
 */

export class ApiBindRefused extends Error {
  constructor(addr: string, why: string) {
    super(`ApiBindRefused: TK_SUPERVISOR_BIND '${addr}' ${why} — the API binds only a Tailscale address (inside 100.64.0.0/10)`);
    this.name = "ApiBindRefused";
  }
}

/** The bind address checked: an IPv4 literal inside 100.64.0.0/10 (never 0.0.0.0, localhost, or a LAN address). */
export function checkBind(addr: string): string {
  const a = addr.trim();
  if (a === "0.0.0.0") throw new ApiBindRefused(a, "is every interface");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  const octets = m ? m.slice(1).map(Number) : [];
  if (!m || m.slice(1).some((o) => o.length > 1 && o.startsWith("0")) || octets.some((o) => o > 255)) {
    throw new ApiBindRefused(a, "is not an IPv4 literal");
  }
  if (octets[0] !== 100 || octets[1] < 64 || octets[1] > 127) throw new ApiBindRefused(a, "lies outside 100.64.0.0/10");
  return a;
}
