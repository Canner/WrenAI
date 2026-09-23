import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodexAskManifestArgs, buildCodexBootstrapManifestArgs, buildCodexEnrichmentManifestArgs, describeCodexAskManifest } from "../harness/route/codex-local-manifest.js";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { resolveCodexLocalCli } from "../harness/route/codex-local-cli.js";
import { describeBundle } from "../harness/route/describe.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("Codex manifest adapter", () => {
  it("accepts the installed composed dispatcher and refuses missing or mismatched callee context", async () => {
    const irPath = path.resolve("profiles/genbi-default/ir.golden.json");
    const ir = JSON.parse(await readFile(irPath, "utf8"));
    const snapshot = JSON.parse(await readFile(path.resolve("profiles/genbi-default/context/context.json"), "utf8"));
    const cli = await resolveCodexLocalCli();
    const models = { orchestrator: "fixture", cheap: "fixture", strong: "fixture" };
    const contexts = Object.fromEntries(ir.components.map((node: { id: string; context_binding: unknown }) => [node.id, { binding: node.context_binding, snapshot }]));
    const context = { warbleBin: await resolveWarbleBinary(), contexts };
    const bundle = await describeCodexAskManifest(cli, irPath, models, context);
    expect(bundle.agents.map((agent) => agent.id)).toEqual(["answer_query", "generate_dashboard"]);
    expect(bundle.agents[0]!.tools.map((tool) => tool.name)).toContain("run_sql");
    expect(bundle.agents[1]!.tools).toEqual([]);
    expect(bundle.agents[1]!.capabilities.some((cap) => cap.capability === "component_invocation")).toBe(true);
    expect(bundle.agents[1]!.steps[1]!.consumes).toContain("dashboard_plan");
    await expect(describeCodexAskManifest(cli, irPath, models)).rejects.toThrow(/prepared context/);
    await expect(describeCodexAskManifest(cli, irPath, models, { ...context, contexts: { ...contexts, answer_query: { binding: { project: "wrong" }, snapshot } } })).rejects.toThrow(/binding mismatch/);
    await expect(describeCodexAskManifest(cli, irPath, models, { ...context, contexts: { ...contexts, answer_query: { ...contexts.answer_query!, snapshot: { context_version: 2, parseable: false } } } })).rejects.toThrow();
  });

  it("captures the actual bound project for the product Codex description", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "codex-bound-description-")); dirs.push(dir);
    const bundle = await describeBundle({ authChoice: { mode: "subscription", provider: "codex" },
      profileSource: path.resolve("profiles/genbi-default"), userProject: path.resolve("../../examples/v5-jaffle"), workDir: dir,
      warbleBin: await resolveWarbleBinary(), codexModels: { orchestrator: "fixture", cheap: "fixture", strong: "fixture" } });
    expect(bundle.agents.map((agent) => agent.id)).toEqual(["answer_query", "generate_dashboard"]);
    expect(bundle.agents[1]!.tools).toEqual([]);
  });

  it("uses the generic manifest command while retaining the component and MCP tool contract", () => {
    expect(buildCodexAskManifestArgs(
      { command: "warble-codex-local", prefixArgs: ["--quiet"] },
      "/tmp/ir.json",
      { orchestrator: "driver", cheap: "cheap", strong: "strong" },
      "generate_dashboard",
    )).toEqual([
      "--quiet", "manifest", "/tmp/ir.json", "--component", "generate_dashboard",
      "--orchestrator-model", "driver", "--cheap-model", "cheap", "--strong-model", "strong",
      "--server-command", process.execPath, "--transport", "orchestrate",
      "--step-tool", "plan_dashboard=get_context", "--step-tool", "compose_layout=run_sql",
      "--require-tool", "plan_dashboard", "--require-tool", "compose_layout",
    ]);
  });

  it("binds Setup and enrichment manifests to their purpose-specific MCP contracts", () => {
    const cli = { command: "warble-codex-local", prefixArgs: ["--quiet"] };
    const models = { orchestrator: "driver", cheap: "cheap", strong: "strong" };
    expect(buildCodexBootstrapManifestArgs(cli, "/tmp/setup.json")).toEqual([
      "--quiet", "manifest", "/tmp/setup.json", "--server-command", process.execPath,
      "--transport", "exec", "--step-tool", "connect=setup_execution", "--step-tool", "build=setup_execution",
      "--require-tool", "connect", "--require-tool", "build",
    ]);
    expect(buildCodexEnrichmentManifestArgs(cli, "/tmp/enrich.json", models, "inspect_context")).toEqual([
      "--quiet", "manifest", "/tmp/enrich.json", "--component", "inspect_context", "--model", "cheap",
      "--server-command", process.execPath, "--transport", "turn",
      "--step-tool", "inspect=get_context", "--require-tool", "inspect",
    ]);
    expect(buildCodexEnrichmentManifestArgs(cli, "/tmp/enrich.json", models, "draft_enrichment")).toContain("strong");
    expect(buildCodexEnrichmentManifestArgs(cli, "/tmp/enrich.json", models, "draft_enrichment")).not.toContain("answer_query");
  });

  it("loads dispatcher-owned codex:local describe data against the same compiled IR", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "genbi-codex-manifest-"));
    dirs.push(dir);
    const irPath = path.join(dir, "ir.json");
    const script = path.join(dir, "manifest.mjs");
    await writeFile(
      irPath,
      JSON.stringify({
        components: [
          {
            id: "answer_query",
            verb: "answer_query",
            type: "analytical",
            realization_kind: "skill",
            trigger: { kind: "one_shot" },
            effect: { outcome: { kind: "none" }, render_blocks: [{ type: "table" }] },
            llm_calls: [
              { name: "resolve_intent", tier: "cheap", consumes: [], produces: "intent", prompt: "resolve", when: null },
              {
                name: "generate_sql",
                tier: "strong",
                consumes: ["intent"],
                produces: "result",
                prompt: "query",
                when: null,
              },
            ],
            guardrails: [{ name: "read_only_execution", locked: true }],
          },
          {
            id: "generate_dashboard",
            verb: "generate_dashboard",
            type: "analytical",
            realization_kind: "skill",
            trigger: { kind: "one_shot" },
            effect: {
              outcome: { kind: "none" },
              render_blocks: [
                { type: "kpi_card" },
                { type: "chart" },
                { type: "table" },
                { type: "definition" },
              ],
            },
            llm_calls: [
              { name: "plan_dashboard", tier: "strong", consumes: [], produces: "dashboard_plan", prompt: "plan", when: null },
              { name: "compose_layout", tier: "cheap", consumes: ["dashboard_plan"], produces: "dashboard", prompt: "compose", when: null },
            ],
            guardrails: [{ name: "read_only_execution", locked: true }],
          },
        ],
      }),
    );
    await writeFile(
      script,
      `const component = process.argv[process.argv.indexOf("--component") + 1];
const dashboard = component === "generate_dashboard";
console.log(JSON.stringify({
  manifest_version: "0.1",
  compat: { min_ir_version: "0.8", max_ir_version: "0.8" },
  profile: "genbi-default",
  target: "codex:local",
  agents: [{
    id: component, verb: component, component_type: "analytical",
    realization_kind: "skill", trigger: "one_shot", outcome: "none",
    steps: dashboard ? [
      { name: "plan_dashboard", tier: "strong", consumes: [], produces: "dashboard_plan" },
      { name: "compose_layout", tier: "cheap", consumes: ["dashboard_plan"], produces: "dashboard" }
    ] : [
      { name: "resolve_intent", tier: "cheap", consumes: [], produces: "intent" },
      { name: "generate_sql", tier: "strong", consumes: ["intent"], produces: "result" }
    ],
    capabilities: dashboard
      ? [{ capability: "artifact_write", outcome: "realize-via", via: "consumer-persisted-render-envelope" }]
      : [{ capability: "llm:per_step_tier", outcome: "native", via: null }],
    tools: [{ name: "get_context", source: "mcp:wren" }, { name: "run_sql", source: "mcp:wren" }],
    guardrails: { read_only_execution: { enforcement: "per_agent_mcp_only_read_only_sandbox", locked: true } }
  }]
}));`,
    );

    const bundle = await describeCodexAskManifest(
      { command: process.execPath, prefixArgs: [script] },
      irPath,
      { orchestrator: "driver", cheap: "cheap", strong: "strong" },
    );

    expect(bundle.target).toBe("codex:local");
    expect(bundle.profile).toBe("genbi-default");
    expect(bundle.agents.map((agent) => agent.id)).toEqual(["answer_query", "generate_dashboard"]);
    expect(bundle.agents[0]?.steps.map((step) => [step.name, step.tier])).toEqual([
      ["resolve_intent", "cheap"],
      ["generate_sql", "strong"],
    ]);
    expect(bundle.agents[0]?.tools.map((tool) => tool.name)).toEqual(["get_context", "run_sql"]);
    expect(bundle.agents[1]?.steps.map((step) => [step.name, step.tier])).toEqual([
      ["plan_dashboard", "strong"],
      ["compose_layout", "cheap"],
    ]);
    expect(bundle.agents[1]?.capabilities.map((capability) => capability.capability)).toContain("artifact_write");
  });
});
