import { readFile } from "node:fs/promises";
import type { AuthChoice } from "../auth/index.js";
import type { Bundle } from "../bundle/schema.js";
import { loadBundle } from "../bundle/loader.js";
import { compileProfile } from "../compile/pipeline.js";
import { buildAgentSdkManifestArgs, runAgentSdkManifest } from "./agent-sdk-manifest.js";
import { resolveAgentSdkCli } from "./agent-sdk-cli.js";

/**
 * The subset of `RouteOptions`/`ModeAOptions` needed to describe how a
 * profile is CURRENTLY realized. `authChoice` is required (not optional)
 * because it's the discriminator `describeBundle` branches on — see below —
 * unlike `question`/`onEvent`/model-routing options, which don't affect what
 * gets described.
 */
export interface DescribeBundleOptions {
  readonly authChoice: AuthChoice;
  readonly profileSource: string;
  readonly userProject: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly workDir?: string;
}

/**
 * Describes whichever back-end will ACTUALLY run a turn for
 * `options.authChoice` — the invariant this maintains is: Harness-shown
 * target == `runtimeDispatcher`'s prediction (`server/harness.ts`)
 * == what `route()` really dispatches to. The IR itself stays target-neutral
 * either way; only the DISPLAY artifact this function loads differs:
 *
 * - `authChoice.mode === "subscription"` (Mode B): compiles IR only
 *   (`mode: "native"`, reusing `compileProfile`'s cache) — no vercel bundle
 *   is produced on this path at all — then sources the display from the
 *   claude-agent-sdk dispatcher's OWN `manifest` subcommand, which reads
 *   that same IR and emits a structurally-identical-to-the-vercel-bundle
 *   JSON (`target: "claude-agent-sdk:local"`) to stdout. This is genuinely
 *   what Mode B runs — `runModeBDefault` (`./mode-b.js`) shells this same
 *   dispatcher's `chat` subcommand against the same IR.
 * - every other `authChoice.mode` (Mode A: api-key/local/gateway): compiles
 *   to a vercel bundle (`mode: "agnostic"`, `warble dispatch --target
 *   vercel`) — unchanged pre-existing behavior; `runModeADefault`
 *   (`./mode-a.js`) calls this too rather than keeping its own copy.
 */
export async function describeBundle(options: DescribeBundleOptions): Promise<Bundle> {
  if (options.authChoice.mode === "subscription") {
    return describeAgentSdkManifest(options);
  }
  return describeVercelBundle(options);
}

async function describeVercelBundle(options: DescribeBundleOptions): Promise<Bundle> {
  const compiled = await compileProfile({
    profileSource: options.profileSource,
    userProject: options.userProject,
    mode: "agnostic",
    ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
  });
  // `mode: "agnostic"` always produces a bundle — see `compileProfile`'s doc comment.
  const bundleJson = JSON.parse(await readFile(compiled.bundlePath!, "utf-8"));
  return loadBundle(bundleJson);
}

async function describeAgentSdkManifest(options: DescribeBundleOptions): Promise<Bundle> {
  const compiled = await compileProfile({
    profileSource: options.profileSource,
    userProject: options.userProject,
    mode: "native",
    ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
  });
  const cli = await resolveAgentSdkCli(options.agentSdkBin);
  const { command, args } = buildAgentSdkManifestArgs(cli, {
    irPath: compiled.irPath,
    userProject: options.userProject,
  });
  const stdout = await runAgentSdkManifest(command, args);
  return loadBundle(JSON.parse(stdout));
}
