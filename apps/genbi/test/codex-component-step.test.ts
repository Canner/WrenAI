import { afterEach, describe, expect, it, vi } from "vitest";
import { runCodexComponentStep, codexComponentConfiguration, type CodexComponentPolicy } from "../server/runtime-host/codex-component-step.js";
import { CODEX_BASELINE_VERSION } from "../server/runtime-host/codex-compatibility.js";
import type { RpcTransport } from "../server/runtime-host/codex-rpc.js";
import type { StepRun } from "../harness/components/runner.js";

const configuration = codexComponentConfiguration("component");
function policy(): CodexComponentPolicy {
  return { cwd: "/synthetic/work", codexHome: "/synthetic/codex", permissionProfile: "component", model: "synthetic-model",
    accountEmail: "approved@example.test", configuration: structuredClone(configuration), assertCurrent: vi.fn() };
}
const thread = { id: "thread", cwd: "/synthetic/work", cliVersion: CODEX_BASELINE_VERSION, ephemeral: true };
const turn = { id: "turn", status: "inProgress", items: [] };
type Frame = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown };
class Peer implements RpcTransport {
  handlers!: Parameters<RpcTransport["listen"]>[0];
  writes: Frame[] = [];
  close = vi.fn(async () => {});
  account = "approved@example.test";
  config: Record<string, unknown> = structuredClone(configuration);
  beforeTurnReply?: () => void;
  completed: unknown[] = [];
  omitStarts = false;
  threadOverrides: Record<string, unknown> = {};
  afterConfig?: () => void;
  onToolResponse?: (frame: Frame) => void;
  listen(handlers: Peer["handlers"]) { this.handlers = handlers; }
  line(frame: Frame) { this.handlers.data(Buffer.from(JSON.stringify(frame) + "\n")); }
  event(method: string, params: Record<string, unknown>) { this.line({ method, params }); }
  write(line: string) {
    const frame = JSON.parse(line) as Frame; this.writes.push(frame);
    if (!frame.method) { this.onToolResponse?.(frame); return; }
    const results: Record<string, unknown> = {
      initialize: { codexHome: "/synthetic/codex", platformFamily: "unix", platformOs: "macos", userAgent: `codex/${CODEX_BASELINE_VERSION} test` },
      "config/read": { config: this.config }, "account/read": { requiresOpenaiAuth: true, account: { type: "chatgpt", email: this.account } },
      "thread/start": { thread, model: "synthetic-model", modelProvider: "openai", cwd: thread.cwd, approvalPolicy: "never", activePermissionProfile: { id: "component" }, ...this.threadOverrides }, "turn/start": { turn },
    };
    if (frame.method === "thread/start" && !this.omitStarts) this.event("thread/started", { thread });
    if (frame.method === "turn/start") {
      if (!this.omitStarts) this.event("turn/started", { threadId: "thread", turn });
      this.beforeTurnReply?.();
    }
    if (frame.id !== undefined) this.line({ id: frame.id, result: results[frame.method] });
    if (frame.method === "config/read") this.afterConfig?.();
  }
  item(item: Record<string, unknown>) {
    this.event("item/started", { threadId: "thread", turnId: "turn", item, startedAtMs: 1 });
    this.completed.push(item);
    this.event("item/completed", { threadId: "thread", turnId: "turn", item, completedAtMs: 2 });
  }
  finish(items?: unknown[]) {
    this.item({ id: "answer", type: "agentMessage", text: "synthetic answer" });
    this.event("turn/completed", { threadId: "thread", turn: { ...turn, status: "completed", items: items ?? this.completed } });
  }
  call(callId = "tool-1", overrides: Record<string, unknown> = {}) {
    this.line({ id: `rpc-${callId}`, method: "item/tool/call", params: { threadId: "thread", turnId: "turn", callId, tool: "query", arguments: { sql: "SELECT 1" }, ...overrides } });
  }
}
function step(): StepRun {
  return { tier: "fast", request: "synthetic request", input: {}, prompt: "only this step", consumes: {},
    tools: { query: vi.fn(async () => ({ rows: [{ count: 1 }] })) },
    toolSchemas: { query: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"], additionalProperties: false } },
    toolDescriptions: { query: "Query governed data" }, signal: new AbortController().signal };
}
async function ready(peer: Peer) { await vi.waitFor(() => expect(peer.writes.some((f) => f.method === "turn/start")).toBe(true)); }
afterEach(() => vi.useRealTimers());

describe("governed Codex component step", () => {
  it("uses a fresh ephemeral pinned model thread and returns observed usage", async () => {
    const peer = new Peer(); const run = step(); const result = runCodexComponentStep(peer, policy(), run);
    await ready(peer);
    peer.event("thread/tokenUsage/updated", { threadId: "thread", turnId: "turn", tokenUsage: { total: { inputTokens: 17, outputTokens: 4 } } });
    peer.finish();
    await expect(result).resolves.toEqual({ value: "synthetic answer", usage: { inputTokens: 17, outputTokens: 4 } });
    expect(peer.writes.find((f) => f.method === "thread/start")?.params).toMatchObject({ ephemeral: true, model: "synthetic-model", modelProvider: "openai", runtimeWorkspaceRoots: [], environments: [], allowProviderModelFallback: false, dynamicTools: [{ name: "query" }] });
    expect(peer.close).toHaveBeenCalledTimes(1);
  });
  it("correlates a tool request received before turn acknowledgement", async () => {
    const peer = new Peer(); const run = step();
    peer.beforeTurnReply = () => peer.call();
    peer.onToolResponse = () => { peer.item({ id: "tool-1", type: "dynamicToolCall", tool: "query", status: "completed", success: true }); peer.finish(); };
    await expect(runCodexComponentStep(peer, policy(), run)).resolves.toMatchObject({ value: "synthetic answer" });
    expect(run.tools.query).toHaveBeenCalledExactlyOnceWith({ sql: "SELECT 1" });
  });
  it.each(["account", "configuration", "policy", "revoked"])("rejects %s before starting a model turn", async (kind) => {
    const peer = new Peer(); const approved = policy();
    if (kind === "account") peer.account = "other@example.test";
    if (kind === "configuration") peer.config.features = { ...(configuration.features as Record<string, unknown>), shell_tool: true };
    if (kind === "policy") Object.assign(approved.configuration, { mcp_servers: { injected: {} } });
    if (kind === "revoked") vi.mocked(approved.assertCurrent).mockImplementation(() => { throw new Error("private detail"); });
    await expect(runCodexComponentStep(peer, approved, step())).rejects.toThrow("Codex RPC protocol");
    expect(peer.writes.some((f) => f.method === "turn/start")).toBe(false);
    expect(peer.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    { tool: "shell" }, { threadId: "other" }, { turnId: "other" }, { namespace: "injected" },
    { arguments: "x".repeat(65_537) },
  ])("refuses unapproved or out-of-scope call %j", async (overrides) => {
    const peer = new Peer(); const run = step(); const result = runCodexComponentStep(peer, policy(), run);
    const rejected = expect(result).rejects.toThrow("Codex RPC protocol"); await ready(peer); peer.call("bad", overrides);
    await rejected; expect(run.tools.query).not.toHaveBeenCalled();
  });
  it.each(["commandExecution", "fileChange", "mcpToolCall", "webSearch", "collabAgentToolCall"])("rejects forbidden %s even in a final-only item", async (type) => {
    const peer = new Peer(); const result = runCodexComponentStep(peer, policy(), step());
    const rejected = expect(result).rejects.toThrow("Codex RPC protocol"); await ready(peer); peer.finish([{ id: "hidden", type }]); await rejected;
  });
  it("does not run queued tools after a failed tool", async () => {
    const peer = new Peer(); const run = step(); vi.mocked(run.tools.query!).mockRejectedValue(new Error("secret"));
    const result = runCodexComponentStep(peer, policy(), run); const rejected = expect(result).rejects.toThrow("Codex RPC protocol");
    await ready(peer); peer.call("first"); peer.call("second"); await rejected;
    expect(run.tools.query).toHaveBeenCalledTimes(1);
    expect(peer.writes.filter((f) => f.result && !f.method)).toHaveLength(0);
  });
  it("rejects repeated call IDs even with different RPC IDs", async () => {
    const peer = new Peer(); const result = runCodexComponentStep(peer, policy(), step()); const rejected = expect(result).rejects.toThrow("Codex RPC protocol");
    await ready(peer); peer.call(); peer.line({ id: "replay", method: "item/tool/call", params: { threadId: "thread", turnId: "turn", callId: "tool-1", tool: "query", arguments: {} } }); await rejected;
  });
  it("cancels an unfinished turn and closes the transport", async () => {
    const peer = new Peer(); const controller = new AbortController(); const result = runCodexComponentStep(peer, policy(), { ...step(), signal: controller.signal });
    const rejected = expect(result).rejects.toThrow("Codex RPC cancelled"); await ready(peer); controller.abort(); await rejected;
    expect(peer.close).toHaveBeenCalledTimes(1);
  });
  it("reports incomplete cleanup instead of a successful result", async () => {
    const peer = new Peer(); peer.close.mockRejectedValue(new Error("private process details"));
    const result = runCodexComponentStep(peer, policy(), step()); const rejected = expect(result).rejects.toThrow("Codex RPC cleanup"); await ready(peer); peer.finish(); await rejected;
  });
  it("rejects ambient filesystem read policy before I/O", async () => {
    const peer = new Peer(); const approved = policy();
    Object.assign(approved.configuration, { permissions: { component: { network: { enabled: false }, filesystem: { "/": "read" } } } });
    await expect(runCodexComponentStep(peer, approved, step())).rejects.toThrow("Codex RPC protocol");
    expect(peer.writes).toHaveLength(0);
  });
  it.each([{ model: "other" }, { modelProvider: "other" }, { approvalPolicy: "on-request" }, { activePermissionProfile: { id: "other" } }, { instructionSources: ["/secret/instructions"] }])("rejects authority disagreement in thread response %j", async (overrides) => {
    const peer = new Peer(); peer.threadOverrides = overrides;
    await expect(runCodexComponentStep(peer, policy(), step())).rejects.toThrow("Codex RPC protocol");
    expect(peer.writes.some((f) => f.method === "turn/start")).toBe(false);
  });
  it("retains captured authority when the supplied policy mutates after config validation", async () => {
    const peer = new Peer(); const approved = policy();
    peer.afterConfig = () => { Object.assign(approved, { model: "other", cwd: "/other", permissionProfile: "other" }); Object.assign(approved.configuration, { approval_policy: "on-request" }); };
    const result = runCodexComponentStep(peer, approved, step()); await ready(peer); peer.finish();
    await expect(result).resolves.toMatchObject({ value: "synthetic answer" });
    expect(peer.writes.find((f) => f.method === "turn/start")?.params).toMatchObject({ model: "synthetic-model", cwd: thread.cwd, permissions: "component" });
  });
  it.each(["starts", "items", "timestamps"])("rejects incomplete lifecycle %s", async (missing) => {
    const peer = new Peer(); peer.omitStarts = missing === "starts";
    const result = runCodexComponentStep(peer, policy(), step()); const rejected = expect(result).rejects.toThrow("Codex RPC protocol"); await ready(peer);
    if (missing === "timestamps") peer.event("item/started", { threadId: "thread", turnId: "turn", item: { id: "answer", type: "agentMessage", text: "synthetic" } });
    else peer.finish(missing === "items" ? [] : undefined);
    await rejected;
  });

});
