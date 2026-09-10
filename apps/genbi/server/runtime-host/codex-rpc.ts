/** Codex JSONL is JSON-RPC with the jsonrpc header omitted. No raw diagnostics. */
export type RpcFailure = "protocol" | "closed" | "transport" | "timeout" | "cancelled" | "remote" | "cleanup" | "permission";
export class CodexRpcError extends Error {
  constructor(readonly reason: RpcFailure) { super(`Codex RPC ${reason}`); }
}
export interface RpcTransport {
  listen(handlers: { data(chunk: Buffer): void; end(): void; error(): void }): void;
  write(line: string): void;
  /** Resolves only when owned processes are gone; rejects on incomplete cleanup. */
  close(): Promise<void>;
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export interface RpcNotification { readonly method: string; readonly params: unknown }
type Pending = {
  resolve(value: unknown): void; reject(error: CodexRpcError): void;
  timer: ReturnType<typeof setTimeout>; removeAbort(): void;
};

export class CodexRpcClient {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private failure?: CodexRpcError;
  private closing?: Promise<void>;
  private failureListeners = new Set<(error: CodexRpcError) => void>();
  constructor(
    private readonly transport: RpcTransport,
    private readonly notification: (message: RpcNotification) => void,
    private readonly maxLineBytes = 1_048_576,
  ) {
    transport.listen({
      data: (chunk) => this.receive(chunk),
      end: () => this.fail("closed"),
      error: () => this.fail("transport"),
    });
  }
  onFailure(listener: (error: CodexRpcError) => void): () => void {
    if (this.failure) listener(this.failure);
    else this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }
  request(method: string, params: unknown, timeoutMs = 10_000, signal?: AbortSignal): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 128) { this.fail("protocol"); return Promise.reject(this.failure); }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_600_000) return Promise.reject(new CodexRpcError("protocol"));
    if (signal?.aborted) { this.fail("cancelled"); return Promise.reject(this.failure); }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => this.fail("cancelled");
      const timer = setTimeout(() => this.fail("timeout"), timeoutMs);
      // Registration must precede write, including an in-process synchronous peer.
      this.pending.set(id, { resolve, reject, timer, removeAbort: () => signal?.removeEventListener("abort", abort) });
      signal?.addEventListener("abort", abort, { once: true });
      this.send({ id, method, params });
    });
  }
  notify(method: string, params: unknown): void {
    if (this.failure) throw this.failure;
    this.send({ method, params });
    if (this.failure) throw this.failure;
  }
  private send(message: unknown): void {
    try {
      const line = JSON.stringify(message) + "\n";
      if (Buffer.byteLength(line) > this.maxLineBytes) return this.fail("protocol");
      this.transport.write(line);
    } catch { this.fail("transport"); }
  }
  private receive(chunk: Buffer): void {
    if (this.failure) return;
    // Never retain more than one bounded frame; a chunk may contain many frames.
    let offset = 0;
    while (offset < chunk.length && !this.failure) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      if (this.buffer.length + end - offset > this.maxLineBytes) return this.fail("protocol");
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, end)]);
      if (newline < 0) return;
      const line = this.buffer; this.buffer = Buffer.alloc(0); offset = newline + 1;
      this.handleLine(line);
    }
  }
  private handleLine(line: Buffer): void {
    try {
      const message: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
      if (!object(message)) return this.fail("protocol");
      if ("id" in message) {
        // No unsolicited approval/tool requests are supported by this backend.
        if ("method" in message || !Number.isSafeInteger(message.id)) return this.fail("protocol");
        if (("result" in message) === ("error" in message)) return this.fail("protocol");
        const pending = this.pending.get(message.id as number);
        if (!pending) return this.fail("protocol"); // duplicates and unknown/late ids
        if ("error" in message) {
          if (!object(message.error) || !Number.isInteger(message.error.code) || typeof message.error.message !== "string") return this.fail("protocol");
          return this.fail("remote");
        }
        this.pending.delete(message.id as number);
        clearTimeout(pending.timer); pending.removeAbort(); pending.resolve(message.result);
      } else {
        if (typeof message.method !== "string" || !("params" in message) || "result" in message || "error" in message) return this.fail("protocol");
        this.notification({ method: message.method, params: message.params });
      }
    } catch { this.fail("protocol"); }
  }
  fail(reason: RpcFailure): void {
    if (this.failure) return;
    this.failure = new CodexRpcError(reason);
    this.buffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer); pending.removeAbort(); pending.reject(this.failure);
    }
    this.pending.clear();
    this.closing = Promise.resolve().then(() => this.transport.close()).catch(() => { throw new CodexRpcError("cleanup"); });
    // Failures remain observable through close(), without an unhandled rejection.
    void this.closing.catch(() => {});
    for (const listener of this.failureListeners) { try { listener(this.failure); } catch { /* no raw callback errors */ } }
    this.failureListeners.clear();
  }
  async close(): Promise<void> { this.fail("closed"); await this.closing; }
}
