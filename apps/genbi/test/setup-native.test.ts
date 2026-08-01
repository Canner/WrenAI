import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalExecutionEnv, type ExecCommand, type ExecResult, type ExecutionEnv, type ExecutionPolicy } from "../harness/exec/index.js";
import { SetupCommandDeniedError, SetupExecCwdScopeError, SetupExecutionInputError, SetupWriteScopeError } from "../harness/tools/errors.js";
import { createSetupExecutionTool } from "../harness/tools/setup-native.js";

/**
 * `setup_execution`'s denylist/scope enforcement (item C, Mode A / setup):
 * per test/permission-enforcement.test.ts's own established convention, these
 * call `createSetupExecutionTool(...).execute!()` directly rather than
 * through a full `executeAgent` tool loop, because the AI SDK swallows a
 * thrown tool error internally as a `tool-error` content part instead of
 * rethrowing it.
 *
 * "rm -rf x" and "wren context show > out.json" are the exact same literal
 * command strings warble's claude-agent-sdk dispatcher's own setup_execution
 * guardrail tests use (`dispatcher/claude-agent-sdk/tests/guardrails.test.ts`)
 * — reusing them here, rather than inventing fresh ones, is the concrete form
 * of "share test cases across both sides where practical": if either side's
 * denylist ever stopped denying one of these two strings, that would be a
 * real divergence, not just a difference in test fixtures.
 */
const DESTRUCTIVE_COMMANDS = [
  "rm -rf x",
  "sudo apt-get install malware",
  "dd if=/dev/zero of=/dev/sda",
  "mkfs.ext4 /dev/sda1",
  "shutdown -h now",
  "reboot",
  "kill -9 1",
  "chmod 777 /etc/passwd",
  "chown root:root /etc/passwd",
  "mv /etc/passwd /tmp/stolen",
  "cp /etc/passwd /tmp/stolen",
];

const REDIRECTION_COMMANDS = ["wren context show > out.json", "echo hi >> out.txt"];

/**
 * One command per reader the brief calls out by name: `cat`, `head`, `tail`,
 * `less`, `more`, `od`, `xxd`, `strings`, `grep`, `awk`, `sed`, each reading a
 * literal `.env` path — the exact shape of the observed real-`gpt-4.1`
 * incident (`cat <project>/.env`), generalized to every reader in
 * `DOTENV_READER_COMMANDS` rather than asserting the regex exists in the
 * abstract.
 */
const DOTENV_READ_COMMANDS = [
  "cat .env",
  "head .env",
  "tail .env",
  "less .env",
  "more .env",
  "od -c .env",
  "xxd .env",
  "strings .env",
  "grep PASSWORD .env",
  "awk '{print}' .env",
  "sed -n '1p' .env",
];

function countingExecEnv(): { env: ExecutionEnv; execCount: () => number } {
  let calls = 0;
  const execImpl = async (_cmd: ExecCommand): Promise<ExecResult> => {
    calls += 1;
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { env: createLocalExecutionEnv({ execImpl }), execCount: () => calls };
}

/**
 * An ExecutionEnv that records the `cwd` each `exec` call actually received —
 * used to prove `resolveExecCwd` threads the resolved (not the raw
 * model-supplied) cwd through to `ExecutionEnv.exec`, and that omitting `cwd`
 * still defaults to the workspace root unchanged.
 */
function cwdCapturingExecEnv(): { env: ExecutionEnv; cwds: () => (string | undefined)[] } {
  const seen: (string | undefined)[] = [];
  const execImpl = async (cmd: ExecCommand): Promise<ExecResult> => {
    seen.push(cmd.cwd);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  return { env: createLocalExecutionEnv({ execImpl }), cwds: () => seen };
}

/** Records the complete ExecCommand so setup_execution's hang guard is testable without spawning. */
function commandCapturingExecEnv(result: ExecResult = { stdout: "", stderr: "", exitCode: 0 }): {
  env: ExecutionEnv;
  commands: () => ExecCommand[];
} {
  const seen: ExecCommand[] = [];
  const execImpl = async (cmd: ExecCommand): Promise<ExecResult> => {
    seen.push(cmd);
    return result;
  };
  return { env: createLocalExecutionEnv({ execImpl }), commands: () => seen };
}

/**
 * An ExecutionEnv whose subprocess "runs" and returns caller-supplied
 * stdout/stderr — used to prove `redactSetupExecutionOutput` actually
 * replaces content, as opposed to merely existing. A real dotenv-reader
 * command never gets this far (Half 1 denies it before any exec), so these
 * tests exercise the readers Half 1's denylist does NOT enumerate (`wc`, a
 * `python3 -c ...` one-liner) — exactly the gap `redactSetupExecutionOutput`
 * exists to cover.
 */
function contentReturningExecEnv(stdout: string, stderr = ""): { env: ExecutionEnv; execCount: () => number } {
  let calls = 0;
  const execImpl = async (_cmd: ExecCommand): Promise<ExecResult> => {
    calls += 1;
    return { stdout, stderr, exitCode: 0 };
  };
  return { env: createLocalExecutionEnv({ execImpl }), execCount: () => calls };
}

async function withWorkspace(fn: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-setup-native-ws-"));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

const POLICY: ExecutionPolicy = { readOnly: false, artifactWriteScope: "." };

describe("createSetupExecutionTool — destructive/redirection denylist", () => {
  it.each(DESTRUCTIVE_COMMANDS)("denies the destructive command %j with zero side effects (no subprocess spawned)", async (command) => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!({ action: "exec", command }, { toolCallId: "call-1", messages: [], context: undefined }),
      ).rejects.toThrow(SetupCommandDeniedError);

      expect(execCount()).toBe(0);
    });
  });

  it.each(REDIRECTION_COMMANDS)("denies the redirection command %j with zero side effects (no subprocess spawned)", async (command) => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!({ action: "exec", command }, { toolCallId: "call-1", messages: [], context: undefined }),
      ).rejects.toThrow(SetupCommandDeniedError);

      expect(execCount()).toBe(0);
    });
  });

  it("still allows a safe, non-denylisted command through to the real ExecutionEnv (the denylist isn't overbroad)", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      const result = await tool.execute!(
        { action: "exec", command: "wren context build" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      expect(execCount()).toBe(1);
      expect((result as { exitCode: number }).exitCode).toBe(0);
    });
  });
});

describe("createSetupExecutionTool — dotenv-read denylist", () => {
  it.each(DOTENV_READ_COMMANDS)("denies the dotenv-read command %j with zero side effects (no subprocess spawned)", async (command) => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!({ action: "exec", command }, { toolCallId: "call-1", messages: [], context: undefined }),
      ).rejects.toThrow(SetupCommandDeniedError);

      expect(execCount()).toBe(0);
    });
  });

  it('does not deny a reader command against a file that merely contains "env" as a substring but is not a dotenv path (.environment)', async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      const result = await tool.execute!(
        { action: "exec", command: "cat .environment" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      expect(execCount()).toBe(1);
      expect((result as { exitCode: number }).exitCode).toBe(0);
    });
  });

  it("does not deny a reader command against a bare env/ directory (no leading dot, not a dotenv path)", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      const result = await tool.execute!(
        { action: "exec", command: "cat env/config.json" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      expect(execCount()).toBe(1);
      expect((result as { exitCode: number }).exitCode).toBe(0);
    });
  });

  it('still allows writing the .env template itself — the deny targets reads via "exec", not the "write" action', async () => {
    await withWorkspace(async (workspaceRoot) => {
      const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await tool.execute!(
        { action: "write", path: ".env", content: "DUCKDB_URL=\nDUCKDB_FORMAT=\n" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      const written = await readFile(path.join(workspaceRoot, ".env"), "utf-8");
      expect(written).toBe("DUCKDB_URL=\nDUCKDB_FORMAT=\n");
    });
  });
});

describe("createSetupExecutionTool — dotenv-read persistence redaction (defense in depth for readers the denylist doesn't enumerate)", () => {
  it("redacts stdout when a non-denylisted reader's command text still references a dotenv path", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = contentReturningExecEnv("DUCKDB_URL=/secret/path\nDUCKDB_FORMAT=duckdb");
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      // "wc" is not in DOTENV_READER_COMMANDS, so Half 1 lets this command
      // execute — proving the redaction is a real second layer, not merely
      // unreachable dead code behind Half 1's deny.
      const result = (await tool.execute!(
        { action: "exec", command: "wc -l .env" },
        { toolCallId: "call-1", messages: [], context: undefined },
      )) as { stdout: string; stderr: string; exitCode: number };

      expect(execCount()).toBe(1);
      expect(result.stdout).not.toContain("secret");
      expect(result.stdout).not.toContain("DUCKDB_URL");
      expect(result.exitCode).toBe(0);
    });
  });

  it("does NOT redact output for a command whose text does not reference a dotenv path", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env } = contentReturningExecEnv("hello from wren");
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      const result = (await tool.execute!(
        { action: "exec", command: "wren context build" },
        { toolCallId: "call-1", messages: [], context: undefined },
      )) as { stdout: string; stderr: string };

      expect(result.stdout).toBe("hello from wren");
    });
  });
});

describe("createSetupExecutionTool — per-action required-field validation (flat object schema, no discriminated union)", () => {
  /**
   * `setupExecutionInputSchema` is a flat top-level `z.object` with
   * `command`/`path`/`content` all optional — a real OpenAI `gpt-4.1` call
   * rejected the tool outright when it was a `z.discriminatedUnion`, because
   * that serializes to a top-level `{"oneOf": [...]}` with no `"type":
   * "object"`. Since the schema can no longer enforce "an exec action must
   * have a command" itself, `execute` must reject a bad action/field
   * combination BEFORE any subprocess is spawned or file is written — these
   * cases prove that.
   */
  it("rejects an exec action with no command, with zero side effects (no subprocess spawned)", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!({ action: "exec" }, { toolCallId: "call-1", messages: [], context: undefined }),
      ).rejects.toThrow(SetupExecutionInputError);

      expect(execCount()).toBe(0);
    });
  });

  it("rejects a write action with no path, with zero side effects (nothing written)", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!({ action: "write", content: "hello" }, { toolCallId: "call-1", messages: [], context: undefined }),
      ).rejects.toThrow(SetupExecutionInputError);
    });
  });

  it("rejects a write action with no content, with zero side effects (nothing written)", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!({ action: "write", path: "notes/ok.txt" }, { toolCallId: "call-1", messages: [], context: undefined }),
      ).rejects.toThrow(SetupExecutionInputError);

      expect(existsSync(path.join(workspaceRoot, "notes/ok.txt"))).toBe(false);
    });
  });
});

describe("createSetupExecutionTool — write scope boundary (path.relative, never startsWith)", () => {
  it("allows a write nested within the workspace root", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await tool.execute!(
        { action: "write", path: "notes/ok.txt", content: "hello" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      const written = await readFile(path.join(workspaceRoot, "notes/ok.txt"), "utf-8");
      expect(written).toBe("hello");
    });
  });

  it("resolves a short write path relative to cwd so a following exec in the same project finds it", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const projectDir = path.join(workspaceRoot, "acme");
      await mkdir(projectDir, { recursive: true });
      const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      const result = await tool.execute!(
        { action: "write", path: "conn.profile.yml", content: "datasource: duckdb\n", cwd: projectDir },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      expect(await readFile(path.join(projectDir, "conn.profile.yml"), "utf-8")).toBe("datasource: duckdb\n");
      expect(existsSync(path.join(workspaceRoot, "conn.profile.yml"))).toBe(false);
      expect(result).toMatchObject({ written: true, path: path.join(projectDir, "conn.profile.yml") });
    });
  });

  it("rejects a write cwd outside the workspace root before writing anything", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-setup-write-cwd-outside-"));
      try {
        const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
        const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });
        const target = path.join(outsideDir, "conn.profile.yml");

        await expect(
          tool.execute!(
            { action: "write", path: "conn.profile.yml", content: "datasource: duckdb\n", cwd: outsideDir },
            { toolCallId: "call-1", messages: [], context: undefined },
          ),
        ).rejects.toThrow(SetupWriteScopeError);

        expect(existsSync(target)).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it("denies the sibling-prefix case: a root of <root> must NOT admit <root>-evil (a bare startsWith would wrongly allow this)", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const evilSibling = `${workspaceRoot}-evil`;
      await mkdir(evilSibling, { recursive: true });
      try {
        const { env, execCount } = countingExecEnv();
        const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

        const evilTarget = path.join(evilSibling, "leaked.txt");
        await expect(
          tool.execute!(
            { action: "write", path: evilTarget, content: "pwned" },
            { toolCallId: "call-1", messages: [], context: undefined },
          ),
        ).rejects.toThrow(SetupWriteScopeError);

        // Zero side effects: nothing was written to the sibling directory.
        expect(existsSync(evilTarget)).toBe(false);
        expect(execCount()).toBe(0);
      } finally {
        await rm(evilSibling, { recursive: true, force: true });
      }
    });
  });

  it("denies a symlink escape: a symlink inside the workspace pointing outside it is caught by the realpath re-check, not just the nominal path.relative check", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-setup-native-outside-"));
      try {
        const linkPath = path.join(workspaceRoot, "escape-link");
        await symlink(outsideDir, linkPath, "dir");

        const env = createLocalExecutionEnv({ rootDir: workspaceRoot });
        const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

        // Nominally (path.relative against workspaceRoot, no filesystem access)
        // "escape-link/leaked.txt" looks like it's within scope — only the
        // realpath re-check reveals the symlink actually resolves outside it.
        await expect(
          tool.execute!(
            { action: "write", path: "escape-link/leaked.txt", content: "pwned" },
            { toolCallId: "call-1", messages: [], context: undefined },
          ),
        ).rejects.toThrow(SetupWriteScopeError);

        expect(existsSync(path.join(outsideDir, "leaked.txt"))).toBe(false);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });
});

describe("createSetupExecutionTool — exec cwd containment (mirrors the write scope boundary above)", () => {
  it("omitting cwd still defaults the subprocess cwd to the workspace root, unchanged", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, cwds } = cwdCapturingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await tool.execute!({ action: "exec", command: "wren context build" }, { toolCallId: "call-1", messages: [], context: undefined });

      expect(cwds()).toEqual([workspaceRoot]);
    });
  });

  it("allows a cwd nested within the workspace root, and threads the resolved cwd through to ExecutionEnv.exec", async () => {
    await withWorkspace(async (workspaceRoot) => {
      await mkdir(path.join(workspaceRoot, "acme"), { recursive: true });
      const { env, cwds } = cwdCapturingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await tool.execute!(
        { action: "exec", command: "wren profile add acme --from-file conn.profile.yml --activate", cwd: "acme" },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      expect(cwds()).toEqual([path.join(workspaceRoot, "acme")]);
    });
  });

  it("denies a cwd outside the workspace root, with zero side effects (no subprocess spawned)", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!(
          { action: "exec", command: "wren context build", cwd: "/etc" },
          { toolCallId: "call-1", messages: [], context: undefined },
        ),
      ).rejects.toThrow(SetupExecCwdScopeError);

      expect(execCount()).toBe(0);
    });
  });

  it("denies the sibling-prefix case for cwd: a root of <root> must NOT admit <root>-evil as a cwd", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const evilSibling = `${workspaceRoot}-evil`;
      await mkdir(evilSibling, { recursive: true });
      try {
        const { env, execCount } = countingExecEnv();
        const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

        await expect(
          tool.execute!(
            { action: "exec", command: "wren context build", cwd: evilSibling },
            { toolCallId: "call-1", messages: [], context: undefined },
          ),
        ).rejects.toThrow(SetupExecCwdScopeError);

        expect(execCount()).toBe(0);
      } finally {
        await rm(evilSibling, { recursive: true, force: true });
      }
    });
  });

  it("denies a symlink escape for cwd: a symlink inside the workspace pointing outside it is caught by the realpath re-check", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const outsideDir = await mkdtemp(path.join(os.tmpdir(), "wren-harness-setup-native-cwd-outside-"));
      try {
        const linkPath = path.join(workspaceRoot, "escape-link");
        await symlink(outsideDir, linkPath, "dir");

        const { env, execCount } = countingExecEnv();
        const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

        // Nominally (path.relative against workspaceRoot, no filesystem access)
        // "escape-link" looks like it's within scope — only the realpath
        // re-check reveals the symlink actually resolves outside it.
        await expect(
          tool.execute!(
            { action: "exec", command: "wren context build", cwd: "escape-link" },
            { toolCallId: "call-1", messages: [], context: undefined },
          ),
        ).rejects.toThrow(SetupExecCwdScopeError);

        expect(execCount()).toBe(0);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it("still denies a dotenv-read command under a custom (in-scope) cwd — the cwd field does not bypass the denylist", async () => {
    await withWorkspace(async (workspaceRoot) => {
      await mkdir(path.join(workspaceRoot, "acme"), { recursive: true });
      const { env, execCount } = countingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await expect(
        tool.execute!(
          { action: "exec", command: "cat .env", cwd: "acme" },
          { toolCallId: "call-1", messages: [], context: undefined },
        ),
      ).rejects.toThrow(SetupCommandDeniedError);

      expect(execCount()).toBe(0);
    });
  });
});

describe("createSetupExecutionTool — bounded subprocess execution", () => {
  it("applies a two-minute hang guard to every setup exec command", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env, commands } = commandCapturingExecEnv();
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      await tool.execute!(
        { action: "exec", command: "wren context build", cwd: workspaceRoot },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      expect(commands()).toEqual([
        {
          mode: "write",
          command: "/bin/sh",
          args: ["-c", "wren context build"],
          cwd: workspaceRoot,
          timeoutMs: 2 * 60 * 1000,
        },
      ]);
    });
  });

  it("preserves the timedOut signal returned by ExecutionEnv", async () => {
    await withWorkspace(async (workspaceRoot) => {
      const { env } = commandCapturingExecEnv({
        stdout: "",
        stderr: 'subprocess "/bin/sh" timed out after 120000ms',
        exitCode: 1,
        timedOut: true,
      });
      const tool = createSetupExecutionTool({ env, policy: POLICY, workspaceRoot });

      const result = await tool.execute!(
        { action: "exec", command: "python3", cwd: workspaceRoot },
        { toolCallId: "call-1", messages: [], context: undefined },
      );

      expect(result).toMatchObject({ exitCode: 1, timedOut: true });
    });
  });
});
