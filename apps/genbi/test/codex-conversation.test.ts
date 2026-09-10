import { describe, expect, it, vi } from "vitest";
import { CodexConversation, CodexConversationError, type ConversationFrame, type ConversationReplay } from "../server/runtime-host/codex-conversation.js";
import { CodexBackendError, type CodexLaunchPermit } from "../server/runtime-host/codex-app-server.js";
import { CodexRpcError } from "../server/runtime-host/codex-rpc.js";
import type { CodexEvent } from "../server/runtime-host/codex-events.js";
import type { CodexSession } from "../server/runtime-host/codex-session.js";

type Turn = Awaited<ReturnType<CodexSession["runTurn"]>>;
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function fixture() {
  let emit!: (event: CodexEvent) => void;
  let failed: ((error: CodexRpcError) => void) | undefined;
  const turn = deferred<Turn>();
  const permit = { runtime: {}, assertActive: vi.fn(), release: vi.fn() } as unknown as CodexLaunchPermit;
  const driver = {
    startThread: vi.fn(async () => "thread"),
    runTurn: vi.fn(() => turn.promise),
    interruptTurn: vi.fn(async () => {}),
    close: vi.fn(async () => { turn.reject(new CodexRpcError("closed")); }),
    onFailure: vi.fn((listener: (error: CodexRpcError) => void) => { failed = listener; return () => { failed = undefined; }; }),
  };
  void turn.promise.catch(() => {});
  const backend = { open: vi.fn(async (_permit: CodexLaunchPermit, input: { onEvent(event: CodexEvent): void }) => { emit = input.onEvent; return driver; }) };
  const input = { spec: {}, wrenHome: {}, assertScopeActive: vi.fn() } as unknown as ConstructorParameters<typeof CodexConversation>[2];
  const conversation = new CodexConversation(backend, permit, input);
  return { conversation, driver, backend, permit, turn, input, emit: (event: CodexEvent) => emit(event), fail: (error: CodexRpcError) => failed?.(error) };
}
const status = (): CodexEvent => ({ method: "thread/status/changed", params: { threadId: "thread", status: { type: "idle" } } });
const started = (): CodexEvent => ({ method: "turn/started", params: { threadId: "thread", turn: { id: "turn", status: "inProgress", items: [] } } });
type Frame = ConversationFrame | ConversationReplay;

describe("Codex conversation lifecycle bridge", () => {
  it("uses the supplied permit/open contract, captures early events and starts exactly one thread", async () => {
    const f = fixture();
    f.backend.open.mockImplementationOnce(async (_permit, input) => { input.onEvent(status()); return f.driver; });
    await f.conversation.ready;
    expect(f.permit.assertActive).toHaveBeenCalledOnce();
    expect(f.backend.open.mock.calls[0]![0]).toBe(f.permit);
    expect(f.backend.open.mock.calls[0]![1]).toMatchObject(f.input);
    expect(f.driver.startThread).toHaveBeenCalledOnce();
    const frames: Frame[] = [];
    f.conversation.attach(f.conversation.capability, (frame) => frames.push(frame));
    expect(frames.map((frame) => frame.type)).toEqual(["replay", "event", "state"]);
    await f.conversation.close();
  });
  it("rejects wrong/cross-session capabilities and concurrent owners; stale handles cannot control a reattachment", async () => {
    const f = fixture(); const other = fixture(); await Promise.all([f.conversation.ready, other.conversation.ready]);
    expect(() => f.conversation.attach(other.conversation.capability, () => {})).toThrow("attachment");
    const first = f.conversation.attach(f.conversation.capability, () => {});
    expect(() => f.conversation.attach(f.conversation.capability, () => {})).toThrow("attachment");
    first.detach();
    const second = f.conversation.attach(f.conversation.capability, () => {});
    first.detach();
    expect(() => first.submit("old")).toThrow("attachment");
    expect(() => first.interrupt()).toThrow("attachment");
    expect(() => second.submit("")).toThrow("input");
    expect(f.driver.runTurn).not.toHaveBeenCalled();
    await Promise.all([f.conversation.close(), other.conversation.close()]);
  });
  it("serializes turns, streams events and does not mistake interrupt acknowledgement for completion", async () => {
    const f = fixture(); await f.conversation.ready;
    const frames: Frame[] = [];
    const attachment = f.conversation.attach(f.conversation.capability, (frame) => frames.push(frame));
    const submitted = attachment.submit("hello");
    expect(() => attachment.submit("concurrent")).toThrow("busy");
    await Promise.resolve(); f.emit(started());
    const interrupted = attachment.interrupt();
    let complete = false; void interrupted.then(() => { complete = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(complete).toBe(false);
    f.turn.resolve({ id: "turn", status: "interrupted", items: [] });
    await expect(submitted).resolves.toEqual({ turnId: "turn", status: "interrupted" });
    await interrupted;
    expect(f.conversation.snapshot().state).toBe("ready");
    expect(frames.some((frame) => frame.type === "event")).toBe(true);
    await f.conversation.close();
  });
  it("cancels before the turn acknowledgement by closing, never by guessing an interrupt ID", async () => {
    const f = fixture(); await f.conversation.ready;
    const attachment = f.conversation.attach(f.conversation.capability, () => {});
    const submitted = attachment.submit("hello");
    await attachment.interrupt();
    await expect(submitted).rejects.toBeInstanceOf(CodexConversationError);
    expect(f.driver.interruptTurn).not.toHaveBeenCalled();
    expect(f.driver.close).toHaveBeenCalledOnce();
    expect(f.conversation.snapshot()).toMatchObject({ state: "failed", failure: "cancelled" });
  });
  it("bounds replay by count and bytes, reports truncation and rejects future cursors", async () => {
    const f = fixture(); await f.conversation.ready;
    for (let i = 0; i < 300; i++) f.emit(status());
    let frames: Frame[] = [];
    const first = f.conversation.attach(f.conversation.capability, (frame) => frames.push(frame));
    expect(frames).toHaveLength(257);
    expect(frames[0]).toMatchObject({ type: "replay", truncated: true, throughSequence: 301 });
    expect(() => { first.detach(); f.conversation.attach(f.conversation.capability, () => {}, 9999); }).toThrow("input");
    const big: CodexEvent = { method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "字".repeat(100_000) } };
    for (let i = 0; i < 6; i++) f.emit(big);
    frames = [];
    f.conversation.attach(f.conversation.capability, (frame) => frames.push(frame));
    expect(frames[0]).toMatchObject({ type: "replay", truncated: true });
    expect((frames[0] as ConversationReplay).retainedBytes).toBeLessThanOrEqual(1_048_576);
    await f.conversation.close();
  });
  it("reentrant live delivery follows the captured replay and subscriber mutation cannot corrupt retained frames", async () => {
    const f = fixture(); await f.conversation.ready; f.emit(status());
    const frames: Frame[] = [];
    const first = f.conversation.attach(f.conversation.capability, (frame) => {
      frames.push(frame);
      if (frame.type === "replay") f.emit(status());
      if (frame.type === "event") frame.event.params.threadId = "mutated";
    });
    expect(frames.map((frame) => frame.type === "replay" ? 0 : frame.sequence)).toEqual([0, 1, 2, 3]);
    first.detach();
    const replay: Frame[] = [];
    f.conversation.attach(f.conversation.capability, (frame) => replay.push(frame), 1);
    expect(replay[1]).toMatchObject({ event: { params: { threadId: "thread" } } });
    await f.conversation.close();
  });
  it("detach preserves the active turn; host close settles work and forbids later operations", async () => {
    const f = fixture(); await f.conversation.ready;
    const attachment = f.conversation.attach(f.conversation.capability, () => {});
    const submitted = attachment.submit("hello"); await Promise.resolve();
    attachment.detach();
    expect(f.driver.close).not.toHaveBeenCalled();
    await f.conversation.close();
    await expect(submitted).rejects.toBeInstanceOf(CodexConversationError);
    expect(() => attachment.submit("late")).toThrow("attachment");
  });
  it("closes idle transport failures and redacts arbitrary errors", async () => {
    const f = fixture(); await f.conversation.ready;
    f.fail(new CodexRpcError("transport"));
    await f.conversation.close();
    expect(f.conversation.snapshot()).toMatchObject({ state: "failed", failure: "protocol" });
    expect(f.driver.close).toHaveBeenCalledOnce();
    const g = fixture(); g.backend.open.mockRejectedValueOnce(new Error("private credential output"));
    await expect(g.conversation.ready).rejects.toThrow("unavailable");
    expect(JSON.stringify(g.conversation.snapshot())).not.toContain("private");
    expect(g.permit.release).toHaveBeenCalledOnce();
  });
  it("reports cleanup failure and never retries it as successful termination", async () => {
    const f = fixture(); await f.conversation.ready;
    f.driver.close.mockRejectedValueOnce(new Error("private cleanup path"));
    const close = f.conversation.close();
    expect(f.conversation.close()).toBe(close);
    await expect(close).rejects.toThrow("cleanup");
    expect(f.conversation.snapshot()).toMatchObject({ state: "failed", failure: "cleanup" });
    expect(f.driver.close).toHaveBeenCalledOnce();
    const g = fixture(); g.backend.open.mockRejectedValueOnce(new CodexBackendError("codex_app_server_cleanup_failed"));
    await expect(g.conversation.ready).rejects.toThrow("cleanup");
    await expect(g.conversation.close()).rejects.toThrow("cleanup");
  });
  it("callback failure closes the backend without forwarding the thrown value", async () => {
    const f = fixture(); await f.conversation.ready;
    f.conversation.attach(f.conversation.capability, () => { throw new Error("secret in listener"); });
    await f.conversation.close();
    expect(f.conversation.snapshot()).toMatchObject({ state: "failed", failure: "delivery" });
    expect(JSON.stringify(f.conversation.snapshot())).not.toContain("secret");
  });
  it("close before opening releases the permit without spawning or starting a thread", async () => {
    const f = fixture(); await f.conversation.close();
    await expect(f.conversation.ready).rejects.toThrow("closed");
    expect(f.backend.open).not.toHaveBeenCalled();
    expect(f.permit.release).toHaveBeenCalledOnce();
  });
  it("close during backend initialization owns and closes the eventual connection", async () => {
    const f = fixture(); const opening = deferred<typeof f.driver>();
    f.backend.open.mockReturnValueOnce(opening.promise);
    await Promise.resolve(); await Promise.resolve();
    const closing = f.conversation.close(); opening.resolve(f.driver);
    await closing; await expect(f.conversation.ready).rejects.toThrow("closed");
    expect(f.driver.close).toHaveBeenCalledOnce();
    expect(f.driver.startThread).not.toHaveBeenCalled();
  });
  it("opening failure waits for cleanup already triggered by the transport failure hook", async () => {
    const f = fixture(); const cleanup = deferred<void>();
    f.driver.close.mockReturnValueOnce(cleanup.promise);
    f.driver.startThread.mockImplementationOnce(async () => {
      f.fail(new CodexRpcError("transport"));
      throw new CodexRpcError("protocol");
    });
    let settled = false;
    void f.conversation.ready.catch(() => { settled = true; });
    await vi.waitFor(() => expect(f.driver.close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    cleanup.resolve();
    await expect(f.conversation.ready).rejects.toThrow("protocol");
  });
  it("stale permit fails before backend open and is released", async () => {
    const f = fixture(); vi.mocked(f.permit.assertActive).mockImplementationOnce(() => { throw new Error("stale"); });
    await expect(f.conversation.ready).rejects.toThrow("unavailable");
    expect(f.backend.open).not.toHaveBeenCalled();
    expect(f.permit.release).toHaveBeenCalledOnce();
  });
  it("preserves fixed per-backend reasons through opening failure and replay metadata", async () => {
    const f = fixture(); f.backend.open.mockRejectedValueOnce(new CodexBackendError("codex_identity_uncertified"));
    await expect(f.conversation.ready).rejects.toMatchObject({ code: "unavailable", backendReason: "codex_identity_uncertified" });
    expect(f.conversation.snapshot()).toMatchObject({ backendReason: "codex_identity_uncertified" });
    const frames: Frame[] = [];
    f.conversation.attach(f.conversation.capability, (frame) => frames.push(frame));
    expect(frames[0]).toMatchObject({ backendReason: "codex_identity_uncertified" });
  });
  it("refuses terminal bytes and unknown protocol events instead of presenting them as conversations", async () => {
    const f = fixture(); await f.conversation.ready;
    expect(() => f.emit({ method: "command/exec/outputDelta", params: { processId: "p", stream: "stdout", deltaBase64: "", capReached: false } })).toThrow("protocol");
    await f.conversation.close();
    expect(f.conversation.snapshot()).toMatchObject({ state: "failed", failure: "protocol" });
    const g = fixture(); await g.conversation.ready;
    expect(() => g.emit({ method: "unknown", params: {} } as unknown as CodexEvent)).toThrow("protocol");
    await g.conversation.close();
  });
  it("settles the facade turn even if the closing driver leaves its own completion pending", async () => {
    const f = fixture(); await f.conversation.ready;
    f.driver.close.mockImplementationOnce(async () => {});
    const handle = f.conversation.attach(f.conversation.capability, () => {});
    const submitted = handle.submit("hello"); await Promise.resolve();
    await f.conversation.close();
    await expect(submitted).rejects.toThrow("closed");
  });
  it("an oversized event fails closed instead of silently disappearing from replay", async () => {
    const f = fixture(); await f.conversation.ready;
    expect(() => f.emit({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "item", delta: "字".repeat(400_000) } })).toThrow("protocol");
    await f.conversation.close();
    expect(f.conversation.snapshot()).toMatchObject({ state: "failed", failure: "protocol" });
  });
});
