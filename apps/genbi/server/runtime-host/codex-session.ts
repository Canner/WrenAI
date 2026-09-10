import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CODEX_BASELINE_VERSION } from "./codex-compatibility.js";
import { codexThreadSchema, codexTurnSchema, parseCodexEvent, type CodexEvent } from "./codex-events.js";
import type { CodexSessionPolicy } from "./codex-policy.js";
import { CodexRpcClient, CodexRpcError, object, type RpcTransport } from "./codex-rpc.js";
import { isDeepStrictEqual } from "node:util";

type Turn = z.infer<typeof codexTurnSchema>;
const sizeSchema = z.object({ cols: z.number().int().min(1).max(500), rows: z.number().int().min(1).max(500) }).strict();
const commandSchema = z.object({
  command: z.array(z.string().max(65_536).refine((v) => !v.includes("\0"))).min(1).max(256),
  tty: z.boolean().default(false), size: sizeSchema.optional(),
  timeoutMs: z.number().int().min(1).max(300_000).default(30_000),
}).strict().refine((v) => !v.size || v.tty);
const commandResultSchema = z.object({ exitCode: z.number().int(), stdout: z.literal(""), stderr: z.literal("") });
export type CodexCommandInput = z.input<typeof commandSchema>;
export interface CodexCommand {
  readonly id: string;
  readonly completed: Promise<{ exitCode: number }>;
  write(bytes: Uint8Array, closeStdin?: boolean): Promise<void>;
  resize(size: { cols: number; rows: number }): Promise<void>;
  terminate(): Promise<void>;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CodexRpcError("protocol");
  return result.data;
}
// Config/read expands optional TOML fields into nulls. Null is absence, not
// permission; every non-null profile/network/environment field must match.
function configured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(configured);
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => [key, configured(item)]));
  return value;
}
interface ActiveTurn {
  id?: string;
  started: boolean;
  early: CodexEvent[];
  earlyBytes: number;
  resolve(value: Turn): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  detach(): void;
  items: Map<string, { type: string; completed: boolean }>;
}

/**
 * Internal protocol driver. It has no spawn, readiness or certification grant;
 * only CodexAppServerBackend may compose it with a real process. Tests can use
 * an in-memory transport without creating an activation path.
 */
export class CodexSession {
  private readonly rpc: CodexRpcClient;
  private threadId?: string;
  private startingThread = false;
  private threadEventId?: string;
  private turn: ActiveTurn | undefined;
  private commands = new Map<string, { tty: boolean; stdinClosed: boolean; bytes: number }>();
  private ready = false;
  private closed = false;
  private closePromise?: Promise<void>;
  private constructor(
    transport: RpcTransport, private readonly policy: CodexSessionPolicy,
    private readonly revalidate: () => void, private readonly emit: (event: CodexEvent) => void,
  ) {
    this.rpc = new CodexRpcClient(transport, ({ method, params }) => this.receive(parseCodexEvent(method, params)));
    this.rpc.onFailure((error) => {
      this.closed = true;
      if (this.turn) this.settleTurn(undefined, error);
      this.commands.clear();
    });
  }
  static async connect(transport: RpcTransport, policy: CodexSessionPolicy, revalidate: () => void, emit: (event: CodexEvent) => void, created?: (session: CodexSession) => void): Promise<CodexSession> {
    const session = new CodexSession(transport, policy, revalidate, emit);
    try {
      created?.(session);
      const initialized = parse(z.object({ codexHome: z.literal(policy.codexHome), platformFamily: z.literal("unix"), platformOs: z.literal("macos"), userAgent: z.string().min(1) }), await session.rpc.request("initialize", {
        clientInfo: { name: "genbi", version: "0.0.4" }, capabilities: { experimentalApi: true },
      }));
      if (!initialized.userAgent.includes(`/${CODEX_BASELINE_VERSION} `)) throw new CodexRpcError("protocol");
      session.rpc.notify("initialized", {});
      const effective = await session.rpc.request("config/read", { cwd: policy.cwd, includeLayers: false });
      if (!object(effective) || !object(effective.config)) throw new CodexRpcError("protocol");
      for (const [key, expected] of Object.entries(policy.configuration)) {
        const actual = effective.config[key];
        if (key === "features") {
          if (!object(actual) || !object(expected) || Object.entries(expected).some(([name, value]) => !isDeepStrictEqual(actual[name], value))) throw new CodexRpcError("protocol");
        } else if (!isDeepStrictEqual(configured(actual), configured(expected))) throw new CodexRpcError("protocol");
      }
      const profiles = parse(z.object({ data: z.array(z.object({ id: z.string(), allowed: z.boolean() })), nextCursor: z.null().optional() }), await session.rpc.request("permissionProfile/list", { cwd: policy.cwd }));
      if (profiles.data.filter((p) => p.id === policy.profile && p.allowed).length !== 1) throw new CodexRpcError("permission");
      if (session.closed) throw new CodexRpcError("closed");
      session.ready = true;
      return session;
    } catch (error) { await session.close(); throw error; }
  }
  private check(): void {
    if (this.closed || !this.ready) throw new CodexRpcError("closed");
    try { this.revalidate(); } catch { this.rpc.fail("protocol"); throw new CodexRpcError("protocol"); }
  }
  private protocolFailure(): never { this.rpc.fail("protocol"); throw new CodexRpcError("protocol"); }
  async startThread(): Promise<string> {
    this.check();
    if (this.threadId || this.startingThread) throw new CodexRpcError("protocol");
    this.startingThread = true;
    try {
      const result = parse(z.object({ thread: codexThreadSchema }), await this.rpc.request("thread/start", {
        cwd: this.policy.cwd, permissions: this.policy.profile, approvalPolicy: "never", ephemeral: true,
        runtimeWorkspaceRoots: [this.policy.cwd], environments: [], dynamicTools: [],
        allowProviderModelFallback: false,
      }));
      this.validateThread(result.thread);
      if (this.threadEventId && result.thread.id !== this.threadEventId) this.protocolFailure();
      this.threadId = result.thread.id;
      return result.thread.id;
    } catch (error) { this.rpc.fail("protocol"); throw error; }
    finally { this.startingThread = false; }
  }
  private validateThread(thread: z.infer<typeof codexThreadSchema>): void {
    if (thread.cwd !== this.policy.cwd || thread.cliVersion !== CODEX_BASELINE_VERSION || !thread.ephemeral) this.protocolFailure();
  }
  /** Completes on turn/completed, not the immediate turn/start acknowledgement. */
  async runTurn(text: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Turn> {
    this.check();
    if (!this.threadId || this.turn || typeof text !== "string" || text.length === 0 || Buffer.byteLength(text) > 262_144) throw new CodexRpcError("protocol");
    const timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new CodexRpcError("protocol");
    if (options.signal?.aborted) { await this.close(); throw new CodexRpcError("cancelled"); }
    const abort = () => this.rpc.fail("cancelled");
    let active!: ActiveTurn;
    const completion = new Promise<Turn>((resolve, reject) => {
      active = { resolve, reject, started: false, early: [], earlyBytes: 0, items: new Map(),
        timer: setTimeout(() => this.rpc.fail("timeout"), timeoutMs),
        detach: () => options.signal?.removeEventListener("abort", abort),
      };
    });
    this.turn = active;
    // Install rejection handling before a synchronous transport can fail.
    void completion.catch(() => {});
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = parse(z.object({ turn: codexTurnSchema }), await this.rpc.request("turn/start", {
        threadId: this.threadId, input: [{ type: "text", text }], cwd: this.policy.cwd,
        permissions: this.policy.profile, approvalPolicy: "never", runtimeWorkspaceRoots: [this.policy.cwd], environments: [],
      }, Math.min(timeoutMs, 10_000)));
      if (this.turn !== active || result.turn.status !== "inProgress") this.protocolFailure();
      active.id = result.turn.id;
      const queued = active.early; active.early = []; active.earlyBytes = 0;
      for (const event of queued) this.receive(event);
      return await completion;
    } catch (error) {
      this.rpc.fail(error instanceof CodexRpcError ? error.reason : "protocol");
      await this.close();
      throw error instanceof CodexRpcError ? error : new CodexRpcError("protocol");
    }
  }
  async interruptTurn(): Promise<void> {
    this.check();
    const active = this.turn;
    if (!active?.id) throw new CodexRpcError("protocol");
    try {
      parse(z.object({}).strict(), await this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: active.id }, 2_000));
      // An ack is not completion. Bound how long a silent peer may keep working.
      if (this.turn === active) { clearTimeout(active.timer); active.timer = setTimeout(() => this.rpc.fail("timeout"), 2_000); }
    } catch { await this.close(); throw new CodexRpcError("protocol"); }
  }
  startCommand(input: CodexCommandInput, signal?: AbortSignal): CodexCommand {
    this.check();
    const command = parse(commandSchema, input);
    if (this.commands.size >= 16 || !command.command[0]) throw new CodexRpcError("protocol");
    const id = randomUUID();
    const state = { tty: command.tty, stdinClosed: false, bytes: 0 };
    this.commands.set(id, state);
    const completed = this.rpc.request("command/exec", {
      ...command, processId: id, cwd: this.policy.cwd, permissionProfile: this.policy.profile,
      env: this.policy.commandEnvironment, streamStdin: true, streamStdoutStderr: true, outputBytesCap: 262_144,
    }, command.timeoutMs + 3_000, signal).then((value) => {
      const result = parse(commandResultSchema, value);
      this.commands.delete(id);
      return { exitCode: result.exitCode };
    }).catch(async (error: unknown) => {
      this.rpc.fail(error instanceof CodexRpcError ? error.reason : "protocol");
      await this.close(); throw error instanceof CodexRpcError ? error : new CodexRpcError("protocol");
    });
    void completed.catch(() => {});
    const control = async (method: string, params: object) => {
      this.check();
      if (!this.commands.has(id)) throw new CodexRpcError("closed");
      try { parse(z.object({}).strict(), await this.rpc.request(method, { processId: id, ...params }, 2_000)); }
      catch (error) { this.rpc.fail("protocol"); await this.close(); throw error; }
    };
    return Object.freeze({ id, completed,
      write: async (bytes: Uint8Array, closeStdin = false) => {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65_536 || state.stdinClosed || typeof closeStdin !== "boolean") throw new CodexRpcError("protocol");
        if (closeStdin) state.stdinClosed = true;
        await control("command/exec/write", { deltaBase64: Buffer.from(bytes).toString("base64"), closeStdin });
      },
      resize: async (size: { cols: number; rows: number }) => {
        if (!state.tty) throw new CodexRpcError("protocol");
        await control("command/exec/resize", { size: parse(sizeSchema, size) });
      },
      terminate: async () => {
        await control("command/exec/terminate", {});
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([completed, new Promise<never>((_, reject) => { timer = setTimeout(() => { this.rpc.fail("timeout"); reject(new CodexRpcError("timeout")); }, 2_000); })]); }
        catch (error) { await this.close(); throw error; }
        finally { clearTimeout(timer); }
      },
    });
  }
  private settleTurn(value?: Turn, error?: unknown): void {
    const active = this.turn;
    if (!active) return;
    this.turn = undefined; clearTimeout(active.timer); active.detach();
    if (value) active.resolve(value); else active.reject(error);
  }
  private receive(event: CodexEvent): void {
    if (this.closed) return;
    if (event.method === "remoteControl/status/changed") return; // validated disabled; never forward host identity
    if (event.method === "command/exec/outputDelta") {
      const command = this.commands.get(event.params.processId);
      if (!command || (command.tty && event.params.stream !== "stdout")) this.protocolFailure();
      command!.bytes += Buffer.from(event.params.deltaBase64, "base64").byteLength;
      if (command!.bytes > 524_288) this.protocolFailure();
      this.emit(event); return;
    }
    if (event.method === "thread/started") {
      this.validateThread(event.params.thread);
      if (this.threadEventId || (!this.startingThread && this.threadId !== event.params.thread.id)) this.protocolFailure();
      this.threadEventId = event.params.thread.id; return;
    }
    if (!this.threadId || event.params.threadId !== this.threadId) this.protocolFailure();
    if (event.method === "thread/status/changed") { this.emit(event); return; }
    const active = this.turn;
    if (!active) this.protocolFailure();
    if (!active!.id) {
      active!.earlyBytes += Buffer.byteLength(JSON.stringify(event));
      if (active!.early.length >= 128 || active!.earlyBytes > 1_048_576) this.protocolFailure();
      active!.early.push(event); return;
    }
    const turnId = "turn" in event.params ? event.params.turn.id : event.params.turnId;
    if (turnId !== active!.id) this.protocolFailure();
    if (event.method === "turn/started") {
      if (active!.started || event.params.turn.status !== "inProgress") this.protocolFailure();
      active!.started = true;
    } else if (event.method === "turn/completed") {
      if (event.params.turn.status === "inProgress") this.protocolFailure();
      this.emit(event); this.settleTurn(event.params.turn); return;
    } else if (event.method === "item/started") {
      if (active!.items.has(event.params.item.id) || active!.items.size >= 512) this.protocolFailure();
      active!.items.set(event.params.item.id, { type: event.params.item.type, completed: false });
    } else if (event.method === "item/completed") {
      const item = active!.items.get(event.params.item.id);
      if (!item || item.completed || item.type !== event.params.item.type) this.protocolFailure();
      item!.completed = true;
    } else if ("itemId" in event.params) {
      const item = active!.items.get(event.params.itemId);
      if (!item || item.completed) this.protocolFailure();
    }
    this.emit(event);
  }
  /** Disconnect and BFF shutdown use the same bounded, connection-owned close. */
  onFailure(listener: (error: CodexRpcError) => void): () => void {
    return this.rpc.onFailure(listener);
  }

  close(): Promise<void> {
    this.closed = true;
    this.closePromise ??= this.rpc.close();
    return this.closePromise;
  }
}
