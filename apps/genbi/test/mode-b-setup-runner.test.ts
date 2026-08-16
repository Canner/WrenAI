import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

const tempDirs: string[] = [];

async function createProjectWorkspace(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-b-setup-runner-"));
  tempDirs.push(workspaceRoot);
  await mkdir(path.join(workspaceRoot, "acme"));
  return workspaceRoot;
}

afterEach(async () => {
  compileProfileMock.mockReset();
  spawnMock.mockReset();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
    const getModelsConfig = vi.fn(() => "/tmp/runtime-models.yaml");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
      getModelsConfig,
    });

    const result = await runner.run({
      prompt: "scaffold a new project named acme",
      workspaceRoot: "/tmp/wren-harness-mode-b-setup-runner-test",
      authChoice: { mode: "subscription", provider: "claude" },
    });

    expect(result.finalText).toBe("connected to postgres");
    expect(compileProfileMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(getModelsConfig).toHaveBeenCalledTimes(1);

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
      "--models-config",
      "/tmp/runtime-models.yaml",
      // No --max-turns for connect_source: only build_context gets the raised
      // budget, so a connect turn stays on the dispatcher's default and fails
      // fast rather than burning extra runway on e.g. bad-credential retries.
      "--stream-json",
    ]);
  });

  it.each([
    { stepKey: "connect_resume" as const, agentId: "connect_source" },
    { stepKey: "context" as const, agentId: "build_context" },
  ])("binds $stepKey to the contained project directory instead of duplicating its prefix", async ({ stepKey, agentId }) => {
    spawnMock.mockImplementation(() => fakeChatProcess("continued from the project root"));
    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
      outDir: "/tmp/wren-harness-mode-b-setup-runner-out",
    });
    const workspaceRoot = await createProjectWorkspace();

    await runner.run({
      prompt: "continue setup",
      workspaceRoot,
      projectName: "acme",
      stepKey,
      authChoice: { mode: "subscription", provider: "claude" },
      agentId,
      ...(stepKey === "connect_resume" ? { resumeSessionId: "sdk-session-123" } : {}),
    });

    const [, args] = spawnMock.mock.calls[0] as [string, string[]];
    const projectIndex = args.indexOf("--project");
    expect(args[projectIndex + 1]).toBe(await realpath(path.join(workspaceRoot, "acme")));
    expect(args[projectIndex + 1]).not.toBe(path.join(workspaceRoot, "acme", "acme"));
    if (stepKey === "connect_resume") {
      const resumeIndex = args.indexOf("--resume");
      expect(args[resumeIndex + 1]).toBe("sdk-session-123");
    }
  });

  it.each([undefined, "../outside", "/outside", "nested/project", ".", "acme/.."])("fails closed before the Mode B dispatch for an unsafe project name %j", async (projectName) => {
    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({
      irPath: "/fixture/genbi-setup/ir.golden.json",
      warbleBin: "/fixture/warble",
      agentSdkBin: "/fixture/warble-agent-sdk",
    });

    await expect(
      runner.run({
        prompt: "continue setup",
        workspaceRoot: await createProjectWorkspace(),
        ...(projectName !== undefined ? { projectName } : {}),
        stepKey: "connect_resume",
        authChoice: { mode: "subscription", provider: "claude" },
      }),
    ).rejects.toThrow(/validated single-segment projectName/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("fails closed before the Mode B dispatch when the workspace root or project directory is missing", async () => {
    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: "/fixture/warble", agentSdkBin: "/fixture/warble-agent-sdk" });
    const missingWorkspace = path.join(os.tmpdir(), `wren-harness-missing-${Date.now()}`);

    await expect(runner.run({ prompt: "resume", workspaceRoot: missingWorkspace, projectName: "acme", stepKey: "connect_resume", authChoice: { mode: "subscription", provider: "claude" } })).rejects.toThrow(/workspace root must exist/i);
    const workspaceRoot = await createProjectWorkspace();
    await expect(runner.run({ prompt: "resume", workspaceRoot, projectName: "missing", stepKey: "connect_resume", authChoice: { mode: "subscription", provider: "claude" } })).rejects.toThrow(/project directory must exist/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects a safe-name project symlink that resolves to a sibling-prefix directory outside the canonical workspace", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "wren-harness-mode-b-symlink-parent-"));
    tempDirs.push(parent);
    const workspaceRoot = path.join(parent, "workspace");
    const sibling = path.join(parent, "workspace-escape");
    await mkdir(workspaceRoot);
    await mkdir(sibling);
    await symlink(sibling, path.join(workspaceRoot, "acme"));
    const { ModeBSetupRunner } = await import("../harness/setup/runner.js");
    const runner = new ModeBSetupRunner({ irPath: "/fixture/genbi-setup/ir.golden.json", warbleBin: "/fixture/warble", agentSdkBin: "/fixture/warble-agent-sdk" });

    await expect(runner.run({ prompt: "resume", workspaceRoot, projectName: "acme", stepKey: "connect_resume", authChoice: { mode: "subscription", provider: "claude" } })).rejects.toThrow(/strict descendant/i);
    expect(spawnMock).not.toHaveBeenCalled();
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
    const workspaceRoot = await createProjectWorkspace();

    await runner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot,
      projectName: "acme",
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
    const workspaceRoot = await createProjectWorkspace();

    await runner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot,
      projectName: "acme",
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
    const workspaceRoot = await createProjectWorkspace();

    const result = await runner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot,
      projectName: "acme",
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
    const workspaceRoot = await createProjectWorkspace();
    expect(overriddenRunner.effectiveMaxTurns("build_context")).toBe(25);

    // Cross-check: run() must actually dispatch the exact value effectiveMaxTurns() reports.
    compileProfileMock.mockRejectedValue(new Error("compileProfile must not be called by ModeBSetupRunner"));
    spawnMock.mockImplementation(() => fakeChatProcess("built MDL"));
    await overriddenRunner.run({
      prompt: "generate the MDL for project acme",
      workspaceRoot,
      projectName: "acme",
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
