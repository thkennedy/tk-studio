/** Story 36.7 (DW-85): the engine MCP's two queue event kinds, in a leaf `sandbox.ts` and `enginemcp.ts` both import, so
 * the sandbox's release reads them with no edge to `enginemcp.ts` (the stop itself is injected, `SandboxDeps.stopEngineMcp`). */
export const ENGINE_MCP_START = "engine-mcp-start";
export const ENGINE_MCP_STOP = "engine-mcp-stop";
