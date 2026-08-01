import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

// Setup-flow bypass under test: `ModeBOptions.irPath`, when set, must make
// `runModeBDefault` skip `compileProfile` entirely and dispatch the supplied
// IR path directly to `warble-agent-sdk chat`. `compileProfile` is mocked to
// reject so any accidental call fails the test loudly instead of silently
// compiling a real (irrelevant) profile. `node:child_process`'s `spawn` is
// mocked so no real subprocess is spawned — the fake child prints one valid
// `{"t":"answer",...}` NDJSON line (the shape `parseWarbleChatEventLine`
// requires for the turn's final answer) and closes.

const compileProfileMock = vi.fn();
vi.mock("../harness/compile/pipeline.js", () => ({
  compileProfile: (...args: unknown[]) => compileProfileMock(...args),
}));

const spawnMock = vi.fn();
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

interface FakeChild extends EventEmitter {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin: { end: (data?: string) => void };
}

function fakeChatProcess(answerText: string): FakeChild {
  const stdout = Readable.from([`${JSON.stringify({ t: "answer", text: answerText })}\n`]);
  const stderr = Readable.from([]);
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, { stdout, stderr, stdin: { end: () => undefined } });
  // `spawnChat` reads stdout line-by-line via readline and only resolves on
  // the child's "close" event — emit "close" after stdout has fully drained
  // so every line has already been dispatched to the readline "line" handler.
  stdout.on("end", () => child.emit("close", 0, null));
  return child;
}

/**
 * Same shape as `fakeChatProcess`, but the dispatcher also emits a `{t:"session",id}` line
 * before the answer — the Plan A resume anchor `spawnChat` intercepts and surfaces on
 * `ModeBResult.sessionId`.
 */
function fakeChatProcessWithSession(sessionId: string | null, answerText: string): FakeChild {
  const stdout = Readable.from([
    `${JSON.stringify({ t: "session", id: sessionId })}\n`,
    `${JSON.stringify({ t: "answer", text: answerText })}\n`,
  ]);
  const stderr = Readable.from([]);
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, { stdout, stderr, stdin: { end: () => undefined } });
  stdout.on("end", () => child.emit("close", 0, null));
  return child;
}

/**
 * A dispatcher run that reports a session id and then fails (non-zero exit) without ever
 * emitting an answer — the `error_max_turns` shape: still resumable via `ModeBSessionError`.
 */
function fakeChatProcessSessionThenFailure(sessionId: string | null, exitCode: number): FakeChild {
  const stdout = Readable.from([`${JSON.stringify({ t: "session", id: sessionId })}\n`]);
  const stderr = Readable.from(["dispatcher exited: error_max_turns after 120 turns"]);
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, { stdout, stderr, stdin: { end: () => undefined } });
  stdout.on("end", () => child.emit("close", exitCode, null));
  return child;
}

afterEach(() => {
  compileProfileMock.mockReset();
  spawnMock.mockReset();
});

describe("runModeBDefault's ModeBOptions.irPath bypass", () => {
  it("skips compileProfile entirely and dispatches the supplied IR path directly when irPath is set", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called when irPath is set"));
    spawnMock.mockImplementation(() => fakeChatProcess("connected to postgres"));

    const { runModeBDefault } = await import("../harness/route/mode-b.js");

    const result = await runModeBDefault({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: "/should/never/be/read",
      userProject: "/tmp/wren-harness-irpath-bypass-test",
      question: "dispatch the setup component",
      agentId: "connect_source",
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-irpath-bypass-out",
    });

    expect(result.finalText).toBe("connected to postgres");
    expect(compileProfileMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe("/fixture/warble-agent-sdk");
    expect(args).toEqual([
      "chat",
      "/fixture/genbi-setup/ir.golden.json",
      "--project",
      "/tmp/wren-harness-irpath-bypass-test",
      "--component",
      "connect_source",
      "--out",
      "/tmp/wren-harness-irpath-bypass-out",
      "--warble-bin",
      "/fixture/warble",
      "--stream-json",
    ]);
  });

  it("still compiles the profile when irPath is NOT set (baseline — the bypass is opt-in)", async () => {
    compileProfileMock.mockResolvedValue({ irPath: "/compiled/from/profile.json" });
    spawnMock.mockImplementation(() => fakeChatProcess("answered from a compiled profile"));

    const { runModeBDefault } = await import("../harness/route/mode-b.js");

    const result = await runModeBDefault({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: "/some/profile",
      userProject: "/tmp/wren-harness-irpath-bypass-test",
      question: "answer a question",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-irpath-bypass-out",
    });

    expect(result.finalText).toBe("answered from a compiled profile");
    expect(compileProfileMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).toContain("/compiled/from/profile.json");
  });
});

// Coverage for the session-resume wiring (Plan A): the wire coupling itself is pinned in
// test/chat-event-mapper.test.ts (the NDJSON "session" line shape); these tests cover
// runModeBDefault's two responsibilities on either side of that wire — forwarding
// options.resumeSessionId as --resume <id> on the way out, and surfacing a captured session
// id back on ModeBResult.sessionId (success) or ModeBSessionError.sessionId (failure).
describe("runModeBDefault's session resume (Plan A)", () => {
  it("forwards options.resumeSessionId as --resume <id> in the dispatched argv", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called when irPath is set"));
    spawnMock.mockImplementation(() => fakeChatProcess("resumed answer"));

    const { runModeBDefault } = await import("../harness/route/mode-b.js");

    await runModeBDefault({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: "/should/never/be/read",
      userProject: "/tmp/wren-harness-irpath-bypass-test",
      question: "continue where you left off",
      agentId: "build_context",
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-irpath-bypass-out",
      resumeSessionId: "sess_abc123",
    });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    const idx = args.indexOf("--resume");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("sess_abc123");
  });

  it("omits --resume entirely when resumeSessionId is not set (Plan B / fresh-start baseline)", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called when irPath is set"));
    spawnMock.mockImplementation(() => fakeChatProcess("fresh answer"));

    const { runModeBDefault } = await import("../harness/route/mode-b.js");

    await runModeBDefault({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: "/should/never/be/read",
      userProject: "/tmp/wren-harness-irpath-bypass-test",
      question: "start fresh",
      agentId: "build_context",
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-irpath-bypass-out",
    });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).not.toContain("--resume");
  });

  it("ModeBResult.sessionId is populated on success when the dispatcher emits a session line", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called when irPath is set"));
    spawnMock.mockImplementation(() => fakeChatProcessWithSession("sess_xyz789", "connected to postgres"));

    const { runModeBDefault } = await import("../harness/route/mode-b.js");

    const result = await runModeBDefault({
      authChoice: { mode: "subscription", provider: "claude" },
      profileSource: "/should/never/be/read",
      userProject: "/tmp/wren-harness-irpath-bypass-test",
      question: "dispatch the setup component",
      agentId: "connect_source",
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-irpath-bypass-out",
    });

    expect(result.finalText).toBe("connected to postgres");
    expect(result.sessionId).toBe("sess_xyz789");
  });

  it("ModeBSessionError.sessionId still surfaces the captured session id when the turn fails — the error_max_turns resume case", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called when irPath is set"));
    spawnMock.mockImplementation(() => fakeChatProcessSessionThenFailure("sess_failed456", 1));

    const { runModeBDefault, ModeBSessionError } = await import("../harness/route/mode-b.js");

    let caught: unknown;
    try {
      await runModeBDefault({
        authChoice: { mode: "subscription", provider: "claude" },
        profileSource: "/should/never/be/read",
        userProject: "/tmp/wren-harness-irpath-bypass-test",
        question: "build context",
        agentId: "build_context",
        irPath: "/fixture/genbi-setup/ir.golden.json",
        warbleBin: "/fixture/warble",
        agentSdkBin: "/fixture/warble-agent-sdk",
        outDir: "/tmp/wren-harness-irpath-bypass-out",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ModeBSessionError);
    expect((caught as InstanceType<typeof ModeBSessionError>).sessionId).toBe("sess_failed456");
  });
});
