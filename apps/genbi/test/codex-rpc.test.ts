import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexRpcClient, CodexRpcError, type RpcTransport } from "../server/runtime-host/codex-rpc.js";

class Peer implements RpcTransport {
  handlers!: Parameters<RpcTransport["listen"]>[0];
  writes: { id?: number; method: string; params: unknown }[] = [];
  answer: ((message: Peer["writes"][number]) => void) | undefined;
  close = vi.fn(async () => {});
  listen(handlers: Peer["handlers"]) { this.handlers = handlers; }
  write(line: string) {
    const message = JSON.parse(line) as Peer["writes"][number];
    this.writes.push(message); this.answer?.(message);
  }
  line(value: unknown) { this.handlers.data(Buffer.from(JSON.stringify(value) + "\n")); }
}
afterEach(() => vi.useRealTimers());

describe("Codex RPC lifecycle", () => {
  it("registers before synchronous replies and correlates out-of-order requests", async () => {
    const peer = new Peer(); const rpc = new CodexRpcClient(peer, () => {});
    peer.answer = (request) => peer.line({ id: request.id, result: "immediate" });
    await expect(rpc.request("initialize", {})).resolves.toBe("immediate");
    peer.answer = undefined;
    const first = rpc.request("a", {}); const second = rpc.request("b", {});
    peer.line({ id: peer.writes[2]!.id, result: 2 });
    peer.line({ id: peer.writes[1]!.id, result: 1 });
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    await rpc.close();
  });

  it("frames split UTF-8 and multiple frames in a single chunk", async () => {
    const peer = new Peer(); const event = vi.fn();
    const rpc = new CodexRpcClient(peer, event);
    const bytes = Buffer.from('{"method":"event","params":"中文"}\n{"method":"event","params":2}\n');
    for (const byte of bytes) peer.handlers.data(Buffer.from([byte]));
    expect(event.mock.calls).toEqual([[{ method: "event", params: "中文" }], [{ method: "event", params: 2 }]]);
    await rpc.close();
  });

  it.each([
    "secret MODEL_OUTPUT", "null", "[]", '{"id":1,"result":0,"error":{}}',
    '{"id":"1","result":0}', '{"id":1}', '{"id":1,"method":"approve","params":{"token":"SECRET"}}',
    '{"id":999,"result":0}', '{"method":"unknown","params":{},"result":1}',
    '{"method":1,"params":{}}', '{"method":"event"}',
  ])("rejects every pending request without raw content for malformed frame %s", async (line) => {
    const peer = new Peer(); const rpc = new CodexRpcClient(peer, () => {});
    const results = Promise.allSettled([rpc.request("a", {}), rpc.request("b", {})]);
    expect(() => peer.handlers.data(Buffer.from(line + "\n"))).not.toThrow();
    for (const result of await results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(CodexRpcError);
        expect(result.reason.message).toBe("Codex RPC protocol");
      }
    }
    await expect(rpc.request("later", {})).rejects.toThrow("Codex RPC protocol");
    await rpc.close(); expect(peer.close).toHaveBeenCalledTimes(1);
  });

  it.each(["end", "error"] as const)("settles work and owns cleanup after %s", async (event) => {
    const peer = new Peer(); const rpc = new CodexRpcClient(peer, () => {});
    const result = Promise.allSettled([rpc.request("a", {}), rpc.request("b", {})]);
    peer.handlers[event]();
    expect((await result).every((value) => value.status === "rejected")).toBe(true);
    await rpc.close(); expect(peer.close).toHaveBeenCalledTimes(1);
  });

  it("redacts remote errors and write failures", async () => {
    for (const writeFailure of [true, false]) {
      const peer = new Peer(); const rpc = new CodexRpcClient(peer, () => {});
      peer.answer = (request) => {
        if (writeFailure) throw new Error("TOKEN=secret");
        peer.line({ id: request.id, error: { code: -1, message: "TOKEN=secret", data: "model output" } });
      };
      await expect(rpc.request("a", {})).rejects.toThrow(writeFailure ? "Codex RPC transport" : "Codex RPC remote");
      await rpc.close();
    }
  });

  it("treats duplicate replies and unsupported notifications as terminal", async () => {
    for (const duplicate of [true, false]) {
      const peer = new Peer(); const rpc = new CodexRpcClient(peer, () => { throw new Error("raw notification"); });
      const first = rpc.request("a", {});
      peer.line({ id: 1, result: "ok" }); await first;
      const pending = rpc.request("b", {}); const rejection = expect(pending).rejects.toThrow("Codex RPC protocol");
      peer.line(duplicate ? { id: 1, result: "late" } : { method: "unrecognised", params: {} });
      await rejection; await rpc.close();
    }
  });

  it("bounds incomplete frames, invalid UTF-8 and outbound frames", async () => {
    for (const mode of ["partial", "utf8", "outbound"]) {
      const peer = new Peer(); const rpc = new CodexRpcClient(peer, () => {}, 64);
      const result = expect(rpc.request("a", mode === "outbound" ? "x".repeat(100) : {})).rejects.toThrow("Codex RPC protocol");
      if (mode === "partial") peer.handlers.data(Buffer.alloc(65, 65));
      if (mode === "utf8") peer.handlers.data(Buffer.from([0xff, 10]));
      await result; await rpc.close();
    }
  });

  it("times out the connection, rejects all pending, and ignores late bytes", async () => {
    vi.useFakeTimers();
    const peer = new Peer(); const event = vi.fn(); const rpc = new CodexRpcClient(peer, event);
    const results = Promise.allSettled([rpc.request("a", {}, 20), rpc.request("b", {}, 100)]);
    await vi.advanceTimersByTimeAsync(20);
    for (const result of await results) if (result.status === "rejected") expect(result.reason.reason).toBe("timeout");
    peer.line({ id: 1, result: "late" }); expect(event).not.toHaveBeenCalled();
    await rpc.close(); expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts before send or while pending without leaving a request timer", async () => {
    vi.useFakeTimers();
    for (const before of [true, false]) {
      const peer = new Peer(); const rpc = new CodexRpcClient(peer, () => {});
      const abort = new AbortController(); if (before) abort.abort();
      const result = expect(rpc.request("a", {}, 100, abort.signal)).rejects.toThrow("Codex RPC cancelled");
      abort.abort(); await result; await rpc.close();
      expect(peer.writes).toHaveLength(before ? 0 : 1);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("surfaces cleanup failure even when close is called from a failure callback", async () => {
    const peer = new Peer(); peer.close.mockRejectedValue(new Error("private path"));
    const rpc = new CodexRpcClient(peer, () => {});
    let observed: Promise<void> | undefined;
    rpc.onFailure(() => { observed = rpc.close(); void observed.catch(() => {}); });
    peer.handlers.end();
    await expect(observed).rejects.toThrow("Codex RPC cleanup");
    await expect(rpc.close()).rejects.toThrow("Codex RPC cleanup");
  });
});
