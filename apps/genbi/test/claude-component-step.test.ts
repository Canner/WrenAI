import { describe, expect, it, vi } from "vitest";
import type { Query, SDKMessage, Options } from "@anthropic-ai/claude-agent-sdk";
import { runClaudeComponentStep, type ClaudeComponentRuntime } from "../server/runtime-host/claude-component-step.js";
import type { StepRun } from "../harness/components/runner.js";

const handlers = vi.hoisted(() => new Map<string, (input: unknown) => Promise<unknown>>());
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _description: string, _schema: unknown, callback: (input: unknown) => Promise<unknown>) => { handlers.set(name, callback); return { name }; },
  createSdkMcpServer: () => ({ type: "sdk", name: "component", instance: {} }),
}));
const account = { email: "approved@example.test", tokenSource: "synthetic-subscription", subscriptionType: "synthetic", apiKeySource: "none" };
const init = { apiKeySource: "none", type: "system", subtype: "init", uuid: "init", session_id: "session", claude_code_version: "2.1.259", cwd: "/synthetic/work",
  model: "synthetic-model", tools: ["mcp__component__query"], mcp_servers: [{ name: "component", status: "connected" }],
  skills: [], plugins: [], slash_commands: [], permissionMode: "default" };
const result = { type: "result", subtype: "success", uuid: "result", session_id: "session", is_error: false, result: "synthetic answer",
  permission_denials: [], modelUsage: { "synthetic-model": { webSearchRequests: 0, inputTokens: 2, outputTokens: 2, cacheReadInputTokens: 2, cacheCreationInputTokens: 1 } }, usage: { input_tokens: 5, output_tokens: 2 } };
function setup(events: unknown[] = [init, result]) {
  handlers.clear();
  const run: StepRun = { tier: "cheap", request: "synthetic", input: {}, consumes: {}, prompt: "only this step", signal: new AbortController().signal,
    tools: { query: vi.fn(async () => ({ rows: [{ n: 1 }] })) }, toolDescriptions: {}, toolSchemas: { query: { type: "object", required: ["sql"], properties: { sql: { type: "string" } }, additionalProperties: false } } };
  const pending: unknown[] = [...events];
  let options!: Options;
  let prompt!: AsyncIterable<unknown>;
  const next = vi.fn(async () => {
    const value = pending.shift();
    if (typeof value === "function") await value();
    return { done: false, value: (typeof value === "function" ? pending.shift() : value) as SDKMessage };
  });
  const session = { accountInfo: vi.fn(async () => account), next } as unknown as Query;
  const runtime: ClaudeComponentRuntime = { cwd: "/synthetic/work", executable: "/synthetic/claude", model: "synthetic-model", account,
    environment: { HOME: "/synthetic/home", CLAUDE_CONFIG_DIR: "/synthetic/login", PATH: "/usr/bin:/bin" },
    spawn: vi.fn(() => { throw new Error("process forbidden"); }), query: vi.fn((input) => { options = input.options; prompt = input.prompt; return session; }), assertCurrent: vi.fn(), close: vi.fn(async () => {}) };
  return { run, runtime, session, next, options: () => options, prompt: () => prompt };
}
describe("governed Claude component step", () => {
  it("uses exact tools and isolated input with no default vendor spawn", async () => {
    const test = setup([init, async () => { await handlers.get("query")!({ sql: "SELECT 1" }); }, result]);
    await expect(runClaudeComponentStep(test.runtime, test.run)).resolves.toEqual({ value: "synthetic answer", usage: { inputTokens: 5, outputTokens: 2 } });
    expect(test.run.tools.query).toHaveBeenCalledExactlyOnceWith({ sql: "SELECT 1" });
    expect(test.options()).toMatchObject({ tools: [], allowedTools: ["mcp__component__query"], agents: {}, plugins: [], settingSources: [], persistSession: false, maxTurns: 12 });
    expect(test.runtime.spawn).not.toHaveBeenCalled(); expect(test.runtime.close).toHaveBeenCalledTimes(1);
    expect(test.session.accountInfo).toHaveBeenCalledTimes(2);
  });
  it.each(["identity", "api-key", "missing-source", "environment", "revocation"])("denies %s before sending input", async (kind) => {
    const test = setup();
    if (kind === "identity") vi.mocked(test.session.accountInfo).mockResolvedValue({ ...account, email: "other@example.test" });
    if (kind === "api-key") vi.mocked(test.session.accountInfo).mockResolvedValue({ ...account, apiKeySource: "ANTHROPIC_API_KEY" });
    if (kind === "missing-source") vi.mocked(test.session.accountInfo).mockResolvedValue({ email: account.email, tokenSource: account.tokenSource, subscriptionType: account.subscriptionType });
    if (kind === "environment") Object.assign(test.runtime.environment, { ANTHROPIC_API_KEY: "synthetic" });
    if (kind === "revocation") vi.mocked(test.runtime.assertCurrent).mockImplementation(() => { throw Error("private"); });
    await expect(runClaudeComponentStep(test.runtime, test.run)).rejects.toThrow("Claude component protocol");
    expect(test.next).not.toHaveBeenCalled(); expect(test.runtime.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    { apiKeySource: "ANTHROPIC_API_KEY" }, { tools: ["Bash"] }, { model: "other" }, { cwd: "/other" }, { claude_code_version: "other" },
    { plugins: [{ name: "extra", path: "/extra" }] }, { skills: ["extra"] }, { mcp_servers: [{ name: "extra", status: "connected" }] },
  ])("denies vendor init authority drift %j", async (changed) => {
    const test = setup([{ ...init, ...changed }, result]);
    await expect(runClaudeComponentStep(test.runtime, test.run)).rejects.toThrow("Claude component protocol"); expect(test.run.tools.query).not.toHaveBeenCalled();
  });
  it("fails rather than accepting a model result after tool failure", async () => {
    const test = setup([init, async () => { await handlers.get("query")!({ sql: "SELECT 1" }).catch(() => {}); }, result]);
    vi.mocked(test.run.tools.query!).mockRejectedValue(Error("private"));
    await expect(runClaudeComponentStep(test.runtime, test.run)).rejects.toThrow("Claude component");
  });
  it("denies sibling session events", async () => {
    const test = setup([init, { ...result, session_id: "other" }]);
    await expect(runClaudeComponentStep(test.runtime, test.run)).rejects.toThrow("Claude component protocol");
  });
  it("rechecks account before returning success", async () => {
    const test = setup(); vi.mocked(test.session.accountInfo).mockResolvedValueOnce(account).mockResolvedValueOnce({ ...account, email: "changed@example.test" });
    await expect(runClaudeComponentStep(test.runtime, test.run)).rejects.toThrow("Claude component protocol");
  });
  it("reports cleanup failure even after a valid result", async () => {
    const test = setup(); vi.mocked(test.runtime.close).mockRejectedValue(Error("private"));
    await expect(runClaudeComponentStep(test.runtime, test.run)).rejects.toThrow("Claude component cleanup");
  });
  it("cancels stalled vendor messages and drains its owned runtime", async () => {
    const test = setup(); const controller = new AbortController(); test.next.mockImplementation(() => new Promise(() => {}));
    const pending = runClaudeComponentStep(test.runtime, { ...test.run, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("Claude component cancelled");
    await vi.waitFor(() => expect(test.next).toHaveBeenCalled()); controller.abort(); await rejected;
    expect(test.runtime.close).toHaveBeenCalledTimes(1);
  });
  it.each([{ other: result.modelUsage["synthetic-model"] }, {}, { "synthetic-model": { ...result.modelUsage["synthetic-model"], webSearchRequests: 1 } }])("blocks missing or fallback model usage %j", async (modelUsage) => {
    const test = setup([init, { ...result, modelUsage }]);
    await expect(runClaudeComponentStep(test.runtime, test.run)).rejects.toThrow("Claude component protocol");
  });
  it("keeps the prompt closed until approved account information arrives", async () => {
    const test = setup(); let release!: (value: typeof account) => void;
    vi.mocked(test.session.accountInfo).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const result = runClaudeComponentStep(test.runtime, test.run);
    const input = test.prompt()[Symbol.asyncIterator](); let yielded = false;
    const nextInput = input.next().then((value) => { yielded = true; return value; });
    await Promise.resolve(); expect(yielded).toBe(false); release(account);
    await expect(nextInput).resolves.toMatchObject({ done: false, value: { type: "user" } });
    await result; await expect(input.next()).resolves.toMatchObject({ done: true });
  });

});
