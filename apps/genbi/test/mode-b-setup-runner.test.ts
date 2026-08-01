import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

// Same mocking approach as test/mode-b-irpath-bypass.test.ts: mock compileProfile
// so it's provably never called, and mock node:child_process's spawn so no real
// OS process is spawned while still exercising the real spawnChat/readline path.

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
  stdout.on("end", () => child.emit("close", 0, null));
  return child;
}

afterEach(() => {
  compileProfileMock.mockReset();
  spawnMock.mockReset();
});

describe("ModeBSetupRunner (the real production setup runner, not a stub)", () => {
  it("a non-subscription authChoice throws WITHOUT spawning anything", async () => {
    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
    });

    await expect(
      runner.run({
        prompt: "scaffold a new project",
        workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
        authChoice: { mode: "api-key", adapter: "mock" },
      }),
    ).rejects.toThrow(/subscription auth mode/i);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(compileProfileMock).not.toHaveBeenCalled();
  });

  it("a subscription authChoice forwards agentId:connect_source, the fixed irPath, and workspaceRoot into the Mode B dispatch", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called by ModeBSetupRunner"));
    spawnMock.mockImplementation(() => fakeChatProcess("connected to postgres"));

    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
    });

    const result = await runner.run({
      prompt: "scaffold a new project named acme",
      workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
      authChoice: { mode: "subscription", provider: "claude" },
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
      "/tmp/wren-harness-mode-b-setup-runner-test",
      "--component",
      "connect_source",
      "--out",
      "/tmp/wren-harness-mode-b-setup-runner-out",
      "--warble-bin",
      "/fixture/warble",
      // No --max-turns for connect_source: only build_context gets the raised
      // budget, so a connect turn stays on the dispatcher's default and fails
      // fast rather than burning extra runway on e.g. bad-credential retries.
      "--stream-json",
    ]);
  });

  it("gives build_context the DEFAULT_SETUP_MAX_TURNS budget (120) but leaves connect_source on the dispatcher default", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called by ModeBSetupRunner"));
    spawnMock.mockImplementation(() => fakeChatProcess("built MDL"));

    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
    });

    await runner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
      authChoice: { mode: "subscription", provider: "claude" },
      agentId: "build_context",
    });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    const idx = args.indexOf("--max-turns");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("120");
  });

  it("forwards an explicit maxTurns override as --max-turns (overriding the DEFAULT_SETUP_MAX_TURNS default)", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called by ModeBSetupRunner"));
    spawnMock.mockImplementation(() => fakeChatProcess("built MDL"));

    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
      maxTurns: 250,
    });

    await runner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
      authChoice: { mode: "subscription", provider: "claude" },
      agentId: "build_context",
    });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    const idx = args.indexOf("--max-turns");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("250");
  });

  it("an explicit agentId (e.g. build_context, the context step's component) overrides the connect_source default in the dispatched --component argv", async () => {
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called by ModeBSetupRunner"));
    spawnMock.mockImplementation(() => fakeChatProcess("built MDL with 3 models"));

    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
    });

    const result = await runner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
      authChoice: { mode: "subscription", provider: "claude" },
      agentId: "build_context",
    });

    expect(result.finalText).toBe("built MDL with 3 models");
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(args).toContain("build_context");
    expect(args).not.toContain("connect_source");
    const componentIndex = args.indexOf("--component");
    expect(args[componentIndex + 1]).toBe("build_context");
  });

  it("effectiveMaxTurns() reports exactly the budget run() dispatches with — the source of truth for the continue-label", async () => {
    const { ModeBSetupRunner, DEFAULT_SETUP_MAX_TURNS } = await import("../harness/setup/runner.js");

    const defaultRunner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
    });
    expect(defaultRunner.effectiveMaxTurns("build_context")).toBe(DEFAULT_SETUP_MAX_TURNS);
    expect(defaultRunner.effectiveMaxTurns("connect_source")).toBeUndefined();

    const overriddenRunner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
      maxTurns: 25,
    });
    expect(overriddenRunner.effectiveMaxTurns("build_context")).toBe(25);

    // Cross-check: run() must actually dispatch the exact value effectiveMaxTurns() reports.
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called by ModeBSetupRunner"));
    spawnMock.mockImplementation(() => fakeChatProcess("built MDL"));
    await overriddenRunner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
      authChoice: { mode: "subscription", provider: "claude" },
      agentId: "build_context",
    });
    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    const idx = args.indexOf("--max-turns");
    expect(args[idx + 1]).toBe(String(overriddenRunner.effectiveMaxTurns("build_context")));
    expect(args[idx + 1]).toBe("25");
  });

  it("forwards onEvent through to the Mode B dispatch so setup-turn worklog streaming works", async () => {
    spawnMock.mockImplementation(() => fakeChatProcess("scaffolded"));
    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
    });

    const events: unknown[] = [];
    await runner.run({
      prompt: "scaffold",
      workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
      authChoice: { mode: "subscription", provider: "claude" },
      onEvent: (event) => events.push(event),
    });

    // run.start / answer / run.finish are always emitted by runModeBDefault regardless
    // of whether the fake NDJSON stream carried any step/tool events.
    expect(events.length).toBeGreaterThan(0);
  });
});
