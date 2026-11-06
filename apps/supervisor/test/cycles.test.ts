/**
 * Story 36.7 (DW-85): the supervisor's module graph, pinned in the host gate. Value imports only: `import type` and a
 * brace list of only `type` names are erased by bun, so they load nothing at run time and cannot close a cycle at module
 * load (`hostverify.ts`'s `WorktreeDeps`, `hygiene.ts`'s `Queue`, `sweep.ts`'s `PlanStatusDeps`). `export … from` counts:
 * a re-export loads its module.
 *
 * The named cycles and dynamic-import dodges are gone, and the non-trivial SCCs equal the allowlist exactly: a new
 * cycle, or a cut one left on the list, fails until the allowlist is edited knowingly. Story 37.6 (AC2, A1): a dynamic
 * import of a sibling (`await import("./x")`, comments stripped) is an edge too, and no file has one: the one residual,
 * `enginemcp.ts`'s `./api` import of `checkBind`, is cut (the check lives in the leaf `bind.ts`, imported statically).
 * No residual is left.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withMcpStop } from "../src/cli";
import { stopEngineMcp } from "../src/enginemcp";

const SRC = join(import.meta.dir, "..", "src");

type Graph = Record<string, string[]>;

/** Source with its comments dropped: whole-line `//` and `/* … *\/` lines, and a trailing ` // …`. */
const code = (source: string): string =>
  source.split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, "")).join("\n");

/** A dynamic import of a sibling (`import("./x")`, `await` or not), over comment-stripped source. */
const DYNAMIC = /\bimport\(\s*["'`]\.\/([\w.-]+?)(?:\.ts)?["'`]\s*\)/g;

/** The `./x` modules a source loads at run time (Story 37.6: a dynamic import counts). */
export function valueImports(source: string): string[] {
  const out = new Set<string>();
  const statement = /^(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s+["']\.\/([\w.-]+?)(?:\.ts)?["']/gm;
  for (const m of source.matchAll(statement)) {
    if (m[1]) continue;
    const clause = m[2]!, braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    if (braces && !outside) {
      const names = braces[1]!.split(",").map((n) => n.trim()).filter(Boolean);
      if (names.every((n) => /^type\s/.test(n))) continue;
    }
    out.add(m[3]!);
  }
  for (const m of source.matchAll(/^import\s+["']\.\/([\w.-]+?)(?:\.ts)?["']/gm)) out.add(m[1]!);
  for (const m of code(source).matchAll(DYNAMIC)) out.add(m[1]!);
  return [...out].sort();
}

/** The strongly connected components with more than one module (Tarjan), each sorted, as `a,b,c`, sorted. */
export function cycles(graph: Graph): string[] {
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>(), out: string[] = [];
  let next = 0;
  const visit = (v: string) => {
    index.set(v, next); low.set(v, next); next++;
    stack.push(v); on.add(v);
    for (const w of graph[v] ?? []) {
      if (!(w in graph)) continue;
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      for (;;) { const w = stack.pop()!; on.delete(w); scc.push(w); if (w === v) break; }
      if (scc.length > 1) out.push(scc.sort().join(","));
    }
  };
  for (const v of Object.keys(graph).sort()) if (!index.has(v)) visit(v);
  return out.sort();
}

/** The modules that must share no cycle with each other. */
const NAMED: readonly (readonly string[])[] = [
  ["sweep", "worktree"], ["sweep", "planstatus"], ["closeout", "sweep", "planstatus"], ["hygiene", "server"],
];
/** The modules no SCC may hold after the cuts. */
const NEVER_IN_A_CYCLE = ["closeout", "enginemcp", "hostverify", "hygiene", "planstatus", "server", "sweep", "transcript", "worktree"];

/** The stated residuals (DW-85), exact. */
const ALLOWLIST = ["api,cli", "board,engagement,inbox,log,office,page,registry", "queue,sandbox"];

/** What is wrong with a graph: one line naming each fault; empty when it holds. */
export function faults(graph: Graph, allowlist: readonly string[] = ALLOWLIST): string[] {
  const found = cycles(graph), out: string[] = [];
  const holding = (m: string) => found.filter((s) => s.split(",").includes(m));
  for (const named of NAMED) {
    const shared = found.find((s) => named.every((m) => s.split(",").includes(m)));
    if (shared) out.push(`named cycle ${named.join(" -> ")} is back, in the SCC {${shared}}`);
  }
  for (const m of NEVER_IN_A_CYCLE) for (const s of holding(m)) out.push(`${m} is in the SCC {${s}}`);
  for (const s of found) if (!allowlist.includes(s)) out.push(`a new SCC {${s}}: cut it, or edit the allowlist knowingly`);
  for (const s of allowlist) if (!found.includes(s)) out.push(`the allowlisted SCC {${s}} is gone: edit the allowlist`);
  return out;
}

const tree = (): Graph => {
  const graph: Graph = {};
  for (const f of readdirSync(SRC).filter((n) => n.endsWith(".ts"))) {
    graph[f.slice(0, -3)] = valueImports(readFileSync(join(SRC, f), "utf-8"));
  }
  return graph;
};

/**
 * What is wrong with `cli.ts`'s engine-MCP wiring: every `releasePin(` passes `withMcpStop(…)` or `sbxDeps(…)` as its
 * deps (`sandbox.ts` stops the run's MCP only through that seam, and its default is none), and `sbxDeps` is built with
 * `withMcpStop`. Whole-line comments are not source; no call at all is a fault, so a renamed seam cannot pass empty.
 */
export function releaseWiringFaults(source: string): string[] {
  const code = source.split("\n").filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join("\n");
  const out: string[] = [], calls = [...code.matchAll(/\breleasePin\(/g)];
  if (!calls.length) out.push("no releasePin( call found");
  for (const m of calls) {
    const args: string[] = [""];
    let depth = 0, i = m.index! + m[0].length;
    for (; i < code.length; i++) {
      const c = code[i]!;
      if (c === ")" && depth === 0) break;
      if ("([{".includes(c)) depth++;
      if (")]}".includes(c)) depth--;
      if (c === "," && depth === 0) args.push("");
      else args[args.length - 1] += c;
    }
    if (!/^(withMcpStop|sbxDeps)\(/.test((args[2] ?? "").trim())) out.push(`releasePin(${args.join(",").trim()}) passes neither withMcpStop nor sbxDeps`);
  }
  if (!/\bsbxDeps\s*=\s*\([^)]*\)\s*(:\s*\w+\s*)?=>\s*withMcpStop\(/.test(code)) out.push("sbxDeps is not built with withMcpStop");
  return out;
}

const edge = (g: Graph, from: string, to: string): Graph => ({ ...g, [from]: [...(g[from] ?? []), to] });

describe("Story 36.7: the supervisor's import graph (DW-85)", () => {
  test("no named cycle; the remaining SCCs equal the allowlist exactly", () => {
    expect(faults(tree())).toEqual([]);
    expect(cycles(tree())).toEqual(ALLOWLIST);
  });

  test("Story 37.6: no dynamic import of a sibling in any file (comments stripped)", () => {
    const files = readdirSync(SRC).filter((n) => n.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(`${f}: ${code(readFileSync(join(SRC, f), "utf-8")).match(DYNAMIC)}`).toBe(`${f}: null`);
  });

  test("Story 37.6: the `enginemcp -> api` residual is cut: enginemcp imports the leaf `bind`, never `api`", () => {
    const g = tree();
    expect(g.enginemcp).not.toContain("api");
    expect(g.enginemcp).toContain("bind");
    expect(g.bind).toEqual([]);
    expect(g.api).toContain("bind");
  });

  test("the `registerSweepLine` dodge is gone: hygiene imports the sweep directly", () => {
    const read = (m: string) => readFileSync(join(SRC, `${m}.ts`), "utf-8");
    expect(read("hygiene")).not.toContain("registerSweepLine");
    expect(read("sweep")).not.toContain("registerSweepLine");
    expect(tree().hygiene).toContain("sweep");
  });

  test("the MCP stop reaches the sandbox through a one-way seam", () => {
    const g = tree();
    expect(g.sandbox).not.toContain("enginemcp");
    expect(g.sandbox).toContain("enginemcp-kinds");
    expect(g.worktree).toContain("enginemcp");
    expect(g.cli).toContain("enginemcp");
  });

  test("the run's engine MCP stops at its release: every `releasePin(` in cli.ts carries the stop", () => {
    expect(releaseWiringFaults(readFileSync(join(SRC, "cli.ts"), "utf-8"))).toEqual([]);
  });

  test("Story 37.6 (DW-164): `withMcpStop` injects `stopEngineMcp`; an injected stopper is kept", () => {
    expect(withMcpStop({}).stopEngineMcp).toBe(stopEngineMcp);
    const own = async () => true;
    expect(withMcpStop({ stopEngineMcp: own }).stopEngineMcp).toBe(own);
  });
});

describe("the check itself", () => {
  test.each([
    ["sweep", "worktree"], ["sweep", "planstatus"], ["worktree", "closeout"], ["planstatus", "office"], ["server", "hygiene"], ["sandbox", "enginemcp"], ["hostverify", "registry"],
  ])("a planted back-edge %s -> %s fails it", (from, to) => {
    const out = faults(edge(tree(), from, to));
    expect(out.length).toBeGreaterThan(0);
    expect(out.join("\n")).toContain(from);
  });

  test("Story 37.6: a planted `await import(\"./api\")` in enginemcp is scanned as an edge and fails it", () => {
    const planted = `${readFileSync(join(SRC, "enginemcp.ts"), "utf-8")}\nconst late = async () => (await import("./api")).checkBind;\n`;
    expect(valueImports(planted)).toContain("api");
    const out = faults({ ...tree(), enginemcp: valueImports(planted) });
    expect(out.length).toBeGreaterThan(0);
    expect(out.join("\n")).toContain("enginemcp");
  });

  test("a synthetic named back-edge names its SCC", () => {
    const g: Graph = { closeout: ["sweep"], sweep: ["planstatus"], planstatus: ["closeout"] };
    expect(faults(g, [])).toContain("named cycle closeout -> sweep -> planstatus is back, in the SCC {closeout,planstatus,sweep}");
  });

  test("a type-only edge is not counted; a mixed list, a default import and a re-export are", () => {
    expect(valueImports('import type { A } from "./a";\n')).toEqual([]);
    expect(valueImports('import { type A, type B } from "./a";\n')).toEqual([]);
    expect(valueImports('import {\n  type A,\n  type B,\n} from "./a";\n')).toEqual([]);
    expect(valueImports('export type { A } from "./a";\n')).toEqual([]);
    expect(valueImports('import { type A, b } from "./a";\n')).toEqual(["a"]);
    expect(valueImports('import {\n  type A,\n  b,\n} from "./a";\n')).toEqual(["a"]);
    expect(valueImports('import c, { type A } from "./a";\n')).toEqual(["a"]);
    expect(valueImports('import * as a from "./a";\n')).toEqual(["a"]);
    expect(valueImports('export { b } from "./a";\n')).toEqual(["a"]);
    expect(valueImports('export * from "./a";\n')).toEqual(["a"]);
    expect(valueImports('import "./a";\n')).toEqual(["a"]);
    expect(valueImports('import { join } from "node:path";\n')).toEqual([]);
    expect(valueImports(' * import { a } from "./a";\n')).toEqual([]);
    expect(valueImports('const a = await import("./a");\n')).toEqual(["a"]);
    expect(valueImports('const a = await import(`./a`);\n')).toEqual(["a"]);
    expect(valueImports('const a = (await import(\'./a.ts\')).x;\n')).toEqual(["a"]);
    expect(valueImports('// const a = await import("./a");\n')).toEqual([]);
    expect(valueImports(' * (await import("./a"))\n')).toEqual([]);
    expect(valueImports('f(); // await import("./a")\n')).toEqual([]);
    expect(valueImports('await import("node:fs");\n')).toEqual([]);
  });

  test("a planted release with no MCP stop fails the wiring check; the wired forms pass", () => {
    const built = "const sbxDeps = (w: W | undefined): SandboxDeps => withMcpStop({ ...w });\n";
    expect(releaseWiringFaults(`${built}await releasePin(q, id, sbxDeps(w));\nawait releasePin(\n  q,\n  id,\n  withMcpStop(s),\n);\n`)).toEqual([]);
    expect(releaseWiringFaults(`${built}await releasePin(q, id);\n`).join("\n")).toContain("passes neither");
    expect(releaseWiringFaults(`${built}await releasePin(q, id, sandbox);\n`).join("\n")).toContain("passes neither");
    expect(releaseWiringFaults(`${built}await releasePin(q, id, { ...sbxDeps(w) });\n`).join("\n")).toContain("passes neither");
    expect(releaseWiringFaults(`${built}// await releasePin(q, id, sbxDeps(w));\n`)).toEqual(["no releasePin( call found"]);
    expect(releaseWiringFaults("const sbxDeps = (w: W): SandboxDeps => ({ ...w });\nawait releasePin(q, id, sbxDeps(w));\n")).toEqual(["sbxDeps is not built with withMcpStop"]);
  });

  test("the allowlist is exact: a cut SCC and a new one both fail", () => {
    const g: Graph = { a: ["b"], b: ["a"], c: ["d"], d: ["c"] };
    expect(faults(g, ["a,b", "c,d"])).toEqual([]);
    expect(faults(g, ["a,b"]).join("\n")).toContain("a new SCC {c,d}");
    expect(faults(g, ["a,b", "c,d", "x,y"]).join("\n")).toContain("the allowlisted SCC {x,y} is gone");
  });
});
