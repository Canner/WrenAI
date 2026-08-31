import { readFile } from "node:fs/promises";
import type { AuthChoice } from "../auth/index.js";
import type { Bundle } from "../bundle/schema.js";
import { loadBundleWithProvenance } from "../bundle/loader.js";
import { compileProfile, compileRawProfile } from "../compile/pipeline.js";
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
  return purpose === "context_enrichment"
    ? describeCodexEnrichmentManifest(cli, compiled.irPath, models)
    : describeCodexAskManifest(cli, compiled.irPath, models);
}

async function describeVercelBundle(options: DescribeBundleOptions): Promise<Bundle> {
  const compiled = await compileForDescription(options, "agnostic");
  // `mode: "agnostic"` always produces a bundle — see `compileProfile`'s doc comment.
  const bundleJson = JSON.parse(await readFile(compiled.bundlePath!, "utf-8"));
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
  return loadBundleWithProvenance(JSON.parse(stdout), {
    ...(compiled.warbleBin !== undefined ? { warbleBin: compiled.warbleBin } : {}),
    profileSource: options.profileSource,
  });
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
