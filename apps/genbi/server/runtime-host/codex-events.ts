import { z } from "zod";
import { CodexRpcError } from "./codex-rpc.js";

const id = z.string().min(1).max(256);
const text = z.string().max(1_048_576);
const itemBase = { id };
const state = z.enum(["inProgress", "completed", "failed", "declined"]);
// Explicit supported item projection: never forward opaque vendor objects or
// error text. New tools/items require reviewed schema and policy support.
export const codexItemSchema = z.discriminatedUnion("type", [
  z.object({ ...itemBase, type: z.literal("userMessage"), content: z.array(z.object({ type: z.literal("text"), text })).max(128) }),
  z.object({ ...itemBase, type: z.literal("agentMessage"), text }),
  z.object({ ...itemBase, type: z.literal("plan"), text }),
  z.object({ ...itemBase, type: z.literal("reasoning"), content: z.array(text).default([]), summary: z.array(text).default([]) }),
  z.object({ ...itemBase, type: z.literal("commandExecution"), command: text, cwd: text, status: state, aggregatedOutput: text.nullish(), exitCode: z.number().int().nullish() }),
  z.object({ ...itemBase, type: z.literal("fileChange"), status: state, changes: z.array(z.object({ path: text, diff: text, kind: z.discriminatedUnion("type", [z.object({ type: z.literal("add") }), z.object({ type: z.literal("delete") }), z.object({ type: z.literal("update"), move_path: text.nullish() })]) })) }),
  z.object({ ...itemBase, type: z.literal("contextCompaction") }),
]);
export const codexTurnSchema = z.object({ id, status: z.enum(["inProgress", "completed", "interrupted", "failed"]), items: z.array(codexItemSchema).max(512) });
export const codexThreadSchema = z.object({ id, cwd: text, cliVersion: z.string(), ephemeral: z.boolean() });
const scope = { threadId: id, turnId: id };
const scopedItem = { ...scope, itemId: id };
const delta = z.object({ ...scopedItem, delta: text });
const usage = z.object({ totalTokens: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), cachedInputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), reasoningOutputTokens: z.number().int().nonnegative() });
export const codexNotificationSchemas = {
  "remoteControl/status/changed": z.object({ status: z.literal("disabled"), installationId: text, serverName: text, environmentId: z.null().optional() }),
  "thread/started": z.object({ thread: codexThreadSchema }),
  "thread/status/changed": z.object({ threadId: id, status: z.discriminatedUnion("type", [z.object({ type: z.literal("idle") }), z.object({ type: z.literal("active"), activeFlags: z.array(z.enum(["waitingOnApproval", "waitingOnUserInput"])) })]) }),
  "thread/tokenUsage/updated": z.object({ ...scope, tokenUsage: z.object({ total: usage, last: usage, modelContextWindow: z.number().int().nullish() }) }),
  "turn/started": z.object({ threadId: id, turn: codexTurnSchema }),
  "turn/completed": z.object({ threadId: id, turn: codexTurnSchema }),
  "turn/diff/updated": z.object({ ...scope, diff: text }),
  "turn/plan/updated": z.object({ ...scope, explanation: text.nullish(), plan: z.array(z.object({ step: text, status: z.enum(["pending", "inProgress", "completed"]) })) }),
  "item/started": z.object({ ...scope, item: codexItemSchema }),
  "item/completed": z.object({ ...scope, item: codexItemSchema }),
  "item/agentMessage/delta": delta,
  "item/commandExecution/outputDelta": delta,
  "item/fileChange/outputDelta": delta,
  "item/reasoning/summaryTextDelta": delta.extend({ summaryIndex: z.number().int().nonnegative() }),
  "item/reasoning/textDelta": delta.extend({ contentIndex: z.number().int().nonnegative() }),
  "item/reasoning/summaryPartAdded": z.object({ ...scopedItem, summaryIndex: z.number().int().nonnegative() }),
  "command/exec/outputDelta": z.object({ processId: id, stream: z.enum(["stdout", "stderr"]), deltaBase64: text.refine((value) => Buffer.from(value, "base64").toString("base64") === value), capReached: z.boolean() }),
} as const;
export type CodexEvent = { [K in keyof typeof codexNotificationSchemas]: { readonly method: K; readonly params: z.infer<(typeof codexNotificationSchemas)[K]> } }[keyof typeof codexNotificationSchemas];
export function parseCodexEvent(method: string, params: unknown): CodexEvent {
  if (!Object.hasOwn(codexNotificationSchemas, method)) throw new CodexRpcError("protocol");
  const schema = codexNotificationSchemas[method as keyof typeof codexNotificationSchemas];
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new CodexRpcError("protocol");
  return { method, params: parsed.data } as CodexEvent;
}
