import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexSetupRunner, selectSetupRunnerForAuth } from "../harness/setup/runner.js";
import { CodexSetupEventMapper } from "../harness/setup/codex-events.js";
import { createAgentEventEmitter } from "../harness/events/index.js";
import { classifyRecordedSchemaDiscovery } from "../harness/setup/runner.js";
import { LiveWorkLog } from "../server/fold.js";
import type { AgentEvent } from "../harness/events/index.js";

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fakeDispatcher(): Promise<{ cli: { command: string; prefixArgs: string[] }; capture: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "genbi-codex-setup-"));
  dirs.push(dir);
  const script = path.join(dir, "fake-dispatcher.mjs");
  const capture = path.join(dir, "capture.json");
  await writeFile(
    script,
    `import { writeFileSync } from "node:fs";
const capture = process.argv[2];
const args = process.argv.slice(3);
writeFileSync(capture, JSON.stringify({
  args,
  openai: process.env.OPENAI_API_KEY ?? null,
  codex: process.env.CODEX_API_KEY ?? null,
  codexHome: process.env.CODEX_HOME ?? null,
}));
const component = args[args.indexOf("--component") + 1];
console.log(JSON.stringify({ t: "step_start", id: "execute", name: "execute" }));
console.log(JSON.stringify({ t: "tool_call", id: "call-1", name: "setup.setup_execution" }));
console.log(JSON.stringify({ t: "tool_result", id: "call-1", ok: true }));
console.log(JSON.stringify({ t: "answer", text: "SETUP_STATUS: ok - " + component }));
console.log(JSON.stringify({ t: "step_finish", id: "execute", ok: true }));
`,
    "utf8",
  );
  return { cli: { command: process.execPath, prefixArgs: [script, capture] }, capture };
}

async function dispatcherWithTermResistantDescendant(): Promise<{
  cli: { command: string; prefixArgs: string[] };
  marker: string;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "genbi-codex-timeout-"));
  dirs.push(dir);
  const parent = path.join(dir, "parent.mjs");
  const child = path.join(dir, "child.mjs");
  const marker = path.join(dir, "descendant-survived");
  await writeFile(
    child,
    `import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {
  setTimeout(() => writeFileSync(process.argv[2], "alive"), 1400);
});
setInterval(() => {}, 1000);
`,
    "utf8",
  );
  await writeFile(
    parent,
    `import { spawn } from "node:child_process";
spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: "ignore" });
setInterval(() => {}, 1000);
`,
    "utf8",
  );
  return { cli: { command: process.execPath, prefixArgs: [parent, child, marker] }, marker };
}

describe("CodexSetupRunner", () => {
  it("recognizes successful project-bound Wren connector discovery before an MDL exists", () => {
    const command = `WREN_PYTHON="$(sed -n '1s/^#!//p' "$(command -v wren)")"; "$WREN_PYTHON" -c "from pathlib import Path; from wren.profile import resolve_profile_for_project, expand_profile_secrets; from wren.model.data_source import DataSource; from wren.connector import get_connector; _, p = resolve_profile_for_project(Path.cwd(), strict=True); ds = DataSource(p.pop('datasource')); c = get_connector(ds, ds.get_connection_info(expand_profile_secrets(p))); print(c.query('SELECT table_catalog, table_schema, table_name, column_name FROM information_schema.columns').to_pylist()); c.close()"`;
    const worklog = [
      {
        id: "tool:call-connector",
        label: "setup.setup_execution",
        state: "done" as const,
        input: { action: "exec", command, cwd: "/workspace/project" },
        detail: '{"exitCode":0,"stdout":"[{\\"table_name\\":\\"orders\\"}]","stderr":""}',
      },
    ];

    expect(classifyRecordedSchemaDiscovery(worklog)).toEqual({ kind: "successful", command });
  });

  it("fails closed when project-bound Wren connector discovery exits nonzero", () => {
    const command = `WREN_PYTHON="$(sed -n '1s/^#!//p' "$(command -v wren)")"; "$WREN_PYTHON" -c "from wren.profile import resolve_profile_for_project; from wren.connector import get_connector; print('SELECT * FROM information_schema.columns')"`;
    const worklog = [
      {
        id: "tool:call-connector",
        label: "setup.setup_execution",
        state: "done" as const,
        input: { action: "exec", command, cwd: "/workspace/project" },
        detail: '{"exitCode":1,"stdout":"","stderr":"connection failed"}',
      },
    ];

    expect(classifyRecordedSchemaDiscovery(worklog)).toEqual({ kind: "failed", command, exitCode: 1 });
  });

  it("merges the private MCP bridge trace into the persisted discovery worklog", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "genbi-codex-trace-"));
    dirs.push(dir);
    const tracePath = path.join(dir, "trace.jsonl");
    await writeFile(
      tracePath,
      `${JSON.stringify({
        input: { action: "exec", command: 'duckdb source.duckdb -c "SHOW TABLES"', cwd: "/workspace/project" },
        detail: '{"exitCode":0,"stdout":"orders\\ncustomers","stderr":""}',
      })}\n`,
      "utf8",
    );
    const mapper = new CodexSetupEventMapper(tracePath);
    const worklog = new LiveWorkLog();
    const emit = createAgentEventEmitter((event) => worklog.ingest(event));
    for (const line of [
      { t: "step_start", id: "build", name: "build" },
      { t: "tool_call", id: "call-1", name: "setup.setup_execution" },
      { t: "tool_result", id: "call-1", ok: true },
    ]) {
      const event = mapper.nextLine(JSON.stringify(line));
      if (event) emit.emit(event);
    }

    expect(worklog.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "setup.setup_execution",
          state: "done",
          input: { action: "exec", command: 'duckdb source.duckdb -c "SHOW TABLES"', cwd: "/workspace/project" },
          detail: '{"exitCode":0,"stdout":"orders\\ncustomers","stderr":""}',
        }),
      ]),
    );
    expect(classifyRecordedSchemaDiscovery(worklog.snapshot())).toMatchObject({ kind: "successful" });
  });

  it.each(["connect_source", "build_context"] as const)(
    "dispatches %s only through warble-codex-local with the guarded setup MCP tool",
    async (agentId) => {
      const { cli, capture } = await fakeDispatcher();
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "genbi-codex-project-root-"));
      dirs.push(workspaceRoot);
      const projectName = "acme";
      const projectRoot = path.join(workspaceRoot, projectName);
      await mkdir(projectRoot);
      const events: AgentEvent[] = [];
      vi.stubEnv("OPENAI_API_KEY", "must-not-cross");
      vi.stubEnv("CODEX_API_KEY", "must-not-cross");
      vi.stubEnv("CODEX_HOME", "/private/caller-owned-home");
      const runner = new CodexSetupRunner({
        irPath: "/profiles/genbi-setup.json",
        getStrongModel: () => "gpt-5.6-sol",
        codexLocalCli: cli,
        mcpServer: { command: process.execPath, prefixArgs: ["/dist/server/codex-setup-mcp.js"] },
      });

      const result = await runner.run({
        prompt: "set up the project",
        workspaceRoot,
        projectName,
        authChoice: { mode: "subscription", provider: "codex" },
        agentId,
        onEvent: (event) => events.push(event),
      });

      expect(result.finalText).toBe(`SETUP_STATUS: ok - ${agentId}`);
      const captured = JSON.parse(await readFile(capture, "utf8")) as {
        args: string[];
        openai: string | null;
        codex: string | null;
        codexHome: string | null;
      };
      expect(captured.args).toEqual(
        expect.arrayContaining([
          "dispatch",
          "/profiles/genbi-setup.json",
          "--component",
          agentId,
          "--model",
          "gpt-5.6-sol",
          "--source-tool",
          "setup_execution",
          "--context-tool",
          "setup_execution",
          "--stream-json",
        ]),
      );
      const projectArg = captured.args[captured.args.indexOf("--project") + 1];
      const workspaceArg = captured.args[captured.args.indexOf("--server-arg=--workspace-root") + 2];
      const expectedTurnRoot = agentId === "connect_source" ? workspaceRoot : await realpath(projectRoot);
      expect(projectArg).toBe(expectedTurnRoot);
      expect(workspaceArg).toBe(expectedTurnRoot);
      expect(captured.openai).toBeNull();
      expect(captured.codex).toBeNull();
      expect(captured.codexHome).toBe("/private/caller-owned-home");
      expect(events.map((event) => event.kind)).toEqual([
        "run.start",
        "step.start",
        "tool.call",
        "tool.result",
        "answer",
        "step.finish",
        "run.finish",
      ]);
    },
  );

  it("rejects non-Codex auth before resolving or spawning a dispatcher", async () => {
    const runner = new CodexSetupRunner({ irPath: "/ir.json", getStrongModel: () => "gpt-5.6-sol" });
    await expect(
      runner.run({
        prompt: "setup",
        workspaceRoot: "/workspace",
        authChoice: { mode: "subscription", provider: "claude" },
      }),
    ).rejects.toThrow(/requires a Codex subscription/);
  });

  it(
    "escalates timeout cleanup to the whole process group after the direct child exits",
    async () => {
      const { cli, marker } = await dispatcherWithTermResistantDescendant();
      const runner = new CodexSetupRunner({
        irPath: "/ir.json",
        getStrongModel: () => "gpt-5.6-sol",
        codexLocalCli: cli,
        mcpServer: { command: process.execPath, prefixArgs: ["/dist/server/codex-setup-mcp.js"] },
        timeoutMs: 50,
      });

      await expect(
        runner.run({
          prompt: "setup",
          workspaceRoot: "/workspace",
          authChoice: { mode: "subscription", provider: "codex" },
        }),
      ).rejects.toThrow(/timed out/);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    },
    10_000,
  );

  it("selects Codex, Claude, and non-subscription setup runners without fallback", () => {
    const claude = { run: vi.fn() };
    const codex = { run: vi.fn() };
    const modeA = { run: vi.fn() };
    const runners = { claudeSubscription: claude, codexSubscription: codex, nonSubscription: modeA };

    expect(selectSetupRunnerForAuth({ mode: "subscription", provider: "codex" }, runners)).toBe(codex);
    expect(selectSetupRunnerForAuth({ mode: "subscription", provider: "claude" }, runners)).toBe(claude);
    expect(selectSetupRunnerForAuth({ mode: "api-key", adapter: "mock" }, runners)).toBe(modeA);
  });
});
