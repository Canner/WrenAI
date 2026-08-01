import os from "node:os";
import path from "node:path";
import { createDefaultCapabilityRegistry } from "../capability/registry.js";
import { createLocalExecutionEnv } from "../exec/index.js";
import { deriveEnforcement } from "../guardrails/index.js";
import { createDefaultProviderRegistry } from "../providers/index.js";
import { runAgent } from "../session/index.js";
import type { RunAgentResult } from "../session/index.js";
import { createWrenNativeToolRegistry, resolveWrenBinary } from "../tools/index.js";
import { deriveAdapterSpec } from "./adapter-spec.js";
import { describeBundle } from "./describe.js";
import { buildHybridTierBinding, buildUniformTierBinding } from "./tier-binding.js";
import type { ModeAOptions } from "./types.js";

const ANSWER_QUERY_AGENT_ID = "answer_query";

/** Operator-wide override for `resolveArtifactsDir`'s default, e.g. for a long-running BFF process. */
const ARTIFACTS_DIR_ENV_VAR = "WREN_HARNESS_ARTIFACTS_DIR";

/**
 * Resolves the `rootDir` the native `write_artifact` tool's
 * `createLocalExecutionEnv` scope is rooted at. Precedence: an explicit
 * `outDir` (per-call override, e.g. `ModeAOptions.outDir` /
 * `WREN_HARNESS_OUT`) > the `WREN_HARNESS_ARTIFACTS_DIR` env var
 * (operator-wide override) > a fixed `os.tmpdir()` subdirectory.
 * Deliberately NEVER `process.cwd()` — that was the bug this fixes:
 * `runModeADefault` used to call `createLocalExecutionEnv()` with no
 * `rootDir` at all, which defaults to `process.cwd()` (`harness/exec/local.ts`)
 * — for a live BFF process that's wherever this package's server process
 * happens to be launched from, so every `write_artifact` call (from
 * `explain_change`/`generate_dashboard`, both scoped-write-gated) dropped its
 * output straight into whatever directory started the process.
 *
 * This is entirely independent of `projectDir` (`options.userProject`),
 * which is the ONLY thing that governs the `query` tool's exec cwd (see
 * `createWrenQueryTool` in `harness/tools/native.ts` — it takes `projectDir` as
 * its `cwd` directly, never touching `env`'s own `rootDir`). Changing this
 * default never changes where `query` runs.
 */
export function resolveArtifactsDir(outDir: string | undefined): string {
  return outDir ?? process.env[ARTIFACTS_DIR_ENV_VAR] ?? path.join(os.tmpdir(), "wren-harness-artifacts");
}

/**
 * Mode A ("api-key" | "local" | "gateway"): compile the profile to a vercel
 * bundle (unless `options.bundle` overrides it, for tests), resolve which
 * compiled agent to run (`options.agentId`, defaulting to
 * `ANSWER_QUERY_AGENT_ID` — intent routing picks this upstream in
 * `server/turn.ts`, not here), assemble a `RunAgentContext` bound either to a
 * single adapter covering every tier that agent uses (the default), or —
 * when `options.tierBinding` is set ("hybrid" mode) — to that non-uniform
 * per-tier map, validated via `buildHybridTierBinding`; wire its `query` tool
 * to the real `wren` CLI against `options.userProject` (unless
 * `options.mcpServers` overrides it, for tests), and run it in-process via
 * `runAgent`.
 */
export async function runModeADefault(options: ModeAOptions): Promise<RunAgentResult> {
  const bundle = options.bundle ?? (await describeBundle(options));
  // Intent routing (server/turn.ts) picks the agent id when present; falls back to answer_query,
  // the original default from before intent routing existed.
  const agentId = options.agentId ?? ANSWER_QUERY_AGENT_ID;

  const agent = bundle.agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    throw new Error(`compiled bundle has no "${agentId}" agent`);
  }

  const binding =
    options.tierBinding !== undefined
      ? buildHybridTierBinding(agent, options.tierBinding)
      : buildUniformTierBinding(
          agent,
          deriveAdapterSpec(options.authChoice, options.model !== undefined ? { model: options.model } : {}),
        );
  const registry = createDefaultProviderRegistry();
  const capabilityRegistry = createDefaultCapabilityRegistry();

  if (options.mcpServers !== undefined) {
    return runAgent(bundle, agentId, options.question, {
      binding,
      registry,
      capabilityRegistry,
      mcpServers: options.mcpServers,
      ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
    });
  }

  // Preflight `wren` before wiring the native tool registry around
  // it. Without this, a missing `wren` binary stayed invisible until the
  // tool loop actually called `query` — surfacing as an opaque,
  // indistinguishable-from-a-normal-failure exec result rather than a clear
  // "wren is not installed" error at the point where it's actually
  // diagnosable.
  await resolveWrenBinary();

  const policy = deriveEnforcement(agent);
  // Scoped to an artifacts dir, never the default `process.cwd()`
  // (see `resolveArtifactsDir`'s doc comment) — independent of `projectDir`
  // below, which alone governs the `query` tool's exec cwd.
  const env = createLocalExecutionEnv({ rootDir: resolveArtifactsDir(options.outDir) });
  const nativeTools = createWrenNativeToolRegistry({ env, policy, projectDir: options.userProject });

  return runAgent(bundle, agentId, options.question, {
    binding,
    registry,
    capabilityRegistry,
    nativeTools,
    ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
  });
}
