import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generatePreparedContext, resolveContextLoaderBinary } from "../compile/context-loader.js";
import { resolveWarbleBinary } from "../compile/resolve-binary.js";
import type { AuthChoice } from "../auth/index.js";
import type { Bundle } from "../bundle/schema.js";
import { loadBundleWithProvenance } from "../bundle/loader.js";
import { compileProfile, compileRawProfile } from "../compile/pipeline.js";
import { planDigest, readExecutionPlan } from "../components/plan.js";
import { describeComponentPlan } from "../components/display.js";
import { buildAgentSdkManifestArgs, runAgentSdkManifest } from "./agent-sdk-manifest.js";
import { resolveAgentSdkCli } from "./agent-sdk-cli.js";
import { resolveCodexLocalCli } from "./codex-local-cli.js";
import { describeCodexAskManifest, describeCodexBootstrapManifest, describeCodexEnrichmentManifest, type CodexManifestModels, type CodexManifestPurpose } from "./codex-local-manifest.js";

/**
 * The subset of `RouteOptions`/`InProcessOptions` needed to describe how a
 * profile is CURRENTLY realized. `authChoice` is required (not optional)
 * because it's the discriminator `describeBundle` branches on — see below —
 * unlike `question`/`onEvent`/model-routing options, which don't affect what
 * gets described.
 */
interface DescribeBundleBaseOptions {
  readonly authChoice: AuthChoice;
  readonly profileSource: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly codexLocalBin?: string;
  readonly codexModels?: CodexManifestModels;
  readonly workDir?: string;
  /** Selects the executable component family shown by the purpose-scoped Harness. */
  readonly codexManifestPurpose?: CodexManifestPurpose;
}

/** A profile whose context must be rebound to the currently bound project. */
export interface BoundDescribeBundleOptions extends DescribeBundleBaseOptions {
  /** Omitted by legacy bound callers; bootstrap must always be explicit. */
  readonly context?: "bound_project";
  readonly userProject: string;
}

/** A profile that owns its authored raw/bootstrap context and has no user project. */
export interface BootstrapDescribeBundleOptions extends DescribeBundleBaseOptions {
  readonly context: "bootstrap";
}

export type DescribeBundleOptions = BoundDescribeBundleOptions | BootstrapDescribeBundleOptions;

/**
 * Describes whichever back-end will ACTUALLY run a turn for
 * `options.authChoice` — the invariant this maintains is: Harness-shown
 * target == `runtimeDispatcher`'s prediction (`server/harness.ts`)
 * == what `route()` really dispatches to. The IR itself stays target-neutral
 * either way; only the DISPLAY artifact this function loads differs:
 *
 * - `authChoice.mode === "subscription"` (dispatched): compiles IR only
 *   (`mode: "native"`, reusing `compileProfile`'s cache) — no vercel bundle
 *   is produced on this path at all — then sources the display from the
 *   claude-agent-sdk dispatcher's OWN `manifest` subcommand, which reads
 *   that same IR and emits a structurally-identical-to-the-vercel-bundle
 *   JSON (`target: "claude-agent-sdk:local"`) to stdout. This is genuinely
 *   what dispatched runs — `runDispatchedDefault` (`./dispatched.js`) shells this same
 *   dispatcher's `chat` subcommand against the same IR.
 * - every other `authChoice.mode` (in-process: api-key/local/gateway): compiles
 *   to a vercel bundle (`mode: "agnostic"`, `warble dispatch --target
 *   vercel`) — unchanged pre-existing behavior; `runInProcessDefault`
 *   (`./in-process.js`) calls this too rather than keeping its own copy.
 */
export async function describeBundle(options: DescribeBundleOptions): Promise<Bundle> {
  if (options.authChoice.mode === "subscription") {
    if (options.authChoice.provider === "codex") return describeCodexManifest(options);
    return describeAgentSdkManifest(options);
  }
  return describeVercelBundle(options);
}

async function describeCodexManifest(options: DescribeBundleOptions): Promise<Bundle> {
  const compiled = await compileForDescription(options, "native");
  const purpose = options.codexManifestPurpose ?? (options.context === "bootstrap" ? "setup" : "analysis");
  if (purpose === "setup") {
    const cli = await resolveCodexLocalCli(options.codexLocalBin);
    return describeCodexBootstrapManifest(cli, compiled.irPath);
  }
  const models = options.codexModels;
  if (!models || !models.orchestrator.trim() || !models.cheap.trim() || !models.strong.trim()) {
    throw new Error("Codex manifest requires orchestrator, cheap, and strong model bindings");
  }
  const cli = await resolveCodexLocalCli(options.codexLocalBin);
  if (purpose === "context_enrichment") return describeCodexEnrichmentManifest(cli, compiled.irPath, models);
  const ir = JSON.parse(await readFile(compiled.irPath, "utf8"));
  if (!ir.components.some((node: { llm_calls: { component_calls?: unknown[] }[] }) => node.llm_calls.some((step) => step.component_calls?.length))) {
    return describeCodexAskManifest(cli, compiled.irPath, models);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "genbi-manifest-context-"));
  try {
    if (options.context === "bootstrap") throw new Error("Composed analysis requires a bound project");
    const project = await realpath(options.userProject);
    for (const id of ["answer_query", "generate_dashboard"]) {
      const binding = ir.components.find((node: { id: string }) => node.id === id)?.context_binding;
      if (!binding || typeof binding.project !== "string" || !path.isAbsolute(binding.project) || await realpath(binding.project) !== project) {
        throw new Error(`Codex manifest cannot capture context for ${id} from a different project`);
      }
    }
    const file = path.join(dir, "context.json");
    await generatePreparedContext(resolveContextLoaderBinary(), project, file);
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    return await describeCodexAskManifest(cli, compiled.irPath, models, {
      warbleBin: await resolveWarbleBinary(options.warbleBin),
      contexts: Object.fromEntries(ir.components.map((node: { id: string; context_binding: unknown }) => [node.id, { binding: node.context_binding, snapshot }])),
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function describeVercelBundle(options: DescribeBundleOptions): Promise<Bundle> {
  const compiled = await compileForDescription(options, "agnostic");
  // `mode: "agnostic"` always produces a bundle — see `compileProfile`'s doc comment.
  const bundleJson = JSON.parse(await readFile(compiled.bundlePath!, "utf-8"));
  if (bundleJson.vercel_bundle_version === "0.2") {
    const ir = JSON.parse(await readFile(compiled.irPath, "utf8"));
    const plan = readExecutionPlan(JSON.stringify(bundleJson), { digest: bundleJson.bundle_sha256, inputIrDigest: planDigest(ir), declarations: Object.fromEntries(ir.components.map((node: { id: string }) => [node.id, node])), contextBinding: ir.context_binding });
    return describeComponentPlan(plan, bundleJson.profile);
  }
  return loadBundleWithProvenance(bundleJson, {
    ...(compiled.warbleBin !== undefined ? { warbleBin: compiled.warbleBin } : {}),
    profileSource: options.profileSource,
  });
}

async function describeAgentSdkManifest(options: DescribeBundleOptions): Promise<Bundle> {
  const compiled = await compileForDescription(options, "native");
  const cli = await resolveAgentSdkCli(options.agentSdkBin);
  const { command, args } = buildAgentSdkManifestArgs(cli, {
    irPath: compiled.irPath,
    ...(options.context !== "bootstrap" ? { userProject: options.userProject } : {}),
  });
  const stdout = await runAgentSdkManifest(command, args);
  const manifest = JSON.parse(stdout);
  if (manifest.target !== "claude-agent-sdk:local") throw new Error("Unexpected SDK manifest target");
  return loadBundleWithProvenance(manifest, {
    ...(compiled.warbleBin !== undefined ? { warbleBin: compiled.warbleBin } : {}),
    profileSource: options.profileSource,
  }, { irVersion: "0.8", bundleVersions: ["0.1", "0.3"] });
}

function compileForDescription(
  options: DescribeBundleOptions,
  mode: "native" | "agnostic",
) {
  const shared = {
    profileSource: options.profileSource,
    mode,
    ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
  } as const;
  return options.context === "bootstrap"
    ? compileRawProfile(shared)
    : compileProfile({ ...shared, userProject: options.userProject });
}
