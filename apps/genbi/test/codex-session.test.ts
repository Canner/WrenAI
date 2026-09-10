import { describe, expect, it, vi } from "vitest";
import { CodexSession } from "../server/runtime-host/codex-session.js";
import type { RpcTransport } from "../server/runtime-host/codex-rpc.js";
import type { CodexSessionPolicy } from "../server/runtime-host/codex-policy.js";

const policy: CodexSessionPolicy = { cwd: "/scope", codexHome: "/login", profile: "genbi-scoped", args: [], environment: {}, commandEnvironment: { PATH: "/tools", CODEX_HOME: null }, configuration: { approval_policy: "never" } };
const thread = { id: "thread-1", cwd: "/scope", cliVersion: "0.146.0", ephemeral: true };
const turn = (status = "inProgress") => ({ id: "turn-1", status, items: [] });
class Peer implements RpcTransport {
  handlers!: Parameters<RpcTransport["listen"]>[0];
  messages: { id?: number; method: string; params: any }[] = [];
  close = vi.fn(async () => {});
  custom?: (message: any) => boolean;
  listen(handlers: Parameters<RpcTransport["listen"]>[0]) { this.handlers = handlers; }
  response(id: number, result: unknown) { this.handlers.data(Buffer.from(JSON.stringify({ id, result }) + "\n")); }
  event(method: string, params: unknown) { this.handlers.data(Buffer.from(JSON.stringify({ method, params }) + "\n")); }
  write(line: string) {
    const message = JSON.parse(line); this.messages.push(message);
    if (this.custom?.(message)) return;
    if (message.method === "initialize") this.response(message.id, { codexHome: "/login", platformFamily: "unix", platformOs: "macos", userAgent: "codex_cli_rs/0.146.0 fixture" });
    else if (message.method === "config/read") this.response(message.id, { config: policy.configuration });
    else if (message.method === "permissionProfile/list") this.response(message.id, { data: [{ id: "genbi-scoped", allowed: true }], nextCursor: null });
    else if (message.method === "thread/start") { this.event("thread/started", { thread }); this.response(message.id, { thread }); }
    else if (message.method === "turn/start") this.response(message.id, { turn: turn() });
    else if (/^command\/exec\//.test(message.method) || message.method === "turn/interrupt") this.response(message.id, {});
  }
  last(method: string) { return [...this.messages].reverse().find((message) => message.method === method)!; }
}
async function fixture() {
  const peer = new Peer(); const emit = vi.fn(); const revalidate = vi.fn();
  const session = await CodexSession.connect(peer, policy, revalidate, emit);
  return { peer, emit, revalidate, session };
}
describe("Codex session protocol", () => {
  it("compares effective config and rejects inherited widening before thread/command", async () => {
    const peer = new Peer();
    peer.custom = (message) => {
      if (message.method !== "config/read") return false;
      peer.response(message.id, { config: { approval_policy: "on-request", privateValue: "SECRET" } }); return true;
    };
    await expect(CodexSession.connect(peer, policy, () => {}, () => {})).rejects.toMatchObject({ reason: "protocol" });
    expect(peer.close).toHaveBeenCalledOnce(); expect(peer.messages.some((m) => m.method === "permissionProfile/list")).toBe(false);
  });
  it.each(["profile", "network", "environment", "feature"])("rejects changed effective %s", async (part) => {
    const peer = new Peer();
    const configuration = { permissions: { scoped: { filesystem: { ":minimal": "read" }, network: { enabled: false } } }, shell_environment_policy: { inherit: "none", set: { PATH: "/tools" } }, features: { hooks: false } };
    const altered = JSON.parse(JSON.stringify(configuration));
    if (part === "profile") altered.permissions.scoped.filesystem["/"] = "write";
    if (part === "network") altered.permissions.scoped.network.enabled = true;
    if (part === "environment") altered.shell_environment_policy.experimental_use_profile = true;
    if (part === "feature") altered.features.hooks = true;
    peer.custom = (message) => { if (message.method !== "config/read") return false; peer.response(message.id, { config: altered }); return true; };
    await expect(CodexSession.connect(peer, { ...policy, configuration }, () => {}, () => {})).rejects.toMatchObject({ reason: "protocol" });
    expect(peer.close).toHaveBeenCalledOnce();
  });
  it("accepts absent optional config fields represented as null, not non-null grants", async () => {
    const peer = new Peer();
    const configuration = { permissions: { scoped: { network: { enabled: false } } } };
    peer.custom = (message) => { if (message.method !== "config/read") return false; peer.response(message.id, { config: { permissions: { scoped: { extends: null, network: { enabled: false, domains: null } } } } }); return true; };
    const session = await CodexSession.connect(peer, { ...policy, configuration }, () => {}, () => {}); await session.close();
  });
  it("returns a fixed permission reason when the selected profile is unavailable", async () => {
    const peer = new Peer();
    peer.custom = (message) => { if (message.method !== "permissionProfile/list") return false; peer.response(message.id, { data: [{ id: policy.profile, allowed: false, description: "SECRET" }] }); return true; };
    await expect(CodexSession.connect(peer, policy, () => {}, () => {})).rejects.toMatchObject({ reason: "permission" });
    expect(peer.close).toHaveBeenCalledOnce();
  });
  it("uses explicit named profiles for direct thread/turn, including completion before the reply", async () => {
    const { peer, session, emit } = await fixture();
    await session.startThread();
    peer.custom = (message) => {
      if (message.method !== "turn/start") return false;
      peer.event("turn/started", { threadId: thread.id, turn: turn() });
      const item = { id: "message", type: "agentMessage", text: "answer" };
      peer.event("item/started", { threadId: thread.id, turnId: "turn-1", item });
      peer.event("item/completed", { threadId: thread.id, turnId: "turn-1", item });
      peer.event("turn/completed", { threadId: thread.id, turn: turn("completed") });
      peer.response(message.id, { turn: turn() }); return true;
    };
    expect((await session.runTurn("hello")).status).toBe("completed");
    expect(emit).toHaveBeenCalledTimes(4);
    for (const method of ["thread/start", "turn/start"]) {
      const params = peer.last(method).params;
      expect(params).toMatchObject({ permissions: "genbi-scoped", approvalPolicy: "never", cwd: "/scope", runtimeWorkspaceRoots: ["/scope"], environments: [] });
      expect(params).not.toHaveProperty("sandboxPolicy"); expect(params).not.toHaveProperty("sandbox");
    }
    await session.close();
  });
  it("keeps the turn pending after its start acknowledgement and strips raw vendor errors", async () => {
    const { peer, session } = await fixture(); await session.startThread();
    let settled = false; const promise = session.runTurn("hello").finally(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    peer.event("turn/completed", { threadId: thread.id, turn: { ...turn("failed"), error: { message: "SECRET", additionalDetails: "private" } } });
    expect(await promise).toEqual(turn("failed")); await session.close();
  });
  it.each([
    ["unknown/event", {}],
    ["remoteControl/status/changed", { status: "connected", installationId: "id", serverName: "secret" }],
    ["turn/completed", { threadId: "another", turn: turn("completed") }],
    ["turn/completed", { threadId: thread.id, turn: { ...turn("completed"), id: "wrong" } }],
    ["turn/completed", { threadId: thread.id, turn: turn() }],
    ["item/started", { threadId: thread.id, turnId: "turn-1", item: { id: "x", type: "dynamicToolCall" } }],
    ["item/agentMessage/delta", { threadId: thread.id, turnId: "turn-1", itemId: "unknown", delta: "SECRET" }],
  ])("fails closed for %s", async (method, params) => {
    const { peer, session } = await fixture(); await session.startThread();
    const promise = session.runTurn("hello"); await Promise.resolve();
    peer.event(method as string, params);
    await expect(promise).rejects.toMatchObject({ reason: "protocol" });
    expect(peer.close).toHaveBeenCalledOnce();
  });
  it("rejects duplicate completion and unsupported server requests without raw content", async () => {
    const { peer, session } = await fixture(); await session.startThread();
    const promise = session.runTurn("hello"); await Promise.resolve();
    peer.event("turn/completed", { threadId: thread.id, turn: turn("completed") }); await promise;
    peer.event("turn/completed", { threadId: thread.id, turn: turn("completed") });
    await expect(session.runTurn("again")).rejects.toMatchObject({ reason: "closed" }); await session.close();
  });
  it("handles only a validated disabled remote-control startup notification", async () => {
    const { peer, session, emit } = await fixture();
    peer.event("remoteControl/status/changed", { status: "disabled", installationId: "private-id", serverName: "private-name" });
    expect(emit).not.toHaveBeenCalled(); await session.startThread(); await session.close();
  });
  it.each(["abort", "timeout", "disconnect", "shutdown"])("settles an active turn on %s and cleans up", async (reason) => {
    const { peer, session } = await fixture(); await session.startThread();
    const controller = new AbortController();
    const promise = session.runTurn("hello", { signal: controller.signal, timeoutMs: reason === "timeout" ? 10 : 10_000 });
    await Promise.resolve();
    if (reason === "abort") controller.abort();
    if (reason === "disconnect") peer.handlers.end();
    if (reason === "shutdown") await session.close();
    await expect(promise).rejects.toBeInstanceOf(Error); expect(peer.close).toHaveBeenCalledOnce();
  });
  it("interrupt acknowledgement is not completion", async () => {
    const { peer, session } = await fixture(); await session.startThread();
    const promise = session.runTurn("hello"); await Promise.resolve(); await session.interruptTurn();
    expect(peer.last("turn/interrupt").params).toEqual({ threadId: thread.id, turnId: "turn-1" });
    peer.event("turn/completed", { threadId: thread.id, turn: turn("interrupted") });
    expect((await promise).status).toBe("interrupted"); await session.close();
  });
  it("revalidates before every operation and preserves a cleanup failure", async () => {
    const { session, peer, revalidate } = await fixture();
    peer.close.mockRejectedValue(new Error("private cleanup path")); revalidate.mockImplementation(() => { throw new Error("private runtime path"); });
    await expect(session.startThread()).rejects.toMatchObject({ reason: "protocol" });
    await expect(session.close()).rejects.toMatchObject({ reason: "cleanup" });
    expect(peer.messages.some((m) => m.method === "thread/start")).toBe(false);
  });
});
describe("Codex command and PTY", () => {
  it("streams ordered bytes, writes stdin, resizes and awaits terminate result", async () => {
    const { peer, session, emit } = await fixture();
    const command = session.startCommand({ command: ["/bin/cat"], tty: true, size: { cols: 80, rows: 24 } });
    const started = peer.last("command/exec");
    expect(started.params).toMatchObject({ permissionProfile: "genbi-scoped", cwd: "/scope", env: policy.commandEnvironment, streamStdoutStderr: true });
    expect(started.params).not.toHaveProperty("sandboxPolicy");
    peer.event("command/exec/outputDelta", { processId: command.id, stream: "stdout", deltaBase64: Buffer.from("hi").toString("base64"), capReached: false });
    await command.write(Buffer.from("hello\n")); await command.resize({ cols: 100, rows: 40 });
    expect(peer.last("command/exec/write").params.processId).toBe(command.id);
    expect(peer.last("command/exec/resize").params.size).toEqual({ cols: 100, rows: 40 });
    const terminating = command.terminate(); await Promise.resolve();
    peer.response(started.id!, { exitCode: 143, stdout: "", stderr: "" });
    await terminating; expect(await command.completed).toEqual({ exitCode: 143 }); expect(emit).toHaveBeenCalledOnce();
    await expect(command.write(Buffer.from("late"))).rejects.toMatchObject({ reason: "closed" }); await session.close();
  });
  it.each(["env", "cwd", "permissionProfile", "sandboxPolicy", "disableTimeout", "processId"])("rejects caller policy override %s before sending", async (key) => {
    const { peer, session } = await fixture();
    expect(() => session.startCommand({ command: ["/bin/echo"], [key]: "poison" } as any)).toThrow("Codex RPC protocol");
    expect(peer.messages.some((m) => m.method === "command/exec")).toBe(false); await session.close();
  });
  it.each(["wrong-id", "bad-base64", "after-complete"])("rejects invalid output: %s", async (mode) => {
    const { peer, session } = await fixture(); const command = session.startCommand({ command: ["/bin/echo"] });
    if (mode === "after-complete") { peer.response(peer.last("command/exec").id!, { exitCode: 0, stdout: "", stderr: "" }); await command.completed; }
    peer.event("command/exec/outputDelta", { processId: mode === "wrong-id" ? "unowned" : command.id, stream: "stdout", deltaBase64: mode === "bad-base64" ? "not-base64!" : "YQ==", capReached: false });
    if (mode !== "after-complete") await expect(command.completed).rejects.toMatchObject({ reason: "protocol" });
    await session.close(); expect(peer.close).toHaveBeenCalledOnce();
  });
  it("rejects all concurrent commands on disconnect", async () => {
    const { peer, session } = await fixture(); const one = session.startCommand({ command: ["one"] }); const two = session.startCommand({ command: ["two"] });
    peer.handlers.end();
    await expect(one.completed).rejects.toMatchObject({ reason: "closed" }); await expect(two.completed).rejects.toMatchObject({ reason: "closed" });
    expect(peer.close).toHaveBeenCalledOnce();
  });
  it("does not use buffered output in addition to streamed output", async () => {
    const { peer, session } = await fixture(); const command = session.startCommand({ command: ["one"] });
    peer.response(peer.last("command/exec").id!, { exitCode: 0, stdout: "duplicate/private", stderr: "" });
    await expect(command.completed).rejects.toMatchObject({ reason: "protocol" });
  });
});
