/**
 * Minimal stdio JSON-RPC client for the supervisor core — spawns a live
 * `server.ts` instance and correlates JSON-RPC replies by id. Shared by the
 * through-connector conformance harness (conformance.ts) and the studio-jobs
 * tick (tick.ts): both are drivers and must go through the real connector
 * process, not import its handlers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

export const SERVER_PATH = join(import.meta.dir, "server.ts");

/** One tool call's outcome: a parsed result object, or the named error. */
export interface InvokeOutcome {
  toolError?: string;
  result?: Record<string, unknown>;
}

export class ConnectorClient {
  private child: ChildProcess;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  stderrTail = "";

  constructor(env: Record<string, string> = {}) {
    this.child = spawn("bun", ["run", SERVER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    this.child.stdout!.setEncoding("utf-8");
    this.child.stdout!.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        const entry = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
        if (entry) {
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          entry.resolve(msg);
        }
      }
    });
    this.child.stderr!.setEncoding("utf-8");
    this.child.stderr!.on("data", (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-2000); });
    this.child.on("exit", () => {
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`connector exited before replying; stderr tail: ${this.stderrTail.slice(-400)}`));
      }
      this.pending.clear();
    });
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no reply to ${method} (id ${id}) within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async init(clientName: string): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: clientName, version: "0.1.6" },
    }, 30_000);
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<InvokeOutcome> {
    let resp: any;
    try { resp = await this.request("tools/call", { name, arguments: args }, timeoutMs); }
    catch (e) { return { toolError: e instanceof Error ? e.message : String(e) }; }
    if (resp.error) return { toolError: `JSON-RPC ${resp.error.code}: ${resp.error.message}` };
    const text: string = resp.result?.content?.[0]?.text ?? "";
    if (resp.result?.isError) return { toolError: text };
    try { return { result: JSON.parse(text) }; }
    catch { return { toolError: `unparseable tool result: ${text.slice(0, 200)}` }; }
  }

  close(): void {
    try { this.child.stdin!.end(); } catch { /* already closed */ }
    // stdin EOF drains in-flight calls server-side; nothing is in flight when we close.
    setTimeout(() => { try { this.child.kill(); } catch { /* gone */ } }, 3_000).unref?.();
  }
}
