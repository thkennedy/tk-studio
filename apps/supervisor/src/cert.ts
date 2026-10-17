/**
 * cert.ts — the TLS certificate renews itself (Story 27.5, DW-21).
 *
 *   check     `serve` reads the certificate's `notAfter` (`node:crypto` `X509Certificate`) at start and on each of
 *             its ticks (`CERT_CHECK_MS`). Within RENEW_WITHIN_DAYS of expiry, with no queue run `running` or
 *             `external` (a paused run holds no live worker), and no `cert-renew-requested` recorded in the last
 *             24 h, it records `cert-renew-requested {cert, not_after, days_left}` and `serve` exits CERT_RENEW_EXIT
 *             (75). The keeper (start.ps1) runs the same bounded `tailscale cert` the main script runs and restarts
 *             `serve` at once, without its back-off. A live run: the check waits for a later tick — but within
 *             FORCE_WITHIN_DAYS (3) days of expiry it renews even during a live run, naming the runs it overrode
 *             (`overrode: [run ids]` on `cert-renew-requested`), still at most once per 24 h.
 *   on start  after a request, the next `serve` records `cert-renewed {not_after_before, not_after}` (a later
 *             `notAfter`) or `cert-renew-failed {not_after}` — once per request.
 *
 * These events have no run: they go to the queue's `service_events` table.
 */
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Queue } from "./queue";

/** The exit code `serve` asks the keeper for a renewal with (EX_TEMPFAIL). */
export const CERT_RENEW_EXIT = 75;
/** Renewed when the certificate expires within this many days. */
export const RENEW_WITHIN_DAYS = 14;
/** Story 27.5: within this many days of expiry a live run no longer defers the renewal (it is named in `overrode`). */
export const FORCE_WITHIN_DAYS = 3;
/** At most one renew request per this many ms (a renewal that did not take is not retried in a loop). */
export const RENEW_REQUEST_EVERY_MS = 24 * 3600_000;
/** How often `serve` checks the certificate (its tick). */
export const CERT_CHECK_MS = 3600_000;

/** The certificate's `notAfter`; null when the file cannot be read or parsed. */
export function certNotAfter(path: string): Date | null {
  try {
    const d = new Date(new X509Certificate(readFileSync(path)).validTo);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch { return null; }
}

export type CertDecision =
  | { action: "none"; why: string }
  | { action: "wait"; why: string }
  | { action: "renew"; detail: { cert: string; not_after: string; days_left: number; overrode?: string[] } };

/** One check (see the header): `renew` has already recorded `cert-renew-requested`; the caller exits CERT_RENEW_EXIT. */
export function certCheck(queue: Queue, certPath: string, now: number = Date.now()): CertDecision {
  const notAfter = certNotAfter(certPath);
  if (!notAfter) return { action: "none", why: "the certificate could not be read" };
  const daysLeft = Math.floor((notAfter.getTime() - now) / 86_400_000);
  if (notAfter.getTime() - now > RENEW_WITHIN_DAYS * 86_400_000) return { action: "none", why: `${daysLeft} days left` };
  const live = queue.runs().filter((r) => r.state === "running" || r.state === "external").map((r) => r.run_id);
  if (live.length && daysLeft > FORCE_WITHIN_DAYS) return { action: "wait", why: `a live run (${live.join(", ")})` };
  const last = queue.serviceEvents("cert-renew-requested").at(-1);
  if (last && now - Date.parse(last.at) < RENEW_REQUEST_EVERY_MS) return { action: "wait", why: `a renewal was requested at ${last.at}` };
  const detail = { cert: certPath, not_after: notAfter.toISOString(), days_left: daysLeft, ...(live.length ? { overrode: live } : {}) };
  queue.serviceEvent("cert-renew-requested", detail, new Date(now).toISOString());
  return { action: "renew", detail };
}

/** On `serve`'s start: the outcome of the latest renew request not yet answered — `cert-renewed` when the
 * certificate's `notAfter` moved later, else `cert-renew-failed`. Answers the kind recorded, or null. */
export function recordCertStart(queue: Queue, certPath: string): "cert-renewed" | "cert-renew-failed" | null {
  const events = queue.serviceEvents();
  const req = events.findLast((e) => e.kind === "cert-renew-requested");
  if (!req || events.some((e) => e.seq > req.seq && (e.kind === "cert-renewed" || e.kind === "cert-renew-failed"))) return null;
  const before = typeof req.detail?.not_after === "string" ? req.detail.not_after : null;
  const after = certNotAfter(certPath);
  if (after && before && after.getTime() > Date.parse(before)) {
    queue.serviceEvent("cert-renewed", { not_after_before: before, not_after: after.toISOString() });
    return "cert-renewed";
  }
  queue.serviceEvent("cert-renew-failed", { not_after: after ? after.toISOString() : null });
  return "cert-renew-failed";
}
