import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ComplianceError } from "../harness/compliance/index.js";
import { compileProfile } from "../harness/compile/pipeline.js";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { buildAgentSdkChatArgs, runModeBDefault } from "../harness/route/index.js";
import type { ResolvedCli } from "../harness/route/index.js";
import { WARBLE_REPO } from "./warble-checkout.js";

const PROFILE_SOURCE = path.join(WARBLE_REPO, "genbi-default");
const JAFFLE_WREN = path.join(WARBLE_REPO, "examples", "jaffle-wren");

async function isWarbleAvailable(): Promise<boolean> {
  try {
    await resolveWarbleBinary();
    return true;
  } catch {
    return false;
  }
}

const canRun = existsSync(PROFILE_SOURCE) && existsSync(JAFFLE_WREN) && (await isWarbleAvailable());

describe.skipIf(!canRun)(
  "buildAgentSdkChatArgs against a real compiled IR [opt-in integration, never spawns]",
  () => {
    it("builds the validated argv shape with the question routed to stdin, never invoking the CLI itself", async () => {
      const compiled = await compileProfile({
        profileSource: PROFILE_SOURCE,
        userProject: JAFFLE_WREN,
        mode: "native",
      });
      expect(existsSync(compiled.irPath)).toBe(true);
      // `mode: "native"` never dispatches to vercel — no bundle should be produced.
      expect(compiled.bundlePath).toBeUndefined();

      const warbleBin = await resolveWarbleBinary();
      const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

      const command = buildAgentSdkChatArgs(cli, {
        irPath: compiled.irPath,
        userProject: JAFFLE_WREN,
        question: "who is our top customer?",
        outDir: "/tmp/wren-harness-mode-b-test-run",
        warbleBin,
      });

      expect(command.command).toBe("warble-agent-sdk");
      expect(command.args).toEqual([
        "chat",
        compiled.irPath,
        "--project",
        JAFFLE_WREN,
        "--component",
        "answer_query",
        "--out",
        "/tmp/wren-harness-mode-b-test-run",
        "--warble-bin",
        warbleBin,
        "--stream-json",
      ]);
      expect(command.input).toBe("who is our top customer?\n");
      // The question must never appear inside argv — it only ever travels via stdin.
      expect(command.args.join(" ")).not.toContain("who is our top customer?");
    });
  },
);

describe("buildAgentSdkChatArgs (pure, no environment dependency)", () => {
  it("prefixes a dev-mode tsx invocation with its script entry as a leading arg, not appended after the flags", () => {
    const cli: ResolvedCli = {
      command: "/repo/warble/dispatcher/claude-agent-sdk/node_modules/.bin/tsx",
      prefixArgs: ["/repo/warble/dispatcher/claude-agent-sdk/src/cli.ts"],
    };

    const command = buildAgentSdkChatArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: JAFFLE_WREN,
      question: "hello",
      outDir: "/tmp/out",
      warbleBin: "/opt/warble",
    });

    expect(command.args[0]).toBe("/repo/warble/dispatcher/claude-agent-sdk/src/cli.ts");
    expect(command.args[1]).toBe("chat");
    expect(command.input).toBe("hello\n");
  });

  it("encodes a multi-line question's interior newlines to literal \\n so stdin input stays a single line", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkChatArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: JAFFLE_WREN,
      question: "User: what was Q1 revenue?\nAssistant: $1.2M\nAnd Q2?",
      outDir: "/tmp/out",
      warbleBin: "/opt/warble",
    });

    // Exactly one interior line: no real newline before the trailing terminator.
    expect(command.input.slice(0, -1)).not.toContain("\n");
    expect(command.input).toBe(
      "User: what was Q1 revenue?\\nAssistant: $1.2M\\nAnd Q2?\n",
    );
  });

  it("a single-line question is byte-for-byte unchanged (no regression to the existing path)", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkChatArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: JAFFLE_WREN,
      question: "who is our top customer?",
      outDir: "/tmp/out",
      warbleBin: "/opt/warble",
    });

    expect(command.input).toBe("who is our top customer?\n");
  });

  it("rejects an empty or whitespace-only question", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    expect(() =>
      buildAgentSdkChatArgs(cli, {
        irPath: "/tmp/ir.json",
        userProject: JAFFLE_WREN,
        question: "   ",
        outDir: "/tmp/out",
        warbleBin: "/opt/warble",
      }),
    ).toThrow(/empty or whitespace-only/);
  });

  it("hybrid: appends --models-config <path> when options.modelsConfig is set", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkChatArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: JAFFLE_WREN,
      question: "hello",
      outDir: "/tmp/out",
      warbleBin: "/opt/warble",
      modelsConfig: "/tmp/models.yaml",
    });

    expect(command.args).toEqual([
      "chat",
      "/tmp/ir.json",
      "--project",
      JAFFLE_WREN,
      "--component",
      "answer_query",
      "--out",
      "/tmp/out",
      "--warble-bin",
      "/opt/warble",
      "--models-config",
      "/tmp/models.yaml",
      "--stream-json",
    ]);
  });

  it("hybrid: omits --models-config entirely when options.modelsConfig is unset", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkChatArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: JAFFLE_WREN,
      question: "hello",
      outDir: "/tmp/out",
      warbleBin: "/opt/warble",
    });

    expect(command.args).not.toContain("--models-config");
  });

  it("emits --component <agentId> when options.agentId is set to a non-default component", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkChatArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: JAFFLE_WREN,
      question: "hello",
      outDir: "/tmp/out",
      warbleBin: "/opt/warble",
      agentId: "connect_source",
    });

    expect(command.args).toEqual([
      "chat",
      "/tmp/ir.json",
      "--project",
      JAFFLE_WREN,
      "--component",
      "connect_source",
      "--out",
      "/tmp/out",
      "--warble-bin",
      "/opt/warble",
      "--stream-json",
    ]);
  });

  it("defaults --component to answer_query when options.agentId is unset", () => {
    const cli: ResolvedCli = { command: "warble-agent-sdk", prefixArgs: [] };

    const command = buildAgentSdkChatArgs(cli, {
      irPath: "/tmp/ir.json",
      userProject: JAFFLE_WREN,
      question: "hello",
      outDir: "/tmp/out",
      warbleBin: "/opt/warble",
    });

    const componentIndex = command.args.indexOf("--component");
    expect(componentIndex).toBeGreaterThanOrEqual(0);
    expect(command.args[componentIndex + 1]).toBe("answer_query");
  });
});

describe("runModeBDefault (provider guard, pure — throws before compiling/spawning)", () => {
  it("loud-fails when authChoice.provider is \"codex\" instead of silently routing to the Claude dispatcher", async () => {
    await expect(
      runModeBDefault({
        authChoice: { mode: "subscription", provider: "codex" },
        profileSource: "/nonexistent/profile",
        userProject: "/nonexistent/project",
        question: "who is our top customer?",
      }),
    ).rejects.toThrow(/only supports provider "claude"/);
  });
});

describe("runModeBDefault (belt: re-runs enforceCompliance itself, independent of route())", () => {
  it("throws ComplianceError on subscription + deployment: hosted even when called directly, before compiling/spawning", async () => {
    await expect(
      runModeBDefault({
        authChoice: { mode: "subscription", provider: "claude" },
        profileSource: "/nonexistent/profile",
        userProject: "/nonexistent/project",
        question: "who is our top customer?",
        deployment: "hosted",
      }),
    ).rejects.toThrow(ComplianceError);
  });

  it("does not reject subscription + deployment: personal (default) on compliance grounds — fails later on provider/compile instead", async () => {
    // No `deployment` given (defaults to "personal") and provider "codex" so this still
    // rejects, but on the provider guard, not ComplianceError — proving the belt gate itself let
    // "personal" through.
    await expect(
      runModeBDefault({
        authChoice: { mode: "subscription", provider: "codex" },
        profileSource: "/nonexistent/profile",
        userProject: "/nonexistent/project",
        question: "who is our top customer?",
        deployment: "personal",
      }),
    ).rejects.toThrow(/only supports provider "claude"/);
  });
});
