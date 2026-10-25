// Story 31.6: the vitest fixture — one `inbox.json`-shaped answer (`GET /inbox?project=p`, the sync-back's v1 items:
// open, resolved and validating) and one issue answer (`GET /inbox?project=p&issue=TKS-3`).
import type { IssueAnswer } from "../issue/model";
import type { InboxAnswer } from "./model";

export const NOW = Date.parse("2026-10-24T12:00:00Z");
export const PR = "https://github.com/o/r/pull/7";

export const inboxAnswer = (): InboxAnswer => ({
  ok: true,
  project: "p",
  generated_at: "2026-10-24T11:55:00+00:00",
  items: [
    { issue: "TKS-3", entity: "ST-003", title: "Gamma", priority: "Highest", blocked_since: "2026-10-24T11:55:00+00:00",
      reason_comment: { id: "10001", body: "[~accountid:acc-owner] Blocked: which spec wins?\nResolves when: a ruling", created: "2026-10-24T11:55:00.000+0000" },
      state: "open" },
    { issue: "TKS-1", entity: "ST-001", title: "Alpha", priority: "High", blocked_since: "2026-10-24T08:00:00+00:00", reason_comment: null, state: "resolved" },
    { issue: "TKS-5", priority: null, blocked_since: "2026-10-22T10:00:00+00:00",
      reason_comment: { id: "10002", body: "\n  the token expired  \nmore", created: "2026-10-22T10:00:00.000+0000" }, state: "open" },
    { issue: "TKS-2", entity: "ST-002", title: "Beta", priority: "Low", blocked_since: "2026-10-24T09:00:00+00:00", reason_comment: null, state: "validating" },
    { issue: "TKS-7", entity: "ST-007", title: "", priority: "Medium", blocked_since: "2026-10-24T09:00:00.000+0000", reason_comment: null, state: "open" },
  ],
});

export const issueAnswer = (): IssueAnswer => ({
  ok: true,
  project: "p",
  generated_at: "2026-10-24T11:55:00+00:00",
  items: [inboxAnswer().items[0]!],
  issue: {
    key: "TKS-3", entity: "ST-003", title: "Gamma", status: "Blocked - Awaiting User",
    run: { run_id: "q-1", state: "paused", pr: PR, host_verify: null, ended_at: null },
    cost_usd: 1.5,
    comments: [
      { id: "10001", author: "agent", update_author: "agent", body: "[~accountid:acc-owner] Blocked: which spec wins?\nResolves when: a ruling",
        created: "2026-10-24T11:55:00.000+0000", updated: "2026-10-24T11:55:00.000+0000" },
      { id: "10003", author: "owner", update_author: "owner", body: "Looking now", created: "2026-10-24T11:58:00.000+0000", updated: "2026-10-24T11:59:00.000+0000" },
    ],
  },
});
