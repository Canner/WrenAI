import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { StepRun, StepResponse } from "../../harness/components/runner.js";
import { CODEX_BASELINE_VERSION } from "./codex-compatibility.js";
import { CodexRpcClient, CodexRpcError, object, type RpcTransport, type RpcNotification } from "./codex-rpc.js";

/** Internal driver input from a certified provisioner, never browser configuration. */
export interface CodexComponentPolicy {
  readonly cwd: string;
  readonly codexHome: string;
  readonly permissionProfile: string;
  readonly model: string;
  readonly accountEmail: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  /** Revalidates approved account, exact executable, environment and generation. */
  assertCurrent(): void;
}
const id = z.string().min(1).max(256);
const callSchema = z.object({ threadId: id, turnId: id, callId: id, tool: id, arguments: z.unknown(), namespace: z.null().optional() }).strict();
const turnSchema = z.object({ id, status: z.enum(["inProgress", "completed", "failed", "interrupted"]), items: z.array(z.unknown()).max(512), itemsView: z.literal("full").default("full") });
const threadSchema = z.object({ id, cwd: z.string(), cliVersion: z.literal(CODEX_BASELINE_VERSION), ephemeral: z.literal(true) });
function deny(): never { throw new CodexRpcError("protocol"); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); return result.success ? result.data : deny(); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function configured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(configured);
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, configured(v)]));
  return value;
}
function validatePolicy(policy: CodexComponentPolicy): void {
  const c = policy.configuration;
  if (!policy.model || !policy.accountEmail || !policy.permissionProfile || c.default_permissions !== policy.permissionProfile
    || c.model_provider !== "openai" || c.approval_policy !== "never" || c.project_doc_max_bytes !== 0 || c.web_search !== "disabled"
    || !isDeepStrictEqual(c.mcp_servers, {}) || !isDeepStrictEqual(c.project_root_markers, [])) deny();
  const features = c.features;
  if (!object(features) || ["shell_tool", "unified_exec", "multi_agent", "apps", "plugins", "hooks"].some((name) => features[name] !== false)) deny();
  const permission = object(c.permissions) ? c.permissions[policy.permissionProfile] : undefined;
  if (!object(permission) || !isDeepStrictEqual(permission.network, { enabled: false }) || !object(permission.filesystem)
    || !isDeepStrictEqual(permission.filesystem, { "/": "deny" })) deny();
  if (!isDeepStrictEqual(c.shell_environment_policy, { inherit: "none", set: {} })) deny();
}


/** Explicit feature denylist for the reviewed vendor baseline; new enabled defaults refuse. */
export function codexComponentConfiguration(profile: string): Readonly<Record<string, unknown>> {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(profile)) deny();
  return {
    default_permissions: profile, model_provider: "openai", approval_policy: "never",
    project_doc_max_bytes: 0, project_root_markers: [], web_search: "disabled", mcp_servers: {},
    permissions: { [profile]: { filesystem: { "/": "deny" }, network: { enabled: false } } },
    shell_environment_policy: { inherit: "none", set: {} },
    features: Object.fromEntries([
      "shell_tool", "unified_exec", "multi_agent", "apps", "plugins", "hooks", "auth_elicitation",
      "mentions_v2", "remote_plugin", "tool_suggest", "memories", "remote_control", "mcp_2026_07_28",
      "browser_use", "browser_use_external", "browser_use_full_cdp_access", "computer_use", "code_mode_host",
      "code_mode", "code_mode_only", "image_generation", "in_app_browser", "multi_agent_v2", "plugin_sharing",
      "skill_mcp_dependency_install", "skill_search", "workspace_dependencies", "request_permissions_tool",
      "exec_permission_approvals", "guardian_approval", "guardianv2", "goals", "external_agent_memory_import",
      "realtime_conversation", "shell_snapshot", "standalone_web_search",
    ].map((name) => [name, false])),
  };
}

/** Fresh connection/thread per step. No spawn, activation, command RPC or provider fallback. */
export async function runCodexComponentStep(transport: RpcTransport, approved: CodexComponentPolicy, run: StepRun): Promise<StepResponse> {
  // Capture authority before callbacks or transport I/O can mutate the supplied object.
  const policy = freeze({ cwd: approved.cwd, codexHome: approved.codexHome,
    permissionProfile: approved.permissionProfile, model: approved.model, accountEmail: approved.accountEmail,
    configuration: structuredClone(approved.configuration), assertCurrent: approved.assertCurrent.bind(approved) });
  let phase: "init" | "thread" | "starting" | "running" | "finished" = "init";
  let threadId: string | undefined; let turnId: string | undefined;
  let finalText: string | undefined;
  let usage = { inputTokens: 0, outputTokens: 0 };
  const items = new Map<string, { type: string; done: boolean; completed?: unknown }>();
  const calls = new Set<string>();
  let failed = false; let threadStarted = false; let turnStarted = false;
  let queued: RpcNotification[] = []; let queuedBytes = 0;
  let pendingTools = 0; let toolQueue: Promise<unknown> = Promise.resolve();
  let resolveTurn!: () => void; let rejectTurn!: (error: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
  void completion.catch(() => {});
  let scopeReady!: () => void;
  const ready = new Promise<void>((resolve) => { scopeReady = resolve; });
  const check = () => { if (failed) deny(); run.signal.throwIfAborted(); policy.assertCurrent(); };
  const scope = (value: Record<string, unknown>) => { if (value.threadId !== threadId || value.turnId !== turnId) deny(); };
  const receive = (event: RpcNotification): void => {
    check();
    const p = object(event.params) ? event.params : deny();
    if (event.method === "remoteControl/status/changed") { if (p.status !== "disabled") deny(); return; }
    if (phase === "thread" || phase === "starting") {
      queuedBytes += Buffer.byteLength(JSON.stringify(event));
      if (queued.length >= 128 || queuedBytes > 1_048_576) deny(); queued.push(event); return;
    }
    if (event.method === "thread/started") {
      const t = parse(threadSchema, p.thread); if (threadStarted || t.id !== threadId || t.cwd !== policy.cwd) deny(); threadStarted = true; return;
    }
    if (!threadId || p.threadId !== threadId) deny();
    if (event.method === "thread/status/changed") {
      parse(z.object({ type: z.enum(["notLoaded", "idle", "systemError", "active"]) }), p.status); return;
    }
    if (phase !== "running") deny();
    if (event.method === "turn/started" || event.method === "turn/completed") {
      const t = parse(turnSchema, p.turn); if (t.id !== turnId) deny();
      if (event.method === "turn/started") { if (turnStarted || t.status !== "inProgress" || t.items.length) deny(); turnStarted = true; return; }
      const completedIds = new Set<string>();
      for (const raw of t.items) {
        const item = parse(z.object({ id, type: z.enum(["userMessage", "agentMessage", "reasoning", "dynamicToolCall"]) }).passthrough(), raw);
        const observed = items.get(item.id);
        if (completedIds.has(item.id) || !observed?.done || observed.type !== item.type || !isDeepStrictEqual(observed.completed, raw)) deny();
        completedIds.add(item.id);
      }
      if (!threadStarted || !turnStarted || completedIds.size !== items.size || t.status !== "completed" || pendingTools || [...items.values()].some((item) => !item.done) || finalText === undefined) deny();
      phase = "finished"; resolveTurn(); return;
    }
    scope(p);
    if (event.method === "thread/tokenUsage/updated") {
      const total = parse(z.object({ total: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }) }), p.tokenUsage).total;
      if (total.inputTokens < usage.inputTokens || total.outputTokens < usage.outputTokens) deny(); usage = total; return;
    }
    if (event.method === "item/started" || event.method === "item/completed") {
      parse(z.number().int().nonnegative(), p[event.method === "item/started" ? "startedAtMs" : "completedAtMs"]);
      const item = parse(z.object({ id, type: z.enum(["userMessage", "agentMessage", "reasoning", "dynamicToolCall"]) }).passthrough(), p.item);
      if (item.type === "dynamicToolCall" && (typeof item.tool !== "string" || !Object.hasOwn(run.tools, item.tool) || item.namespace != null)) deny();
      if (event.method === "item/started") {
        if (items.has(item.id) || items.size >= 512) deny(); items.set(item.id, { type: item.type, done: false });
      } else {
        const state = items.get(item.id); if (!state || state.done || state.type !== item.type) deny(); state.done = true; state.completed = structuredClone(p.item);
        if (item.type === "agentMessage") finalText = parse(z.string().max(1_048_576), item.text);
        if (item.type === "dynamicToolCall" && (!calls.has(item.id) || item.status !== "completed" || item.success !== true)) deny();
      }
      return;
    }
    if (!["item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded"].includes(event.method)
      || typeof p.itemId !== "string" || !items.has(p.itemId) || items.get(p.itemId)!.done) deny();
  };
  const rpc = new CodexRpcClient(transport, receive, 1_048_576, async (event) => {
    check(); if (event.method !== "item/tool/call" || (phase !== "starting" && phase !== "running")) deny();
    const call = parse(callSchema, event.params);
    if (calls.has(call.callId) || calls.size >= 32 || !Object.hasOwn(run.tools, call.tool)) deny();
    calls.add(call.callId); pendingTools++;
    const result = toolQueue.then(async () => {
      await Promise.race([ready, completion.then(deny)]); check(); scope(call); if (phase !== "running") deny();
      if (Buffer.byteLength(JSON.stringify(call.arguments)) > 65_536) deny();
      const output = await run.tools[call.tool]!(call.arguments); check(); if (phase !== "running") deny();
      const text = JSON.stringify(output); if (text === undefined || Buffer.byteLength(text) > 1_048_000) deny();
      return { contentItems: [{ type: "inputText", text }], success: true };
    });
    toolQueue = result.catch(() => { failed = true; rpc.fail("protocol"); });
    try { return await result; } finally { pendingTools--; }
  });
  rpc.onFailure((error) => { failed = true; rejectTurn(error); });
  const abort = () => rpc.fail("cancelled"); run.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => rpc.fail("timeout"), 120_000);
  const drain = () => { const events = queued; queued = []; queuedBytes = 0; for (const event of events) receive(event); };
  try {
    check(); validatePolicy(policy);
    const initialized = parse(z.object({ codexHome: z.literal(policy.codexHome), platformFamily: z.literal("unix"), platformOs: z.literal("macos"), userAgent: z.string() }), await rpc.request("initialize", { clientInfo: { name: "genbi-components", version: "1" }, capabilities: { experimentalApi: true } }));
    if (!initialized.userAgent.includes(`/${CODEX_BASELINE_VERSION} `)) deny(); rpc.notify("initialized", {});
    const effective = parse(z.object({ config: z.record(z.string(), z.unknown()) }), await rpc.request("config/read", { cwd: policy.cwd, includeLayers: false }));
    for (const [key, expected] of Object.entries(policy.configuration)) {
      if (key === "features") {
        const features = effective.config.features;
        if (!object(features) || Object.values(configured(features) as Record<string, unknown>).some((value) => value !== false) || !object(expected) || Object.keys(expected).some((name) => features[name] !== false)) deny();
      } else if (!isDeepStrictEqual(configured(effective.config[key]), configured(expected))) deny();
    }
    parse(z.object({ requiresOpenaiAuth: z.literal(true), account: z.object({ type: z.literal("chatgpt"), email: z.literal(policy.accountEmail) }) }), await rpc.request("account/read", { refreshToken: false }));
    check(); phase = "thread";
    const started = parse(z.object({ thread: threadSchema, model: z.literal(policy.model), modelProvider: z.literal("openai"),
      approvalPolicy: z.literal("never"), cwd: z.literal(policy.cwd),
      activePermissionProfile: z.object({ id: z.literal(policy.permissionProfile), extends: z.null().optional() }).strict(),
      instructionSources: z.array(z.never()).default([]), runtimeWorkspaceRoots: z.array(z.never()).default([]),
    }), await rpc.request("thread/start", {
      cwd: policy.cwd, model: policy.model, modelProvider: "openai", permissions: policy.permissionProfile, approvalPolicy: "never", ephemeral: true,
      runtimeWorkspaceRoots: [], environments: [], allowProviderModelFallback: false,
      baseInstructions: [run.brief, run.prompt].filter(Boolean).join("\n\n"), developerInstructions: "",
      dynamicTools: Object.keys(run.tools).map((name) => ({ name, description: run.toolDescriptions[name] ?? name, inputSchema: run.toolSchemas[name] ?? deny() })),
    }));
    if (started.thread.cwd !== policy.cwd) deny(); threadId = started.thread.id; phase = "init"; drain();
    phase = "starting";
    const startedTurn = parse(z.object({ turn: turnSchema }), await rpc.request("turn/start", {
      threadId, model: policy.model, permissions: policy.permissionProfile, approvalPolicy: "never", cwd: policy.cwd, runtimeWorkspaceRoots: [], environments: [],
      input: [{ type: "text", text: JSON.stringify({ request: run.request, input: run.input, consumes: run.consumes }) }],
    }));
    if (startedTurn.turn.status !== "inProgress") deny(); turnId = startedTurn.turn.id; phase = "running"; scopeReady(); drain();
    await completion; check(); return { value: finalText, usage };
  } catch (error) {
    rpc.fail(error instanceof CodexRpcError ? error.reason : "protocol");
    throw new CodexRpcError(error instanceof CodexRpcError ? error.reason : "protocol");
  } finally { phase = "finished"; clearTimeout(timer); run.signal.removeEventListener("abort", abort); await rpc.close(); }
}
