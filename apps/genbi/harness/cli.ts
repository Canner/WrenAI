#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createDefaultLoginProbe } from "./auth/index.js";
import {
  buildTierBindingFromFlags,
  determineExitCode,
  parseChatTimeoutMs,
  resolveAuthChoice,
  resolveDeployment,
  validateRequiredInputs,
} from "./cli-args.js";
import type { CliFlags } from "./cli-args.js";
import { enforceCompliance } from "./compliance/index.js";
import { resolveDefaultProfileSource, route } from "./route/index.js";

const USAGE = `Usage: wren-harness <question> --project <dir> [options]

Options:
  --project <dir>         User's wren project directory (required)
  --profile <dir>         Warble profile source directory (default: sibling repos/warble/genbi-default)
  --mode <mode>           subscription | api-key | local | gateway (default: see policy below)
  --provider <name>       subscription mode: claude | codex (default: claude)
  --adapter <name>        api-key mode: provider registry adapter id (e.g. anthropic)
  --api-key <key>         api-key mode: API key (omit to rely on the adapter's own env var lookup)
  --model <name>          api-key/local mode: model name
  --endpoint <url>        local/gateway mode: endpoint URL
  --warble-bin <path>     Explicit warble binary (default: PATH, then sibling repos/warble/target/release/warble)
  --agent-sdk-bin <path>  Explicit warble-agent-sdk CLI (subscription mode only)
  --out <dir>             subscription mode: run output directory
  --deployment <ctx>      personal | hosted (default: personal). "hosted" means multi-tenant,
                          shared, or always-on-server use; subscription mode is rejected when
                          --deployment hosted (use api-key or gateway instead).
  --tier-adapter <spec>   Hybrid mode, Mode A only (api-key/local/gateway): repeatable
                          "<tier>=<mode>[:<field>=<value>,...]" entry binding one bundle tier to
                          its own adapter, e.g. --tier-adapter cheap=local:endpoint=http://localhost:11434/v1
                          --tier-adapter strong=api-key:adapter=anthropic,model=claude-opus-4-6
                          Every tier the compiled agent uses must be bound exactly once (loud-fail
                          on missing/unknown tier names); when given, replaces the uniform
                          --mode/--adapter/--model binding for tier resolution.
  --models-config <path>  Hybrid mode, Mode B only (subscription): path to warble-agent-sdk's own
                          per-tier YAML config, forwarded verbatim as --models-config <path> to
                          "warble-agent-sdk chat". Known limitation: warble's render stage still
                          wall-hits on non-"render: none" components under a non-Anthropic tier.
  --chat-timeout-ms <n>   Mode B only (subscription): overrides the default 10-minute hang guard
                          on a "warble-agent-sdk chat" invocation. Raise this for a legitimately
                          slower cold-start turn (e.g. right after onboarding a project) rather
                          than the turn being killed and reported as a timeout.
  --help                  Show this help

Default auth-selection policy (when --mode is omitted), in order:
  1. --adapter given  -> api-key, using --adapter/--api-key/--model
  2. --endpoint given -> local, using --endpoint/--model
  3. otherwise, a detected logged-in subscription CLI (claude, then codex) -> subscription
  4. otherwise         -> error: pass --mode explicitly

Compliance: subscription mode uses your personal provider subscription. It is allowed for
--deployment personal (the default), printing a ToS warning to stderr; it is rejected outright for
--deployment hosted, since sharing a personal subscription behind a multi-tenant/always-on server is
account sharing. This harness never embeds a proxy relay for subscription auth.

Exit codes:
  0   answered — result JSON on stdout is a normal answer.
  1   error — an unhandled exception (bad flags, compile/spawn failure, compliance rejection, etc).
  2   refusal — the agent declined to answer (a locked guardrail wasn't satisfied); result JSON on
      stdout is still the refusal envelope, only the exit code differs from a normal answer.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      project: { type: "string" },
      profile: { type: "string" },
      mode: { type: "string" },
      provider: { type: "string" },
      adapter: { type: "string" },
      "api-key": { type: "string" },
      model: { type: "string" },
      endpoint: { type: "string" },
      "warble-bin": { type: "string" },
      "agent-sdk-bin": { type: "string" },
      out: { type: "string" },
      deployment: { type: "string" },
      "tier-adapter": { type: "string", multiple: true },
      "models-config": { type: "string" },
      "chat-timeout-ms": { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help === true) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals.length === 0) {
    process.stderr.write(`error: a question is required\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const chatTimeoutMs = parseChatTimeoutMs(values["chat-timeout-ms"]);
  const flags: CliFlags = {
    ...(values.project !== undefined ? { project: values.project } : {}),
    ...(values.profile !== undefined ? { profile: values.profile } : {}),
    ...(values.mode !== undefined ? { mode: values.mode } : {}),
    ...(values.provider !== undefined ? { provider: values.provider } : {}),
    ...(values.adapter !== undefined ? { adapter: values.adapter } : {}),
    ...(values["api-key"] !== undefined ? { apiKey: values["api-key"] } : {}),
    ...(values.model !== undefined ? { model: values.model } : {}),
    ...(values.endpoint !== undefined ? { endpoint: values.endpoint } : {}),
    ...(values["warble-bin"] !== undefined ? { warbleBin: values["warble-bin"] } : {}),
    ...(values["agent-sdk-bin"] !== undefined ? { agentSdkBin: values["agent-sdk-bin"] } : {}),
    ...(values.out !== undefined ? { out: values.out } : {}),
    ...(values.deployment !== undefined ? { deployment: values.deployment } : {}),
    ...(values["tier-adapter"] !== undefined ? { tierAdapters: values["tier-adapter"] } : {}),
    ...(values["models-config"] !== undefined ? { modelsConfig: values["models-config"] } : {}),
    ...(chatTimeoutMs !== undefined ? { chatTimeoutMs } : {}),
  };

  const question = positionals.join(" ");
  const project = validateRequiredInputs(flags.project, question);
  const profileSource = flags.profile ?? resolveDefaultProfileSource();
  const authChoice = await resolveAuthChoice(flags, createDefaultLoginProbe());
  const deployment = resolveDeployment(flags);

  // Compliance gate: run (and surface any ToS warning) before the back-end runs.
  // A rejection (subscription + hosted) throws ComplianceError, caught below like any
  // other error. route() re-runs the same gate as a structural backstop for any other
  // caller of route() that doesn't go through this CLI.
  const { warnings } = enforceCompliance(authChoice, { deployment });
  for (const warning of warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }

  // Hybrid mode: --tier-adapter (Mode A) and --models-config (Mode B) are each
  // meaningful for exactly one back-end; route() itself loud-fails (a plain
  // Error, caught like any other error below) if the wrong one is supplied
  // for the resolved authChoice.mode, so no separate CLI-level guard is
  // duplicated here.
  const tierBinding =
    flags.tierAdapters !== undefined ? buildTierBindingFromFlags(flags.tierAdapters) : undefined;

  const result = await route({
    authChoice,
    profileSource,
    userProject: project,
    question,
    deployment,
    ...(flags.model !== undefined ? { model: flags.model } : {}),
    ...(flags.warbleBin !== undefined ? { warbleBin: flags.warbleBin } : {}),
    ...(flags.agentSdkBin !== undefined ? { agentSdkBin: flags.agentSdkBin } : {}),
    ...(flags.out !== undefined ? { outDir: flags.out } : {}),
    ...(tierBinding !== undefined ? { tierBinding } : {}),
    ...(flags.modelsConfig !== undefined ? { modelsConfig: flags.modelsConfig } : {}),
    ...(flags.chatTimeoutMs !== undefined ? { chatTimeoutMs: flags.chatTimeoutMs } : {}),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  // A refusal is printed exactly as before — only the exit code
  // changes, so callers that already parse stdout JSON are unaffected;
  // callers that only check the exit code now see EXIT_REFUSAL (2), not a
  // false-success 0. See `determineExitCode`'s doc comment for the contract.
  process.exitCode = determineExitCode(result);
}

main().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
