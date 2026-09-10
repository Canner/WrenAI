import { randomUUID, timingSafeEqual } from "node:crypto";
import { CodexBackendError, type CodexAppServerBackend, type CodexLaunchPermit } from "./codex-app-server.js";
import { parseCodexEvent, type CodexEvent } from "./codex-events.js";
import { CodexRpcError } from "./codex-rpc.js";
import type { CodexSession } from "./codex-session.js";
import type { RuntimeBackendReasonCode } from "./types.js";

export type ConversationState = "opening" | "ready" | "running" | "closing" | "closed" | "failed";
export type ConversationFailure = "unavailable" | "protocol" | "timeout" | "cancelled" | "cleanup" | "delivery";
export class CodexConversationError extends Error {
  constructor(readonly code: ConversationFailure | "attachment" | "busy" | "input" | "closed",
    readonly backendReason?: RuntimeBackendReasonCode<"codex-app-server">) {
    super("Codex conversation: " + code);
  }
}
type ConversationEvent = Exclude<CodexEvent, { method: "command/exec/outputDelta" | "remoteControl/status/changed" | "thread/started" }>;
export type ConversationFrame =
  | { readonly type: "event"; readonly sequence: number; readonly event: ConversationEvent }
  | { readonly type: "state"; readonly sequence: number; readonly state: ConversationState; readonly failure?: ConversationFailure; readonly backendReason?: RuntimeBackendReasonCode<"codex-app-server"> };
export interface ConversationReplay {
  readonly type: "replay";
  readonly afterSequence: number;
  readonly throughSequence: number;
  readonly truncated: boolean;
  readonly retainedBytes: number;
  readonly retentionLimitBytes: number;
  readonly state: ConversationState;
  readonly failure?: ConversationFailure;
  readonly backendReason?: RuntimeBackendReasonCode<"codex-app-server">;
}
export interface CodexConversationAttachment {
  submit(text: string): Promise<{ readonly turnId: string; readonly status: "completed" | "interrupted" | "failed" }>;
  interrupt(): Promise<void>;
  detach(): void;
}
type Driver = Pick<CodexSession, "startThread" | "runTurn" | "interruptTurn" | "close" | "onFailure">;
type OpenInput = Omit<Parameters<CodexAppServerBackend["open"]>[1], "onEvent">;
interface Backend { open(permit: CodexLaunchPermit, input: OpenInput & { onEvent(event: CodexEvent): void }): Promise<Driver> }
interface Attachment {
  readonly listener: (frame: ConversationFrame | ConversationReplay) => void;
  readonly queue: string[];
  queuedBytes: number;
  draining: boolean;
}
const MAX_BYTES = 1_048_576;
const MAX_FRAMES = 256;
function failure(error: unknown): ConversationFailure {
  if (error instanceof CodexConversationError && ["protocol", "timeout", "cancelled", "cleanup", "delivery"].includes(error.code)) return error.code as ConversationFailure;
  if (error instanceof CodexBackendError && error.code === "codex_app_server_cleanup_failed") return "cleanup";
  if (error instanceof CodexRpcError) {
    if (error.reason === "cleanup" || error.reason === "timeout" || error.reason === "cancelled") return error.reason;
    return "protocol";
  }
  return "unavailable";
}

/**
 * Process-local Phase 5 bridge, not an application activation path.
 * The host obtains the permit before durable writes and owns scope materialization.
 * Browser code receives only attachment methods and projected frames, never a driver.
 */
export class CodexConversation {
  readonly capability = randomUUID();
  readonly ready: Promise<void>;
  private state: ConversationState = "opening";
  private failed?: ConversationFailure;
  private backendReason: RuntimeBackendReasonCode<"codex-app-server"> | undefined;
  private sequence = 0;
  private retainedBytes = 0;
  private frames: { sequence: number; json: string; bytes: number }[] = [];
  private owner: Attachment | undefined;
  private driver?: Driver;
  private readonly connection: Promise<Driver>;
  private closing?: Promise<void>;
  private detachFailure?: () => void;
  private active: Promise<{ turnId: string; status: "completed" | "interrupted" | "failed" }> | undefined;
  private interrupting: Promise<void> | undefined;
  private turnStarted = false;
  private rejectStopped!: (error: CodexConversationError) => void;
  private readonly stopped = new Promise<never>((_, reject) => { this.rejectStopped = reject; });

  constructor(backend: Backend, permit: CodexLaunchPermit, input: OpenInput) {
    void this.stopped.catch(() => {});
    // Defer open until ownership of both promises exists; synchronous fake peers
    // and early events must obey the same lifecycle as the production backend.
    this.connection = Promise.resolve().then(() => {
      if (this.state !== "opening") throw new CodexConversationError("closed");
      permit.assertActive();
      return backend.open(permit, { ...input, onEvent: (event) => this.receive(event) });
    }).then((driver) => {
      this.driver = driver;
      this.detachFailure = driver.onFailure((error) => {
        if (this.state !== "closing" && this.state !== "closed" && this.state !== "failed") {
          void this.finish(failure(error)).catch(() => {});
        }
      });
      return driver;
    }).catch((error: unknown) => {
      if (error instanceof CodexBackendError) this.backendReason = error.code;
      permit.release(); throw error;
    });
    this.ready = this.initialize();
    void this.ready.catch(() => {});
  }
  snapshot(): { state: ConversationState; failure?: ConversationFailure; backendReason?: RuntimeBackendReasonCode<"codex-app-server">; sequence: number } {
    return { state: this.state, ...(this.failed ? { failure: this.failed } : {}),
      ...(this.backendReason ? { backendReason: this.backendReason } : {}), sequence: this.sequence };
  }
  private async initialize(): Promise<void> {
    try {
      const driver = await this.connection;
      if (this.state !== "opening") throw new CodexConversationError("closed");
      await driver.startThread();
      if (this.state !== "opening") throw new CodexConversationError("closed");
      this.transition("ready");
      if (this.snapshot().state !== "ready") throw new CodexConversationError("closed");
    } catch (error) {
      await this.finish(failure(error));
      throw new CodexConversationError(this.failed ?? (this.closing ? "closed" : failure(error)), this.backendReason);
    }
  }
  private receive(value: CodexEvent): void {
    if (this.state === "closing" || this.state === "closed" || this.state === "failed") return;
    try {
      const event = parseCodexEvent(value.method, value.params);
      if (event.method === "command/exec/outputDelta" || event.method === "remoteControl/status/changed" || event.method === "thread/started") {
        throw new CodexConversationError("protocol");
      }
      if (event.method === "turn/started") this.turnStarted = true;
      this.record({ type: "event", sequence: ++this.sequence, event });
    } catch {
      void this.finish("protocol").catch(() => {});
      throw new CodexConversationError("protocol");
    }
  }
  private transition(state: ConversationState, code?: ConversationFailure): void {
    this.state = state;
    if (code) this.failed = code;
    this.record({ type: "state", sequence: ++this.sequence, state, ...(this.failed ? { failure: this.failed } : {}),
      ...(this.backendReason ? { backendReason: this.backendReason } : {}) });
  }
  private record(frame: ConversationFrame): void {
    const json = JSON.stringify(frame);
    const bytes = Buffer.byteLength(json);
    if (bytes > MAX_BYTES) throw new CodexConversationError("protocol");
    this.frames.push({ sequence: frame.sequence, json, bytes }); this.retainedBytes += bytes;
    while (this.frames.length > MAX_FRAMES || this.retainedBytes > MAX_BYTES) {
      this.retainedBytes -= this.frames.shift()!.bytes;
    }
    if (this.owner) {
      if (this.owner.queue.length >= MAX_FRAMES + 1 || this.owner.queuedBytes + bytes > MAX_BYTES + 4096) { this.deliveryFailed(); return; }
      this.owner.queue.push(json); this.owner.queuedBytes += bytes; this.drain(this.owner);
    }
  }
  private deliveryFailed(): void {
    this.owner = undefined;
    void this.finish("delivery").catch(() => {});
  }
  private drain(owner: Attachment): void {
    if (owner.draining) return;
    owner.draining = true;
    try {
      // Reentrant live events append behind the captured replay, never inside it.
      let delivered = 0;
      while (this.owner === owner && owner.queue.length) {
        if (++delivered > MAX_FRAMES * 2 + 1) { this.deliveryFailed(); break; }
        const json = owner.queue.shift()!;
        owner.queuedBytes -= Buffer.byteLength(json);
        owner.listener(JSON.parse(json));
      }
    } catch { this.deliveryFailed(); }
    finally { owner.draining = false; }
  }
  attach(capability: string, listener: Attachment["listener"], afterSequence = 0): CodexConversationAttachment {
    if (typeof capability !== "string" || capability.length !== this.capability.length) throw new CodexConversationError("attachment");
    const supplied = Buffer.from(capability);
    const expected = Buffer.from(this.capability);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || this.owner || typeof listener !== "function") throw new CodexConversationError("attachment");
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || afterSequence > this.sequence) throw new CodexConversationError("input");
    const replay: ConversationReplay = { type: "replay", afterSequence, throughSequence: this.sequence,
      truncated: afterSequence < (this.frames[0]?.sequence ?? 1) - 1,
      retainedBytes: this.retainedBytes, retentionLimitBytes: MAX_BYTES, state: this.state,
      ...(this.failed ? { failure: this.failed } : {}), ...(this.backendReason ? { backendReason: this.backendReason } : {}) };
    const queue = [JSON.stringify(replay), ...this.frames.filter((frame) => frame.sequence > afterSequence).map((frame) => frame.json)];
    const owner: Attachment = { listener, queue, queuedBytes: queue.reduce((sum, json) => sum + Buffer.byteLength(json), 0), draining: false };
    this.owner = owner;
    const assertOwner = () => { if (this.owner !== owner) throw new CodexConversationError("attachment"); };
    const handle = Object.freeze({
      submit: (text: string) => { assertOwner(); return this.submit(text); },
      interrupt: () => { assertOwner(); return this.interrupt(); },
      detach: () => { if (this.owner === owner) this.owner = undefined; },
    });
    this.drain(owner);
    return handle;
  }
  private submit(text: string): Promise<{ turnId: string; status: "completed" | "interrupted" | "failed" }> {
    if (this.active) throw new CodexConversationError("busy");
    if (this.state !== "ready" || !this.driver) throw new CodexConversationError("closed");
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 262_144) throw new CodexConversationError("input");
    const driver = this.driver;
    this.turnStarted = false;
    const active = Promise.resolve().then(async () => {
      if (this.state !== "running") throw new CodexConversationError("closed");
      const result = await Promise.race([driver.runTurn(text), this.stopped]);
      if (result.status === "inProgress") throw new CodexConversationError("protocol");
      return { turnId: result.id, status: result.status };
    }).catch(async (error: unknown) => {
      await this.finish(failure(error));
      throw new CodexConversationError(this.failed ?? (error instanceof CodexConversationError ? error.code : failure(error)));
    }).finally(() => {
      this.active = undefined; this.interrupting = undefined;
      if (this.state === "running") this.transition("ready");
    });
    this.active = active;
    void active.catch(() => {});
    this.transition("running");
    return active;
  }
  private interrupt(): Promise<void> {
    if (!this.active || this.state !== "running" || !this.driver) throw new CodexConversationError("closed");
    // Before turn/start is acknowledged there is no interruptible vendor ID.
    // Closing the owned connection cancels that early window without guessing it.
    if (!this.turnStarted) return this.finish("cancelled");
    const active = this.active;
    this.interrupting ??= this.driver.interruptTurn().then(async () => { await active; }).catch(async (error: unknown) => {
      await this.finish(failure(error)); throw new CodexConversationError(this.failed ?? failure(error));
    });
    void this.interrupting.catch(() => {});
    return this.interrupting;
  }
  /** Detach retains the conversation; the Sessions lease owner decides when to close. */
  close(): Promise<void> { return this.finish(); }
  private finish(code?: ConversationFailure): Promise<void> {
    if (this.closing) return this.closing;
    if (code) this.failed = code;
    this.state = "closing";
    this.rejectStopped(new CodexConversationError(code ?? "closed"));
    this.closing = Promise.resolve().then(async () => {
      try {
        let driver: Driver | undefined;
        try { driver = await this.connection; }
        catch (error) { if (failure(error) === "cleanup") throw error; }
        await driver?.close();
        this.detachFailure?.();
        this.transition(this.failed ? "failed" : "closed");
      } catch {
        this.backendReason = "codex_app_server_cleanup_failed";
        this.detachFailure?.();
        this.transition("failed", "cleanup");
        throw new CodexConversationError("cleanup", this.backendReason);
      } finally { this.owner = undefined; }
    });
    void this.closing.catch(() => {});
    return this.closing;
  }
}
