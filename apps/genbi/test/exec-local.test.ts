import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalExecutionEnv,
  EgressNotAllowedError,
  PathTraversalError,
  ReadOnlyViolationError,
  WriteScopeNotGrantedError,
  type ExecutionPolicy,
} from "../harness/exec/index.js";

describe("createLocalExecutionEnv (local ExecutionEnv backend)", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "wren-harness-exec-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  describe("writeFile", () => {
    it("writes within artifactWriteScope", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: false, artifactWriteScope: "." };

      await env.writeFile("report.md", "hello", policy);

      const written = await readFile(path.join(rootDir, "report.md"), "utf-8");
      expect(written).toBe("hello");
    });

    it("writes into a subdirectory of the scope, creating it as needed", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: false, artifactWriteScope: "out" };

      await env.writeFile("nested/report.md", "hi", policy);

      const written = await readFile(path.join(rootDir, "out", "nested", "report.md"), "utf-8");
      expect(written).toBe("hi");
    });

    it("rejects a path that escapes artifactWriteScope with PathTraversalError", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: false, artifactWriteScope: "sandbox" };

      await expect(env.writeFile("../evil", "pwned", policy)).rejects.toThrow(PathTraversalError);
    });

    it("rejects any write when the policy grants no artifactWriteScope", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: false };

      await expect(env.writeFile("report.md", "hello", policy)).rejects.toThrow(WriteScopeNotGrantedError);
    });

    it("coexists with readOnly: true (data-access read-only does not block the scoped artifact write)", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: true, artifactWriteScope: "." };

      await env.writeFile("report.md", "hello", policy);

      const written = await readFile(path.join(rootDir, "report.md"), "utf-8");
      expect(written).toBe("hello");
    });
  });

  describe("read-only mode", () => {
    it("rejects a mode: 'write' exec call with ReadOnlyViolationError", async () => {
      const env = createLocalExecutionEnv({ rootDir, execImpl: async () => ({ stdout: "", stderr: "", exitCode: 0 }) });
      const policy: ExecutionPolicy = { readOnly: true };

      await expect(
        env.exec({ mode: "write", command: "rm", args: ["-rf", "x"] }, policy),
      ).rejects.toThrow(ReadOnlyViolationError);
    });

    it("permits a mode: 'read' exec call", async () => {
      const env = createLocalExecutionEnv({
        rootDir,
        execImpl: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
      });
      const policy: ExecutionPolicy = { readOnly: true };

      const result = await env.exec({ mode: "read", command: "echo", args: ["hi"] }, policy);
      expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    });

    it("rejects fetch to a host not in the allowlist with EgressNotAllowedError", async () => {
      const env = createLocalExecutionEnv({
        rootDir,
        fetchImpl: async () => ({ status: 200, text: async () => "should not be called" }),
      });
      const policy: ExecutionPolicy = { readOnly: true };

      await expect(env.fetch({ url: "https://not-allowed.example.com/data" }, policy)).rejects.toThrow(
        EgressNotAllowedError,
      );
    });

    it("permits fetch to an allowlisted host", async () => {
      const env = createLocalExecutionEnv({
        rootDir,
        fetchImpl: async (url) => ({ status: 200, text: async () => `fetched:${url}` }),
      });
      const policy: ExecutionPolicy = { readOnly: true, allowedHosts: ["allowed.example.com"] };

      const response = await env.fetch({ url: "https://allowed.example.com/data" }, policy);
      expect(response).toEqual({ status: 200, body: "fetched:https://allowed.example.com/data" });
    });
  });

  describe("exec (real subprocess spawn — ENOENT vs a real nonzero exit)", () => {
    it("sets notFound: true (not just a generic exitCode: 1) when the command doesn't exist on PATH", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: true };

      const result = await env.exec(
        { mode: "read", command: "definitely-not-a-real-binary-wren-harness-test" },
        policy,
      );

      expect(result.notFound).toBe(true);
      expect(result.exitCode).toBe(1);
    });

    it("leaves notFound unset on an ordinary nonzero exit (a real ENOENT is not confused with a real failure)", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: true };

      const result = await env.exec({ mode: "read", command: "false" }, policy);

      expect(result.notFound).toBeUndefined();
      expect(result.exitCode).not.toBe(0);
    });

    it("leaves timedOut and maxBufferExceeded unset on an ordinary successful exit", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: true };

      const result = await env.exec({ mode: "read", command: "echo", args: ["hi"] }, policy);

      expect(result).toEqual({ stdout: "hi\n", stderr: "", exitCode: 0 });
    });
  });

  describe("exec (guardrail enforcement: timeoutMs + maxBuffer)", () => {
    it("closes stdin for non-interactive commands instead of leaving a child waiting forever for input", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: true };

      const result = await env.exec(
        {
          mode: "read",
          command: process.execPath,
          args: ["-e", "process.stdin.resume(); process.stdin.once('end', () => process.stdout.write('stdin-eof\\n'))"],
          // Keeps the pre-fix failure bounded: before runSubprocess closes
          // stdin this child waits until the timeout kills it.
          timeoutMs: 500,
        },
        policy,
      );

      expect(result).toEqual({ stdout: "stdin-eof\n", stderr: "", exitCode: 0 });
    });

    it("sets timedOut: true and kills the subprocess when it exceeds timeoutMs", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: true };

      const result = await env.exec({ mode: "read", command: "sleep", args: ["2"], timeoutMs: 50 }, policy);

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
    });

    it("sets maxBufferExceeded: true when stdout exceeds the configured maxBufferBytes", async () => {
      const env = createLocalExecutionEnv({ rootDir, maxBufferBytes: 10 });
      const policy: ExecutionPolicy = { readOnly: true };

      const result = await env.exec(
        { mode: "read", command: "node", args: ["-e", "process.stdout.write('x'.repeat(1000))"] },
        policy,
      );

      expect(result.maxBufferExceeded).toBe(true);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("readFile", () => {
    it("reads a file within scope", async () => {
      const env = createLocalExecutionEnv({ rootDir });
      const policy: ExecutionPolicy = { readOnly: true, artifactWriteScope: "." };
      await env.writeFile("data.txt", "content", { readOnly: false, artifactWriteScope: "." });

      const contents = await env.readFile("data.txt", policy);
      expect(contents).toBe("content");
    });
  });
});
