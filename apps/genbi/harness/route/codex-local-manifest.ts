import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planDigest } from "../components/plan.js";
import type { ComponentBinding } from "@warble/codex-local";
import { loadBundle } from "../bundle/loader.js";
import type { Bundle } from "../bundle/schema.js";
import type { ResolvedCli } from "./agent-sdk-cli.js";

export interface CodexManifestModels {
  readonly orchestrator: string;
  readonly cheap: string;
  readonly strong: string;
}

export const CODEX_ASK_COMPONENTS = ["answer_query", "generate_dashboard"] as const;
export type CodexAskComponent = (typeof CODEX_ASK_COMPONENTS)[number];
export const CODEX_ENRICH_COMPONENTS = ["inspect_context", "draft_enrichment"] as const;
export type CodexManifestPurpose = "analysis" | "setup" | "context_enrichment";

export function codexAnalysisToolArgs(component: CodexAskComponent): string[] {
  const bindings = component === "answer_query"
    ? ["resolve_intent=get_context", "generate_sql=run_sql", "repair_sql=run_sql"]
    : ["plan_dashboard=get_context", "compose_layout=run_sql"];
  const required = component === "answer_query"
    ? ["generate_sql", "repair_sql"]
    : ["plan_dashboard", "compose_layout"];
  return ["--transport", "orchestrate", ...bindings.flatMap((binding) => ["--step-tool", binding]),
    ...required.flatMap((step) => ["--require-tool", step])];
}

export function buildCodexAskManifestArgs(
  cli: ResolvedCli,
  irPath: string,
  models: CodexManifestModels,
  component: CodexAskComponent = "answer_query",
): readonly string[] {
  return [
    ...cli.prefixArgs,
    "manifest",
    irPath,
    "--component",
    component,
    "--orchestrator-model",
    models.orchestrator,
    "--cheap-model",
    models.cheap,
    "--strong-model",
    models.strong,
    // Manifest preparation validates an absolute MCP command but does not
    // spawn it; the runtime binds the real Wren MCP command separately.
    "--server-command",
    process.execPath,
    ...codexAnalysisToolArgs(component),
  ];
}

export function buildCodexBootstrapManifestArgs(cli: ResolvedCli, irPath: string): readonly string[] {
  return [
    ...cli.prefixArgs,
    "manifest",
    irPath,
    "--server-command",
    process.execPath,
    "--transport", "exec",
    "--step-tool", "connect=setup_execution",
    "--step-tool", "build=setup_execution",
    "--require-tool", "connect",
    "--require-tool", "build",
  ];
}

export function buildCodexEnrichmentManifestArgs(
  cli: ResolvedCli,
  irPath: string,
  models: CodexManifestModels,
  component: (typeof CODEX_ENRICH_COMPONENTS)[number],
): readonly string[] {
  return [
    ...cli.prefixArgs,
    "manifest",
    irPath,
    "--component",
    component,
    "--model",
    component === "inspect_context" ? models.cheap : models.strong,
    "--server-command",
    process.execPath,
    "--transport", "turn",
    "--step-tool", `${component === "inspect_context" ? "inspect" : "draft"}=get_context`,
    "--require-tool", component === "inspect_context" ? "inspect" : "draft",
  ];
}

async function describeCodexComponentManifests(
  cli: ResolvedCli,
  irPath: string,
  components: readonly string[],
  argsFor: (component: string) => readonly string[],
): Promise<Bundle> {
  const ir = JSON.parse(await readFile(irPath, "utf8")) as Record<string, unknown>;
  const bundles = await Promise.all(
    components.map(async (component) => {
      const stdout = await execCodexManifest(
        cli.command,
        argsFor(component),
      );
      return normalizeCodexManifest(JSON.parse(stdout) as Record<string, unknown>, ir);
    }),
  );
  const primary = bundles[0]!;
  for (const bundle of bundles.slice(1)) {
    if (
      bundle.manifest_version !== primary.manifest_version ||
      JSON.stringify(bundle.compat) !== JSON.stringify(primary.compat) ||
      bundle.profile !== primary.profile ||
      bundle.target !== primary.target
    ) {
      throw new Error("Codex component manifests disagree on their target identity");
    }
  }
  return loadBundle({ ...primary, agents: bundles.flatMap((bundle) => bundle.agents) });
}

export async function describeCodexAskManifest(
  cli: ResolvedCli,
  irPath: string,
  models: CodexManifestModels,
  context?: CodexManifestContext,
): Promise<Bundle> {
  const ir = JSON.parse(await readFile(irPath, "utf8")) as Record<string, unknown>;
  if (records(ir.components).some((node) => records(node.llm_calls).some((step) => records(step.component_calls).length))) {
    if (!context) throw new Error("Codex composed manifest requires component-owned prepared context");
    return describeComposedCodexManifest(cli, irPath, ir, models, context);
  }
  return describeCodexComponentManifests(
    cli,
    irPath,
    CODEX_ASK_COMPONENTS,
    (component) => buildCodexAskManifestArgs(cli, irPath, models, component as CodexAskComponent),
  );
}

export interface CodexManifestContext {
  readonly warbleBin: string;
  readonly contexts: Readonly<Record<string, { readonly binding: unknown; readonly snapshot: unknown }>>;
}

async function describeComposedCodexManifest(cli: ResolvedCli, irPath: string, ir: Record<string, unknown>, models: CodexManifestModels, context: CodexManifestContext): Promise<Bundle> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "genbi-codex-manifest-"));
  try {
    const bindings: Record<string, ComponentBinding> = Object.fromEntries(CODEX_ASK_COMPONENTS.map((id) => {
      const node = records(ir.components).find((component) => component.id === id);
      const prepared = context.contexts[id];
      if (!node || !prepared || planDigest(prepared.binding) !== planDigest(node.context_binding)) {
        throw new Error(`Codex manifest context binding mismatch for ${id}`);
      }
      // Display preparation never launches this MCP command. Tools remain owned
      // by the answer component; the dashboard only receives its call alias.
      return [id, { transport: "orchestrate", models, context: JSON.stringify(prepared.snapshot), mcp: {
        name: "wren", command: process.execPath,
        toolsByStep: id === "answer_query" ? { resolve_intent: ["get_context"], generate_sql: ["run_sql"], repair_sql: ["run_sql"] }
          : { plan_dashboard: [], compose_layout: [] },
        requireTool: id === "answer_query" ? ["generate_sql", "repair_sql"] : [],
      } }];
    }));
    const file = path.join(dir, "bindings.json");
    await writeFile(file, JSON.stringify({ components: bindings }), { mode: 0o600 });
    const bundles = [];
    for (const id of CODEX_ASK_COMPONENTS) {
      const manifest = JSON.parse(await execCodexManifest(cli.command, [...cli.prefixArgs, "manifest", irPath,
        "--component", id, "--transport", "orchestrate", "--component-bindings", file, "--warble-bin", context.warbleBin]));
      if (manifest.version !== "0.3" || manifest.target !== "codex:local" || manifest.profile !== ir.profile || manifest.entry !== id || manifest.transport !== "orchestrate") {
        throw new Error("Unexpected composed Codex manifest identity");
      }
      const nodes = records(manifest.components);
      const expectedIds: readonly string[] = id === "answer_query" ? [id] : [...CODEX_ASK_COMPONENTS];
      if (nodes.length !== expectedIds.length || new Set(nodes.map((node) => node.id)).size !== nodes.length || nodes.some((node) => !expectedIds.includes(String(node.id)))) {
        throw new Error("Unexpected composed Codex manifest closure");
      }
      for (const node of nodes) {
        const source = records(ir.components).find((candidate) => candidate.id === node.id)!;
        const emitted = records(node.steps);
        const declared = records(source.llm_calls);
        if (emitted.length !== declared.length) throw new Error("Unexpected composed Codex manifest steps");
        for (let index = 0; index < declared.length; index++) {
          const step = declared[index]!;
          const actual = emitted[index]!;
          const aliases = Object.fromEntries(records(step.component_calls).map((edge) => [String(edge.alias), edge.component]));
          const tools = bindings[String(node.id)]!.mcp.toolsByStep[String(step.name)] ?? [];
          if (actual.name !== step.name || planDigest(actual.componentCalls) !== planDigest(aliases) || planDigest(actual.enabledTools) !== planDigest(tools)) {
            throw new Error("Unexpected composed Codex manifest tool authority");
          }
        }
      }
      const entries = records(manifest.components).filter((node) => node.role === "entry");
      if (entries.length !== 1 || entries[0]!.id !== id) throw new Error("Unexpected composed Codex manifest entry");
      const entry = entries[0]!;
      const steps = records(entry.steps);
      bundles.push(normalizeCodexManifest({ manifest_version: "0.1", target: manifest.target, profile: manifest.profile,
        compat: { min_ir_version: ir.warble_ir_version, max_ir_version: ir.warble_ir_version },
        agents: [{ ...entry, steps: steps.map((step) => ({ name: step.name })),
          tools: [...new Set(steps.flatMap((step) => Array.isArray(step.enabledTools) ? step.enabledTools.map(String) : []))].map((name) => ({ name, source: "mcp:wren" })) }],
      }, ir));
    }
    return loadBundle({ ...bundles[0]!, agents: bundles.flatMap((bundle) => bundle.agents) });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/**
 * Setup is a raw/bootstrap profile, not an Ask profile. Its dispatcher has a
 * dedicated whole-profile `manifest` command that neither needs nor accepts a
 * bound Wren project, so never route it through the Ask-only component list.
 */
export async function describeCodexBootstrapManifest(cli: ResolvedCli, irPath: string): Promise<Bundle> {
  const ir = JSON.parse(await readFile(irPath, "utf8")) as Record<string, unknown>;
  const stdout = await execCodexManifest(cli.command, buildCodexBootstrapManifestArgs(cli, irPath));
  return normalizeCodexManifest(JSON.parse(stdout) as Record<string, unknown>, ir);
}

export async function describeCodexEnrichmentManifest(
  cli: ResolvedCli,
  irPath: string,
  models: CodexManifestModels,
): Promise<Bundle> {
  return describeCodexComponentManifests(
    cli,
    irPath,
    CODEX_ENRICH_COMPONENTS,
    (component) => buildCodexEnrichmentManifestArgs(
      cli,
      irPath,
      models,
      component as (typeof CODEX_ENRICH_COMPONENTS)[number],
    ),
  );
}

function execCodexManifest(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`warble-codex-local manifest failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
}

function normalizeCodexManifest(manifest: Record<string, unknown>, ir: Record<string, unknown>): Bundle {
  const irComponents = records(ir["components"]);
  const agents = records(manifest["agents"]).map((agent) => {
    const id = String(agent["id"] ?? "");
    const component = irComponents.find((candidate) => candidate["id"] === id);
    if (!component) throw new Error(`Codex manifest component "${id}" is absent from compiled IR`);
    const irSteps = records(component["llm_calls"]);
    const irGuards = records(component["guardrails"]);
    const renderBlocks = records((component["effect"] as Record<string, unknown> | undefined)?.["render_blocks"]);
    const manifestGuards = (agent["guardrails"] ?? {}) as Record<string, Record<string, unknown>>;

    return {
      id,
      verb: String(agent["verb"] ?? component["verb"] ?? id),
      component_type: String(agent["component_type"] ?? component["type"] ?? "analytical"),
      realization_kind: String(agent["realization_kind"] ?? component["realization_kind"] ?? "skill"),
      trigger: String(agent["trigger"] ?? (component["trigger"] as Record<string, unknown> | undefined)?.["kind"] ?? "one_shot"),
      outcome: String(agent["outcome"] ?? (component["effect"] as Record<string, unknown> | undefined)?.["outcome"] ?? "none"),
      steps: records(agent["steps"]).map((step) => {
        const name = String(step["name"] ?? "");
        const source = irSteps.find((candidate) => candidate["name"] === name) ?? {};
        const when = source["when"] as Record<string, unknown> | null | undefined;
        return {
          name,
          tier: String(step["tier"] ?? source["tier"] ?? "strong"),
          consumes: Array.isArray(step["consumes"]) ? step["consumes"].map(String) : Array.isArray(source["consumes"]) ? source["consumes"].map(String) : [],
          produces: String(step["produces"] ?? source["produces"] ?? "result"),
          prompt: String(source["prompt"] ?? ""),
          realization: when
            ? { kind: "repair_fold", fold_into: String(when["target"] ?? ""), max_attempts: 1 }
            : { kind: "independent" },
          ...(when ? { when: { guard: String(when["guard"] ?? ""), target: String(when["target"] ?? "") } } : {}),
        };
      }),
      guardrails: Object.fromEntries(
        irGuards.map((guard) => {
          const name = String(guard["name"] ?? "");
          const described = manifestGuards[name] ?? {};
          return [
            name,
            {
              enforcement: String(described["enforcement"] ?? "codex-local"),
              locked: Boolean(guard["locked"]),
              ...(typeof guard["threshold"] === "number" ? { threshold: guard["threshold"] } : {}),
              ...(typeof guard["scope"] === "string" ? { scope: guard["scope"] } : {}),
            },
          ];
        }),
      ),
      tools: records(agent["tools"]).map((tool) => ({ name: String(tool["name"] ?? ""), source: String(tool["source"] ?? "") })),
      output_schema: {
        properties: {
          blocks: {
            items: {
              anyOf: renderBlocks.map((block) => ({ properties: { type: { const: String(block["type"] ?? "") } } })),
            },
          },
        },
      },
      capabilities: records(agent["capabilities"]).map((capability) => ({
        capability: String(capability["capability"] ?? ""),
        outcome: String(capability["outcome"] ?? "native"),
        provided_by: typeof capability["via"] === "string" ? capability["via"] : "codex-local",
        criticality: "required",
      })),
    };
  });

  return loadBundle({
    manifest_version: manifest["manifest_version"],
    compat: manifest["compat"],
    profile: manifest["profile"],
    target: manifest["target"],
    agents,
  });
}
