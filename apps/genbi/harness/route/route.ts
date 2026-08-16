import { enforceCompliance } from "../compliance/index.js";
import { runModeADefault } from "./mode-a.js";
import { runModeBDefault } from "./mode-b.js";
import { runCodexAskDefault } from "./codex-ask.js";
import type { RouteOptions, RouteResult } from "./types.js";

/**
 * The single seam mapping a resolved `AuthChoice` to a back-end:
 * Claude subscription -> Mode B (warble-agent-sdk), Codex subscription ->
 * codex:local, everything else
 * (`api-key`/`local`/`gateway`) -> Mode A (compile to a vercel bundle and run
 * in-process via `runAgent`). `modeA`/`modeB` are injectable so callers and
 * tests can stub either back-end without touching the other or invoking any
 * real compile/dispatch — this is the hook point later tickets (compliance
 * gating, hybrid dispatch) attach to without needing to touch the CLI or
 * either mode's internals.
 *
 * The compliance gate (`enforceCompliance`) runs first, before either
 * back-end is invoked: a `subscription` `AuthChoice` used for a `"hosted"`
 * deployment throws `ComplianceError` here, so no caller of `route()` can
 * reach Mode B for a use the ToS doesn't allow, regardless of whether it
 * came through the CLI's own (separate, warning-printing) check. The
 * resulting `warnings` (e.g. `SUBSCRIPTION_TOS_WARNING`) are attached to the
 * returned `RouteResult` so programmatic callers of `route()` see them too
 * — the CLI additionally prints them to stderr from its own, separately
 * timed `enforceCompliance` call (before `route()` is even invoked, so they
 * print before the back-end runs rather than after `route()` resolves), but
 * that's an independent concern from surfacing them on the result value
 * here. `runModeBDefault` also re-runs this same gate as a belt for direct
 * (non-`route()`) callers — see its doc comment.
 *
 * The per-tier "hybrid" override: `options.tierBinding` (Mode A's per-tier override) and
 * `options.modelsConfig` (Mode B's `--models-config` passthrough) are each
 * meaningful for exactly one back-end. Rather than silently ignore one when
 * the `authChoice` picks the other back-end, `route()` loud-fails — the
 * same "no silent misrouting" posture as the existing Mode B provider guard.
 */
export async function route(options: RouteOptions): Promise<RouteResult> {
  const runModeA = options.modeA ?? runModeADefault;
  const runModeB = options.modeB ?? runModeBDefault;
  const runCodexAsk = options.codexAsk ?? runCodexAskDefault;
  const { authChoice } = options;
  const deployment = options.deployment ?? "personal";

  const { warnings } = enforceCompliance(authChoice, { deployment });

  if (authChoice.mode === "subscription") {
    if (options.tierBinding !== undefined) {
      throw new Error(
        "tierBinding (hybrid Mode A per-tier routing) has no effect under a subscription " +
          "authChoice — Mode B has no adapter/tier binding of its own; use modelsConfig instead " +
          "(warble-agent-sdk's own --models-config per-step routing)",
      );
    }
    if (authChoice.provider === "codex") {
      if (options.modelsConfig !== undefined) {
        throw new Error("modelsConfig applies only to the Claude subscription dispatcher, not codex:local Ask");
      }
      const result = await runCodexAsk({
        authChoice: { ...authChoice, provider: "codex" },
        profileSource: options.profileSource,
        userProject: options.userProject,
        question: options.question,
        deployment,
        ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
        ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
        ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
        ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
        ...(options.codexModels !== undefined ? { codexModels: options.codexModels } : {}),
        ...(options.codexHome !== undefined ? { codexHome: options.codexHome } : {}),
        ...(options.codexLocalBin !== undefined ? { codexLocalBin: options.codexLocalBin } : {}),
        ...(options.codexLocalCli !== undefined ? { codexLocalCli: options.codexLocalCli } : {}),
        ...(options.codexBin !== undefined ? { codexBin: options.codexBin } : {}),
        ...(options.codexMcpServer !== undefined ? { mcpServer: options.codexMcpServer } : {}),
        ...(options.chatTimeoutMs !== undefined ? { timeoutMs: options.chatTimeoutMs } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      return { backend: "codex-local", warnings, ...result };
    }
    const result = await runModeB({
      authChoice,
      profileSource: options.profileSource,
      userProject: options.userProject,
      question: options.question,
      deployment,
      ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
      ...(options.agentSdkBin !== undefined ? { agentSdkBin: options.agentSdkBin } : {}),
      ...(options.outDir !== undefined ? { outDir: options.outDir } : {}),
      ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
      ...(options.modelsConfig !== undefined ? { modelsConfig: options.modelsConfig } : {}),
      ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
      ...(options.chatTimeoutMs !== undefined ? { chatTimeoutMs: options.chatTimeoutMs } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    return { backend: "agent-sdk", warnings, ...result };
  }

  if (options.modelsConfig !== undefined) {
    throw new Error(
      `modelsConfig (hybrid Mode B --models-config passthrough) has no effect under a ` +
        `"${authChoice.mode}" authChoice — that flag only reaches warble-agent-sdk's chat ` +
        "invocation, which Mode A never shells; use tierBinding instead (this harness's own " +
        "per-tier adapter map)",
    );
  }

  const result = await runModeA({
    authChoice,
    profileSource: options.profileSource,
    userProject: options.userProject,
    question: options.question,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    ...(options.outDir !== undefined ? { outDir: options.outDir } : {}),
    ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
    ...(options.mcpServers !== undefined ? { mcpServers: options.mcpServers } : {}),
    ...(options.tierBinding !== undefined ? { tierBinding: options.tierBinding } : {}),
    ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
    ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
  });
  return { backend: "agent", warnings, ...result };
}
