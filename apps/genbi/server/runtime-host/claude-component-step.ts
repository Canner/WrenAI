import { createSdkMcpServer, tool, type Options, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { StepRun, StepResponse } from "../../harness/components/runner.js";

/** Supplied only by the certified same-account process provisioner. No default spawn. */
export interface ClaudeComponentRuntime {
  readonly cwd: string;
  readonly executable: string;
  readonly model: string;
  readonly account: { readonly email: string; readonly tokenSource: string; readonly subscriptionType: string };
  readonly environment: Readonly<Record<string, string>>;
  readonly spawn: NonNullable<Options["spawnClaudeCodeProcess"]>;
  readonly query: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;
  /** Revalidates approved login, isolated home, SDK/CLI/SRT and runtime generation. */
  assertCurrent(): void;
  /** Resolves only after all owned vendor processes and descendants are gone. */
  close(): Promise<void>;
}
class ClaudeComponentError extends Error {
  constructor(readonly reason: "protocol" | "cancelled" | "cleanup") { super(`Claude component ${reason}`); }
}
function deny(): never { throw new ClaudeComponentError("protocol"); }
const record = z.record(z.string(), z.unknown());
const messageIdentity = z.object({ session_id: z.string().min(1), uuid: z.string().min(1) });
const allowedEnvironment = new Set(["PATH", "HOME", "CLAUDE_CONFIG_DIR", "TMPDIR", "LANG", "LC_ALL"]);

/** One fresh SDK query and SDK MCP server per step; never reuse the outer PTY. */
export async function runClaudeComponentStep(runtime: ClaudeComponentRuntime, run: StepRun): Promise<StepResponse> {
  const { cwd, executable, model } = runtime;
  const account = structuredClone(runtime.account);
  const environment = Object.freeze({ ...runtime.environment });
  const assertCurrent = runtime.assertCurrent.bind(runtime);
  const query = runtime.query.bind(runtime);
  const spawn = runtime.spawn;
  const close = runtime.close.bind(runtime);
  const controller = new AbortController();
  const signal = AbortSignal.any([run.signal, controller.signal]);
  let active = true; let initialized = false; let sessionId: string | undefined;
  let pending = 0; let calls = 0; let failed = false;
  let toolQueue: Promise<unknown> = Promise.resolve();
  let releaseInput!: () => void;
  const inputReady = new Promise<void>((resolve) => { releaseInput = resolve; });
  const check = () => { if (!active || failed) deny(); if (signal.aborted) throw new ClaudeComponentError("cancelled"); assertCurrent(); };
  let session: Query | undefined;
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const abort = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new ClaudeComponentError("cancelled")), { once: true });
  });
  void abort.catch(() => {});
  const wait = <T>(value: Promise<T>): Promise<T> => Promise.race([value, abort]);
  const tools = Object.keys(run.tools).map((name) => ({ name, wire: `mcp__component__${name}` }));
  try {
    check();
    if (!cwd.startsWith("/") || !executable.startsWith("/") || !model || !account.email || !account.tokenSource || !account.subscriptionType
      || !environment.HOME || !environment.CLAUDE_CONFIG_DIR || Object.keys(environment).some((name) => !allowedEnvironment.has(name))) deny();
    const sdkTools = tools.map(({ name }) => {
      const schema = z.fromJSONSchema(run.toolSchemas[name] ?? deny());
      if (!(schema instanceof z.ZodObject)) deny();
      return tool(name, run.toolDescriptions[name] ?? name, schema.shape, async (input) => {
        check(); if (!initialized || ++calls > 32) deny();
        pending++;
        const result = toolQueue.then(async () => {
          check();
          const parsed = schema.parse(input);
          if (Buffer.byteLength(JSON.stringify(parsed)) > 65_536) deny();
          const output = await wait(run.tools[name]!(parsed)); check();
          const text = JSON.stringify(output);
          if (text === undefined || Buffer.byteLength(text) > 1_048_000) deny();
          return { content: [{ type: "text" as const, text }] };
        });
        toolQueue = result.catch(() => { failed = true; controller.abort(); });
        try { return await result; } finally { pending--; }
      });
    });
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      try {
        await wait(inputReady); check();
        yield { type: "user", session_id: "", parent_tool_use_id: null,
          message: { role: "user", content: JSON.stringify({ request: run.request, input: run.input, consumes: run.consumes }) } };
        // Keep the SDK input channel open while governed tool exchanges run.
        await wait(new Promise<never>(() => {}));
      } catch { if (!signal.aborted) { failed = true; controller.abort(); } }
    }
    session = query({ prompt: prompt(), options: {
      abortController: controller, cwd, model, pathToClaudeCodeExecutable: executable,
      spawnClaudeCodeProcess: spawn, env: { ...environment },
      tools: [], allowedTools: tools.map(({ wire }) => wire),
      mcpServers: { component: createSdkMcpServer({ name: "component", tools: sdkTools }) },
      canUseTool: async () => { failed = true; controller.abort(); return { behavior: "deny", message: "Undeclared tool is unavailable" }; },
      permissionMode: "default", settingSources: [], plugins: [], agents: {}, additionalDirectories: [],
      persistSession: false, enableFileCheckpointing: false, maxTurns: 12,
      systemPrompt: [run.brief, run.prompt].filter(Boolean).join("\n\n"),
      extraArgs: { "strict-mcp-config": null, "disable-slash-commands": null },
    } });
    const observed = z.object({ email: z.literal(account.email), tokenSource: z.literal(account.tokenSource), subscriptionType: z.literal(account.subscriptionType), apiKeySource: z.literal("none") }).parse(await wait(session.accountInfo()));
    if (!observed.email) deny(); check(); releaseInput();
    const seen = new Set<string>();
    while (true) {
      const next = await wait(session.next()); check();
      if (next.done) deny();
      const message = record.parse(next.value);
      if (Buffer.byteLength(JSON.stringify(message)) > 1_048_576) deny();
      const identity = messageIdentity.parse(message);
      if (seen.has(identity.uuid) || seen.size >= 512) deny(); seen.add(identity.uuid);
      if (message.type === "system" && message.subtype === "init") {
        if (initialized) deny();
        const init = z.object({ apiKeySource: z.literal("none"), claude_code_version: z.literal("2.1.259"), cwd: z.literal(cwd), model: z.literal(model),
          tools: z.array(z.string()), mcp_servers: z.array(z.object({ name: z.literal("component"), status: z.literal("connected") })),
          skills: z.array(z.never()), plugins: z.array(z.never()), agents: z.array(z.never()).optional(),
          slash_commands: z.array(z.never()), permissionMode: z.literal("default"),
        }).parse(message);
        if (init.tools.length !== tools.length || new Set(init.tools).size !== tools.length || init.tools.some((name) => !tools.some(({ wire }) => wire === name))) deny();
        if (init.mcp_servers.length !== 1) deny();
        initialized = true; sessionId = identity.session_id; continue;
      }
      if (!initialized || identity.session_id !== sessionId) deny();
      if (message.type === "result") {
        const result = z.object({ subtype: z.literal("success"), is_error: z.literal(false), result: z.string().max(1_048_576),
          permission_denials: z.array(z.never()), modelUsage: z.record(z.string(), z.object({ webSearchRequests: z.literal(0), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), cacheReadInputTokens: z.number().int().nonnegative(), cacheCreationInputTokens: z.number().int().nonnegative() })), usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
        }).parse(message);
        if (pending || failed || Object.keys(result.modelUsage).length !== 1 || !Object.hasOwn(result.modelUsage, model)) deny();
        await wait(session.accountInfo()).then((value) => z.object({ email: z.literal(account.email), tokenSource: z.literal(account.tokenSource), subscriptionType: z.literal(account.subscriptionType), apiKeySource: z.literal("none") }).parse(value));
        check();
        const totals = result.modelUsage[model]!;
        return { value: result.result, usage: { inputTokens: totals.inputTokens + totals.cacheReadInputTokens + totals.cacheCreationInputTokens, outputTokens: totals.outputTokens } };
      }
      if (message.type !== "assistant" && message.type !== "user") deny();
      if (message.parent_tool_use_id !== null) deny();
      const content = z.object({ content: z.union([z.string(), z.array(record)]) }).parse(message.message).content;
      if (Array.isArray(content)) for (const block of content) {
        if (block.type === "tool_use") { if (!tools.some(({ wire }) => wire === block.name)) deny(); }
        else if (!["text", "thinking", "redacted_thinking", "tool_result"].includes(String(block.type))) deny();
      }
    }
  } catch (error) {
    throw new ClaudeComponentError(error instanceof ClaudeComponentError ? error.reason : "protocol");
  } finally {
    active = false; clearTimeout(timeout); controller.abort(); releaseInput();
    // The provisioner owns process-tree cleanup; iterator cleanup alone is insufficient.
    try { await close(); } catch { throw new ClaudeComponentError("cleanup"); }
  }
}
