import { describe, expect, test } from "bun:test";
import {
  extractStatusBlock, finishStateFor, MISSING_STATUS_BLOCK, parseWorkerResult,
} from "../src/server";

const block = (status: string, extra = "") => `{"status":"${status}","intent":"tk-studio-activate","artifacts":[]${extra}}`;

describe("status-block extraction (§3: last balanced object with string status+intent)", () => {
  test("keeps the LAST qualifying block", () => {
    const text = `first ${block("partial", ',"reason":"x"')}\nthen ${block("complete")}`;
    expect(extractStatusBlock(text)?.status).toBe("complete");
  });

  test("a later non-block object does not displace the block", () => {
    const text = `${block("complete")}\ntrailing {"note":"not a block"} and {"status":1,"intent":"x"}`;
    expect(extractStatusBlock(text)?.status).toBe("complete");
  });

  test("braces inside strings do not break the scan", () => {
    const text = `chatter "{" ${block("blocked", ',"reason":"saw } and { in text"')}`;
    expect(extractStatusBlock(text)).toMatchObject({ status: "blocked", reason: "saw } and { in text" });
  });

  test("an unclosed brace in chatter does not swallow a trailing block", () => {
    expect(extractStatusBlock(`oops { never closed\n${block("complete")}`)?.status).toBe("complete");
  });

  test("nested objects are part of the top-level block", () => {
    const text = `{"status":"complete","intent":"tk-studio-activate","artifacts":[],"detail":{"status":"inner"}}`;
    expect(extractStatusBlock(text)?.detail).toEqual({ status: "inner" });
  });

  test("missing block → null, and the failure is named (AD-11)", () => {
    expect(extractStatusBlock("all done, no JSON here")).toBeNull();
    expect(extractStatusBlock(`{"status":"complete"}`)).toBeNull(); // intent missing
    expect(MISSING_STATUS_BLOCK).toMatch(/conformance failure \(AD-11\)/);
  });
});

describe("worker --output-format json result", () => {
  test("the block rides `result`; the cost rides `total_cost_usd`", () => {
    const stdout = JSON.stringify({ type: "result", is_error: false, result: `ok\n${block("complete")}`, total_cost_usd: 0.042 });
    const parsed = parseWorkerResult(stdout);
    expect(parsed.totalCostUsd).toBe(0.042);
    expect(extractStatusBlock(parsed.text)?.status).toBe("complete");
  });

  test("no cost when the result omits it; error flag carried", () => {
    const parsed = parseWorkerResult(JSON.stringify({ type: "result", is_error: true, result: "API Error: 401" }));
    expect(parsed).toEqual({ text: "API Error: 401", isError: true });
  });

  test("error subtypes with no string `result` still carry the cost", () => {
    for (const subtype of ["error_max_turns", "error_during_execution"]) {
      const stdout = JSON.stringify({ type: "result", subtype, is_error: true, total_cost_usd: 0.31 });
      expect(parseWorkerResult(stdout)).toMatchObject({ isError: true, totalCostUsd: 0.31 });
    }
  });

  test("non-JSON stdout falls back to the raw text", () => {
    expect(parseWorkerResult(`plain ${block("complete")}`).text).toContain("plain");
  });
});

describe("finish state mapping", () => {
  test("the schema's complete|partial|blocked pass through; anything else, cancelled included, is partial", () => {
    for (const s of ["complete", "partial", "blocked"]) expect(finishStateFor(s)).toBe(s as any);
    expect(finishStateFor("cancelled")).toBe("partial");
    expect(finishStateFor("done")).toBe("partial");
  });
});
