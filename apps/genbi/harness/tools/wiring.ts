import type { ToolSet } from "ai";
import type { Agent } from "../bundle/schema.js";
import { resolveTools, type ResolvedTools, type ResolveToolsContext } from "./resolve.js";

/**
 * Thin wiring showing `resolveTools`'s output feeding a run: resolves
 * `agent.tools[]` into a `ToolSet`, hands it to `fn` (typically a call into
 * `executeAgent` from `../loop/index.js`), and always tears down whatever
 * MCP clients were opened — even if `fn` throws.
 */
export async function withResolvedTools<T>(
  agent: Agent,
  ctx: ResolveToolsContext,
  fn: (tools: ToolSet) => Promise<T>,
): Promise<T> {
  const resolved: ResolvedTools = await resolveTools(agent, ctx);
  try {
    return await fn(resolved.tools);
  } finally {
    await resolved.close();
  }
}
