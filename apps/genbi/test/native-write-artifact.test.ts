import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalExecutionEnv, PathTraversalError, type ExecutionPolicy } from "../harness/exec/index.js";
import { createWriteArtifactTool } from "../harness/tools/native.js";

describe("createWriteArtifactTool (write_artifact routed through ExecutionEnv)", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "wren-harness-write-artifact-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("writes the artifact into the scoped workspace via the injected ExecutionEnv", async () => {
    const env = createLocalExecutionEnv({ rootDir });
    const policy: ExecutionPolicy = { readOnly: true, artifactWriteScope: "." };
    const writeArtifactTool = createWriteArtifactTool(env, policy);

    const output = await writeArtifactTool.execute!(
      { path: "dashboard.json", content: "{}" },
      { toolCallId: "call-1", messages: [], context: undefined },
    );

    expect(output).toEqual({ written: true, path: "dashboard.json", bytes: 2 });
    const written = await readFile(path.join(rootDir, "dashboard.json"), "utf-8");
    expect(written).toBe("{}");
  });

  it("rejects a path that escapes artifactWriteScope with PathTraversalError", async () => {
    const env = createLocalExecutionEnv({ rootDir });
    const policy: ExecutionPolicy = { readOnly: true, artifactWriteScope: "sandbox" };
    const writeArtifactTool = createWriteArtifactTool(env, policy);

    await expect(
      writeArtifactTool.execute!(
        { path: "../escape.json", content: "{}" },
        { toolCallId: "call-1", messages: [], context: undefined },
      ),
    ).rejects.toThrow(PathTraversalError);
  });
});
